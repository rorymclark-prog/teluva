// Standalone assertion test for utils/hiddenPeople.ts:
//   npx tsx src/utils/hiddenPeople.test.ts
// Exits non-zero on failure. Every name here is invented (the demo family is
// Mama, Papa, Mia and Ben; Nora and Aunt Klara are made up for this file).
import assert from 'node:assert';
import type {
  AnniversaryRecord, CalendarEvent, ExtendedBirthday, FamilyMember, FamilyMemberRole, FamilyRole, HiddenDatePerson, HiddenDatePersonFor,
} from '../types';
import {
  buildHiddenPeople, hiddenKey, NO_HIDDEN_PEOPLE, candidateNames, titleNamesHiddenPerson,
  visibleDateMembers, visibleExtendedBirthdays, visibleAnniversaries, visibleEvents, visiblePets,
  visibleLinkedPeople, eventIsHiddenDate, occasionPersonKey, hiddenRows, withHidden, withoutHidden,
  markHiddenDatesForChat, hiddenForAccount, accountHiddenLists, withHiddenFor, withHiddenForOnly,
  withoutHiddenFor, rowHidesFor, hideAccounts, hiddenFromWords, rehide, rehideOrder, rowChoice, startingTicks,
  type HiddenScope, type RehideChoice,
} from './hiddenPeople';
import { buildCalendarBirthdays, buildCalendarExtendedBirthdays, buildCalendarAnniversaries } from './familyDates';

let n = 0;
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); n++; };
const eq = <T,>(a: T, b: T, msg: string) => { assert.deepStrictEqual(a, b, msg); n++; };

const member = (id: string, name: string, birthdate = '1988-05-03'): FamilyMember =>
  ({ id, name, role: 'Parent', birthdate, avatarColor: 'bg-sage-500', documents: [], growthHistory: [] } as unknown as FamilyMember);
const person = (id: string, name: string): HiddenDatePerson => ({ id, name, hiddenAt: '2026-09-14T10:00:00.000Z' });

const mama = member('m-mama', 'Mama');
const papa = member('m-papa', 'Papa');
const nora = member('m-nora', 'Nora');           // an ex-partner, still on the family record
const members = [mama, papa, nora];
const klara: ExtendedBirthday = { id: 'eb-klara', name: 'Aunt Klara', relationship: 'Aunt', date: '06-21', createdAt: '2026-01-01' } as ExtendedBirthday;
const oma: ExtendedBirthday = { id: 'eb-oma', name: 'Oma', relationship: 'Grandmother', date: '09-19', createdAt: '2026-01-01' } as ExtendedBirthday;

// --- nothing hidden: every filter is the identity, and cheap ---------------
{
  const hp = buildHiddenPeople([undefined, []]);
  ok(hp === NO_HIDDEN_PEOPLE, 'no lists → the shared empty set');
  ok(visibleDateMembers(members, hp) === members, 'no hidden people → the same array back');
  ok(!eventIsHiddenDate({ title: "Nora's birthday" }, hp), 'no hidden people → no event is hidden');
}

// --- hide by id --------------------------------------------------------------
{
  const hp = buildHiddenPeople([[person(hiddenKey.member('m-nora'), 'Nora')]]);
  eq(visibleDateMembers(members, hp).map((m) => m.id), ['m-mama', 'm-papa'], 'a hidden member drops out of the birthday input');
  const cards = buildCalendarBirthdays(visibleDateMembers(members, hp));
  ok(cards.length === 2 && cards.every((c) => c.memberName !== 'Nora'), 'and so off the Birthdays panel');
  // The filter is by id: a different record that happens to share the name is untouched.
  const otherNora: ExtendedBirthday = { ...klara, id: 'eb-nora-neighbour', name: 'Nora' };
  eq(visibleExtendedBirthdays([otherNora], hp).length, 1, 'hiding member Nora does not hide an extended-birthday Nora');
}

