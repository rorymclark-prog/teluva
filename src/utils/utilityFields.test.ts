import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  utilityVocabulary, usesSupplySchedule, contractWatch,
  UTILITY_KINDS, DEFAULT_NOTICE_DAYS, NOTICE_LEAD_DAYS,
} from './utilityFields';

/**
 * The energy fields. Two things are worth guarding here and they are not the
 * same thing: that the VOCABULARY is right for the country (a wrong label
 * sends somebody to the wrong company at the worst moment), and that the
 * CONTRACT MATHS is right (a warning on the wrong day is worse than none).
 */
let n = 0;
const check = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); n++; };

/* ── THE TWO COMPANIES ────────────────────────────────────────────────────
 * The whole reason this module exists. In a power cut you ring the grid
 * operator, and the number on the bill is the supplier's. */
for (const country of ['AT', 'UK', 'RO'] as const) {
  const v = utilityVocabulary('electricity', country);
  check(`${country}: supply is split into two companies`, v.splitSupply);
  check(`${country}: the operator field exists and is named locally`, !!v.operatorLabel);
  check(`${country}: the hint says out loud that the operator cannot be changed`,
    /cannot be changed|cannot switch|comes with the address/i.test(v.operatorHint || ''));
  check(`${country}: the supplier and the operator are not the same label`,
    v.supplierLabel !== v.operatorLabel);
}

/* ── THE TWO NUMBERS ──────────────────────────────────────────────────────
 * The metering point belongs to the ADDRESS; the meter serial belongs to the
 * DEVICE. People copy the wrong one onto switching forms constantly, so the
 * hints must say which is which. */
check('AT names the Zählpunkt and says it survives a switch',
  /Zählpunktnummer/.test(utilityVocabulary('electricity', 'AT').pointLabel || '')
  && /stays the same when you switch/i.test(utilityVocabulary('electricity', 'AT').pointHint || ''));
check('AT names the Zählernummer and says it changes with the meter',
  /Zählernummer/.test(utilityVocabulary('electricity', 'AT').meterLabel || '')
  && /changes when the meter is replaced/i.test(utilityVocabulary('electricity', 'AT').meterHint || ''));
check('UK electricity is an MPAN, gas is an MPRN — not the other way round',
  /MPAN/.test(utilityVocabulary('electricity', 'UK').pointLabel || '')
  && /MPRN/.test(utilityVocabulary('gas', 'UK').pointLabel || ''));
check('RO uses the POD code and says it belongs to the address',
  /POD/.test(utilityVocabulary('electricity', 'RO').pointLabel || '')
  && /belongs to the address/i.test(utilityVocabulary('electricity', 'RO').pointHint || ''));
check('the point and the meter are never given the same label',
  (['AT', 'UK', 'ZA', 'RO', 'US'] as const).every((c) =>
    (['electricity', 'gas'] as const).every((k) => {
      const v = utilityVocabulary(k, c);
      return v.pointLabel !== v.meterLabel;
    })));

/* ── SAFETY-CRITICAL NUMBERS ──────────────────────────────────────────────
 * Hard-coded ONLY where the number is national. Austria has no national
 * electricity fault line — every Netzbetreiber publishes its own — so an
 * invented one would send somebody to a dead number in the dark. */
check('AT gas is 128, the Austria-wide Gasgebrechen line',
  utilityVocabulary('gas', 'AT').fault?.number === '128');
check('AT electricity has NO hard-coded fault number, and says why',
  !utilityVocabulary('electricity', 'AT').fault
  && /no single Austrian number/i.test(utilityVocabulary('electricity', 'AT').faultHint || ''));
check('UK electricity is 105', utilityVocabulary('electricity', 'UK').fault?.number === '105');
check('UK gas is the National Gas line',
  utilityVocabulary('gas', 'UK').fault?.number === '0800 111 999');
check('US and RO hard-code nothing and ask instead',
  !utilityVocabulary('electricity', 'US').fault && !!utilityVocabulary('electricity', 'US').faultHint
  && !utilityVocabulary('electricity', 'RO').fault && !!utilityVocabulary('electricity', 'RO').faultHint);
/* Every country either gives a number or explains whose to find. A supply
 * with neither is a field somebody stares at. */
check('no split supply is left with neither a number nor a hint',
  (['AT', 'UK', 'ZA', 'RO', 'US', 'other'] as const).every((c) =>
    (['electricity', 'gas'] as const).every((k) => {
      const v = utilityVocabulary(k, c);
      return !!(v.fault || v.faultHint);
    })));

/* Gas gets the drill in every country, because the drill does not vary. */
check('a gas supply always carries the smell-of-gas note',
  (['AT', 'UK', 'ZA', 'RO', 'US', 'other'] as const)
    .every((c) => /open the windows/i.test(utilityVocabulary('gas', c).safetyNote || '')));
check('and nothing else carries it',
  !utilityVocabulary('electricity', 'AT').safetyNote
  && !utilityVocabulary('internet', 'AT').safetyNote);

