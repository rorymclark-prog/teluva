import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SHAREABLE_MEMBER_FIELDS,
  NEVER_SHARE_MEMBER_FIELDS,
  MEMBER_FIELD_CLASSIFICATION,
  projectSharedMember,
  linkOtherSide,
  isLinkParty,
  checkAcceptLink,
  sanitizeSharedIds,
  SHARE_CATEGORIES,
  DEFAULT_CATEGORY_IDS,
  resolveSharedIds,
  shareModeFor,
  excludedIdsFor,
  projectDesignation,
  successorLevelOf,
  ESTATE_FIELD_CLASSIFICATION,
  PREFERENCE_FIELD_CLASSIFICATION,
  projectPreferences,
  ALWAYS_SHARED_FIELDS,
  sanitizeShareFields,
  categoriesFor,
  sharedIdsFor,
} from './familyLink.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = fs.readFileSync(path.join(root, 'src/types.ts'), 'utf8');

function interfaceFields(name) {
  const m = types.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `interface ${name} not found in src/types.ts`);
  return [...m[1].matchAll(/^ {2}([a-zA-Z_][A-Za-z0-9_]*)\??\s*:/gm)].map((x) => x[1]);
}

// ── The guard that makes this feature safe a year from now ──────────────────
// A field added to FamilyMember and never classified would otherwise be
// silently excluded (fine) — or, the day somebody "simplifies" the projection
// into a blocklist, silently INCLUDED. Forcing every field to be named keeps
// the decision visible in review.
test('every FamilyMember field is classified as shareable or never-shared', () => {
  const fields = interfaceFields('FamilyMember');
  assert.ok(fields.length > 40, 'parser found suspiciously few FamilyMember fields');
  const classified = new Set([...SHAREABLE_MEMBER_FIELDS, ...NEVER_SHARE_MEMBER_FIELDS]);
  const unclassified = fields.filter((f) => !classified.has(f));
  assert.deepEqual(
    unclassified, [],
    `New FamilyMember field(s) with no sharing decision: ${unclassified.join(', ')}. `
    + 'Add each one to SHAREABLE_MEMBER_FIELDS or NEVER_SHARE_MEMBER_FIELDS in server/familyLink.mjs.',
  );
});

test('the classification lists name no field that FamilyMember does not have', () => {
  const fields = new Set(interfaceFields('FamilyMember'));
  const stale = [...SHAREABLE_MEMBER_FIELDS, ...NEVER_SHARE_MEMBER_FIELDS].filter((f) => !fields.has(f));
  assert.deepEqual(stale, [], `Classified field(s) no longer on FamilyMember: ${stale.join(', ')}`);
});

test('the two lists never overlap', () => {
  const overlap = SHAREABLE_MEMBER_FIELDS.filter((f) => NEVER_SHARE_MEMBER_FIELDS.includes(f));
  assert.deepEqual(overlap, []);
});

test('every ClothingSizes and FavoriteItem field is classified too', () => {
  for (const [iface, group] of [['ClothingSizes', 'sizes'], ['FavoriteItem', 'favorites']]) {
    const fields = interfaceFields(iface);
    const classified = new Set([
      ...MEMBER_FIELD_CLASSIFICATION[group].share,
      ...MEMBER_FIELD_CLASSIFICATION[group].never,
    ]);
    const missing = fields.filter((f) => !classified.has(f));
    assert.deepEqual(missing, [], `Unclassified ${iface} field(s): ${missing.join(', ')}`);
  }
});

// ── The projection itself ───────────────────────────────────────────────────
const fullMember = {
  id: 'm1',
  name: 'Nephew',
  nickname: 'Nef',
  role: 'child',
  birthdate: '2016-04-02',
  gender: 'male',
  avatarColor: 'bg-blue-500',
  avatarUrl: 'data:image/png;base64,AAA',
  avatarStyle: 'watercolour',
  clothingSizes: { tops: '128', shoes: '31', weightKg: '26', underwear: 'M', notes: 'private' },
  favorites: [{ id: 'f1', title: 'Lego set', category: 'Toy', imageUrl: 'x', isWishlist: true, notes: 'granny already bought one' }],
  // none of the following may ever cross a family link
  phone: '+43 1 234',
  email: 'nephew@example.com',
  address: 'Somewhere 1',
  taxNumber: '99',
  medical: { bloodType: 'O+' },
  passport: { number: 'X1' },
  passports: [{ number: 'X1' }],
  identifiers: { idNumber: '123' },
  identity: { permit: 'A' },
  documents: [{ id: 'd1', name: 'Birth certificate' }],
  financialAccounts: [{ id: 'a1' }],
  digitalAccounts: [{ id: 'g1' }],
  growthHistory: [{ date: '2020-01-01' }],
  referrals: [{ id: 'r1' }],
  careSchedule: [{ id: 'c1' }],
  education: { school: 'Volksschule' },
  travel: { frequentFlyer: 'X' },
  emergencyContactName: 'Mum',
  emergencyContactPhone: '+43 9',
  birthHospital: 'AKH',
  birthLatitude: 48.2,
  birthLongitude: 16.3,
  nonResidentGuardians: [{ id: 'g' }],
  sayings: [{ id: 's1', text: 'something private' }],
  birthdayPhotos: [{ year: 2020 }],
  linkedUid: 'uid-123',
};

