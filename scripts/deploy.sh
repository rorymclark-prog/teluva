#!/usr/bin/env bash
#
# One command to ship Teluva. `npm run deploy` and walk away.
#
# WHY THIS EXISTS
# ----------------
# Deploying used to be two long gcloud commands typed by hand, and the order
# mattered in a way nothing told you about: `run services replace` points the
# service at an image tag, so running it before `builds submit` has finished
# fails with a bare "Image ... not found". That happened twice in one session,
# each time looking like a broken deploy when it was only an impatient one.
# The build also has to be watched for several minutes to know when the second
# command is safe. This script sequences the two, so neither can be run out of
# order and nothing has to be watched.
#
# It also refuses to ship in the states that have previously reached
# production: a version tag that disagrees between CHANGES.json and
# run-service.yaml, or a failing check. And it does not trust "the commands
# exited 0" as proof — it asks the running service what version it is actually
# serving before saying the word "live".
#
# Usage:
#   npm run deploy              # checks, build, deploy, verify
#   SKIP_CHECKS=1 npm run deploy  # skip lint/test/build (re-deploying an
#                                 # already-verified tree — not for new code)

set -euo pipefail

PROJECT="gen-lang-client-0384516171"
REGION="europe-west2"
SERVICE="teluva"
LEGACY_SERVICE="family-info-organizer"
REPO="europe-west2-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy/${SERVICE}"

