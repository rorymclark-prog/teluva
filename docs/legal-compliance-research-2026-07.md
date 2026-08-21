# Family Vault — EU/Austria Privacy & Compliance Orientation Memo

**Date:** 2026-07-18 · **Prepared for:** solo founder, Vienna (AT) · **Scope:** GDPR/DSG/MDR/EHDS orientation before friends-test and public EU launch

> ## ⚠️ NOT LEGAL ADVICE
> **This is a research orientation memo, not legal advice.** It was compiled from public sources (linked inline) by an AI research assistant. Before public launch, have it sanity-checked by an Austrian data-protection specialist (a 1–2 hour review of this memo + your DPIA is cheap insurance; the Austrian bar and WKO both list DSGVO specialists). Statements are marked **[cited]** (directly supported by a linked source) or **[inference]** (reasoned from principles/sources but not found verbatim).

---

## 0. Executive summary (the six findings that matter)

| # | Question | Verdict |
|---|---|---|
| 1 | Are you a GDPR **controller**? | **Yes, unambiguously.** The household exemption protects your *users*, not you. |
| 2 | Is a **DPIA** required? | **Yes** — you hit at least 3 of the EDPB's 9 criteria (health data, children, AI/new tech) and the Austrian blacklist. Do it before public launch. |
| 3 | Is a **DPO** required? | **Not yet (likely).** "Large scale" is not met at launch; revisit at growth milestones. Borderline — document the assessment. |
| 4 | Does **paid Gemini API** train on your users' data? | **No** — and for EEA users even the free tier gets paid-tier terms. But abuse logs persist up to 55 days and there's **no EU data-residency on the Developer API** — Vertex AI is the cleaner path. Also: the Gemini API ToS **prohibit use in services "likely to be accessed by" under-18s** — a real issue for a family app. |
| 5 | Is **plaintext password storage** an Art. 32 problem? | **Yes — treat as a launch blocker.** Regulators have fined exactly this (Meta €91M, Knuddels €20k). App-layer encryption is the floor; E2EE is the credible bar for a "vault". |
| 6 | Is it a **medical device**? | **No**, as long as it stores/retrieves and never diagnoses/doses/recommends treatment (MDCG 2019-11 "simple search / storage" carve-out). Keep the AI hard-blocked from medical advice. |

---

## 1. Controller status: the household exemption does NOT cover you