test('projection keeps the shareable fields', () => {
  const p = projectSharedMember(fullMember);
  assert.equal(p.name, 'Nephew');
  assert.equal(p.birthdate, '2016-04-02');
  assert.equal(p.avatarUrl, 'data:image/png;base64,AAA');
  assert.equal(p.clothingSizes.tops, '128');
  assert.equal(p.favorites[0].title, 'Lego set');
});

test('projection drops EVERY never-shared field', () => {
  const p = projectSharedMember(fullMember);
  for (const f of NEVER_SHARE_MEMBER_FIELDS) {
    assert.equal(p[f], undefined, `projection leaked ${f}`);
  }
  // and the serialised form carries none of the sensitive values either
  const json = JSON.stringify(p);
  for (const needle of ['nephew@example.com', 'Somewhere 1', 'O+', 'X1', 'AKH', 'uid-123', 'Birth certificate']) {
    assert.ok(!json.includes(needle), `projection leaked the value ${needle}`);
  }
});

test('nested objects are projected too, not passed through whole', () => {
  const p = projectSharedMember(fullMember);
  assert.equal(p.clothingSizes.weightKg, undefined);
  assert.equal(p.clothingSizes.underwear, undefined);
  assert.equal(p.clothingSizes.notes, undefined);
  assert.equal(p.favorites[0].notes, undefined);
  assert.ok(!JSON.stringify(p).includes('granny already bought one'));
});

test('projection refuses junk instead of returning it', () => {
  assert.equal(projectSharedMember(null), null);
  assert.equal(projectSharedMember('x'), null);
  assert.equal(projectSharedMember({ name: 'no id' }), null);
});

// ── Link plumbing ───────────────────────────────────────────────────────────
const link = { id: 'l1', aId: 'fam-a', bId: 'fam-b', aName: 'The Clarks', bName: 'The Naidoos', status: 'active' };

test('the other side is resolved from whichever slot the caller is in', () => {
  assert.deepEqual(linkOtherSide(link, 'fam-a'), { id: 'fam-b', name: 'The Naidoos' });
  assert.deepEqual(linkOtherSide(link, 'fam-b'), { id: 'fam-a', name: 'The Clarks' });
  assert.equal(linkOtherSide(link, 'fam-c'), null, 'a third family must not resolve a side');
  assert.equal(isLinkParty(link, 'fam-c'), false);
});

test('accepting: only an admin, only once, never your own code, never expired', () => {
  const pending = { aId: 'fam-a', aName: 'The Clarks', status: 'pending', expiresAt: '2999-01-01T00:00:00.000Z' };
  assert.equal(checkAcceptLink({ link: pending, callerFamilyId: 'fam-b', callerRole: 'admin' }).ok, true);
  assert.equal(checkAcceptLink({ link: pending, callerFamilyId: 'fam-b', callerRole: 'member' }).status, 403);
  assert.equal(checkAcceptLink({ link: pending, callerFamilyId: 'fam-b', callerRole: 'child' }).status, 403);
  assert.equal(checkAcceptLink({ link: pending, callerFamilyId: 'fam-a', callerRole: 'admin' }).status, 400);
  assert.equal(checkAcceptLink({ link: null, callerFamilyId: 'fam-b', callerRole: 'admin' }).status, 404);
  assert.equal(checkAcceptLink({ link: { ...pending, status: 'active' }, callerFamilyId: 'fam-b', callerRole: 'admin' }).status, 410);
  assert.equal(checkAcceptLink({ link: { ...pending, status: 'revoked' }, callerFamilyId: 'fam-b', callerRole: 'admin' }).status, 410);
  assert.equal(
    checkAcceptLink({ link: { ...pending, expiresAt: '2020-01-01T00:00:00.000Z' }, callerFamilyId: 'fam-b', callerRole: 'admin' }).status,
    410,
  );
});

