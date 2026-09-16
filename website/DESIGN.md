# Teluva marketing site — design spec

The single source of truth for anyone building a section of this site.
Read `RESEARCH.md` for *why* (competitive findings) and `FACTS.md` for *what
is true* (every claim must trace to it). This file is *how it looks and how
it is built*.

---

## 0. The rule that overrides everything else

**The site inherits the app's design language. It does not invent one.**

The app ships a documented 2027 design language called **Ember Thread**
(`src/index.css`, lines 1–120). A marketing site that looks like a different
product than the thing it sells breaks trust before a word is read — and this
is a product whose entire pitch *is* trust. So: same palette, same typefaces,
same accent discipline.

Where this spec is silent, go and read `src/index.css` and follow it.

---

## 1. Color

Taken directly from the app's `@theme` block. Hex values are the app's, not
approximations.

| Role | Token | Light | Dark |
|---|---|---|---|
| Paper (page ground) | `cream-50` / `ink-900` | `#FFFDF9` | `#111114` |
| Raised surface (cards) | `cream-100` / `ink-800` | `#F7F3ED` | `#232328` |
| Hairline / border | `cream-200` / `ink-700` | `#EEE7DD` | `#3C3C44` |
| Body text | `ink-800` / `cream-100` | `#232328` | `#F7F3ED` |
| Muted text | `ink-500` / `ink-400` | `#74747D` | `#A2A2AC` |
| **Accent — ember** | `clay-500` | `#FF4B3E` | `#FF6E5E` (clay-400, lifts on dark) |
| Verified / safe | `sage-500` | `#2E7D5B` | `#86C4A3` (sage-300) |

**Accent discipline — the important part.** Ember (`#FF4B3E`) is a loud red.
The app's own rule is that it marks *the primary action and nothing else*.
On this site that means: primary CTA buttons, and exactly one editorial
moment per page. It is never a section background, never a gradient wash,
never a decorative underline on six different headings. Everything around it
stays cream and ink.

**Never use ember for status.** The app keeps `rosa` (danger), `honey`
(warning) and `sage` (good) in their own hues precisely so "this is expired"
and "this is the button" can't be confused. Same rule here.

**Neutrals are warm on purpose.** `#FFFDF9` is paper, not white; `#74747D`
is a grey biased slightly cool against that warm ground. Don't substitute
`#FFFFFF` / `#888888` — the warmth is the brand.

---

## 2. Type

Loaded from Google Fonts, same import line the app uses:

```
https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&family=JetBrains+Mono:wght@400;500&display=swap
```

Three roles, matching the app:

- **Display + body — Plus Jakarta Sans.** One geometric sans does both jobs,
  separated by weight and size rather than by family. Headlines 800, tight
  tracking (`-0.03em` at display sizes). Body 400.
- **Editorial accent — Georgia italic.** This is the app's own signature
  device: `h1 em { font-family: Georgia; font-weight: 400 }`. **Every major
  headline on this site sets exactly one word in Georgia italic.** It is the
  house voice, it is free (system stack, no extra load), and it is the single
  thing that will stop this site reading as another Inter-only SaaS page.
  Use it *once per headline* — twice is a tic.
- **Data / micro-labels — JetBrains Mono.** Uppercase, `0.08em` tracking,
  11–12px. For eyebrows, figure captions, and any number that wants to look
  like a fact rather than a boast.

Running text caps at ~65 characters (`max-width: 34rem` is the app's own
figure). `text-wrap: balance` on every heading.

---

## 3. Layout

**Concept:** a calm, warm document that gets *quieter* as the subject gets
more serious — the opposite of the usual escalation into a loud pricing
crescendo. The page opens with one live, low-stakes interaction, then settles
into evenly-paced sections of real product against paper, and the single dark
section on the page is the security one, where the tone drops and the
mechanism is explained plainly.

Section order (from `RESEARCH.md` §1, which found this skeleton on all nine
sites fetched):

1. **Hero** — headline (one Georgia italic word), mechanism subheadline, one
   primary CTA with the no-card line beside it, and the interactive demo.
2. **Trust strip** — light, ambient. Not the security argument.
3. **Pillars** — 3–4, single-verb labels. Acts as the page's contents.
4. **One full section per pillar**, each with a real annotated screenshot.
   Not a 9-cell icon grid — that grid is named in the research as the tell.
