# Teluva: family, education and business gap audit

Research date: 16 September 2026. This is a source-code and workflow audit of the current local checkout, reconciled with the July audits and current primary product documentation. The Education, Addresses and combined Timeline changes described as “built this session” are local changes, not a claim about the deployed site. Competitor documentation establishes advertised capabilities, not customer demand or implementation quality. Priorities below are product judgments; no market-size or pricing assumptions are used.

## The central finding

Teluva has accumulated substantial breadth: identity, health, documents, travel, insurance, household records, assets, family relationships and memories. Its largest gap is now **turning records into completed work across time**.

A record often answers “what do we have?” but not all of: “what is missing, who will obtain it, what changed, what is the next action, and is the job finished?” Education and previous addresses expose a second gap: current facts often lack a structured history. Business exposes a third: having documents is different from proving that a person, vehicle or location meets a defined set of requirements.

The right next investment is a small set of shared capabilities—record relationships, requirements, tasks and history—expressed differently for families and businesses. Another broad collection of unrelated tabs would increase the navigation burden without completing those jobs.

## What was actually checked

Local evidence includes [the domain model](/Users/roryclark/teluva/src/types.ts), [profile and business navigation](/Users/roryclark/teluva/src/components/Dashboard.tsx), [document storage](/Users/roryclark/teluva/src/utils/db.ts), [permissions](/Users/roryclark/teluva/firestore.rules), [assistant edits](/Users/roryclark/teluva/src/utils/aiApply.ts), [attention reminders](/Users/roryclark/teluva/src/components/NeedsAttention.tsx), [exports](/Users/roryclark/teluva/src/utils/exportPack.ts), [readiness checks](/Users/roryclark/teluva/src/utils/readiness.ts), and the relevant profile, household, business CV and timeline components. The family UI was exercised locally in demo mode. This is not a production-data inspection, full security review, or a claim that every business workflow was exercised with a real business account.

Earlier references: [July feature audit](/Users/roryclark/teluva/docs/feature-audit-2026-07.md), [business research](/Users/roryclark/teluva/docs/business-vault-research-2026-07.md), [business spaces plan](/Users/roryclark/teluva/docs/BUSINESS-HUB-SPACES-PLAN.md), and [assets/insurance plan](/Users/roryclark/teluva/docs/ASSETS-INSURANCE-PLAN-2026-07.md).

### Reconciliation: avoid rediscovering completed work

| Earlier recommendation | Evidence now | Remaining gap |
|---|---|---|
| Recurring care/check-ups | CareSchedule, careNextDue and attention nudges exist | A closed-loop booking/follow-up task, plus longitudinal visit history beyond the last visit |
| Transit passes and expiry reminders | TransitPass, MemberTravel and show-card behaviour exist | General membership/library/club cards are not a first-class equivalent |
| Open referrals | ReferralRecord has open/booked/done and related nudges | Cross-feature action ownership and follow-up tracking |
| Multi-space business preset | SpaceMembership, SpaceSwitcher, server space routing and business navigation exist | Business processes and narrower employee-document access |
| Assets and insurance | Asset photos, receipts, claim export, richer policies and quoted obligations exist | Asset custody history; obligations assigned to people; general contract lifecycle |
| Emergency and estate handover | Emergency packs, care shares, wills access and successor records exist | Routine, purpose-specific handovers and review freshness across records |
| Family timelines | Memory, health and travel timelines already existed separately | Combined source-aware filtering, now implemented locally in this session |
| Education | Basic current school facts, Education documents and business CV records existed | Year-by-year family history, now implemented locally; capture/extraction remains a separate gap |

There is no evidence ledger supporting a numerical claim about whose ideas produced what percentage of the app. The practical process failure is visible: research findings were not consistently converted into traceable decisions, acceptance criteria and verified outcomes.

## Education: build a learning history

School reports are one strand. The useful whole is a **yearbook plus learning portfolio plus practical school record**, available after changing schools.

