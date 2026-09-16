import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { computeEstateReadiness } from './estateReadiness';
import type { EstateRecord } from '../types';

let n = 0;
const check = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); n++; };

const willRec = (over: Partial<EstateRecord> = {}): EstateRecord => ({
  id: 'w1', kind: 'Will', status: 'signed-original', originalLocation: 'Safe at home',
  executor: 'Thandi', lastReviewed: '2026-06-01', ...over,
});

const empty = computeEstateReadiness({});
check('an empty estate scores zero, not NaN', empty.percent === 0);
check('and every step is offered, so the list is the instructions', empty.steps.length >= 8);
check('nothing done means a next step exists', empty.next !== null);
check('the first thing suggested is the heaviest, not merely the first',
  empty.next!.weight === Math.max(...empty.steps.filter(s => !s.done).map(s => s.weight)));

const full = computeEstateReadiness({
  records: [willRec(), { id: 'p1', kind: 'Power of attorney' }],
  successor: { name: 'Thandi' } as never,
  instructions: { keysAndSafes: 'Kitchen drawer' },
  hasFuneralCover: true,
});
check('a complete estate reaches 100', full.percent === 100);
check('and offers no next step', full.next === null);
check('doneCount matches', full.doneCount === full.steps.length);

/* The steps must reflect REAL state, not merely that a record exists. */
const draft = computeEstateReadiness({ records: [willRec({ status: 'unknown' })] });
check('an unknown status is not counted as done',
  !draft.steps.find(s => s.id === 'will-status')!.done);
const lost = computeEstateReadiness({ records: [willRec({ originalLocation: '', heldBy: '', registered: 'unknown' })] });
check('a will nobody can locate fails the findable step',
  !lost.steps.find(s => s.id === 'will-findable')!.done);
const stale = computeEstateReadiness({ records: [willRec({ lastReviewed: '2015-01-01' })] });
check('a stale review does not count as reviewed',
  !stale.steps.find(s => s.id === 'reviewed')!.done);
check('a power of attorney satisfies the incapacity step',
  computeEstateReadiness({ records: [{ id: 'p', kind: 'Power of attorney' }] })
    .steps.find(s => s.id === 'incapacity')!.done);
check('but a will alone does NOT — that is the whole point of the step',
  !computeEstateReadiness({ records: [willRec()] }).steps.find(s => s.id === 'incapacity')!.done);
check('the German terms are recognised too',
  computeEstateReadiness({ records: [{ id: 'p', kind: 'Vorsorgevollmacht' }] })
    .steps.find(s => s.id === 'incapacity')!.done);

/* WEIGHTING: the things that lose an estate outright outrank tidiness. */
const w = (id: string) => empty.steps.find(s => s.id === id)!.weight;
check('finding the original outranks having reviewed it', w('will-findable') > w('reviewed'));
check('the first phone call outranks the practical list', w('funeral') > w('practical'));

/* ── THE BOUNDARY. Instructions about this app, never about the law. ── */
const src = readFileSync(join(import.meta.dirname ?? __dirname, 'estateReadiness.ts'), 'utf8');
const hows = computeEstateReadiness({}).steps.map(s => s.how).join(' ');
check('no step tells anybody how to make a will valid',
  !/witness|notarise|notarize|sign it|two signatures|legally valid|you (should|must) (get|have|make)/i.test(hows));
check('nor who should inherit', !/beneficiar|inherit|leave.*to your/i.test(hows));
check('the incapacity step states the distinction and stops there',
  /takes effect after death/.test(hows) && !/you (need|should) a power of attorney/i.test(hows));
check('and the file says out loud where the line is', /is legal advice and Teluva does not give it/.test(src));


// ── Wiring: the slider, and who sees release notes ────────────────────────
import { readFileSync as rf } from 'fs';
import { join as j } from 'path';
const r2 = j(import.meta.dirname ?? __dirname, '..', '..');
const view = rf(j(r2, 'src/components/WillsEstateView.tsx'), 'utf8');
const banner = rf(j(r2, 'src/components/UpdateBanner.tsx'), 'utf8');
const settings = rf(j(r2, 'src/components/HubSettingsModal.tsx'), 'utf8');
let m2 = 0;
const w2 = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); m2++; };

w2('the wills page computes and mounts the slider',
  /computeEstateReadiness\(\{/.test(view) && /<EstateReadinessCard readiness=\{readiness\}/.test(view));
w2('the instruction renders only for steps still undone — done ones are not lectures',
  /\{!step\.done && \(/.test(view));
w2('and the card disclaims legal soundness rather than implying it',
  /not about whether a document is\s*\n?\s*legally sound/.test(view));

/* THE TWO BANNER MODES ARE DIFFERENT DECISIONS. Only the retrospective one
   is opt-in; a stale build is a correctness problem for everybody. */
w2('the what-changed card is behind an opt-in', /if \(!showsUpdateNotes\(\)\) return;/.test(banner));
w2('but the stale-build refresh is NOT gated on it',
  !/showsUpdateNotes\(\)/.test(banner.slice(banner.indexOf('async function check()'))));
w2('the build stamp is still written before the opt-in check, so enabling it later is not a false alarm',
  banner.indexOf('writeLastSeen(CURRENT_BUILD)') < banner.indexOf('if (!showsUpdateNotes()) return;'));
w2('it defaults to off', /getItem\(SHOW_CHANGES_KEY\) === '1'/.test(banner));
w2('a private-mode throw means off, never a crash',
  /catch \{ return false; \}/.test(banner));
w2('and there is a visible labelled control for it',
  /Show what changed after each update/.test(settings));

console.log(`estateReadiness.test.ts: ${n + m2} assertions passed.`);
