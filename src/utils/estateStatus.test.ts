import assert from 'assert';
import { findabilityGap, statusLabel, ESTATE_DOC_STATUSES, REGISTRY_STATUSES } from './willsEstate';

let n = 0;
const check = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); n++; };

/* The gap only fires where it is TRUE and ACTIONABLE. A warning that shows on
   every row is one nobody reads, and one that fires on a power of attorney is
   simply wrong — a PoA is not produced to a probate court. */
const bare = { kind: 'Will', status: 'signed-original' as const };
check('a signed will nobody can locate is flagged', findabilityGap(bare) !== null);
check('and the flag explains the mechanism, not a duty',
  /court will not go looking/.test(findabilityGap(bare) || '')
  && !/you should|must register|we recommend/i.test(findabilityGap(bare) || ''));

check('recording where the original is clears it', findabilityGap({ ...bare, originalLocation: 'Safe at home' }) === null);
check('naming who holds it clears it', findabilityGap({ ...bare, heldBy: 'Dr. Gruber, notary' }) === null);
check('being registered clears it', findabilityGap({ ...bare, registered: 'registered' }) === null);

check('an unsigned draft is not flagged — there is nothing to produce yet',
  findabilityGap({ kind: 'Will', status: 'draft' }) === null);
check('a power of attorney is not flagged — it is not produced to a probate court',
  findabilityGap({ kind: 'Power of attorney', status: 'signed-original' }) === null);
check('an advance directive is not flagged either',
  findabilityGap({ kind: 'Advance healthcare directive', status: 'signed-original' }) === null);
check('a codicil IS flagged — it stands or falls with the will',
  findabilityGap({ kind: 'Codicil', status: 'signed-original' }) !== null);
check('"not checked" is not treated as "registered"',
  findabilityGap({ ...bare, registered: 'unknown' }) !== null);
check('and neither is an explicit no', findabilityGap({ ...bare, registered: 'not-registered' }) !== null);

/* `unknown` must be a real, default, first-class value: guessing on somebody's
   behalf is the exact failure this field exists to prevent. */
check('unknown is the default label', statusLabel(undefined) === 'Not sure');
check('and it is an offerable option, not just a fallback', ESTATE_DOC_STATUSES[0].id === 'unknown');
check('the registry tri-state keeps "not checked" separate from "no"',
  REGISTRY_STATUSES.some((r) => r.id === 'unknown') && REGISTRY_STATUSES.some((r) => r.id === 'not-registered'));
check('a draft is described as not yet a will',
  /not yet a will/i.test(ESTATE_DOC_STATUSES.find((s) => s.id === 'draft')!.detail));


// ── Wiring: a field nothing renders is a field that does not exist ────────
import { readFileSync } from 'fs';
import { join } from 'path';
const root = join(import.meta.dirname ?? __dirname, '..', '..');
const view = readFileSync(join(root, 'src/components/WillsEstateView.tsx'), 'utf8');
const link = readFileSync(join(root, 'server/familyLink.mjs'), 'utf8');
let m = 0;
const w = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); m++; };

w('the form offers the status picker', /ESTATE_DOC_STATUSES\.map/.test(view));
w('and the registry tri-state', /REGISTRY_STATUSES\.map/.test(view));
w('the record actually saves them', /status: form\.status/.test(view) && /registered: form\.registered/.test(view));
w('a draft is visible on the row without opening it', /statusLabel\(r\.status\)/.test(view));
w('the findability gap is rendered where it fires', /findabilityGap\(r\) && \(/.test(view));

/* THE DECISION v323 HAD TO MAKE OUT LOUD, and how v326 changed exactly half
   of it. Sharing "unsigned draft" with a named successor is tempting and is a
   silent widening of a rung somebody already chose. That still holds for
   `status`. It stopped holding for the two REGISTRY fields, because "it is
   lodged with a notary" answers "where is the will" completely — so they moved
   onto the findability line, which crosses at every rung by design. */
w('status still never crosses',
  /NEVER_SHARE_ESTATE_FIELDS = \[[\s\S]*?'status',[\s\S]*?\];/.test(link)
  && !/SHAREABLE_ESTATE_FIELDS = \[[^\]]*status/.test(link)
  && !/FINDABILITY_ESTATE_FIELDS = \[[^\]]*status/.test(link));
w('the registry fields moved to findability, not to the documents rung',
  /FINDABILITY_ESTATE_FIELDS = \[[^\]]*'registered'[^\]]*'registryName'[^\]]*\]/.test(link)
  && !/SHAREABLE_ESTATE_FIELDS = \[[^\]]*registered/.test(link));
/* Both phrases are anchored to wording unique to THIS decision. An earlier
   version matched "not a\n * fact about..." which also occurs in the
   celebrations comment further up the file — a guard that passes on somebody
   else's sentence is not guarding anything. */
w('and the reason for BOTH halves is recorded beside them, not only in a commit',
  /judgement about somebody's affairs,[\s*]+not a[\s*]+fact about where a document is/.test(link)
  && /A will nobody can[\s*]+find is not a protected will/.test(link));

console.log(`estateStatus.test.ts: ${n + m} assertions passed.`);