test('shared ids are filtered against the space that owns them', () => {
  assert.deepEqual(sanitizeSharedIds(['a', 'b', 'a', 'zz', 5, ''], ['a', 'b', 'c']), ['a', 'b']);
  assert.deepEqual(sanitizeSharedIds('a', ['a']), []);
  assert.equal(sanitizeSharedIds(Array.from({ length: 100 }, (_, i) => `m${i}`), Array.from({ length: 100 }, (_, i) => `m${i}`)).length, 40);
});

test('sharedIdsFor reads only the caller-side key', () => {
  const l = { share: { 'fam-a': ['m1'], 'fam-b': ['m9'] } };
  assert.deepEqual(sharedIdsFor(l, 'fam-a'), ['m1']);
  assert.deepEqual(sharedIdsFor(l, 'fam-c'), []);
  assert.deepEqual(sharedIdsFor({}, 'fam-a'), []);
});

// --- v311: what crosses, per person -----------------------------------------
// The allowlist is the ceiling; these categories are the dial inside it. The
// dangerous direction is a category that turns OFF but does not actually stop
// the field, so every assertion here checks the projection, not the map.

const FULL = {
  id: 'm1', name: 'Rat1', nickname: 'Rat', role: 'Parent', gender: 'male',
  birthdate: '2007-03-27', avatarColor: 'bg-clay-500', avatarUrl: 'https://x/p.jpg',
  avatarStyle: 'painted',
  clothingSizes: { tops: 'M', shoes: '42', weightKg: 71 },
  favorites: [{ id: 'f1', title: 'Bike', isWishlist: true, notes: 'secret' }],
  // The care card, plus the parts of MedicalRecord that must never ride along
  // with it. Invented values — no real person's details go in a fixture.
  medical: {
    bloodGroup: 'A+', allergies: 'peanuts', emergencyMedication: 'EpiPen in the blue bag',
    medications: 'inhaler, mornings', conditions: 'asthma',
    vaccinations: [{ id: 'v1', name: 'MMR' }], surgeries: 'grommets 2019',
    organDonor: true, familyHistory: 'nothing noted', preferredPharmacy: 'Apotheke Beispiel',
    notes: 'anything at all could be written here',
  },
  emergencyContactName: 'Aunt Example', emergencyContactPhone: '+43 000 0000000',
};

test('every category actually withholds its own fields', () => {
  for (const cat of SHARE_CATEGORIES) {
    const without = SHARE_CATEGORIES.map((c) => c.id).filter((c) => c !== cat.id);
    const out = projectSharedMember(FULL, without);
    for (const field of cat.fields) {
      assert.equal(out[field], undefined, `${cat.id} off must withhold ${field}`);
    }
  }
});

test('identity always crosses, whatever is switched off', () => {
  const bare = projectSharedMember(FULL, []);
  // A row with no name is not a person, it is a puzzle.
  assert.equal(bare.name, 'Rat1');
  assert.equal(bare.id, 'm1');
  for (const f of ALWAYS_SHARED_FIELDS) {
    if (FULL[f] !== undefined) assert.equal(bare[f], FULL[f], `${f} is identity and must cross`);
  }
  assert.equal(bare.birthdate, undefined);
  assert.equal(bare.avatarUrl, undefined);
  assert.equal(bare.clothingSizes, undefined);
  assert.equal(bare.favorites, undefined);
});

test('a category cannot widen the allowlist', () => {
  // Sizes ON still drops weightKg; wishes ON still drops the note. The
  // sub-allowlists are the floor under the dial, not an alternative to it.
  const out = projectSharedMember(FULL, ['sizes', 'wishes']);
  assert.equal(out.clothingSizes.weightKg, undefined);
  assert.equal(out.clothingSizes.tops, 'M');
  assert.equal(out.favorites[0].notes, undefined);
  assert.equal(out.favorites[0].title, 'Bike');
});

test('an omitted category list means the DEFAULTS — old links do not change', () => {
  const before = projectSharedMember(FULL);
  const dflt = projectSharedMember(FULL, DEFAULT_CATEGORY_IDS);
  assert.deepEqual(before, dflt);
  assert.equal(before.birthdate, '2007-03-27');
  // And a link document written before this feature existed reads as the
  // defaults — the four categories that existed when it was written.
  assert.deepEqual(categoriesFor({ share: { f: ['m1'] } }, 'f', 'm1'), DEFAULT_CATEGORY_IDS);
});

