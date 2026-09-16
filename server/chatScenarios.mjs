// Chat regression scenarios: "I told it about my appointment".
//
// THE REPORT (2026-09-13). "I have an orthopaedic surgeon appointment this
// month and a psychiatry appointment in a few weeks and it didn't pick up any
// of these in calendar or when I ask the chat." One of the ways that happens:
// the user TELLS the assistant, the assistant replies warmly, and proposes no
// edit — so nothing is ever saved. The prompt rule for it lives in server.js
// ("AN APPOINTMENT THE USER TELLS YOU ABOUT IS ALWAYS AN EDIT"). These are
// the cases that rule must hold for, and a pure checker for the model's JSON.
//
// Two consumers:
//   - server/chatScenarios.test.mjs (npm test): proves the CHECKER is right —
//     a good reply passes, and each known-bad reply (reply only, no time, no
//     person, invented date, duplicate) fails. No model is called.
//   - scripts/interrogate-chat.mjs (manual, needs Vertex credentials): runs
//     these cases against the REAL prompt and model and applies the checker.
//
// Fictional family throughout. No production data.

export const APPOINTMENT_TODAY = '2026-09-13'; // a Sunday

const ALEX = 'Alex Muster';
const MIA = 'Mia Muster';

/** FAMILY DATA as the app sends it, trimmed to what these cases need. */
export function appointmentContext(extra = {}) {
  return {
    isBusinessSpace: false,
    familyName: 'Muster',
    members: [
      {
        id: 'm1', name: ALEX, role: 'Parent',
        referrals: [
          { id: 'r1', kind: 'Referral', reason: 'Orthopaedic surgeon', providerName: 'Dr Anna Beispiel', status: 'open' },
        ],
      },
      { id: 'm2', name: MIA, role: 'Child', referrals: [] },
    ],
    calendar: [],
    ...extra,
  };
}

/**
 * The user turn exactly as server.js builds it for /api/chat (English reply).
 * Kept in step with server.js by chatScenarios.test.mjs.
 */
export function buildUserTurn({ today = APPOINTMENT_TODAY, context, text }) {
  return `Today's date is ${today}.\nRESPOND IN: English. Write your "reply" field in English. All edit field values stay in the original language (names, labels, dates — never translate these).\nFAMILY DATA (JSON):\n${JSON.stringify(context)}\n\nUSER MESSAGE:\n${text}`;
}

/**
 * want:
 *   { event: { date, time, member } }       — must propose exactly this appointment
 *   { referralUpdate: { id, appointmentDate } } — must also book that referral
 *   { ask: true }                            — must NOT invent a date; asks instead
 *   { noNewEventOn: date }                   — already on the calendar: no second one
 *   { markImportant: { id, value } }         — an update to that existing event's
 *                                              "important", never a new event
 */
export const APPOINTMENT_CASES = [
  {
    id: 'told-ortho',
    q: 'I have an orthopaedic surgeon appointment on the 22nd at 10:30',
    want: { event: { date: '2026-09-22', time: '10:30', member: ALEX } },
  },
  {
    id: 'pasted-german',
    q: 'Can you add this: "Ihr Termin in der Psychiatrischen Ambulanz am 6.10. um 09:00 Uhr. Bitte bringen Sie Ihre e-card mit."',
    want: { event: { date: '2026-10-06', time: '09:00', member: ALEX } },
  },
  {
    id: 'for-child',
    q: 'Mia has the dentist on Friday the 18th at 15:00',
    want: { event: { date: '2026-09-18', time: '15:00', member: MIA } },
  },
  {
    id: 'no-date',
    q: 'I have a psychiatry appointment coming up soon',
    want: { ask: true },
  },
  {
    id: 'already-on-calendar',
    q: "Don't forget my Orthopädie appointment on the 22nd at 10:30",
    context: appointmentContext({
      calendar: [{ id: 'gcal-o', title: 'Orthopädie Dr. Beispiel', date: '2026-09-22', time: '10:30', category: 'Appointment', memberIds: ['m1'] }],
    }),
    want: { noNewEventOn: '2026-09-22' },
  },
  {
    id: 'referral-booked',
    q: 'My orthopaedic surgeon appointment with Dr Beispiel is booked for 22 September at 10:30',
    want: {
      event: { date: '2026-09-22', time: '10:30', member: ALEX },
      referralUpdate: { id: 'r1', appointmentDate: '2026-09-22' },
    },
  },
  {
    // A Google import in shorthand: "Psych." is no keyword, so the app did not
    // mark it on its own — which is exactly when the family asks. The other
    // entry shows how the app sends one it did mark (calendarForChat).
    id: 'mark-important',
    q: 'Mark my psychiatry appointment as important',
    context: appointmentContext({
      calendar: [
        { id: 'gcal-p', title: 'Termin Dr. Beispiel (Psych.)', date: '2026-10-06', time: '09:00', category: 'Appointment', memberIds: ['m1'] },
        { id: 'ev-dent', title: 'Dentist — Mia', date: '2026-09-18', time: '15:00', category: 'Appointment', memberIds: ['m2'], important: true },
      ],
    }),
    want: { markImportant: { id: 'gcal-p', value: true } },
  },
];

