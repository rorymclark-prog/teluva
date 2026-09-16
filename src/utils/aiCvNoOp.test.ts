// Tests for aiNoOp's `cv` case — dropping (or trimming) CV edits that would
// change nothing once merged against a member's existing CV.
//
// aiApply's cv branch (utils/aiApply.ts) MERGES rather than overwrites:
// roles dedupe on title+employer, education on institution+qualification,
// qualifications on name+issuer — all case-insensitively — and skills/
// languages dedupe additively, also case-insensitively. pruneUnchangedEdits
// must predict that merge exactly: strip the rows that are already on file
// and keep only what's genuinely new, dropping the whole edit only when
// NOTHING survives.

// Fixture data only — invented names/employers, never anyone's real CV.
import { pruneUnchangedEdits, NoOpLookups } from './aiNoOp';

let passed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) passed++;
  else fails.push(name);
}

const member: Record<string, any> = {
  id: 'm1',
  name: 'Katharina Fixture',
  cv: {
    summary: 'Operations lead with a decade in logistics.',
    roles: [{ id: 'r1', title: 'Ops Manager', employer: 'Acme Freight' }],
    education: [{ id: 'ed1', institution: 'Vienna Poly', qualification: 'BSc Logistics' }],
    qualifications: [{ id: 'q1', name: 'First Aid Certificate', issuer: 'Red Cross' }],
    skills: ['Python', 'Forklift'],
    languages: ['German'],
  },
};

// pruneUnchangedEdits never calls applyMemberField/resolveUpdate for a cv
// edit, so these two are stubbed to fail loudly if that ever changes.
const lookups: NoOpLookups = {
  resolveMember: (name) => (name === 'Katharina Fixture' ? member : (name === 'Nobody' ? null : null)),
  applyMemberField: () => { throw new Error('cv edits must not touch applyMemberField'); },
  resolveUpdate: () => { throw new Error('cv edits must not touch resolveUpdate'); },
};

const prune = (edits: any[]) => pruneUnchangedEdits(edits, lookups);

// --- Fully duplicate: everything already on file, whole edit disappears ----
{
  const edit = {
    kind: 'cv',
    member: 'Katharina Fixture',
    roles: [{ title: 'Ops Manager', employer: 'Acme Freight' }],
    education: [{ institution: 'Vienna Poly', qualification: 'BSc Logistics' }],
    qualifications: [{ name: 'First Aid Certificate', issuer: 'Red Cross' }],
    skills: ['Python'],
    languages: ['German'],
  };
  const r = prune([edit]);
  check('a fully-duplicate cv edit is pruned away entirely', r.edits.length === 0 && r.skipped.length === 1);
  check('the drop names the member and says everything is already there', /Katharina Fixture.*CV.*already/.test(r.skipped[0].reason));
}

// --- Partly new: only the new rows survive, duplicates are stripped -------
{
  const edit = {
    kind: 'cv',
    member: 'Katharina Fixture',
    roles: [
      { title: 'Ops Manager', employer: 'Acme Freight' }, // already on file
      { title: 'Warehouse Lead', employer: 'Acme Freight' }, // new
    ],
    education: [{ institution: 'Vienna Poly', qualification: 'BSc Logistics' }], // already on file
    qualifications: [
      { name: 'First Aid Certificate', issuer: 'Red Cross' }, // already on file
      { name: 'Forklift Licence', issuer: 'TÜV' }, // new
    ],
  };
  const r = prune([edit]);
  check('a partly-new cv edit is kept (not dropped)', r.edits.length === 1);
  const kept = r.edits[0] as any;
  check('only the new role survives', kept.roles.length === 1 && kept.roles[0].title === 'Warehouse Lead');
  check('the duplicate education entry is stripped to nothing', kept.education.length === 0);
  check('only the new qualification survives', kept.qualifications.length === 1 && kept.qualifications[0].name === 'Forklift Licence');
}

