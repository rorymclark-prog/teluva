# Vault and file access protection

New protected values use `enc:3` AES-256-GCM ciphertext. Authenticated data
includes both the explicit space ID and the purpose (`shared` or
`credentials`). Fixed server endpoints select the purpose. A member cannot
reveal a personal credential through the shared-record endpoint by changing its
label, copying its ciphertext or supplying an admin flag. Personal credentials
remain admin-only. The production child mask and adult-only shared-secret gate
remain in place.

Vault requests authorize their explicit space against its authoritative role
document. Another tab changing the account-wide active-space pointer cannot
change the space used for encryption or decryption.

## Existing protected values

`enc:2` authenticates its original space but did not distinguish shared records
from private credentials. On an admin's first legacy shared read, the server
classifies stored shared fields and inventories private sources. Shared
fingerprints live in `families/{spaceId}/vaultLegacyShared`; permanent private
fingerprints live in `families/{spaceId}/vaultLegacyPrivate`. A private
classification always outranks shared approval, even after the original source
is deleted. Clients cannot read, forge, change or remove either inventory.

Ordinary members can retain `digitalAccounts` while editing other permitted
profile fields, but cannot create/change/remove credentials or delete a profile
containing credentials. These guards preserve existing business ownership
checks. The classifier reads the whole member collection, so removing a member
from the metadata index cannot hide a private source.

`enc:1` has no authenticated space identity. Runtime source inspection cannot
certify it: an admin of another space could paste an old blob into their own
writable record. Therefore only the trusted release inventory may preclassify
these values. `scripts/prepare-vault-legacy.mjs` defaults to a read-only dry run;
`--apply` records fingerprints of actual stored shared/private legacy sources.
It prints counts only, never names, ciphertext, plaintext or account values.
Run it before deploying the new server. Sources removed before their first
trusted inventory cannot be reconstructed.

An adult opening uncached `enc:2` shared data before an admin has prepared it
receives an admin refresh notice. An unresolved value remains encrypted in the
record and is never cached as plaintext or replaced with a blank. The recovery
screen offers Retry, Sign out and the standalone saved emergency pack. A later
save upgrades authorized old values to `enc:3`. The old unscoped reveal cache is
retired; successful reveals cache per account and space, and the child mask runs
before plaintext cache access. `/emergency-pack` remains independent of signed-in
vault recovery.

## File bytes

All app file access uses `/api/files`. Direct Firebase Storage SDK operations
are denied, including clients holding old family/admin custom claims. The
server reads current roles from the named `teluva-prod` Firestore database on
every operation. Removed memberships and child demotions take effect on the
next request without waiting for token refresh. The earlier production UID
fallback was already absent and no equivalent bypass is introduced.

Native image, PDF and download requests use a one-hour HttpOnly, Secure,
SameSite=Strict session cookie. The frontend renews it under cross-tab ordering
and rechecks identity changes; unsupported browser coordination fails closed.
Cookie verification checks revocation and verified email. Upload/delete/profile
binding operations require an explicit bearer token as well as current role
checks. Uploads remain strictly smaller than 20 MiB. Oversized declared lengths
and unauthorized requests are rejected before body buffering.

File URLs contain a stable same-origin object path, not a credential. Legacy
Firebase URLs for the exact configured bucket are normalized at ingestion;
other hosts/buckets are not proxied. Reads support HEAD and validated single
byte ranges. Responses are private/no-store, have `nosniff` and same-origin
resource policy, and sandbox uploaded documents. Active HTML/SVG/XML/script
content is an attachment, so it cannot execute as the application. Private API
navigations are excluded from service-worker app-shell caching.

Estate files follow current released `readerUids`, never naming alone. Children
cannot open them, and only admins may alter them. Standard linked document IDs
are checked against locked estate records. Admin attachment flows permanently
mark nonstandard adopted file objects before saving the estate link. The
retirement migration also marks existing linked files. Object generation and
metageneration preconditions prevent a stale upload or delete from racing an
estate protection change and erasing its marker.

