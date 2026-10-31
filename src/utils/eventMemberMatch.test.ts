import assert from 'node:assert/strict';
import { CalendarEvent, FamilyMember } from '../types';
import { calendarTagPeople, resolveCalendarPeople, resolveEventMembers, eventBelongsToMember } from './eventMemberMatch';

const M = (id: string, name: string) => ({ id, name }) as Pick<FamilyMember, 'id' | 'name'>;
const FAMILY = [M('rory', 'Rory Clark'), M('ganga', 'Ganga Clark'), M('vita', 'Vita Clark'), M('nom', 'Nomvula Clark')];

const ev = (title: string, memberIds?: string[]) =>
  ({ title, memberIds }) as Pick<CalendarEvent, 'title' | 'memberIds'>;

// --- the reported bug, exactly as it appeared on screen ---------------------
{
  // Imported from Google, memberIds: [], showing as "All family", and so
  // absent from Ganga's Check-ups and Medical screens.
  const real = ev('Ganga – Orthodontist (Dr. Lena Hofer-Mayr)', []);
  const r = resolveEventMembers(real, FAMILY);
  assert.deepEqual(r.memberIds, ['ganga']);
  assert.equal(r.explicit, false, 'read from the title, and the UI should say so');
  assert.equal(eventBelongsToMember(real, 'ganga', FAMILY), true);
  assert.equal(eventBelongsToMember(real, 'vita', FAMILY), false);
}

// --- an explicit tag is never overruled ------------------------------------
{
  // The title names Ganga but the user tagged Vita. The user wins.
  const r = resolveEventMembers(ev('Ganga – Orthodontist', ['vita']), FAMILY);
  assert.deepEqual(r.memberIds, ['vita']);
  assert.equal(r.explicit, true);
}

// --- genuinely-everyone events stay everyone's -----------------------------
{
  const r = resolveEventMembers(ev('Family dinner at Oma', []), FAMILY);
  assert.deepEqual(r.memberIds, []);
  assert.equal(r.explicit, true, 'nothing was inferred, so there is nothing to flag as a guess');
}

// --- several people in one title -------------------------------------------
{
  const r = resolveEventMembers(ev('Vita & Ganga: Re-test Ferritin and Vitamin D', []), FAMILY);
  assert.deepEqual(r.memberIds.sort(), ['ganga', 'vita']);
}

// --- word boundaries, which is what stops the nonsense ---------------------
{
  // "Vita" sits inside "Vitamin". A substring check would tag this to Vita.
  assert.deepEqual(resolveEventMembers(ev('Vitamin D blood test', []), FAMILY).memberIds, []);
  // And inside "Vitaminmangel" mid-word.
  assert.deepEqual(resolveEventMembers(ev('Vitaminmangel abklären', []), FAMILY).memberIds, []);
}

// --- punctuation is a boundary, not part of the name -----------------------
{
  assert.deepEqual(resolveEventMembers(ev('Zahnarzt (Ganga), 15:00', []), FAMILY).memberIds, ['ganga']);
  assert.deepEqual(resolveEventMembers(ev('Impftermin für Nomvula', []), FAMILY).memberIds, ['nom']);
}

// --- case and accents ------------------------------------------------------
{
  assert.deepEqual(resolveEventMembers(ev('GANGA ORTHODONTIST', []), FAMILY).memberIds, ['ganga']);
  const accented = [M('zoe', 'Zoë Clark')];
  assert.deepEqual(resolveEventMembers(ev('Zoe - dentist', []), accented).memberIds, ['zoe']);
  assert.deepEqual(resolveEventMembers(ev('Zoë - dentist', []), accented).memberIds, ['zoe']);
}

// --- full name as well as first name ---------------------------------------
{
  assert.deepEqual(resolveEventMembers(ev('Parents evening — Ganga Clark', []), FAMILY).memberIds, ['ganga']);
}

// --- a surname alone tags nobody -------------------------------------------
{
  // Everyone here is a Clark. Matching the surname would put one child's
  // appointment on all four profiles.
  assert.deepEqual(resolveEventMembers(ev('Clark family photo', []), FAMILY).memberIds, []);
}

