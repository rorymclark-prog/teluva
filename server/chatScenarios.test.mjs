// The appointment chat scenarios (server/chatScenarios.mjs): the checker is
// right, the rule it enforces is still in the prompt, and the harness builds
// the user turn the way the server does. No model is called here — the live
// run is scripts/interrogate-chat.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPOINTMENT_CASES, APPOINTMENT_TODAY, appointmentContext, buildUserTurn, checkAppointmentReply,
} from './chatScenarios.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const byId = (id) => APPOINTMENT_CASES.find((c) => c.id === id);

const goodOrtho = {
  reply: "I've added your orthopaedic surgeon appointment on 22 September at 10:30.",
  edits: [{ kind: 'calendar_event', title: 'Orthopaedic surgeon', date: '2026-09-22', time: '10:30', category: 'Appointment', memberNames: ['Alex Muster'] }],
};

test('a proper proposal passes', () => {
  assert.deepEqual(checkAppointmentReply(goodOrtho, byId('told-ortho').want), []);
});

// Each of these is a way the real failure looks. Every one must be caught —
// these are the controls proving the checker can fail.
test('CONTROL: a warm reply with no edit fails (the reported bug)', () => {
  const p = checkAppointmentReply({ reply: 'Noted — good luck on the 22nd!', edits: [] }, byId('told-ortho').want);
  assert.ok(p.some((x) => x.includes('no calendar_event')), p.join('; '));
});

test('CONTROL: an event without the time fails', () => {
  const bad = structuredClone(goodOrtho);
  bad.edits[0].time = '';
  assert.ok(checkAppointmentReply(bad, byId('told-ortho').want).some((x) => x.startsWith('time')));
});

test('CONTROL: an event tagged to nobody fails', () => {
  const bad = structuredClone(goodOrtho);
  bad.edits[0].memberNames = [];
  assert.ok(checkAppointmentReply(bad, byId('told-ortho').want).some((x) => x.startsWith('memberNames')));
});

test('CONTROL: the wrong day, or the wrong category, fails', () => {
  const wrongDay = structuredClone(goodOrtho);
  wrongDay.edits[0].date = '2026-10-22';
  assert.ok(checkAppointmentReply(wrongDay, byId('told-ortho').want).some((x) => x.includes('wrong date')));
  const wrongCat = structuredClone(goodOrtho);
  wrongCat.edits[0].category = 'Other';
  assert.ok(checkAppointmentReply(wrongCat, byId('told-ortho').want).some((x) => x.startsWith('category')));
});

test('no date given: asking passes, inventing one fails', () => {
  const want = byId('no-date').want;
  assert.deepEqual(checkAppointmentReply({ reply: 'When is it, and what time?', edits: [] }, want), []);
  const invented = { reply: 'Added.', edits: [{ kind: 'calendar_event', title: 'Psychiatry', date: '2026-09-20', time: '', category: 'Appointment', memberNames: ['Alex Muster'] }] };
  const p = checkAppointmentReply(invented, want);
  assert.ok(p.some((x) => x.includes('invented a date')) && p.some((x) => x.includes('did not ask')), p.join('; '));
});

test('already on the calendar: saying so passes, a second event fails', () => {
  const want = byId('already-on-calendar').want;
  assert.deepEqual(checkAppointmentReply({ reply: "It's already on your calendar for 22 September at 10:30.", edits: [] }, want), []);
  assert.ok(checkAppointmentReply(goodOrtho, want).some((x) => x.includes('second event')));
});

test('a booked referral needs the calendar event AND the referral update', () => {
  const want = byId('referral-booked').want;
  const both = {
    reply: 'Booked.',
    edits: [
      ...goodOrtho.edits,
      { kind: 'update_record', targetKind: 'referral', id: 'r1', fields: { appointmentDate: '2026-09-22', appointmentTime: '10:30' } },
    ],
  };
  assert.deepEqual(checkAppointmentReply(both, want), []);
  // CONTROL: the event alone leaves the referral "open" on the Referrals screen.
  assert.ok(checkAppointmentReply(goodOrtho, want).some((x) => x.includes('no update_record')));
});

test('marking an existing event important: an update passes', () => {
  const want = byId('mark-important').want;
  const good = { reply: 'Marked as important.', edits: [{ kind: 'update_record', targetKind: 'calendar_event', id: 'gcal-p', fields: { important: true } }] };
  assert.deepEqual(checkAppointmentReply(good, want), []);
  // The model may send the value as a string; the app coerces it (buildPatch).
  const asString = structuredClone(good);
  asString.edits[0].fields.important = 'true';
  assert.deepEqual(checkAppointmentReply(asString, want), []);
});

