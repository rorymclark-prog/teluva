// Standalone assertion test for healthTimeline.ts — no test runner is
// configured in this project (package.json has only vite/tsc scripts), so
// run it directly:
//   npx tsx src/utils/healthTimeline.test.ts
// It exits non-zero on failure. Mirrors referralGrouping.test.ts's convention.
import assert from 'node:assert/strict';
import { buildHealthTimeline } from './healthTimeline';
import { FamilyMember, CalendarEvent } from '../types';

const NOW = new Date(2026, 7, 15); // 15 Aug 2026, local midnight — matches other tests' convention

function member(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: 'm1',
    name: 'Test Person',
    role: 'Parent',
    avatarColor: 'bg-blue-500',
    clothingSizes: {},
    documents: [],
    ...overrides,
  };
}

const ev = (overrides: Partial<CalendarEvent> & { id: string; date: string }): CalendarEvent => ({
  title: 'Appointment',
  category: 'Appointment',
  remindMe: false,
  ...overrides,
});

/* ---------------- rule 1: undated vaccination is bucketed, not dropped ---------------- */
{
  const m = member({
    medical: {
      vaccinations: [
        { id: 'v1', name: 'Tetanus', date: '2020-03-01' },
        { id: 'v2', name: 'MMR' }, // no date — server.js tells the AI to leave this blank rather than guess
      ],
    },
  });
  const result = buildHealthTimeline({ member: m, events: [], members: [m], now: NOW });

  assert.equal(result.undated.length, 1, 'the undated jab must not be dropped');
  assert.equal(result.undated[0].id, 'vaccination-v2');
  assert.equal(result.undated[0].title, 'MMR');

  const dated = result.years.flatMap((y) => y.items);
  assert.equal(dated.length, 1);
  assert.equal(dated[0].id, 'vaccination-v1');
}

/* ---------------- rule 2: referral positions by .date, never .addedAt ---------------- */
{
  const m = member({
    referrals: [
      {
        id: 'r1',
        kind: 'Lab result',
        date: '2019-06-01',              // the clinical date
        addedAt: '2026-01-05T00:00:00.000Z', // scanned in years later
        reason: 'Annual bloods',
        status: 'done',
        fileName: 'scan.jpg',
        fileType: 'image/jpeg',
        fileSize: 100,
        storagePath: 'p',
        downloadUrl: 'https://example.com/x',
      },
    ],
  });
  const result = buildHealthTimeline({ member: m, events: [], members: [m], now: NOW });

  assert.equal(result.years.length, 1, 'exactly one year bucket');
  assert.equal(result.years[0].year, 2019, 'must land in 2019 (the referral date), not 2026 (addedAt)');
  const item = result.years[0].items[0];
  assert.equal(item.filedAt, '2026-01-05T00:00:00.000Z', 'addedAt is still surfaced, as display-only "filed" text');
}

/* ---------------- rule 4: a careSchedule entry with no lastVisit produces no history row ---------------- */
{
  // No lastVisit and no derivable nextDue at all — must be OMITTED, not shown anywhere.
  const mOmitted = member({
    careSchedule: [{ id: 'c1', kind: 'Dental check-up', intervalMonths: 6 }],
  });
  const rOmitted = buildHealthTimeline({ member: mOmitted, events: [], members: [mOmitted], now: NOW });
  assert.equal(rOmitted.years.flatMap((y) => y.items).length, 0, 'no history row for a never-visited item');
  assert.equal(rOmitted.upcoming.length, 0, 'nothing to show as upcoming either — nextDue can\'t be derived without a lastVisit');
  assert.equal(rOmitted.counts.omitted, 1, 'the drop must still be counted, not silent');

  // No lastVisit, but an explicit nextDue — belongs under upcoming, still no history row.
  const mUpcoming = member({
    careSchedule: [{ id: 'c2', kind: 'Eye test', intervalMonths: 24, nextDue: '2026-09-01' }],
  });
  const rUpcoming = buildHealthTimeline({ member: mUpcoming, events: [], members: [mUpcoming], now: NOW });
  assert.equal(rUpcoming.years.flatMap((y) => y.items).length, 0, 'still no history row — there was no visit');
  assert.equal(rUpcoming.upcoming.length, 1);
  assert.equal(rUpcoming.upcoming[0].date, '2026-09-01');
  assert.equal(rUpcoming.counts.omitted, 0);
}

