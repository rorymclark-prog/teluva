# Teluva marketing screenshots — index

Captured from the live app at `https://teluva-1000796646145.europe-west2.run.app` using its
built-in demo modes (`?demo=1` for the family space, `?demo=business` for the business space).
No login, no real user data — every name below (Mama/Papa/Mia/Ben, Katharina Moser, Tomas
Lindqvist, Amina Yusuf, Peter Brandstätter, Donaupflege GmbH) is the app's own fictional demo
data. Each was checked for real PII before saving; none was found.

Every screenshot is a real, unedited viewport capture of the running app (Playwright, `scale:
"css"`), not a mockup.

## Captured (5 of 9 targets, 10 files)

### `home-1280.png` / `home-375.png`
Family Pulse (dashboard) home. "Three things matter" hero, family avatar strip, travel status
("Mia is in Lisbon"), and the short review of upcoming items. Content-rich, clean, on-brand.
**Good to use** — this is the strongest shot in the set at both sizes.

### `member-1280.png` / `member-375.png`
Mama's profile, People → Life → Sizes tab: shirt/shoe/pant size and a "Clothing & fit values"
panel with EU-standard conversion and a "Measure from photo" action. Real, specific, slightly
unexpected content (a good "everything you love, kept together" example).
**Good to use.** Note: I chose the Life/Sizes tab deliberately — the default Essentials/Overview
tab and the ID & Passports/Documents tabs are empty in the demo (see below), so Life is the
richest tab actually available for a member profile.

### `medical-1280.png` / `medical-375.png`
Ben's full Health Timeline modal (People → Ben → Health → "View full health timeline"): current
height/weight, a growth trend (+4.0cm), an upcoming Pediatrician appointment, and a dated growth
history. **Good to use**, with one caveat: it shows growth and appointment data, not
vaccinations — the demo has no vaccination or referral records for any family member (checked
Mama, Papa, Mia, Ben — all say "No vaccinations recorded" / "Nothing filed yet"). If the
marketing claim is specifically about vaccination tracking, this shot doesn't prove that; it
proves growth + appointment tracking instead.

### `calendar-1280.png` / `calendar-375.png`
Plan → Calendar, September 2026 month grid with event-type dots (School/Travel/Appointment/
Milestone/etc. legend visible) and the agenda panel open on 4 Sept showing "Mia's school play"
with time, tag, and alert status. **Good to use** — a real month grid with a real event beats an
empty calendar by a wide margin.

### `business-team-1280.png` / `business-team-375.png`
Business demo ("Donaupflege GmbH", a fictional Austrian care agency), Team → Team profiles: a
5-person roster (Katharina Moser · Owner, Tomas Lindqvist · Manager, Amina Yusuf · Employee,
Peter Brandstätter · Employee, Ruth Ferreira · Contractor) with the Katharina Moser profile card
open (role, age, DOB, tabs for Essentials/Health/Life). **Good to use** — this is the one shot
that shows the business/B2B side working, not just the family side.

## Not captured (4 of 9 targets)

These aren't missing because I ran out of time — I checked every route and every fallback for
each, and in every case the app **deliberately** keeps the content empty or gated. That's a
consistent, intentional design choice (the app says as much directly on screen in two places),
not a bug, but it does mean the demo cannot currently produce these marketing shots without
either the app team adding safe placeholder demo data or someone screenshotting a signed-in
account instead.

- **`documents`** — Vault → Documents shows, verbatim: *"The document vault stays out of the
  public demo. Sign in with Google to use this space with your own family. Teluva won't invent
  example records for sensitive information."* Same result on every member's People →
  Essentials → Documents tab ("No documents stored yet") and ID & Passports tab ("Only signed-in
  members... can see this"). House → Vehicles/Household are likewise empty (0 utilities, 0 jobs,
  no address, no vehicles). This is a genuinely good privacy property of the product; it just
  means there is no filed-documents-with-category-chips shot available from the demo as it
  stands today.

- **`assistant`** — Clicking "Ask Teluva" opens a panel that immediately asks for
  **"Sign in with Google"** before any chat is possible ("Sign in to chat with your family
  assistant — ask questions, scan documents, and update details by voice."). There is no
  no-login preview or canned exchange to screenshot in either demo space.

- **`wills`** — There is no Wills & Estate route reachable from the family demo at all. I
  checked the full in-app "Sections" search (the same picker used to jump to Calendar, Info,
  Drive, Slips, etc.) — searching "will" and "estate" both return **"Nothing called
  'estate'."** The feature exists in the product (per engineering notes) but is not exposed in
  the public demo route, so it isn't a case of empty data, it's genuinely unreachable from here.

- **`business-compliance`** — Team → Compliance is structurally present (Milestone / Advisers &
  Professionals / Vendors / Key numbers / Contacts) but every single card is empty: "No founding
  date set yet," "No professional contacts yet," "No vendors yet," "No numbers yet — Firmenbuch-
  nummer, UID (VAT) number, Sozialversicherung employer number...," "No contacts yet." Same
  privacy-by-design pattern as the family Vault.

## Bugs / rough edges noticed along the way (not requested, but worth flagging)

- On first load in a fresh browser context, a "Quick Tour" modal blocks the whole Pulse screen
  and must be dismissed ("Skip the tour") before anything is usable/screenshottable — worth
  knowing if anyone else scripts this demo.
- The People → profile Health tab shows an **empty Emergency essentials panel** (blank blood
  group, allergies, medications, etc.) for every family member, including Ben whose Pediatrician
  appointment is a live upcoming item elsewhere on the same page — slightly odd that the
  emergency-relevant fields are the ones left blank next to a real, dated medical appointment.
- The in-app Sections search (`Search sections`) didn't filter the list in response to a plain
  `input` event dispatch — it only visibly updated when the value was set via the native
  `HTMLInputElement` value setter. Not necessarily a real bug (React controlled-input quirk that
  a real user's keystrokes wouldn't hit), flagging in case it's a hint of the same class of issue
  elsewhere.

## Process note

The Playwright browser used to capture these runs as a **shared, already-open desktop Chrome**
with several other tabs open (other Teluva builds, an unrelated "Assistenze Care" app, a
portfolio site) — and at least twice during this session, the active tab was silently navigated
away to one of those other sites by what looks like a different concurrent process, mid-task.
I recovered by always opening and pinning a dedicated new tab for this work and re-verifying
`location.href` before every screenshot; none of the saved files above were taken while
hijacked. Worth knowing if this happens again — it's an environment/concurrency issue, not
something wrong with Teluva itself.