// --- a rename does not unhide ------------------------------------------------
{
  const list = [person(hiddenKey.member('m-nora'), 'Nora')];
  const renamed = member('m-nora', 'Nora Berg');
  const hp = buildHiddenPeople([list], { members: [mama, renamed] });
  eq(visibleDateMembers([mama, renamed], hp).map((m) => m.id), ['m-mama'], 'renamed, still hidden — the key is the id');
  ok(titleNamesHiddenPerson('Nora Berg birthday', hp), 'the CURRENT name is matched too');
  ok(titleNamesHiddenPerson("Nora's birthday", hp), 'and the name they had when hidden');
}

// --- extended birthdays, contacts, pets, linked people ----------------------
{
  const hp = buildHiddenPeople([[
    person(hiddenKey.extended('eb-klara'), 'Aunt Klara'),
    person(hiddenKey.extended('contact-c1'), 'Onkel Otto'),
    person(hiddenKey.pet('p-rex'), 'Rex'),
    person(hiddenKey.linked('link-1', 'x-7'), 'Cousin Lea'),
  ]]);
  eq(visibleExtendedBirthdays([klara, oma], hp).map((e) => e.id), ['eb-oma'], 'an extended birthday is hidden by its id');
  eq(buildCalendarExtendedBirthdays(visibleExtendedBirthdays([klara, oma], hp)).length, 1, 'and never reaches the builder');
  eq(visibleExtendedBirthdays([{ id: 'contact-c1', name: 'Onkel Otto' }], hp).length, 0, 'a contact birthday uses its contact-<id> key');
  eq(visiblePets([{ id: 'p-rex' }, { id: 'p-tom' }], hp).map((p) => p.id), ['p-tom'], 'a pet');
  eq(visibleLinkedPeople('link-1', [{ id: 'x-7' }, { id: 'x-8' }], hp).map((p) => p.id), ['x-8'], 'a connected household person');
  eq(visibleLinkedPeople('link-2', [{ id: 'x-7' }], hp).length, 1, 'the same person id through a DIFFERENT link is a different person');
}

// --- honorifics: "Aunt Klara" is found as Klara, never as Aunt ---------------
{
  eq(candidateNames('Aunt Klara'), ['aunt klara', 'klara'], 'full name and first real name');
  eq(candidateNames('Oma'), ['oma'], 'a name that IS the honorific keeps itself');
  eq(candidateNames('Al'), [], 'too short to match anything by');
  const hp = buildHiddenPeople([[person(hiddenKey.extended('eb-klara'), 'Aunt Klara')]]);
  ok(eventIsHiddenDate({ title: "Klara's birthday" }, hp), "Klara's birthday is hers");
  ok(eventIsHiddenDate({ title: 'Klaras Geburtstag' }, hp), 'German possessive');
  ok(eventIsHiddenDate({ title: 'Geburtstag Tante Klára' }, hp), 'accents do not matter');
  ok(!eventIsHiddenDate({ title: "Aunt Mira's birthday" }, hp), '"Aunt" alone never matches');
  ok(!eventIsHiddenDate({ title: 'Klarabella birthday' }, hp), 'whole words only');
}

// --- a stored "<Name>'s birthday" is hidden; "Dinner with <Name>" is kept ----
{
  const hp = buildHiddenPeople([[person(hiddenKey.member('m-nora'), 'Nora')]], { members });
  const events: CalendarEvent[] = [
    { id: 'e1', title: "Nora's birthday", date: '2026-10-02' },
    { id: 'e2', title: 'Dinner with Nora', date: '2026-10-03' },
    { id: 'e3', title: "Mia's birthday party", date: '2026-10-04', memberIds: ['m-mama', 'm-nora'] },
    { id: 'e4', title: 'Birthday lunch', date: '2026-10-05', memberIds: ['m-nora'] },
    { id: 'e5', title: 'Wedding anniversary', date: '2026-10-06', memberIds: ['m-papa', 'm-nora'] },
    { id: 'e6', title: 'Nora – parents evening', date: '2026-10-07' },
  ] as CalendarEvent[];
  eq(visibleEvents(events, hp).map((e) => e.id), ['e2', 'e3', 'e6'], 'only her dates go');
  // CONTROL: the same events with nobody hidden are all kept — the assertion above can fail.
  eq(visibleEvents(events, NO_HIDDEN_PEOPLE).length, events.length, 'CONTROL: nothing hidden → nothing filtered');
}

