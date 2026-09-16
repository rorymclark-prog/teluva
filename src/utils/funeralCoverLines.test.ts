import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { funeralCoverLines, looksDialable, dialableNumber } from './funeralCover';
import type { InsurancePolicy } from '../types';

let n = 0;
const check = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); n++; };

const pol = (p: Partial<InsurancePolicy>): InsurancePolicy =>
  ({ id: 'p1', provider: 'Old Mutual', type: 'Funeral cover', ...p } as InsurancePolicy);

const TODAY = new Date('2026-08-28T00:00:00Z');

/* ── what reaches the card ───────────────────────────────────────────────── */

const mixed = funeralCoverLines([
  pol({ id: 'car', type: 'Car' }),
  pol({ id: 'home', type: 'Home contents' }),
  pol({ id: 'f', type: 'Burial society' }),
], TODAY);
check('nothing but funeral-shaped policies reaches the estate page',
  mixed.length === 1 && mixed[0].id === 'f');

const [claims] = funeralCoverLines([pol({ claimsPhone: '0860 60 60 60' })], TODAY);
check('a claims line is labelled and carried', claims.callLabel === 'Claims' && claims.callValue === '0860 60 60 60');

const [society] = funeralCoverLines(
  [pol({ type: 'Burial society', burialSocietyContact: '+27 82 555 1234' })], TODAY);
check('a burial society has no claims line, so the named contact IS the number',
  society.callLabel === 'Burial society' && society.callValue === '+27 82 555 1234');

const [both] = funeralCoverLines(
  [pol({ claimsPhone: '0860 111 222', burialSocietyContact: 'Ask MaDlamini' })], TODAY);
check('the formal claims line wins when both exist',
  both.callLabel === 'Claims' && both.callValue === '0860 111 222');

/* ── dialing: extract, do not judge ──────────────────────────────────────── */

check('a plain number is dialable', looksDialable('+27 82 555 1234') && looksDialable('0860606060'));
check('prose with no number is not', !looksDialable('Ask at the church office') && !looksDialable('MaDlamini'));
check('too few digits is not a phone number', !looksDialable('12345'));
check('empty and undefined are not dialable', !looksDialable('') && !looksDialable(undefined));

/* A society contact is nearly always a PERSON AND a number in one field.
   Both halves have to survive: the name on screen, the digits in the link. */
check('the number is pulled out of "a name and a number"',
  dialableNumber('MaDlamini 082 555 1234') === '0825551234');
check('an international number keeps its +',
  dialableNumber('Call Thandi on +27 (82) 555-1234 after 6') === '+27825551234');

const [named] = funeralCoverLines(
  [pol({ type: 'Burial society', burialSocietyContact: 'MaDlamini 082 555 1234' })], TODAY);
check('the name still shows and the link still dials',
  named.callValue === 'MaDlamini 082 555 1234' && named.callTel === '0825551234');

/* THE ONE THAT MATTERS. Digits scattered through a sentence are not a phone
   number, and a button that dials them is worse than no button at all. */
check('digits merely present in a sentence are refused',
  dialableNumber('Paid up since 2019, office 9-5') === null
  && dialableNumber('Policy 3 of 4, renewed 2024') === null);

const [prose] = funeralCoverLines([pol({ burialSocietyContact: 'Paid up since 2019, office 9-5' })], TODAY);
check('so no dial button is offered for prose', prose.callIsPhone === false && prose.callTel === undefined);

/* ── ordering: the family rings the top line ─────────────────────────────── */

const waitingP = pol({ id: 'new', provider: 'Fresh', startDate: '2026-07-01', waitingPeriodMonths: 6 });
const throughP = pol({ id: 'old', provider: 'Established', startDate: '2019-01-01', waitingPeriodMonths: 6 });
const ordered = funeralCoverLines([waitingP, throughP], TODAY);
check('a policy still inside its waiting period sorts BELOW one that is through',
  ordered[0].id === 'old' && ordered[1].id === 'new');
