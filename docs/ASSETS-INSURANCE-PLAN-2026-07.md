# Family Vault — Assets, Insurance & "Coverage Guardian" plan

*Prepared 2026-07-18. Grounded in three verified research passes (insurer/theft‑claim requirements; the legality of an AI answering questions about a user's insurance/financial documents; and policy obligations + security standards). Sources at the end.*

> **The one-line idea:** stop treating Assets, insurance policies, leases and contracts as separate boxes. They're all **important documents the family must find fast and ask questions about.** Build **one document system + an AI that can read any of it** — safely — and layer a **Coverage Guardian** that keeps you compliant with your policies.

---

## 1. Your four questions, answered

| You asked | Answer | Why |
|---|---|---|
| **Photos on assets?** | **Yes — and it's already half-built.** `AssetItem.photoDataUrl` exists and renders; the box icons just mean those items have no photo yet. Add **multiple** photos + the *right* ones. | Insurers accept a dated photo as fallback proof of ownership everywhere researched. Capture: the **item**, the **serial/data plate** (close-up), and the **receipt**. |
| **ISBN / serial numbers?** | **Yes — but the right identifier *per category*, not just ISBN.** | Serial plate matches recovered goods to owners (police registers). Per category: **IMEI** (phones), **serial** (electronics), **VIN/frame number** (vehicles/bikes), **ISBN + edition** (rare books), **GIA/cert number** (jewellery). |
| **Assets under each profile?** | **Yes.** `assignedMember` already exists — surface each person's items on their profile. | Natural home ("Rumi's bike"), and it makes ownership provable per person. |
| **In family docs?** | **Yes.** Receipts, appraisals and policy PDFs flow into the document vault; one **canonical claim list** exports to both police *and* insurer. | If the list you give police differs from the insurer's, **payouts get cut 20–40%.** One source of truth is the single highest-value design decision here. |

---

## 2. What insurers actually need → the Assets upgrade

Insurers pay a **theft** claim fastest when you can independently prove three things: **(1) you owned it, (2) what it was worth, (3) a real theft happened.** Build Assets to produce exactly that evidence bundle, per item, automatically.

**Fields to add (research-ranked):**

- **Must-have:** item name · make · model · **serial/IMEI/engraving** · original purchase price · **receipt/invoice attachment** · **dated photo of the item** · **police crime-reference number** + date of loss · **canonical exportable claim list** · **off-premises/cloud backup** (✅ you already have this).
- **High-value:** professional **appraisal/valuation** attachment (jewellery/art/watches, roughly > €1,000/item) · **single-item-limit flag** (does it exceed the policy's sub-limit?) · **storage/security condition** (open / locked / rated safe class) · **current replacement value** (cover is usually *new-for-old* / *Neuwert*) · **forced-entry photos** (Austria: theft cover often needs *Einbruchsspuren*).
- **Nice:** warranty doc + expiry · purchase location · condition · box/packaging photo · **post-payout repurchase-receipt slot** (needed to claim the *Neuwertspitze* top-up) · property-register reference.

**Two features that punch above their weight:**

1. **One canonical, timestamped claim list** → export *identically* to police and insurer (PDF/CSV). Removes the #1 cause of reduced payouts.
2. **Property-register export** (UK Immobilise/BikeRegister and equivalents) — a formatted export police can match recovered goods against.

**Currency + numeric price:** today `purchasePrice` is a free-text string (`"€450"`). Add a numeric value + ISO currency so totals, sub-limit checks and under-insurance flags actually work.

---

## 3. The document vault taxonomy (add **Insurance** + **Legal**)

Your vault already has Identity, Medical, Education, Financial, Travel. Add two categories and one cross-link:

| Category | What lives here |
|---|---|
| Identity ✓ · Medical ✓ · Education ✓ · Financial ✓ · Travel ✓ | (existing) |
| **Insurance** ⭐ | Home/*Haushalt*, health/*Kranken*, car (*Kfz/Kasko*), travel, life, liability policies + IPIDs + claims |
| **Legal** ⭐ | **Leases/rental agreements**, contracts (employment/service), wills & testaments, powers of attorney, court/custody papers |
| **Property & Vehicle** (with Assets) | Deeds/mortgage, *Zulassung*, service records, **warranties & big-purchase receipts** |

Naming: **"Legal"** is what people intuitively look under for leases/contracts/wills — keep it. **"Insurance"** earns its own category because it's about *coverage*, not just a document.

---

## 4. Insurance-policy vault (the data model)

A pragmatic model (simplified from the research; aligns with the EU **IPID** 9-heading structure and ACORD P&C standards):

- **Policy** — type (Haushalt/Kranken/Kfz/Reise/…), insurer, **policy number**, **claims phone/process**, broker, sum insured, excess/deductible, premium + frequency, **start & renewal date**, geographic scope, **policy-wording PDF** + IPID.
- **CoverageComponent** — each peril/rider (fire, water, *Einbruchdiebstahl*, away-from-home theft, luggage…) with its own limit + conditions/exclusions.
- **PolicyAssetLink** — a **join** ("which policy covers this bike") with basis (within blanket sum / individually scheduled / standalone) + agreed value + endorsement number. *(Not a foreign key on the asset — an item can be covered by more than one policy.)*
- **PolicyPerson** — links a policy to family members (policyholder / insured / beneficiary).
- **Reminders** — renewal, **cancellation deadline**, premium due, waiting-period end.

**Renewal reminders:** default to **~6 weeks** before renewal, *and read the policy's own notice period* — Austrian cancellation notice is generally **1–3 months** (not a fixed 1 month), so don't hard-code it.

---

## 5. Coverage Guardian — the flagship

The AI reads each policy, extracts the **obligations that keep cover valid**, links them to the asset/person, and turns them into a **plain-language "What your policy asks of you" checklist + proactive reminders.**

**Real examples (all reminder-shaped, never verdicts):**

- **Bike theft** → *"Your policy names a minimum lock standard and 'locked to a fixed object'. Rumi's NIU — stored that way? Keep the lock's receipt too."* (Standards vary: UK **Sold Secure** Gold/Diamond, NL **ART 2–5★**, DE **VdS A+/B+**; some insurers use a **minimum lock price** instead. One AT insurer even **excludes theft 22:00–05:00** in public.)
- **Valuables** → *"This item may exceed your policy's valuables sub-limit (often 20–50% of sum insured) — items above the cap usually need a certified safe (EN 1143-1 / ECB-S/VdS) or a scheduled endorsement. Confirm with your insurer."*
- **Travel** → *"Your policy typically excludes valuables left unattended; report theft to police same-day."* → fires from the **Travel Pack** before a trip.
- **Home** → pre-departure *"lock all doors/windows"* nudge; **vacancy** (~60 days, insurer-set) may be a *Gefahrenerhöhung* you must notify.
- **Life events** → renovation / short-let / new pet may be a *Gefahrenerhöhung* → *"check whether you must notify {insurer}."*
- **Claim reporting** → the moment an incident is logged, a countdown: *"notify {insurer} without delay — confirm the exact deadline in your policy."*

**Hard safety rule for Coverage Guardian:** never say *"you've voided your cover"* or predict a payout/reduction. Austrian & German law run duty-breaches through a **fault ladder** (simple negligence usually still pays; only gross negligence/intent bite) **and give a *causality defence*** (*Kausalitätsgegenbeweis*) — a missed duty that didn't affect the loss often doesn't kill the claim. And **every concrete number is insurer-specific, never statutory** → read *their* policy, quote *its* clause.

---

## 6. AI-reads-your-docs — the guardrails (the legal core) ⚠️

**Verdict: legal to build, but only if scoped as *recall*, not *advice*.** The line is identical across Austria/EU/UK/US:

> **✅ Quoting / locating what the document literally says = "mere information" (unregulated).**
> **⛔ Interpreting terms, applying them to your situation, coverage verdicts, claims help, or renewal/switch recommendations = regulated insurance distribution/advice** (Austria: *Versicherungsvermittlung*, GewO §137 — unlicensed = fines + public naming; plus civil *Auskunftshaftung* §1300 ABGB, and a paid subscription counts as "for reward").

**The 12 hard rules to bake in (from the research):**

1. **Extractive/grounded RAG with a citation on every answer** — show the **exact source passage + clause/page** next to the answer (NotebookLM / Anthropic-Citations pattern).
2. **Never a coverage verdict.** Ban *"yes/no you're covered"* → *"your policy §X says …; whether your situation qualifies is {insurer}'s decision."*
3. **No claims-prep help** — don't draft/assess/prepare an actual claim (EIOPA: claims-assistance = distribution).
4. **No renewal/switch/"you're underinsured" recommendations** — that's personal advice.
5. **Never "you've voided cover"; no *Quotelung* %, no gross-negligence judgement** — those are legal conclusions with a causality defence.
6. **In-context disclaimer with *every* answer** — *Moffatt v. Air Canada* (a BC tribunal, illustrative not binding) shows a buried ToS disclaimer doesn't cure a wrong chatbot answer.
7. **Refusal is a first-class state** — *"your document doesn't address this"* beats a guess (RAG reduces but never eliminates hallucination — a comparable legal-AI study found 17–33%).
8. **GDPR Art. 9 for health/life/travel-medical policies** — explicit consent before AI processing (you already have the consent gate + Vertex EU).
9. **EU AI Act Art. 50 "you're talking to AI"** — applies **from 2 Aug 2026**; label AI answers (trivial).
10. **Audit log** prompt + output + exact source text used — supports dispute defence and the **EU Product Liability Directive** (AI = "product", strict liability **can't be disclaimed away**, from Dec 2026).
11. **Never present a market-typical number as the user's own rule** — no "£1,500 limit" / "ART-2 lock" defaults; read *their* policy.
12. **One-tap "contact your insurer / broker"** always visible — route the real decision to the human.

**Good news:** none of these are absolute blockers — the risky things (verdicts, claims help, recommendations) are **features you simply don't build**, not ones you need. And the whole thing **reuses what you already shipped**: the no-medical/legal/financial-advice guardrail, the off-by-default AI consent gate, and EU (Vertex) processing. If you ever *do* want "should I renew/switch," that requires a licensed partner (the **Anorak Technologies** / FCA-authorised model) — out of scope for v1.

---

## 7. Proposed build order

- **Phase 1 — Assets → claim-grade dossier.** Multi-photo (item + serial plate + receipt) · receipt/appraisal/warranty attachments (into the vault) · numeric price + currency · replacement value · **identifier-by-category** · storage/security field · single-item-limit flag · **incident capture** (police ref, date of loss, forced-entry photos) · **canonical claim-list + register export** · surface a member's items on **their profile**.
- **Phase 2 — Insurance-policy vault.** The Policy/Coverage/Link/Reminder model · renewal & cancellation-deadline reminders · link policy ↔ asset ↔ member · policy PDFs in the vault.
- **Phase 3 — Coverage Guardian.** AI extracts each policy's obligations → the "what your policy asks of you" checklist + situational reminders (bike lock, valuables cap, vacancy, travel, claim countdown). Needs the doc-text pipeline.
- **Phase 4 — Ask-your-docs Q&A.** Extractive RAG with citations over Insurance + Legal + all vault docs, under the 12 guardrails above.

Phases 1–2 are pure product (low legal risk) and can ship immediately. Phases 3–4 are the differentiator and should ship **behind the AI consent gate** with the guardrails — and after a paid legal check (below).

---

## 8. What needs *you* (or a lawyer) — I can't finish these

1. **A paid legal opinion** before wide launch of Phases 3–4: an **Austrian *Rechtsanwalt*** on GewO §137/GISA exposure (you're Vienna-based), ideally with a UK/US read if you go international.
2. **A product decision:** commit to **recall-only** (no "should I renew/switch") for v1 — or plan a licensed-broker partnership if you ever want real advice.
3. **The data-controller entity** (still open from the DPIA) and the retention policy.

---

## Key sources
- **Insurer/claims:** ABI, III, Stiftung Warentest (*Hausratversicherung*), Verivox, Progressive/Liberty Mutual, Immobilise/NMPR, BikeRegister.
- **Legality of AI over docs:** IDD 2016/97 & EIOPA Q&A; FCA PERG 5.8 / Anorak Technologies (FCA authorisation); Austria GewO §137 + §1300 ABGB; NAIC / California L&D Analyst licence; *Moffatt v. Air Canada* (2024 BCCRT 149); EU Product Liability Directive 2024/2853; EU AI Act Art. 50; Stanford RegLab legal-AI hallucination study.
- **Policy obligations & standards:** §6/§16/§23–25/§33 VersVG (AT); §19/§28 VVG (DE); Sold Secure, Stichting ART, VdS, EN 1143-1/ECB-S; sample insurer *Bedingungen* (Oberösterreichische Versicherung, Bikmo, Feather).

*Every concrete figure here comes from example insurer wording and varies by insurer/product/market — the app must read the user's actual policy and defer to it. This document is a product plan, not legal advice.*
