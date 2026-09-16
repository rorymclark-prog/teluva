import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ACTIVITY_RETENTION_DAYS, DEDUPE_WINDOW_MS,
  isLoggableKind, visibilityFor, visibilitiesFor, activityLabel,
  shouldLog, orderActivity, retentionCutoffISO, timeAgo, type ActivityEntry,
} from './activity';

let n = 0;
const check = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); n++; };

const root = join(import.meta.dirname ?? __dirname, '..', '..');
const rules = readFileSync(join(root, 'firestore.rules'), 'utf8');
const db = readFileSync(join(root, 'src/utils/db.ts'), 'utf8');
const serverJs = readFileSync(join(root, 'server.js'), 'utf8');
const emulator = readFileSync(join(root, 'firestore-rules.test.mjs'), 'utf8');

/* ── the tier is never wider than the document it describes ──────────────── */

/* An entry saying "the will was updated" is a smaller disclosure than the will
   — but it still tells a locked-out reader that a will exists and roughly when
   it was last touched, which is the exact leak useWillsAccess was built to
   stop. These four are the ones that would matter if they were wrong. */
check('the will is admin-tier, like the document', visibilityFor('willsEstate') === 'admin');
check('so is who may open it',                     visibilityFor('willsAccess') === 'admin');
check('passwords too',                             visibilityFor('passwords') === 'admin');
check('finances is adults, matching its adults-only rule',
  visibilityFor('finances') === 'adults');
check('ordinary family things are visible to everyone',
  visibilityFor('assets') === 'all' && visibilityFor('recipes') === 'all');

/* A profile is family news in a household and an HR file at work — the same
   split v330 made in the rules, given the same answer here. */
check('a profile edit is family news in a household', visibilityFor('members', false) === 'all');
check('and an HR matter in a business',               visibilityFor('members', true) === 'admin');

/* Fail CLOSED. A kind somebody adds and forgets to classify must reach the
   fewest people, not the most. */
check('an unclassified kind is admin, not all', visibilityFor('somethingNew') === 'admin');
check('and is not logged at all',
  !isLoggableKind('somethingNew') && isLoggableKind('finances'));

/* ── what each role may ask Firestore for ────────────────────────────────── */

check('an admin may ask for everything',
  visibilitiesFor('admin').join() === 'all,adults,admin');
check('a member for two tiers', visibilitiesFor('member').join() === 'all,adults');
check('a child for one',        visibilitiesFor('child').join() === 'all');
check('an unknown role is treated as a member, never as an admin',
  !visibilitiesFor(undefined).includes('admin') && !visibilitiesFor(null).includes('admin'));

/* ── the sentences ───────────────────────────────────────────────────────── */

check('a named profile reads as a sentence',
  activityLabel({ kind: 'members', action: 'updated', what: 'Anna' }) === "Anna's profile was updated");
check('an unnamed document takes its own verb',
  activityLabel({ kind: 'finances', action: 'updated' }) === 'Finances were updated');
check('and a singular one takes the other',
  activityLabel({ kind: 'willsEstate', action: 'updated' }) === 'Wills & estate was updated');
check('added and removed are said plainly',
  activityLabel({ kind: 'assets', action: 'added', what: 'The car' }) === 'The car was added'
  && activityLabel({ kind: 'assets', action: 'removed', what: 'The car' }) === 'The car was removed');
check('an unknown kind still produces a sentence rather than undefined',
  activityLabel({ kind: 'mystery', action: 'updated' }) === 'Something was updated');

/* ── one edit is one line ────────────────────────────────────────────────── */

/* A screen with eight fields autosaves eight times. A trail that records all
   eight is a trail nobody reads. */
const T0 = 1_700_000_000_000;
check('the same edit twice in a minute is logged once',
  shouldLog('members|Anna|updated', {}, T0)
  && !shouldLog('members|Anna|updated', { 'members|Anna|updated': T0 }, T0 + 60_000));
check('but a genuinely later visit is logged',
  shouldLog('members|Anna|updated', { 'members|Anna|updated': T0 }, T0 + DEDUPE_WINDOW_MS + 1));
check('a different thing is never suppressed by the first',
  shouldLog('members|Bo|updated', { 'members|Anna|updated': T0 }, T0 + 1000));
