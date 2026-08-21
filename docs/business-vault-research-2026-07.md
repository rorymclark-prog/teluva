# Business Vault — should we build a B2B version of Family Vault?

**Research memo · 2026-07-17 · for Rory Clark (solo founder, Family Vault pre-launch)**

Sources cited inline. Where a claim is my inference rather than a cited fact, it is marked **[inference]**. Marketing claims from vendors are marked **[vendor claim]**.

---

## TL;DR verdict

**Don't build a separate business product now — but don't drop the idea.** The pain is real and already priced (dedicated expiry-tracking SaaS charges $49–$499/month for less than what your engine does), yet a *generic* "business vault" walks into a crowded field: HR suites own employee records above ~10 seats, dedicated expiry trackers own renewals, and AI-reads-your-document is commoditising fast inside both. The one genuinely open lane is the one you happen to live in: **micro-businesses (1–10 staff) below the HR-suite pricing floor, in cert-heavy regulated verticals — concretely, Austrian 24-hour-care placement agencies (1,121 of them, plus ~57,000 self-employed carers who are each a one-person business with a folder of expiring paperwork)**. The right move: ship the consumer app, then run a cheap 30-day dogfood experiment — a "business mode" on the existing engine with your own care business as customer zero and 5–10 Vienna agencies as validation targets. Build nothing beyond that until at least 3 of 10 agencies say yes to ~€39/month. A standalone product decision comes *after* that signal, not before.

---

## 1. Is the pain real, and who has it?

**Yes — the admin burden is measurable, growing, and disproportionately falls on the smallest firms.**

