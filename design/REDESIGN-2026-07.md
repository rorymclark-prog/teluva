# Family Vault — Visual Modernization Spec (2026-07)

Goal: move from "warm cream editorial" to **Instagram-modern** — faces first, big avatars,
clean high-contrast surfaces, one confident accent. Same product, same information
architecture, restyled.

Open the mockups first, then read the spec:

- `design/mockups/dashboard.html` — people-forward home grid
- `design/mockups/profile.html` — the large-avatar member profile

Both render the recommended direction (**Clean Warm**) and respect `prefers-color-scheme: dark`.

---

## 1. Why the current theme reads as dated

Being specific, because every one of these maps to a fix:

1. **The yellowed cream palette.** `--color-cream-100 #FAF6EF` (app bg) and the cream
   border scale are visibly *yellow*, not neutral. Yellowed warm surfaces + terracotta +
   sage is the 2018–2020 "artisanal bakery / Kinfolk magazine" palette. Modern consumer
   apps (Instagram, Airbnb, Notion, iOS) use **near-white warm greys** — warmth comes from
   a grey with a hint of brown, not from yellow. The cream also drags contrast down:
   ink-on-cream everywhere reads soft and low-energy.
2. **Fraunces serif display.** A high-contrast editorial serif for headings says
   "wedding stationery / farm-to-table menu". Instagram-modern is **one geometric sans at
   heavy weights with tight tracking** doing both display and body duty. The app already
   loads Plus Jakarta Sans — it just never gets to be the headline act.
3. **Tiny avatars.** Member list avatars are `w-12` (48px); the member detail header —
   the profile of a *person* — shows them at `w-14` (56px) in a rounded square. In a
   family app the people ARE the content. iOS 17+ Contacts moved the photo to dominate
   the screen; Instagram profiles lead with a 90px+ ringed avatar. 56px says "table row",
   not "person".
4. **Everything is equally soft.** `rounded-3xl` (24px) on every card + soft double
   shadows + cream borders + chips everywhere = no hierarchy, slightly twee. Modern cards
   are 16px radius, hairline border, near-invisible resting shadow — softness is spent on
   *buttons* (full pills) and *avatars* (circles + gradient rings), not on everything.
5. **Muted accents doing too many jobs.** Clay `#C26A40` is a muted, brownish terracotta —
   it never pops as a call-to-action. Sage/honey/dusk/rosa are all pastel-tinted, so
   semantic colors (danger! warning!) whisper.

None of this is *broken* — it's coherent. It's just a 2019 aesthetic, and the fix is
mostly token values, not layout surgery.

---

## 2. Two directions

### Direction A — **Clean Warm** ★ RECOMMENDED

*"Instagram meets Apple Contacts, but it still feels like a home."* Light, warm-neutral,
high contrast, one vivid ember accent, sunset gradient rings on avatars.

**Color tokens (light):**

| Role | Token (keeps existing name) | Hex |
|---|---|---|
| Card surface | `white` (unchanged) | `#FFFFFF` |
| App background | `cream-100` | `#F6F5F1` |
| Header / raised bg | `cream-50` | `#FBFAF8` |
| Inset / hover bg | `cream-200` | `#EEECE6` |
| Hairline border | `cream-300` | `#E5E2DB` |
| Strong border | `cream-400` | `#D6D2C8` |
| Text — primary | `ink-900` | `#1C1917` |
| Text — heading-2 | `ink-800` | `#292524` |
| Text — body | `ink-700` | `#44403C` |
| Text — secondary | `ink-600` | `#57534E` |
| Text — muted | `ink-500` | `#78716C` |
| Text — faint / placeholder | `ink-400` | `#A8A29E` |
| **Primary accent "Ember"** | `clay-500` | `#EA5A3B` |
| Ember hover | `clay-600` | `#D64A2E` |
| Ember deep | `clay-700` | `#B93E24` |
| Ember mid tints | `clay-300/400` | `#F59B7A` / `#F0764F` |
| Ember soft tints | `clay-50/100/200` | `#FDF0EA` / `#FCE1D3` / `#F9C3AC` |
| **Secondary "Fern"** | `sage-500` | `#2E7D5B` |
| Fern strong | `sage-600/700` | `#256A4C` / `#1D543C` |
| Fern tints | `sage-50/100/200` | `#EAF4EF` / `#D8EAE0` / `#B5D6C4` |
| Info blue | `dusk-500` / `dusk-700` | `#2563EB` / `#1D4ED8` (tints `#EFF4FE` / `#DBE7FD`) |
| Warning amber | `honey-500` / `honey-700` | `#D97706` / `#A85A05` (tints `#FCF4E6` / `#F8E4C0`) |
| Danger rose | `rosa-500` / `rosa-700` | `#E11D48` / `#BE123C` (tints `#FDEDF1` / `#FBDCE4`) |