Seesaw documents multimedia evidence of learning, reflections and year-over-year portfolios. Artsonia connects artwork with a child's portfolio and family involvement. ClassDojo documents classroom portfolios and school-photo collections. These support the pattern of preserving progress and meaningful work; they do not establish that Teluva should become a teaching platform. [Seesaw portfolios](https://seesaw.com/features/digital-portfolio/), [Artsonia](https://www.artsonia.com/?nt=1), [ClassDojo portfolio introduction](https://ideas.classdojo.com/f/intro-to-student-stories/), [ClassDojo photo/portfolio documentation](https://www.classdojo.com/child-privacy/).

| Opportunity | Concrete use | Current status / recommendation |
|---|---|---|
| School-year capsule | School, class, class teacher, other teachers, contacts, reports and notes all belong to 2026–27 | Built locally: separate years, preserved history, current-year selection |
| Class photo and school portrait | Save the photo with year/class and an optional caption | Built locally: Class photo record with image attachment and preview; no face recognition or public gallery |
| Achievement record | Swimming badge, music exam, competition, reading milestone | Built locally: Achievement record per school year; dates, notes and evidence attachments |
| Work worth keeping | A drawing, science project or writing sample with the child's own explanation | Built locally: Project/Memory records and attachments. Audio/video reflections are not implemented |
| Activities | School club, sports day, play or school trip | Built locally: Activity record. Recurring timetable, fees and attendance are future scope |
| Meeting follow-through | “Teacher suggested reading support; parent will arrange a meeting” | Notes exist. Missing: named owner, due date, next action and completion |
| End-of-year review | Three proud moments, something difficult, favourite teacher/book, what to try next | Recommend next: a short optional reflection template using existing records; avoid grading the child with AI |
| New-school handover | Selected reports, qualifications and practical contacts in a reviewed export | General education export now includes the new records. Missing: purpose-specific selection of individual years/records and a checked school-transfer checklist |
| School changes over time | Different curriculum, country, school and support contacts | Basic year history exists. Future: explicit transitions and approximate dates, without converting incompatible grading systems |
| Support arrangements | Family-recorded accommodations, agreed support and review dates | Distinct future scope. Needs appropriate record access before adding sensitive assessments to a broadly shared profile |
| Adult learning | Certificates, institutions, completion and expiry; evidence kept alongside the record | Built locally for family profiles; existing business CV remains separate |
| Professional development | Course hours, provider, learning objective and annual target | Recommend for business credential workflows once a target segment is chosen; not a generic school-report field |

**The interaction to aim for:** photograph something → Teluva proposes “Mia / 2026–27 / Class photo” → parent confirms → original, year capsule and timeline all refer to the same record. Today's new manual flow provides those homes; automatic classification and field extraction into them are not yet implemented. The assistant must not claim that a saved document also populated the structured education record.

## Family opportunities, ranked by usefulness

The ranking uses frequency, consequence, reuse of existing Teluva records and uncertainty. “High confidence” means the gap is strongly supported by the inspected implementation and an established product pattern; it does not substitute for testing with families.

| Priority | Gap | A useful first implementation | Confidence |
|---|---|---|---|
| 1 | Actions have no general owner or completion state | A task linked to a record: owner, due date, next step, done/snoozed, completion evidence. Start with “renew passport”, “book referral” and “send school form” | High |
| 2 | Intake and destination remain disconnected | A review inbox: person, record type, extracted fields, source file, suggested destination and confirm. Show whether a document is filed, needs review or lacks a related record | High |
| 3 | Major life changes span several tabs | “We’re moving” or “Starting a new school” opens a compact checklist assembled from existing contacts, addresses, utilities, documents and dates | Medium; validate which transition users need first |
| 4 | Records can become silently stale | “Last confirmed” and a light review action for emergency contacts, school details, addresses and handover instructions; ask only when useful | High |
| 5 | A handover is a continuing job | A selectable care/school/travel handover with purpose, recipient scope, review date and printable pack; build on existing exports and care sharing | High |
| 6 | Repeat medication administration is free text | A user-entered medication/refill schedule with exact instructions, prescriber and a confirmation step; no dosage recommendations | Medium; separate medical design review |
| 7 | Memberships are scattered | Library, museum, sports-club and other membership cards with optional expiry and the existing show-card treatment | High; smaller standalone value |
| 8 | Renewal dates do not represent every decision deadline | Reuse insurance's notice-period concept for household subscriptions/contracts; show the action date and its source | High |
| 9 | Household maintenance is stronger at history than planning | A service plan linked to equipment and vendor, with upcoming work and records of completion | Medium; avoid duplicating existing service logs |
| 10 | The child’s own perspective is underrepresented | Optional annual reflection and selected portfolio highlights; retain parent control over sharing | Medium |