// --- an anniversary with one hidden partner ---------------------------------
{
  const hp = buildHiddenPeople([[person(hiddenKey.member('m-nora'), 'Nora')]], { members });
  const records: AnniversaryRecord[] = [
    { id: 'a1', title: 'Wedding', kind: 'Wedding', date: '05-20', memberIds: ['m-papa', 'm-nora'], createdAt: '' },
    { id: 'a2', title: 'Wedding', kind: 'Wedding', date: '07-11', memberIds: ['m-mama', 'm-papa'], createdAt: '' },
    { id: 'a3', title: 'Papa & Nora engaged', kind: 'Other', date: '02-02', createdAt: '' },
  ] as AnniversaryRecord[];
  eq(visibleAnniversaries(records, hp).map((a) => a.id), ['a2'], 'one hidden partner hides the anniversary; so does naming her');
  const flagged: CalendarEvent[] = [{ id: 'ev9', title: 'Papa & Nora anniversary', date: '2099-03-01' } as CalendarEvent];
  eq(buildCalendarAnniversaries(visibleAnniversaries(records, hp), visibleEvents(flagged, hp)).length, 1,
    'the panel builder, fed filtered input, shows only the anniversary nobody hid');
  eq(buildCalendarAnniversaries(records, flagged).length, 4, 'CONTROL: unfiltered, all four reach the panel');
}

// --- both scopes, their union, and un-hiding ---------------------------------
{
  const mine = [person(hiddenKey.member('m-nora'), 'Nora')];
  const family = [person(hiddenKey.extended('eb-klara'), 'Aunt Klara')];
  const hp = buildHiddenPeople([mine, family]);
  eq([...hp.keys].sort(), ['extended:eb-klara', 'member:m-nora'], 'the effective set is the union');
  eq(visibleDateMembers(members, hp).length, 2, 'the personal list applies');
  eq(visibleExtendedBirthdays([klara, oma], hp).length, 1, 'the family list applies');

  const rows = hiddenRows(mine, [...family, person(hiddenKey.member('m-nora'), 'Nora')]);
  eq(rows.map((r) => [r.person.id, r.scopes]), [
    ['extended:eb-klara', ['family']],
    ['member:m-nora', ['me', 'family']],
  ], 'one row per person, saying which lists hide them');

  // Show again: off the personal list only — still hidden by the family's.
  const mineAfter = withoutHidden(mine, hiddenKey.member('m-nora'));
  const stillFamily = buildHiddenPeople([mineAfter, [...family, person(hiddenKey.member('m-nora'), 'Nora')]]);
  ok(stillFamily.keys.has('member:m-nora'), 'shown again for me, still hidden for the family');
  const shown = buildHiddenPeople([mineAfter, family]);
  eq(visibleDateMembers(members, shown).length, 3, 'off both lists → back on every surface');
  ok(!eventIsHiddenDate({ title: "Nora's birthday" }, shown), 'and her typed birthday is back too');

  eq(withHidden(mine, mine[0]), mine, 'hiding twice changes nothing');
  eq(withHidden([], mine[0]).length, 1, 'hiding adds exactly one entry');
}

