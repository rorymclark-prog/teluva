# Family Hub — Pre-Publish Punch List

## 1. LAUNCH BLOCKERS (fix before any public user)

Ordered by (user harm × likelihood). Items 1–4 are one connected auth/tenancy fix — do them as a single work package.

### 1.1 Any signed-in stranger can make themselves ADMIN of any family — CRITICAL, live now
`firestore.rules:59-63` — `match /roles/{uid} { allow create: if signedIn() && request.auth.uid == uid; }` constrains neither family nor role value. One `setDoc(doc(db,'families',TARGET,'roles',myUid), {role:'admin'})` via the client SDK unlocks family_members (medical, passports, national IDs), reference (door codes, wifi, IBANs), and the admin-only passwords collection (`firestore.rules:111-113`). The server-side `/api/join-family` is bypassable — rules are the only gate.
**Fix:** `allow create: if false` for roles; all joins go through the server with an admin-issued, signed, single-use, expiring invite token written by the Admin SDK. Never let the caller choose their own role.

### 1.2 The real family's data is joinable TODAY via the guessable `household` id — CRITICAL
Production family id is the literal string `household` (`src/contexts/FamilyContext.tsx:120`, `src/utils/db.ts:14`). Two open doors: (a) the roles hole above; (b) `/api/join-family` (`server.js:257-295`) checks only a Firebase token — no allowlist, no invite, no `email_verified` check — and writes any Google account in as member of any existing family. Children's medical and identity records are exposed to any stranger who tries the obvious id.
**Fix:** migrate the household to a UUID (createFamily already does this, `db.ts:349`), delete/lock the `household` doc, and add the invite-token + `email_verified` requirement to `/api/join-family`.

### 1.3 users/{uid} self-write lets clients spoof their own role/familyId — HIGH
`firestore.rules:37-38` allows writing any field to your own profile; `FamilyContext.tsx:103-112` derives `isAdmin`/`canWrite`/active FAMILY_ID from it, flipping every client-side gate. Combined with 1.1 it completes cross-family admin escalation.
**Fix:** restrict update to non-privileged keys via `affectedKeys().hasOnly([...])`; `familyId`/`role` written only by the server join/create flow. Treat client `isAdmin` as UX only.

### 1.4 Storage rules: 3 hardcoded emails, familyId wildcard ignored — HIGH, hard publish blocker
`storage.rules:6-19` — the three seeded accounts can read/write every family's passport/medical scans; every real family's Document Vault fails closed. Note: cross-service rules can now read Firestore (`firestore.get()`), so you can mirror the roles model directly — simpler than custom claims. Also: `getDownloadURL()` tokens (`db.ts:290`) are long-lived public links; prefer short-lived signed URLs for passport/medical scans. Add size/content-type limits on write.

### 1.5 Cross-family localStorage leak: previous family's data auto-uploads into a new family's vault — HIGH
localStorage keys are global (`db.ts:6-8`); the migrate-local-up path (`db.ts:77-86, 155-163`) writes cached Family A data into Family B's fresh Firestore vault on a shared browser — a cross-tenant breach of medical/passport data with a permanent cloud write. Logout (`lib/firebase.ts:88-90`) clears nothing.
**Fix:** namespace every key by familyId, clear app localStorage on sign-out/family switch, guard migrate-up to same-family caches only.

### 1.6 Plaintext passwords, medical records, and base64 photos sent to Gemini on every AI call; 120KB slice silently corrupts context — HIGH (merges 3 findings)
- `slimMembers` (`AIChatbot.tsx:53-63`) keeps `digitalAccounts.passwordPlain` (`SecureSecrets.tsx:117`), `financialAccounts`, `identifiers` (SSN), and base64 `favorites[].imageUrl` (`MemberFavorites.tsx:134,156`).
- `buildContext` (`AIChatbot.tsx:165-173`) ships household doorCode/wifiPassword + finances on every message.
- `FamilyCalendar.tsx:301` sends the RAW members prop (avatars, `documents[].fileData`, passwords) — no slimming at all; also hardcodes `memberIds: []` at :316-330, discarding tags.
- `server.js:116` does `JSON.stringify(context).slice(0,120000)` — a few photo favorites truncate mid-base64 and Gemini silently loses most of the family.
**Fix:** strip passwordPlain/financialAccounts/identifiers/doorCode/wifiPassword/favorite images from all AI context (calendar scan needs only `{id,name,nickname}`); reject/log near-limit contexts instead of slicing.

### 1.7 False offline promise = silent data loss — HIGH
"Saved on this device — cloud sync unavailable" (`Dashboard.tsx:1099-1103` + 7 other components) implies later sync; no retry queue exists and every successful load overwrites the local cache (`db.ts:73,151,211,258`), discarding the edit. Whole-array last-writer-wins saves (`db.ts:39,119,237`) also let two family members clobber each other.
**Fix:** enable Firestore offline persistence + per-item writes, or change the copy to "Change NOT saved — retry" with a retry button and stop overwriting an unsynced cache.