check('rubbish in the local record does not suppress a real entry',
  shouldLog('x', { x: NaN as unknown as number }, T0)
  && shouldLog('x', { x: 'yesterday' as unknown as number }, T0));

/* ── ordering and retention ──────────────────────────────────────────────── */

const mk = (id: string, at: string): ActivityEntry =>
  ({ id, at, actorUid: 'u', actorName: 'A', kind: 'assets', action: 'added', visibility: 'all' });
check('newest first',
  orderActivity([mk('a', '2026-01-01T00:00:00Z'), mk('b', '2026-06-01T00:00:00Z')])
    .map((e) => e.id).join() === 'b,a');
check('and capped',
  orderActivity([mk('a', '2026-01-01T00:00:00Z'), mk('b', '2026-06-01T00:00:00Z')], 1).length === 1);
check('an entry with no timestamp is dropped, not sorted arbitrarily',
  orderActivity([mk('a', '2026-01-01T00:00:00Z'), { ...mk('b', ''), at: undefined as unknown as string }]).length === 1);

check('the cutoff is the retention window back from now',
  retentionCutoffISO(new Date('2026-08-29T00:00:00Z'))
  === new Date(Date.parse('2026-08-29T00:00:00Z') - ACTIVITY_RETENTION_DAYS * 86400000).toISOString());

/* The number the cron enforces and the number this module states must agree,
   for the same reason RELEASE_WAIT_DAYS is pinned to its server constant. */
const cronDays = /const ACTIVITY_RETENTION_DAYS = (\d+);/.exec(serverJs);
check('the cron prunes on the same window this file documents',
  !!cronDays && Number(cronDays[1]) === ACTIVITY_RETENTION_DAYS);

/* ── the list contract, which is the part that breaks silently ───────────── */

/* firestore.rules gates each entry on its own visibility, and Firestore fails
   a WHOLE query when one returned document fails — so an unfiltered list gives
   a non-admin NOTHING, not a filtered subset. The client's `where in` is not
   defensive tidiness; it is the only reason the query is legal. */
check('the rule is per-document, on the entry’s own visibility',
  /resource\.data\.get\('visibility', 'admin'\) == 'all'/.test(rules));
check('the client asks for exactly the tiers its role may read',
  /where\('visibility', 'in', visibilitiesFor\(role\)\)/.test(db));
check('and an admin skips the filter rather than guessing a tier list',
  /role === 'admin'\s*\n\s*\? await getDocs\(col\)/.test(db));
check('the emulator proves BOTH halves of that contract',
  /listing the trail unfiltered is refused everything/.test(emulator)
  && /the tier-filtered query a member actually sends succeeds/.test(emulator));

/* ── integrity: what the rules do and do not promise ─────────────────────── */

check('an entry cannot lie about who made it',
  /request\.resource\.data\.actorUid == request\.auth\.uid/.test(rules)
  && /cannot be written under somebody else/.test(emulator));
check('and cannot be rewritten afterwards, by anyone',
  /allow update: if false;/.test(rules.slice(rules.indexOf('match /activity/')))
  && /nor can an admin edit one/.test(emulator));
check('the file says plainly that this is not an audit log',
  /not an audit log/.test(readFileSync(join(root, 'src/utils/activity.ts'), 'utf8')));

/* ── the trail must never fail the work it describes ─────────────────────── */