test('an OPT-IN category is unreachable by default, however you ask', () => {
  // The whole point of the opt-in flag. Every path that could produce a
  // category list without somebody choosing one must exclude `care`, or
  // deploying it would disclose a child's allergies to every household
  // already connected, with nobody having decided anything.
  const optIn = SHARE_CATEGORIES.filter((c) => c.optIn).map((c) => c.id);
  assert.ok(optIn.includes('care'), 'care is the opt-in category this guards');
  for (const id of optIn) {
    assert.ok(!DEFAULT_CATEGORY_IDS.includes(id), `${id} must not be a default`);
    assert.deepEqual(categoriesFor({}, 'f', 'm1').includes(id), false, `${id} absent-entry`);
    assert.deepEqual(categoriesFor(null, 'f', 'm1').includes(id), false, `${id} no link`);
  }
  // …and the projection itself, called the old way, hands over none of it.
  const before = projectSharedMember(FULL);
  assert.equal(before.medical, undefined, 'no medical without an explicit choice');
  assert.equal(before.emergencyContactName, undefined);
  assert.equal(before.emergencyContactPhone, undefined);
});

test('the care card is the fridge note, not the medical file', () => {
  const out = projectSharedMember(FULL, ['care']);
  assert.equal(out.medical.allergies, FULL.medical.allergies);
  assert.equal(out.emergencyContactPhone, FULL.emergencyContactPhone);
  // Everything on MedicalRecord a sitter cannot act on stays home.
  for (const f of MEMBER_FIELD_CLASSIFICATION.medical.never) {
    assert.equal(out.medical[f], undefined, `care must not carry medical.${f}`);
  }
});

test('gender does not cross at all', () => {
  // It used to ride along with the name under "identity always crosses", and
  // nothing on the other side ever used it. Removed, not toggled.
  for (const cats of [undefined, [], DEFAULT_CATEGORY_IDS, SHARE_CATEGORIES.map((c) => c.id)]) {
    assert.equal(projectSharedMember(FULL, cats).gender, undefined);
  }
  assert.ok(!ALWAYS_SHARED_FIELDS.includes('gender'));
});

test('category rules are only kept for people who are actually shared', () => {
  const clean = sanitizeShareFields({ m1: ['sizes'], ghost: ['photo'] }, ['m1']);
  assert.deepEqual(clean, { m1: ['sizes'] });
  // The DEFAULT set is what an absent entry already means, so it is not
  // stored — otherwise it would have to be kept in step with any category
  // added later.
  assert.deepEqual(sanitizeShareFields({ m1: DEFAULT_CATEGORY_IDS }, ['m1']), {});
  // But a set that turns an opt-in category ON is an exception and MUST be
  // written down. Treating "all of them" as the default would silently
  // discard the one choice this whole category exists to record.
  const all = SHARE_CATEGORIES.map((c) => c.id);
  assert.deepEqual(sanitizeShareFields({ m1: all }, ['m1']), { m1: all });
  // Junk never becomes a rule.
  assert.deepEqual(sanitizeShareFields({ m1: ['sizes', 'everything'] }, ['m1']), { m1: ['sizes'] });
  assert.deepEqual(sanitizeShareFields(['m1'], ['m1']), {});
  assert.deepEqual(sanitizeShareFields(null, ['m1']), {});
});

test('one side cannot read the other side\'s categories', () => {
  const link = { shareFields: { 'fam-a': { m1: ['sizes'] }, 'fam-b': { m9: [] } } };
  assert.deepEqual(categoriesFor(link, 'fam-a', 'm1'), ['sizes']);
  assert.deepEqual(categoriesFor(link, 'fam-b', 'm9'), []);
  // Asking with the wrong family id falls back to the default rather than
  // borrowing the other household's answer.
  assert.deepEqual(categoriesFor(link, 'fam-c', 'm1'), DEFAULT_CATEGORY_IDS);
});


/* ── KEEPING UP WITH A FAMILY THAT GROWS ──────────────────────────────────
 * Rory: "all these new members and none show up on the other family". */