// --- hidden from chosen accounts (HubSettings.hiddenDatePeopleFor) ----------
// "Hide Nora's birthday from Papa, leave it for the boys." Accounts are uids:
// u-mama and u-papa are admins, u-mia and u-ben the children's accounts.
{
  const noraKey = hiddenKey.member('m-nora');
  const forPapa: HiddenDatePersonFor[] = [{ ...person(noraKey, 'Nora'), forUids: ['u-papa'], by: 'u-mama' }];

  eq(hiddenForAccount(forPapa, 'u-papa').map((p) => p.id), [noraKey], 'the entry counts for the account it names');
  eq(hiddenForAccount(forPapa, 'u-ben'), [], 'CONTROL: and for nobody else');
  eq(hiddenForAccount(forPapa, null), [], 'no account → nothing (signed out never inherits a hide)');
  eq(hiddenForAccount(undefined, 'u-papa'), [], 'a missing field is an empty list');
  eq(hiddenForAccount([{ ...forPapa[0], forUids: 'u-papa' as unknown as string[] }], 'u-papa'), [], 'a malformed forUids names nobody');

  // The effective set is the union of all three lists, per account.
  const mine = [person(hiddenKey.extended('eb-klara'), 'Aunt Klara')];
  const papa = buildHiddenPeople(accountHiddenLists({ personal: mine, family: [], forSome: forPapa, uid: 'u-papa' }), { members });
  eq([...papa.keys].sort(), ['extended:eb-klara', 'member:m-nora'], 'own list ∪ family ∪ entries naming the account');
  eq(visibleDateMembers(members, papa).map((m) => m.id), ['m-mama', 'm-papa'], 'Nora is gone from Papa\'s birthdays');
  ok(eventIsHiddenDate({ title: "Nora's birthday" }, papa), 'and from his typed calendar entries');
  const ben = buildHiddenPeople(accountHiddenLists({ personal: [], family: [], forSome: forPapa, uid: 'u-ben' }), { members });
  ok(ben === NO_HIDDEN_PEOPLE, 'CONTROL: Ben was not ticked — nothing is hidden for him at all');
  eq(visibleDateMembers(members, ben).length, 3, 'so Nora\'s birthday is still on his calendar');

  // Hiding again for more accounts ADDS to who it is hidden from.
  const plusMama = withHiddenFor(forPapa, person(noraKey, 'Nora'), ['u-mama', 'u-papa']);
  eq(plusMama.map((e) => e.forUids), [['u-papa', 'u-mama']], 'forUids are unioned, never replaced');
  eq(plusMama[0].by, 'u-mama', 'the rest of the entry is kept');
  ok(withHiddenFor(plusMama, person(noraKey, 'Nora'), ['u-papa']) === plusMama, 'nobody new → the same list back');
  ok(withHiddenFor(forPapa, person(noraKey, 'Nora'), []) === forPapa, 'no uids → the same list back');
  eq(withHiddenFor([], person(noraKey, 'Nora'), ['u-papa', 'u-papa', '']).map((e) => e.forUids), [['u-papa']], 'a new entry, deduped');

  // "Change who" sets exactly who; nobody left → the entry is removed.
  eq(withHiddenForOnly(plusMama, noraKey, ['u-ben']).map((e) => e.forUids), [['u-ben']], 'Change who replaces the list');
  eq(withHiddenForOnly(plusMama, noraKey, []), [], 'ticking nobody removes the entry');
  ok(withHiddenForOnly(plusMama, 'member:m-other', ['u-ben']) === plusMama, 'a person not on the list is left alone');

  // Show again: for one account, or for everyone.
  eq(withoutHiddenFor(plusMama, noraKey, 'u-mama').map((e) => e.forUids), [['u-papa']], 'an admin shows her again for themselves only');
  eq(withoutHiddenFor(forPapa, noraKey, 'u-papa'), [], 'the last account shown again → the entry goes');
  eq(withoutHiddenFor(plusMama, noraKey), [], 'without a uid → shown to everyone again');

  // The "Show again" list: an admin sees every entry; a ticked account sees
  // the one that names it; an account nobody ticked sees nothing of it.
  const admin = hiddenRows([], [], { list: plusMama, uid: 'u-mia', manage: true });
  eq(admin.map((r) => [r.person.id, r.scopes, r.forUids]), [[noraKey, ['some'], ['u-papa', 'u-mama']]], 'an admin manages it even when not ticked');
  ok(!rowHidesFor(admin[0], 'u-mia'), 'but it does not hide anything from them');
  const ticked = hiddenRows([], [], { list: plusMama, uid: 'u-papa', manage: false });
  eq(ticked.length, 1, 'a ticked account is told — a missing birthday is never a mystery');
  ok(rowHidesFor(ticked[0], 'u-papa'), 'and the row counts as hidden for them');
  eq(hiddenRows([], [], { list: plusMama, uid: 'u-ben', manage: false }), [], 'CONTROL: an account nobody ticked sees nothing of it');
  const both = hiddenRows(mine, [], { list: [{ ...person(hiddenKey.extended('eb-klara'), 'Aunt Klara'), forUids: ['u-papa'] }], uid: 'u-papa', manage: false });
  eq(both.map((r) => r.scopes), [['me', 'some']], 'on two lists → one row, both scopes');
  eq(hiddenRows([], [], { list: [{ ...forPapa[0], forUids: [] }], uid: 'u-papa', manage: true }), [], 'an entry that names nobody is not a row');
}

