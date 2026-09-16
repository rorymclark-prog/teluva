import { readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

/**
 * Connected families card (People → Profiles) — collapsed by default.
 *
 * ConnectedInline.tsx used to auto-expand a household's people whenever
 * exactly one connected family existed ("with ONE connected family there is
 * nothing to choose between"). That made the default depend on how many
 * households a person had connected — one household: expanded on mount, two
 * or more: collapsed on mount. The product ask was a plain, unconditional
 * default: collapsed every time the screen mounts, regardless of count. This
 * guards that the auto-open-on-mount effect is gone and that the open-ids
 * state still starts empty.
 *
 * ConnectedFamilies.tsx — the "Manage" modal — carried its OWN copy of the
 * same effect, keyed on `active.length === 1` rather than `links.length`, and
 * was removed in the same pass. It is checked here too, because the whole
 * point of the ask was that the behaviour stop depending on which surface you
 * happen to be looking at; guarding one file and not the other would let the
 * inconsistency come straight back on the surface nobody tested.
 */
const root = join(import.meta.dirname ?? __dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const src = strip(read('src/components/ConnectedInline.tsx'));
const manage = strip(read('src/components/ConnectedFamilies.tsx'));

let n = 0;
const check = (label: string, cond: boolean) => {
  assert.ok(cond, `FAILED: ${label}`);
  n++;
};

// The pattern that catches an unconditional length-based auto-expand effect:
// a useEffect body that calls toggle/open based on `links.length === 1` (or
// `!== 1` guard-and-return) with no other gate.
const autoExpandOnSingleLink = /links\.length\s*(===|!==)\s*1/;

// The Manage modal counted the ACTIVE links rather than all of them, so the
// same bug wore a different name there. Matching either noun is what makes
// this guard survive the next rename.
const autoExpandOnSingleActive = /(links|active)\.length\s*(===|!==)\s*1/;

check('no effect keys expanding a household off how many are connected',
  !autoExpandOnSingleLink.test(src));

check('the Manage modal does not auto-expand a lone connected family either',
  !autoExpandOnSingleActive.test(manage));

// The open-ids state must still start empty — that IS the collapsed default.
check('openIds state initializes empty', /useState<string\[\]>\(\[\]\)/.test(src));

// CONTROL: prove the pattern above is not simply unmatchable. A synthetic
// snippet shaped like the old auto-expand effect must trip it, or the guard
// above is worthless.
const syntheticOldBehavior = `
  useEffect(() => {
    if (loading || links.length !== 1 || openIds.length) return;
    void toggle(links[0]);
  }, [loading, links]);
`;
check('control: the auto-expand pattern DOES match the old (buggy) shape',
  autoExpandOnSingleLink.test(syntheticOldBehavior));

// The second CONTROL, for the Manage modal's variant. Its old effect read
// `active.length === 1`, which the first pattern would NOT have caught — so
// without this, the modal assertion above could have been passing for the
// wrong reason all along.
const syntheticManageBehavior = `
  useEffect(() => {
    if (!open || loading || openLinkId) return;
    const active = links.filter((l) => l.status === 'active');
    if (active.length === 1) void handleOpen(active[0]);
  }, [open, loading, links]);
`;
check('control: the active-count variant DOES match the Manage modal\'s old shape',
  autoExpandOnSingleActive.test(syntheticManageBehavior));
check('control: and the links-only pattern would have MISSED it, which is why both exist',
  !autoExpandOnSingleLink.test(syntheticManageBehavior));

console.log(`connectedInlineCollapse.test.ts: ${n} assertions passed.`);