test("an old link stays 'chosen' — a mode default never widens what already exists", () => {
  // Every link written before modes existed has no shareMode key at all. If
  // an absent value read as 'everyone', deploying this would share every
  // member of every space with every connected household at once.
  const old = { share: { f: ['m1'] } };
  assert.equal(shareModeFor(old, 'f'), 'chosen');
  assert.equal(shareModeFor(null, 'f'), 'chosen');
  assert.equal(shareModeFor({ shareMode: { f: 'nonsense' } }, 'f'), 'chosen');
  assert.deepEqual(resolveSharedIds(old, 'f', ['m1', 'm2', 'm3']), ['m1']);
});

test("'everyone' means everyone now, minus the deliberately excluded", () => {
  const link = { share: { f: ['m1'] }, shareMode: { f: 'everyone' }, shareExclude: { f: ['m3'] } };
  assert.deepEqual(resolveSharedIds(link, 'f', ['m1', 'm2', 'm3', 'm4']), ['m1', 'm2', 'm4']);
  assert.deepEqual(excludedIdsFor(link, 'f'), ['m3']);
  // A member added a second ago is in the index, so they cross with no save.
  assert.ok(resolveSharedIds(link, 'f', ['m1', 'm2', 'm3', 'm4', 'm9']).includes('m9'));
});

test('a missing member index falls back to the stored list, never to nobody', () => {
  // memberIndexIds returns null on a read failure. Treating that as "this
  // family has no members" would silently un-share everybody until the next
  // successful read — an outage that looks exactly like a revoked link.
  const link = { share: { f: ['m1', 'm2'] }, shareMode: { f: 'everyone' } };
  assert.deepEqual(resolveSharedIds(link, 'f', null), ['m1', 'm2']);
  assert.deepEqual(resolveSharedIds(link, 'f', undefined), ['m1', 'm2']);
});

test('one side cannot read or set the other side\'s mode', () => {
  const link = { shareMode: { 'fam-a': 'everyone' }, shareExclude: { 'fam-a': ['x'] } };
  assert.equal(shareModeFor(link, 'fam-b'), 'chosen');
  assert.deepEqual(excludedIdsFor(link, 'fam-b'), []);
});

test("'everyone' obeys the same 40-person cap as picking by hand", () => {
  const many = Array.from({ length: 60 }, (_, i) => `m${i}`);
  const link = { shareMode: { f: 'everyone' } };
  assert.equal(resolveSharedIds(link, 'f', many).length, 40);
  assert.equal(sanitizeSharedIds(many, many).length, 40);
});


/* ── THE SUCCESSOR LADDER ─────────────────────────────────────────────────
 * Rory: "sort out the will thing … toggle it on and off etc send a
 * notification … make it easy for families that are all on the app". */
const ESTATE = [{
  id: 'r1', kind: 'Will', forMember: 'Rat1',
  originalLocation: 'the safe behind the painting',
  heldBy: 'Notar Beispiel', notaryName: 'Notar Beispiel', notaryPhone: '+43 000 0000000',
  executor: 'Aunt Example', lastReviewed: '2025-06-01',
  linkedDocIds: ['d1'], linkedPolicyIds: ['p1'], notes: 'anything at all',
}];
const SUCC = { name: 'Rat1', sharedMemberId: 'm1', fromLinkId: 'L1', whatTheyShouldDo: 'Ring the bank.' };

test('an absent level is the fact only — an existing designation never widens', () => {
  // The same rule as the share-category defaults, for the same reason: a rung
  // added later must not change a decision somebody already made.
  assert.equal(successorLevelOf(SUCC), 'fact');
  assert.equal(successorLevelOf({ shareLevel: 'nonsense' }), 'fact');
  assert.equal(successorLevelOf(null), 'fact');
  const out = projectDesignation(SUCC, ['m1'], 'the rats', ESTATE);
  /* v326 DELIBERATELY WIDENED THIS RUNG, and it is the only widening this file
     has ever accepted. 'fact' now also answers "who holds the signed original",
     because a named successor who cannot find the will is the failure the whole
     feature exists to prevent. Everything else about the rung is unchanged, and
     this assertion is the list that stops the next widening being silent. */
  assert.deepEqual(Object.keys(out).filter((k) => out[k] !== undefined).sort(),
    ['byName', 'findWill', 'level', 'memberId']);
  assert.equal(out.whatTheyShouldDo, undefined, 'the instructions are still a rung up');
  assert.equal(out.documents, undefined, 'the paper list is still two rungs up');
});