Cozi demonstrates a separate place for tasks that are not appointments and for assigning lists; Teluva's calendar and shopping list do not replace that job. Trustworthy documents an inbox, email intake, reminders and selective sharing. HomeZada connects inventory, maintenance and home projects. These are useful reference patterns, not a reason to copy their entire product scope. [Cozi to-do lists](https://www.cozi.com/getting-started-with-cozi-to-do-lists/), [Trustworthy features](https://www.trustworthy.com/features), [Trustworthy inbox](https://help.trustworthy.com/en/articles/12714177), [HomeZada](https://www.homezada.com/).

**A concrete Teluva-specific idea:** a “change ripple” after a confirmed update. When a family changes address, offer a reviewed list of records that may need attention: school contact details, vehicle paperwork, insurer, utilities and emergency pack. Create tasks; never silently change unrelated records. This is an inference from Teluva's connected data, not a competitor claim or permission to send notifications to outside organisations.

## Business: the missing layer is operational evidence

This review prioritises small businesses generally, with a care-business example because the earlier research explicitly considered that segment. That is a working scope, not a validated market choice.

### What business mode already has

Separate spaces and membership; business identity; employee profiles, start dates, work anniversaries and CV education/qualifications; document storage and OCR; contacts/providers; locations; assets; vehicles; insurance; encrypted secrets; shared calendar/chat; export and expiry infrastructure. Business navigation adapts the family shell and hides several family-only sections.

These are useful building blocks. They do not yet amount to an onboarding system, a credential-compliance system or an employee-document workflow.

### Ranked business gaps

| Priority | Missing workflow | Example | Existing building blocks | Smallest coherent next version |
|---|---|---|---|---|
| 1 | Requirements and evidence coverage | “Every field worker needs current first-aid evidence and a signed policy acknowledgment” | CV qualifications, documents, nudges | User-defined requirement templates applied to a person/role; missing / supplied / reviewed / expiring / exception states, each with evidence |
| 2 | Request and receive missing documents | Owner chases a new employee’s certificate | Vault, identities, upload, membership | Scoped request with due date and owner; upload/review/reject loop; explicit user control over sending reminders |
| 3 | Renewal ownership and closure | Certificate expires in six weeks; who is arranging renewal? | NeedsAttention, dates, qualifications | Assign renewal action, record booking/status, attach replacement, preserve previous evidence |
| 4 | Onboarding and offboarding | New starter gets access and equipment; leaver returns it and access is removed | Membership, assets, CV, secrets | Role-based checklist with due offsets and accountable owner. Keep access revocation as a deliberate, reviewed action |
| 5 | Document access appropriate to roles | Employee sees their own documents; office manager sees required evidence; external accountant sees only selected records | Space-level roles and specialised wills access | Design and enforce employee/document-scoped grants. Current family-member reads are broad within a space, so UI hiding alone is insufficient |
| 6 | Durable change history | Who replaced this certificate, reviewed it, or changed the renewal date? | Save transactions, merge logic, AI undo | Append-only server-authored activity records; document versions and a “supersedes” link. AI undo and cloud logs are not a user-facing audit trail |
| 7 | Evidence pack for a real request | Customer asks for current insurance plus named staff credentials | Export packs, documents, policies | Requirement-driven pack with evidence index, missing items and preparation date; describe recorded facts rather than asserting legal compliance |
| 8 | Equipment custody | Laptop assigned, handed over, returned damaged | AssetItem has assignedMember and incident details | Check-out/in events, expected return, condition photos, recipient acknowledgment |
| 9 | Policy acknowledgment | A changed procedure needs the right people to acknowledge the new version | Documents and chat | Policy version, intended audience, acknowledgment state/date; signed evidence where genuinely required |
| 10 | Contract and supplier obligations | Renewal, notice deadline, responsible owner, linked service and proof | Insurance notice fields, vendors, quoted obligations | General contract record plus tasks and source passages; reuse the existing quote-grounded reader |
| 11 | Business continuity | Owner unavailable: next 30 days of obligations and how an authorised person continues work | Secrets, contacts, calendar, estate patterns | A business-specific continuity pack with explicitly granted access; do not expose the whole vault |
| 12 | Retention and archive lifecycle | Employee leaves but records have different retention needs | Member deletion and space management | Archive employment separately from account access; configurable review/retention rules with visible holds. Jurisdiction-specific retention periods need separate qualified review |