const isCal = (e) => e && e.kind === 'calendar_event';

/** Problems with one model answer for one case; [] means it passes. */
export function checkAppointmentReply(out, want) {
  const problems = [];
  const edits = Array.isArray(out?.edits) ? out.edits : [];
  const cals = edits.filter(isCal);

  if (want.event) {
    const { date, time, member } = want.event;
    if (cals.length === 0) {
      problems.push('no calendar_event — a reply alone saves nothing');
    } else {
      const onDay = cals.filter((e) => e.date === date);
      if (onDay.length === 0) problems.push(`calendar_event on the wrong date (${cals.map((e) => e.date).join(', ')}; want ${date})`);
      else if (onDay.length > 1) problems.push(`${onDay.length} calendar_events for one appointment`);
      const ev = onDay[0] || cals[0];
      if (time && ev.time !== time) problems.push(`time ${JSON.stringify(ev.time)} (want ${time})`);
      const names = Array.isArray(ev.memberNames) ? ev.memberNames : [];
      if (!names.includes(member)) problems.push(`memberNames ${JSON.stringify(names)} (want ${member}) — untagged, it appears on nobody's profile`);
      if (ev.category !== 'Appointment') problems.push(`category ${JSON.stringify(ev.category)} (want Appointment)`);
      if (!String(ev.title || '').trim()) problems.push('empty title');
    }
  }

  if (want.referralUpdate) {
    const { id, appointmentDate } = want.referralUpdate;
    const upd = edits.find((e) => e && e.kind === 'update_record' && e.targetKind === 'referral' && e.id === id);
    if (!upd) problems.push(`no update_record booking referral ${id}`);
    else if (upd.fields?.appointmentDate !== appointmentDate) {
      problems.push(`referral appointmentDate ${JSON.stringify(upd.fields?.appointmentDate)} (want ${appointmentDate})`);
    }
  }

  if (want.ask) {
    if (cals.some((e) => e.date)) problems.push(`invented a date (${cals.map((e) => e.date).join(', ')}) instead of asking`);
    if (!String(out?.reply || '').includes('?')) problems.push('did not ask for the date');
  }

  if (want.markImportant) {
    const { id, value } = want.markImportant;
    const upd = edits.find((e) => e && e.kind === 'update_record' && e.targetKind === 'calendar_event' && e.id === id);
    const got = upd ? String(upd.fields?.important).toLowerCase() : undefined;
    if (!upd) problems.push(`no update_record on calendar_event ${id} — a reply alone marks nothing`);
    else if (got !== String(value)) problems.push(`important ${JSON.stringify(upd.fields?.important)} (want ${value})`);
    if (cals.length > 0) problems.push('proposed a new calendar_event — the appointment already exists');
  }

  if (want.noNewEventOn) {
    if (cals.some((e) => e.date === want.noNewEventOn)) problems.push(`proposed a second event on ${want.noNewEventOn} — it is already on the calendar`);
  }

  return problems;
}
