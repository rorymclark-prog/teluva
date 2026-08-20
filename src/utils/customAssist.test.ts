import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guards the custom-date assist: the AI helper inside "Choose our own date".
//
// The whole feature rests on ONE rule — it must never produce a date the
// family did not give. A researched celebration has a tradition behind it and
// can be checked; a custom date's only authority is that the family chose it,
// so a date the model picked becomes, on the calendar and in the yearly
// notification, indistinguishable from one they chose. They will believe they
// chose it. Everything below exists to keep that impossible.

const here = path.dirname(fileURLToPath(import.meta.url));   // never .pathname — a space in the path silently no-ops
const root = path.resolve(here, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const server = read('server.js');
const modal = read('src/components/NameCelebrationModal.tsx');

// --- the rule, enforced in CODE and not merely asked for in the prompt -----
{
  const at = server.indexOf('function sanitizeAssistProposal');
  assert.ok(at > 0, 'sanitizeAssistProposal must exist');
  const body = server.slice(at, server.indexOf('\n}\n', at));

  // A date is kept only when it matches MM-DD exactly. Anything else — a year,
  // a season, prose, an out-of-range day — becomes null.
  assert.ok(/MMDD_RE\.test\(rawDate\)\s*\?\s*rawDate\s*:\s*null/.test(body),
    'the date must be validated against MM-DD and dropped to null otherwise');
  assert.ok(!/date:\s*rawDate\b/.test(body), 'the raw model date must never be passed through unchecked');

  // A malformed date must not fail the whole call — the title and explanation
  // are still worth having. It must be dropped, and the drop must be visible
  // in the logs rather than silent.
  assert.ok(/console\.warn\([^)]*dropped a malformed date/.test(body),
    'a dropped date must be logged, not silently swallowed');

  // No date means the family is told what is still needed, rather than finding
  // an empty field on Save.
  assert.ok(/missing\s*=\s*date\s*\?\s*null\s*:/.test(body), 'a null date must carry a reason the family can act on');
}

// The regex itself: months 01-12, days 01-31, nothing else.
{
  const line = server.match(/const MMDD_RE = (\/.+\/);/)?.[1];
  assert.ok(line, 'MMDD_RE must be defined');
  const re = new RegExp(line.slice(1, -1));
  for (const good of ['01-01', '12-31', '03-19', '02-29']) {
    assert.ok(re.test(good), `${good} should be a valid MM-DD`);
  }
  for (const bad of ['13-01', '00-10', '01-32', '01-00', '1-1', '2026-03-19', '03-19 ', 'spring', '']) {
    assert.ok(!re.test(bad), `${bad} must NOT pass as an MM-DD`);
  }
}

// --- the prompt's own hard rules -------------------------------------------
{
  const at = server.indexOf('CUSTOM_ASSIST_PROPOSAL_SYSTEM');
  const prompt = server.slice(at, server.indexOf('`;', at));
  for (const [what, re] of [
    ['never invent or guess a date', /never invent, guess, infer/i],
    ['not from a nearby festival', /festival that falls near/i],
    ['null rather than a season', /sometime in spring/i],
    ['a chosen date is indistinguishable from theirs', /indistinguishable from one the family chose/i],
    ['no unrequested religious observance', /religious or cultural observance they did not name/i],
    ['no invented meaning', /Add meaning they did not express/i],
  ] as const) {
    assert.ok(re.test(prompt), `CUSTOM_ASSIST_PROPOSAL_SYSTEM must keep the rule: ${what}`);
  }
}
{
  const at = server.indexOf('CUSTOM_ASSIST_QUESTIONS_SYSTEM');
  const prompt = server.slice(at, server.indexOf('`;', at));
  assert.ok(/TWO or THREE/.test(prompt), 'the brief must pin the number of questions');
  assert.ok(/Never one, never four/.test(prompt), 'the brief must rule out one and four');
  // Rory's own line elsewhere in this feature: never assume religion from a
  // name. It holds here too — this flow reaches the same families.
  assert.ok(/Ask about religion/.test(prompt), 'the questions must not probe religion');
}

// Two or three, or nothing. A single question is not a narrowing flow, and a
// wall of four is a form.
{
  const at = server.indexOf('function sanitizeAssistQuestions');
  const body = server.slice(at, server.indexOf('\n}\n', at));
  assert.ok(/\.slice\(0, 3\)/.test(body), 'at most three questions');
  assert.ok(/out\.length >= 2 \? out : null/.test(body), 'fewer than two questions must be rejected outright');
}

// --- the client ------------------------------------------------------------

// A null date must not wipe a date the family typed themselves before asking
// for help. Guarded because the obvious `setCustomDate(proposal.date || '')`
// does exactly that.
{
  const at = modal.indexOf('const { proposal } = await assistCall');
  assert.ok(at > 0, 'finishAssist must call the proposal step');
  const body = modal.slice(at, at + 700);
  assert.ok(/if \(proposal\.date\) \{ setCustomDate\(proposal\.date\)/.test(body),
    'the date must only be set when one actually came back');
  assert.ok(!/setCustomDate\(proposal\.date \|\| ''\)/.test(body),
    'a missing date must never clear what the family already typed');
}

// Unanswered questions are dropped rather than sent as empty strings.
assert.ok(
  /\.filter\(\(a\) => a\.answer\)/.test(modal),
  'blank answers must be filtered out before they reach the model',
);

// The assist FILLS the form; it does not save. Every field stays editable and
// the existing Save path is still the only thing that writes.
{
  const at = modal.indexOf('async function finishAssist');
  const body = modal.slice(at, modal.indexOf('\n  }', at));
  for (const forbidden of ['onConfirm(', 'proceedOrAskPrimary(', 'onClose()']) {
    assert.ok(!body.includes(forbidden), `finishAssist must not ${forbidden} — it fills the form, it does not commit`);
  }
}

// Opening the custom form must reset the assist, or a second visit shows the
// previous person's questions and answers.
{
  const at = modal.indexOf('function openCustom');
  const body = modal.slice(at, modal.indexOf('\n  }', at));
  for (const reset of ['setAssistQuestions(null)', 'setAssistAnswers({})', 'setAssistError(null)', 'setAssistMissing(null)']) {
    assert.ok(body.includes(reset), `openCustom must reset the assist: ${reset} missing`);
  }
}

console.log('customAssist.test.ts: all assertions passed');
