// Standalone assertion test — no test runner is configured in this project:
//   npx tsx src/utils/hubName.test.ts
// Exits non-zero on failure.
//
// TWO STORES FOR ONE NAME.
//
// The regression this pins is not a crash — it is the app displaying a
// generic label to a family that had ALREADY told it their name. What makes
// that class of bug expensive is that every test of the settings screen
// passes: the rename works, it saves, it renders. The hole is the space that
// was never renamed, which is every space on day one.
//
// So the assertions below are all about PRECEDENCE and about which inputs
// count as "no name" — an empty string and a string of spaces are the shapes
// that actually arrive from a form field.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hubDisplayName } from './hubName';

let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failures += 1; console.error(`  ✗ ${name}\n    ${(err as Error)?.message || err}`); }
}

console.log('precedence');

check('a deliberate rename wins over the creation name', () => {
  assert.equal(hubDisplayName('Clark Family Hub', 'the rats', false), 'Clark Family Hub');
});

check('the creation name is used when nothing has been renamed', () => {
  // The bug: this returned 'Family Hub' and the family's own name was only
  // ever visible inside the closed space-switcher dropdown.
  assert.equal(hubDisplayName(undefined, 'the rats', false), 'the rats');
  assert.equal(hubDisplayName('', 'the rats', false), 'the rats');
  assert.equal(hubDisplayName(null, 'the rats', false), 'the rats');
});

check('a whitespace-only rename does not count as a name', () => {
  // An admin who clears the settings field leaves '   ' behind often enough
  // that treating it as a real name would blank the header.
  assert.equal(hubDisplayName('   ', 'the rats', false), 'the rats');
  assert.equal(hubDisplayName('\t\n ', 'the rats', false), 'the rats');
});

check('names are trimmed before they reach the header', () => {
  assert.equal(hubDisplayName('  Clark Family Hub  ', null, false), 'Clark Family Hub');
  assert.equal(hubDisplayName(null, '  the rats  ', false), 'the rats');
});

console.log('the generic fallback');

check('only reached when there is genuinely no name anywhere', () => {
  assert.equal(hubDisplayName(undefined, undefined, false), 'Family Hub');
  assert.equal(hubDisplayName('', '', false), 'Family Hub');
  assert.equal(hubDisplayName('  ', '  ', false), 'Family Hub');
});

check('a business space falls back to its own generic label', () => {
  assert.equal(hubDisplayName(undefined, undefined, true), 'Business Hub');
  // ...but a named business is still called by its name, not by the label.
  assert.equal(hubDisplayName(undefined, 'Bhanu Pty', true), 'Bhanu Pty');
});

check('the space type never overrides a real name', () => {
  for (const isBusiness of [false, true]) {
    assert.equal(hubDisplayName('Renamed', 'Created', isBusiness), 'Renamed');
    assert.equal(hubDisplayName(undefined, 'Created', isBusiness), 'Created');
  }
});

check('the result is never empty', () => {
  const inputs = [undefined, null, '', '   ', 'x'] as (string | undefined | null)[];
  for (const a of inputs) {
    for (const b of inputs) {
      for (const biz of [false, true]) {
        const out = hubDisplayName(a, b, biz);
        assert.ok(out.trim().length > 0,
          `hubDisplayName(${JSON.stringify(a)}, ${JSON.stringify(b)}, ${biz}) produced an empty header`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// The wiring. The function above is only reached if Dashboard actually calls
// it — a tidy-up that restores the old `settings.hubName || 'Family Hub'`
// one-liner would leave every assertion above passing while putting the
// generic label straight back on the header.
// ---------------------------------------------------------------------------
const dashboard = fs.readFileSync(path.join(process.cwd(), 'src/components/Dashboard.tsx'), 'utf8');

console.log('the header is wired to it');

check('Dashboard derives hubName through hubDisplayName', () => {
  assert.match(dashboard, /import \{ hubDisplayName \} from '\.\.\/utils\/hubName'/,
    'Dashboard no longer imports hubDisplayName');
  assert.match(dashboard, /const hubName = hubDisplayName\(/,
    'Dashboard computes hubName some other way again — check it still falls back to the space name.');
});

check('the old fallback-straight-to-the-label line is gone', () => {
  assert.doesNotMatch(
    dashboard,
    /settings\.hubName \|\| \(isBusinessSpace \? 'Business Hub' : 'Family Hub'\)/,
    "the original `settings.hubName || 'Family Hub'` line is back — a family that named itself sees a generic label again.",
  );
});

check('the space name it falls back to is the ACTIVE space', () => {
  // Falling back to spaces[0].name would show the wrong household's name to
  // anyone who belongs to more than one space.
  assert.match(
    dashboard,
    /spaces\.find\(\(s\) => s\.id === activeSpaceId\)\?\.name/,
    'the fallback name is not read from the active space — a member of two spaces would see the wrong one.',
  );
});

if (failures) {
  console.error(`\nhubName.test.ts: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nhubName.test.ts: all assertions passed');