Business file ownership uses server-owned object metadata, not a member's
editable copy of a file URL. Admin-only diff-based profile binding associates
new attachments with intended profile owners before a member save. An existing
profile ledger takes precedence; copying a colleague's URL into one's own
profile cannot add a grant. New unbound uploads retain their authenticated
uploader identity. Known shared photo namespaces and intentional general Vault
uploads retain team sharing, while profile and estate restrictions always win.
Unknown legacy business objects without an owner/source ledger fail closed for
nonadmins until an admin explicitly binds or classifies them.
The original Firestore document ID always establishes a profile's identity;
an editable stored `id` field cannot impersonate another owner. A trusted
content review can classify an existing company record as shared or bind a
personal document to its actual subject. An unlinked subject profile stays
admin-only until that person has an explicitly linked account.
An initial business inventory finding the same unclassified object on several
different profiles marks it ambiguous and admin-only. Explicit admin binding
resolves it to chosen owners. Family multi-links and existing trusted ledgers
retain their existing behavior. OCR cache objects are internal and cannot be
opened directly; OCR authorization requires the original source still to exist.

Connected-family media uses `/api/files/connected`. Every request rechecks the
receiving account's membership, active connection, shared person and current
per-category projection. It permits only the exact projected raster photo and
cannot become a general grant to the other family's files. Disconnecting a
family or withdrawing a person's photo/wishes consent removes subsequent byte
access. Household photos remain the production inline-only projection.

Firebase Storage rules cannot read the named database directly; the
[official Storage rule conditions documentation](https://firebase.google.com/docs/storage/security/rules-conditions)
limits cross-service lookups to the default database. The gateway avoids a
second membership mirror. Session transport follows
[Firebase session-cookie verification](https://firebase.google.com/docs/auth/admin/manage-cookies),
with the shorter one-hour lifetime used here.

## Invite redemption

The invite route now consumes an invite, validates current role/seat limits and
writes membership atomically. Concurrent redeemers cannot both receive the
single-use grant. Production rate limits and the existing wills release
workflow remain intact; estate invites name a person without immediately
placing them in `readerUids`.

## Business membership and sharing

Role updates authorize an explicit space and change its authoritative role
and the matching account membership in one transaction. The account's active
role mirror changes only if that same space is active. Clients cannot change
role or plan fields directly, including deleting an expiry to make a temporary
plan permanent. Open sessions observe server-confirmed role changes and clear
sensitive local state before reloading with the new permissions.
Current clients pin invite creation, renaming, founding-date updates, leaving
and deletion to an explicit space. The server rechecks membership there rather
than letting another tab's active-space pointer redirect the action. Leaving,
removing and demoting members use the same transactional admin checks.

Public business calendar subscriptions read shared calendar events without
loading private staff birthdays or derived occasions, including subscriptions
issued before this restriction. Family carer snapshots are rejected for
business spaces on both management and public-read paths. Existing family
sharing retains its role and expiry checks.

## Rollout order

1. Run the complete checks and commit the reviewed release sources.
2. Deploy Firestore credential-source rules, then dry-run and apply
   `scripts/prepare-vault-legacy.mjs` against the intended named database.
3. Deploy the server and frontend together. Verify the version and both app
   origins, session endpoint authorization, canonical native media and current
   role checks. Refresh existing tabs: old clients do not send explicit vault
   space IDs and still use the retired Storage SDK contract.
4. Deploy deny-all client Storage rules. Dry-run
   `scripts/retire-file-tokens.mjs`, review counts, then apply it. The script
   removes legacy download-token metadata, preserves unrelated metadata,
   classifies estate/profile sources, and sets no-store cache policy with
   metageneration preconditions. It logs counts only and fails on public object
   ACLs or errors. Re-run the dry run to verify zero remaining token objects.
5. Verify Cloud Run health/version, denied anonymous/stale SDK access and the
   authenticated file path. An admin should open each space once for remaining
   tenant-bound legacy shared approvals.

The byte revocation guarantee applies to future requests. Files already
downloaded or deliberately exported cannot be recalled. Existing public/token
URLs must be retired in step 4; deploying rules alone does not invalidate bearer
links. Modern browser coordination is required for protected file sessions.

## Validation

`server/vault.test.mjs` exercises real cryptography, purpose/space tampering,
legacy provenance and persistent deny precedence with synthetic records.
`server/files.test.mjs` covers current membership, demotion, byte ranges, owner
ledger attacks, estate protection races, connected consent and migration plans.
`server/filesHttp.test.mjs` exercises the actual Express router over localhost,
including cookie flags and raw JSON file bytes. `firestore-rules.test.mjs` and
`vault-rules.test.mjs` use the real Firestore emulator; `storage-rules.test.mjs`
proves direct SDK operations are denied in the Storage emulator. Client tests
cover URL parsing/normalization, account/session ordering, role masks, cache
failures and retaining unreadable values during unrelated edits. Invite
concurrency tests exercise the local Firestore transaction engine. All tests
use generated fixture data.