- Sage's 2025 research frames it as "13 months of work, 12 months of pay": SMBs lose **~24 working days a year to financial/admin work**, and ~49% of small-business CEOs/COOs spend 4+ hours *every week* on financial admin alone (https://www.sage.com/en-gb/company/digital-newsroom/2025/05/09/the-hidden-admin-burden-on-small-businesses/).
- US Chamber of Commerce: **39% of small businesses say compliance time/resources increased in the past six months; 33% say compliance requirements have prevented them pursuing new business** (https://www.uschamber.com/small-business/small-businesses-are-spending-more-time-money-on-regulatory-compliance).
- LegalZoom's *State of Small Business Compliance*: most small businesses manage compliance themselves, and nearly half report a heavier workload than the prior year (https://www.legalzoom.com/press-releases/the-state-of-small-business-compliance).

**Where the pain is acute** — the pattern across all sources is that generic admin is annoying, but *expiring credentials with legal consequences* are the sharp end:

| Segment | Pain intensity | Evidence |
|---|---|---|
| **Micro-business (1–10 staff)** | High and unserved — owner does compliance personally, no HR staff, below HR-suite minimum-seat floors (see §2) | Sage, LegalZoom above; Personio targets 10–2,000 employees with a **minimum of 10** (https://thrivea.com/blog/personio-review/) |
| **Regulated verticals: care/health** | Highest — caregiver credentials, training certificates, quality certifications, audit-readiness. CareAcademy markets "automate compliance tracking to save 95% of admin time" **[vendor claim]** (https://careacademy.com/) | Whole US software category exists for exactly this (MedTrainer, CareAcademy — §2) |
| **Trades (Handwerk)** | High — legally required safety training (§12 ArbSchG in DE), certificates per employee, with **stricter electronic documentation obligations arriving Jan 2027 in Germany** (https://www.it-boltwise.de/arbeitsschutz-digital-neue-nachweispflichten-ab-januar-2027.html — secondary source, treat as directional) | A German mini-industry tracks this: reteach, Prevenio, sycat, simplyOrg (https://simplyorg.de/features/zertifikate-nachweise/) |
| **Hospitality** | Moderate — food-safety certs, right-to-work docs | **[inference]** from the general cert-tracking category; no vertical-specific source found |
| **10–250-staff SMB, generic** | Real but *served* — this is exactly who Personio/Factorial/BambooHR sell to | §2 |

**Bottom line:** the job-to-be-done ("nothing with a date on it ever silently expires, and I never dig through folders before an audit") is real and people already pay for it. The question is not whether the pain exists — it's whether there's an unoccupied position. Mostly there isn't; in one place there is (§5).

---

## 2. Competitive landscape (2025–26)

### a) Dedicated expiry/certification trackers — the direct comparables

This is the closest category to "business vault that tracks renewals", and it's healthy, priced, and mostly *not* AI-first:

- **Expiration Reminder** (expirationreminder.com): **$49/mo (250 tracked items) → $149 → $299 → $499/mo**, flat-rate tiers by item count; positions itself as replacing "scattered spreadsheets" for certifications, licenses, training (https://www.capterra.com/p/172196/Expiration-Reminder/pricing/). Now advertises AI on top of tracking.
- **Remindax**: from **$19/mo**, claims 10,000+ professionals (https://blog.remindax.com/top-license-expiration-reminders-tools/).
- **ExpiryEdge**: freemium, flat monthly price, explicitly targets small business (https://expiryedge.com/use-cases/small-business/).
- **Harbor Compliance License Manager**: US entity/license lifecycle management (https://www.harborcompliance.com/license-manager-software).
- **CertFocus/Vertikal**: COI (insurance certificate) tracking at $6–$29/vendor/yr (https://www.vertikalrms.com/article/how-much-does-coi-tracking-software-cost-2025-pricing-guide/).

**Read:** pricing power is real — businesses pay 5–20× your €59/yr consumer price for *reminders alone*. But these products are mostly US-centric, form-and-spreadsheet-shaped, English-only, and few lead with "photograph it and the AI files it." That gap is narrowing (Expiration Reminder now markets AI), but hasn't closed in the EU micro-segment. **[inference on the gap; pricing cited]**

### b) HR / people platforms — they own the employee-records layer

- **Personio** — the DACH default. Custom quotes, roughly €/$5–15 per employee/month depending on tier and source (https://peoplemanagingpeople.com/tools/personio-pricing/, https://costbench.com/software/hr/personio/); **minimum 10 employees, and reviewers say it only really makes sense from ~50** (https://thrivea.com/blog/personio-review/, https://todayoff.de/blog/the-5-best-personio-alternatives-for-small-businesses-in-2026/). Digital employee files + document management are core features.
- **BambooHR** — Core $10/employee/mo, Pro $17, Elite $25; **flat ~$250/mo floor for ≤25 employees** (https://elearningindustry.com/how-much-does-bamboohr-cost, https://www.bamboohr.com/pricing/).
- **Factorial** — from ~$8/user/mo with a **minimum-seat policy; realistic floor ~$80/mo for 10 employees** (https://factorialhr.com/seats-conditions, https://peoplemanagingpeople.com/tools/factorial-review/). Strong document-workflow story.
- **Rippling** — launched "Rippling AI" (natural-language queries over HR data, March 2026) and Automated Compliance in 2026; one comparison still calls its document *parsing* "basic" (https://www.rippling.com/blog/introducing-rippling-ai, https://www.energent.ai/energent/compare/en/ai-powered-employee-document-management-software).
- **Deel / Gusto** — payroll-first; document storage is a checkbox feature (https://checkr.com/resources/articles/rippling-vs-gusto).

**Read:** above ~10 employees, "employee documents + expiry alerts" is a *feature of a suite the customer already has*, and the suites are racing to add AI. Do not compete there. Below 10 employees, every one of these has a pricing/complexity floor that makes them overkill or literally unavailable. That's the seam.

### c) Document management / AI-filing — the tech is commoditising

- **M-Files** advertises exactly your hook at enterprise level: AI auto-classifies documents and extracts "supplier name, document type, expiry dates and more" (https://www.m-files.com/m-files-platform/capabilities/artificial-intelligence/). Box, Templafy, Extend similar (https://www.box.com/collaboration/document-management, https://www.extend.ai/resources/best-document-classification-tools-enterprise).
- Generic DMS market: **$7.7–10.5B (2024/25) → ~$18–21B by 2030/31, ~13–16% CAGR**, with SaaS/SMB called out as the growth segment (https://www.grandviewresearch.com/industry-analysis/document-management-system-market-report, https://www.mordorintelligence.com/industry-reports/document-management-systems-market).

**Read:** "AI reads the doc, files it, extracts fields" is **not a defensible wedge on its own** — it is 2026's table stakes, available as an API to every competitor. What's still scarce is the *packaging*: photo-first, multilingual, zero-setup, priced for a 3-person company. **[inference]**

### d) "Business vault" plays and adjacent categories

- **Trustworthy** (closest consumer analogue): $0 / $10 / $20 / $40 per month tiers, **explicitly family-only — no business/SMB tier exists** (https://www.trustworthy.com/pricing). Nobody has taken the family-vault UX downmarket-B2B. That's a white space *and* a warning: if it were an obvious win, the $30M-funded player would have tried it. **[inference]**
- **Vanta / Drata** (SOC 2 / ISO compliance automation): $7.5k–$250k/yr (https://soc2auditors.org/insights/soc-2-software-pricing-comparison/). Different job (security frameworks for tech companies) — not a competitor, but proof that "compliance evidence, automated" commands serious money.
- **Payna (YC W26)**: "The AI Licensing and Compliance Team for Regulated Companies" — files and auto-renews US state licenses (https://www.ycombinator.com/companies/industry/compliance). Validates the thesis; different geography and segment.
- **South Africa**: **Govchain** is the one to watch — R950 company registration, free compliance dashboard, monthly plans scaling with headcount/turnover, positioning toward an integrated platform handling "SARS, CIPC, COID, B-BBEE and tenders" (https://www.govchain.co.za/pricing, https://www.govchain.co.za/blog/best-small-business-accounting-software-in-south-africa-2026-buyers-guide). Plus SMTAX, ClearComply, AdminBoss — all filings-as-a-service, none document-vault-first.
- **Austrian 24h-care agency software**: **CareOrganise** (SaaS for Vermittlungsagenturen: contacts, placements, forms/PDF archiving, billing, DSGVO-hosted in EU — no visible AI, no visible cert-expiry engine, no public pricing: https://www.careorganise.com/home), **Manacare** (https://www.manacare.at/), **E-Care/Care-Ring** (https://www.care-ring.or.at/leistungen/software-fuer-den-pflegesektor/). These are placement/billing tools; none leads with "photograph the document and it files itself." **[inference from public feature pages]**
- **US home-care compliance**: MedTrainer (credentialing, audit-ready records: https://medtrainer.com/products/credentialing/), CareAcademy (training + compliance tracking, tiered plans: https://careacademy.com/pricing/) — proof a whole vertical pays for exactly this job, in a market you're not in.

### Landscape verdict

"AI reads the doc + tracks expiry" is **already commoditised as technology** and **already monetised as a horizontal product** (Expiration Reminder et al.). It is **not commoditised as a photo-first, multilingual, micro-business product in the EU**, and it is **absent from the Austrian care-agency vertical stack**. The generic play is dead on arrival for a solo founder; the narrow play is genuinely open.

---

## 3. Separate product vs. "business mode" vs. don't

**The buyer and motion are different — treat this as a fact, not a nuance.** Consumer Family Vault sells on emotion (family safety, "finally organised") at €59/yr with zero-touch onboarding. A business version sells on *risk avoidance and audit-readiness*, gets asked about DPAs, data residency, roles/permissions, export, and "what happens when an employee leaves" — even at 5-person scale. Those conversations are demos and follow-ups, not app-store installs. **[inference, standard B2B/B2C distinction]**

Three options, honestly scored:

1. **Separate product now — NO.** You are a solo founder days from a consumer launch. A parallel B2B product means a second backlog, second sales motion, second compliance posture. This is the classic pre-launch focus killer.
2. **"Business mode" toggle inside the consumer app — NO (as a shipped feature).** Mixing family medical data and employer/employee records in one consumer product muddies GDPR roles (you'd be consumer service *and* B2B processor in one app), confuses positioning, and bloats the launch surface. **[inference]**
3. **Private dogfood of a business *workspace* on the same engine — YES.** The engine (Gemini extraction → person-filing → expiry tracking → reminders) is ~80% of the business MVP already. A hidden "organization" vault type, used only by you for the Austrian care business and Bhanu Pty, costs little, keeps the codebase single, and generates the demo asset you'd need for validation. No public launch, no pricing page, no support burden.

**Focus cost, stated plainly:** every week on B2B before the consumer app has its first 100 users is a week the consumer app doesn't get onboarding fixes, ASO, and referral loops. The consumer launch is the priority; the business experiment is a capped side-quest (≤ 2–4 days of build, because it reuses the engine). **[inference]**

---

## 4. Market and regulatory reality

**Market size (directional, not precise):**
- EU: SMEs are 99% of all EU businesses (https://single-market-economy.ec.europa.eu/smes/sme-fundamentals/sme-definition_en); the overwhelming majority are micro-firms with <10 staff (Statista series, paywalled: https://www.statista.com/statistics/878412/number-of-smes-in-europe-by-size/) — i.e., **tens of millions of EU businesses sit below the HR-suite floor**. **[order-of-magnitude inference from cited 99% + micro-majority]**
- DACH HR *document management* alone is projected around **$1.2B by 2032** (https://www.insightsleader.com/dach-hr-document-management-software-market/ — low-authority research shop, treat as directional only).
- Global DMS: $7.7–10.5B now → $18–21B by 2030/31 (§2c).
- South Africa: **~2.67M SMMEs, only ~⅓ formal**, supporting ~11.4M jobs (https://unctad.org/publication/national-entrepreneurship-strategy-south-africa, https://codera.co.za/how-many-businesses-are-there-in-south-africa/); mandatory **Beneficial Ownership filing since July 2024** with compliance notices and annual-return blocks for non-filers is generating fresh, real deadline anxiety (https://www.clearcomply.co.za/blog/beneficial-ownership-filing-cipc-south-africa). Pricing power is thinner (Govchain's free dashboard tier sets the anchor), but the deadline pain is state-manufactured and recurring.

**Pricing power [inference from comparables]:** a business tier at **€29–€49/month** (≈€350–600/yr, 6–10× consumer ARPU) undercuts Expiration Reminder's $49 entry while sitting far above consumer pricing — plausible for a micro-business that loses one contract or fails one audit otherwise.

**Regulatory: burden first, moat later.**
- Employee records are GDPR-heavier than family data *in role, not just content*: you become a **processor** under Art. 28 DPAs; retention schedules per document category are mandatory (storage-limitation, Art. 5(1)(e)); health-adjacent data (sick notes, care-sector fitness certificates) is **special-category data needing an Art. 9(2)(b) basis grounded in member-state employment law** (https://www.twobirds.com/en/twoventure/shared/insights/2024/global/special-categories-of-personal-data-in-hr-functions-climbing-the-ladder-of-legal-bases, https://www.igdpr.eu/en/employee-personal-data-gdpr/).
- DACH extra: works-council co-determination on anything monitoring-adjacent, documented consultation expected (https://www.gdprledger.com/guides/gdpr-for-hr-employers). Mostly bites at 50+ employees — your micro-target rarely has a Betriebsrat, which conveniently blunts the worst of it. **[inference]**
- Verdict: for a solo founder this is a **burden pre-revenue and a moat post-revenue**. You already run EU hosting, a server-side security model, and a named-DB Admin SDK setup for the consumer app — the delta (DPA template, retention auto-delete, role separation) is real but incremental, and it's exactly the checklist that keeps lazy competitors out of DACH. Don't pay that cost until a design partner is paying you.
- SA: POPIA imposes analogous duties; lighter enforcement in practice. **[inference]**

---

## 5. The sharpest wedge — and it's yours

**Generic "business vault" is the wrong product. "Compliance vault for 24-hour-care placement agencies (Austria first)" is the right first wedge.**

The vertical's shape, with numbers:

- **~57,000 self-employed personal carers** are registered with the WKO — its single largest member group — each a one-person business (Gewerbeschein, SVS, contracts, training certificates) (https://www.wko.at/oe/gewerbe-handwerk/personenberatung-betreuung/statistik, https://brandaktuell.at/2025/11/27/finanzen/personenbetreuerinnen-in-der-wko-ein-institutionalisierter-skandal/).
- **~1,121 Vermittlungsagenturen** (placement agencies) sit above them — mostly micro-businesses coordinating dozens of carers' documents each (WKO Firmen A-Z count via https://www.daheimbetreut.at/de/firmen-a-z).
- The **ÖQZ-24 quality certificate** (3-year validity, recertification, independent audit; ~43 agencies certified as of Nov 2023, state-subsidised first certification via WKO) is an explicit, growing document-and-process audit regime for exactly these agencies (https://oeqz.at/, https://www.sozialministerium.gv.at/Ministerium/Preise-und-Guetesiegel/OEQZ24-Oesterreichisches-Qualitaetszertifikat-fuer-Vermittlungsagenturen-in-der-24-Stunden-Betreuung.html, https://www.wko.at/gewerbe-handwerk/personenberatung-betreuung/foerderrichtlinien).
- The incumbent agency software (CareOrganise, Manacare, E-Care) does placements and billing; none visibly does AI-photo-ingest with expiry intelligence (§2d). The US proves the vertical pays for compliance tracking (MedTrainer, CareAcademy).

**Why you specifically:** you run one of these businesses, in German-speaking Austria, with the documents already in your drawer; you speak the buyer's language literally and operationally; your app already ships 9 languages (carers are largely Romanian/Slovak/Hungarian speakers — multilingual document handling is a real differentiator here, not a checkbox) **[inference from cited demographic: carers are "almost exclusively women from Eastern European countries", https://brandaktuell.at/2025/11/27/finanzen/personenbetreuerinnen-in-der-wko-ein-institutionalisierter-skandal/]**. A generic vault founder can't cold-email 1,121 agencies credibly. You can walk in as a peer.

**MVP scope (if validation passes):** organization vault + member (carer/employee) profiles + photo-ingest of Gewerbeschein/certificates/contracts/insurance + expiry dashboard + audit-export PDF ("ÖQZ-24 binder in one click"). That last item is the demo moment. Explicitly *not* in MVP: payroll, scheduling, billing — never compete with CareOrganise/Personio on their turf; integrate or coexist.

---

## 6. Recommendation and concrete first step

**Verdict: Pursue — but as a sequenced, gated experiment, not a product decision today.**

1. **Now → consumer launch: do nothing on B2B.** Ship Family Vault. This outranks everything.
2. **Within 30 days post-launch (≤ 2–4 dev-days):** hidden "organization" vault type on the existing engine; migrate your own care business's real paperwork into it (agency docs + a handful of carers' credential sets, with consent). You are customer zero; the app must survive your own audit season.
3. **Validation sprint (2–3 weeks, sales not code):** demo to 5–10 Viennese/Austrian Vermittlungsagenturen from your network. One question: *"€39/month and your ÖQZ/annual paperwork never expires silently — do you want this?"* Collect prepayments or LOIs, not compliments.
4. **Gate:** **≥3 of 10 agencies commit → build the vertical MVP (§5) as "Family Vault for Care Agencies" (separate SKU, same codebase). <3 → park it**, keep the org-vault for your own two companies as internal tooling, and revisit after the consumer app reaches sustainable traction.
5. **South Africa: explicitly later.** Real deadline pain (BO filings, CIPC penalties) but thinner pricing power and Govchain already converging on it; only worth entering with a differentiated angle after DACH validation.

## 7. Risks and the focus warning

1. **Focus (the big one).** You are a solo founder *pre-launch*. The consumer app dies of neglect faster than the business idea expires. Everything in §6 is deliberately capped and sequenced; if the consumer launch needs firefighting, the B2B experiment slips — in that order, always.
2. **Commoditisation race.** Personio/Rippling/Expiration Reminder are all bolting on AI extraction; the horizontal window is closing. Mitigation: the vertical (audit-binder for care agencies, multilingual carer docs) is defended by domain workflow, not by the AI. **[inference]**
3. **GDPR/processor overhead lands early in B2B.** First paying agency = first DPA, retention schedule, and deletion workflow. Budget a real week for it; don't improvise it post-hoc.
4. **Small-N vertical.** 1,121 agencies × €39/mo ≈ €520k/yr TAM in Austria alone if you took 100% — this is a wedge and a proof, not the end market. Expansion paths: German agencies, other cert-heavy micro-verticals (Handwerk, with its 2027 documentation tightening), the 57k carers themselves as a prosumer tier. **[inference; arithmetic from cited counts]**
5. **Two-product brand risk.** "Family Vault" as a name doesn't stretch to B2B. If the gate passes, ship it under a sibling name — same engine, separate front door. **[inference]**
