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

// The full version log (Settings → What's new) reads public/changelog.json,
// a cumulative newest-first history. CHANGES.json only ever describes the
// CURRENT release, so every release must also prepend its entry to the log —
// exactly the kind of second manual step that gets forgotten (this file's own
// header describes CHANGES.json sitting stale for ten deploys). Same cure:
// fail the build.
const log = JSON.parse(readFileSync('public/changelog.json', 'utf8'));
if (!Array.isArray(log) || log.length === 0) {
  throw new Error('changelogFresh: public/changelog.json is missing or empty — the What\'s new log would show nothing.');
}
if (log[0].label !== changes.label) {
  throw new Error(
    `changelogFresh: public/changelog.json starts at "${log[0].label}" but this release is "${changes.label}".\n` +
    `  Prepend {label, date (YYYY-MM-DD), changes} for ${changes.label} to public/changelog.json —\n` +
    `  the Settings "What's new" log reads that file and must include the release it ships with.`,
  );
}
if (JSON.stringify(log[0].changes) !== JSON.stringify(changes.changes)) {
  throw new Error(
    `changelogFresh: public/changelog.json's ${log[0].label} entry differs from CHANGES.json.\n` +
    `  The banner and the What's new log must tell the same story — copy CHANGES.json's changes array in.`,
  );
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(log[0].date || ''))) {
  throw new Error(`changelogFresh: public/changelog.json's ${log[0].label} entry needs a YYYY-MM-DD date.`);
}

console.log(`changelogFresh.test.ts: all assertions passed\n  changelog matches deployed tag (${deployed}), ${changes.changes.length} entries; What's new log current at ${log[0].label} (${log.length} versions)`);
