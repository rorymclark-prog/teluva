import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { meaningsFor, foldMeanings, unresearchedTokens, surnameKey, roleLabel, confidenceLabel } from './nameMeanings';
import { FamilyMember, NameMeaning, SurnameMeaning } from '../types';

// Guards the name-meanings feature. Two halves, as elsewhere in this repo:
// real behaviour for the merge logic (it has branches worth exercising), and
// source-as-text for the boundaries no unit test can reach — the server
// sanitiser and the shared-document write.

const here = path.dirname(fileURLToPath(import.meta.url));   // never .pathname — a space in the path silently no-ops
const root = path.resolve(here, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const meaning = (over: Partial<NameMeaning> = {}): NameMeaning => ({
  id: 'm1', token: 'Michael', role: 'given', meaning: 'who is like God',
  confidence: 'established', confirmed: true, ...over,
});
const surname = (over: Partial<SurnameMeaning> = {}): SurnameMeaning => ({
  id: 's1', token: 'Clark', role: 'family', key: 'clark', meaning: 'cleric or scribe',
  confidence: 'established', confirmed: true, ...over,
});
const member = (name: string, nameMeanings: NameMeaning[] = []) =>
  ({ id: 'p1', name, role: 'Child', nameMeanings } as unknown as FamilyMember);

// --- the join, which is the whole design ----------------------------------

// A surname researched once is answered for everyone carrying it. This is the
// reason the two stores exist at all, so it is the first thing asserted.
{
  const shared = [surname()];
  for (const who of ['Rory Clark', 'Ann Clark']) {
    const got = meaningsFor(member(who), shared);
    assert.ok(got.some((m) => m.token === 'Clark'), `${who} should inherit the shared surname meaning`);
  }
}

// Case and spacing must not break the join — a family name typed "clark" on
// one member and "Clark" on another is one name, not two.
{
  const got = meaningsFor(member('Sam  clark '), [surname()]);
  assert.deepStrictEqual(got.map((m) => m.token), ['Clark']);
}

// THE TRAP THIS GUARDS: a person whose FIRST name is somebody else's surname.
// If the lookup were by token alone, Clark Kent would be told his given name
// means "cleric or scribe". The member's own entry has to win.
{
  const own = meaning({ id: 'own', token: 'Clark', role: 'given', meaning: 'a given name in its own right' });
  const got = meaningsFor(member('Clark Kent', [own]), [surname()]);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].id, 'own', 'the member\'s own entry must outrank the space-level surname entry');
}

// Unconfirmed entries are not the family's record and must never be shown as
// though they were — on either side of the join.
{
  assert.deepStrictEqual(meaningsFor(member('Ann Clark', [meaning({ token: 'Ann', confirmed: false })]), []), []);
  assert.deepStrictEqual(meaningsFor(member('Ann Clark'), [surname({ confirmed: false })]), []);
}

// Repeated tokens are one row, not two ("Anna Anna", "Le Roux le Roux").
{
  const got = meaningsFor(member('Anna Anna', [meaning({ token: 'Anna' })]), []);
  assert.strictEqual(got.length, 1);
}

// Order follows the name as spoken, not the order things were researched.
{
  const own = [meaning({ id: 'b', token: 'Michael', role: 'middle' }), meaning({ id: 'a', token: 'Rory', role: 'given', meaning: 'red king' })];
  const got = meaningsFor(member('Rory Michael Clark', own), [surname()]);
  assert.deepStrictEqual(got.map((m) => m.token), ['Rory', 'Michael', 'Clark']);
}

// --- fold: which store each result lands in -------------------------------

// Role decides the destination, never position: a 'family' entry goes to the
// shared list even when it is not the last token (Hungarian order, particles).
{
  const { own, surnames } = foldMeanings([], [], [
    meaning({ token: 'Nagy', role: 'family' }),
    meaning({ token: 'István', role: 'given' }),
  ]);
  assert.deepStrictEqual(own.map((m) => m.token), ['István']);
  assert.deepStrictEqual(surnames.map((s) => s.token), ['Nagy']);
  assert.strictEqual(surnames[0].key, 'nagy', 'foldMeanings must stamp the lower-cased lookup key');
}

// Re-researching REPLACES rather than appends — otherwise a family that looks
// a name up twice ends up with two rows saying almost the same thing.
{
  const before = [surname({ id: 'old', meaning: 'stale' })];
  const { surnames } = foldMeanings([], before, [meaning({ id: 'new', token: 'clark', role: 'family', meaning: 'fresh' })]);
  assert.strictEqual(surnames.length, 1, 'a second lookup of the same name must not append');
  assert.strictEqual(surnames[0].meaning, 'fresh');
}
{
  const before = [meaning({ id: 'old', token: 'Ann', meaning: 'stale' })];
  const { own } = foldMeanings(before, [], [meaning({ id: 'new', token: 'ANN', meaning: 'fresh' })]);
  assert.strictEqual(own.length, 1);
  assert.strictEqual(own[0].meaning, 'fresh');
}

// Junk in, nothing out — an entry with no token or no meaning is not a record.
{
  const { own, surnames } = foldMeanings([], [], [meaning({ token: '  ' }), meaning({ meaning: '' })]);
  assert.deepStrictEqual([...own, ...surnames], []);
}

// Folding must not mutate the arrays it was handed: both callers keep the
// originals in React state and re-render from them.
{
  const own0: NameMeaning[] = [];
  const sur0: SurnameMeaning[] = [];
  foldMeanings(own0, sur0, [meaning(), meaning({ token: 'Clark', role: 'family' })]);
  assert.deepStrictEqual([own0.length, sur0.length], [0, 0]);
}