// --- names that are also calendar words ------------------------------------
{
  const withMay = [M('may', 'May Clark'), M('rory', 'Rory Clark')];
  // A bare mention is the month, not the child.
  assert.deepEqual(resolveEventMembers(ev('May half term', []), withMay).memberIds, []);
  assert.deepEqual(resolveEventMembers(ev('Exams start in May', []), withMay).memberIds, []);
  // An attribution is the child.
  assert.deepEqual(resolveEventMembers(ev('May – dentist', []), withMay).memberIds, ['may']);
  assert.deepEqual(resolveEventMembers(ev("May's dentist", []), withMay).memberIds, ['may']);
  assert.deepEqual(resolveEventMembers(ev('Dentist for May', []), withMay).memberIds, ['may']);
}

// --- very short names are left to explicit tagging -------------------------
{
  // "Jo" would match a room label, an initial, an abbreviation. Not worth it.
  const short = [M('jo', 'Jo')];
  assert.deepEqual(resolveEventMembers(ev('Jo dentist', []), short).memberIds, []);
}

// --- degenerate input ------------------------------------------------------
{
  assert.deepEqual(resolveEventMembers(ev('', []), FAMILY).memberIds, []);
  assert.deepEqual(resolveEventMembers(ev('Dentist', undefined), FAMILY).memberIds, []);
  assert.deepEqual(resolveEventMembers(ev('Ganga dentist', []), []).memberIds, [], 'no members, no matches');
  assert.deepEqual(resolveEventMembers(ev('Ganga dentist', []), [M('blank', '  ')]).memberIds, []);
}

// --- a name containing regex metacharacters cannot break the matcher -------
{
  const odd = [M('x', 'A.B')];
  assert.deepEqual(resolveEventMembers(ev('AXB dentist', []), odd).memberIds, [], 'the dot is a dot, not "any character"');
  assert.deepEqual(resolveEventMembers(ev('A.B dentist', []), odd).memberIds, ['x']);
}

console.log('eventMemberMatch.test.ts: all assertions passed');

// An employee has one confidential profile and a safe directory of colleagues.
// Both explicit and imported-by-name events can show the colleague's name
// without needing their birth date, CV, medical file or any other HR fields.
{
  const people = [M('self', 'Sam Singh'), M('colleague', 'Ada Lovelace')];
  const colleague = resolveCalendarPeople(ev('Planning meeting', ['colleague']), people, true);
  assert.equal(colleague.wholeGroup, false);
  assert.deepEqual(colleague.people, [M('colleague', 'Ada Lovelace')]);
  assert.equal(colleague.explicit, true);
  const imported = resolveCalendarPeople(ev('Ada — site visit', []), people, true);
  assert.deepEqual(imported.memberIds, ['colleague']);
  assert.equal(imported.explicit, false);
  const tags = calendarTagPeople(people, ['colleague'], true);
  assert.ok(tags.some(person => person.id === 'colleague'), 'a colleague is available for event tagging');
  assert.deepEqual(resolveCalendarPeople(ev('Team meeting', []), people, true).people, []);
  assert.equal(resolveCalendarPeople(ev('Team meeting', []), people, true).wholeGroup, true);
}

// A failed directory load or a removed person does not broaden an explicit
// event to 'Whole team'. Editing it keeps its IDs until the user removes them.
{
  const loadedSelf = [M('self', 'Sam Singh')];
  const ids = ['departed', 'self', 'departed'];
  const departed = resolveCalendarPeople(ev('Planning meeting', ids), loadedSelf, true);
  assert.equal(departed.wholeGroup, false);
  assert.deepEqual(departed.memberIds, ['departed', 'self']);
  assert.equal(departed.people[0].name, 'Previous team member');
  const offline = resolveCalendarPeople(ev('Planning meeting', ['colleague']), loadedSelf, true, false);
  assert.equal(offline.people[0].name, 'Assigned teammate');
  assert.equal(offline.wholeGroup, false);
  const options = calendarTagPeople(loadedSelf, ['colleague'], true, false);
  assert.deepEqual(options.map(person => person.id), ['self', 'colleague']);
  assert.deepEqual(calendarTagPeople(loadedSelf, [], true).map(person => person.id), ['self'], 'unknown people are not new assignment choices');
  assert.equal(resolveCalendarPeople(ev('Family event', ['departed']), loadedSelf).people[0].name, 'Previous member');
  assert.deepEqual(ids, ['departed', 'self', 'departed'], 'display resolution does not mutate stored tags');
}
console.log('eventMemberMatch.test.ts: safe business roster, colleague tags and offline/departed assignment preservation passed');
