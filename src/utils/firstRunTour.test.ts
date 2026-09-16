/**
 * The first-run tour must not describe a room the space does not have.
 *
 * FirstRunTour drops a step whose anchor is missing, which handles the
 * emergency quick-action correctly in a business space. It cannot handle a
 * step that is legitimately SHOWN but whose words are family-only, and for
 * five versions four of the seven steps were exactly that: the closing slide
 * promised a family quiz, a growing-up video, a recipe book and a travel
 * timeline (all four in HIDDEN_VIEWS_IN_BUSINESS); the section-menu step
 * named Wills & Estate (also hidden) and Household (called Locations); the
 * empty-state step promised sizes (HIDDEN_IN_BUSINESS); and the AI step told
 * a care company to try "add a dentist visit for Mia on the 12th".
 *
 * This renders every step's title and body in both space types and fails when
 * business copy names something a business space hides. It reads the two
 * hidden lists out of Dashboard.tsx rather than restating them, so adding an
 * id to either list — the thing that CAUSED this — brings its banned words
 * with it instead of silently widening the gap.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { STEPS, type TourCtx } from '../components/firstRunSteps';

const root = join(import.meta.dirname ?? __dirname, '..', '..');
let checks = 0;
const check = (label: string, fn: () => void) => { fn(); checks++; if (process.env.VERBOSE) console.log('  ✓', label); };

const dashboard = readFileSync(join(root, 'src', 'components', 'Dashboard.tsx'), 'utf8');

function idsIn(constName: string): string[] {
  const m = dashboard.match(new RegExp(`const ${constName}[^=]*=\\s*\\[([^\\]]*)\\]`));
  assert.ok(m, `${constName} not found in Dashboard.tsx — this test is reading the wrong file`);
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const hiddenViews = idsIn('HIDDEN_VIEWS_IN_BUSINESS');
const hiddenTabs = idsIn('HIDDEN_IN_BUSINESS');

check('the hidden lists were actually parsed', () => {
  assert.ok(hiddenViews.includes('willsEstate'), `HIDDEN_VIEWS_IN_BUSINESS parsed as ${JSON.stringify(hiddenViews)}`);
  assert.ok(hiddenTabs.includes('sizes'), `HIDDEN_IN_BUSINESS parsed as ${JSON.stringify(hiddenTabs)}`);
});

/**
 * The words a reader would use for each hidden id. Ids are camelCase and the
 * copy is English, so the bridge has to be written down once; keeping it keyed
 * BY ID is what makes the "did you add to the list?" check below possible.
 */
const WORDS_FOR: Record<string, string[]> = {
  familyWords: ['family word', 'things people said', 'the things people said'],
  timeline: ['family memory'],
  shopping: ['shopping list'],
  emergency: [],            // the step self-drops — its anchor is family-only
  recipes: ['recipe'],
  travelTimeline: ['travel timeline'],
  inMemory: ['in memory'],
  willsEstate: ['wills & estate', 'wills and estate'],
  gifts: ['gift list'],
  anniversaries: [],        // a business HAS work anniversaries; the view is what is hidden
  extendedBirthdays: [],
  pets: ['pet'],
  familyTree: ['family tree'],
  care: [],
  sizes: ['sizes', 'shoe size'],
  favorites: ['favourites'],
  growth: ['growing-up', 'height chart', 'growth story'],
  sayings: [],
  timelapse: ['growing-up video'],
  guardians: ['guardian'],
};

check('every hidden id has an entry here, so widening a list cannot slip past', () => {
  const missing = [...hiddenViews, ...hiddenTabs].filter((id) => !(id in WORDS_FOR));
  assert.deepStrictEqual(
    missing,
    [],
    `these ids were added to a HIDDEN_*_IN_BUSINESS list but have no entry in WORDS_FOR: ${missing.join(', ')}. ` +
      'Add the words a reader would use for them (or an empty array with a comment saying why none apply).',
  );
});

const banned = [
  ...[...hiddenViews, ...hiddenTabs].flatMap((id) => WORDS_FOR[id] ?? []),
  // Renamed rather than hidden — naming the family label sends a business
  // reader looking for a section that is on screen under another word.
  'household', 'family quiz', 'babysitter',
  // A family example inside a company.
  'dentist',
];

const businessCtx: TourCtx = { isBusinessSpace: true, membersCount: 3, canUseAI: true, hubName: 'Donaupflege GmbH' };
const emptyBusinessCtx: TourCtx = { ...businessCtx, membersCount: 0 };
const noAiBusinessCtx: TourCtx = { ...businessCtx, canUseAI: false };

for (const ctx of [businessCtx, emptyBusinessCtx, noAiBusinessCtx]) {
  const variant = `members=${ctx.membersCount} ai=${ctx.canUseAI}`;
  for (const step of STEPS) {
    check(`business copy for "${step.id}" (${variant}) names nothing a business space hides`, () => {
      const text = `${step.title(ctx)} ${step.body(ctx)}`.toLowerCase();
      const hits = banned.filter((w) => text.includes(w));
      assert.deepStrictEqual(
        hits,
        [],
        `tour step "${step.id}" (${variant}) tells a business reader about ${hits.join(', ')} — ` +
          'a business space does not have that. Branch the copy on ctx.isBusinessSpace.',
      );
    });
  }
}

/** The family copy must NOT have been flattened into the business wording. */
check('the family tour still names the family-only things', () => {
  const familyCtx: TourCtx = { isBusinessSpace: false, membersCount: 3, canUseAI: true, hubName: 'Family Hub' };
  const all = STEPS.map((s) => `${s.title(familyCtx)} ${s.body(familyCtx)}`).join(' ').toLowerCase();
  for (const word of ['family quiz', 'recipe', 'travel timeline', 'wills & estate']) {
    assert.ok(all.includes(word), `the family tour no longer mentions "${word}" — the business rewrite went too wide`);
  }
});

/** Every step must produce non-empty copy in both space types. */
check('no step renders empty in either space type', () => {
  for (const ctx of [businessCtx, { ...businessCtx, isBusinessSpace: false }]) {
    for (const step of STEPS) {
      assert.ok(step.title(ctx).trim().length > 0, `${step.id} has an empty title`);
      assert.ok(step.body(ctx).trim().length > 20, `${step.id} has an empty or stub body`);
    }
  }
});

console.log(`firstRunTour: ${checks} checks passed`);
