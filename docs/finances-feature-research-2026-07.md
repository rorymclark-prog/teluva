# Family Vault — "Family Finances" Feature Research Memo

**Date:** 2026-07-17 · **Author:** product-strategy research (Claude) · **Decision owner:** Rory
**Question:** Should Family Vault add (1) live bank feeds, (2) receipt/slip OCR, (3) AI expense analysis + advice, (4) all-members-see-all shared family balances — before or after publishing?

Method note: facts below are cited inline as URLs (searched 2026-07-17). Where a claim is my inference rather than a sourced fact, it is marked **[inference]**. Where a number could not be verified publicly (aggregator contract pricing), it is marked **[estimate]**.

---

## TL;DR verdict

**Phased go — ship the camera, not the bank connection, and never ship "everyone sees everyone's balances" as specified.** Receipt/slip OCR into a household running-costs ledger is a genuine pre-launch winner: it needs no licence, no aggregator contract, reuses the Gemini vision pipeline you already have, and is the purest possible expression of "the family vault that fills itself." Live bank feeds are the opposite: the free EU aggregator route startups used (Nordigen/GoCardless) is closed to new signups and being wound down, every remaining option is a sales-negotiated contract with KYB and ongoing per-account costs against a €59/yr all-inclusive price, PSD2 compliance and 180-day re-authentication create a permanent support tax, and the regime itself is mid-rewrite (PSD3 + FiDA in trilogue). Meanwhile the two apps closest to "shared family money" — Zeta and Honeydue — both died in 2025, and the one that thrives (Monarch, $99.99/yr, $850M valuation) charges more for money-management alone than Family Vault's entire subscription. Cross-visibility of balances is a trust landmine (40% of partnered adults admit financial infidelity) and a PSD2/GDPR consent problem; the defensible version is opt-in, per-account, adults-only sharing. Ship Phase 1 (OCR expenses + descriptive AI summaries) with the launch; put bank feeds behind a waitlist and only build them post-launch if paying users demand it.

---

## 1. Competitive findings (2025–26)

### 1.1 The graveyard: family/couples money apps that died in the last 18 months

