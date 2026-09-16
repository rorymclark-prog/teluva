# Teluva marketing site — research brief

Grounded in live fetches of the sites named below (marked **[verified: fetched]**) plus secondary sources for trend commentary (marked **[secondhand: search]**). Fetched August 2026.

Sites fetched directly: trustworthy.com + /pricing, everplans.com, 1password.com (enterprise) + /personal, proton.me, tailscale.com, bitwarden.com, monarch.com (Monarch Money, redirected from monarchmoney.com), copilot.money, linear.app. standardnotes.com returned HTTP 403 and was not read.

---

## 1. Structure

The pattern across every well-executed site here is the same skeleton, and the variation is in what gets *inserted* into it, not the order of the slots:

1. **Hero** — one sentence claim, one supporting sentence, one primary CTA (occasionally two: a free/self-serve CTA plus a "talk to sales"), and a visual that is either the real product UI or an interactive demo, never abstract art.
2. **Trust strip** — logos (press, customers, or awards) directly under the hero, before any feature content. Proton opens with "100M+ users, 4.5-star ratings"; Monarch opens with a press-logo carousel; Copilot Money opens with awards/editor recognition. This is the first thing after the hero, not a mid-page afterthought.
3. **Value-prop pillars** — 3-4 short named pillars (Monarch: Track / Budget / Collaborate / Plan; Linear: "Purpose-built," "Powered by agents," "Designed for speed") that act as the page's table of contents. Each pillar becomes a full section further down.
4. **Deep-dive feature sections**, one per pillar, each with its own screenshot or interaction and its own micro-headline — not one giant feature grid. **[verified: fetched]** on Monarch and Linear specifically: each pillar gets a dedicated section with a real screenshot, not an icon-and-one-liner.
5. **Security/trust deep section** — a standalone section (not just the top strip) that makes the specific claims: Trustworthy has "Built to Protect What Matters Most"; Bitwarden has "Security you can trust" linking to a compliance page. This is positioned roughly mid-page, after the visitor already understands what the product does, not before.
6. **Social proof** — testimonials with names/context, not just star ratings. Tailscale names specific companies with specific numbers ("90% reduction in internal support requests," Corelight, Cribl, Instacart) rather than generic quotes.
7. **Pricing** — either inline on the homepage (Copilot Money, Bitwarden) or one click away via a dedicated "Compare plans" / "View pricing" CTA (1Password, Proton, Trustworthy). For consumer-trust products, pricing tends to live on its own page so the homepage stays focused on the value story.
8. **Final CTA band** — a restatement of the hero promise plus the same primary CTA, immediately before the footer. Everplans repeats "Start now" four separate times down the page — the CTA copy is deliberately identical every time, not varied for freshness.
9. **Footer** — heavy with resource/education links (Everplans: "What to Do When Someone Dies," "Estate Planning," "Helping Your Aging Parents"). For sensitive-subject products the footer doubles as an SEO/education layer, not just sitemap links.

**What's in a working 2026 hero, concretely:**
- Headline is a *claim about outcome*, not a category label. Trustworthy: "Everything That Matters. Handled." Copilot: "Your money, beautifully organized." Neither says "the platform for X."
- Subheadline does the actual explaining the headline skips — names the mechanism ("automatically organizes... maintains updates... guides next steps").
- One CTA verb, stated as the *first* action ("Get started free," "Create a free account") — never "Learn more" as the primary hero CTA on any site fetched.
- The visual is either (a) real product chrome, ideally interactive — Trustworthy's hero literally invites you to drop a file and watch it get organized live in the hero, which is the strongest device seen in this whole research pass — or (b) nothing decorative at all, letting typography and whitespace carry it (Copilot Money skips hero imagery entirely and goes straight to real screenshots in the next section). The one thing nobody does well anymore is generic lifestyle photography or abstract blob art in the hero.

---

## 2. Trust

For a product handling passports, medical records, and wills, the trust argument has to answer three questions in this order: *can you technically read my data, where does my data live, and has anyone independent checked your claims.* The sites that do this well answer all three, in dedicated copy, positioned close together — not scattered as isolated badges.

