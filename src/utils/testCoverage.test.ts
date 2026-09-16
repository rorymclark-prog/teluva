import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * A TEST FILE THAT NEVER RUNS IS WORSE THAN NO TEST FILE.
 *
 * `npm test` is a hand-maintained chain of `tsx <file> && tsx <file>`, so a
 * new suite is invisible until somebody remembers to append it. Two did not
 * get appended: utilityFields.test.ts (v318, 64 assertions about which
 * emergency numbers may be hard-coded) and openElsewhere.test.ts (v319, 21
 * about a file leaving the app). Both passed when run by hand, both sat dead
 * in CI for a day, and either could have gone red without anybody noticing —
 * the worst kind of green, because the file's existence is what stops anyone
 * looking again.
 *
 * This is the structural fix: the chain must mention every test file on disk.
 */
const root = join(import.meta.dirname ?? __dirname, '..', '..');
const pkg = readFileSync(join(root, 'package.json'), 'utf8');

const found: string[] = [];
for (const dir of ['src/utils', 'src/components']) {
  for (const f of readdirSync(join(root, dir))) {
    if (f.endsWith('.test.ts') || f.endsWith('.test.tsx')) found.push(`${dir}/${f}`);
  }
}

assert.ok(found.length > 70, `expected to find the suites on disk, saw ${found.length}`);

/* A NAME IN THE STRING IS NOT A RUN.
 *
 * This guard used to accept any mention of the filename anywhere in
 * package.json, and that is exactly how funeralCoverLines.test.ts slipped
 * through: it was appended to the PREVIOUS command with a space —
 * `tsx a.test.ts b.test.ts` — so tsx ran a, took b as an argument, and never
 * executed it. The file was on disk, named in the script, and green. It had
 * never run once.
 *
 * So the match is now on the shape the runner actually obeys: its own
 * `tsx <path>` (or `vitest run <path>`) invocation. */
const runsIt = (f: string) =>
  new RegExp(String.raw`(?:tsx|vitest run)\s+${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\s|"|$)`)
    .test(pkg);
const orphans = found.filter((f) => !runsIt(f));
assert.deepEqual(orphans, [],
  `these test files exist but npm test never runs them: ${orphans.join(', ')}. `
  + 'Give each one its own "&& tsx <path>" in the "test" script in package.json '
  + '— appending it after another path with a space does NOT run it.');

console.log(`testCoverage.test.ts: ${found.length} suites on disk, all reachable from npm test.`);
