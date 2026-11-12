# Curated family memory review v392

The family archive keeps meaningful experiences rather than every stop or photo. Start with at most five weekly highlights, one chosen cover per memory and an additional trip/place entry only when there is a distinct story. This threshold is a product choice, not a requirement from an archive standard. The Library of Congress recommends selecting important photographs, reducing near-duplicates and recording meaningful names, dates and descriptions: [personal photo archiving](https://blogs.loc.gov/thesignal/2011/10/four-easy-tips-for-preserving-your-digital-photographs/).

## Import and review

- Life Atlas imports selected device originals or Google Photos selections. Metadata is inspected before making a cover. Existing Atlas stories can now receive a cover without creating another record. Capture dates and GPS from that cover are offered for explicit blank-only copying; they are not automatically the event date or location.
- The family AI import inbox has a memory intake panel. Paste named chat/email text or choose a WhatsApp TXT/ZIP export. ZIP processing selects exactly one chat text, never auto-imports attached media, and bounds file count and decompressed bytes. Long exports use at most 19,000 characters of locally selected passages and explicitly report partial coverage.
- A user-triggered request reuses the existing Gemini timeline parser and AI-consent/usage gates. Its curated mode selects zero to five distinct highlights, omits routine logistics and unconfirmed plans, preserves exact excerpts, and keeps uncertain dates/people unknown. The explicit visible family ID is checked before and after the provider response.
- Each pending draft retains its quote and a short source context, rather than duplicating a whole chat. Retry reuses the same prepared result and request ID without another model call. Account, space, role, consent and panel changes fence async adoption and queuing.
- An adult administrator reviews the title, people, date precision, story and evidence. Approval transactionally appends either a timeline memory or an Atlas entry. An Atlas entry already appears in the family timeline, so one story does not create duplicate canonical rows. Existing entries and metadata are preserved; duplicate source memories, missing people, business destinations and oversized/unreadable registers are rejected. There is no connector tool to approve or overwrite final records.
- The existing MCP server exposes `submit_memory` under the existing `inbox:write` grant. It receives authorized named text and a prepared suggestion; it does not read more private profiles, add selected-document grants or invoke paid analysis. Existing plugin identity, audience and endpoint are preserved. Older clients may need to refresh discovered tools before this new tool appears.

## People and map behavior

Whole family shows all saved stories, including untagged ones. Individuals permits one or several selected people and shows stories tagged with any of them. Untagged records are not inferred to belong to a person. Map, gallery and selected details use the same filtered set. Nearby overlapping touch targets are grouped into a story chooser and split as the user zooms; a mobile click can no longer fall through to a different coincident pin.

## Weekly pilot on Rory's Mac

Codex heartbeat `weekly-family-memory-review` is ACTIVE in the existing chat, Sundays at 18:00 local Vienna time (first scheduled Sunday: 15 November 2026). It is an on-this-Mac recurring assistant review, not a universal Teluva cloud scheduler or an always-connected personal WhatsApp/Photos crawler.

Authorized sources are the existing Maria TXT/ZIP exports in `~/Downloads/WhatsApp Chats - Maria`, originals deliberately placed in `~/Pictures/Teluva Memory Imports`, and a bounded metadata-first search of relevant connected Gmail messages from the preceding seven days. The standing prompt limits opened messages to twelve and suggestions to five, preserves a local coverage/deduplication ledger, labels historical discoveries and permits zero suggestions. It does not apply records, send messages, change grants, or claim fresh source coverage when an export/selection is stale. The first scheduled run has not yet occurred; real source ingestion was not performed during development.

Google Photos requires a fresh user-selected Picker session and removes GPS from downloaded images; it does not provide unattended whole-library scanning. Personal WhatsApp exports are point-in-time files and need refreshing. See [Google picking experience](https://developers.google.com/photos/picker/guides/picking-experience), [Google media bytes/location metadata](https://developers.google.com/photos/picker/guides/media-items), and [WhatsApp export](https://faq.whatsapp.com/1180414079177245/?cms_platform=iphone&locale=en_US).

## Verification

Focused server tests cover evidence matching, family/admin permissions, missing people, idempotent approval, duplicate prevention, unknown dates/pins and one Atlas-derived timeline source. Real React tests cover preparation, invalid excerpts, retry without re-analysis, account/consent fences, family/person toggles and attaching a cover to an existing record without an automatic save. Utility tests exercise bounded exact source windows and streamed ZIP text. The normal release pipeline runs the complete test/rules/build gates.

Supported Chrome QA used the actual components, map, AppearanceProvider and built app CSS with synthetic auth, database and AI/provider boundaries. Checked draft preparation/review/approval, year-only dates, place selection, people tags, family and multi-person filters, nearby-pin chooser and selected-detail consistency. A 390×844 dark viewport had no horizontal overflow; desktop light was also inspected. This is responsive Chrome QA, not a physical-phone test. Own preview tab/server were closed and viewport reset. Evidence is in ignored `output/verification/weekly-memory-review-2026-11-12/`.

Live Google Photos consent/download, a real paid Gemini extraction and the scheduled first run remain unverified. No private chat content, email body, photo or household record was copied or mutated during development; source discovery inspected filenames and Teluva connection metadata only.