**Proton [verified: fetched]** is the fullest model:
- Technical claim: "end-to-end encryption" and "zero-access encryption," with the specific mechanism spelled out — "no one (not even Proton) has the technical means to access your data." This is the strongest phrasing pattern in the whole research set: it doesn't just claim privacy, it explains *why it's structurally true*, pre-empting the "but you could still look" objection.
- Jurisdiction: "Your data does not go to the cloud... protected by some of the world's strongest privacy laws" — ties trust to Swiss law, not just to the company's promise.
- Open source + audits stated together: "All our apps are open source and independently audited by security experts" — open source is the enabler, the audit is the verification; stating them as one sentence is more persuasive than two separate badges.
- No-ads pledge as a distinct claim: "We don't sell ads and can't share your data" — separated from the encryption claim because it answers a different fear (monetization of data vs. technical access to data).

**Bitwarden [verified: fetched]** does the audit claim via a customer quote rather than a company assertion — "publishes the results of its third party security audits" appears inside a testimonial, not as marketing copy. Borrowing a third party's voice for the audit claim is more credible than the company stating it about itself.

**Trustworthy [verified: fetched]**, the closest direct competitor, is comparatively thin here: "AES-256 encryption and multi-factor authentication," "you stay in control," "never shared, sold, or monetized," and a comparison to "the same care used by leading financial and healthcare services." No independent audit claim, no open-source claim, no jurisdiction statement was found on the homepage. This is a real gap for Teluva to beat: Trustworthy leans on *emotional* trust (family, care) more than *technical/verifiable* trust (audits, zero-knowledge, jurisdiction). A product asking for wills and medical records can out-trust Trustworthy specifically by doing what Proton does — naming the mechanism, not just the promise.

**Everplans [verified: fetched]** substitutes institutional badges for cryptographic claims: HIPAA compliance, AICPA SOC badges, ADA site compliance, plus an explicit disclaimer that it is "not a licensed healthcare provider, medical professional, law firm, or financial advisory firm." That disclaimer is itself a trust device — it draws an honest boundary around what the product claims to be, which reads as more credible than overclaiming.

**Placement pattern that recurs:** a *light* trust signal (logos, star rating, user count) sits directly under the hero as ambient credibility; the *heavy* trust argument (encryption mechanism, audits, jurisdiction, compliance badges) gets its own named section roughly a third to halfway down the page, after the product's value is already established. Nobody puts the full security case above the fold — it would compete with the value proposition rather than support it.

