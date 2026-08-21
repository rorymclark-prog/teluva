# Family Vault — Persistence Audit (2026-07)

**Summary: 6 BROKEN · 4 RISKY · 13 OK.** Every Firestore/Storage write path in `src/` was
re-enumerated from `src/utils/db.ts`, `src/contexts/FamilyContext.tsx`,
`src/components/FamilyChat.tsx` and `src/components/GoogleDriveSync.tsx` and cross-checked against
`firestore.rules` + `storage.rules`. No write path is unaccounted for. The three `sharedDriveDocs`
writes (bulk sync / single sync / delete) share one rule and are collapsed to one row.

All 6 BROKEN paths share a single root cause: **the client tries to do membership/role/family
bootstrap that the rules deliberately reserve for the server Admin SDK.** Fix them together by
routing bootstrap + role changes through the existing `/api/create-family` · `/api/join-family` ·
`/api/refresh-claims` endpoints (plus a new admin-promote endpoint). The 7th is an independent
Storage-rule bug on delete.

---

## Verdict table

| # | Path | Verdict | Sev | One-line fix |
|---|------|---------|-----|--------------|
| 1 | `families/{fid}/roles/{uid}` — bootstrap `setDoc` @ FamilyContext.tsx:141 | **BROKEN** | critical | Never client-write `roles/{uid}`; create membership via server create/join endpoint, then read it back. |
| 2 | `families/{fid}/info/info` — bootstrap `setDoc` @ FamilyContext.tsx:145 | **BROKEN** | high | Don't "ensure" info from the client; the server that created the family already wrote it. |
| 3 | `users/{uid}` — bootstrap profile `setDoc` (create) @ FamilyContext.tsx:132 | **BROKEN** | high | Create the user profile server-side; `users` create is `if false`. |
| 4 | `families/{fid}/roles/{uid}` — FORCE_ADMIN self-promote @ FamilyContext.tsx:100 | **BROKEN** | high | Move admin promotion to a server endpoint; a non-admin can't self-grant admin. |
| 5 | `users/{uid}` — FORCE_ADMIN self-promote `{role}` @ FamilyContext.tsx:98 | **BROKEN** | high | Same server endpoint sets `users/{uid}.role`; self can't write `role`. |
| 6 | STORAGE `families/{fid}/documents/**` — **delete** @ db.ts:296 | **BROKEN** | high | Don't apply the 20 MiB size check on delete (`request.resource` is null → all deletes denied). |
| 7 | `families/{fid}/family_members/{id}` — base64 avatars inline @ db.ts:34 | RISKY | medium | Move `avatarUrl`/`avatarOriginalUrl` to Storage URLs; split the single all-members batch. |
| 8 | `families/{fid}/assets/{id}` — base64 `photoDataUrl` inline @ db.ts:487 | RISKY | high | Upload asset photo to Storage, store only the download URL (mirror the v46 scanned-ID fix). |
| 9 | STORAGE `families/{fid}/documents/**` — **upload** @ db.ts:289 | RISKY | medium | Force `getIdToken(true)` after join so the `familyId` claim exists before upload; retry on `storage/unauthorized`. |
| 10 | `users/{uid}` — `saveUserProfile(Partial<UserProfile>)` @ db.ts:334 | RISKY | low | Narrow param to `Pick<'displayName'\|'email'\|'chatHistory'>` so callers can't send `familyId`/`role`. |
| 11 | `families/{fid}/metadata/members` @ db.ts:39 | OK | low | None (rides the members batch — fixed once #7 is de-risked). |
| 12 | `families/{fid}/calendar_events/{id}` @ db.ts:115 | OK | low | None. |
| 13 | `families/{fid}/metadata/events` @ db.ts:119 | OK | low | None. |
| 14 | `families/{fid}/reference/info` @ db.ts:187 | OK | low | None. |
| 15 | `families/{fid}/reference/{household,finances,timeline,settings,documents,shopping}` @ db.ts:237 | OK | low | None (file bytes already go to Storage). |
| 16 | `families/{fid}/roles/{uid}` — admin `setFamilyMemberRole` @ db.ts:441 | OK | low | None; optional `hasOnly(['role'])` hardening. |
| 17 | `users/{targetUid}` — admin `setFamilyMemberRole` @ db.ts:442 | OK | low | None; keep the self-demotion guard. |
| 18 | `users/{uid}` — `saveChatHistory` @ db.ts:475 | OK | low | None (50-msg cap + base64 strip). |
| 19 | `families/{fid}/assets/{id}` — `deleteAsset` @ db.ts:496 | OK | low | None. |
| 20 | `families/{fid}/passwords/{id}` — `savePassword` @ db.ts:514 | OK | low | None; optional try/catch for symmetry. |
| 21 | `families/{fid}/passwords/{id}` — `deletePassword` @ db.ts:518 | OK | low | None; optional try/catch. |
| 22 | `families/{fid}/messages/{auto-id}` — `addDoc` @ FamilyChat.tsx:151 | OK | low | None. |
| 23 | `families/{fid}/sharedDriveDocs/{id}` — sync + delete @ GoogleDriveSync.tsx:232/259/289 | OK | low | None. |

---

## BROKEN paths (fix first)

### 1. `families/{familyId}/roles/{uid}` — bootstrap create (CRITICAL) — FamilyContext.tsx:141

**Offending rule**
```
match /roles/{uid} {
  allow read:   if isMemberOf(familyId);
  allow create: if false;
  allow update, delete: if isAdminOf(familyId);
}
```
**Why it denies.** For a brand-new bootstrap user the `roles/{uid}` doc does not exist, so
`setDoc(..., {merge:true})` is a **create** → `create: if false`, hard-denied. Even treated as an
update it needs `isAdminOf(familyId)`, which reads `roles/{uid}` — the very doc being created — so it
is false. This is the worst one because `roles/{uid}` is exactly the doc `isMemberOf()` reads: with
no persisted role doc, `isMemberOf` is false for **every** other collection, so the entire Firestore
layer is locked out and silently falls to localStorage.

**Failure scenario.** A known bootstrap email (rory/maria/tutu) signs in on a fresh device before any
server create/join ran. `PERMISSION_DENIED` on `roles/{uid}`; no membership doc exists, so all
subsequent family reads/writes are denied too. Data reads empty and edits persist only to that one
device's localStorage — invisible everywhere, lost on cache clear.

**Fix.** Do not write `roles/{uid}` from the client. Route bootstrap through the existing
`/api/create-family` · `/api/join-family` (Admin SDK) — exactly what the rule comment prescribes —
then read the roles doc back. Never `setDoc` it directly.

### 2. `families/{familyId}/info/info` — bootstrap create (HIGH) — FamilyContext.tsx:145

**Offending rule**
```
match /info/{doc} {
  allow read:  if signedIn();
  allow write: if isAdminOf(familyId);
}
```
**Why it denies.** `info/info` is writable **only** by an admin. FamilyContext:145 issues this
`setDoc` unconditionally for every `BOOTSTRAP_EMAILS` account — and that map includes
`familyclarktutu@gmail.com` as role **child**. For a child (or any non-admin `member`),
`isAdminOf('household')` is false → denied.

**Failure scenario.** The child bootstrap account (or any non-admin member) signs in. The `setDoc` on
`families/household/info/info` throws `permission-denied`, caught by the `FamilyProvider` try/catch
(FamilyContext.tsx:170) which fails safe to `familyId:null` — bouncing the account into onboarding /
localStorage instead of resolving membership.

**Fix.** Don't write `info/info` from the client bootstrap. Either guard it behind
`bootstrapRole === 'admin'`, or (preferred) let the server create/join endpoint own it — the server
that created the family already wrote this doc, so the client never needs to "ensure" it.

### 3. `users/{uid}` — bootstrap profile create (HIGH) — FamilyContext.tsx:132

**Offending rule**
```
match /users/{uid} {
  allow read:   if signedIn() && request.auth.uid == uid;
  allow update: if ... hasOnly(['displayName','email','chatHistory']);   // self
  allow update: if ... uid != request.auth.uid && isAdminOf(...) && hasOnly(['role']);  // admin
  allow create, delete: if false;
}
```
**Why it denies.** The bootstrap branch runs only when `userSnap.exists()` is false, so the no-merge
`setDoc(userRef, profile)` is a **create** → `create: if false`. Denied. The immediate in-memory
`setValue` masks the failure for the current session.

**Failure scenario.** New known-email user signs in; `setDoc(users/{uid}, {familyId,role,email,
displayName})` → `PERMISSION_DENIED`. Nothing persists, so on next load `userSnap.exists()` is false
again and the (also-denied) bootstrap re-runs forever. Profile lives only in localStorage; a second
device sees no profile and treats the user as brand-new.

**Fix.** Create the profile server-side (Admin SDK) via the create/join endpoint — the only sanctioned
writer per the rule comment. Remove the client `setDoc` create.

### 4. `families/{familyId}/roles/{uid}` — FORCE_ADMIN self-promote (HIGH) — FamilyContext.tsx:100

**Offending rule**
```
match /roles/{uid} { allow update, delete: if isAdminOf(familyId); allow create: if false; }
```
**Why it denies.** This branch fires precisely when `profile.role !== 'admin'` — i.e. the caller is
currently member/child. `update` needs `isAdminOf(familyId)`, which reads the caller's **current**
role and finds it is not admin. The write that would make them admin is gated on already being admin —
an unsatisfiable bootstrap. (If the roles doc doesn't exist, merge=create=`if false`, also denied.)

**Failure scenario.** An existing non-admin whose email is in `FORCE_ADMIN` logs in; self-promote of
`roles/{uid}` → `PERMISSION_DENIED`. Server-side role stays non-admin, so admin-gated collections
(`passwords/*`, role edits, `info` writes) stay denied on every device — the promotion never takes.

**Fix.** Perform the upgrade on the server (Admin SDK): a new `/api` endpoint that verifies the email
is authorised and sets `roles/{uid}.role='admin'` plus the custom claim. Client must not self-promote.

### 5. `users/{uid}` — FORCE_ADMIN self-promote `{role}` (HIGH) — FamilyContext.tsx:98

**Offending rule** — same `users/{uid}` block as #3.

**Why it denies.** This is a **self** update (`uid == request.auth.uid`) whose only affected key is
`role`. The self branch whitelists `hasOnly(['displayName','email','chatHistory'])` — `role` is not in
it. The admin branch requires `uid != request.auth.uid`. Neither matches → denied. By design: self
cannot edit its own role (privilege-escalation guard).

**Failure scenario.** Non-admin FORCE_ADMIN user logs in; `setDoc(users/{uid}, {role:'admin'}, merge)`
→ `PERMISSION_DENIED`. `users/{uid}.role` stays non-admin; only the in-memory session + localStorage
show admin, so a reload or second device silently reverts the promotion.

**Fix.** Same server endpoint as #4 sets `users/{uid}.role`. The client update path for `users/{uid}`
must stay within `hasOnly(['displayName','email','chatHistory'])`.

### 6. STORAGE `families/{familyId}/documents/**` — delete (HIGH) — db.ts:296 (`deleteVaultFile`)

**Offending rule**
```
match /families/{familyId}/{allPaths=**} {
  allow read:  if inFamily(familyId) || isLegacyHouseholdMember(familyId);
  allow write: if (inFamily(familyId) || isLegacyHouseholdMember(familyId))
    && request.resource.size < 20 * 1024 * 1024;
}
```
**Why it denies.** In Storage rules `deleteObject` is a *write*, but on a DELETE `request.resource` is
**null** — there is no incoming object. The rule ANDs in `request.resource.size < 20MiB`; `null.size`
is null and `null < number` is false, so the whole condition is false and **every delete is denied**,
for every member including admins and legacy household users. The size guard, meant only for uploads,
blocks all deletes.

**Failure scenario.** Any member clicks Delete in Document Vault. `deleteObject` throws
`storage/unauthorized`; `deleteVaultFile` swallows it (`metadata will still be removed`), so the
Firestore metadata is removed while the file bytes are orphaned in Storage permanently — silently
accumulating, never deletable.

**Fix.** Only size-check on create/update:
```
match /families/{familyId}/{allPaths=**} {
  allow read: if inFamily(familyId) || isLegacyHouseholdMember(familyId);
  allow create, update: if (inFamily(familyId) || isLegacyHouseholdMember(familyId))
    && request.resource.size < 20 * 1024 * 1024;
  allow delete: if inFamily(familyId) || isLegacyHouseholdMember(familyId);
}
```
(Equivalently, guard the size with `request.resource == null || request.resource.size < 20MiB`.)

---

## RISKY paths

### 7. `families/{fid}/family_members/{id}` — base64 avatars inline (medium) — db.ts:34

The rule **allows** the write (`canWriteIn` — any adult, no field/size constraint), so it is not
broken. It is fragile because the `FamilyMember` doc still embeds base64 image blobs inline:
`avatarUrl` and `avatarOriginalUrl` (the full-res "reset to photo" copy), plus `documents[].fileData`.
Scanned IDs were moved to Storage URLs (v46–v48); **avatars were not**. Firestore hard-caps a doc at
**1 MiB** and rules cannot see or relax that limit; a phone photo as base64 (avatar + original) easily
exceeds it and base64 inflates ~33%. Worse, `saveFamilyMembers` writes **all** members + the metadata
index in **one batch** (db.ts:29–41), so a single oversized member doc rejects the *entire* batch.

**Failure scenario.** An adult updates a member with a high-res photo (~1.5 MiB base64).
`batch.commit()` rejects → every member **and** the metadata id-list roll back. `cloudOk` stays false,
falls to localStorage only; the change survives on that device but never reaches Firestore — lost on
reload, invisible on other devices.

**Fix.** Do to avatars what v46 did to scanned IDs: upload bytes to Storage
(`families/{fid}/members/{id}/...`, already covered by `storage.rules`' 20 MiB cap) and store only the
`downloadURL` in `avatarUrl`/`avatarOriginalUrl`; compress/thumbnail first. Also stop coupling the
whole family into one batch — write each member independently (or chunk) so one bad doc can't sink the
index write. Guard `fileData` the same way.

### 8. `families/{fid}/assets/{id}` — base64 `photoDataUrl` inline (high) — db.ts:487 (`saveAsset`)

Same defect class as #7, never migrated. The rule allows any adult; but `AssetItem.photoDataUrl` is a
base64 data URL stored inline. A photographed asset/serial-plate/receipt is typically 2–5 MB (× ~1.33
base64), so it almost always exceeds the 1 MiB doc cap.

**Failure scenario.** Adult adds a bike/electronics asset with a serial-plate photo. `setDoc` rejects;
`saveAsset`'s try/catch swallows it, returns false, asset lands in localStorage only and never syncs.
Text-only assets save fine, so the failure is intermittent and confusing.

**Fix.** Upload the photo to `families/{fid}/assets/{id}/photo` (Storage rules already allow it) and
store only the download URL in `photoDataUrl`. Optionally reject/resize oversized data URLs before
`setDoc`.

### 9. STORAGE `families/{fid}/documents/**` — upload (medium) — db.ts:289 (`uploadVaultFile`)

Firestore membership is proven by the `roles/{uid}` doc (`isMemberOf`), but the Storage upload is
gated on the `familyId` **custom claim** (`inFamily`). The two can disagree: the claim is set only on
create/join and lazily backfilled, and a cached ID token is valid up to ~1 hour. A member fully
authorized in Firestore can be denied the upload because their token doesn't yet carry the claim.

**Failure scenario.** New member joins a non-`household` family and immediately uploads a file (or the
AI attaches a scan) before any AI call / token refresh. The Firestore metadata write succeeds but
`uploadBytes` is denied `storage/unauthorized`; the file silently fails while the Firestore doc points
at a byte-less path. Legacy `household` users are unaffected (`isLegacyHouseholdMember`).

**Fix.** After join (and on app load) force `getIdToken(true)` so the claim is present before any
Storage op; short-term, retry the upload once after `/api/refresh-claims` + `getIdToken(true)` on a
`storage/unauthorized` error.

### 10. `users/{uid}` — `saveUserProfile(Partial<UserProfile>)` (low, latent) — db.ts:334

The self-update rule permits only `displayName`/`email`/`chatHistory`, but `saveUserProfile` takes a
generic `Partial<UserProfile>` and `UserProfile` also has `familyId`/`role`. The signature invites a
future caller to pass those, which the rule denies. Currently **dead code** (no callers in `src/`), so
the risk is latent.

**Fix.** Narrow the param to `Pick<UserProfile,'displayName'|'email'|'chatHistory'>` (or strip
`familyId`/`role` before `setDoc`). `familyId`/`role` must only be written server-side.

---

## Manual save → reload test checklist

Run signed in on a **real device**, then confirm persistence by the cloud, not localStorage. The
reliable method for each: **make the change → hard-reload with cache cleared (or open the app on a
second device / different account in the same family) → confirm the change is still there.** If it
survives only on the original device, it went to localStorage and the cloud write was denied.

Keep DevTools → Console open and watch for `Error saving to Firestore` / `permission-denied`; keep
Network open to see the write actually hit Firestore.

- [ ] **Family members (avatars)** — Add a member and attach a **high-res phone photo**. Reload with
  cache cleared / check a second device. Photo + member present? (Catches #7 batch-size loss.) Also
  add a **text-only** member as a control — if text saves but the photo member vanishes, that's the
  1 MiB batch failure.
- [ ] **Assets (photo)** — Add an asset with a **serial-plate/receipt photo**, then a text-only asset.
  Reload / second device. Both present? (Catches #8.)
- [ ] **Calendar** — Add an event; reload / second device; still there.
- [ ] **Reference docs** — Edit Important Info, Household, Finances, Timeline, Settings, Shopping list.
  Reload / second device; each persists.
- [ ] **Document Vault — upload** — As a **newly-joined** member (non-household family), upload a file
  immediately after joining, before any AI chat. Reload; file downloads correctly. (Catches #9 claim
  lag — if it fails, retry after the app has made one AI call.)
- [ ] **Document Vault — delete** — Delete a vault file. Reload; confirm it's gone **and** verify the
  bytes are actually removed from Storage (Firebase console → Storage), not just the metadata.
  (Catches #6 — today the metadata disappears but the file is orphaned.)
- [ ] **Family chat** — Post a message; second device sees it.
- [ ] **Google Drive sync** — Sync a folder / single file, then remove one; reload; index matches.
- [ ] **Roles (admin)** — As an admin, change another member's role; that member's device reflects it
  after reload.
- [ ] **Passwords (admin)** — As admin, add and delete a password entry; reload; persists.
- [ ] **Bootstrap / fresh device (the big one)** — Sign in as `rorymclark@` (admin),
  `mariatutu.home@` (admin) **and** `familyclarktutu@` (child) on a **fresh browser profile** with no
  cached user doc. Each should resolve into the `household` family and **see existing family data**,
  not empty onboarding. If any lands in onboarding or shows an empty vault, the client bootstrap was
  denied (#1–#5) and that account is running on localStorage only. Confirm the child account in
  particular loads the family (that path hits the `info/info` denial #2).
