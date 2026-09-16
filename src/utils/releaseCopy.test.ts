import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { RELEASE_WAIT_DAYS, QUIET_DAYS, waitLabel, daysLeft } from './releaseCopy';

let n = 0;
const check = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); n++; };

const root = join(import.meta.dirname ?? __dirname, '..', '..');
const server = readFileSync(join(root, 'server/willsRelease.mjs'), 'utf8');
const serverJs = readFileSync(join(root, 'server.js'), 'utf8');
const view = readFileSync(join(root, 'src/components/WillsEstateView.tsx'), 'utf8');
const db = readFileSync(join(root, 'src/utils/db.ts'), 'utf8');
const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');

/* ── PARITY. The screen must never promise a different number than the server
   enforces. These two constants are duplicated on purpose (see releaseCopy.ts);
   this is the thing that makes the duplication safe. */

const num = (name: string) => {
  const m = new RegExp(`export const ${name} = (\\d+);`).exec(server);
  return m ? Number(m[1]) : NaN;
};
check('the wait the copy says is the wait the server enforces',
  num('RELEASE_WAIT_DAYS') === RELEASE_WAIT_DAYS);
check('the quiet period the copy says is the one the server checks',
  num('QUIET_DAYS') === QUIET_DAYS);

/* ── the countdown a person watches ─────────────────────────────────────── */

const T = (d: number) => new Date(Date.parse('2026-08-01T00:00:00Z') + d * 86400000);
check('the countdown starts at the full wait', daysLeft('2026-08-01T00:00:00Z', T(0)) === RELEASE_WAIT_DAYS);
check('and ticks down', daysLeft('2026-08-01T00:00:00Z', T(2)) === RELEASE_WAIT_DAYS - 2);
check('and floors at zero rather than going negative',
  daysLeft('2026-08-01T00:00:00Z', T(99)) === 0);
check('rubbish gives no number rather than a wrong one',
  daysLeft('not a date', T(0)) === null);
check('the label reads as English at every step',
  waitLabel(3) === 'in 3 days' && waitLabel(1) === 'tomorrow'
  && waitLabel(0) === 'today' && waitLabel(null) === 'shortly');

/* ── the dead end is gone ────────────────────────────────────────────────── */

/* The old locked screen told you to ask an admin — sound advice right up until
   the admin is the person whose will it is. That sentence WAS the gap. */
check('a locked-out adult gets the doorbell, not the old dead end',
  /return <ReleaseDoorbell isChild=\{role === 'child'\} \/>;/.test(view));
check('and a child still gets the plain locked card',
  /if \(isChild\) return <LockedCard isChild \/>;/.test(view));