- GDPR Art. 2(2)(c) exempts processing "by a natural person in the course of a purely personal or household activity" — that is the **family typing its own data into the app**, not the company operating the app. Recital 18 says it explicitly: the GDPR *"applies to controllers or processors which provide the means for processing personal data for such personal or household activities"* ([Recital 18](https://gdpr-info.eu/recitals/no-18/)). **[cited]**
- The CJEU reads the exemption **narrowly**: *Lindqvist* C-101/01 (publication to an indefinite audience is not "personal"), *Ryneš* C-212/13 (exemption applies only in a *purely* personal context, interpreted strictly) ([Lindqvist, GDPRhub](https://gdprhub.eu/index.php?title=CJEU_-_C-101/01_-_Lindqvist), [EU Law Analysis on Ryneš](http://eulawanalysis.blogspot.com/2014/12/bringing-data-protection-home-cjeu.html), [overview](https://aigner-business-solutions.com/en/blog/applicability-of-the-general-data-protection-regulation-scope-and-limits-of-the-household-exemption/)). **[cited]**
- **You decide the purposes and means** (what the app stores, that it sends content to Gemini, where it's hosted) → you are a **controller** for the platform processing, with Google as your **processor** chain. **[inference, uncontroversial]**
- Practical consequence: every GDPR obligation below attaches to *you*, even for the friends test. There is no "beta" exemption in the GDPR. **[inference]**

---

## 2. Compliance checklist

### 2.1 MUST-DO before **public** launch (blockers)

1. **Encrypt the secrets vault (passwords, wifi, door codes) at the application layer — ideally end-to-end.** Plaintext at the app layer is the single clearest Art. 32 exposure (see §4). *Status: currently plaintext in Firestore.*
2. **Do and document a DPIA** (Art. 35) — required, see §5. A solo founder can produce a defensible one in a focused day from the [DSB's guidance](https://www.dsb.gv.at/) / ICO-style template; keep it as a living doc.
3. **Records of Processing (Art. 30 RoPA).** The under-250-employee exemption in Art. 30(5) **does not apply to you** because you process Art. 9 special-category data and the processing is not occasional ([Art. 30 GDPR](https://gdpr-info.eu/art-30-gdpr/), [ICO explainer](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/documentation/who-needs-to-document-their-processing-activities/)). **[cited]** One structured spreadsheet/markdown file is enough at your size. **[inference]**
4. **Explicit-consent gate for health data (Art. 9(2)(a))** — a separate, granular, recorded, withdrawable consent step before the health module activates (design spec in §7).
5. **Privacy-policy disclosures** (you already shipped v1 legal pages): must name Google as processor, the **Gemini/AI processing of text and document images**, the **US processing of Firebase Authentication data** (see §3.4), retention periods, the DSB as complaint authority, and data-subject rights.
6. **Resolve the Gemini under-18 ToS conflict** (§3.3): either confirm children never *use* the app (adults-only accounts) or move AI calls to **Vertex AI** (EU endpoint) — which you should do anyway for data residency.
7. **Children/consent logic:** Austrian digital-consent age is **14** (DSG § 4(4)); build the parent-consent representation into the child-profile flow (§6).
8. **Breach-response readiness:** a one-page runbook — who detects, how you assess risk, the [DSB notification form](https://www.dsb.gv.at/download-links/dokumente.html), the 72-hour clock (§9).

### 2.2 SHOULD-DO (strongly recommended, near-term)

- **Move Gemini calls to Vertex AI with an EU regional/multi-region endpoint** — same models, Cloud DPA governance, EU data residency for processing ([Vertex data residency](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/data-residency)). The Gemini Developer API has **no EU pinning even on paid tier** ([forum confirmation](https://discuss.ai.google.dev/t/restrict-compute-to-europe-region/66914)). **[cited]**
- If staying on the Developer API short-term: in AI Studio, **shorten the abuse-log retention window from the 55-day default to 7 days**, and consider applying for **Zero Data Retention** ([logs policy](https://ai.google.dev/gemini-api/docs/logs-policy), [ZDR](https://ai.google.dev/gemini-api/docs/zdr)). **[cited]**
- **Data-minimise the Gemini payloads:** send the document image for OCR, but never send the passwords/codes vault or free-text health notes unless the feature strictly needs it. **[inference]**
- **Retention & deletion:** user-triggerable full-account deletion (Firestore + Storage + Auth + backups), and auto-delete of uploaded scans after extraction if the user doesn't opt to keep them.
- **Access hardening:** Firestore/Storage security-rules audit (you've done rounds of this), app-check, admin-access logging, 2FA on your own Google/GCP accounts (your admin account is the crown jewel). **[inference]**
- **Written DPA inventory:** Google Cloud (Cloud Run/Firestore/Storage) is covered by the [Cloud Data Processing Addendum](https://cloud.google.com/terms/data-processing-addendum), accepted as part of the GCP terms; Firebase services are covered by the [Firebase Data Processing and Security Terms](https://firebase.google.com/terms/data-processing-terms); paid Gemini API by Google's processor DPA (§3.2). Keep dated copies/links in the repo. **[cited]**

### 2.3 Nice-to-have

- Voluntary DPO-style contact ("privacy@…") and a documented "why we don't need a DPO yet" note (§5.2).
- ISO-27001-lite internal security policy page (one pager: key management, laptop encryption, no prod data on dev machines).
- EHDS horizon watch: the [European Health Data Space Regulation (EU) 2025/327](https://www.ey.com/en_gr/technical/tax/tax-alerts/regulation-2025-327-establishing-ehds) (in force 26 Mar 2025, main obligations from ~March 2029) creates a **voluntary labelling regime for "wellness applications"** that handle health data — not binding on you now, but relevant by 2029 if you ever claim EHR interoperability. **[cited]**
- AI Act: as a mere *deployer* of a general-purpose model via API for OCR/extraction, your obligations are minimal (transparency; no prohibited practices); no high-risk classification for record extraction. **[inference — verify with counsel if the AI feature set grows]**

### 2.4 Lower-risk posture for the **private friends test** (next week)

GDPR fully applies from user #1, but risk is manageable if you: (a) invite a small, known, adult-only group; (b) tell them in writing what the app does with their data (Gemini included) and get their consent — this doubles as your Art. 9 consent dry-run; (c) ask them to use **dummy or non-sensitive data for the passwords vault until encryption ships**; (d) no children as account holders; (e) give them a working delete-my-account path. **[inference from the rules above]** The genuinely dangerous combination would be: real friends' real passwords + plaintext storage + a breach — that is the scenario to exclude by instruction and by shipping encryption first for the secrets module if at all possible.

---

## 3. ⭐ The Gemini finding (read this section twice)

### 3.1 Training on your data: **NO on paid tier — and NO for EEA users even on free tier**

The [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) (last updated 28 Apr 2026, fetched 2026-07-18) state for **Paid Services**:

> *"Google doesn't use your prompts (including associated system instructions, cached content, and files such as images, videos, or documents) or responses to improve our products."* **[cited]**

And critically for you:

> *"If you're in the European Economic Area, Switzerland, or the United Kingdom, the terms under 'How Google uses Your Data' in 'Paid Services' apply to all Services, including Google AI Studio and unpaid quota in the Gemini API, even though they are offered free of charge."* **[cited]**

**Unpaid** services outside the EEA are the opposite: content is used to "provide, improve, and develop" Google products including ML, with possible human review. **[cited]** So: keep billing enabled, and never assume the free-tier terms are harmless if you ever serve non-EEA users.

### 3.2 Retention & DPA coverage

- Paid-tier prompts/responses are logged **solely for abuse monitoring**, retained **up to 55 days by default**, adjustable in AI Studio to **7/14/28/55 days**; not used to train models ([logs policy / usage policies](https://ai.google.dev/gemini-api/docs/logs-policy)). **[cited]**
- **Zero Data Retention** is available for paid projects **on request** (not automatic); note carve-outs: Search/Maps grounding keeps data 30 days with no opt-out; File API uploads must be deleted manually ([ZDR page](https://ai.google.dev/gemini-api/docs/zdr)). **[cited]**
- Paid Services process prompts under Google's **"Data Processing Addendum for Products Where Google is a Data Processor"** (per the terms), i.e. Google positions itself as your processor; the Google Cloud docs likewise state paid Gemini API/Vertex data is handled under Cloud DPA terms ([Google data-governance doc](https://docs.cloud.google.com/gemini/docs/discover/data-governance)). **[cited — note the Developer API's DPA is a different document from the Cloud DPA; both are processor terms. Verify which one your billing setup actually attaches.]**

### 3.3 The two Gemini gotchas for Family Vault

1. **Under-18 clause.** The same terms say: *"You must be 18 years of age or older to use the APIs. You also will not use the Services as part of a website, application, or other service … that is directed towards or is likely to be accessed by individuals under the age of 18."* **[cited]** A *family* app that gives children logins (or is arguably "likely to be accessed" by them) sits badly against this. **Mitigations:** adults-only accounts (children exist only as records, never as users), or route AI through **Vertex AI**, whose Google Cloud terms do not carry this consumer-API clause **[inference — confirm the current Vertex/GCP ToS language before relying on it]**.
2. **No EU data residency on the Developer API.** Requests go to a global endpoint; you cannot pin processing to the EU, even paid ([forum](https://discuss.ai.google.dev/t/restrict-compute-to-europe-region/66914)). **Vertex AI EU regional/multi-region endpoints keep ML processing in the EU** ([data residency doc](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/data-residency)). **[cited]** Given you already market "EU region" storage (europe-west2 — which is London, i.e. UK, not EU — worth an honesty check in your copy too **[inference]**), Vertex is the coherent choice.

**Bottom line:** the paid Gemini path is *defensible* on training/retention, but for a health-data vault the clean architecture is **Vertex AI, EU endpoint, under the Cloud DPA**, with minimised payloads and the AI disclosed in the privacy policy + consent flow.

---

## 4. Passwords & the Art. 32 security bar

- Art. 32 requires measures "appropriate to the risk," taking into account **the state of the art**, explicitly naming **encryption and pseudonymisation** ([Art. 32](https://gdpr-info.eu/art-32-gdpr/)). **[cited]**
- Enforcement precedent for exactly your current design:
  - **Meta, Sept 2024: €91M** (Irish DPC) for storing user passwords in plaintext on internal systems — no external exposure was needed for the fine; Art. 32(1), Art. 5(1)(f) and breach-documentation failures ([DPC press release](https://www.dataprotection.ie/en/news-media/press-releases/DPC-announces-91-million-fine-of-Meta)). **[cited]**
  - **Knuddels.de, Nov 2018: €20k** (LfDI Baden-Württemberg, first German GDPR fine) for plaintext password storage revealed by a breach ([IAPP analysis](https://iapp.org/news/a/germanys-first-fine-under-the-gdpr-offers-enforcement-insights)). **[cited]**
- Those cases concern *login* credentials; your app stores **third-party credentials as content**, which a regulator would treat at least as strictly — they unlock the family's entire digital life, and sit next to health data and ID scans. **[inference]**
- "Firestore encrypts at rest" does **not** answer Art. 32: that is Google's infrastructure control; at the *application* layer anyone with DB access (you, a leaked service account, a rules bug) reads secrets in clear. State of the art for a product whose pitch is "vault" is: **(floor)** field-level encryption of the secrets module with keys in Cloud KMS, per-user derived keys; **(credible bar)** end-to-end encryption where the key never reaches the server — noting your Google-sign-in-only design means you'd need a user-held passphrase or passkey-wrapped key to do true E2EE. **[inference]**
- Bonus: Art. 34(3)(a) — if breached data was encrypted with keys the attacker didn't get, you may not have to notify every user of a breach ([Art. 34](https://gdpr-info.eu/art-34-gdpr/)). Encryption literally shrinks your worst-case day. **[cited]**
- Fine tier for Art. 32 violations: up to €10M / 2% of turnover ([overview](https://legalclarity.org/gdpr-article-32-requirements-safeguards-and-penalties/)); realistic solo-founder exposure is a reprimand/order + reputational death if breached, which is worse. **[cited + inference]**

**Verdict: plaintext-at-application-layer for a secrets vault is not defensible under Art. 32 in 2026. This is the single most urgent technical fix.**

---

## 5. DPIA and DPO verdicts

### 5.1 DPIA (Art. 35): **REQUIRED — yes**

The EDPB-endorsed WP248 rev.01 guidelines list 9 criteria; **meeting 2 usually means a DPIA is required** ([WP248 summary](https://keepabl.com/news/edpb-guidance-dpias-9-criteria/), [ICO version](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/when-do-we-need-to-do-a-dpia/)). Family Vault hits at least four:

1. **Sensitive data / highly personal data** — Art. 9 health data, plus ID documents and credentials (Recital 75-type "highly personal" data). **[cited criteria, applied]**
2. **Vulnerable data subjects** — children's data is the canonical example. **[cited]**
3. **Innovative use / new technology** — AI extraction of document images (Gemini). **[cited criteria, applied]**
4. **Large scale** (criterion) — arguable post-launch; not needed since 2 already suffice. **[inference]**

Austria: the DSB's **blacklist** (DSFA-V, [BGBl II 278/2018](https://www.ris.bka.gv.at/eli/bgbl/II/2018/278/20181109)) independently requires a DPIA for, i.a., **extensive processing of Art. 9 special categories** and **processing using new technologies that make impact assessment difficult, in particular the use of artificial intelligence** ([LexisNexis summary](https://lesen.lexisnexis.at/news/datenschutz-folgenabschaetzung-bgbl/zfv/aktuelles/2018/46/lnat_news_026307.html), [blacklist overview](https://datenschutz-consulting.com/oesterreichische-blacklist-fuer-datenschutz-folgenabschaetzungen/)); the whitelist (DSFA-AV, [BGBl II 108/2018](https://dsb.gv.at/sites/site0344/media/downloads/verordnung_der_datenschutzbehoerde_ueber_die_ausnahmen_von_der_datenschutz-folgenabschaetzung_dsfa-av__erlaeuterungen.pdf)) offers no exemption that fits a health-data consumer app. **[cited]**

**Do it before public launch.** Content: systematic description of processing → necessity/proportionality → risks (breach of secrets vault, Gemini leakage, child data misuse, account takeover via Google SSO) → mitigations (encryption, Vertex EU, consent design, deletion). If residual risk stayed high you'd have to consult the DSB first (Art. 36) — with the mitigations above it shouldn't. **[inference]**

### 5.2 DPO (Art. 37): **NOT required yet (likely) — document the assessment**

- Trigger (Art. 37(1)(c)): core activities consist of **large-scale** processing of special categories. Your *core activity* clearly includes health data (it's a product feature, not ancillary) — so everything turns on **"large scale."** ([Art. 37 explainer](https://gdprhub.eu/Article_37_GDPR)) **[cited]**
- WP243 factors: number of data subjects, volume, duration, geographic extent; its canonical contrast — a hospital is large-scale, **an individual physician's practice is not** ([WP243 FAQ](https://ec.europa.eu/information_society/newsroom/image/document/2016-51/wp243_annex_en_40856.pdf)). **[cited]** A pre-launch app with dozens-to-hundreds of families sits on the "individual practice" side; at tens of thousands of EU users with health records the answer flips. **[inference]** There is no fixed user-count threshold ([analysis](https://www.ambitcompliance.ie/blog/when-is-it-necessary-to-appoint-a-data-protection-officer-understanding-on-a-large-scale-under-article-371b-gdpr)). **[cited]**
- Austria's DSG adds no stricter DPO trigger. **[inference from AT-deviation overviews, e.g. [activeMind](https://www.activemind.legal/law/at-data-protection/)]**
- Action: write a dated half-page "DPO assessment: not large scale because …" note, set a revisit trigger (e.g. 5k paying families or any B2B/school channel), and name a privacy contact in the policy. External-DPO services run ~€100–300/month when needed. **[inference]**

---

## 6. Children & Austria specifics

- **Digital consent age in Austria = 14** (DSG § 4(4), using the Art. 8 GDPR opening clause; GDPR default is 16) ([activeMind AT overview](https://www.activemind.legal/law/at-data-protection/), [EU comparison](https://www.eu-rep.global/at-compare-privacy-laws)). Below 14, the holder of parental responsibility must consent/authorise for information-society services. **[cited]**
- Nuance for your design: Art. 8 governs a service **offered directly to a child**. In the parent-adds-child model the child isn't the user — the parent is processing the child's data and *you* are the controller enabling it. What you need is: (a) the **parent's Art. 9(2)(a) explicit consent** covering the child's health data, (b) an attestation that the adding user holds parental responsibility, (c) child-appropriate data minimisation, and (d) a plan for the child's own rights — at 14+ an Austrian child can consent themselves, and a grown child can demand access/erasure of what parents stored about them. **[inference from cited rules; the parental-responsibility attestation pattern is standard practice]**
- If you ever give children their own logins (the "growth-child" direction): Art. 8 consent mechanics kick in for under-14s, "reasonable efforts" to verify parental consent are required, and the Gemini API under-18 ToS clause (§3.3) becomes acute. **[cited + inference]**
- Children are per se "vulnerable data subjects" in the DPIA criteria (§5.1) and Recital 38 demands specific protection — reflect this in the DPIA and in defaults (child profiles maximally private, no AI processing of child documents without explicit parent opt-in). **[cited + inference]**

---

## 7. Art. 9 health data: what your explicit-consent flow must look like

Allergies, blood type, medical notes = "data concerning health," read broadly (Art. 4(15), Recital 35). Your lawful path as a consumer app is **Art. 9(2)(a) explicit consent** — none of the other Art. 9 gates fit a commercial family vault. **[inference, uncontroversial]**

Per [EDPB Guidelines 05/2020 on consent](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf) **[cited]**, "explicit" = an **express statement**, and consent must be freely given, specific, informed, unambiguous, granular, withdrawable as easily as given, and demonstrable (Art. 7(1) — keep records). The guidelines endorse e.g. two-stage confirmation for medical data.

Concrete design that meets the bar **[inference applying the cited guidelines]**:

1. Health module is **off by default**. Turning it on shows a dedicated screen: what's stored, that it's sent to Google's AI only if the user runs extraction on a medical document, retention, withdrawal.
2. User ticks an **unbundled** checkbox ("I explicitly consent to Family Vault storing health information I enter about myself and family members I'm responsible for") — separate from ToS acceptance, never pre-ticked, not a condition for using the rest of the app.
3. **Log** uid, timestamp, consent-text version. (A `consents/{uid}` subcollection is fine.)
4. **Withdrawal** = same toggle; withdrawing disables the module and offers deletion of existing health entries.
5. Separate granular consent for **AI processing of documents** (since that sends images to Google) — this also cleanly covers the Gemini disclosure.

---

## 8. ID-document scans

- No blanket EU/Austrian statute forbids a person from storing scans of **their own** documents; the enforcement pattern (DSB/German DPAs/AEPD) targets **businesses collecting/keeping copies of customers' IDs** beyond necessity — data minimisation, Art. 5(1)(c)/(e) ([Austrian practice note](https://www.datenschutzbeauftragter.co.at/2014/01/ausweispapiere-einscannen-und-speichern-im-geschaeftsverkehr-rechtswidrig/), [hotel guidance](https://gdprwise.eu/en/kennisbank/nieuws/hotel-guest-passports-id-cards-gdpr/), [DE analysis](https://www.datenschutz-notizen.de/zur-datenschutzrechtlichen-zulaessigkeit-von-ausweis-und-passkopien-durch-unternehmen-3510015/)). **[cited]**
- Your position differs: the *family* chooses to store its own documents (their household activity); you are the provider of means. That's lawful with consent/contract as basis — but ID scans are identity-theft gold, so the DPIA must treat them as high-impact and the technical bar mirrors the passwords module: encrypted storage, short-lived signed URLs, no Gemini round-trips beyond the extraction the user requested, delete-after-extraction option. **[inference]**
- Note for your own ops: never *require* an ID copy from users for support/verification except where genuinely necessary (Art. 15 identity doubts), and delete it after use ([dataprotect.at note](https://www.dataprotect.at/2020/10/26/auskunft-und-identit%C3%A4tsnachweis/)). **[cited]**

---

## 9. Breach notification & records (the boring must-haves)

- **Art. 33:** notify the **Austrian DSB** without undue delay, where feasible **≤72h** after becoming *aware*, unless the breach is unlikely to risk rights/freedoms; late notifications need reasons. Content: nature/categories/approx. numbers, contact point, likely consequences, measures taken ([Art. 33](https://gdpr-info.eu/art-33-gdpr/), [DLA Piper AT](https://www.dlapiperdataprotection.com/index.html?t=breach-notification&c=AT)). The DSB provides a notification form ([dsb.gv.at documents](https://www.dsb.gv.at/download-links/dokumente.html)); email also works. **[cited]**
- **Art. 34:** if the breach is *high risk* for users (leaked plaintext passwords or health data would be), you must also notify **the users** — unless the data was properly encrypted (Art. 34(3)(a)). Another argument for §4. **[cited]**
- **Document every breach internally** even if not notifiable (Art. 33(5)) — Meta's €91M included a failure on exactly this. **[cited]**
- **Art. 30 RoPA:** mandatory for you despite being a micro-business (see §2.1 item 3). **[cited]**
- **No Art. 27 EU-representative needed** — you're established in the EU (Vienna). **[inference, trivial]**

---

## 10. Medical-device / medical-advice line

- Under EU MDR, software is a medical device only if it has an intended **medical purpose** (diagnosis, prevention, monitoring, prediction, treatment…). [MDCG 2019-11](https://health.ec.europa.eu/system/files/2020-09/md_mdcg_2019_11_guidance_en_0.pdf) excludes software that only performs **storage, archival, communication, or "simple search"** on data ([explainer](https://www.greenlight.guru/blog/mdcg-2019-11)). A records vault that stores allergies/blood type and retrieves them on demand is squarely in the carve-out. **[cited]**
- The line you must not cross: interpreting health data for an individual ("this combination of symptoms suggests…", dosage suggestions, triage). That would (a) create MDR qualification risk and (b) be reckless output for a Gemini-backed feature. **Hard-block medical advice in the AI system prompt, refuse medical questions in-app, and keep a visible "not medical advice; in emergencies call 144" disclaimer.** **[cited rule + inference on implementation]**
- Marketing copy matters for "intended purpose": never advertise diagnosis/monitoring benefits — "keep your family's important information in one place" is safe; "manage your family's health" starts drifting. **[inference]**

---

## 11. Sub-processor map (current vs recommended)

| Component | Terms today | Data location | Note |
|---|---|---|---|
| Cloud Run, Firestore, Cloud Storage | [Google Cloud DPA (CDPA)](https://cloud.google.com/terms/data-processing-addendum), auto-incorporated in GCP terms | europe-west2 (**London/UK** — adequate country, but not EU; check your marketing copy) | Fine. **[cited + inference on copy]** |
| Firebase Auth | [Firebase Data Processing & Security Terms](https://firebase.google.com/terms/data-processing-terms) | **US only** — *"Firebase Authentication processes data exclusively in the United States"* ([Firebase privacy page](https://firebase.google.com/support/privacy)) | Lawful via Google's DPF/SCC framework, but **must be disclosed** as a US transfer in your privacy policy. **[cited; DPF reliance = inference — verify Google's current transfer mechanism]** |
| Gemini Developer API (paid) | [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) + Google processor DPA | **Global endpoint, no EU pinning** | No training on paid/EEA data; 55-day abuse logs (reducible to 7, ZDR on request); **under-18 service clause**. |
| **Recommended:** Vertex AI Gemini, EU endpoint | Google Cloud DPA | **EU multi-region** ([residency doc](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/data-residency)) | Cleanest posture for health data + children. **[cited]** |

---

## 12. Genuine grey areas (be honest with yourself about these)

1. **"Large scale" for DPO/DPIA at growth** — no numeric threshold exists; set your own review triggers and write them down. **[cited absence]**
2. **Gemini "likely to be accessed by under-18s"** — untested contract language for a family product; Vertex sidesteps it, adults-only accounts mitigate it. **[inference]**
3. **E2EE vs. usability without a master password** — no regulator mandates E2EE explicitly; Art. 32 is risk-based. App-layer encryption with KMS is defensible; E2EE is the differentiator competitors (1Password, etc.) set as the market's "state of the art" for secrets specifically. **[inference]**
4. **Which Google DPA actually governs your paid Gemini Developer API traffic** (processor-terms DPA vs Cloud DPA) — resolve by moving to Vertex or by pinning the doc reference in your RoPA. **[flagged above]**
5. **Grown children's rights against parent-stored data** — no clear guidance found for family-vault products; design for it (age-out prompts) rather than wait for it. **[inference]**

---

## 13. Source list (key links)

**GDPR text & scope:** [Recital 18](https://gdpr-info.eu/recitals/no-18/) · [Art. 30](https://gdpr-info.eu/art-30-gdpr/) · [Art. 32](https://gdpr-info.eu/art-32-gdpr/) · [Art. 33](https://gdpr-info.eu/art-33-gdpr/) · [Lindqvist C-101/01](https://gdprhub.eu/index.php?title=CJEU_-_C-101/01_-_Lindqvist) · [Ryneš C-212/13 analysis](http://eulawanalysis.blogspot.com/2014/12/bringing-data-protection-home-cjeu.html)
**EDPB/WP29:** [Guidelines 05/2020 on consent](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf) · [WP248 DPIA criteria summary](https://keepabl.com/news/edpb-guidance-dpias-9-criteria/) · [WP243 DPO FAQ](https://ec.europa.eu/information_society/newsroom/image/document/2016-51/wp243_annex_en_40856.pdf)
**Austria:** [DSFA-V blacklist BGBl II 278/2018](https://www.ris.bka.gv.at/eli/bgbl/II/2018/278/20181109) · [DSFA-AV whitelist + Erläuterungen](https://dsb.gv.at/sites/site0344/media/downloads/verordnung_der_datenschutzbehoerde_ueber_die_ausnahmen_von_der_datenschutz-folgenabschaetzung_dsfa-av__erlaeuterungen.pdf) · [activeMind AT-GDPR deviations (age 14)](https://www.activemind.legal/law/at-data-protection/) · [DLA Piper AT breach guide](https://www.dlapiperdataprotection.com/index.html?t=breach-notification&c=AT) · [DSB forms](https://www.dsb.gv.at/download-links/dokumente.html)
**Google/Gemini:** [Gemini API Additional Terms (28 Apr 2026)](https://ai.google.dev/gemini-api/terms) · [Logs/abuse policy (55 days)](https://ai.google.dev/gemini-api/docs/logs-policy) · [Zero Data Retention](https://ai.google.dev/gemini-api/docs/zdr) · [Cloud DPA](https://cloud.google.com/terms/data-processing-addendum) · [Firebase DPST](https://firebase.google.com/terms/data-processing-terms) · [Firebase privacy (Auth = US-only)](https://firebase.google.com/support/privacy) · [Vertex AI data residency](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/data-residency) · [Gemini for Google Cloud data governance](https://docs.cloud.google.com/gemini/docs/discover/data-governance)
**Enforcement:** [DPC Meta €91M (plaintext passwords)](https://www.dataprotection.ie/en/news-media/press-releases/DPC-announces-91-million-fine-of-Meta) · [Knuddels first German fine](https://iapp.org/news/a/germanys-first-fine-under-the-gdpr-offers-enforcement-insights)
**MDR/EHDS:** [MDCG 2019-11](https://health.ec.europa.eu/system/files/2020-09/md_mdcg_2019_11_guidance_en_0.pdf) · [greenlight.guru explainer](https://www.greenlight.guru/blog/mdcg-2019-11) · [EHDS Reg. (EU) 2025/327 overview](https://www.ey.com/en_gr/technical/tax/tax-alerts/regulation-2025-327-establishing-ehds)
**ID copies:** [AT practice note](https://www.datenschutzbeauftragter.co.at/2014/01/ausweispapiere-einscannen-und-speichern-im-geschaeftsverkehr-rechtswidrig/) · [GDPRWise hotels](https://gdprwise.eu/en/kennisbank/nieuws/hotel-guest-passports-id-cards-gdpr/)

*Compiled 2026-07-18. Sources fetched/verified on that date; Google's terms pages change — re-check the Gemini API terms (last-updated stamp) before each major release.*
