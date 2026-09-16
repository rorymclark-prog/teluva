/**
 * What changed in the vault, and who changed it.
 *
 * WHY THIS AND NOT A NEWS FEED
 *
 * Rory asked whether there was a Facebook-style family feed. There is not, and
 * building one would work against what this app is for: a vault's promise is
 * "the real things are kept here", and a page you check for entertainment puts
 * a photo of the dog in competition with the will. FamilyPulse is deliberately
 * forward-looking — birthdays coming, documents expiring — and nothing recorded
 * what had actually happened.
 *
 * This is the version worth having. It answers "what changed while I was away",
 * which is the genuinely useful half of a feed, and it doubles as a security
 * surface: an entry nobody recognises is how you find out something is wrong.
 * A social feed can never do that second job.
 *
 * WHAT IT IS NOT
 *
 * It is not an audit log and must not be sold as one. Entries are written by
 * the client, so a modified client could omit them. What the rules DO
 * guarantee is that an entry cannot lie about who made it (actorUid is pinned
 * to the caller) and cannot be edited afterwards (create-only). Omission is
 * possible; forgery and rewriting are not. The screen says "changes made in
 * the app" for exactly this reason.
 *
 * NO VALUES, EVER. An entry records that a thing changed, never what it
 * changed to. "Finances updated", never the IBAN. This is the rule that keeps
 * a trail readable by more people than the document it describes.
 */

/** How long an entry lives. Mirrored in server.js's cron — see the parity test. */
export const ACTIVITY_RETENTION_DAYS = 60;

/** Most entries anybody is shown at once. The card shows far fewer. */
export const ACTIVITY_PAGE = 50;

/**
 * Who may see an entry, in the app's three real roles.
 *
 * NOT a fourth permission system: 'all' is isMemberOf, 'adults' is canWriteIn
 * (member or admin, never a child), 'admin' is isAdminOf. Each one maps to a
 * predicate that already exists in firestore.rules, which is what makes the
 * rule short enough to be obviously right.
 */
export type ActivityVisibility = 'all' | 'adults' | 'admin';

export interface ActivityEntry {
  id: string;
  /** ISO timestamp. Sorted on client-side — see loadActivity for why. */
  at: string;
  actorUid: string;
  actorName: string;
  kind: string;
  action: 'added' | 'updated' | 'removed';
  /** The thing, named. A person's first name, a document title. NEVER a value. */
  what?: string;
  visibility: ActivityVisibility;
}

interface KindSpec {
  /** Sentence noun — "Finances", "The will". */
  noun: string;
  /** Which verb the noun takes. Stated, not derived: "Belongings were" but
   *  "Wills & estate was", and no rule about trailing s gets both right. */
  verb: 'was' | 'were';
  visibility: ActivityVisibility;
}

/**
 * Every kind, with who may read about it.
 *
 * THE VISIBILITY HERE MUST NEVER BE WIDER THAN THE DOCUMENT IT DESCRIBES.
 * An entry saying "the will was updated" is a smaller disclosure than the will,
 * but it is not nothing: it tells a locked-out reader the will exists and when
 * it was last touched, which is precisely the leak useWillsAccess was written
 * to prevent. So wills and passwords are admin, matching their rules exactly;
 * finances is adults, matching its adults-only rule.
 */
const KINDS: Record<string, KindSpec> = {
  members:        { noun: 'A profile',            verb: 'was', visibility: 'all' },
  calendar:       { noun: 'The calendar',         verb: 'was', visibility: 'all' },
  household:      { noun: 'Household details',    verb: 'were', visibility: 'all' },
  info:           { noun: 'Contacts',             verb: 'were', visibility: 'all' },
  assets:         { noun: 'Belongings',           verb: 'were', visibility: 'all' },
  recipes:        { noun: 'Recipes',              verb: 'were', visibility: 'all' },
  shopping:       { noun: 'The shopping list',    verb: 'was', visibility: 'all' },
  familyWords:    { noun: 'Family words',         verb: 'were', visibility: 'all' },
  timeline:       { noun: 'The timeline',         verb: 'was', visibility: 'all' },
  travelTimeline: { noun: 'Travel history',       verb: 'was', visibility: 'all' },
  anniversaries:  { noun: 'Anniversaries',        verb: 'were', visibility: 'all' },
  extendedBirthdays: { noun: 'Extended birthdays', verb: 'were', visibility: 'all' },
  familyTree:     { noun: 'The family tree',      verb: 'was', visibility: 'all' },
  inMemory:       { noun: 'In memory',            verb: 'was', visibility: 'all' },
  slips:          { noun: 'Receipts',             verb: 'were', visibility: 'all' },
  businessMilestones: { noun: 'Milestones',       verb: 'were', visibility: 'all' },
  settings:       { noun: 'Settings',             verb: 'were', visibility: 'all' },
  // Adults only, matching reference/finances and the vault's own eligibility.
  finances:       { noun: 'Finances',             verb: 'were', visibility: 'adults' },
  documents:      { noun: 'The document vault',   verb: 'was', visibility: 'adults' },
  // Admin only, matching their rules exactly. See the block comment above.
  willsEstate:    { noun: 'Wills & estate',       verb: 'was', visibility: 'admin' },
  willsAccess:    { noun: 'Who can open the will', verb: 'was', visibility: 'admin' },
  passwords:      { noun: 'Saved passwords',      verb: 'were', visibility: 'admin' },
};