check('recording is fire-and-forget, never awaited into a save path',
  /export function recordActivity\(/.test(db) && /void \(async \(\) => \{/.test(db));
check('and every failure is swallowed',
  /\/\* Swallowed on purpose/.test(db));
check('a save that changed nothing is not news',
  /if \(changed\) recordActivity\(key, existed \? 'updated' : 'added'\);/.test(db));
check('and the entry is written outside the transaction, so a retry cannot double-log',
  db.indexOf('let written: { name: string; isNew: boolean }[] = [];') > 0
  && /for \(const w of written\) \{/.test(db));

/* NO VALUES, EVER. The entry records that a thing changed, never what to. */
check('a password entry is deliberately unnamed',
  /recordActivity\('passwords', 'updated'\);/.test(db)
  && !/recordActivity\('passwords', 'updated', /.test(db));
check('and so is the will access list',
  /recordActivity\('willsAccess', 'updated'\);/.test(db));

/* ── "what happened while I was away" needs minutes, not days ────────────── */

const NOW = new Date('2026-08-29T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
check('under a minute reads as just now', timeAgo(ago(30_000), NOW) === 'just now');
check('minutes and hours are counted',
  timeAgo(ago(20 * 60_000), NOW) === '20 minutes ago'
  && timeAgo(ago(3 * 3_600_000), NOW) === '3 hours ago');
check('singular is singular',
  timeAgo(ago(61_000), NOW) === '1 minute ago'
  && timeAgo(ago(3_600_000), NOW) === '1 hour ago');
check('yesterday is a word, not a number', timeAgo(ago(26 * 3_600_000), NOW) === 'yesterday');
check('and past a week it becomes a date rather than counting weeks',
  /\d/.test(timeAgo(ago(20 * 86_400_000), NOW))
  && !/ago/.test(timeAgo(ago(20 * 86_400_000), NOW)));
/* A device clock slightly ahead of the server must not report the future. */
check('a clock skewed forward does not produce "in 3 minutes"',
  timeAgo(new Date(NOW.getTime() + 180_000).toISOString(), NOW) === 'just now');
check('and rubbish gives nothing rather than "Invalid Date"', timeAgo('not a time', NOW) === '');

/* ── THE AI KNOWS THE CARD EXISTS ────────────────────────────────────────── */

/* BUG CLASS (project_teluva_ai_blindspots): a feature the system prompt never
   names does not exist as far as the assistant is concerned — asked "what did I
   miss", it invents an answer or says the app cannot do that, while the card is
   on screen behind the chat. */
const promptStart = serverJs.indexOf('const SYSTEM_INSTRUCTION = `');
const prompt = serverJs.slice(promptStart, serverJs.indexOf('`;', promptStart));
check('the assistant is told the card exists and what it is called',
  /RECENTLY CHANGED is a card on the home screen/.test(prompt));
check('and told to answer the news-feed question with it, not to apologise for a missing feed',
  /is NOT a social feed/.test(prompt) && /what did I miss/.test(prompt));
check('it is warned the list is per-person, so a short list is not a bug',
  /a shorter list is not a fault/.test(prompt));
check('it must never call it an audit log',
  /never be described as one/.test(prompt));
check('and it is told it cannot read the trail, so it never claims to have checked',
  /You cannot read, write or search it/.test(prompt));

/* ── THE RETENTION NUMBER, AND WHERE ITS DECLARATION MUST SIT ────────────── */

/* The prompt interpolates the constant rather than repeating "60", so the two
   cannot drift. That is only safe while the declaration sits ABOVE the prompt:
   SYSTEM_INSTRUCTION is a module-level template literal, so a `const` declared
   further down the file is in the temporal dead zone when the prompt is built
   and the process dies on boot with a ReferenceError. `node --check` passes
   happily — it is a syntactically perfect crash — and the only thing that
   catches it is starting the server. This assertion is that start. */
const declIdx = serverJs.indexOf('const ACTIVITY_RETENTION_DAYS =');
const promptIdx = promptStart;
check('the server declares the retention constant', declIdx > 0);
check('ABOVE the prompt that interpolates it, or the server never boots',
  declIdx < promptIdx);
check('the prompt says the number by reference, never as a second literal',
  /It keeps \$\{ACTIVITY_RETENTION_DAYS\} days/.test(prompt));
check('and the number the server keeps is the number the app says',
  Number(/const ACTIVITY_RETENTION_DAYS = (\d+);/.exec(serverJs)?.[1]) === ACTIVITY_RETENTION_DAYS);

/* The pruner is the thing that makes the promise true. A retention period
   nothing enforces is a sentence in a prompt. */
check('something actually deletes past the cutoff',
  /async function pruneActivity/.test(serverJs)
  && /ACTIVITY_RETENTION_DAYS/.test(serverJs.slice(serverJs.indexOf('async function pruneActivity'))));
check('and the prune runs on the schedule, not only when someone asks',
  /activityPruned \+= await pruneActivity\(familyRef\);/.test(serverJs));

/* ── THE CARD ON SCREEN ──────────────────────────────────────────────────── */

const card = readFileSync(join(root, 'src/components/RecentActivity.tsx'), 'utf8');
const dash = readFileSync(join(root, 'src/components/Dashboard.tsx'), 'utf8');

check('the card is actually mounted on the home screen', /<RecentActivity \/>/.test(dash));
check('and not in the demo space, where the entries would be invented',
  /\{!demo && <RecentActivity \/>\}/.test(dash));

/* The tier is per-person. A card that loaded the trail without a role would
   either show a child the will entries or show an admin a child's view. */
check('the card asks for the trail as the person looking at it',
  /const \{ role \} = useFamilyCtx\(\)/.test(card) && /loadActivity\(role\)/.test(card));
check('and re-asks when the role changes rather than caching the first answer',
  /\}, \[role\]\);/.test(card));

/* An empty card on a brand-new vault is the first thing a family would see,
   and it would say nothing. */
check('nothing to show means no card at all',
  /if \(!entries \|\| entries\.length === 0\) return null;/.test(card));
check('a failed load is empty, not an error box',
  /\.catch\(\(\) => \{ if \(!cancelled\) setEntries\(\[\]\); \}\)/.test(card));

/* THE FOOTER IS A PROMISE, and the promise has to be one the code keeps.
   Entries are written by the client, so a modified client can omit them —
   which is exactly what an audit log may not do. The rules guarantee two
   narrower things: an entry cannot lie about who wrote it (actorUid ==
   auth.uid on create) and cannot be changed afterwards (update: if false). */
check('the footer claims only what the rules enforce',
  /nobody &mdash; not even an owner &mdash; can edit this list afterwards/.test(card));
check('and says the list is bounded by what you can open',
  /You only see entries for things you can open/.test(card));
check('the word "audit" appears nowhere on the card',
  !/audit/i.test(card.replace(/\/\*[\s\S]*?\*\//g, '')));
check('nor any claim of completeness',
  !/every change/i.test(card) && !/complete record/i.test(card));

/* The two guarantees the footer rests on, checked at their source. */
check('an entry cannot be written under somebody else\'s name',
  /request\.resource\.data\.actorUid == request\.auth\.uid/.test(rules));
check('and cannot be edited once written, by anyone',
  /match \/activity\/\{entryId\}[\s\S]*?allow update: if false;/.test(rules));

/* Who and when, not what it became. */
check('each row names the person and how long ago',
  /\{e\.actorName\} · \{timeAgo\(e\.at\)\}/.test(card));

/* ── THE FLOOR IN THE RULES MATCHES THE MAP ON THE PHONE ─────────────────── */

/* The rules cannot read KINDS, so the sensitive kinds are listed there by hand.
   A kind promoted to a tighter tier in this file and forgotten there is a hole
   that opens silently — the client keeps labelling it correctly, and only a
   modified client discovers the floor was never raised. This reads both. */
const floorList = (tier: string) => {
  const m = new RegExp(`in \\[([^\\]]*)\\]\\)\\s*\\n\\s*\\|\\| request\\.resource\\.data\\.visibility (?:==|in) (?:'admin'|\\['adults', 'admin'\\])`, 'g');
  const out: string[][] = [];
  let x: RegExpExecArray | null;
  while ((x = m.exec(rules))) out.push(x[1].split(',').map((k) => k.trim().replace(/'/g, '')));
  return out[tier === 'admin' ? 0 : 1] ?? [];
};
const kindsAt = (tier: string) =>
  ['members', 'calendar', 'household', 'info', 'assets', 'recipes', 'shopping',
   'familyWords', 'timeline', 'travelTimeline', 'anniversaries', 'extendedBirthdays',
   'familyTree', 'inMemory', 'slips', 'businessMilestones', 'settings',
   'finances', 'documents', 'willsEstate', 'willsAccess', 'passwords']
    .filter((k) => visibilityFor(k) === tier).sort();

check('every admin-tier kind is named in the rules floor',
  JSON.stringify(floorList('admin').slice().sort()) === JSON.stringify(kindsAt('admin')));
check('and every adults-tier kind is too',
  JSON.stringify(floorList('adults').slice().sort()) === JSON.stringify(kindsAt('adults')));
check('the floor refuses wider, not narrower',
  /an ordinary kind may be labelled NARROWER than its tier/.test(emulator));
check('and the emulator proves the widening attack is refused',
  /a passwords entry cannot be labelled readable by everyone/.test(emulator));

console.log(`activity.test.ts: ${n} assertions passed.`);