# Run from the project root no matter where this was invoked from — the whole
# original failure mode was being in the wrong directory.
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[31mAborted: %s\033[0m\n' "$1" >&2; exit 1; }

# --- 1. What version are we shipping? -------------------------------------
# CHANGES.json is the source of truth (it is what the user actually reads in
# the app); run-service.yaml must already agree, because a mismatch means the
# release notes and the deployed code are about to describe different builds.
TAG=$(node -p "require('./CHANGES.json').label" 2>/dev/null) || die "could not read the label from CHANGES.json"
[ -n "$TAG" ] || die "CHANGES.json has no label"

grep -q "${SERVICE}:${TAG}\$" run-service.yaml \
  || die "run-service.yaml does not point at ${TAG}. Bump it to match CHANGES.json first."

if gcloud artifacts docker images list "$REPO" --include-tags --format='value(tags)' \
     --project "$PROJECT" 2>/dev/null | tr ',' '\n' | grep -qx "$TAG"; then
  die "${TAG} has already been built and pushed. Bump to a new version rather than overwriting a released tag."
fi

say "Shipping ${TAG}"

# Keep both public service names on the same image. The rename left the legacy
# service alive, and verifying only each service's own /version.json cannot
# detect drift because stale code reports its own stale version consistently.
OLD_PRIMARY_REV=$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.latestReadyRevisionName)')
OLD_LEGACY_REV=$(gcloud run services describe "$LEGACY_SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.latestReadyRevisionName)')

# --- 2. Don't ship something broken ---------------------------------------
if [ "${SKIP_CHECKS:-}" = "1" ]; then
  say "Skipping checks (SKIP_CHECKS=1)"
else
  say "Checks: typecheck, colour tokens, tests, production build"
  npm run lint
  npm run test:ember
  npm test
  npm run build
fi

# --- 3. Build the image ----------------------------------------------------
# Blocks until Cloud Build finishes, which is precisely the wait that used to
# be done by eye.
say "Building the image (a few minutes)"
gcloud builds submit --tag "${REPO}:${TAG}" --project "$PROJECT"

# --- 4. Point the service at it -------------------------------------------
# Deployed by DIGEST, not by tag. `gcloud run services replace` resolves the
# :tag in run-service.yaml itself, and that resolution has repeatedly failed
# with a flat "Image ... not found" for a tag that demonstrably exists — twice
# for v153, twice more for v154, each time minutes after the push, each time
# with `artifacts docker images describe` happily returning the digest. The
# digest needs no resolution, so it cannot fail that way. run-service.yaml
# stays the source of truth for the tag; this only sidesteps the lookup.
say "Resolving ${TAG} to its digest"
DIGEST=$(gcloud artifacts docker images describe "${REPO}:${TAG}" --project "$PROJECT" \
           --format='value(image_summary.digest)') || die "could not resolve ${TAG} to a digest"
[ -n "$DIGEST" ] || die "no digest for ${TAG}"

# Deploy the WHOLE run-service.yaml (env vars, secrets, scaling — not just the
# image), but with the tag swapped for the digest in a throwaway copy. Using
# `gcloud run deploy --image` instead would have been simpler and wrong: it
# only swaps the image and would silently ignore every other edit made to
# run-service.yaml.
TMP_YAML=$(mktemp -t teluva-run-service)
trap 'rm -f "$TMP_YAML"' EXIT
sed "s|${REPO}:${TAG}\$|${REPO}@${DIGEST}|" run-service.yaml > "$TMP_YAML"
grep -q "$DIGEST" "$TMP_YAML" || die "failed to pin the image to its digest — not deploying a config I can't verify"

say "Deploying ${SERVICE} to Cloud Run"
gcloud run services replace "$TMP_YAML" --region "$REGION" --project "$PROJECT"

say "Repointing ${LEGACY_SERVICE} to the same digest"
if ! gcloud run services update "$LEGACY_SERVICE" \
  --image "${REPO}@${DIGEST}" \
  --region "$REGION" \
  --project "$PROJECT"; then
  # The first service has already moved. Put it back immediately so the two
  # public names cannot silently serve different releases after this command.
  say "Legacy service update failed — restoring both captured revisions"
  ROLLBACK_FAILED=0
  gcloud run services update-traffic "$SERVICE" \
    --to-revisions="${OLD_PRIMARY_REV}=100" \
    --region "$REGION" \
    --project "$PROJECT" || ROLLBACK_FAILED=1
  gcloud run services update-traffic "$LEGACY_SERVICE" \
    --to-revisions="${OLD_LEGACY_REV}=100" \
    --region "$REGION" \
    --project "$PROJECT" || ROLLBACK_FAILED=1
  if [ "$ROLLBACK_FAILED" = "0" ]; then
    die "${LEGACY_SERVICE} could not be updated. Both services were restored to their captured revisions."
  fi
  printf '\nManual rollback commands:\n' >&2
  printf '  gcloud run services update-traffic %s --to-revisions=%s=100 --region %s --project %s\n' "$SERVICE" "$OLD_PRIMARY_REV" "$REGION" "$PROJECT" >&2
  printf '  gcloud run services update-traffic %s --to-revisions=%s=100 --region %s --project %s\n' "$LEGACY_SERVICE" "$OLD_LEGACY_REV" "$REGION" "$PROJECT" >&2
  die "${LEGACY_SERVICE} could not be updated and automatic rollback was incomplete. Run the rollback commands printed above manually."
fi

# --- 5. Prove it ----------------------------------------------------------
# A successful `replace` only means Cloud Run accepted the config. Ask the
# live service what it is serving. Cloud Run can take a moment to finish
# routing traffic to the new revision, so poll rather than checking once.
verify_service() {
  local target="$1"
  local url live=""
  url=$(gcloud run services describe "$target" --region "$REGION" --project "$PROJECT" --format='value(status.url)')
  say "Verifying ${target} at ${url}"
  for _ in $(seq 1 30); do
    live=$(curl -fsS "${url}/version.json" 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).label" 2>/dev/null || true)
    if [ "$live" = "$TAG" ]; then
      printf '\033[32m%s is live on %s\033[0m\n' "$TAG" "$target"
      return 0
    fi
    sleep 5
  done
  printf '\nVerification failed. Immediate rollback commands:\n' >&2
  printf '  gcloud run services update-traffic %s --to-revisions=%s=100 --region %s --project %s\n' "$SERVICE" "$OLD_PRIMARY_REV" "$REGION" "$PROJECT" >&2
  printf '  gcloud run services update-traffic %s --to-revisions=%s=100 --region %s --project %s\n' "$LEGACY_SERVICE" "$OLD_LEGACY_REV" "$REGION" "$PROJECT" >&2
  die "deployed, but ${target} still reports '${live:-unknown}' rather than ${TAG}."
}

verify_service "$SERVICE"
verify_service "$LEGACY_SERVICE"

printf '\nBoth Cloud Run services are on the same verified image.\n'
printf 'If a service-level rollback is needed, route traffic back independently:\n'
printf '  gcloud run services update-traffic %s --to-revisions=%s=100 --region %s --project %s\n' "$SERVICE" "$OLD_PRIMARY_REV" "$REGION" "$PROJECT"
printf '  gcloud run services update-traffic %s --to-revisions=%s=100 --region %s --project %s\n' "$LEGACY_SERVICE" "$OLD_LEGACY_REV" "$REGION" "$PROJECT"
printf '\nClose the app fully on your phone and reopen it to pick it up.\n\n'
