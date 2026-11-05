# Selected-original draft preparation

## Customer action and boundaries

After queuing up to 20 originals in the Import inbox, an adult can choose **Prepare N drafts with AI**. The action uses the existing analysis endpoint and AI consent/allowance. It processes only the originals in this panel's current batch, sequentially, retaining their original IDs, bytes and provenance. It creates pending asset/document proposals; each final record still requires explicit review and approval.

Saved proposals are excluded. Rows with unsaved edits or a manual request in flight report synchronous holds to the parent and are excluded too. Queued/analyzing rows are locked against editing and row actions, including stale event handlers. The hold is checked again before each analysis request. Refresh/filter controls cannot replace or unmount the rows during preparation.

**Stop after this draft** prevents later requests; it does not interrupt a request already sent. Auth, allowance, consent, unknown and service failures halt the batch. Known individual-file analysis failures (413/415/422) and HTTP missing/revision conflicts (404/409) allow later files to proceed. Local model-output validation failures are classified per file, rather than starving later originals on every retry. Retrying never re-analyzes successful proposals and never retries a failed file automatically within the same run.

The selection is transient. Reloading loses the panel's batch selection; originals can be queued again from the Vault. This change does not discover source accounts, schedule scans, add provider tools, change connector grants, or bypass review. Existing connector original-import support remains unchanged.

## Independent review and repairs

An independent Claude source review of the initial candidate (fd144c9, source based on b6195ed) completed on 5 November 2026. The original immutable review receipt lives outside the repository at `Documents/Codex/2026-11-03/realtime-voice-chat/work/secondary-app-audit/claude-teluva-import-preparation-review-result.json`; response SHA-256 `59a5f194d74b17efe6c0db5b13e3d32dbacc7acffaa6d34f68989cb1e718d7c3`. Claude executed no tests or services.

Repairs address all four confirmed findings:

1. Shared synchronous manual holds and preparation locks preserve dirty/in-flight reviews. Actual React panel/row interaction tests reproduce typing, an in-flight save, queued-row actions and stale event handlers.
2. Local schema/forbidden-preferences/invalid-text failures report 422; extracted size failures report 413; source changes during analysis report 422. Generic messages retain neither model output nor provider credentials. A real-HTTP/Firestore emulator regression proves that an unusable first output does not block the second original or trigger internal retries.
3. Thrown HTTP failures continue only for 404/409. 401 and unknown/global 4xx halt later requests.
4. Preparation returns completed/stopped/halted outcomes. Stopped runs report stopped; halted runs show an error, with originals/drafts retained.

The review's production-adapter limitation is explicit: the reviewer was not supplied production extraction/auth/membership code. The owner subsequently inspected `server/connectorIntegration.mjs`: extraction checks current membership, consent, configured AI, rate limit and usage before provider access; rechecks access/consent before recording usage; and passes a 90-second abort signal to generation, below the five-minute inbox lease. Existing adapter tests cover opt-out/child blocking and protected-original access. This is source/test evidence, not a fresh paid-provider or customer sign-in certification.

## Verification for repair candidate

Passed before browser handoff:

- `npx tsx src/components/ImportPreparationInteraction.test.ts`: actual React hooks/events with synthetic auth/readers/HTTP; dirty and saving reviews preserved, queued rows locked, stale handlers fenced, stop and 401 halt make no later request.
- `npx tsx src/utils/importPreparation.test.ts`: sequential requests, exact revisions/selection, duplicate cap, saved/manual holds, safe continuation allowlist, explicit outcomes, stop and identity/source fencing.
- `npx tsx src/components/connectorUi.test.ts`, `npx tsx src/utils/importInboxClient.test.ts`, `npx tsx src/utils/testCoverage.test.ts`.
- `node --test server/importInbox.test.mjs`: 15 tests, including local schema/size failures, source mutation, manual preservation and sanitized errors.
- `node --test server/connectorIntegration.test.mjs`: 8 adapter tests.
- `npx tsc --noEmit`, `git diff --check`.
- `firebase emulators:exec --config firebase.invites.emulator.json --only firestore --project rules-probe 'node --import tsx --test server/importPreparation.emulator.mjs'`: passed. Four exact originals across separate family/business spaces; first-response schema/size failures, second-original progress, one explicit failed-only retry per space (six synthetic model calls total), no repeat calls for successes, explicit admin filing, unchanged `inbox:write` grants with no selected-document read access. Original bytes/provenance retained; only this test's records removed afterward. Real routes/Firestore, synthetic auth/model/object-storage adapters. Emulator stopped normally. Log `/tmp/teluva-preparation-emulator-repair.log` is local verification evidence.

`react-test-renderer` 19.2.6 is a development-only test dependency matching the installed React version. It is deprecated upstream; the interaction regression uses it to execute real component hooks without a browser or production credentials. It is not visual/browser evidence.

## Synthetic browser handoff

The local harness is ignored verification output, not production functionality: `output/verification/import-preparation-2026-11-05/browser-fixture.mjs`. Run from this checkout with `node output/verification/import-preparation-2026-11-05/browser-fixture.mjs`; open `http://127.0.0.1:3199/` through supported browser controls. It bundles the actual candidate component/helper/client, substitutes synthetic context/readers/API and seeds two queued text originals. It rejects uploads. No real sign-in, provider, document or record access occurs. The page identifies its captured commit and marks all evidence synthetic. The launching chat owns the process and its `preview-process.json` PID/checkout/command record; close its own test tab and stop the matching process when done.

Check a dirty second row then Prepare 1 (manual text kept); Prepare 2 then queued-row locking/Stop (one analysis); allowance halt wording; consent off; family/business switch fencing; successful drafts stay pending with original/evidence links; no repeat analysis; explicit approval only; mobile fit. The default synthetic analysis delay is six seconds to permit stop/switch observation. Browser verification is pending; no deployment or live customer certification is claimed by this document.