**The signature move — the sunset ring** (Instagram story-ring technique, 45° linear
gradient + padding trick):

```css
--gradient-ring: linear-gradient(45deg, #FFC24B 0%, #EA5A3B 45%, #C13584 100%);
```

Amber → Ember → magenta. It contains the brand accent, so rings and buttons feel related.

**Shadows** (much quieter than today):

```css
--shadow-soft: 0 1px 2px rgba(28, 25, 23, 0.05);
--shadow-lift: 0 4px 12px rgba(28, 25, 23, 0.07), 0 12px 32px rgba(28, 25, 23, 0.07);
```

**Fonts:** ONE family — **Plus Jakarta Sans** (already loaded).
`--font-display: "Plus Jakarta Sans"` at 700/800 with `letter-spacing: -0.02em` replaces
Fraunces everywhere. Body stays Jakarta 400/500/600. JetBrains Mono stays for IDs/numbers.
(Drop the Fraunces import — smaller page weight for free.)

**Card style:** `border-radius: 16px` (`rounded-2xl`); border `1px solid #E5E2DB`;
resting shadow `--shadow-soft` only; hover `--shadow-lift` + `translateY(-1px)` on
interactive cards. Buttons become **full pills** (`rounded-full`).

**When to pick it:** you want the app to feel current, friendly, and *daylight* — a family
utility people open at the school gate. Lowest-risk retrofit: it's ~90% token values.

### Direction B — **Rich Modern**

*"Premium evening app"* — near-black glassy surfaces, gradient-heavy, vivid accents.

| Role | Hex |
|---|---|
| App background | `#0E1013` |
| Card surface | `#16181D` |
| Elevated / modal | `#1D2026` |
| Text primary | `#F4F4F2` |
| Text secondary | `#A0A3AA` |
| Hairline border | `rgba(255,255,255,0.08)` |
| Primary accent | `#FF5C42` (gradient CTA `#FF6B4A → #E64980`) |
| Secondary mint | `#3DDC97` |
| Ring gradient | `linear-gradient(45deg, #FFB65C, #FF5C42, #A855F7)` |

Cards get a faint glass treatment (`backdrop-filter: blur` on sticky bars, 1px inner
highlight `rgba(255,255,255,0.06)`). Same type + avatar system as A.

**When to pick it:** if the owner reacts to A with "nice but not *wow*". Costs more:
every tinted chip/semantic color needs a dark-legible variant, photos of documents look
worse on dark, and a forms-heavy app is harder to read dark all day.

**Recommendation: Clean Warm (A)**, with dark mode *as its `prefers-color-scheme` variant*
(the mockups already do this) — you get 80% of Rich Modern for free, without committing
the whole app to dark.

---

## 3. The member profile redesign (centerpiece)

Mobile-first. See `design/mockups/profile.html`.

```
┌──────────────────────────────┐
│ ← Back            Edit ✎     │  top bar, 56px
│ ░░░░ cover gradient ░░░░░░░░ │  120px tall, per-member gradient (or photo later)
│          ┌────────┐          │
│          │ AVATAR │          │  120px circle, 4px sunset ring + 3px surface gap,
│          └───✨───┘          │  ✨ Restyle badge bottom-right (32px)
│         Sophie "Soso"        │  30px / 800 / -0.02em, centered
│      [Child] [9 years]       │  pills, 12px
│      born 2016 · O+          │  13px muted
│     (📞)   (✉)   (📍)        │  48px circular action buttons + 11px labels
│ ┌─ At a glance ────────────┐ │  3 stat tiles: Blood / Height / Shoe
│ [Medical][IDs][Sizes][Wish…] │  horizontally scrollable chips,
│                              │  active = solid ink-900 pill, white text
│ ┌ Allergy alert (rose tint) ┐│
│ ┌ Doctor card ─────────────┐│  section content = 16px-radius cards,
│ ┌ Insurance card ──────────┐│  same fields as today’s tab components
└──────────────────────────────┘
```

Specifics:

- **Hero avatar: 120px** mobile, **128px** ≥1024px (Dashboard detail header). List rows
  stay circular at 56px. The ring is the Instagram technique: wrapper div with
  `background: var(--gradient-ring); padding: 4px; border-radius: 9999px`, inner
  `border: 3px solid <surface>` so the ring visually floats. Initials fallback: member's
  `avatarColor` mapped to a duotone gradient (see §5), letter at ~40% of avatar size, 800.
