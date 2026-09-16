# Teluva — Fact Sheet for Marketing

Source of truth for website copy. Every claim below is either traced to code
(marked VERIFIED, with the file) or flagged UNVERIFIED. **Only VERIFIED
claims should reach the site.** No feature listed here that is dark-launched
or behind a flag.

Repo: `family-info-organizer` (historical folder name; the product is Teluva).
Live: https://teluva-x3k4bua7pq-nw.a.run.app

---

## 1. What it is

Teluva is a private vault for the things a family actually needs to find:
passports and their expiry dates, blood groups and allergies, the
orthodontist's number, who holds the spare key, what the will says and
where it is. It's built against one household's real records, not a demo.
Stack: React 19 + TypeScript + Vite frontend, a single Express `server.js`
backend, Firebase (auth/Firestore/Storage), Gemini for the assistant and
OCR, deployed on Cloud Run (`europe-west2`). It also runs as a second
"space type" — a small business — reusing the same record types under
different names and a hard access boundary (see §6).
(Sources: README.md; server.js header; src/components/Dashboard.tsx)

---

## 2. Feature inventory (named as the UI names them)

Grouped by the app's own navigation (`VIEWS`/`viewLabel` in Dashboard.tsx)
and the per-member profile tabs (`TABS`). Concrete example given for each.

### Per-member profile (tabs inside a person's own page)
- **Overview** — the person's summary card, astrology-for-fun sun sign, at-a-glance info.
- **Medical** — blood group, allergies, medications, conditions, vaccinations. Example: "Mia's penicillin allergy and her MMR vaccination date."
- **Check-ups** (`care`) — recurring care schedule (dentist every 6 months, etc.)
- **ID & Passports** (`ids`) — passport numbers, expiry dates, visas, national ID numbers, residence permits. Example: "Ganga's passport expires March 2031."
- **Guardians** — non-resident parent / custody-relevant contacts, family-only (no business equivalent).
- **Sizes** — clothing/shoe sizes with a `lastUpdated` staleness flag. Example: "Mia's current shoe size, flagged stale after ~a few months for a young child."
- **Wishlist** (`favorites`) — gift ideas / things they want.
- **Growth** — height/weight history tracker.
- **Timelapse** — birthday photo timelapse.
- **Travel** — travel documents, transit passes, visas.
- **Likes** (`preferences`) — personal preferences.
- **Sayings** — memorable things a family member has said, kept as a keepsake.
- **Documents** — files scanned/uploaded and filed to this person.
- **Secrets** — per-member encrypted secure notes.
- **CV** — work history, education, qualifications, skills (business spaces only — see §6).

### Top-level sections (`VIEWS`)
- **Profiles** ("Team" in a business) — the member list.
- **Emergency** — allergy/blood-type emergency card. Family-only; no business equivalent shipped.
- **Calendar** — two-way Google Calendar sync, ICS feeds, birthdays/anniversaries, Austrian name days plus researched name celebrations for names no saint's calendar covers (src/utils/nameCelebrations.ts / server/yearlyCelebrations.mjs).
- **Info** ("Compliance" in a business) — reference numbers and contacts; in a business space, country-aware registration hints (CIPC/SARS/UIF/COIDA for South Africa, Firmenbuchnummer/UID/Sozialversicherung for Austria, Companies House/VAT/PAYE for the UK — src/components/ImportantInfo.tsx).
- **Household** ("Locations" in a business) — address, wifi, utilities, service history, keys/codes.
- **Finances** — bank accounts, insurance, benefits. Adults only; admins only in a business space (see §4).
- **Insurance** — policy tracking.
- **Vehicles** — a household's vehicles and their records.
- **Pets** — its own top-level section (not buried in Household), family-only. Example: "the dog's vet history."
- **Timeline** — family memory timeline, family-only.
- **Travel timeline** — trip history across the family.
- **Vault** (Documents) — the shared document store; see §2a.
- **Assets** — asset inventory.
- **Recipes** — recipe book, family-only.
- **Anniversaries & Special Days**, **Extended Birthdays** — wider circle of dates, family-only.
- **Wills & Estate** — where the will is kept, who holds the signed original, notary, executor, the "if something happens to me" letter. Locked behind its own Firestore rules (§4).
- **Slips** — purchase receipts/till slips filed for returns and warranty tracking, with separate return-by and warranty dates (server.js edit-kind comment).
- **Shopping** — shopping list, family-only.
- **Gifts & Occasions** — family-only.
- **Passwords** — admin-only shared secrets.
- **Family Words** — a family's own keepsake dictionary, family-only.
- **Chat** — shared family chat (distinct from the private AI assistant transcript).
- **Drive** — Google Drive document index (metadata only, no file bytes stored — firestore.rules `sharedDriveDocs`).
- **In Memory** — archived profiles for people who have died: their documents and dates are kept, not deleted.
- **Family tree** — kin graph with GEDCOM 5.5.1 export AND import (see §2b).