test('CONTROL: marking by reply alone, by a new event, or on the wrong event fails', () => {
  const want = byId('mark-important').want;
  assert.ok(checkAppointmentReply({ reply: "Done — it's marked important.", edits: [] }, want).some((x) => x.includes('no update_record')));
  const newEvent = { reply: 'Added.', edits: [{ kind: 'calendar_event', title: 'Psychiatry', date: '2026-10-06', time: '09:00', category: 'Appointment', memberNames: ['Alex Muster'], important: true }] };
  const p = checkAppointmentReply(newEvent, want);
  assert.ok(p.some((x) => x.includes('new calendar_event')) && p.some((x) => x.includes('no update_record')), p.join('; '));
  const wrongOne = { reply: 'Marked.', edits: [{ kind: 'update_record', targetKind: 'calendar_event', id: 'ev-dent', fields: { important: true } }] };
  assert.ok(checkAppointmentReply(wrongOne, want).some((x) => x.includes('no update_record')));
  const unmarked = { reply: 'Done.', edits: [{ kind: 'update_record', targetKind: 'calendar_event', id: 'gcal-p', fields: { important: false } }] };
  assert.ok(checkAppointmentReply(unmarked, want).some((x) => x.startsWith('important')));
});

test('every case has a want the checker understands, and fixtures are fictional', () => {
  for (const c of APPOINTMENT_CASES) {
    assert.ok(c.id && c.q && c.want, c.id);
    assert.ok(c.want.event || c.want.ask || c.want.noNewEventOn || c.want.markImportant, `${c.id}: nothing to check`);
    assert.ok(!/rory|clark/i.test(JSON.stringify(c.context || {})), `${c.id}: no real names in the fixture`);
  }
  const ctx = JSON.stringify(appointmentContext());
  assert.ok(!/rory|clark/i.test(ctx), 'no real names in the fixture');
});

// ── the rule is still in the prompt ─────────────────────────────────────────
const RULES = [
  'AN APPOINTMENT THE USER TELLS YOU ABOUT IS ALWAYS AN EDIT, NEVER JUST A REPLY',
  'APPOINTMENT DATES:',
  'IMPORTANT EVENTS:',
];
function missingRules(src) {
  const start = src.indexOf('const SYSTEM_INSTRUCTION = `');
  if (start < 0) return ['SYSTEM_INSTRUCTION'];
  const body = src.slice(start, src.indexOf('`;\n', start));
  return RULES.filter((r) => !body.includes(r));
}

test('the appointment rules are in SYSTEM_INSTRUCTION', () => {
  assert.deepEqual(missingRules(SERVER), []);
});

test('CONTROL: the guard notices a rule being removed', () => {
  assert.deepEqual(missingRules(SERVER.replace(RULES[0], 'An appointment is sometimes an edit')), [RULES[0]]);
  // …and a rule that moved OUT of the prompt (e.g. into a comment) is also missing.
  assert.deepEqual(missingRules('const SYSTEM_INSTRUCTION = `nothing`;\n// ' + RULES.join(' ')), RULES);
});

// ── the harness talks to the model the way the server does ────────────────
function serverUserTurn(src, { today, lang, ctxJson, text }) {
  const m = src.match(/const userParts = \[\{ text: `([^`]+)` \}\]/);
  if (!m) return null;
  return m[1]
    .replaceAll('\\n', '\n') // the source spells newlines as \n escapes
    .replaceAll('${today}', today)
    .replaceAll('${langName}', lang)
    .replaceAll('${ctxJson}', ctxJson)
    .replaceAll('${userText}', text);
}

test("buildUserTurn matches server.js's user turn", () => {
  const context = appointmentContext();
  const args = { today: APPOINTMENT_TODAY, lang: 'English', ctxJson: JSON.stringify(context), text: 'hello' };
  const fromServer = serverUserTurn(SERVER, args);
  assert.ok(fromServer, 'server.js user-turn template not found — update chatScenarios.mjs');
  assert.equal(buildUserTurn({ context, text: 'hello' }), fromServer);
  // CONTROL: a changed server template is noticed.
  const changed = SERVER.replace("Today's date is ${today}.", 'Date: ${today}.');
  assert.notEqual(buildUserTurn({ context, text: 'hello' }), serverUserTurn(changed, args));
});
