/* Tests for retiredAddress().
 *
 * This function exists because of a real week-long failure: the rename from
 * family-info-organizer to teluva left TWO Cloud Run services running, the
 * user's installed app was pinned to the old one, and every release for a week
 * went somewhere they could not see. The version check could not catch it —
 * an old service serves an old bundle AND an old version.json, so it agrees
 * with itself perfectly and reports "up to date".
 *
 * The two failure modes to guard are opposite and both bad:
 *   - a retired host NOT recognised (silent staleness, the original incident)
 *   - a live host wrongly flagged (a false "you've moved" banner, which is
 *     worse long-term because it trains people to ignore the banner)
 */
import { retiredAddress } from './appUpdate';

let failures = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? '  ok' : 'FAIL'}  ${what}${ok ? '' : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

console.log('retiredAddress — retired hosts are recognised and rewritten');
// The two hostnames Cloud Run gave the old service. Both were live and serving
// v175 while teluva was on v183.
eq(
  retiredAddress('family-info-organizer-1000796646145.europe-west2.run.app'),
  'teluva-1000796646145.europe-west2.run.app',
  'project-number host maps to the teluva service',
);
eq(
  retiredAddress('family-info-organizer-x3k4bua7pq-nw.a.run.app'),
  'teluva-x3k4bua7pq-nw.a.run.app',
  'hashed host maps to the teluva service',
);
// The port must survive: without it a local check against the old name would
// rewrite to a host that isn't listening.
eq(
  retiredAddress('family-info-organizer-1000796646145.europe-west2.run.app:8443'),
  'teluva-1000796646145.europe-west2.run.app:8443',
  'a port is carried across',
);

console.log('\nretiredAddress — current and unknown hosts are left alone');
eq(retiredAddress('teluva-1000796646145.europe-west2.run.app'), null, 'the live host is not flagged');
eq(retiredAddress('teluva-x3k4bua7pq-nw.a.run.app'), null, 'the other live host is not flagged');
eq(retiredAddress('localhost:5173'), null, 'local dev is not flagged');
// The whole reason this is a deny-list: a custom domain (task #97) must not
// start life showing every visitor a "you have moved" banner.
eq(retiredAddress('teluva.app'), null, 'a future custom domain is not flagged');
eq(retiredAddress('www.teluva.at'), null, 'a future www custom domain is not flagged');

console.log('\nretiredAddress — the prefix match is anchored, not a substring');
// "contains the old name" is not the same as "is the old service". Rewriting
// on a loose match would send someone to a host that does not exist.
eq(retiredAddress('my-family-info-organizer.example.com'), null, 'a host merely containing the name is not flagged');
eq(retiredAddress('family-info-organizerX.run.app'), null, 'the prefix must end at a label boundary');
eq(retiredAddress(''), null, 'an empty host is not flagged');

console.log(failures === 0 ? '\nAll appUpdate tests passed.' : `\n${failures} appUpdate test(s) FAILED.`);
if (failures > 0) process.exit(1);