// --- "Change who": replace how a person is hidden (v356) ---------------------
// Mama (u-mama, an admin) hid Nora "Just for you" and now wants her hidden from
// Papa but not from the children. Every from → to pair, multi-list rows too.
{
  const noraKey = hiddenKey.member('m-nora');
  const klaraKey = hiddenKey.extended('eb-klara');
  const nora = person(noraKey, 'Nora');
  const me = 'u-mama';
  const ACCOUNTS = ['u-mama', 'u-papa', 'u-mia', 'u-ben'];
  // Aunt Klara is on all three lists and must come through every change untouched.
  const klaraMine = person(klaraKey, 'Aunt Klara');
  const klaraFamily = { ...person(klaraKey, 'Aunt Klara'), by: 'u-papa' };
  const klaraFor: HiddenDatePersonFor = { ...person(klaraKey, 'Aunt Klara'), forUids: ['u-ben'], by: 'u-papa' };
  const noraFor = (uids: string[]): HiddenDatePersonFor => ({ ...nora, forUids: uids, by: 'u-papa' });

  type From = 'me' | 'family' | 'some' | 'me+family' | 'me+some' | 'family+some' | 'me+family+some';
  const from = (f: From) => ({
    personal: [klaraMine, ...(f.split('+').includes('me') ? [nora] : [])],
    family: [klaraFamily, ...(f.split('+').includes('family') ? [nora] : [])],
    forSome: [klaraFor, ...(f.split('+').includes('some') ? [noraFor(['u-papa', 'u-mia'])] : [])],
  });
  // Whether an account doesn't see Nora, reading the lists as the app does
  // (only Mama's own list is known here — the others' are private and empty).
  const hiddenFrom = (l: { personal: HiddenDatePerson[]; family: HiddenDatePerson[]; forSome: HiddenDatePersonFor[] }, uid: string) =>
    buildHiddenPeople(accountHiddenLists({ personal: uid === me ? l.personal : [], family: l.family, forSome: l.forSome, uid })).keys.has(noraKey);
  const where = (l: { personal: HiddenDatePerson[]; family: HiddenDatePerson[]; forSome: HiddenDatePersonFor[] }) => ({
    personal: l.personal.some((p) => p.id === noraKey),
    family: l.family.some((p) => p.id === noraKey),
    forUids: l.forSome.find((e) => e.id === noraKey)?.forUids ?? null,
  });

  const TO: { label: string; choice: RehideChoice; expect: ReturnType<typeof where>; sees: string[] }[] = [
    { label: 'Just for me', choice: { scope: 'me' }, expect: { personal: true, family: false, forUids: null }, sees: ['u-papa', 'u-mia', 'u-ben'] },
    { label: 'Everyone', choice: { scope: 'family' }, expect: { personal: false, family: true, forUids: null }, sees: [] },
    { label: 'Choose who: Papa', choice: { scope: 'some', forUids: ['u-papa'] }, expect: { personal: false, family: false, forUids: ['u-papa'] }, sees: ['u-mama', 'u-mia', 'u-ben'] },
    { label: 'Choose who: me and Papa', choice: { scope: 'some', forUids: ['u-mama', 'u-papa'] }, expect: { personal: false, family: false, forUids: ['u-mama', 'u-papa'] }, sees: ['u-mia', 'u-ben'] },
  ];
  const FROM: From[] = ['me', 'family', 'some', 'me+family', 'me+some', 'family+some', 'me+family+some'];

  for (const f of FROM) {
    for (const t of TO) {
      const cur = from(f);
      const next = rehide(cur, nora, t.choice, me);
      const tag = `${f} → ${t.label}`;
      eq(where(next), t.expect, `${tag}: on exactly the list the choice implies`);
      eq(ACCOUNTS.filter((u) => !hiddenFrom(next, u)), t.sees, `${tag}: who still sees her`);
      // CONTROL: Aunt Klara, on all three lists, is exactly as she was.
      eq([next.personal.filter((p) => p.id === klaraKey), next.family.filter((p) => p.id === klaraKey), next.forSome.filter((e) => e.id === klaraKey)],
        [[klaraMine], [klaraFamily], [klaraFor]], `${tag}: CONTROL — an unrelated person's entries are untouched`);
      eq(rehide(next, nora, t.choice, me), next, `${tag}: doing it twice is doing it once`);
      // THE ORDER. Only the first of the two saves landed (the second failed):
      // everyone the new choice hides her from already doesn't see her.
      const [first] = rehideOrder(t.choice);
      const mid = first === 'personal'
        ? { personal: next.personal, family: cur.family, forSome: cur.forSome }
        : { personal: cur.personal, family: next.family, forSome: next.forSome };
      ok(ACCOUNTS.every((u) => hiddenFrom(mid, u) || !hiddenFrom(next, u)), `${tag}: a failed second save leaves her more hidden, never less`);
    }
  }

  // The order itself: into my own list → that save first; anywhere else → the settings save first.
  eq(rehideOrder({ scope: 'me' }), ['personal', 'settings'], '"Just for me" adds to my list before the settings drop her');
  eq(rehideOrder({ scope: 'family' }), ['settings', 'personal'], '"Everyone" adds to the family list before my list drops her');
  eq(rehideOrder({ scope: 'some', forUids: ['u-papa'] }), ['settings', 'personal'], '"Choose who" adds the entry before my list drops her');
  // CONTROL for the order property: the other order, for "Just for me" from the
  // family list, drops her from the family list first — and Mama, who asked to
  // stop seeing her, would see her until the second save landed.
  {
    const cur = from('family');
    const next = rehide(cur, nora, { scope: 'me' }, me);
    const wrongMid = { personal: cur.personal, family: next.family, forSome: next.forSome };
    ok(!hiddenFrom(wrongMid, me), 'CONTROL: settings first for "Just for me" would show her to Mama in between (why the order matters)');
  }

  // Unchanged lists come back as the same arrays, so no needless save is made.
  {
    const cur = from('me');
    const next = rehide(cur, nora, { scope: 'me' }, me);
    ok(next.personal === cur.personal && next.family === cur.family && next.forSome === cur.forSome, 'already "Just for me" → nothing to save');
    const some = from('some');
    const same = rehide(some, nora, { scope: 'some', forUids: ['u-mia', 'u-papa'] }, me);
    ok(same.forSome === some.forSome, 'the same accounts in another order → the same list');
    ok(same.personal === some.personal && same.family === some.family, 'and the lists she was never on are left as they were');
  }
  // What gets written.
  {
    const next = rehide(from('me'), nora, { scope: 'family' }, me);
    eq(next.family.find((p) => p.id === noraKey), { ...nora, by: me }, 'new on a list → the given entry, by whoever changed it');
    const kept = rehide(from('some'), nora, { scope: 'some', forUids: ['u-papa'] }, me);
    eq(kept.forSome.find((e) => e.id === noraKey), noraFor(['u-papa']), 'already on the chosen list → the entry is kept, only who changes');
    eq(rehide(from('me'), nora, { scope: 'some', forUids: ['u-papa', 'u-papa', ''] }, me).forSome.find((e) => e.id === noraKey)?.forUids,
      ['u-papa'], 'forUids are cleaned');
  }
  // "Choose who" with nobody ticked is refused, not read as "show to everyone".
  for (const f of FROM) {
    const cur = from(f);
    const next = rehide(cur, nora, { scope: 'some', forUids: [] }, me);
    ok(next.personal === cur.personal && next.family === cur.family && next.forSome === cur.forSome, `${f} → Choose who, nobody ticked: nothing changes`);
  }
  // Missing lists are empty lists.
  eq(rehide({}, nora, { scope: 'some', forUids: ['u-papa'] }, me), { personal: [], family: [], forSome: [{ ...nora, by: me, forUids: ['u-papa'] }] },
    'no lists yet → just the new entry');

  // How "Change who" opens on a row: the scope it is actually in.
  const row = (scopes: HiddenScope[], forUids?: string[]) => ({ person: nora, scopes, ...(forUids ? { forUids } : {}) });
  eq(rowChoice(row(['me']), me), { scope: 'me' }, 'only on my list → "Just for me" (not Choose who with me ticked)');
  eq(rowChoice(row(['family']), me), { scope: 'family' }, 'on the family list → "Everyone"');
  eq(rowChoice(row(['me', 'family']), me), { scope: 'family' }, 'family and mine → "Everyone" (nobody sees her)');
  eq(rowChoice(row(['family', 'some'], ['u-papa']), me), { scope: 'family' }, 'family and chosen → "Everyone"');
  eq(rowChoice(row(['some'], ['u-papa', 'u-mia']), me), { scope: 'some', forUids: ['u-papa', 'u-mia'] }, 'chosen → those accounts ticked');
  eq(rowChoice(row(['me', 'some'], ['u-papa']), me), { scope: 'some', forUids: ['u-papa', 'u-mama'] }, 'mine and chosen → those accounts and me');
  eq(rowChoice(row(['me', 'some'], ['u-papa', 'u-mama']), me), { scope: 'some', forUids: ['u-papa', 'u-mama'] }, 'me already ticked → not twice');
  eq(rowChoice(undefined, me), { scope: 'me' }, 'no row → the smaller step');

  // Who "Choose who" starts ticked.
  eq(startingTicks(null, me, ACCOUNTS), [], 'a new hide: nobody — it never guesses');
  eq(startingTicks({ scope: 'me' }, me, ACCOUNTS), ['u-mama'], 'from "Just for me": you, so one more tick hides her from Papa as well');
  eq(startingTicks({ scope: 'family' }, me, ACCOUNTS), ACCOUNTS, 'from "Everyone": every account, so unticking the children is the change');
  eq(startingTicks({ scope: 'some', forUids: ['u-papa', 'u-papa'] }, me, ACCOUNTS), ['u-papa'], 'from "Choose who": the entry\'s accounts');
  eq(startingTicks({ scope: 'me' }, null, ACCOUNTS), [], 'no account → nobody');
}