### 2a. Documents / Document Vault
Scan or upload anything. Vision OCR reads it. 7 document categories:
Identity, Education, Medical, Financial, Legal, Travel, Other
(`VaultCategory` in src/types.ts — VERIFIED).

### 2b. Family tree — GEDCOM
Exports and imports GEDCOM 5.5.1, the standard format every major genealogy
program reads (FamilySearch, MyHeritage, Ancestry, Geni, Gramps, Reunion),
chosen over the newer 7.0 because almost nothing imports 7.0 yet. Handles
the person-graph-to-family-record structural mismatch (grouping children by
exact parent sets, adoptive/step parents on their own GEDCOM FAM record via
the PEDI tag). (VERIFIED: src/utils/gedcom.ts, src/utils/gedcomImport.ts)

### 2c. Connected Families
Two households can link without merging: an admin on each side picks what
to share (name, photo, birthday, sizes, wishlist only — a fixed allowlist
enforced server-side, not by the UI). The share list starts empty on both
sides; nothing crosses until an admin explicitly adds it, and each side's
share list is independent of the other's. Any family member can view a
connected family; only an admin can connect, edit sharing, or disconnect.
(VERIFIED: src/components/ConnectedFamilies.tsx, server/familyLink.mjs)

### 2d. Trip Pack
A single-traveller, single-trip screen built for someone away from home,
possibly rattled, on a bad connection, holding a phone in one hand at a
border desk: no tabs or accordions, "what's missing" and "what to do if
documents are gone" pinned top and bottom, and it prints — "paper does not
run out of battery at a border." (VERIFIED: src/components/TripPack.tsx header)

### 2e. Open in your own AI app
A labelled share-sheet action that hands a document (a lease, etc.) to
whatever AI app is already on the phone (ChatGPT, Claude, etc.) via the OS
share sheet — with a one-time-per-session warning that the file leaves
Teluva's guarantees once it does. Built specifically because Teluva's own
document reader is deliberately barred from interpreting documents (§3, §7).
(VERIFIED: src/utils/openElsewhere.ts)

### 2f. Global long-press copy/scan
A single component mounted once near the app root gives long-press
copy/share/scan on any field anywhere in the app, without per-field wiring
— so newly added screens get it automatically rather than needing to be
retrofitted one field at a time. (VERIFIED: src/components/GlobalCopyScan.tsx)

### Offline / installable
Offline-capable PWA (public/manifest.webmanifest, public/sw.js — VERIFIED),
installable, with an Emergency Offline Pack and push notifications for
birthdays and document expiries.

---

## 3. The AI assistant, precisely

**What it can do:**
- Answer questions by recalling from the family's own stored data (read-only recall).
- Extract facts the user states in chat into a proposed **edit** — nothing is written to the vault until the user taps Apply.
- File a scanned/uploaded document to the right person and category.
- Prepare an **export pack**: given a request like "gather everything medical for Mia," it picks topics and people from a fixed list (15 named topics — contact, medical, vaccinations, referrals, appointments, checkups, growth, providers, identity, education, employment, travel, financial, legal, documents) and hands that *request* off to deterministic code, which is the only thing that ever touches the actual files. The assistant never assembles the folder itself — it can be wrong about *which* topics/people are selected (visible and correctable on a confirm screen before anything leaves the device) but structurally cannot be wrong about *contents*, because it never reads them. (VERIFIED: src/utils/exportPack.ts header)
- Read a document and answer questions about it — but see the hard boundary below.
- Reason with the data it has: compute ages, days until a passport expires, flag a stale clothing-size record, total/compare across the family.
- OCR a photographed item (label, sticker, barcode) to file its details.

