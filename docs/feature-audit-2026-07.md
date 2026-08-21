# Family Vault — Feature Audit: "What we have vs. what SHOULD be there"

_2026-07 · Positioning: "the vault that fills itself" · EU/Austria (Vienna), multilingual (incl. German)_
_Primary user: parents managing the whole family. Secondary: teenage children who need to **access and show** their own info out and about._

---

## 1. What the app already covers well

Family Vault is a genuinely broad, well-structured personal-records vault. The bones are strong:

- **Two-level model that fits real families.** Family-wide views (Profiles, Emergency, Calendar, Important Info, Household, Finances, Timeline, Document Vault, Assets, Shopping, Passwords, Chat, Drive Sync) sit above per-member profile tabs (Overview, Medical, ID & Passports, Sizes, Wishlist, Growth, Travel, Likes, Documents, Secrets). Each member can have their own address, phone, email — correctly modelling multi-household reality.
- **Deep identity + document coverage, Austria-aware.** Multiple passports, e-Card number, SV-Nummer, tax number, residence permit, driver's licence, national IDs (incl. SA), citizenship certificate. This is already more locale-aware than most competitors.
- **Rich medical record.** Blood group, allergies (surfaced as a safety flag), medications, chronic conditions, vaccinations, surgeries, emergency medication, organ-donor flag, family history.
- **Smart, derived surfaces already exist.** `MemberOverview` auto-generates a per-member summary with stat tiles and a passport-expiry banner; `NeedsAttention` (`computeNudges`) already derives per-member nudges (passport expiry, missing scan, growth "measure again," birthday). **This is the single most important asset for the owner's asks** — the pattern to extend is already built and proven.
- **"Fills itself" AI intake, multilingual shell, privacy-conscious.** Photograph-to-file AI categorisation, German + other languages, read-only `?demo=1` mode, legal modal, and an Overview that deliberately hides sensitive medical behind a lock note.

**The honest gap:** the vault is excellent at storing **static, one-off** facts and **poor at anything that recurs, expires-and-recurs, or is due in the future.** Every one of the owner's three asks lives in exactly that blind spot.

---

## 2. Top gaps, grouped and prioritised

### MUST-HAVE FOR LAUNCH

| Gap | One-line build sketch | Effort |
|---|---|---|
| **CareSchedule recall model** | New per-member record: care type + interval (6/12mo) + `lastVisit` + optional booked `nextAppointment`; app derives "next due." The missing backbone — `CalendarEvent` is strictly one-off today, so "dentist every 6 months" is un-modellable. | **M** |
| **Per-profile "Next up" surfacing** | Add a "Next appointment / Due soon" row to `MemberOverview` + landing, and care-driven entries to `NeedsAttention`. Parents' view aggregates children's items; a teen sees only their own. | **S** |
| **Transit-pass / Jahreskarte home** | `transitPasses[]` on `TravelInfo`: passType (Jahreskarte/KlimaTicket/Semesterticket/Vorteilscard), operator (Wiener Linien/VOR/ÖBB), `cardNumber`, validFrom/validUntil, zone, price, autoRenew, scan. No home exists today. | **M** |
| **Quick-show full-screen card view** | Tap-to-present overlay: card scan big, number in large type, holder + valid-until, forced max brightness. One–two taps from Overview/Travel. Serves the teen "show my docs" use case. Reuses existing base64 scans. | **M** |
| **Expiry-nudge coverage beyond passports** | Extend `computeNudges` to scan `validUntil`/`expiryDate` across transit passes, travel insurance, visas, residence permit, driver's licence, EHIC/e-card. Warn ~60d, urgent when expired. Machinery already exists — only wired to passports. | **S** |

### HIGH-VALUE NEXT