5. **Security section** — dark ground. The mechanism, the jurisdiction, the
   independent check. Only `FACTS.md`-VERIFIED claims may appear here.
6. **Social proof / worked scenario.**
7. **Pricing** — honest about being undecided.
8. **Final CTA** — the same words as the hero CTA, verbatim.
9. **Footer** — resource links carry the vocabulary the hero avoids (see §5).

---

## 4. Motion

The research is split for a reason and so are we:

- **The hero demo is the one place motion does real work.** It should *be*
  the product demo, not decorate it — a document goes in, and you watch it
  get filed. This is the standout device found in the whole research pass
  (Trustworthy does it; it's their best asset).
- **Everywhere else, restraint is the credibility signal.** Linear and
  1Password ship essentially no animation and read as more trustworthy for
  it. A site about your will and your passport that glitters reads as flashy,
  not safe.

Concretely: no scroll-triggered fade-ins applied uniformly to everything, no
hero particles, no auto-rotating carousels, no blob morphing. Hover states
must visibly change. Respect `prefers-reduced-motion` — the hero demo must
present its end state immediately when reduced motion is set, not simply
stop.

---

## 5. Copy rules

**Grounding.** Every product claim traces to a line in `FACTS.md`. If it
isn't in there, it doesn't go on the page — get it verified or cut it. No
"powerful", no "seamless", no "comprehensive". Name the actual feature.

**Security claims** may only use `FACTS.md` entries marked VERIFIED. An
UNVERIFIED claim on a security section is the worst failure available here.

**The hard conversation.** Teluva holds wills, medical records and estate
documents. Research §3 found that nobody in this category says the word in
persuasion copy, and the reason is sound — it reads as exploitative in a
headline and glib in a euphemism. So:

- Hero and pillar copy: **no** "death", "dying", "when you're gone", "after
  you pass". Present tense, administrative, calm: *organized*, *handled*,
  *where it is*.
- Feature lists: name wills, directives and medical records **plainly, in the
  same breath as passports and insurance**. Normalizing by proximity is the
  move — giving them a special reverent tone is what reads as morbid.
- The benefit is measured in the **stress of the living**, never the event of
  the dying.
- Footer resource links may say it directly — someone searching that phrase
  in a crisis needs to find the page.

**Headlines.** Outcome stated as fact, not category label. Banned outright:
"all-in-one", "Your X, simplified", "Everything you need in one place",
"the platform for", "built for the future of". The subheadline names the
mechanism the headline skipped.

**CTA.** One verb, boring on purpose, and **identical every time it appears**
— repetition is the point, not a lapse. "No credit card" sits beside the
button, never in a footer or FAQ.

---

## 6. Build rules

- Static HTML + CSS. No framework, no build step, no external JS libraries.
  Google Fonts is the only permitted external request.
- Semantic HTML: `<header> <main> <section> <footer>`, one `<h1>`, headings
  in order. Real `<button>`/`<a>` for anything interactive.
- Theme: token-level light *and* dark. Define the full light palette on bare
  `:root`; redefine **only tokens** under
  `@media (prefers-color-scheme: dark)` guarded as
  `:root:not([data-theme="light"])`; redefine again under
  `:root[data-theme="dark"]`. Never declare a color only inside a media
  block. `body` sets an explicit background from a token.
- Spacing comes from flex/grid `gap`, not stacked margins.
- Wide content gets its own `overflow-x: auto` container; the body never
  scrolls sideways.
- Visible keyboard focus on every interactive element.
- Mobile is not an afterthought — this gets opened on a phone from a
  WhatsApp link more often than on a desktop.

---

## 7. Anti-pattern checklist — check before shipping

From `RESEARCH.md` §6. If any of these is true, the section is not done:

- [ ] Purple-to-blue gradient anywhere
- [ ] A single typeface with no display/body distinction
- [ ] Identical border-radius and padding on every card on the page
- [ ] Stock photo of people at a laptop / abstract 3D blobs / AI illustration
- [ ] An icon + 3-word-title + 1-sentence card grid repeated 6–9 times
- [ ] A headline that could sit on any other product's site
- [ ] Hover states that don't visibly change
- [ ] Emoji used as section markers
- [ ] Everything centered
- [ ] Ember used anywhere other than the primary action + one editorial moment