test('a designation must point at somebody they can already see', () => {
  // Otherwise the id alone confirms the existence of a member who is not
  // shared. Predates the ladder; must survive it.
  assert.equal(projectDesignation(SUCC, ['m9'], 'x', ESTATE), null);
  assert.equal(projectDesignation(SUCC, [], 'x', ESTATE), null);
  assert.equal(projectDesignation(SUCC, null, 'x', ESTATE), null);
  assert.equal(projectDesignation({ ...SUCC, sharedMemberId: '' }, ['m1'], 'x', ESTATE), null);
  assert.equal(projectDesignation(null, ['m1'], 'x', ESTATE), null);
});

test("'instructions' carries the note and nothing else", () => {
  const out = projectDesignation({ ...SUCC, shareLevel: 'instructions' }, ['m1'], 'the rats', ESTATE);
  assert.equal(out.whatTheyShouldDo, 'Ring the bank.');
  assert.equal(out.documents, undefined, 'the papers are the NEXT rung');
});

test("'documents' says WHICH papers exist, and never opens one", () => {
  const out = projectDesignation({ ...SUCC, shareLevel: 'documents' }, ['m1'], 'the rats', ESTATE);
  assert.deepEqual(out.documents, [{ kind: 'Will', lastReviewed: '2025-06-01' }]);
  // Every never-share estate field, checked by name rather than by eye.
  const json = JSON.stringify(out);
  for (const f of ESTATE_FIELD_CLASSIFICATION.never) {
    assert.equal(out.documents[0][f], undefined, `documents leaked ${f}`);
  }
  /* The paper LIST still carries no custodian and no location — those ride on
     findWill, once, rather than being repeated per row. */
  for (const f of [...ESTATE_FIELD_CLASSIFICATION.findability,
                   ...ESTATE_FIELD_CLASSIFICATION.lastResort]) {
    assert.equal(out.documents[0][f], undefined, `the paper list leaked ${f}`);
  }
  for (const needle of ['+43 000 0000000', 'anything at all', 'd1', 'p1', 'Aunt Example']) {
    assert.ok(!json.includes(needle), `the designation leaked the value ${needle}`);
  }
  /* And the hiding place stays back, because this record HAS a custodian. */
  assert.ok(!json.includes('safe behind the painting'),
    'a record with a custodian must never send the hiding place too');
});

test('the files never cross at any rung, and free text is capped', () => {
  for (const lvl of [undefined, 'fact', 'instructions', 'documents']) {
    const out = projectDesignation({ ...SUCC, shareLevel: lvl }, ['m1'], 'x', ESTATE);
    const json = JSON.stringify(out);
    assert.ok(!json.includes('linkedDocIds') && !json.includes('linkedPolicyIds'));
  }
  const long = projectDesignation(
    { ...SUCC, shareLevel: 'instructions', whatTheyShouldDo: 'x'.repeat(9000) }, ['m1'], 'y', ESTATE,
  );
  assert.equal(long.whatTheyShouldDo.length, 2000, 'another household\'s free text is bounded');
  const many = projectDesignation(
    { ...SUCC, shareLevel: 'documents' }, ['m1'], 'y',
    Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, kind: 'Will' })),
  );
  assert.equal(many.documents.length, 25);
});

/* ── FINDABILITY: who holds the will, at every rung (v326) ──────────────────
 *
 * The rule being guarded: a CUSTODIAN crosses always; the HIDING PLACE crosses
 * only when there is no custodian and no registration at all. Getting this
 * backwards in either direction is a real harm — one loses the will, the other
 * posts the safe combination to another household. */

const HOME_WILL = [{ id: 'r2', kind: 'Will', originalLocation: 'top drawer of my desk' }];

test('every rung answers "who holds the signed original", including fact', () => {
  for (const lvl of [undefined, 'fact', 'instructions', 'documents']) {
    const out = projectDesignation({ ...SUCC, shareLevel: lvl }, ['m1'], 'x', ESTATE);
    assert.deepEqual(out.findWill, [{ kind: 'Will', heldBy: 'Notar Beispiel', notaryName: 'Notar Beispiel' }],
      `rung ${lvl} did not say who holds the will`);
  }
});

test('a custodian means the hiding place stays home', () => {
  const out = projectDesignation(SUCC, ['m1'], 'x', ESTATE);
  assert.equal(out.findWill[0].originalLocation, undefined);
  assert.ok(!JSON.stringify(out).includes('safe behind the painting'));
});

/* THE CASE THE WHOLE CHANGE EXISTS FOR. Kept at home, nobody named, in no
   register: the drawer is the only fact in the world that finds this will. */
test('no custodian and no registry means the location IS the answer', () => {
  const out = projectDesignation(SUCC, ['m1'], 'x', HOME_WILL);
  assert.deepEqual(out.findWill, [{ kind: 'Will', originalLocation: 'top drawer of my desk' }]);
});