- **Cover:** 120px band, CSS gradient derived from the member's `avatarColor`
  (e.g. `linear-gradient(135deg, colorA, colorB)` + a soft radial highlight). Optional
  photo cover later — the gradient ships day one with zero new data.
- **Name:** display font 30px/800, tight. Nickname inline in muted 600. Role + age as
  pills directly under (role pill = fern tint for Admin, ember tint for Child, neutral
  for Member — one glance tells you who's who).
- **Contact = circular action buttons** (Apple Contacts pattern): Call / Message / Map,
  48px circles, inset bg, icon 20px, label under. Replaces today's text links.
- **Section tabs** (Medical, ID & Passports, Sizes, Wishlist, Growth, Travel, Likes,
  Documents, Secrets — unchanged set): horizontally scrollable pill row; active =
  **solid `ink-900` pill with white text** (today: white pill on cream — too quiet);
  inactive = transparent, `ink-500`, hover `ink-800`. 16px icons stay.
- **Section content:** unchanged components (`MemberMedical`, `MemberIDs`, …) restyled
  by the token cascade: cards 16px radius, `.field` inputs, quieter shadows. Alert-type
  data (allergies) gets the rose-tint card treatment.
- Desktop (`lg:`): hero goes left-aligned in the detail card (avatar left, name block
  right), everything else identical.

## 4. The home / dashboard redesign

See `design/mockups/dashboard.html`. The member list becomes a **people-forward grid**:

- **Member card:** centered **96px ringed avatar**, name 16px/700, role pill, one meta
  line (`O+ · 3 docs`, allergy dot in rose). Card = white, 20px radius (grid cards can be
  a touch rounder than content cards), hairline border, hover lift. Tap = select member
  (mobile: navigates to profile view; desktop: fills the right-hand detail pane, exactly
  today's behavior).
- **Grid:** `repeat(auto-fill, minmax(150px, 1fr))`; 2 columns on mobile, 4–6 on desktop.
  Gap 12px mobile / 16px desktop. Last cell = dashed "Add member" ghost card (admin only).
- **Header:** hub photo/monogram 36px circle + hub name 17px/800; view switcher stays a
  pill rail but active pill = solid ink; search pill right; Add = ember pill button.
- Below the grid, the existing content (events, quick access to Vault/Emergency/…)
  restyles automatically via tokens; mockup shows a "Today" card + quick-access tiles as
  the pattern.
- Desktop two-pane survives: left pane = the grid at 2 columns; right pane = profile hero.
  (Alternative if he prefers minimal change: keep list rows but bump row avatars to 56px
  circles with rings — that's Phase 1 cheap.)

## 5. Scales

**Avatar scale** (circle diameters; ring adds 4px pad + 3px gap when present):

| Token | px | Used for |
|---|---|---|
| `avatar-xs` | 28 | chips, event attendees |
| `avatar-sm` | 40 | header hub monogram, dense lists |
| `avatar-md` | 56 | member list rows (up from 48) |
| `avatar-lg` | 96 | dashboard grid cards |
| `avatar-xl` | 120 | profile hero (mobile) |
| `avatar-2xl` | 128 | profile hero (desktop) |

**Initials-avatar duotone gradients** (map from existing `avatarColor` field):
peach `#FFB199→#FF6B4A`, rose `#F6A6C1→#E0508F`, violet `#B7A6F6→#7C5CE0`,
indigo `#93A8F5→#4F63D2`, teal `#7FD8C4→#2E9E82`, amber `#FFD08A→#E8963C`.
Letter: white, 800, ~40% of diameter.

**Type scale** (Jakarta; display weights 700/800 tracked -0.02em):
34 (page hero, desktop) · 30 (profile name) · 24 (h2) · 20 (h3) · 17 (card title) ·
15 (body) · 13 (secondary) · 12 (labels, pills) · 11 (fine print). Line-height 1.2 display,
1.5 body. Mono for passport/ID numbers.

**Spacing scale:** 4-base: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48. Page gutter 16 mobile,
24 desktop; card padding 20; grid gap 12/16; section stack gap 20.

**Radius scale:** 8 (inputs inner, small chips) · 12 (inputs, small cards) ·
16 (cards) · 20 (grid/member cards) · 9999 (pills, buttons, avatars, tabs).

## 6. Phased implementation plan (lowest effort → highest impact first)

The trick: **keep every token *name*, change only *values*** — the whole app recolors
with zero component edits.

**Phase 1 — token swap in `src/index.css` (~1 hour, ~80% of the visual change)**
- Replace the hex values of `--color-cream-*`, `--color-ink-*`, `--color-clay-*`,
  `--color-sage-*`, `--color-honey-*`, `--color-dusk-*`, `--color-rosa-*` with the
  Clean Warm table in §2. Names unchanged → cascades through every component.
- `--font-display: "Plus Jakarta Sans", …` (drop Fraunces from the Google Fonts import).
- New `--shadow-soft` / `--shadow-lift` values (§2).
- Add `--gradient-ring`.

**Phase 2 — component classes in `@layer components` (index.css, ~30 min)**
- `.card`: `rounded-3xl` → `rounded-2xl`.
- `.btn-primary` / `.btn-quiet` / `.btn-danger`: `rounded-2xl` → `rounded-full`.
- `.tab-pill-active`: `bg-white shadow-soft` → `bg-ink-900 text-white` (add
  `text-cream-50` hover handling); `.tab-pill` `rounded-xl` → `rounded-full`.
- Add:
  ```css
  .avatar-ring { background: var(--gradient-ring); padding: 4px; border-radius: 9999px; }
  .avatar-ring > * { border: 3px solid white; border-radius: 9999px; }
  ```

**Phase 3 — avatar enlargement in `Dashboard.tsx` (~1 hour)**
- List rows (~lines 310–323): `w-12 h-12` → `w-14 h-14`, wrap in `.avatar-ring`.
- Detail header (~lines 940–952): `w-14 h-14 rounded-2xl` → `w-24 h-24 lg:w-32 lg:h-32
  rounded-full` inside `.avatar-ring`; stack the header centered on mobile
  (`flex-col items-center xl:flex-row`), name to `text-3xl`.
- Contact links → circular action buttons.

**Phase 4 — people-forward grid (~half day)**
- New `MemberGrid` rendering in `Dashboard.tsx` left column (mobile grid / desktop
  2-col), reusing `memberCardInner` data logic; keep drag-reorder via `Reorder.Group`
  with `grid` layout or gate reorder behind an "arrange" mode.

**Phase 5 — hero cover + polish (~half day)**
- Cover gradient band derived from `avatarColor`; stat tiles ("At a glance");
  `EditMemberModal.tsx` picks up everything via tokens, only spot-check paddings.

**Phase 6 — optional dark mode**: re-declare the Phase-1 tokens under
`@media (prefers-color-scheme: dark)` using the Rich Modern surface values (§2B).

## 7. Fun AI avatars (Nano Banana)

Add a **"✨ Restyle"** action on the enlarged profile avatar (the badge is already in the
mockup, bottom-right of the hero ring — the exact spot Instagram puts "+"). Tapping it
opens a small sheet with style presets — **Pixar · Watercolour · Renaissance portrait ·
Superhero · LEGO minifig** — each shown as a tiny style thumbnail. Selecting one sends the
member's existing `avatarUrl` photo through **Gemini 2.5 Flash Image (Nano Banana)**
image-to-image with a fixed style prompt, shows a shimmer on the ring while generating
(~5s), then presents Before/After with "Use it" / "Try another" / "Keep original".
Restyled avatars save alongside the original (`avatarUrl` + new `avatarStyledUrl` +
`avatarStyle`), so "Reset to photo" is always one tap, and the family list can optionally
show everyone in one matching style ("Family portrait mode" — apply one preset to all
members from Hub Settings). Hook points: the hero avatar in `Dashboard.tsx` (detail
header) and the avatar picker in `EditMemberModal.tsx`; generation goes through the
existing server (Cloud Run) so the Gemini key stays server-side. Kids will fight over
who gets to be the superhero — that's the feature.

---

*Sources consulted: Instagram story-ring CSS technique ([gist](https://gist.github.com/rizkiandrianto/5ab332741c49c1f847b2b51ed8ed77e8)); Apple Contact Posters / large-photo contact pattern ([MacRumors](https://www.macrumors.com/how-to/ios-17-how-to-create-your-own-contact-poster/), [TidBITS](https://tidbits.com/2025/11/17/how-to-set-contact-avatars-and-posters-on-the-iphone/)); 2025–26 UI trend surveys — warm off-white neutrals, one-accent systems, tall cards, glass sparingly ([Lummi](https://www.lummi.ai/blog/ui-design-trends-2025), [Pixelmatters](https://www.pixelmatters.com/insights/8-ui-design-trends-2025), [WebOsmotic](https://webosmotic.com/blog/modern-app-colors/), [Recursion](https://recursion.software/blog/ui-color-trends-2026)).*