Personio documents onboarding templates, role-specific checklists and task tracking. Expiration Reminder documents policy audiences/acknowledgments and an audit log of changes and delivery events. Trainual links responsibilities to supporting knowledge and training. Sortly records asset check-out/in. These show that accountability, evidence and lifecycle are mature customer expectations in adjacent products. [Personio onboarding](https://www.personio.com/product/onboarding/), [Expiration Reminder policies](https://help.expirationreminder.com/policies), [Expiration Reminder audit log](https://help.expirationreminder.com/audit-log), [Trainual responsibilities](https://help.trainual.com/en/articles/5544258-responsibilities), [Sortly check-out](https://help.sortly.com/how-to-check-out-or-move-items-using-sortly).

For a care-business pilot, a stronger proposition is “show the evidence and next actions for every carer” than “store employee PDFs”. CareAcademy's training-compliance product supports the importance of that workflow category, but its regulatory material must not be assumed to apply to Austria. A Teluva prototype should start with owner-defined requirements and a small real evidence pack. [CareAcademy compliance](https://careacademy.com/compliance/).

Contractbook's documentation distinguishes due dates, reminders and actions before a termination notice period. Teluva already models notice days for insurance, so generalising that concept is a connected extension rather than another separate reminder feature. [Contractbook task details](https://contractbook.freshdesk.com/support/solutions/articles/206000046176).

## Four proposals that use Teluva’s particular strengths

1. **Readiness by purpose.** “School application”, “family trip”, “new starter” or “customer evidence request” defines a small set of needed records. Show what exists, what needs review and what is missing. Every missing item can become an assigned task. Existing readiness checks become user-defined, purpose-specific checklists.
2. **An evidence chain.** A certificate is uploaded once, linked to the qualification, linked to the requirement, and included in the reviewed export. Replacing it records the previous version rather than losing the history. It addresses the original certificate/education frustration directly.
3. **Chapter close and carry-forward.** At the end of a school year or employment period, preserve the history, prompt for a few missing highlights/documents, and carry forward only selected current details. Never copy old teacher names, grades or requirements without review.
4. **Continuity without oversharing.** A family helper or business deputy receives exactly the reviewed information needed for a purpose, with the recipient, scope and validity visible. Build on existing care/wills patterns after access design; don't create a universal public “share my life” link.

These are hypotheses to validate. They are more specific to Teluva than adding generic chat, budgeting, CRM or project-management modules.

## Recommended sequence and proof of success

| Sequence | Work | A concrete acceptance scenario |
|---|---|---|
| Current local change | Education, previous addresses, connected/filterable timeline | Save a class photo or report to a year, find it in Education and Timeline, turn Education off, edit the source, and see the updated view |
| Next shared foundation | Contextual intake + evidence links | Upload an existing certificate once, confirm its person and qualification, retrieve the original from every relevant view |
| Next family outcome | Actions + one transition checklist | Starting a new school yields a short reviewed checklist; two parents can split it and see it completed |
| Next business outcome | Requirements + renewal actions + evidence export | A small team can show missing/expiring/reviewed evidence and assemble a pack without searching folders |
| Before broader employee rollout | Scoped permissions, version history, archive/retention controls | Employee A cannot read B's restricted records; reviewer actions and superseded evidence are traceable |
| Later, after use | Annual reflections, richer media, CPD, asset handovers | Add only when pilot use shows a repeated job that the simpler model cannot complete |

Do not build payroll, a full CRM, an LMS, automated medical advice, broad bank monitoring, or public school-social features as part of this direction. They require different operational commitments and do not complete the core record-to-action workflow.

## Make future research accountable

Maintain a decision ledger for each proposed improvement: user job, current evidence, source, gap, confidence, scope, decision, acceptance scenario, implementation and observed result. Before a new audit, reconcile this ledger with code and usage. Close stale recommendations; do not repackage completed features as discoveries.

A useful next research exercise is a small set of observed tasks, not another feature poll: ask families to find last year's report and prepare a school handover; ask business owners to show current credentials for three people and replace one expiring certificate. Record time, failed searches, manual workarounds and what they choose not to store. Those observations should reorder the priorities above.


## Validation of this session's implementation

- Full npm test, npm run lint and production npm run build passed after the final code changes. Vite still reports large chunks.
- New regression coverage checks school-year preservation, concurrent report merging, document ownership and export selection, shared appointment deduplication, category/person/year/search filtering, undated records and source deletion.
- Four deliberate faults—overwriting current school from history, exposing another person's document in the picker, duplicating appointments and ignoring category filters—were each rejected by the new tests, then reverted.
- Desktop browser checks covered creating a school year, setting it current, uploading and previewing a class-photo fixture, linking an existing file to a qualification, invalid expiry validation, adding a former address, and finding these records in the combined timeline.
- Mobile layout was visually checked at 390 pixels with no horizontal overflow; the filter grid was compacted after inspection. Browser checks used demo data. Production accounts, live cloud upload/save and production deployment were not exercised.
- Business recommendations are research findings; no new business workflow or permission policy was shipped as part of this change.

## Visual timeline follow-up — review branch

The timeline now uses a continuous horizontal axis, with cards connected above and below it. A year is grouped into monthly chapters; Month opens daily chapters. Each chapter keeps every underlying record available through the detail panel and previous/next controls. This gives photographs and major moments space without burying a busy month in overlapping cards. The line explicitly labels the grouping, rather than suggesting each card sits on its precise event date.

A whole-history year scrubber, person/search/category filters, keyboard scrolling, native horizontal touch scrolling, and an expanded view support exploration. Phone landscape uses shorter cards so both sides of the line remain visible; portrait is supported without an orientation lock. Rotation recentres the selected chapter. Known residence intervals form bands across years. Academic-year-only records and undated records stay separate from exact-date chapters. Linked class/travel photos are displayed; unrelated members' vault photos are excluded.

Research basis: [Knight Lab TimelineJS](https://timeline.knightlab.com/) demonstrates multimedia chronological storytelling; [vis-timeline grouped timelines](https://visjs.github.io/vis-timeline/examples/timeline/groups/groups.html) demonstrates structured event grouping; [W3C orientation guidance](https://www.w3.org/WAI/WCAG22/Understanding/orientation.html) supports both device orientations. The chapter/axis/detail combination is a Teluva design judgment informed by these patterns, not a claim that one layout is universally best. No additional timeline library was needed.

Automated coverage includes leap days, same-day events, unknown-date precision, recent-year selection, residence clipping, and profile/vault photograph ownership. Browser review covers year/month exploration, chapter navigation, filters in expanded view, address bands, desktop, phone portrait and landscape, rotation and Escape. Demo review link: `http://localhost:3010/?demo=1&view=timeline`. Live production data and cloud writes still require production validation after review.

## Deployment reconciliation

The initial inventory above examined this repository's v254 baseline. Deployment checks revealed production was already at v356. Its exact source was recovered from successful Cloud Build `41491a04-0679-41f2-bed8-a1d17441266d`; its image digest matched the live service. The release branch merges the new profile features and visual timeline onto that source, preserving newer imports, photo editing, dated documents, business milestones, hidden-date controls, connected families and existing security rules. Further business planning must use this reconciled source rather than interpreting every v254 gap as still missing in production.

Life is now the default visual scale, showing the complete recorded span through the current year (or later recorded events). Responsive chapter grouping preserves all records, including entries with only a known year. Explore opens the selected year; Month opens daily detail. The existing detailed record renderer is used inside the visual inspector, preserving source links, photos, import metadata and merge-safe editing. The full records presentation remains available.
