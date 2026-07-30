#!/usr/bin/env bash
# One-off cleanup of old Cloud Build / Artifact Registry image tags.
# Keeps the currently-live image (never touched, regardless of KEEP_COUNT)
# plus the KEEP_COUNT most recent builds as a rollback buffer, deletes the
# rest. Safe to re-run any time — it recomputes "live" and "recent" fresh.
set -euo pipefail
REPO="europe-west2-docker.pkg.dev/gen-lang-client-0384516171/cloud-run-source-deploy/family-info-organizer"
PROJECT="gen-lang-client-0384516171"
KEEP_COUNT=15

LIVE=$(gcloud run services describe family-info-organizer --region=europe-west2 --project="$PROJECT" \
  --format="value(spec.template.spec.containers[0].image)" | sed 's/.*@//')
echo "Live image digest (never touched): $LIVE"

gcloud artifacts docker images list "$REPO" --project="$PROJECT" --format=json \
  | jq -r '. | sort_by(.createTime) | reverse | .[].version' > /tmp/_all_digests.txt

DELETE_LIST=$(tail -n +$((KEEP_COUNT+1)) /tmp/_all_digests.txt)

TOTAL=$(echo "$DELETE_LIST" | grep -c . || true)
echo "Keeping $KEEP_COUNT most recent + live — deleting $TOTAL older images"

if echo "$DELETE_LIST" | grep -q "$LIVE"; then
  echo "REFUSING: live digest ended up in the delete list, aborting."
  exit 1
fi

echo "$DELETE_LIST" | while read -r digest; do
  [ -z "$digest" ] && continue
  if [ "$digest" = "$LIVE" ]; then echo "skipping live digest"; continue; fi
  gcloud artifacts docker images delete "${REPO}@${digest}" --project="$PROJECT" --delete-tags --quiet >/dev/null 2>&1 \
    && echo "deleted $digest" || echo "FAILED $digest"
done

echo "Done. Remaining images:"
gcloud artifacts docker images list "$REPO" --project="$PROJECT" --format="value(version)" | wc -l