### 1.8 Applying an AI edit can wipe other devices' calendar events/members from the index — HIGH
`handleApplyAiEdits` merges into members/events state loaded once at sign-in (`Dashboard.tsx:427,438` vs load at :247-256), then rewrites the metadata ids arrays wholesale (`db.ts:39,119`) — events Mama added on her phone vanish everywhere. Every other section correctly re-loads first (`Dashboard.tsx:433,444,449,454,459`).
**Fix:** re-load members/events from Firestore immediately before applying (mirror the other sections); durable fix is `arrayUnion` on ids / onSnapshot.

### 1.9 AI endpoints 403 for every real family — HIGH functional blocker
`server.js:13-15` allowlists 3 emails; `/api/chat` (:104) and `/api/scan-asset` (:201) reject everyone else — the entire AI pipeline (the product's differentiator) is dead for any new family.
**Fix:** replace with a family-membership check from the verified uid (roles doc / custom claims), same pattern already used in `/api/join-family`.

### 1.10 One AI timeline edit white-screens the Timeline for the whole family — HIGH
No type enum in the prompt (`server.js:79`), no clamp in `applyTimelineEdits` (`aiApply.ts:218-223`), and `TYPE_COLORS[entry.type].bg` (`TimelineView.tsx:154,170`) throws on anything off-list ("Anniversary", any translated value). No ErrorBoundary in src/, entry persists in Firestore, no in-app recovery.
**Fix:** defensive lookup `?? TYPE_COLORS.Other` at both call sites + clamp like calendar (`aiApply.ts:161`). Add a top-level ErrorBoundary while you're there.

### 1.11 Unconfirmed destructive actions — data-loss
Backup Import replaces ALL family data with zero confirmation (`Dashboard.tsx:576-624`). One-tap permanent deletes with no confirm: calendar events (`FamilyCalendar.tsx:484-488`), member documents incl. birth-certificate scans (`MemberDocuments.tsx:664-671`), household utilities/vehicles/pets (`HouseholdView.tsx:215,321,438`). DocumentVault and Assets DO confirm — copy that pattern (or the Remove/Keep inline confirm, `Dashboard.tsx:348-371`).

### 1.12 Legal minimum (not in audit, mandatory for EU publish)
You're in Austria, storing children's medical + identity data of EU users on Google infra: privacy policy + terms page, GDPR lawful-basis statement, cookie/consent posture, and a plain-language note that AI features send data to Google's Gemini API (this is also the honest-copy fix for the "secure sandbox" strings). Without 1.6 fixed, that disclosure would be alarming — another reason 1.6 is a blocker.

---

## 2. LAUNCH-WEEK POLISH (embarrassing, not dangerous)

1. **Touch users can't edit assets or delete shopping items** — `opacity-0 group-hover:opacity-100` under Tailwind v4 = never visible on touch (`Assets.tsx:358-365`, `ShoppingList.tsx:124-129,147-152`; same pattern in FamilyPasswords, MemberFavorites). Borderline blocker for a mobile-first family app; make controls always visible. Also label the icon-only header Export/Import/Sign-out (`Dashboard.tsx:771-780`).
2. **Family chat is broken on three axes** — channels unreachable on mobile (`hidden md:flex`, `FamilyChat.tsx:193`), sends fail silently (:123-138), infinite spinner on snapshot error (:103-105), and anyone incl. children can impersonate any member via "Posting as" (:168-187). Also: no Firestore rule exists for `messages` (falls to deny-all, `firestore.rules:7-9`) — chat may be dead against deployed rules; add membership-scoped rules for `messages` and `sharedDriveDocs` (GoogleDriveSync.tsx) and verify deployed rules match the repo.
3. **"Applied" shown when nothing was saved** — unresolvable member/field edits silently `continue` (`aiApply.ts:124,128`), card persists `applied=true` (`AIChatbot.tsx:340-346`). Return `{next, skipped[]}` and surface "Couldn't apply: …". Tighten `resolveMember` substring fallback ('Sam' → 'Samantha', `aiApply.ts:107`).
4. **Retry after partial Apply duplicates data** — state mutated before save (`Dashboard.tsx:428,439`, throw at :497-499); second Apply duplicates members/passports/contacts/events. Apply to a copy, setState after save, track per-section success, dedupe passports by number.
5. **Fake-feature copy** — "Digital reminders dispatched to all tagged family members!" with no notification system (`FamilyCalendar.tsx:473-476`); "synced atomically across shared databases securely" (`FamilyChat.tsx:221-223`); "secure index sandbox" (`EditMemberModal.tsx:391`). Rewrite honestly before a single reviewer sees them.
6. **Child role sees full edit UI everywhere** — zero role checks in MemberMedical/IDs/Sizing/Documents/SecureSecrets/HouseholdView/ShoppingList/DocumentVault; failed writes show the misleading saved-locally toast. Thread `canWrite` through every surface; gate the Secrets tab like FamilyPasswords; render the assistant read-only for children and drop finances from their chat context (`Dashboard.tsx:726,1070-1072`; `AIChatbot.tsx:165-171`).
7. **Rate-limit the AI endpoints** — no per-user limit, 25MB bodies (`server.js:29`), 3x retry amplification (:149). express-rate-limit keyed on uid + daily cap + lower body limit; consider a per-family monthly Gemini budget.
8. **AI writes fields no screen shows / that saves destroy** — dress/jacket/ring sizes invisible and wiped by MemberSizing's wholesale replace (`MemberSizing.tsx:63-73,96-100`, `Dashboard.tsx:409-411` — use GrowthTracker's merge pattern, `GrowthTracker.tsx:43`); `garageCode` written but never rendered (`HouseholdView.tsx:81-116`). Either render the fields or remove them from the prompt/AiEdit union.
9. **AI filing gaps** — clamp document categories in fileScans like calendar/assets do (`AIChatbot.tsx:324`); resolve vault `memberId` from sibling edits (:319-327); map the two incompatible category enums (member.documents vs VaultDocument, `types.ts:29-39` vs :309-322) before unifying on the vault.
10. **Calendar tags drop nicknames** — use `resolveMember` in `applyCalendarEdits` (`aiApply.ts:164-166`).
11. **Small AI fit-and-finish** — dedupe `new_member` against existing names (`aiApply.ts:114-118`); keep scanned size/color in asset notes (`Assets.tsx:110-121`).