test('a registration answers it without opening anything', () => {
  const reg = [{ id: 'r3', kind: 'Will', registered: 'registered', registryName: 'ÖZTR',
                 originalLocation: 'top drawer of my desk' }];
  const out = projectDesignation(SUCC, ['m1'], 'x', reg);
  assert.deepEqual(out.findWill, [{ kind: 'Will', registered: 'registered', registryName: 'ÖZTR' }]);
  assert.ok(!JSON.stringify(out).includes('top drawer'),
    'a registered will is findable through the register; the drawer is not needed');
});

test('a registry NAME without an actual registration is not a custodian', () => {
  // 'unknown'/'not-registered' must not smuggle registryName across, and must
  // not suppress the location that is then the only answer left.
  const out = projectDesignation(SUCC, ['m1'], 'x',
    [{ id: 'r4', kind: 'Will', registered: 'not-registered', registryName: 'ÖZTR',
       originalLocation: 'top drawer' }]);
  assert.deepEqual(out.findWill, [{ kind: 'Will', originalLocation: 'top drawer' }]);
});

test('nobody recorded anything, and the successor is told so while they can still ask', () => {
  const out = projectDesignation(SUCC, ['m1'], 'x', [{ id: 'r5', kind: 'Will' }]);
  assert.deepEqual(out.findWill, [{ kind: 'Will', unrecorded: true }]);
});

test('only a will is findable this way — not a power of attorney or a funeral wish', () => {
  const mixed = [
    { id: 'a', kind: 'Power of attorney', heldBy: 'Aunt Example', originalLocation: 'her flat' },
    { id: 'b', kind: 'Funeral wishes', originalLocation: 'the blue folder' },
    { id: 'c', kind: 'Last will and testament', heldBy: 'Dr Berger' },
    { id: 'd', kind: 'Codicil', heldBy: 'Dr Berger' },
  ];
  const out = projectDesignation(SUCC, ['m1'], 'x', mixed);
  assert.deepEqual(out.findWill.map((f) => f.kind), ['Last will and testament', 'Codicil']);
  const json = JSON.stringify(out);
  assert.ok(!json.includes('her flat') && !json.includes('blue folder'),
    'a non-will record must not ride the findability line');
});

test('no will at all means no findability line, not an empty one', () => {
  assert.equal(projectDesignation(SUCC, ['m1'], 'x', [{ id: 'a', kind: 'Funeral wishes' }]).findWill, undefined);
  assert.equal(projectDesignation(SUCC, ['m1'], 'x', []).findWill, undefined);
  assert.equal(projectDesignation(SUCC, ['m1'], 'x', null).findWill, undefined);
});

test('the findability line is bounded — text capped, records capped', () => {
  const out = projectDesignation(SUCC, ['m1'], 'x',
    [{ id: 'a', kind: 'Will', heldBy: 'z'.repeat(900) }]);
  assert.equal(out.findWill[0].heldBy.length, 200);
  const many = projectDesignation(SUCC, ['m1'], 'x',
    Array.from({ length: 50 }, (_, i) => ({ id: `w${i}`, kind: 'Will', heldBy: 'Dr Berger' })));
  assert.equal(many.findWill.length, 3, 'three wills is already a problem; fifty is an attack');
});

test('findability still cannot make an invisible person visible', () => {
  // Rule 1 outranks rule 3b: no designation, no findability line either.
  assert.equal(projectDesignation(SUCC, ['m9'], 'x', HOME_WILL), null);
});

test('notaryPhone never crosses, at any rung, in any shape', () => {
  for (const lvl of [undefined, 'fact', 'instructions', 'documents']) {
    const out = projectDesignation({ ...SUCC, shareLevel: lvl }, ['m1'], 'x', ESTATE);
    assert.ok(!JSON.stringify(out).includes('+43 000 0000000'), `rung ${lvl} leaked the notary's direct line`);
  }
});