// --- who can be ticked, and how they are named -------------------------------
{
  const linkedPapa = { ...papa, linkedUid: 'u-papa' } as FamilyMember;
  const mamaByEmail = { ...mama, email: 'mama@example.com' } as FamilyMember;
  const roles: Record<string, FamilyMemberRole> = {
    'u-papa': { role: 'admin', email: 'p@example.com', displayName: 'P. Example' },
    'u-mama': { role: 'admin', email: 'Mama@Example.com ', displayName: 'M' },
    'u-ben': { role: 'child', email: 'ben@example.com', displayName: 'Ben' },
    'u-odd': { role: 'owner' as FamilyRole, email: 'x@example.com', displayName: 'Odd' },
  };
  const accounts = hideAccounts(roles, [linkedPapa, mamaByEmail, nora], 'u-mama');
  eq(accounts.map((a) => [a.uid, a.label, a.isMe]), [
    ['u-mama', 'Mama', true],
    ['u-ben', 'Ben', false],
    ['u-papa', 'Papa', false],
  ], 'your own account first; a linked member\'s name, then an email match, then the sign-up name; unknown roles dropped');
  eq(accounts.find((a) => a.uid === 'u-papa')?.role, 'admin', 'other admins can be ticked too');

  eq(hiddenFromWords(['u-papa'], accounts, 'u-mama'), 'Hidden from Papa', 'one name');
  eq(hiddenFromWords(['u-papa', 'u-ben'], accounts, 'u-mama'), 'Hidden from Papa and Ben', 'two names');
  eq(hiddenFromWords(['u-mama'], accounts, 'u-mama'), 'Hidden from you', 'the reader is "you"');
  eq(hiddenFromWords(['u-mama', 'u-papa'], accounts, 'u-mama'), 'Hidden from you and Papa', 'you first');
  eq(hiddenFromWords(['u-mama', 'u-papa', 'u-ben'], accounts, 'u-mama'), 'Hidden from you and 2 others', 'beyond two, a count');
  eq(hiddenFromWords(['u-papa', 'u-ben', 'u-gone'], accounts, 'u-mama'), 'Hidden from 3 people', 'a count, not names');
  eq(hiddenFromWords(['u-gone'], accounts, 'u-mama'), 'Hidden from 1 person', 'an account not in the list is still counted');
}

