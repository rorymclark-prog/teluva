import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildFirstHoursPack, funeralPolicyLines, packHasContent, CLAIM_DOCUMENTS } from './firstHours';
import type { FinancesInfo, WillsEstateDoc } from '../types';

let n = 0;
function check(label: string, cond: boolean) { assert.ok(cond, `FAILED: ${label}`); n++; }

const finances = {
  insurance: [
    { id: 'p1', provider: 'Old Mutual', type: 'Funeral cover', policyNumber: 'OM-88',
      claimsPhone: '0860 60 60 60', beneficiary: 'Estate', repatriationIncluded: true,
      repatriationDestination: 'KwaZulu-Natal, South Africa' },
    { id: 'p2', provider: 'Masakhane Burial Society', type: 'Burial society',
      burialSocietyContact: 'MaDlamini 082 555 1234' },
    { id: 'p3', provider: 'Wiener Städtische', type: 'Home contents', policyNumber: 'WS-1' },
    { id: 'p4', provider: 'Lapsed cover', type: 'Funeral cover', status: 'lapsed' },
  ],
} as unknown as FinancesInfo;

const estate = {
  records: [
    { id: 'r1', kind: 'Funeral wishes', notes: 'Cremation, ashes to Ballito' },
    { id: 'r2', kind: 'Will', originalLocation: 'Notary safe, Vienna 1090', heldBy: 'Dr Huber' },
    { id: 'r3', kind: 'Power of attorney', originalLocation: 'Home safe' },
  ],
  instructions: {
    keysAndSafes: 'Safe key taped behind the wardrobe',
    notifyContacts: [
      { id: 'c1', name: 'Nomsa', relation: 'Sister', phone: '+27 82 000 0000' },
      { id: 'c2', name: '   ' },
    ],
  },
} as unknown as WillsEstateDoc;

// --- only funeral-shaped, still-active policies come through -----------------
const lines = funeralPolicyLines(finances);
check('home contents is not a funeral policy', !lines.some((l) => l.provider === 'Wiener Städtische'));
check('a lapsed funeral policy is not offered as claimable', !lines.some((l) => l.provider === 'Lapsed cover'));
check('funeral cover and burial society both come through', lines.length === 2);
check('the burial society is flagged as one', lines.find((l) => l.id === 'p2')?.isBurialSociety === true);
check('repatriation destination survives', lines[0].repatriationDestination === 'KwaZulu-Natal, South Africa');

// A burial society has a named person, never a claims line. Conflating the two
// is how a family ends up phoning a number that does not exist.
check('a burial society carries a contact, not a claims phone',
  !lines[1].claimsPhone && lines[1].burialSocietyContact === 'MaDlamini 082 555 1234');

// --- assembly ---------------------------------------------------------------
const pack = buildFirstHoursPack(finances, estate);
check('funeral wishes are picked up', pack.wishes.length === 1);
check('the will is picked up, the power of attorney is not', pack.wills.length === 1);
check('where the signed will lives survives', pack.wills[0].originalLocation === 'Notary safe, Vienna 1090');
check('a nameless notify contact is dropped', pack.notify.length === 1);
check('keys and safes survive', pack.keysAndSafes === 'Safe key taped behind the wardrobe');
check('a filled pack reports no gaps', pack.gaps.length === 0);
check('a filled pack has content', packHasContent(pack));

// --- THE GAPS ARE THE POINT -------------------------------------------------
// A pack that silently renders short reads as "there is nothing to know".
// Every empty heading has to say so out loud.
const empty = buildFirstHoursPack(null, null);
// Four, not five: you cannot also be missing a claims number when you have no
// policy at all. A gap that fires twice for one absence trains people to skim.
check('an empty pack names every gap exactly once', empty.gaps.length === 4);
check('an empty pack has no content', !packHasContent(empty));
check('an empty pack names the missing cover', empty.gaps.some((g) => /funeral cover/i.test(g)));
check('an empty pack names the missing will location', empty.gaps.some((g) => /signed will/i.test(g)));