test('every EstateRecord field is classified, so a new one is a decision', () => {
  const from = types.indexOf('export interface EstateRecord');
  const body = types.slice(from, types.indexOf('\n}', from));
  const declared = Array.from(body.matchAll(/^\s{2}(\w+)\??:/gm)).map((m) => m[1]);
  const known = new Set([
    ...ESTATE_FIELD_CLASSIFICATION.share,
    ...ESTATE_FIELD_CLASSIFICATION.findability,
    ...ESTATE_FIELD_CLASSIFICATION.lastResort,
    ...ESTATE_FIELD_CLASSIFICATION.never,
  ]);
  /* The four lists must stay DISJOINT. A field in both `findability` and
     `never` reads as forbidden while crossing at every rung — the exact shape
     of an accident nobody notices, because the never-list assertions still
     pass on the field they are checking somewhere else. */
  const all = [...ESTATE_FIELD_CLASSIFICATION.share, ...ESTATE_FIELD_CLASSIFICATION.findability,
               ...ESTATE_FIELD_CLASSIFICATION.lastResort, ...ESTATE_FIELD_CLASSIFICATION.never];
  const dupes = all.filter((f, i) => all.indexOf(f) !== i);
  assert.deepEqual(dupes, [], `a field is classified twice: ${dupes.join(', ')}`);
  const unclassified = declared.filter((f) => !known.has(f));
  assert.deepEqual(unclassified, [],
    `EstateRecord grew a field the designation projection was never told about: ${unclassified.join(', ')}`);
});

// ── WHAT THEY LIKE, and the one field that does not ride with it ──────────
const liker = {
  id: 'm1', name: 'Thandi',
  preferences: {
    hobbies: 'birding, bread', sports: 'netball', colorPreferences: 'deep green, never orange',
    clothingBrands: 'anything second hand', favoriteBooks: 'Bessie Head',
    favoriteMovies: '', favoriteMeals: 'chakalaka', dislikedFoods: 'olives',
    dietaryRestrictions: 'coeliac — no wheat at all',
  },
  medical: { bloodGroup: 'O+', allergies: 'bee stings', notes: 'private' },
};

test('interests carries the gift answers and NOT the dietary one', () => {
  const out = projectSharedMember(liker, ['interests']);
  assert.equal(out.preferences.hobbies, 'birding, bread');
  assert.equal(out.preferences.colorPreferences, 'deep green, never orange');
  assert.equal(out.preferences.dietaryRestrictions, undefined,
    'a restriction that can name a religion or a diagnosis must not ride in a DEFAULT category');
});

test('an empty preference string is absent, not empty — no "they told us nothing" rows', () => {
  const out = projectSharedMember(liker, ['interests']);
  assert.ok(!('favoriteMovies' in out.preferences));
});

test('the dietary restriction crosses under care, where allergies already live', () => {
  const out = projectSharedMember(liker, ['care']);
  assert.equal(out.preferences.dietaryRestrictions, 'coeliac — no wheat at all');
  assert.equal(out.preferences.hobbies, undefined, 'care is not a back door to the gift fields');
});

test('both switches on MERGES rather than one clobbering the other', () => {
  const out = projectSharedMember(liker, ['interests', 'care']);
  assert.equal(out.preferences.hobbies, 'birding, bread');
  assert.equal(out.preferences.dietaryRestrictions, 'coeliac — no wheat at all');
});

test('neither switch means no preferences object at all', () => {
  const out = projectSharedMember(liker, ['photo']);
  assert.equal(out.preferences, undefined);
});

test('free text is capped — another household renders this on their phone', () => {
  const out = projectSharedMember({ id: 'm1', name: 'X', preferences: { hobbies: 'a'.repeat(5000) } }, ['interests']);
  assert.equal(out.preferences.hobbies.length, 400);
});

test('a non-string preference is dropped, not stringified into "[object Object]"', () => {
  const out = projectPreferences({ hobbies: { evil: true }, sports: ['netball'], colorPreferences: 'green' },
    PREFERENCE_FIELD_CLASSIFICATION.share);
  assert.deepEqual(out, { colorPreferences: 'green' });
});

test('every Preferences field is classified, so a new one is a decision', () => {
  const from = types.indexOf('export interface Preferences');
  const body = types.slice(from, types.indexOf('\n}', from));
  const declared = Array.from(body.matchAll(/^\s{2}(\w+)\??:/gm)).map((m) => m[1]);
  const known = new Set([
    ...PREFERENCE_FIELD_CLASSIFICATION.share,
    ...PREFERENCE_FIELD_CLASSIFICATION.careOnly,
  ]);
  const unclassified = declared.filter((f) => !known.has(f));
  assert.deepEqual(unclassified, [],
    `Preferences grew a field nobody decided about: ${unclassified.join(', ')}. ` +
    'Add it to SHAREABLE_PREFERENCE_FIELDS, or to CARE_ONLY_PREFERENCE_FIELDS if it can name a diagnosis or a religion.');
});
