# Timeline correction — v359

The v357 browser check used the whole-family demo with all categories visible. It missed the interaction between a person scope and a category filter: the filtered records were also being used to calculate the life span. The new timeline receives the person-scoped history separately from the filtered display records.

## Automated regression coverage

`npm test` includes 130 utility/component suites and the server tests. `timelineRegressions.test.ts` specifically covers:

- Adult, child and whole-family scopes across Medical, Milestone, School and Home filters, at five chapter densities.
- Every matching record remaining reachable after grouping.
- Medical records staying near the end of a birth-to-present axis when the birth card is filtered away.
- Legacy Google shopping/pickup imports excluded from health projections without changing the calendar source.
- New Google imports classified by medical context, explicit native appointment categories retained, and explicitly confirmed categories respected.
- Medical context in descriptions, English/German clinical titles, and doctor names.
- A dense leap year and leap month at four fitted densities, preserving all 366/29 records.
- All 52 years remaining distinct in scrolling mode. This exposed and fixed a floating-point bucket collision.

Existing suites additionally cover unknown dates, school years without invented days, residence clipping, source ownership, business medical exclusions, and hidden-person rules.

## Browser scenarios

`http://localhost:3012/tests/timeline-fixture.html` (or the same path on the local Vite port) renders the production TimelineView with fictional data and demo mode. It offers sparse, dense, birth-only, empty and business scenarios. It performs no household writes.

Verified in the browser:

- Medical-only adult view retains 1975–2026, with no shopping or pickup cards.
- Empty search keeps the lifetime axis and scale controls.
- Switching to the child changes the span to 2015–2026.
- Years with no entries remain selectable; next-year navigation works through the gaps.
- The 681-record dense scenario accounts for all records in fitted chapter counts.
- Fit geometry at 320×740, 390×844, 549×696, 768×1024, 1024×768, 1440×1000 and 844×390: no horizontal page overflow, clipped cards or overlapping cards.
- Scroll mode shows all 52 year chapters with 180px cards and an independently scrollable timeline.
- Life → Year → Month retains an explicit Fit choice; grouped dates retain exact source dates in the detail panel.
- Education source link calls the correct person/tab.
- Fullscreen body lock, inert background, keyboard focus wrapping, Escape close and restored background interaction.
- Portrait and landscape layouts visually inspected; landscape fitted cards and the full axis fit the expanded viewport.
- Birth-only history reaches the present, empty history retains controls, business history excludes family medical content and uses business wording.

The available live browser was signed out. These regression scenarios recreate the reported conditions with fictional data; they do not claim to inspect or alter the user's private saved records.

The v358 image was built but its rollout was stopped before Cloud Run deployment to add the explicit category-confirmation safeguard. These corrections ship together as v359.

The additional local calendar fixture (`tests/calendar-category-fixture.html?demo=1`) mounts the real calendar editor with in-memory saves. Browser verification: an unconfirmed legacy import opens as Other; selecting Medical appointment and saving sets `categoryConfirmed: true` and includes it in medical; reopening and saving Other removes it again. No household or Google Calendar writes were performed.