For Teluva specifically: with GDPR/Austria hosting as a real asset (EU jurisdiction is a genuine trust lever US competitors like Trustworthy can't claim as cleanly), the brief should push a Proton-style "we structurally cannot read your data" explainer plus an explicit EU-jurisdiction statement as a differentiator against the US-based competition.

---

## 3. The hard conversation

None of the estate/death-adjacent sites researched go anywhere near mortality vocabulary in headline copy. The consistent move is **euphemism through administrative framing**: death becomes "life's moments," "settling an estate," "when someone dies" is confined to footer/resource-link copy, never hero copy.

**Everplans [verified: fetched]** is the clearest case study:
- Hero headline is entirely about organization, not mortality: "All the pieces of your world in one place."
- The word "death" appears only in a footer resource link title ("What to Do When Someone Dies") — i.e., it's permitted in a *utility/search-intent* context (someone actively searching that phrase in a crisis will find it) but banished from persuasion copy.
- End-of-life planning is relegated to a navigation category label, not featured prose — present for people who are already looking for it, invisible to people who aren't.
- The emotional case is made through a *statistic about the living*, not the dead: "86% are less stressed when they are organized." This reframes the entire category — the product isn't about death, it's about anxiety reduction for people currently alive. That's the single most transferable device found in this research: measure the benefit in the stress of the living, not the event of the dying.
- Funeral planning and estate settlement are described as neutral administrative tasks ("documenting family documents, IDs, vital info, and accounts") — task language, not emotional language.

**Trustworthy [verified: fetched]** does something similar but slightly more oblique: it lists sensitive document types plainly (wills, trusts, power of attorney, healthcare directives, living wills) inside a feature list, giving them no more emotional weight than a passport or insurance card — normalizing them by sheer proximity to mundane documents rather than addressing them directly. A customer testimonial does the "hard conversation" work instead of house copy: one quote references preparing an "aftermath data file," letting a real user's voice name the scenario the company itself avoids stating directly. This is a second transferable device: let a testimonial say the sentence the brand won't say in its own voice.

**Pattern to take from both:** never let hero or pillar copy use "death," "dying," "when you die," or "your family after you're gone." Reserve that vocabulary for (a) footer/resource links aimed at people already in crisis and actively searching, and (b) attributed customer quotes. Everywhere else, talk about *being organized now*, with the crisis-readiness benefit implied rather than named. This avoids both morbidity (naming death in a sales headline reads as exploitative) and glibness (an over-cheerful euphemism like "life's next chapter!" for a will feature reads as tone-deaf). The safe register is *calm, administrative, present-tense* — "handled," "organized," "one step ahead" — never future-tense mortality framing ("when you're gone") and never forced positivity.

For Teluva, this suggests: keep the will/medical/estate features named plainly in feature lists alongside passports and insurance (normalize by proximity, per Trustworthy); keep any stress/peace-of-mind statistic anchored to the living family, not the deceased (per Everplans' 86% stat); and if a "what happens when something happens" narrative is wanted, deliver it through a single customer-quote or worked scenario, not house copy.

---

## 4. Copy

**Exhausted patterns, avoid these outright:**
- "The all-in-one X" / "Your X, simplified" / "Everything you need in one place" (Everplans' own hero — "All the pieces of your world in one place" — sits uncomfortably close to this cliché; it's the weakest headline of the set fetched, propped up by everything below it rather than by the line itself).
- "Build the future of X," "Scale without limits," "Your all-in-one platform" — flagged explicitly by 925studios **[secondhand: search]** as AI-average headlines: they're generated by averaging every SaaS headline ever written, so they say nothing about the specific product.
- Category-label headlines ("The password manager for teams") instead of outcome claims.

**What's working, with real examples:**
- **Outcome-stated-as-fact, past the category name entirely.** Trustworthy: "Everything That Matters. Handled." — two fragments, full stop punctuation mid-headline, reads as a verdict rather than a pitch. Copilot Money: "Your money, beautifully organized" — leads with the possessive + adjective, buries the category ("money app") entirely.
- **Mechanism-in-subheadline.** Every strong hero pairs a short abstract headline with a subheadline that names the actual mechanism: Trustworthy's sub explains *how* — "automatically organizes... maintains updates... guides next steps." The headline sells the feeling, the subheadline proves it's a real product and not a slogan.
- **Specific > universal**, per the AI-slop research **[secondhand: search]**: contrast "Build the future of work" against Stripe's "Financial infrastructure for the internet" or Linear's actual live headline captured in this research, "The product development system for teams and agents" — both name the exact category and audience instead of gesturing at a vague future.
- **Verb-first pillar labels**, one word each: Linear's "Purpose-built," "Powered by agents," "Designed for speed"; Monarch's "Track / Budget / Collaborate / Plan." Single verbs as section anchors read as confident and scan fast; three-to-five-word phrase pillars ("Comprehensive Financial Management Solutions") read as generated.
- **CTA copy stays boring on purpose.** Nobody uses cute CTA copy. It's "Get started free," "Create a free account," "Start now." The creativity budget goes into the headline, not the button — a button trying to be clever reads as trying too hard.

For Teluva: avoid "vault," "hub," and "OS" as headline nouns if the goal is to sound different from Trustworthy (which already owns "Family Operating System®" as a trademarked term) — differentiate on *tone* (calmer, more European/understated) rather than competing on the same "operating system for your family" metaphor.

---

## 5. Motion/visuals

**Where animation earns its place** (synthesized from Trustworthy's live hero demo, Linear's craft, and the trend research **[secondhand: search]**):
- **Interaction that proves the feature**, not decorates it. Trustworthy's drag-a-document-into-the-hero-and-watch-it-get-organized is the single best example found — the animation *is* the product demo, not an accompaniment to one. This is the state of the art for 2026: replace the static hero screenshot with a live, low-stakes interaction the visitor performs themselves in the first five seconds.
- **Micro-animations tied to a specific claim.** The trend research **[secondhand: search]** repeatedly draws the same line: "minimal motion that adds meaning, not noise" vs. hover states that do nothing, hero background particles, or hero-section blob morphing — the latter are called out by name as the AI-slop tell.
- **Scroll-driven walkthroughs** are named in the trend research as a rising pattern (Amplitude, Zendesk cited **[secondhand: search]**) — the page reveals product screens as the visitor scrolls, effectively turning the scroll position into a guided tour. Not verified directly on any fetched site, but consistent with what Linear and Monarch do with dedicated per-pillar screenshots stacked down the page.

**Where it's noise:**
- 1Password's enterprise page and Linear both demonstrate the opposite, equally valid craft position: **no animation at all**, just very high-fidelity real screenshots with real data in them (timestamps, avatars, actual issue titles) **[verified: fetched]**. Linear's read explicitly states the design "prioritizes clarity over animation... demonstrates confidence in the product itself as the primary visual element." For a trust-heavy product, restraint itself is a credibility signal — a hyperanimated site about your will and passport can read as flashy rather than safe.
- Auto-rotating carousels (seen on Proton's product cards **[verified: fetched]**) are the one motion pattern research consistently flags as low-value — users rarely wait for or notice rotation, and it works against scannability.

**Current state of the art for showing the product**, ranked by what this research found:
1. Interactive, do-it-yourself demo in the hero (Trustworthy).
2. Real, data-filled screenshots per feature section, stacked down the page, each with its own micro-headline (Linear, Monarch, Copilot Money — this is the *most common* pattern across every site fetched and should be the baseline for Teluva).
3. Static hero screenshot only, no per-feature screenshots (weaker, seen partially on Monarch's hero before its deep-dive sections take over).
4. Illustration/abstract art in place of real UI — not used by any well-regarded site fetched in this research. Its absence across the board is itself the finding.

For a beta product with real screens already built, Teluva should default to pattern 2 (real screenshots, one per feature, each annotated) as the floor, and treat an interactive hero demo (pattern 1) as the stretch goal if engineering time allows — it is the standout device in this research and directly suits a "drop your document, watch it organize" narrative.

---

## 6. Anti-patterns

Specific, mechanical tells an AI-generated or templated site will show, compiled from the 925studios analysis **[secondhand: search, quoted directly]** cross-checked against what was and wasn't seen on the well-regarded sites fetched:

- **Purple-to-blue gradient** on hero background, CTA buttons, or accent shapes — called out as "the most 'safe' choice... omnipresent to the point of meaninglessness." None of the fetched sites use it as a dominant device; Proton uses "gradient accents on CTAs (blue/teal tones)" sparingly, not as a hero-filling wash.
- **Inter (or unstyled system sans) as the only typeface**, with no display/headline face distinct from body text — signals "design was never intentionally styled."
- **Uniform 16px border radius and 24px padding on every card, everywhere** — the tell is sameness: nothing in the layout has a different rhythm from anything else, so the page has no visual hierarchy beyond font-size.
- **Stock photography of a diverse group looking at a laptop in an implausibly well-lit office**, or **abstract floating 3D blobs** — zero instances on any site fetched in this research; their total absence across nine real, well-regarded product sites is itself strong evidence they read as a red flag now.
- **AI-smooth illustration**: "slightly too smooth, slightly too symmetrical, with a plastic quality human illustration avoids" — applies to generated hero characters/mascots, which likewise appeared on none of the fetched sites.
- **Generic averaged headlines**: "Build the future of work," "Your all-in-one platform," "Scale without limits," "Empowering X to Y." These say nothing about the specific product because they're statistically the *center* of every SaaS headline ever written — the fix is always specificity (name the actual noun the product organizes, the actual audience, the actual mechanism).
- **Dead motion**: hover states with no visible change, buttons that snap on click instead of easing, fade-ins applied uniformly to every element on scroll regardless of whether the fade communicates anything.
- **Card-grid feature sections with icon + 3-word title + 1-sentence description, repeated 6-9 times identically** — present in weaker moments even on decent sites (Trustworthy's "six-feature overview grid") but the antidote seen elsewhere is to give each pillar its *own* full section with a real screenshot rather than compressing all features into one repetitive grid.

The meta-pattern: AI-slop tells are all forms of **uniformity where a human designer would have made a deliberate, uneven choice** — one typeface family instead of a chosen pairing, one border-radius instead of a considered scale, one gradient instead of a specific brand color, one headline register instead of a headline that risks being wrong because it's specific.

---

## 7. Conversion mechanics

For a free-trial, no-credit-card beta like Teluva, the researched best practice **[secondhand: search]** and the patterns actually observed on fetched sites agree closely:

- **State the friction-removal directly next to the button, not in a footer or FAQ.** "No credit card required" belongs as a one-line caption immediately under or beside the CTA button itself — not buried in a footer or an FAQ accordion. None of the fetched sites bury this; where a free tier exists (Bitwarden, Proton, Trustworthy's Free plan) the free/no-cost framing is stated at the point of the CTA, not two clicks away.
- **CTA copy repeats verbatim, not creatively re-worded, at every occurrence.** Everplans literally repeats "Start now" four times down the page **[verified: fetched]** rather than varying it ("Get started," "Try it," "Join today") — repetition of identical copy is deliberate, it lets a scanning visitor recognize the action instantly wherever they stop scrolling.
- **Primary CTA verb should be the actual first action**, not "Learn more." Every fetched site's primary hero CTA is a start-the-signup verb: "Get started free" (Trustworthy, Bitwarden), "Create a free account" (Proton), "Get started" (Copilot Money). "Learn more" never appears as a *primary* CTA on any site researched — only as a secondary link.
- **A short trial/cost disclosure sits above the fold**, per the secondhand research: trial length, what's included, who it's for — stated where the visitor can check the claim in the first few seconds, not left for a billing page.
- **When pricing isn't finalized**, the pattern across sites with tiered-but-simple pricing (Bitwarden, Proton, 1Password Families) is: **show a free tier prominently and clearly**, keep paid tiers visible but let the free tier carry the actual homepage CTA. The paid-tier complexity (four tiers on Trustworthy's pricing page, from Free through Platinum concierge) is pushed to a dedicated pricing page reached by a single "Compare plans" or "View pricing" link — the homepage itself never tries to sell the paid tiers, only the free entry point. For Teluva specifically, with beta + 180-day trial and pricing genuinely undecided, the honest version of this pattern is: **CTA says "Start your free 180-day trial" (or similar), the pricing page (if it exists at launch) states plainly that pricing is still being finalized and early users will be grandfathered/notified**, rather than inventing placeholder numbers. Trustworthy's own pricing page, notably, does not display a clear free-trial-length or credit-card disclosure in visible copy **[verified: fetched]** — treating that omission as a gap to beat, not a pattern to copy.
- **Form friction stays minimal.** Cited stat **[secondhand: search]**: forms with 5 or fewer fields convert measurably better; each additional field beyond that measurably drops conversion. Teluva's signup should ask for the minimum (email + password, or an OAuth option) with everything else deferred to onboarding inside the app.

---

## Summary of the single most transferable moves for Teluva

1. Steal Trustworthy's interactive hero demo *mechanic* (drop a document, watch it organize) but pair it with Proton's *trust mechanism* language ("we structurally cannot read this") — Trustworthy has the best demo and the weakest security copy of the group; Teluva can combine the two.
2. Anchor the emotional case in Everplans' move: measure the benefit in the stress of the living (a stat, a feeling now), never in the event of dying. Keep "death," "will," "when you're gone" out of hero/pillar copy; keep the actual document types (wills, medical records, IDs) listed plainly and normally alongside mundane ones, the way Trustworthy's feature list does.
3. Lead with EU/Austria jurisdiction as a differentiator no US competitor in this set (Trustworthy, Everplans, Monarch, Copilot) can claim — this is a real, specific trust lever missing from the whole competitive set.
4. Structurally: hero → light trust strip → 3-4 named pillars → one full section per pillar with a real annotated screenshot → dedicated security section (with the mechanism explained, not just "AES-256") → testimonials → pricing (free entry stated plainly; if pricing is undecided, say so honestly rather than inventing numbers) → repeated identical final CTA → footer with education/resource links that absorb the crisis-search-intent keywords the hero avoids saying.