/** Is this a kind we log at all? Anything unknown is dropped, not guessed. */
export function isLoggableKind(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(KINDS, kind);
}

/**
 * Who may read about a change of this kind.
 *
 * `businessSpace` exists for ONE case: a member record. In a household a
 * profile is shared and "Dad updated Leo's profile" is ordinary family news.
 * In a business the same record is an HR file (v330), so an entry naming a
 * colleague and what was touched goes to admins only — the same answer the
 * rules give for the record itself.
 *
 * An unknown kind gets 'admin', which is the fail-closed direction: a new kind
 * somebody forgot to classify is shown to the fewest people, not the most.
 */
export function visibilityFor(kind: string, businessSpace = false): ActivityVisibility {
  if (kind === 'members' && businessSpace) return 'admin';
  return KINDS[kind]?.visibility ?? 'admin';
}

/** "Leo's profile was updated" / "Finances were updated". */
export function activityLabel(entry: Pick<ActivityEntry, 'kind' | 'action' | 'what'>): string {
  const spec = KINDS[entry.kind];
  const verb = entry.action === 'added' ? 'added' : entry.action === 'removed' ? 'removed' : 'updated';
  if (entry.kind === 'members' && entry.what) return `${entry.what}'s profile was ${verb}`;
  if (entry.what) return `${entry.what} was ${verb}`;
  if (!spec) return `Something was ${verb}`;
  return `${spec.noun} ${spec.verb} ${verb}`;
}

/** What the reader's role lets them ask Firestore for. */
export function visibilitiesFor(role: string | null | undefined): ActivityVisibility[] {
  if (role === 'admin') return ['all', 'adults', 'admin'];
  if (role === 'child') return ['all'];
  return ['all', 'adults'];
}

/**
 * Should this change be written down, or is it the same edit again?
 *
 * Saving a profile is not one act — a screen with eight fields autosaves eight
 * times, and a trail that records all eight is a trail nobody reads. So an
 * identical kind+what inside the window collapses into the first entry.
 *
 * The window is deliberately short. An hour would hide a genuinely separate
 * visit; a minute would let one edit session through as five lines.
 */
export const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

export function shouldLog(
  signature: string,
  lastSeen: Record<string, number>,
  now: number = Date.now(),
): boolean {
  const prev = lastSeen[signature];
  return !(typeof prev === 'number' && Number.isFinite(prev) && now - prev < DEDUPE_WINDOW_MS);
}

/** Newest first, capped. Sorted here rather than in the query — see loadActivity. */
export function orderActivity(entries: ActivityEntry[], limit = ACTIVITY_PAGE): ActivityEntry[] {
  return [...entries]
    .filter((e) => e && typeof e.at === 'string')
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}

/** Anything older than this is deleted by the cron. */
export function retentionCutoffISO(now: Date = new Date()): string {
  return new Date(now.getTime() - ACTIVITY_RETENTION_DAYS * 86400000).toISOString();
}

/**
 * "just now" / "20 minutes ago" / "yesterday" / "12 August".
 *
 * Minutes and hours matter here in a way they never do on the rest of this
 * app's date surfaces — the whole question a trail answers is "what happened
 * while I was away", and "today" is not an answer to that. Past a week the
 * clock stops being interesting and the date is more useful than a count of
 * weeks, so it switches rather than carrying on counting.
 */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const secs = Math.round((now.getTime() - t) / 1000);
  // A device clock a little ahead of the server must not produce "in 3 minutes".
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}