// --- Genuinely new: nothing overlaps, edit passes through untouched -------
{
  const edit = {
    kind: 'cv',
    member: 'Katharina Fixture',
    roles: [{ title: 'Regional Director', employer: 'Globex' }],
    education: [{ institution: 'LSE', qualification: 'MSc Supply Chain' }],
    qualifications: [{ name: 'Six Sigma Black Belt', issuer: 'ASQ' }],
    skills: ['Negotiation'],
    languages: ['French'],
  };
  const r = prune([edit]);
  check('a genuinely new cv edit is kept in full', r.edits.length === 1);
  const kept = r.edits[0] as any;
  check('the new role is untouched', kept.roles.length === 1 && kept.roles[0].employer === 'Globex');
  check('the new education entry is untouched', kept.education.length === 1 && kept.education[0].institution === 'LSE');
  check('the new qualification is untouched', kept.qualifications.length === 1 && kept.qualifications[0].issuer === 'ASQ');
  check('the new skill is untouched', kept.skills.length === 1 && kept.skills[0] === 'Negotiation');
  check('the new language is untouched', kept.languages.length === 1 && kept.languages[0] === 'French');
}

// --- Skills/languages dedupe is case-insensitive ---------------------------
{
  const edit = {
    kind: 'cv',
    member: 'Katharina Fixture',
    skills: ['python', 'FORKLIFT', 'SQL'], // first two already on file, differently cased
    languages: ['german', 'Spanish'], // first already on file, differently cased
  };
  const r = prune([edit]);
  check('a case-different-only skills/languages edit is kept (SQL/Spanish are new)', r.edits.length === 1);
  const kept = r.edits[0] as any;
  check('re-cased existing skills are stripped, only SQL survives', kept.skills.length === 1 && kept.skills[0] === 'SQL');
  check('re-cased existing language is stripped, only Spanish survives', kept.languages.length === 1 && kept.languages[0] === 'Spanish');
}
{
  // Every skill/language is just a re-casing of something already on file —
  // and nothing else in the edit is new — so the whole edit is dropped.
  const edit = { kind: 'cv', member: 'Katharina Fixture', skills: ['PYTHON'], languages: ['german'] };
  const r = prune([edit]);
  check('an all-re-cased skills/languages edit is dropped entirely', r.edits.length === 0 && r.skipped.length === 1);
}
{
  // Duplicates WITHIN the incoming list itself must collapse to one, exactly
  // like aiApply's mergeTags accumulates into `out` as it goes.
  const edit = { kind: 'cv', member: 'Katharina Fixture', skills: ['Excel', 'excel', 'EXCEL'] };
  const r = prune([edit]);
  check('duplicates within the same incoming list collapse to one', r.edits.length === 1 && (r.edits[0] as any).skills.length === 1);
}

// --- Summary is a plain overwrite, not additive — must not be ignored -----
{
  // Same summary text (even re-cased differently is a real change; here it's
  // byte-identical) and nothing else new — dropped.
  const edit = { kind: 'cv', member: 'Katharina Fixture', summary: 'Operations lead with a decade in logistics.' };
  const r = prune([edit]);
  check('re-stating the identical summary with nothing else new is dropped', r.edits.length === 0);
}
{
  // A genuinely different summary, even with every list field empty, must
  // survive — this is the "never drop a real change" direction.
  const edit = { kind: 'cv', member: 'Katharina Fixture', summary: 'Now also leads procurement.' };
  const r = prune([edit]);
  check('a genuinely changed summary alone is kept', r.edits.length === 1 && (r.edits[0] as any).summary === 'Now also leads procurement.');
}

// --- Fail-towards-showing: an unresolvable member keeps the edit as-is ----
{
  const edit = { kind: 'cv', member: 'Nobody', roles: [{ title: 'Ops Manager', employer: 'Acme Freight' }] };
  const r = prune([edit]);
  check('an unresolvable member keeps the cv edit untouched', r.edits.length === 1 && (r.edits[0] as any).roles.length === 1);
}

// --- A member with no CV on file yet: everything is new -------------------
{
  const blank: Record<string, any> = { id: 'm2', name: 'Fresh Fixture' };
  const r = pruneUnchangedEdits(
    [{ kind: 'cv', member: 'Fresh Fixture', roles: [{ title: 'Analyst', employer: 'Initech' }], skills: ['Excel'] }],
    { ...lookups, resolveMember: () => blank },
  );
  check('a first-ever CV edit is kept in full', r.edits.length === 1 && (r.edits[0] as any).roles.length === 1 && (r.edits[0] as any).skills.length === 1);
}

if (fails.length) {
  console.error(`aiCvNoOp: ${fails.length} FAILED of ${passed + fails.length}`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`aiCvNoOp: ${passed} assertions passed`);