/* ── FALLBACKS ────────────────────────────────────────────────────────────
 * An unknown country must get neutral wording, never another country's. */
check('an unknown country gets neutral labels, not Austrian ones',
  !/Zählpunkt/.test(JSON.stringify(utilityVocabulary('electricity', 'other'))));
check('and still gets the two-company split, which is not country-specific',
  utilityVocabulary('electricity', 'other').splitSupply);
check('internet and mobile do not pretend to have a grid operator',
  !utilityVocabulary('internet', 'AT').splitSupply && !utilityVocabulary('mobile', 'UK').splitSupply);
check('loadshedding is a South African question only',
  usesSupplySchedule('ZA') && !usesSupplySchedule('AT') && !usesSupplySchedule('UK') && !usesSupplySchedule(null));
check('every kind in the picker resolves to a vocabulary',
  UTILITY_KINDS.every((k) => !!utilityVocabulary(k.id, 'AT').supplierLabel));

/* ── THE CONTRACT MATHS ───────────────────────────────────────────────────
 * The window that matters is not the end date, it is the last day notice can
 * still be given. A 3-month notice period on a contract ending in December
 * means telling somebody in August, not in December. */
const at = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };

const w = contractWatch('2026-12-31', 90, at('2026-08-28'));
check('the notice date is the end date minus the notice period',
  w?.lastNoticeDate === '2026-10-02');
check('and it is counted in days, not months', w?.daysUntilNotice === 35);
check('a long notice period is not yet due 35 days out', w?.due === false);

const soon = contractWatch('2026-12-31', 90, at('2026-09-20'));
check('it becomes due inside the lead window',
  soon!.daysUntilNotice <= NOTICE_LEAD_DAYS && soon!.due === true);

const missed = contractWatch('2026-12-31', 90, at('2026-11-01'));
check('past the notice date it reports MISSED, not due', missed!.missed === true);
check('and a missed window is still flagged while the contract runs', missed!.daysUntilEnd > 0);

const ended = contractWatch('2026-01-01', 30, at('2026-08-28'));
check('a contract that already ended is neither due nor missed',
  ended!.due === false && ended!.missed === false && ended!.daysUntilEnd < 0);

check('a blank end date produces nothing at all', contractWatch(undefined) === null);
/* Date normalises 2026-02-31 into March. A corrupt stored value must not
 * become a confident warning about the wrong day. */
check('an impossible date is rejected rather than normalised',
  contractWatch('2026-02-31') === null && contractWatch('not-a-date') === null);
check('a missing notice period falls back to the default, not to zero',
  contractWatch('2026-12-31', undefined, at('2026-08-28'))!.lastNoticeDate
    === contractWatch('2026-12-31', DEFAULT_NOTICE_DAYS, at('2026-08-28'))!.lastNoticeDate);
check('a nonsense notice period falls back too, rather than shifting the date',
  contractWatch('2026-12-31', NaN, at('2026-08-28'))!.lastNoticeDate === '2026-12-01'
  && contractWatch('2026-12-31', -5, at('2026-08-28'))!.lastNoticeDate === '2026-12-01');

/* ── WIRING ───────────────────────────────────────────────────────────────
 * A field the form does not render, or that the assistant has never heard
 * of, is a field nobody will ever fill in. */
const root = join(import.meta.dirname ?? __dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const view = read('src/components/HouseholdView.tsx');
const prompt = read('server.js');
const types = read('src/types.ts');

const NEW_FIELDS = [
  'kind', 'gridOperator', 'faultPhone', 'supplierPhone', 'supplierWebsite',
  'meterPointNumber', 'meterNumber', 'meterLocation', 'supplySchedule',
  'tariffName', 'contractType', 'contractStart', 'contractEnd', 'noticeDays',
  'monthlyAmount', 'currency',
];
for (const f of NEW_FIELDS) {
  check(`${f} is stored, rendered and known to the assistant`,
    new RegExp(`\\b${f}\\??:`).test(types) && view.includes(f) && prompt.includes(f));
}
/* The old shape must keep working: households already have rows in it. */
check('the original four fields are still optional and still there',
  /type: string;/.test(types) && /provider\?: string;/.test(types) && /accountNumber\?: string;/.test(types));
check('an old row without a kind is still given the right labels',
  /const KIND_OF = /.test(view) && /electric\|strom\|power\|eskom/.test(view));
check('and the inferred kind is never written back into the stored row',
  /Never written back/.test(view));
check('editing a row does not drop its readings',
  /readings: initial\?\.readings,/.test(view));
/* The fault number is the one thing you need while standing in the dark. */
check('the fault number shows on the collapsed card, not behind an expander',
  view.indexOf('faultChips.length > 0') < view.indexOf('{open && ('));
check('and it is a tel: link, not a number to retype',
  /href=\{telHref\(f\.number\)\}/.test(view));
check('a contract needing notice is hoisted to the top of the section',
  /const dueSoon = entries/.test(view) && /x\.w\.due \|\| x\.w\.missed/.test(view));

console.log(`utilityFields.test.ts: ${n} assertions passed.`);