---

## 3. POST-LAUNCH ROADMAP (value ÷ effort)

| # | Feature | Effort | Why now |
|---|---|---|---|
| 1 | **Full-family ZIP+JSON export + printable emergency-dossier PDF** | Small | Kills the lock-in objection for a brand-new vault app; extends the existing Emergency view; data already structured. Trustworthy has it on every plan. |
| 2 | **Sign in with Apple + email/magic-link** | Small | Google-only blocks grandparents and iOS households; Apple sign-in is mandatory if a native wrapper ever ships. Firebase config + UI. |
| 3 | **Multiple named shopping lists + category grouping** | Small | Single flat list looks like a demo next to AnyList; AI auto-categorization is a cheap differentiating twist. |
| 4 | **Invite + onboarding flow** (link/email invite with role pre-assigned, guided first-run, teaching empty states) | Medium | The invite-token infrastructure is ALREADY required by blocker 1.1/1.2 — build the polished UX on top of the security fix. Retention dies if the spouse can't join in under a minute. |
| 5 | **Push notifications + reminder delivery** (FCM web push, daily email digest) | Medium | #1 competitor gap; makes expiry warnings, calendar reminders, and chat real — and makes the "reminders dispatched" copy true. |
| 6 | **Recurring calendar events** | Medium | "Soccer every Tuesday" is the first real event any family adds; birthdays already imply the model. |
| 7 | **iCal export URL per family, then Google Calendar import** | Medium | Complements rather than competes with the calendar families already live in; read-only feed is cheap. |
| 8 | **PWA installability + offline-cached emergency card** | Medium | Emergency info that needs network+login fails exactly when needed; home-screen icon without app-store cost. |
| 9 | **Expiring secure share links** (single doc / emergency card to school, babysitter, accountant) | Medium | Replicates Trustworthy's trademarked flagship at low cost via signed Storage URLs; every shared link is marketing. |
| 10 | **Assignable to-dos/chores** (points optional later) | Medium | Daily-active engine; finally gives the child role something to do. |
| 11 | **Security trust package**: vault re-lock (re-auth/passcode before passwords & ID docs), 2FA, plain-language security page | Large | Prerequisite for the marketing pitch to land; the security page can ship launch-week, client-side vault encryption is the stretch goal. |
| 12 | **Capacitor app-store wrapper** | Large | Primary discovery channel + legitimacy for an app holding passports; also unlocks reliable iOS push. After PWA is solid. |
| 13 | **Meal planning** | Deferred | Different job-to-be-done. Cover the checkbox via the AI chatbot generating a week's meals into the shopping list. |

---

## 4. POSITIONING

**Pricing:** Freemium + one per-family (not per-seat) subscription at **€59/yr (~$60–65)**. Free tier: 1 family, capped AI scans (e.g. 10/mo), capped storage. Rationale: the market splits into coordination apps ($0–80/yr: Cozi Gold $39, Cozi Max $80, FamilyWall ~$60) and vault apps ($120–480/yr: Trustworthy Silver $120 / Gold $240 — which paywalls exactly your AI scan-and-file + ask-your-documents features at $240). €59 sits just above Cozi, 4x under Trustworthy Gold, and covers real Gemini per-use cost — which is also why one-off pricing is not viable. Pair the paid tier with a per-family AI budget guard (see polish item 7).

**One-line pitch:**
> **"The family vault that fills itself — photograph a passport, insurance letter, or school form and the AI files it to the right person, tracks the expiry, and answers questions about it. In 9 languages."**

The 9-language angle is a genuine wedge: multilingual, immigrant, and expat families (your own household is the proof case) are ignored by the US-centric incumbents. Lead marketing with a 30-second scan-to-structured-data demo video. Hard dependency: the pitch asks families to trust you with passports and passwords, so the trust package — security page, export, vault re-lock, and every item in Section 1 — must land first; the pitch is only credible after the blockers are closed.