check('and it is still shown, because it can pay on an accident',
  ordered.length === 2 && !!ordered[1].waitingNote && !ordered[0].waitingNote);

const a = pol({ id: 'a', startDate: '2019-01-01', waitingPeriodMonths: 6 });
const b = pol({ id: 'b', startDate: '2018-01-01', waitingPeriodMonths: 6 });
check("Insurance's own order is kept when neither is waiting",
  funeralCoverLines([a, b], TODAY).map(l => l.id).join(',') === 'a,b');

/* The waiting note is a fact about the policy's dates. It must never read as a
   decision about a claim: this app is never told that anybody died. */
const [wait] = funeralCoverLines([pol({ startDate: '2026-07-01', waitingPeriodMonths: 6 })], TODAY);
check('the waiting period is reported as "may not pay", never as a refusal',
  /may not pay/i.test(wait.waitingNote || '')
  && !/will not pay|refused|rejected|denied/i.test(wait.waitingNote || ''));

/* ── the bare and the empty ──────────────────────────────────────────────── */

check('a policy with nothing on it but a name is flagged', funeralCoverLines([pol({})], TODAY)[0].bare === true);
check('a policy number alone clears the flag', funeralCoverLines([pol({ policyNumber: 'FC-1' })], TODAY)[0].bare === false);
check('a claims number alone clears it too', funeralCoverLines([pol({ claimsPhone: '0860 111 2222' })], TODAY)[0].bare === false);
check('an empty list is an empty list', funeralCoverLines([], TODAY).length === 0);
check('a nameless provider still renders as something',
  funeralCoverLines([pol({ provider: '  ' })], TODAY)[0].provider === 'Unnamed policy');
check('repatriation appears only when the policy includes it',
  funeralCoverLines([pol({ repatriationIncluded: false, repatriationDestination: 'KZN' })], TODAY)[0].repatriation === undefined
  && /KwaZulu-Natal/.test(funeralCoverLines([pol({ repatriationIncluded: true, repatriationDestination: 'KwaZulu-Natal' })], TODAY)[0].repatriation || ''));

/* ── ONE WRITER. Insurance changes these fields; this card only shows them ── */

const root = join(import.meta.dirname ?? __dirname, '..', '..');
const view = readFileSync(join(root, 'src/components/WillsEstateView.tsx'), 'utf8');
const card = view.slice(view.indexOf('function FuneralCoverCard'), view.indexOf('function EstateReadinessCard'));

check('there is a funeral card, and it is mounted on the page',
  card.length > 500 && /<FuneralCoverCard\s+policies=\{funeralPolicies\}\s*\/>/.test(view));

/* If this card ever grows an input, two screens own one claims number and they
   will disagree — and the one a bereaved family reads may be the stale one. */
check('the card never edits a policy: no inputs, no save, no onChange',
  !/<input|<textarea|<select/.test(card) && !/onChange|saveFinances|setFuneralPolicies/.test(card));

/* Dialing callValue would put "MaDlamini 082 555 1234" into a tel: link — some
   dialers cope, some dial the first thing they find. Extracting existed to stop
   guessing on somebody's behalf; the href has to use what was extracted. */
check('the href dials the extracted number, never the free text around it',
  /tel:\$\{l\.callTel\}/.test(card) && !/tel:\$\{l\.callValue/.test(card));

check('the reader is told to change it under Finances → Insurance',
  /Finances/.test(card) && /Insurance/.test(card));

/* A section that vanishes when empty reads as "there is no cover" to the one
   person who most needs to know whether to go looking. */
check('the card still says something when no policy is recorded',
  /No funeral cover or burial society recorded/.test(card));

const readiness = readFileSync(join(root, 'src/utils/estateReadiness.ts'), 'utf8');
const step = readiness.slice(readiness.indexOf("id: 'funeral'"), readiness.indexOf("id: 'successor'"));
check('the readiness step names Insurance rather than leaving the reader to hunt',
  step.length > 50 && /Insurance/.test(step));

console.log(`funeralCoverLines.test.ts: ${n} assertions passed.`);
