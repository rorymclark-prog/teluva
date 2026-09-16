/**
 * A business space must not be handed family wording.
 *
 * Renaming three nav items and hiding thirteen views is only half the job. The
 * screens a business space KEEPS still have to say business things, and on
 * 2026-08-29 a walkthrough of the business demo found seven places where they
 * did not: the Vault's signed-out card said "use this space with your own
 * family", the Operations screen offered "the home record", the home screen
 * said "Open People" when that nav item is called Team there, the document
 * filing scope read "Whole family", Vehicles suggested "e.g. Family car",
 * Slips suggested "e.g. Household, Mia" (a demo child's name inside a
 * company), and the calendar offered "Family travel" and "Family milestone".
 *
 * Two guards here, because the leak has two causes:
 *
 * 1. STRUCTURAL — a view reachable in a business space whose component is
 *    never told which kind of space it is in cannot get the wording right even
 *    in principle. Derived from Dashboard's own VIEWS and
 *    HIDDEN_VIEWS_IN_BUSINESS so adding a view puts it under the guard.
 * 2. TEXTUAL — the specific strings that were wrong, pinned so a later edit
 *    cannot quietly drop the branch.
 *
 * NOT guarded, deliberately: the "[Family Hub]" prefix in googleCalendarSync
 * is DATA, not copy. handleImportFromGoogle skips events whose summary starts
 * with it, which is how an exported event avoids being re-imported as a
 * duplicate. Renaming it per space type would duplicate every exported event
 * in a business calendar. See the comment on googleCalendarSync.ts:63.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';

const root = join(import.meta.dirname ?? __dirname, '..', '..');
const comp = (name: string) => readFileSync(join(root, 'src', 'components', `${name}.tsx`), 'utf8');
const dashboard = comp('Dashboard');
let checks = 0;
const check = (label: string, fn: () => void) => { fn(); checks++; if (process.env.VERBOSE) console.log('  ✓', label); };

// --- 1. structural -------------------------------------------------------

const viewIds = [...dashboard.matchAll(/\{\s*id:\s*'([a-zA-Z]+)',\s*icon:/g)].map((m) => m[1]);
const hiddenMatch = dashboard.match(/const HIDDEN_VIEWS_IN_BUSINESS[^=]*=\s*\[([^\]]*)\]/);
assert.ok(hiddenMatch, 'HIDDEN_VIEWS_IN_BUSINESS not found — this test is reading the wrong file');
const hidden = new Set([...hiddenMatch![1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

check('Dashboard VIEWS and the hidden list both parsed', () => {
  assert.ok(viewIds.length >= 15, `only parsed ${viewIds.length} view ids: ${viewIds.join(',')}`);
  assert.ok(hidden.has('willsEstate'), `hidden list parsed as ${[...hidden].join(',')}`);
});

const businessViews = viewIds.filter((id) => !hidden.has(id));

/** The render block for one view: from `{mainView === 'id' &&` to the next one. */
function renderBlock(id: string): string | null {
  const start = dashboard.indexOf(`{mainView === '${id}' &&`);
  if (start === -1) return null;
  const next = dashboard.indexOf('{mainView ===', start + 20);
  return dashboard.slice(start, next === -1 ? start + 2000 : next);
}

/**
 * Views whose screen has no person-facing wording to get wrong. Each needs a
 * reason, so "add it to the allowlist" is never the cheap way out.
 */
const NO_WORDING: Record<string, string> = {
  drive: 'Google Drive sync — the copy is about Google and files, never about who the space is for',
  passwords: 'a credential list; the wording is about secrets and sharing, not family or team',
};

for (const id of businessViews) {
  check(`the "${id}" view is told which kind of space it is in`, () => {
    const block = renderBlock(id);
    assert.ok(block, `no render block found for mainView === '${id}' — the guard is not actually checking it`);
    if (id in NO_WORDING) return;
    assert.ok(
      block!.includes('isBusinessSpace'),
      `${id} is reachable in a business space but its component is never passed isBusinessSpace, ` +
        'so it cannot word itself correctly. Thread the prop, or add it to NO_WORDING with a reason.',
    );
  });
}

// --- 2. textual ----------------------------------------------------------

const PINNED: [string, string, string][] = [
  ['Dashboard', "your own {isBusinessSpace ? 'team' : 'family'}", 'the signed-out demo card told a business "use this space with your own family"'],
  ['FamilyPulse', "'Open Team to keep the team record current'", 'the home card said "Open People"; that nav item is called Team in a business space'],
  ['HouseholdView', "'Start with one useful detail; the location record can grow slowly.'", 'Operations offered "the home record"'],
  ['DocumentVault', "isBusinessSpace ? 'Whole team' : 'Whole family'", 'the document filing scope read "Whole family"'],
  ['VehiclesView', "isBusinessSpace ? 'e.g. Company van' : 'e.g. Family car'", 'the vehicle name placeholder suggested "e.g. Family car"'],
  ['SlipsView', "isBusinessSpace ? 'e.g. Office, Workshop'", 'the slip placeholder named a demo child inside a company'],
  ['FamilyCalendar', "isBusinessSpace ? 'Business travel / Flights'", 'the event category read "Family travel"'],
  ['FamilyCalendar', "isBusinessSpace ? 'Company milestone'", 'the event category read "Family milestone"'],
];

for (const [file, needle, why] of PINNED) {
  check(`${file} still branches: ${why}`, () => {
    assert.ok(comp(file).includes(needle), `${file} lost the business branch — ${why}`);
  });
}

/** The family wording must survive too — a business rewrite that flattens both is not a fix. */
check('the family wording was not flattened away', () => {
  assert.ok(comp('DocumentVault').includes("'Whole family'"), 'DocumentVault no longer offers "Whole family" to a family');
  assert.ok(comp('VehiclesView').includes("'e.g. Family car'"), 'VehiclesView lost the family placeholder');
  assert.ok(comp('FamilyPulse').includes("'Open People to add the moments worth keeping'"), 'FamilyPulse lost the family copy');
});

console.log(`businessCopy: ${checks} checks passed`);
