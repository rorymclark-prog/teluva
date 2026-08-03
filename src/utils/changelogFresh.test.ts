/**
 * The release notes must describe THIS release.
 *
 * CHANGES.json is hand-written and feeds the in-app "New version available"
 * banner. Nothing checked it, so it sat at "v138" for ten consecutive deploys
 * while the version it shipped alongside kept climbing — every release told
 * users about work from ten releases ago, and the one person who would notice
 * was the one who had already read it.
 *
 * A stale changelog is worse than none: it actively misinforms, and it trains
 * people to ignore the banner. Fail the build instead.
 */
import { readFileSync } from 'node:fs';

const changes = JSON.parse(readFileSync('CHANGES.json', 'utf8'));
const deployed = /teluva:(v\d+)/.exec(readFileSync('run-service.yaml', 'utf8'))?.[1];

if (!deployed) throw new Error('changelogFresh: could not read the image tag from run-service.yaml');
if (changes.label !== deployed) {
  throw new Error(
    `changelogFresh: CHANGES.json says "${changes.label}" but run-service.yaml deploys "${deployed}".\n` +
    `  Update CHANGES.json (label + changes) to describe what is actually shipping,\n` +
    `  or bump it alongside the image tag. The banner shows this text to every user.`,
  );
}
if (!Array.isArray(changes.changes) || changes.changes.length === 0) {
  throw new Error('changelogFresh: CHANGES.json has no entries — the banner would show a version number and nothing else.');
}
console.log(`changelogFresh.test.ts: all assertions passed\n  changelog matches deployed tag (${deployed}), ${changes.changes.length} entries`);