/* ---------------- rule 5: a name-matched (non-memberIds) appointment is included ---------------- */
{
  const m = member({ id: 'ganga', name: 'Ganga Clark' });
  const events: CalendarEvent[] = [
    // Google-imported: memberIds is empty, only the title names the person —
    // exactly the bug Phase 0 fixed for the pediatric-only version.
    ev({ id: 'e1', date: '2026-09-10', title: 'Ganga – Orthodontist', memberIds: [] }),
  ];
  const result = buildHealthTimeline({ member: m, events, members: [m], now: NOW });
  assert.equal(result.upcoming.length, 1, 'a title-matched appointment must be included, not just an explicitly-tagged one');
  assert.equal(result.upcoming[0].id, 'appointment-e1');
}

/* ---------------- counts reconcile against total input records ---------------- */
{
  const m = member({
    medical: {
      vaccinations: [
        { id: 'v1', name: 'Tetanus', date: '2020-03-01' },
        { id: 'v2', name: 'MMR' },
      ],
    },
    careSchedule: [
      { id: 'c1', kind: 'Dental check-up', intervalMonths: 6, lastVisit: '2025-01-10' }, // -> dated
      { id: 'c2', kind: 'Eye test', intervalMonths: 24, nextDue: '2026-09-01' },          // -> upcoming
      { id: 'c3', kind: 'Skin check', intervalMonths: 12 },                                // -> omitted
    ],
    referrals: [
      {
        id: 'r1', kind: 'Lab result', date: '2019-06-01', addedAt: '2026-01-01T00:00:00.000Z',
        reason: 'Bloods', status: 'done', fileName: 'a', fileType: 'image/jpeg', fileSize: 1,
        storagePath: 'p', downloadUrl: 'https://example.com/x',
      },
      {
        id: 'r2', kind: 'Referral', addedAt: '2026-01-01T00:00:00.000Z', // no .date -> undated
        reason: 'Knee', status: 'open', fileName: 'b', fileType: 'image/jpeg', fileSize: 1,
        storagePath: 'p', downloadUrl: 'https://example.com/x',
      },
    ],
    growthHistory: [
      { id: 'g1', date: '2024-01-01', heightCm: 100, weightKg: 16 },
      { id: 'g2', date: '2025-01-01', heightCm: 106, weightKg: 18 },
    ],
  });
  const events: CalendarEvent[] = [
    ev({ id: 'e1', date: '2026-09-10', title: 'Test Person – GP', memberIds: [m.id] }), // -> upcoming
    ev({ id: 'e2', date: '2020-01-01', title: 'Test Person – GP', memberIds: [m.id] }), // -> dated (past)
    ev({ id: 'e3', date: '2026-09-10', title: 'unrelated', category: 'School', memberIds: [m.id] }), // not Appointment — excluded from totals entirely
  ];
  const result = buildHealthTimeline({ member: m, events, members: [m], now: NOW });

  const { counts } = result;
  assert.equal(
    counts.total,
    counts.upcoming + counts.dated + counts.undated + counts.omitted,
    'every input record must land in exactly one bucket',
  );
  // Sanity on the actual numbers, not just that they happen to add up:
  // 2 vaccinations + 3 careSchedule + 2 referrals + 2 growth + 2 matched appointments = 11
  assert.equal(counts.total, 11);
  assert.equal(counts.omitted, 1); // c3 only
  assert.equal(counts.upcoming, 2); // c2 + e1
  assert.equal(counts.dated, 6);   // v1, c1, r1, g1, g2, e2
  assert.equal(counts.undated, 2); // v2, r2
}

console.log('healthTimeline.test.ts: all assertions passed');
