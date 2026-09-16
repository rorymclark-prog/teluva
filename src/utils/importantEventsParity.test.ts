// Parity test: the client's isImportantEvent and the server's must agree.
//
//   npx tsx src/utils/importantEventsParity.test.ts
//
// WHY. The app decides which events are important (src/utils/importantEvents.ts,
// on top of the medical keyword net in eventKeywordFlags.ts). The published
// .ics feed runs on the server, cannot import a .ts module, and carries a port
// of both (server/importantEvents.mjs) to decide which events get a reminder.
// If the two drift, the family sees a star on an appointment in the app and
// their phone never reminds them of it — or the other way round.
//
// So the keyword lists must be identical, in the same order, and every fixture
// below runs through BOTH implementations with the same answer. Change one
// side without the other and this fails.
import assert from 'node:assert';
import { isImportantEvent as client } from './importantEvents';
import { MEDICAL_KEYWORDS as clientKeywords } from './eventKeywordFlags';
import { isImportantEvent as server, MEDICAL_KEYWORDS as serverKeywords } from '../../server/importantEvents.mjs';

assert.deepStrictEqual([...serverKeywords], [...clientKeywords], 'server/importantEvents.mjs MEDICAL_KEYWORDS must match eventKeywordFlags.ts exactly');

type Fixture = { title?: string; description?: string; important?: boolean };
const FIXTURES: Fixture[] = [
  { title: 'Pediatrician — Ben' },
  { title: 'Dentist', important: false },
  { title: "Mia's school play", important: true },
  { title: 'Football practice' },
  { title: 'Termin', description: 'Ordination Dr. Beispiel' },
  { title: 'Ärztin' },                              // keyword starting with an umlaut
  { title: 'Hausärztin Mama' },
  { title: 'Enter the raffle' },                    // "ent" only as a whole word
  { title: 'GPS workshop' },                        // no "gp" inside "GPS"
  { title: 'Flu   shot' },                          // a phrase across extra spaces
  { title: 'Orthopädie Kontrolle' },
  { title: 'Psychiatrie' },
  { title: 'Termin Dr. Beispiel (Psych.)' },        // shorthand the net does not know
  { title: 'Sensor change' },
  { title: '' },
  {},
];

let checked = 0;
for (const business of [false, true]) {
  for (const f of FIXTURES) {
    assert.strictEqual(server(f, { business }), client(f as never, { business }),
      `disagree on ${JSON.stringify(f)} (business: ${business})`);
    checked++;
  }
}

// CONTROL: the comparison above can fail — a rule that differs is noticed.
assert.notStrictEqual(server({ title: 'Dentist' }, { business: true }), client({ title: 'Dentist' } as never, { business: false }));

console.log(`importantEventsParity.test.ts: ${checked} fixtures agree, ${clientKeywords.length} keywords identical`);