| Gap | One-line build sketch | Effort |
|---|---|---|
| **Per-profile "coming up" feed on landing/calendar** | Derived read-only list per member merging manual `CalendarEvent`s with auto-derived expiries + next yearly check-up; needs a light `renewalIntervalMonths`/annual flag. Parents see kids folded in. | M |
| **Vaccination due-dates (Austrian Impfplan-aware)** | Add `nextDoseDue` + reminder to vaccinations; ship one static Austrian Impfplan child template (6-in-1, MMR, HPV, tetanus booster). Adds the forward-looking half of the list that already exists. | M |
| **Repeat-prescription / refill reminders** | Upgrade `medications` from free-text to structured entries (name, dose, doctor, run-out/refill interval, pharmacy) + "inhaler refill due in 5 days." Keep free-text notes. | S |
| **Loyalty / membership-card store** | Generic card list (library/Büchereien Wien, gym, museum Jahreskarte, club): name, number, barcode/photo, optional validUntil. Same quick-show + nudge treatment. Distinct from transit (no zone/operator). | M |
| **EHIC / European e-card surfacing** | Add `ehicNumber` + `ehicExpiry` (back of the Austrian e-card) beside `eCard`; feeds travel-health quick-show + expiry nudge. | S |

### LATER

| Gap | One-line build sketch | Effort |
|---|---|---|
| **Open-referral → booking tracker** | "Pending" state for GP-issued specialist referrals not yet booked; nudge "Book Leo's dermatology referral" until a `nextAppointment` is filled. Cheap once CareSchedule lands. | S |

---

## 3. Explicit answers to the owner's three asks

### Ask 1 — Per-profile calendar reminders (next dentist, yearly check-up; parent sees child)
**Buildable, but not with today's data model.** `CalendarEvent` is strictly one-off (`date`, no recurrence) — "the dentist every 6 months" and "yearly medical check-up" literally cannot be represented. The fix is a **CareSchedule recall model** (must-have) that derives "next due" from `lastVisit + interval`, plus a **per-profile "coming up" feed** that merges those derived items with manual events and expiries. The aggregation logic the owner wants — **parents see their children's items, a teen sees only their own** — drops out naturally: `CalendarEvent` already carries `memberIds`, and `NeedsAttention`/`MemberOverview` already derive per-member nudges. This is an **extension of an existing, proven pattern**, not new territory.

### Ask 2 — A Jahreskarte / travel-pass home
**Real gap, no home today** — the Travel tab covers only flights, visas, insurance, ETIAS. Add a **`transitPasses[]` record** (Jahreskarte/KlimaTicket/Semesterticket/ÖBB Vorteilscard, operator, `cardNumber`, valid dates, zone, autoRenew, scan) rendered in the Travel tab and exposed as an AI-fileable category so it "fills itself" from a photo. Wire its `validUntil` into the expanded expiry nudges so an annual pass never lapses silently. Loyalty/membership cards get a sibling store rather than bloating this one.

### Ask 3 — Teen self-service / "show my docs"
**Served by the quick-show full-screen card view** (must-have): a tap-to-present overlay that fills the screen with one saved card — scan, number in large type, holder, valid-until — reachable in one–two taps from the teen's own Overview/Travel tab, with forced max brightness. Pure presentation over existing base64 scans; no new storage. **Critical honesty constraint:** render the stored number as a plain barcode/QR **for human/number lookup only** — do **not** fabricate a machine-valid fare barcode. Wiener Linien annual passes validate on the registered card, so a regenerated scan barcode would be misleading and could get a teen wrongly flagged as fare-dodging.

---

## 4. Avoid — scope creep

- **Appointment BOOKING integration** (clinic scheduling APIs, ELGA/national-EHR two-way sync). Heavy, regulated, outside a self-contained vault. Store + remind is the job, not book.
- **Medication ADHERENCE clock** ("did you take your pill?" pings). That's a different app. Track refills and records, not dosing behaviour.
- **Symptom / mood / illness diary or visit-note journaling.** Turns the vault into a health-tracker. Keep to static records + scheduling.
- **Insurance-claim / reimbursement / medical-billing tracking.** Finance-adjacent, unrelated to "what's due per profile."
- **Growth-percentile clinical diagnostics** beyond the existing height/weight time-series.
- **Global vaccination-schedule engine.** Ship the one Austrian Impfplan template (stated locale); every country's programme is over-scoped for v1.
- **Fabricated machine-valid fare/transit barcodes** (see Ask 3). Present stored numbers honestly for lookup only.