check('the doorbell can actually ring, agree, and re-check',
  /requestWillRelease\(\)/.test(view) && /approveWillRelease\(/.test(view)
  && /loadReleaseState\(\)/.test(view));
check('the owner can refuse, and the card is mounted for admins',
  /declineWillRelease\(/.test(view) && /<ReleaseRequestsCard/.test(view));

/* ── the heartbeat is at the front door, not on the estate screen ─────────── */

/* An owner who never opens Wills & Estate would otherwise look silent while
   using the app every day, and two people who agreed could walk straight in. */
check('the heartbeat lives in App, not in the estate view',
  /recordOwnerStillHere\(\)/.test(app) && !/recordOwnerStillHere/.test(view));
check('it only fires for an admin', /!isAdmin\) return;\s*\n\s*void recordOwnerStillHere/.test(app));
check('and it is throttled rather than written on every open',
  /HEARTBEAT_KEY/.test(db) && /24 \* 3600 \* 1000/.test(db));
check('a failed heartbeat is swallowed, never shown',
  /catch \{\s*\n\s*\/\* see the doc comment/.test(db));

/* ── the server holds the pen ────────────────────────────────────────────── */

/* willsAccess is admin-write-only in the rules and STAYS that way: the whole
   point is that a non-admin rings the bell, so the server writes for them. */
check('every doorbell action goes through the server, not a client write',
  ['/api/wills-release/state', '/api/wills-release/request',
   '/api/wills-release/approve', '/api/wills-release/decline',
   '/api/wills-release/still-here'].every((p) => db.includes(p) && serverJs.includes(p)));

/* Eligibility is computed from the roles collection server-side. Taking it from
   the request body would let the caller name themselves eligible. */
const eligible = serverJs.slice(
  serverJs.indexOf('async function eligibleReleaseUids'),
  serverJs.indexOf('async function withReleaseState'),
);
check('eligibility is read from roles, never from the request body',
  /roles`\)\.get\(\)/.test(eligible) && !/req\.body/.test(eligible));
check('admins are excluded (they can already read it) and children never qualify',
  /role !== 'member'/.test(eligible));
check('somebody who is already a reader is not offered a doorbell',
  /readers\.includes\(doc\.id\)/.test(eligible));

/* Only an admin may refuse. A named person refusing another named person's
   request would be one heir vetoing another. */
const decline = serverJs.slice(
  serverJs.indexOf("app.post('/api/wills-release/decline'"),
  serverJs.indexOf("app.post('/api/wills-release/still-here'"),
);
check('only an admin can refuse a request',
  /caller\.role !== 'admin'/.test(decline));
check('and refusing an already-opened will says so instead of pretending',
  /already been opened/.test(decline));

/* The sweep has no scheduler. Every endpoint settles first, so the person
   waiting is usually the one whose own visit finishes their clock. */
check('every endpoint sweeps before it does anything else',
  /settleReleases\(access, \{ now, ownerLastSeenAt: access\?\.ownerLastSeenAt \}\)/.test(serverJs));
check('and the sweep and the mutation share one transaction',
  /adminDb\.runTransaction/.test(serverJs.slice(serverJs.indexOf('async function withReleaseState'))));

/* ── a 200 is not an answer ──────────────────────────────────────────────── */

/* Unknown /api paths are swallowed by the SPA catch-all and come back as
   index.html with status 200. A lenient parse turns that into {} — a doorbell
   that reports no requests and no access, and says nothing is wrong. */
check('a non-JSON reply is an error even on a 200',
  /includes\('application\/json'\)/.test(db) && /isJson \? await res\.json/.test(db));
check('and an empty body never passes for a state',
  /Could not reach the vault/.test(db));

/* ── v329: THE INVITE NAMES YOU, IT DOES NOT OPEN THE WILL ───────────────── */

const invite = readFileSync(join(root, 'server/willsInvite.mjs'), 'utf8');
const types = readFileSync(join(root, 'src/types.ts'), 'utf8');

/* The bug this replaced: redeeming an estate invite put the uid straight onto
   readerUids, so accepting opened the whole page while the owner was alive and
   well. Rory sent two of these believing he had named people for later. */
const redeem = invite.slice(invite.indexOf('export function redeemPendingReader'));
check('redemption never widens the reader list',
  !/readerUids: \[\.\.\.readerUids/.test(redeem)
  && !/readerUids\.concat/.test(redeem)
  && !/readerUids\.push/.test(redeem));
check('redemption names them instead',
  /namedUids: \[\.\.\.namedUids, uid\]/.test(redeem));
check('and the named list is a real field, not an invention of this test',
  /export function namedList/.test(invite) && /namedUids\?: string\[\]/.test(types));

/* The write has to carry the named list or the pure function's decision never
   reaches Firestore — the classic gap between a tested module and a live app. */
const grantFn = serverJs.slice(
  serverJs.indexOf('async function grantEstateAccessFromInvite'),
  serverJs.indexOf('async function eligibleReleaseUids'),
);
check('the server writes namedUids when an invite is redeemed',
  /namedUids: result\.namedUids/.test(grantFn));

/* ── rung one reaches the person who was named ───────────────────────────── */

check('a named person is eligible to ring the doorbell',
  /named\.includes\(doc\.id\)/.test(serverJs));
check('rung one is the SAME projection the family link uses, not a second one',
  /projectFindability/.test(serverJs) && /findabilityForNamed/.test(serverJs));
check('and it goes to named people only, never to every member',
  /if \(!namedList\(access\)\.includes\(uid\)\) return null;/.test(serverJs));
check('somebody who can already read the whole thing is not shown a summary of it',
  /findability: youMayRead \? null :/.test(serverJs));
check('the doorbell renders it', /<WhereItIsCard entries=\{findability\}/.test(view));
check('and says plainly when nothing was recorded',
  /Nothing has been written down about where this is kept/.test(view));

/* State is REPORTED even when the transaction writes nothing — the common case.
   Both lines used to sit below the early return, so an ordinary page open
   answered with readerUids undefined and (once namedUids existed) would have
   hidden rung one from exactly the people it was built for. */
const wrs = serverJs.slice(
  serverJs.indexOf('async function withReleaseState'),
  serverJs.indexOf("app.post('/api/wills-release/state'"),
);
const reportIdx = wrs.indexOf('result.namedUids = namedList(access);');
const returnIdx = wrs.indexOf('if (!swept.changed && !out.changed) return;');
check('the state is reported before the no-write early return',
  reportIdx > 0 && returnIdx > 0 && reportIdx < returnIdx);

/* ── the invite must not promise what it no longer does ──────────────────── */

check('the invite message no longer promises access to the will',
  !/gives you access to their will/.test(view));
check('it says accepting does not open it',
  /Accepting does not open their will/.test(view));
check('and the admin card says an invite does not grant a read',
  /Accepting an estate invite does <strong>not<\/strong> do this/.test(view));
check('a named person is visible to the admin, and distinguishable from a reader',
  /Named, cannot open/.test(view));

/* ── v331: THE REFUSAL WINDOW IS ACTUALLY DELIVERED ──────────────────────── */

/* The copy has said since v327 that "every admin of this space is told
   straight away and can refuse". Nothing was sent. The seven-day design rests
   entirely on the owner having a REAL chance to refuse, so an admin who is
   never told has a theoretical one — the guard below is the whole feature. */
const needs = readFileSync(join(root, 'src/components/NeedsAttention.tsx'), 'utf8');

check('the copy still makes the promise these guards exist to keep',
  /is told straight away and can refuse/.test(view));

const admins = serverJs.slice(
  serverJs.indexOf('async function sendToAdmins'),
  serverJs.indexOf('async function sendToFamily'),
);
check('there is an admin-only push, separate from sendToFamily',
  admins.length > 0 && /role === 'admin'/.test(admins));
check('and it drops uid-less subscriptions rather than broadcasting to them',
  /!sub\.uid \|\| !adminUids\.has\(sub\.uid\)/.test(admins));

const request = serverJs.slice(
  serverJs.indexOf("app.post('/api/wills-release/request'"),
  serverJs.indexOf("app.post('/api/wills-release/approve'"),
);
check('asking to read the will notifies the admins', /sendToAdmins\(/.test(request));
check('and a failed notification never fails the request',
  /catch \(err\) \{\s*\n\s*console\.error\('\[wills-release\] FAILED to notify admins/.test(request));
check('the push says the number the server enforces, not a second one',
  /It opens in \$\{RELEASE_WAIT_DAYS\} days unless you refuse/.test(request));

/* Push is the surface that silently fails — permission never granted,
   notifications off, a new phone. The home row is the one that cannot. */
check('the home screen carries the request independently',
  /function computeReleaseNudges/.test(needs) && /computeReleaseNudges\(releaseRequests\)/.test(needs));
check('it is admin-gated, because only an admin can refuse',
  /const isAdmin = role === 'admin';/.test(needs) && /if \(isAdmin\) \{\s*\n\s*loadReleaseState\(\)/.test(needs));
check('a settled request stops nagging',
  /if \(r\.declinedAt \|\| r\.releasedAt\) continue;/.test(needs));
check('and the row lands on the screen where refusing happens',
  /view: 'willsEstate',\n      sortDays/.test(needs));

/* A push url the app does not parse is a deep link that is not one. Nothing
   reads ?view=; only ?do=, for the Android home-screen shortcuts. */
check('the notification opens the app at home, not at a fictional deep link',
  !/url: '\/\?view=/.test(serverJs));

/* ── NOTHING IN THIS CODEBASE MAY CLAIM A DEATH TRIGGER EXISTS ───────────── */

/* willsRelease.mjs is unambiguous: "There is no death detection in this app and
   there is not going to be." Three comments elsewhere nevertheless described
   files as sitting "behind the existing death trigger" — familyLink.mjs,
   types.ts and firstHours.test.ts. They had been noticed and left three times.

   The reason this is not pedantry: a maintainer who believes a stronger gate
   sits further back will relax a weaker one in front of it. "The files stay
   behind the death trigger anyway" is exactly the sentence that justifies
   widening a rung on the successor ladder — and there is nothing back there.
   What actually holds them is the wills lock plus the release ladder.

   THE RULE: the phrase may appear, but only inside a sentence that denies it.
   Comment leaders and line wrapping are stripped first, because the version in
   types.ts had "death" and "trigger" on different lines and no naive grep for
   the phrase would ever have found it. */
const scan = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile() && /\.(ts|tsx|mjs|js)$/.test(e.name))
  .map((e) => join(e.parentPath ?? join(root, dir), e.name));

/* This file is the one exclusion, and it has to be: the bait string below is a
   real undenied claim, deliberately. The first run of this scan failed on it,
   which is the best evidence the scan is not decorative. */
const SELF = 'releaseCopy.test.ts';
const offenders: string[] = [];
for (const file of [...scan('src'), ...scan('server'), join(root, 'server.js')]) {
  if (file.endsWith(SELF)) continue;
  const flat = readFileSync(file, 'utf8')
    .replace(/^\s*(\/\/|\*|\/\*)+/gm, ' ')   // comment leaders
    .replace(/\s+/g, ' ');                    // and the wrapping
  const phrase = /death (trigger|detection|switch)/gi;
  let hit: RegExpExecArray | null;
  while ((hit = phrase.exec(flat))) {
    /* The denial has to be RIGHT BEFORE the phrase, not merely somewhere in the
       same sentence. The first version of this checked the whole sentence and
       let the real types.ts claim through, because the sentence it lived in
       happened to start "Never where one is kept, never who holds it…" — three
       negations, none of them about the trigger. */
    const before = flat.slice(Math.max(0, hit.index - 40), hit.index);
    if (/\b(no|not|never|none|nothing|without)\b[^.;]*$/i.test(before)) continue;
    offenders.push(`${file.replace(root, '')}: …${before.trim()} ${hit[0]}…`);
  }
}
check(`no file claims a death trigger exists${offenders.length ? ':\n    ' + offenders.join('\n    ') : ''}`,
  offenders.length === 0);

/* The scan is worthless if it matches nothing, so prove it bites. */
const bait = 'never who holds it, and never the files — those stay behind the existing death trigger.';
const baitBefore = bait.slice(0, bait.indexOf('death trigger')).slice(-40);
check('and the scan still catches a claim wrapped in unrelated negations',
  /death (trigger|detection|switch)/i.test(bait)
  && !/\b(no|not|never|none|nothing|without)\b[^.;]*$/i.test(baitBefore));

/* The truthful replacement names the two things that DO hold them. */
const link = readFileSync(join(root, 'server/familyLink.mjs'), 'utf8');
check('the successor ladder names the wills lock and the release ladder instead',
  /reference\/willsEstate/.test(link) && /willsRelease\.mjs/.test(link));
check('and the files are on the never-share list it points at',
  /NEVER_SHARE_ESTATE_FIELDS = \[[\s\S]*?'linkedDocIds', 'linkedPolicyIds'/.test(link));

console.log(`releaseCopy.test.ts: ${n} assertions passed.`);