// --- what still needs asking ----------------------------------------------
{
  const got = unresearchedTokens(member('Rory Michael Clark', [meaning({ token: 'Rory' })]), [surname()]);
  assert.deepStrictEqual(got, ['Michael'], 'only the parts nobody has answered for');
}

// --- labels ---------------------------------------------------------------
// The confidence label is the hedge the whole feature rests on; "contested"
// must read as a real caveat rather than a shrug.
assert.strictEqual(confidenceLabel('contested'), 'Sources disagree');
assert.strictEqual(confidenceLabel('likely'), 'Most likely');
assert.strictEqual(roleLabel('family'), 'Family name');
assert.strictEqual(surnameKey('  Van Der Merwe '), 'van der merwe');

// --- boundaries, as source text -------------------------------------------

const server = read('server.js');

// confidence is REQUIRED and deliberately NOT defaulted. Defaulting it would
// let a model that skipped the field launder a contested derivation into a
// confident-looking one — the exact failure the hedge exists to prevent.
{
  const fn = server.slice(server.indexOf('function sanitizeNameMeaning'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.ok(/NAME_MEANING_CONFIDENCE\.has\(/.test(body), 'sanitizeNameMeaning must validate confidence against the allow-list');
  assert.ok(!/confidence\s*(=|\|\|)\s*['"]/.test(body), 'confidence must never be defaulted to a literal');
  assert.ok(/allowedTokens/.test(body), 'sanitizeNameMeaning must reject tokens outside the server-derived allow-list');
}

// The allow-list is split from the name SERVER-side. If the client supplied
// it, a caller could research any string it liked through this endpoint.
assert.ok(
  /const\s+\w+\s*=\s*full\.split\(/.test(server),
  'the meaning handler must derive its token allow-list from the name server-side',
);

// The model must never be free to invent an etymology. Asserted against the
// prompt's own wording, so a rewrite that drops a rule fails here rather than
// quietly shipping a research endpoint that will guess.
{
  const at = server.indexOf('NAME_MEANING_RESEARCH_SYSTEM');
  const prompt = server.slice(at, server.indexOf('`;', at));
  for (const [what, re] of [
    ['never invent a meaning', /NEVER invent a meaning/i],
    ['a missing entry is the correct answer', /missing entry is correct/i],
    ['no derivation from sound-alikes in another language', /sounds like in another language/i],
    ['no invented citations', /Never invent a citation/i],
    ['no guessing religion/nationality/ethnicity', /religion, nationality or ethnicity/i],
    ['report, do not flatter', /Report, do not compliment/i],
  ] as const) {
    assert.ok(re.test(prompt), `NAME_MEANING_RESEARCH_SYSTEM must keep the rule: ${what}`);
  }
  // The token must come back exactly as the family wrote it — a "corrected"
  // spelling answers about a different name than the one on the record.
  assert.ok(/EXACTLY as the family wrote it/i.test(prompt), 'the prompt must forbid re-spelling the name');
}

// The prompt promises the assistant can recall meanings — a promise with no
// code behind it is the dead-feature bug class this repo keeps re-learning.
// Both halves must be named, and the hedge must survive into the answer.
for (const needle of ['nameMeanings', 'surnameMeanings', 'contested']) {
  assert.ok(server.includes(needle), `the chat system prompt must mention ${needle}`);
}

// --- the shared-document write --------------------------------------------

const editor = read('src/components/EditMemberModal.tsx');

// A forgotten key in a rebuilt shared document is a DELETE (saveFamilyInfo
// three-way-merges against what this client last saw). The write must SPREAD
// what it re-loaded, never name the keys it intends to keep.
{
  const at = editor.indexOf('saveFamilyInfo(');
  assert.ok(at > 0, 'EditMemberModal must write surname meanings through saveFamilyInfo');
  const call = editor.slice(at, at + 120);
  assert.ok(/saveFamilyInfo\(\{\s*\.\.\.info,/.test(call), 'saveFamilyInfo must be handed a spread of the freshly loaded document');
  assert.ok(
    editor.lastIndexOf('await loadFamilyInfo()', at) > editor.lastIndexOf('const updated: FamilyMember', at) - 4000,
    'the document must be re-loaded immediately before it is written',
  );
}

// Only when it actually changed: a member edit that never opened the meanings
// modal must not touch a document every other member shares.
assert.ok(
  /JSON\.stringify\(surnameMeanings\)\s*!==\s*JSON\.stringify\(surnameBaseline\)/.test(editor),
  'the shared write must be gated on an actual change against the loaded baseline',
);

// A failed shared write must not be swallowed: confirmed research that is
// silently dropped is gone for good, so the save blocks and says so.
// Anchored on the catch block itself, not merely on the setter — the setter
// is also called to CLEAR the message in two other places.
{
  const at = editor.indexOf('setMeaningSaveError(err');
  assert.ok(at > 0, 'the surname write must report its failure to the user');
  assert.ok(/return;/.test(editor.slice(at, at + 200)), 'a failed surname write must block the save, not fall through');
  assert.ok(
    editor.lastIndexOf('onSave(updated)') > at,
    'the failure path must come BEFORE onSave — a save that half-succeeded is worse than one that stopped',
  );
}

// No client ever writes Firestore directly from this editor.
assert.ok(!/\bsetDoc\(|\bupdateDoc\(/.test(editor), 'EditMemberModal must not write Firestore directly');

console.log('nameMeanings.test.ts: all assertions passed');
