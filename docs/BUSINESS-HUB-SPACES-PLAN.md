# Business Hub / Multi-Space Architecture — build plan

**Status:** design → implementation (security-gated). Written 2026-07-20.

## The idea (settled)
The app is a **life-admin vault**, not a family app. Generalise "one family per user" into
**Spaces** a user can toggle between: a personal space, a family space, and one or more
business spaces. "Family Vault" becomes one *preset* on a neutral shell. Positioning:
*"every document you own, in your pocket — and it tells you before anything expires."*

Scope discipline (business v1): **documents + expiry reminders + people/employees + vehicles +
chat/AI + insurance/leases + bank/tax in the encrypted vault.** NO finances/payroll. **Bank cards
deferred** until a vault re-lock/2FA package.

## The good news: isolation is already multi-tenant-safe
The current model is far more ready than expected — the security boundary already supports a user
being in several tenants:

- **Firestore rules** gate every read/write on `isMemberOf(familyId)` = *does a
  `families/{familyId}/roles/{uid}` doc exist* (+ `roleIn`/`canWriteIn`). This is a **per-tenant**
  check — a user with roles docs in family A and business B can access both, and each stays isolated.
  Nothing in the rules assumes one family per user. ✅
- **Server** membership is a per-family `roles/{uid}` + `users/{uid}` doc, written only by the
  Admin SDK (`grantMembership`). ✅
- **Client** `db.ts` already routes all data through a single mutable `FAMILY_ID` set once by
  `FamilyProvider`. Switching space = set it to another tenant you belong to + reload. ✅

So we are **not** building multi-tenancy from scratch (dangerous). We are extending
single-membership → multi-membership on an existing, audited isolation boundary.

## The real gaps (what to build)
1. **Enumerate a user's spaces.** Today `users/{uid}.familyId` is one value. Add
   `users/{uid}.spaces: [{ id, name, type, role }]`, maintained by `grantMembership`. (Keep
   `familyId` as the "last active" pointer for back-compat.)
2. **Space type + presets.** Add `type: 'family' | 'business' | 'personal'` to
   `families/{id}/info/info`. The nav renders a preset per type (business hides kids'
   Sayings/Growth/Wishlist; surfaces Employees/Leases/Bank+Tax). Pure UI — no security impact.
3. **Active-space switcher (client).** A space picker in the header; on select, `setFamilyId(id)`
   + remount. Persist the choice locally.
4. **Server active-space validation.** Endpoints must act on the space the client says is active,
   AND verify the caller is a member of it. `requireMember` currently reads `users/{uid}.familyId`;
   change it to accept an `X-Space-Id` header (or body field) and validate
   `roles/{uid}` exists in that space before proceeding. **This is a security-critical change —
   never trust the header without the membership check.**
5. **Storage claim → array (the one tricky bit).** Storage rules gate on a single
   `token.familyId`. For multi-space Storage, move to a `familyIds: string[]` custom claim and
   change the Storage rule to `familyId in request.auth.token.familyIds`. This is a **coordinated**
   change (claim + rule + client token refresh + a transition fallback), so it ships as its own
   step with the legacy single-claim fallback kept until all tokens roll over.
6. **Create a business space.** Reuse the audited `/api/create-family` flow with a `type` param →
   `/api/create-space`. New space, caller becomes admin, added to their `spaces` list.

## Phased build (each phase independently shippable + reviewed)
- **P1 — Spaces model (no security change):** `users/{uid}.spaces`, space `type`, `grantMembership`
  writes the list; a read-only space list in the UI. Current single-family users: one space, zero
  behaviour change. *Safe.*
- **P2 — Switcher + server validation:** header-based active space + `requireMember` membership
  check + `db.ts` switch/reload. **← adversarial cross-tenant security review REQUIRED before prod.**
- **P3 — Storage claim array:** claim + Storage-rule migration with legacy fallback. **← security
  review REQUIRED.**
- **P4 — Business preset + create-space:** business nav preset, Employees surface (members with
  tax number / role / start date), Leases (Legal docs), Bank+Tax (secrets vault). `/api/create-space`.
- **P5 — Neutral shell / brand:** rename the master shell to the chosen neutral name; "Family" and
  "Business" become space types. (Depends on the naming research.)

## Non-negotiable process (why not a one-shot deploy)
The pre-publish audit previously found **critical cross-tenancy and privilege-escalation holes** in
this exact area. A cross-tenant leak of passports/medical/business data is the one unrecoverable
failure. Therefore: build P2/P3 on a branch, run an **adversarial cross-tenant isolation review**
(can a member of space A read/write space B? can the header be forged? does the Storage claim
over-grant?), and deploy only after it passes. This is the same discipline used for the insurance
reader and the consent gate.

## Employee data note (GDPR)
A business storing employee personal data makes the business owner a **data controller/processor**.
Fine for the owner dogfooding their own businesses immediately; before third parties use it, the
business space needs its own lightweight processing terms + retention setting (separate from the
family DPIA). Track under the launch legal gate.