// A policy with no way to phone anyone is the specific failure this catches:
// it LOOKS complete on screen and is useless at 3am.
const noPhone = buildFirstHoursPack(
  { insurance: [{ id: 'x', provider: 'Someone', type: 'Funeral cover', policyNumber: 'A1' }] } as unknown as FinancesInfo,
  estate,
);
check('a policy with no claims number is called out', noPhone.gaps.some((g) => /claims number/i.test(g)));

// --- junk tolerance ---------------------------------------------------------
check('undefined inputs do not throw', buildFirstHoursPack(undefined, undefined).gaps.length === 4);
check('a non-array insurance list is tolerated',
  funeralPolicyLines({ insurance: 'nope' } as unknown as FinancesInfo).length === 0);

// --- the claim checklist ----------------------------------------------------
check('the checklist names the death certificate', CLAIM_DOCUMENTS.some((d) => /death certificate/i.test(d)));
check('the checklist names the SA notice-of-death form and says it is SA',
  CLAIM_DOCUMENTS.some((d) => /BI-1663/.test(d) && /South Africa/.test(d)));

// --- NOTHING SENSITIVE MAY APPEAR -------------------------------------------
// NOTHING GATES THIS TIER. The pack is readable by anyone who can open the app
// and is meant to leave it on paper, so there is no stronger gate further back
// to fall behind — this app has no death trigger and is not getting one. The
// sensitive half must therefore simply never be in here.
const serialised = JSON.stringify(buildFirstHoursPack(finances, estate));
for (const forbidden of ['iban', 'accountNumber', 'idNumber', 'passport', 'medical', 'password']) {
  check(`the pack never carries ${forbidden}`, !new RegExp(forbidden, 'i').test(serialised));
}


// ---------------------------------------------------------------------------
// WIRING. A pack nobody can reach is not a feature.
// ---------------------------------------------------------------------------
const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const view = read('src/components/WillsEstateView.tsx');
const dash = read('src/components/Dashboard.tsx');
const server = read('server.js');

// THE MOUNT MUST BE INSIDE WillsEstateView. This file defines several
// components; twice now a modal has been inserted after the wrong closing
// brace and silently never rendered. Anchor it: the usage has to appear
// BEFORE the next component's declaration.
const usage = view.indexOf('<FirstHoursPack');
const nextComponent = view.indexOf('function SuccessorCard(');
check('the pack is mounted', usage > -1);
check('the pack is mounted inside WillsEstateView, not a later component',
  usage < nextComponent);

// The person most likely to print this is a named will reader, never an admin.
// Gating the button on write access would hide it from exactly them.
const btn = view.slice(view.indexOf('setPackOpen(true)') - 400, view.indexOf('setPackOpen(true)'));
check('the print button is not gated on canWrite', !/canWrite && \($/m.test(btn));
check('the button is labelled, not an icon-only mystery', /First hours/.test(view));
check('WillsEstateView is given the hub name to print', /hubName=\{hubName\}/.test(dash));

// And the assistant has to know it exists — the v305 bug class, where a
// shipped feature the prompt never mentions gets answered with something else.
check('the AI prompt knows about the first-hours pack', /THE FIRST HOURS/.test(server));
check('the AI prompt gives its location', /Wills & Estate[\s\S]{0,80}First hours/.test(server));


// The same bug class, swept: a shipped screen the prompt has never heard of.
// Both of these were missing when connected families was found missing.
check('the AI prompt knows the family tree exists', /THE FAMILY TREE is its own screen/.test(server));
check('the AI prompt knows about GEDCOM import/export', /GEDCOM/.test(server));
check('the AI prompt knows the readiness card exists', /EMERGENCY READINESS is a card/.test(server));
check('the prompt keeps people out of a third store',
  /the tree reads those, it is not a third place to store people/.test(server));

console.log(`firstHours.test.ts: ${n} assertions passed.`);