- **Zeta** (family/couples joint banking, US) — shut down; users were given 30 days' notice to move funds out by **May 9, 2025** ([thecollegeinvestor.com/24184/zeta-review](https://thecollegeinvestor.com/24184/zeta-review/)).
- **Honeydue** (the canonical couples-finance app, free, ad/partner-supported) — **shut down August 2025** ([justuseapp.com/en/app/1157633945/honeydue-couples-finance/problems](https://justuseapp.com/en/app/1157633945/honeydue-couples-finance/problems); Forbes review of the app: [forbes.com/advisor/banking/honeydue-budgeting-app-review](https://www.forbes.com/advisor/banking/honeydue-budgeting-app-review/)).
- **Mint** (free, ad-supported PFM) — closed by Intuit in early 2024 ([cnbc.com/2025/05/23/personal-finance-app-monarch-raises-75-million.html](https://www.cnbc.com/2025/05/23/personal-finance-app-monarch-raises-75-million.html)).

**Pattern [inference]:** free/cheap shared-money products with bank-feed cost structures die; the survivors charge ~$100/yr for money management as the *whole product*, not a side feature.

### 1.2 The winners, and what they actually charge

| App | Price (2025–26) | Family/shared angle |
|---|---|---|
| **Monarch** | $99.99/yr Core, $199/yr Plus, $14.99/mo monthly ([monarch.com/pricing](https://www.monarch.com/pricing)) | "Household" sharing included — invite partner/family/advisor at no extra cost; unlimited collaborators, shows who made each transaction |
| **Copilot Money** | $95/yr or $13/mo, single tier, iOS/Mac only ([copilot.money/pricing](https://copilot.money/pricing/)) | Individual-first; no household model comparable to Monarch |
| **YNAB** | $109/yr or $14.99/mo; **YNAB Together** shares with up to 5 others at no extra cost, ages 13+ US / 16+ elsewhere ([ynab.com/pricing](https://www.ynab.com/pricing), [support.ynab.com — YNAB Together guide](https://support.ynab.com/en_us/ynab-together-B1nS78Cki)) | Group manager chooses *which plans to share with which members* — selective, not all-see-all |
| **Origin** | $99/yr (promo $1 first year), AI "Sidekick" advisor ([useorigin.com](https://useorigin.com/), [robberger.com/origin-review](https://robberger.com/origin-review/)) | AI advice is the hook; operates in the US advice regime, not EU |
| **Greenlight** (kids' money, US) | $5.99–$19.98/mo per family ([greenlight.com/plans](https://greenlight.com/plans)) | Parents see/control kids' money; **kids do not see parents' accounts** — visibility is one-directional by design |
| **Emma** (UK/EU) | Free + Plus £5.99 / Pro £9.99 / Ultimate £14.99 per month ([moneytothemasses.com Emma review](https://moneytothemasses.com/banking/emma-review-is-it-the-best-budgeting-app)) | Individual PFM on open banking |
| **Plum / Snoop** (UK) | Plum free + £3.99–£11.99/mo; Snoop free + £4.99/mo ([theinvestorscentre.co.uk best budgeting apps](https://www.theinvestorscentre.co.uk/investing/best-budgeting-apps-in-the-uk/)) | Individual; autosaving/insights hooks |
| **Frollo** (Australia) | Free consumer app; primarily a B2B CDR open-banking platform — different market and regime, not directly comparable **[inference from positioning]** | — |
| **Finanzguru** (DACH — the local incumbent) | Free + Plus **€2.99/mo**; connects **3,000+ German/Austrian/Swiss banks** via PSD2, auto-detects contracts and subscriptions ([banktrack.com/en/blog/bank-tracker-germany](https://banktrack.com/en/blog/bank-tracker-germany), [monavio.app/blog/best-budget-apps-europe](https://monavio.app/blog/best-budget-apps-europe/)) | This is who you'd actually be competing with in Vienna on bank feeds |
| **Spendee** (Czech, EU-wide) | Free + premium ~€5.50/mo; **shared wallets** for couples/families/roommates; bank sync via Salt Edge ([spendee.com/pricing](https://www.spendee.com/pricing), [getfinny.app/blog/best-euro-expense-trackers-2026](https://getfinny.app/blog/best-euro-expense-trackers-2026)) | Closest EU model to "family money" — shared *wallets*, not shared *bank balances* |

Monarch is the proof that paid family money-management works: subscriber base grew **20×** in the year after Mint's shutdown announcement, 500k+ paying subscribers, **$75M Series B at $850M valuation (May 2025)** ([cnbc.com](https://www.cnbc.com/2025/05/23/personal-finance-app-monarch-raises-75-million.html), [monarch.com/blog/series-b](https://www.monarch.com/blog/series-b)). But note what it charges: **$99.99/yr for money alone — ~1.5× Family Vault's entire planned €59/yr.** You cannot absorb Monarch's cost structure (bank aggregation fees, sync support) inside a €59 bundle. **[inference]**

### 1.3 The vault-side competitors (your actual category)

- **Trustworthy** ("The Family Operating System", the closest US analogue to Family Vault): Free / Silver $10/mo / Gold $20/mo / Platinum $40/mo, **paid annually → $120–$480/yr** ([trustworthy.com/pricing](https://www.trustworthy.com/pricing)). Reviews describe connecting insurance/financial *account information* for organization and AI reminders — it is an organizer with account records, **not a transaction-feed PFM** ([benzinga.com/money/trustworthy-review](https://www.benzinga.com/money/trustworthy-review), [quicken.com blog on family platforms](https://www.quicken.com/blog/best-family-information-and-asset-management-platforms-for-2026/)). **[partly inference — Trustworthy's exact feed depth is not publicly documented]**
- **Cozi** (family organizer, 20M+ families): Gold $39/yr; calendar, lists, meals — **no money features at all** ([cozi.com/feature-overview](https://www.cozi.com/feature-overview/), [ourcal.com/blog/cozi-app-review-2025](https://ourcal.com/blog/cozi-app-review-2025)).

**Competitive conclusion:** No family-*organizer* competitor does live bank feeds; the family-*money* apps that do feeds either charge ≥ $95/yr for money alone or are dead. The white space Family Vault can own cheaply is the middle: **household costs, receipts, contracts and financial *records* inside the vault** — exactly where Trustworthy ($120–480/yr) and Cozi ($39/yr, nothing) leave a gap in the EU, and something Finanzguru (accounts, no vault) doesn't do either.

---

## 2. EU/Austria open-banking reality

### 2.1 The licence question

To provide account information services (AIS) under PSD2 you must be a registered **AISP** (PSD2 Art. 33 registration: no minimum capital, but professional-indemnity insurance and national registration — in Austria with the FMA) — **or** ride on a licensed provider. Aggregators explicitly sell "licence as a service" / TPP-infrastructure models so the app itself doesn't hold the registration ([advapay.eu PSD2 licence explainer](https://advapay.eu/psd2-license-payment-service-directive-explained-service-types-of-license-application/), [finapi.io/en/products/open-banking/psd2-license](https://www.finapi.io/en/products/open-banking/psd2-license/), [crassula.io AISP guide](https://crassula.io/guides/licenses/aisp/)). Practical path for a solo founder is unambiguous: **use a licensed aggregator; never seek your own AISP registration.** Even so, you inherit contractual compliance duties (consent flows, data handling, audit answers) as the aggregator's client. **[inference from standard aggregator contracts]**

### 2.2 What aggregation actually costs in 2026

The era of free EU bank data is over:

- **GoCardless Bank Account Data (ex-Nordigen)** — the free tier that powered a generation of side-project PFMs is **"closed to new signups and being wound down"**; GoCardless's own page disables new signups ([openbankingtracker.com/guides/free-open-banking-apis](https://www.openbankingtracker.com/guides/free-open-banking-apis), [forum.invoiceninja.com thread on the shutdown](https://forum.invoiceninja.com/t/gocardless-nordigen-service-no-longer-available-alternative-needed/22576)).
- **Enable Banking** (Finnish; 2,700+ banks in 30 countries incl. Austria — Erste/George and Raiffeisen "Mein ELBA" have documented Austria connectors): free tier is **"restricted production" — only bank accounts you link yourself**; real production requires a **signed contract + KYB**, pricing quoted per AIS-call volume, not published ([enablebanking.com/docs/markets/at](https://enablebanking.com/docs/markets/at/), [openbankingtracker free-APIs guide](https://www.openbankingtracker.com/guides/free-open-banking-apis), [github.com/api-evangelist/enable-banking pricing notes](https://github.com/api-evangelist/enable-banking/blob/main/plans/enable-banking-plans-pricing.yml)).
- **Tink, TrueLayer, Salt Edge, finAPI** — all custom/sales-negotiated; none publishes usable prices ([tink.com/pricing](https://tink.com/pricing/), [blog.finexer.com/salt-edge-pricing](https://blog.finexer.com/salt-edge-pricing/), [finapi.io/en/prices](https://www.finapi.io/en/prices/)). Third-party benchmarks put per-link costs around **$1.50–$2.00 at low volume** (Plaid Auth, US figures) ([todapay.com provider comparison](https://todapay.com/blog/top-open-banking-api-providers-ranked/)). **[estimate]** For AIS in the EU, expect an order of €0.30–€1.00 per connected account per month at small volume plus minimum commitments — against €59/yr (~€4.90/mo) ARPU for the *whole app*, a family connecting 5–10 accounts could consume most or all of the subscription margin. **[estimate/inference]**
- **Klarna Kosma** — not an option to shortlist: the Kosma brand was folded back into Klarna in mid-2023; it was a rebrand, not a shutdown, but there is no self-serve Kosma product to buy ([finextra.com/newsarticle/42716](https://www.finextra.com/newsarticle/42716/klarna-ditches-open-banking-brand), [tech.eu/2023/07/31/klarna-scraps-open-banking-brand-klarna-kosma](https://tech.eu/2023/07/31/klarna-scraps-open-banking-brand-klarna-kosma/)).

**Austrian coverage** is fine through the majors: Erste Bank (George), Raiffeisen (Mein ELBA federated model), BAWAG P.S.K., easybank are all covered by mainstream aggregators ([enablebanking.com/docs/markets/at](https://enablebanking.com/docs/markets/at/), [fintable.io Nordigen Austria coverage](https://fintable.io/coverage/banks/Austria/7088_erste-bank-der-oesterreichischen-sparkassen-ag), [openbankingtracker.com/country/austria](https://www.openbankingtracker.com/country/austria) — 457 banks tracked, 34 aggregators serving Austria). Coverage is not the problem; cost and operations are.

### 2.3 The operational tax

- **Re-authentication:** PSD2 SCA for AIS access must be renewed every **180 days** (EBA amended the RTS from 90 days; banks had to implement by July 25, 2023) ([projectivegroup.com PSD2 alert](https://www.projectivegroup.com/psd2-alert-authentication-period-for-account-information-services-extended-to-180-days/), [eba.europa.eu final report](https://www.eba.europa.eu/publications-and-media/press-releases/eba-publishes-final-report-amendment-its-technical-standards)). Every family member re-authing every bank twice a year, in 9 languages, is a recurring support and churn event.
- **Sync breakage is the #1 complaint even for the best-funded player:** "Sync reliability is the most common complaint about Monarch" ([envelopebudgeting.com Monarch review](https://envelopebudgeting.com/articles/monarch-money-review)); broken connections are the top cause of missing transactions across budget apps generally ([goodbudget.com help](https://goodbudget.com/help/automatic-bank-sync/i-linked-an-account-but-transactions-arent-showing-up/), [budgetpeer.com on why people stop connecting banks](https://www.budgetpeer.com/blog/why-people-stop-connecting-their-bank-to-budget-apps-(and-what-they-do-instead))). Monarch has a support team for this; Family Vault has one founder.
- **The regime is mid-rewrite:** PSD3 is expected ~2026 and **FiDA** (Financial Data Access Regulation — open *finance*, wider than payment accounts) is in trilogue with adoption widely expected ~mid-2026 and phased application 2027–2030 ([financial-data-access.com](https://www.financial-data-access.com/), [finance.ec.europa.eu FiDA framework](https://finance.ec.europa.eu/digital-finance/framework-financial-data-access_en), [capco.com FiDA primer](https://www.capco.com/intelligence/capco-intelligence/fida-primer-for-2026-and-beyond), [openbankingtracker.com/country/austria](https://www.openbankingtracker.com/country/austria)). Building a bank-feed integration now means rebuilding parts of it under the new regime. Waiting costs you nothing; FiDA will *widen* what you can access later (savings, investments, insurance).

### 2.4 GDPR — sharper than it looks for this feature

- **Transaction data leaks special-category data.** The EDPB's Guidelines 06/2020 on the PSD2/GDPR interplay state that summed transactions can reveal Art. 9 data — e.g. **church donations (religion), trade-union dues, pharmacy/medical payments** — requiring explicit consent or technical measures to prevent such processing, plus handling rules for "silent party" data (the people your users transact with) ([edpb.europa.eu Guidelines 06/2020 PDF](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_202006_psd2_afterpublicconsultation_en.pdf), [timelex.eu summary](https://www.timelex.eu/en/blog/edpb-clarifies-interplay-between-gdpr-and-psd2)). Family Vault already holds medical data; adding transaction feeds concentrates even more Art. 9-adjacent data in one Firestore.
- **Children:** Austria's DSG sets the digital age of consent at **14**; below that, parental consent is required, and offering online services to children is on the Austrian DPA's DPIA blacklist ([linklaters.com Data Protected Austria](https://www.linklaters.com/en/insights/data-protected/data-protected---austria), [gdprlocal.com digital age of consent](https://gdprlocal.com/digital-age-of-consent-under-the-gdpr/)). A "family finances" feature visible to child accounts forces a DPIA and a hard think about what minors may see and what may be processed about them. A DPIA is advisable for the finance feature regardless. **[inference from the blacklist categories: financial data + children + profiling]**
- **The "advice" line:** In the EU, personalized recommendations relating to **financial instruments** are MiFID II investment advice — and regulators treat algorithm-delivered advice identically to human advice; there is no "lite" regime for robo-advice ([europarl.europa.eu robo-advisors study](https://www.europarl.europa.eu/RegData/etudes/STUD/2021/662928/IPOL_STU(2021)662928_EN.pdf), [finorum.com/robo-advisors-europe-2026](https://finorum.com/robo-advisors-europe-2026/)). **Descriptive analytics and generic budgeting education are outside MiFID II** ("your energy costs rose 18%"; "households typically save X by switching") — but "you should invest in / buy fund X", personalized pension or insurance product recommendations (IDD territory — relevant since the app stores insurance policies), or credit recommendations would cross into regulated activity. **[the safe/unsafe line itself is inference from the cited framework; the framework facts are sourced]** Gemini's system prompt must enforce this boundary explicitly.

---

## 3. The shared-balances question (part 4 of the proposal)

**As specified — "every family member can see how much money is in ALL the family's accounts, including each other's" — this is a landmine, and nobody who succeeded built it that way.**

Evidence for the landmine:

- **40% of US adults in committed relationships admit financial infidelity** against their current partner; **15% keep a savings account their partner doesn't know about**; Gen Z is at 67% ([bankrate.com financial infidelity survey 2025](https://www.bankrate.com/credit-cards/news/financial-infidelity-survey-2025/)). Forced total visibility collides head-on with how a large minority of real couples actually behave — they won't connect their accounts; they'll just not use the feature, or not install the app. **[final step is inference]**
- **The only app built around couple visibility made partial visibility its core design:** Honeydue let each partner choose per-account how much to share — "show just the balance of a credit card and not transactions" ([nerdwallet.com Honeydue review](https://www.nerdwallet.com/finance/learn/honeydue-app-review)). Even with that, it's dead (Aug 2025).
- **The winners are selective too:** YNAB Together's group manager "can choose which plans to share with individual members" ([support.ynab.com](https://support.ynab.com/en_us/ynab-together-B1nS78Cki)); Monarch households are opt-in collaborators invited by the subscriber ([monarch.com/pricing](https://www.monarch.com/pricing)); Greenlight gives parents oversight of kids — never the reverse ([greenlight.com/plans](https://greenlight.com/plans)). **No mainstream product exposes all balances to all family members symmetrically, including children. [inference from surveyed products]**
- **Regulation points the same way.** PSD2 Art. 67 restricts the AISP to using data for the service the *consenting user* requested; sharing that user's account data with "another person" requires separate explicit instruction/consent from that user ([truelayer.com data-chain blog](https://truelayer.com/blog/open-banking/data-chain-agents/), [EDPB Guidelines 06/2020](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_202006_psd2_afterpublicconsultation_en.pdf)). "All members see all accounts" as a *default* is likely non-compliant; per-person, per-account opt-in is the only defensible design. **[compliance conclusion is inference from cited sources]**

And the counter-evidence — visibility is genuinely valuable *between committed partners*: a randomized 2-year study (230 couples, Indiana University / Journal of Consumer Research "Common Cents") found couples assigned to merge accounts reported substantially higher relationship quality; notably, *partial* merging didn't confer the same benefit ([news.iu.edu](https://news.iu.edu/live/news/28244-married-couples-who-merge-finances-may-be-happier), [academic.oup.com JCR paper](https://academic.oup.com/jcr/article/50/4/704/7077142)). YouGov similarly finds joint accounts correlate with marital happiness ([business.yougov.com](https://business.yougov.com/content/48734-joint-bank-accounts-correlate-with-higher-marital-happiness-among-americans)).

**Net read:** transparency between *the couple* is a real draw; visibility across *the whole family tree* (teens, grandparents, the brother-in-law in the shared vault) is what no one wants and what kills adoption. Build "shared with whom I choose," market it as "one picture of the family's money — each adult decides what they share." Children under 14 shouldn't see family balances at all (GDPR posture + no product benefit). **[recommendation = inference]**

---

## 4. Recommendation: phased go

### Phase 1 — ship with launch: "Household costs that file themselves" (build now, ~1–3 weeks) ✅

The MVP that captures most of the value with none of the regulatory surface:

1. **Receipt/slip OCR → expense ledger.** Photograph a receipt/invoice → Gemini (existing vision proxy) extracts merchant, date, amount, currency, category → files the image in the vault and the line-item into a new `expenses` collection hanging off the existing `FinancesInfo` model (`src/components/FinancesView.tsx` today is a static banks/insurance/benefits registry — this upgrades it from filing cabinet to ledger).
2. **Running-costs dashboard.** Monthly recurring costs (rent, energy, insurance, subscriptions) — seeded manually or detected from repeated receipts/invoices; renewal/expiry reminders reuse the existing document-expiry pattern. This is Finanzguru's beloved contract-detection hook, done vault-style without bank access.
3. **AI monthly money summary (descriptive only).** "Your household spent €X on groceries, up 12%; the ÖGK invoice is due Tuesday." Hard system-prompt boundary: no investment/insurance/credit product recommendations (MiFID II/IDD line, §2.4).
4. **Privacy defaults:** finance data visible to *adult* roles only by default; per-item override. Children's accounts see nothing financial.
5. **Bank-feeds waitlist toggle.** A "Connect your bank — coming soon" card with a one-tap register-interest. This converts the go/no-go on Phase 2 from opinion into data.

Cost: near-zero marginal (Gemini calls you already pay for). Risk: near-zero. Positioning: perfect — "the family vault that fills itself" now includes the money drawer.

### Phase 2 — post-launch, demand-gated: bank feeds for adults, opt-in shared visibility ⏳

Trigger: meaningful waitlist signal (e.g. >20–30% of active families tap the card **[arbitrary threshold — inference]**) *and* revenue to fund it. Then:

- One aggregator, EU-first shortlist: **Enable Banking** (free restricted-production tier lets you build and demo against your own Austrian accounts before signing anything), vs. **finAPI** (DACH depth, publishes prices) vs. **Salt Edge** (breadth; powers Spendee). Not GoCardless BAD (closed), not Tink/TrueLayer first (enterprise sales posture). **[shortlist ranking is inference from sourced facts]**
- Priced as a **paid add-on above €59/yr** (e.g. +€3–4/mo "Family Money" tier), because aggregator costs are per-account recurring. Monarch/Finanzguru anchor the willingness-to-pay range. **[estimate]**
- Sharing model: per-account, per-person opt-in by the account owner; adults only; balance-only vs. balance+transactions granularity (Honeydue's one good idea).
- Before build: DPIA, records-of-processing update, and Gemini kept away from raw transaction streams until the special-category filtering question (§2.4) is designed.

### Never (in the proposed form) ❌

- **Symmetric all-members-see-all-balances** — replaced by the opt-in design above.
- **Personalized financial product advice** — the AI stays descriptive/educational.
- **Own AISP registration** — always via a licensed aggregator.

---

## 5. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Phase 1 scope creep delays the launch the app is "about to" make | High | Phase 1 is additive to an existing view; if it slips, launch without it — it's a fast-follow, not a launch blocker. **[judgment]** |
| Receipt OCR accuracy in 9 languages (Austrian German receipts, Handschrift, thermal-paper fade) misfiles expenses and erodes trust | Medium | Always show extracted fields for one-tap confirm before saving (the passport-scan flow already sets this UX pattern); log corrections to tune prompts |
| GDPR concentration risk: one breach now exposes medical + IDs + money in one place | Medium–High | DPIA before Phase 1 ships to minors' views; keep finance adult-scoped; revisit encryption-at-field-level for amounts **[inference]** |
| AI summary drifts into regulated advice ("you should move this into ETFs") | Medium | System-prompt guardrail + refusal tests in CI; the MiFID II line is only safe if enforced ([europarl robo-advice study](https://www.europarl.europa.eu/RegData/etudes/STUD/2021/662928/IPOL_STU(2021)662928_EN.pdf)) |
| Phase 2 unit economics: aggregator per-account fees exceed add-on revenue at small scale | High (if built) | Demand-gate + priced add-on; negotiate startup terms; start Austria-only coverage before 9-market rollout **[estimate/inference]** |
| Phase 2 support burden: 180-day re-auth + sync breakage lands on a solo founder ([EBA 180-day rule](https://www.projectivegroup.com/psd2-alert-authentication-period-for-account-information-services-extended-to-180-days/); Monarch's top complaint is sync ([envelopebudgeting.com](https://envelopebudgeting.com/articles/monarch-money-review))) | High (if built) | Only build post-launch with revenue; in-app self-serve re-auth flows; status page per bank |
| Regulatory churn: PSD3/FiDA reshape the access regime 2027–2030 ([financial-data-access.com](https://www.financial-data-access.com/)) | Medium | Waiting on Phase 2 turns this from risk into upside (FiDA widens accessible data to savings/investments/insurance) |
| Family trust dynamics: a badly-designed sharing default causes a public "this app let my husband see my account" story | High reputational | Opt-in only, owner-controlled granularity, children excluded; never default-on ([Bankrate: 40% financial infidelity](https://www.bankrate.com/credit-cards/news/financial-infidelity-survey-2025/)) |

---

## Appendix: source list (primary URLs)

Competitive: [monarch.com/pricing](https://www.monarch.com/pricing) · [cnbc.com Monarch $75M](https://www.cnbc.com/2025/05/23/personal-finance-app-monarch-raises-75-million.html) · [copilot.money/pricing](https://copilot.money/pricing/) · [ynab.com/pricing](https://www.ynab.com/pricing) · [support.ynab.com YNAB Together](https://support.ynab.com/en_us/ynab-together-B1nS78Cki) · [useorigin.com](https://useorigin.com/) · [greenlight.com/plans](https://greenlight.com/plans) · [thecollegeinvestor.com Zeta shutdown](https://thecollegeinvestor.com/24184/zeta-review/) · [nerdwallet.com Honeydue](https://www.nerdwallet.com/finance/learn/honeydue-app-review) · [trustworthy.com/pricing](https://www.trustworthy.com/pricing) · [cozi.com](https://www.cozi.com/feature-overview/) · [spendee.com/pricing](https://www.spendee.com/pricing) · [banktrack.com Finanzguru](https://banktrack.com/en/blog/bank-tracker-germany) · [moneytothemasses.com Emma](https://moneytothemasses.com/banking/emma-review-is-it-the-best-budgeting-app)

Open banking/regulatory: [openbankingtracker.com free-APIs guide](https://www.openbankingtracker.com/guides/free-open-banking-apis) · [enablebanking.com/docs/markets/at](https://enablebanking.com/docs/markets/at/) · [finapi.io PSD2 licence-as-a-service](https://www.finapi.io/en/products/open-banking/psd2-license/) · [advapay.eu PSD2 licences](https://advapay.eu/psd2-license-payment-service-directive-explained-service-types-of-license-application/) · [projectivegroup.com 180-day SCA](https://www.projectivegroup.com/psd2-alert-authentication-period-for-account-information-services-extended-to-180-days/) · [EBA RTS amendment](https://www.eba.europa.eu/publications-and-media/press-releases/eba-publishes-final-report-amendment-its-technical-standards) · [financial-data-access.com FiDA](https://www.financial-data-access.com/) · [finance.ec.europa.eu FiDA](https://finance.ec.europa.eu/digital-finance/framework-financial-data-access_en) · [EDPB Guidelines 06/2020](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_202006_psd2_afterpublicconsultation_en.pdf) · [timelex.eu EDPB summary](https://www.timelex.eu/en/blog/edpb-clarifies-interplay-between-gdpr-and-psd2) · [linklaters.com Austria DSG](https://www.linklaters.com/en/insights/data-protected/data-protected---austria) · [truelayer.com data-chain](https://truelayer.com/blog/open-banking/data-chain-agents/) · [europarl.europa.eu robo-advisors](https://www.europarl.europa.eu/RegData/etudes/STUD/2021/662928/IPOL_STU(2021)662928_EN.pdf)

Shared-balances evidence: [bankrate.com financial infidelity 2025](https://www.bankrate.com/credit-cards/news/financial-infidelity-survey-2025/) · [news.iu.edu merged-finances RCT](https://news.iu.edu/live/news/28244-married-couples-who-merge-finances-may-be-happier) · [academic.oup.com JCR "Common Cents"](https://academic.oup.com/jcr/article/50/4/704/7077142) · [business.yougov.com joint accounts](https://business.yougov.com/content/48734-joint-bank-accounts-correlate-with-higher-marital-happiness-among-americans) · [envelopebudgeting.com Monarch sync complaints](https://envelopebudgeting.com/articles/monarch-money-review) · [budgetpeer.com why people stop connecting banks](https://www.budgetpeer.com/blog/why-people-stop-connecting-their-bank-to-budget-apps-(and-what-they-do-instead))