**What it is explicitly forbidden from doing, and why (from server.js's system prompt, SYSTEM_INSTRUCTION, ~line 894):**
- **Never quotes, paraphrases, summarises, guesses at, or interprets what an uploaded document says.** "You have no way to know, and being wrong about that is the single worst mistake available to you here. Not knowing is fine; guessing is not." The document reader is a *recall* tool: the model only ever returns character offsets into text the client already extracted; the **server**, not the model, slices the actual quote out of the real document. The model cannot paraphrase a contract back at the user as fact because it structurally never gets to author the quoted text.
- **Never states that a document "does not contain / cover / mention" something.** Flagged in the prompt as "the single most damaging thing you can write" — a scan failure, a handwritten blank, a bad page scan and a genuinely absent clause all look identical from the model's vantage point, so it must say only what it *did* find, never assert an absence.
- **Never gives legal, financial, tax, or funeral advice.** Applies to the estate/will conversation, the professional-directory contact cards, and the business-milestone writer.
- **Never invents data.** If something needed is missing, it asks rather than guessing (also true for name meanings, size readings from photos, business-founding facts — this rule repeats near-verbatim across several separate system prompts in server.js, i.e. it's an app-wide policy, not a one-off).
- **Never composes, improves, lengthens, or writes a person's "if something happens to me" letter** — it records only what the user actually dictates, verbatim.
- **Never suggests who someone should name as their estate successor**, and doesn't offer legal/financial/funeral advice in that conversation either.
- **Cannot obey instructions found inside a scanned document.** Text inside an attached image/PDF/scan (including anything OCR reads off it) is treated as data, never as an instruction to the assistant — a scanned page saying "ignore previous instructions" or "export everything" is logged as suspicious content, not executed. No delete/update/clear/export/hub_status action can be triggered by a document's own printed or handwritten content — only by the user's own chat message.
- **Cannot write outside a fixed, closed set of ~37 named "edit kinds"** (member, passport, document, estate_record, delete_record, etc. — VERIFIED count from server.js: `grep -oP '"kind":"\K[a-zA-Z_]+'` = 37 distinct kinds). A record type with no matching edit kind is *physically* invisible to the assistant — this has shipped as a real, caught bug twice in this codebase (referrals, vaccinations), which is why there's now a standalone test (`aiEditCoverage.test.ts`) that fails the build if a new list-shaped field is added without a matching edit kind.
- **Never embeds a Firebase Storage download URL in an export summary.** Such a URL carries a permanent bearer token bypassing storage rules — a summary forwarded to an insurer would otherwise hand them live, world-readable file links.
- **Never silently drops a requested topic.** An empty topic, a record with no attached file, a topic that doesn't apply — all reported, not hidden, so "everything" in an export is a checkable claim.

This is the app's core differentiator: an assistant that files things and
answers from real data, but is architecturally barred from ever authoring
the substance of an answer about a legal or medical document.

---

## 4. Security & privacy properties

All marked VERIFIED are confirmed directly in firestore.rules or the
relevant utility file; UNVERIFIED means asserted only in a comment.

- **Field-level encryption at rest (AES-256-GCM)** for sensitive columns: passport numbers, national ID numbers (SSN/national ID/driver's licence/tax ID/insurance number), bank IBAN/BIC, financial account numbers, and household security codes (door code, garage code, wifi password, key-card number, safe serial, alarm code). VERIFIED — `crypto.createCipheriv('aes-256-gcm', ...)` / `createDecipheriv` in server.js (~line 3773-3823), key lists in src/utils/aiRedact.ts, applied via src/utils/vaultFields.ts.
- **Same sensitive-field list is excluded from the AI's own context** — "too sensitive for a third-party AI's prompt" and "too sensitive to sit in plaintext in the database" are treated as the same judgement, drawn from one shared list so the two protections can't silently drift apart. VERIFIED (src/utils/aiRedact.ts).
- **Server-only membership.** A client cannot write its own role or family — custom claims (`familyId`, `familyIds`) are minted only by the server, and Firestore security rules key off those claims, not client-supplied fields. VERIFIED (README.md; firestore.rules `users/{uid}` rule permits only `displayName, email, aiConsent, tourSeenAt, interviewSeenAt, interviewStep` on self-update — role and familyId are excluded).
- **Default-deny Firestore rules.** The root rule denies all reads/writes not explicitly matched. VERIFIED (firestore.rules line 6-9).
- **Wills & Estate is locked** behind its own rule, separate from general family membership: readable only by an admin, or by a uid an admin has explicitly named on a separate `willsAccess` allow-list document — not by every family member, and specifically not by a child even if their uid is somehow on the list (`canWriteIn`, not `isMemberOf`, gates the named-reader path). VERIFIED (firestore.rules `reference/willsEstate`, `reference/willsAccess`).
- **No death trigger.** The will/estate release mechanism is enforced entirely while the account holder is alive and reachable: either they release it themselves, or a named person requests access and it opens automatically after 7 days if nobody with standing objects (`RELEASE_WAIT_DAYS = 7`, server/willsRelease.mjs). There is no mechanism keyed on someone's death, and this is enforced by an active test (`releaseCopy.test.ts` fails the build if any file's comment claims a "death trigger" exists). VERIFIED.
- **Finances are adults-only**, and admins-only in a business space specifically (a 2026-08-24 rule change, closing a gap where every employee could otherwise read the company's IBANs/insurance/benefits). VERIFIED (firestore.rules `reference/finances`).
- **Passwords are admin-only** — no other member or child role can read or write the shared-passwords collection. VERIFIED (firestore.rules `passwords/{pwId}`).
- **Business-space HR-file boundary**: in a business space, a colleague's member record is treated as an HR file — readable/writable only by the person it describes or by an admin, nobody else (not a directory, deliberately: "a directory that leaks" was rejected in favour of no directory at all until a properly split one exists). This is enforced in the Firestore rule itself, not only in the UI — the code comment is explicit that hiding a tab in the client "protects nothing at all while this rule stays open." VERIFIED (firestore.rules `family_members/{memberId}`, `isBusinessSpace()` helper).
- **Activity trail is not an audit log** and the code says so explicitly: entries are client-written, so a modified client could omit one, but an entry that *is* written cannot lie about who made it (actor uid is pinned server-side by the rule) and cannot be edited or backdated afterward. Three visibility tiers (all/adults/admin) are enforced as a floor in the rule itself, not just in app logic — wills/passwords entries can never be written wider than 'admin', finances/documents entries never wider than 'adults'. VERIFIED (firestore.rules `activity/{entryId}`).
- **Document reader is verbatim-slice-only, server-side.** The model returns only offsets and a topic tag from a closed list; the actual quoted text is cut out of the document by the server, not authored by the model — so the reader "structurally can't" fabricate a quote. VERIFIED (server/docRead.mjs header, server.js insurance/lease reading system prompts).
- **Export packs never include a live Storage download URL** in the written summary (see §3) — VERIFIED (src/utils/exportPack.ts header, "TWO RULES THAT ARE NOT NEGOTIABLE").
- **Shared Google Drive index is metadata-only** — no file bytes are stored in Teluva's own database for Drive-linked documents. VERIFIED (firestore.rules `sharedDriveDocs` comment).
- **AI chat transcripts are private and space-scoped**: each member's assistant conversation lives at `chat/{their own uid}` inside the active space and only that member can read or write it — a family-space conversation cannot leak into a business space for a login that belongs to both (this was a fixed bug: it used to live unscoped on the user's own profile and leaked across spaces). VERIFIED (firestore.rules `chat/{uid}`).
- **Connected-family sharing is an explicit allow-list**, not a blocklist, enforced server-side (§2c). VERIFIED (server/familyLink.mjs, firestore.rules comments).
- **Content-Security-Policy is REPORT-ONLY, not yet enforcing.** This is a real, currently-shipping gap — do not claim CSP protection on the site. UNVERIFIED-AS-A-PROTECTION / VERIFIED-AS-A-GAP (server.js ~line 632-707: "CSP_REPORT_ONLY", explicit comment that a CSP can white-screen the app so it ships report-only first).
- **The two browser API keys shipped in the client bundle are not secrets** — they're referrer-restricted Google API keys by design; every actual secret comes from Secret Manager and isn't in the repo. VERIFIED (README.md).

**What leaves the device / what the server can see:** the server (Express on
Cloud Run) brokers all Firestore/Storage access, performs encryption/
decryption, and runs the Gemini calls for OCR, document reading and the
assistant — so document text and chat content do transit the server (it has
to, to call Gemini and to encrypt/decrypt vault fields), but the specific
redacted-field list (§ above) is stripped before anything is ever put in an
AI model's context, and the server's *own* code is structurally barred from
letting the model author quoted document text (§3).

---

## 5. Numbers that are true

- **~125 standalone test files** (99 client-side `.test.ts`, 26 server-side `.test.mjs`) — no test framework; each is a `node:assert` script, many of them "source-as-text" tests that assert a specific rule is still literally present in the source, because prompts promising capabilities the code doesn't have has been a real, repeated failure class here. VERIFIED (README.md; file counts; package.json `test` script chains ~99 commands).
- **37 distinct AI "edit kinds"** the assistant can write (member, passport, visa, document, estate_record, delete_record, slip, pet_health, cv, …). VERIFIED (server.js).
- **15 export-pack topics** (contact, medical, vaccinations, referrals, appointments, checkups, growth, providers, identity, education, employment, travel, financial, legal, documents). VERIFIED (src/utils/exportPack.ts).
- **7 document vault categories** (Identity, Education, Medical, Financial, Legal, Travel, Other). VERIFIED (src/types.ts `VaultCategory`).
- **5 countries with tailored ID/passport field sets** and hard-coded, individually-sourced national emergency numbers (Austria, South Africa, UK, US, Romania), plus a universal 112 fallback for everywhere else. VERIFIED (src/types.ts `IdCountry`; src/utils/emergencyNumbers.ts — each number cites its government source in-code).
- **90-day trial**, 100 AI actions/month, 200 seats. Free tier: 5 AI actions/month, 10 seats. Paid tier (not yet sold — no billing/checkout exists yet): 2,000 AI actions/month, 200 seats. VERIFIED (src/utils/planLimits.ts).
- **7-day wait** on the named-person will-release request path, absent an objection. VERIFIED (server/willsRelease.mjs `RELEASE_WAIT_DAYS = 7`).
- **~$0.06 per AI action**, the measured real cost (Vertex, Gemini 2.5 Pro dominating) — used to size every limit above. VERIFIED (src/utils/planLimits.ts comment, corroborated by memory of past cost audits — flag as approximate/internal, not a site claim).
- **GEDCOM 5.5.1** export and import (not 7.0 — chosen because almost nothing imports 7.0 yet). VERIFIED (src/utils/gedcom.ts).

---

## 6. Business spaces

A space can be created as a **business** instead of a family, and it's the
same underlying record types with real behavioural differences, not a
skin:

- **Renamed navigation**: Profiles → "Team", Info → "Compliance", Household → "Locations". VERIFIED (Dashboard.tsx `viewLabel`).
- **Hidden, family-only tabs/sections**: Check-ups, Sizes, Wishlist, Growth, Sayings, Timelapse, Guardians (per-member), and Family Words, Timeline, Shopping, Emergency, Recipes, Travel timeline, In Memory, Wills & Estate, Gifts, Anniversaries, Extended Birthdays, Pets, Family tree (top-level). Reasoning given in-code: these are family-custody or household-keepsake concepts with no researched business equivalent yet — genuinely hidden, not mislabeled. VERIFIED (Dashboard.tsx `HIDDEN_IN_BUSINESS`, `HIDDEN_VIEWS_IN_BUSINESS`).
- **CV tab appears only in a business space** — work history, education, qualifications, skills, with a qualification-expiry nudge shared with the deadline-digest logic so the two can't silently disagree. VERIFIED (Dashboard.tsx `HIDDEN_IN_FAMILY = ['cv']`; src/components/MemberCV.tsx; src/utils/qualificationExpiry.ts).
- **Business role presets**: Owner, Director, Manager, Employee, Contractor, Intern, Admin, plus free-text "Custom…". These are UI labels only, not an access-control tier — the actual roles that gate anything are admin/member/child, same as a family space, enforced by Firestore rules, not by the role label. VERIFIED (src/utils/businessRoles.ts; firestore.rules comment makes this distinction explicit).
- **HR-file privacy boundary is enforced at the database rule level**, not just hidden in the UI (see §4) — an employee cannot read a colleague's medical/address/DOB record via a modified client, because the rule itself checks `isBusinessSpace()` and restricts to self-or-admin. VERIFIED.
- **Compliance numbers are country-aware**: South Africa gets CIPC registration/SARS tax ref/UIF/COIDA hints, Austria gets Firmenbuchnummer/UID (VAT)/Sozialversicherung employer number, the UK gets Companies House number/VAT registration/PAYE reference. VERIFIED (src/components/ImportantInfo.tsx `businessRegHint`).
- **Finances restricted to admins only** in a business space (vs. all adults in a family space) — closing a leak where every employee could otherwise see company bank/insurance details. VERIFIED (firestore.rules).
- **Business milestone notes**: a founding-anniversary writer that is explicitly instructed to never use marketing language ("thriving", "soaring", "unstoppable") and never give business/financial/tax/legal advice or make predictions. VERIFIED (server.js `BUSINESS_MILESTONE_SYSTEM`).
- **Export pack includes an "employment" topic (CV/work history) that only exists for business spaces.** VERIFIED (src/utils/exportPack.ts `PackTopic` comment: "business spaces only").

---

## 7. What it deliberately does NOT do (trust assets)

- **Never interprets a document.** The reader quotes verbatim, never paraphrases, summarises, or states a legal conclusion about what a lease/contract says — because interpreting a document for someone is regulated advice in at least one jurisdiction the app operates in (Austria, GewO §137). Reasoning is explicit in-code (src/utils/openElsewhere.ts, DocumentAskModal.tsx).
- **Never states a document doesn't cover something.** A negative ("your lease doesn't mention X") is treated as the single most damaging sentence the reader could produce, because it's indistinguishable from an extraction failure, a blank field, or a bad scan — so the app always says only what it found, never what's absent.
- **No death trigger anywhere in the will/estate release mechanism** (§4) — access changes hands only through explicit action (self-release, or a 7-day unopposed request) while the account holder is alive to see and stop it.
- **Never gives legal, financial, tax, or funeral advice**, anywhere the topic comes up — the estate conversation, the professional-directory contact cards, the business milestone writer, the insurance-reading tool.
- **Never invents a name meaning, a name-day match, a body measurement from a photo, or a founding-fact** — a fixed "if uncertain, leave it out" rule appears near-verbatim across multiple separate system prompts in server.js.
- **Never renames or "Westernises" a name** when matching it to a name-day calendar (won't turn Ganga into "Gangolf" to force a match), and never assumes someone's religion or faith practice from their name's linguistic origin — it offers a connection for the family to confirm, never asserts one as fact.
- **Never estimates height/weight from a photo's visual proportions** — a size/growth reading with no readable printed number and no calibrated scale must come back null/unknown/low-confidence, not guessed.
- **Never writes or embellishes a person's "in case something happens to me" letter** — records it verbatim, exactly as dictated, or not at all.
- **Never lets a scanned document's own text act as an instruction to the assistant** — printed or handwritten content on a scan is data, never a command, even if it reads like one.

---

## 8. Honest gaps (do not promise these on the site)

- **No billing/checkout exists yet.** The "paid" plan tier is defined in code (2,000 AI actions/month) but there is no way to actually buy it. Current live model is free + a 90-day trial.
- **CSP is report-only**, not yet enforcing (§4) — a real, current gap.
- **No licence yet.** Per README: "None yet — all rights reserved. The code is public to read; it is not yet offered under any licence to reuse." Don't imply open-source.
- **No employee-directory equivalent in a business space** — deliberately hidden rather than shipped half-safe (see §6); don't market a "team directory" for business spaces yet.
- **No custom domain purchased** (teluva.app / teluva.at not yet bought, per project log 2026-08-29) — the only live URL is the Cloud Run one.
- **Two pre-existing estate invitees still hold full will read from before the named-reader model shipped** — a known, accepted carryover, not a bug being marketed either way.
- **Connected-household successors cannot yet "ring the doorbell"** (request access across a linked-family boundary) — a named open item, not shipped.
- **No German translation pass done yet** on the newer will/estate UI, despite German-speaking users being the primary household this was built against.
- **Activity trail is explicitly not an audit log** (§4) — never call it one; a modified client can omit entries, though it can't forge or edit them.
- **No native iOS/Android app** — this is a PWA (installable, offline-capable), not an App Store / Play Store product. Confirmed by the absence of any Capacitor/Xcode/Android project in the repo.
