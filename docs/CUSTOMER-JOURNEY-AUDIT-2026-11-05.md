# Bounded customer-journey audit — 5 November 2026

## Goal and completion criteria

Keep unfinished imports discoverable as a customer's history grows, for family
and business spaces, while retaining current membership and original-file access
checks. Reproduce with synthetic data, fix the evidenced gap, independently review
the diff, verify the affected workflow and use the established Cloud Run release
gates. Do not alter real household records or personal media.

This is the smaller Teluva lane of the ImbewuField-first sprint. The update-card
animation remains owned by the separate animation change/PR #1. Its owner completed
and verified v387 during this audit. The inbox release includes that exact released
base without modifying its walkthrough components or animation behaviour.

## Journey review

| Journey | Evidence and result |
| --- | --- |
| First-time onboarding and account connection | Carry forward the Google test-account signup/consent acceptance recorded in `ASSET-IMPORT-AND-AI-CONNECTIONS.md`; do not recreate accounts or repeat that passed live acceptance. |
| Original attachment import/readback | Carry forward the original-byte, checksum, protected download and reviewed record-link acceptance in the same document. Current inbox source/version checks and original-preserving apply were inspected and are covered by the release gates. No personal attachment was imported for this audit. |
| Family/member access | Current role and source checks remain authoritative. New continuation checks cover member-only pages, cross-space/other-member cursors, child-role rejection and an admin demotion during source checks. |
| Search | Reviewed the existing space-scoped browser index and readable-text/failed-file coverage reporting. No new search implementation or paid analysis is introduced. Existing search tests run as a mandatory release gate. |
| Duplicate handling | Existing idempotency keys and serial-number duplicate blocking remain in place. The inbox tests verify that conflicts do not overwrite original or canonical records. Pagination deduplicates overlapping rows by ID. |
| Review and export | Reviewed revision checks, explicit admin approval and original-file links, plus the backup/restore complete-file requirement. Existing review/export tests run through the required release gate. |
| Revocation | Carry forward the verified live revocation acceptance. Continuation resolves membership again on every page and refuses a role that changes during the request. No working customer grant is revoked for this audit. |

## Evidenced gap and change

The server previously returned only the newest 100 imports. The browser then
filtered that single page by status. With 205 newer completed imports and one
older pending draft, the default view said nothing was waiting for review and
offered no way to reach the old draft.

The HTTP endpoint now returns up to 100 accessible imports plus a continuation
cursor. Firestore's document-snapshot cursor preserves the ID tie-break when
creation timestamps are equal. The cursor advances even over a page whose
originals cannot be read. Every page repeats current membership and source checks.
An in-flight role change returns a refresh-required error rather than an obsolete
page or cursor. Malformed cursors are rejected and another member's cursor cannot
be used by an ordinary member.

The inbox offers **Load older imports**, preserves the loaded pages on a temporary
failure and deduplicates incoming rows by ID. An empty filtered page explicitly
states that older imports remain; the pending count says **loaded** until the end
of history is reached. A failed initial request no longer looks like a genuinely
empty inbox. Expired/access-changed cursors direct the customer to Refresh.

## Verification and independent review

- `server/importInbox.test.mjs`: synthetic 206-row history, three pages, equal
  timestamps, source-filtered pages, current roles and cursor isolation, alongside
  existing review/idempotency/source-preservation cases.
- `server/importInboxPagination.emulator.mjs`: actual HTTP router and real
  Firestore snapshot cursors, in disposable family and business spaces on the
  loopback `rules-probe` emulator. Creates and removes only synthetic records;
  asserts no-store responses, older pending discovery, source filtering and
  role/ownership checks. The emulator is always shut down after the check.
- `src/utils/importInboxClient.test.ts`: encoded continuation plus explicit space,
  existing account/space/panel response fences and request conflict handling.
- `src/components/connectorUi.test.ts`: renders the actual component; verifies
  an older-history empty page offers continuation and does not say the queue is
  empty, while existing child/member/admin gates remain intact.
- Claude reviewed the bounded code-only diff through its existing desktop app:
  [review](https://claude.ai/chat/d064b0e4-db54-4692-a9a9-8625050e6277).
  It found no confirmed blocking bug. Its query-string, source-error and remount
  concerns were checked against the surrounding code and tests. Its in-flight
  role/cursor and loaded-count concerns led to explicit guards/copy. Server-side
  status filtering/global counts remain a future usability improvement.

Browser control was disabled in Work settings during this audit, so there is no
fresh browser click-through or screenshot claim. A synthetic local preview was
prepared, then stopped when that restriction was observed. Component rendering and
real HTTP/Firestore behaviour were verified independently of browser automation.

## Remaining limits

- Loading is explicit in pages of 100, rather than a global status-filtered query
  and total pending count. A long completed history can require multiple clicks.
- If an operator removes the cursor's backing draft, the next request requires
  Refresh. The normal dismiss/apply actions preserve draft documents.
- A malformed legacy row with a missing/mismatching space field at a page boundary
  requires operator repair. The current validated creation paths always supply
  that field; this audit does not rewrite historical production data.
- Loaded pages are snapshots; changes made elsewhere appear after Refresh.
- The private plugin's generic host icon remains a host display gate. No duplicate
  plugin, public listing, new connector package or version churn is introduced.
- Unknown legal family names and missing milestone photos remain user/data gaps.
  No such facts or media were inferred or changed here.

## Operations

Owned temporary browser fixture: checkout `/Users/roryclark/teluva`, command
`node output/verification/inbox-history-2026-11-05/browser-fixture.mjs`, PID 30221,
port 3198, exec session 78058. Its exact command and checkout were checked before
SIGTERM; it was stopped. Pagination emulator exec session 93181 owned ports
8189/4419/4519 for its test and shut them down normally. No other chat's processes
or user data were removed. Local verification artifacts stay under the ignored
`output/verification/inbox-history-2026-11-05/` directory.

## Release outcome

Completed as **v388**. Deployed source commit:
`aadbee639c5df21b86e567fe67338970d5831bc4`. The established deploy script passed
typecheck/colour checks, security rules, Ember checks, the full frontend sequence,
all **674 server tests**, and the production build without a bypass. The focused
inbox suite passed 13 tests; the new HTTP/Firestore emulator acceptance passed for
both synthetic space types. The browser limitation above still applies.

Verified at 09:18 UTC on 5 November 2026:

- [Primary service](https://teluva-x3k4bua7pq-nw.a.run.app/): `v388`, revision
  `teluva-00213-pdg`.
- [Legacy service](https://family-info-organizer-x3k4bua7pq-nw.a.run.app/): `v388`,
  revision `family-info-organizer-00367-hbp`.
- Both use the immutable image digest
  `sha256:60c343f7656d6ecafc3f829a9a6bcaa8ad175537f78110649fba97feaeb3c6b7`.
- Unauthenticated inbox requests returned **401** on both services.

The release script (PID 37648, exec session 11168) completed and its temporary
emulators shut down. The release receipt is saved in the ignored verification
directory. This completion-note addition changes documentation only after the
verified application image was built.