// --- calendar occasions map back to a person --------------------------------
{
  eq(occasionPersonKey({ kind: 'birthday', sourceId: 'm1' }), 'member:m1', 'birthday → member');
  eq(occasionPersonKey({ kind: 'nameDay', sourceId: 'm1' }), 'member:m1', 'name day → member');
  eq(occasionPersonKey({ kind: 'extendedBirthday', sourceId: 'eb1' }), 'extended:eb1', 'extended birthday');
  eq(occasionPersonKey({ kind: 'petBirthday', sourceId: 'p1' }), 'pet:p1', 'pet');
  eq(occasionPersonKey({ kind: 'anniversary', sourceId: 'a1' }), null, 'an anniversary is not one person');
}

// --- ambiguous names need an attribution ------------------------------------
{
  const hp = buildHiddenPeople([[person(hiddenKey.extended('eb-may'), 'May')]]);
  ok(eventIsHiddenDate({ title: "May's birthday" }, hp), "May's birthday is hers");
  ok(!eventIsHiddenDate({ title: 'Birthday party in May' }, hp), 'a month is not May');
}

// --- the assistant: marked, never removed -----------------------------------
{
  const ctx = {
    familyName: 'Test',
    members: [{ id: 'm-mama', name: 'Mama' }, { id: 'm-nora', name: 'Nora' }],
    calendar: [{ title: "Nora's birthday" }, { title: 'Dinner with Nora' }, { title: 'Dentist' }],
    anniversaries: [{ title: 'Wedding', memberIds: ['m-papa', 'm-nora'] }, { title: 'Met', memberIds: ['m-mama', 'm-papa'] }],
    extendedBirthdays: [{ id: 'eb-klara', name: 'Aunt Klara' }, { id: 'eb-oma', name: 'Oma' }],
  };
  ok(markHiddenDatesForChat(ctx, NO_HIDDEN_PEOPLE) === ctx, 'nobody hidden → the same context back');
  const hp = buildHiddenPeople([[person(hiddenKey.member('m-nora'), 'Nora'), person(hiddenKey.extended('eb-klara'), 'Aunt Klara')]]);
  const out = markHiddenDatesForChat(ctx, hp);
  const flags = (l: object[] | undefined) => (l || []).map((x) => (x as { datesHidden?: boolean }).datesHidden === true);
  eq(flags(out.members), [false, true], 'the hidden member is marked, not removed');
  eq(flags(out.calendar), [true, false, false], 'her typed birthday is marked; "Dinner with Nora" is not');
  eq(flags(out.anniversaries), [true, false], 'an anniversary involving her is marked');
  eq(flags(out.extendedBirthdays), [true, false], 'the hidden extended birthday is marked');
  eq(out.members?.length, 2, 'nothing is removed, so a direct question can still be answered');
  eq(out.familyName, 'Test', 'the rest of the context is untouched');
  ok(!('datesHidden' in ctx.members[1]), 'the input is not mutated');
}

console.log(`hiddenPeople.test.ts: ${n} assertions passed`);
