// Server port of src/utils/hiddenPeople.ts — people whose dates a family has
// chosen not to see. Read that file's header first; this one only says what is
// different on the server.
//
// WHO USES IT. The published .ics feed (/cal/:token in server.js) and the
// daily birthday/anniversary reminders (runDailyCelebrations). The server
// cannot import a .ts module, so the rules are carried here a second time,
// and src/utils/hiddenPeopleParity.test.ts runs the same fixtures through
// both and fails if they ever answer differently. Change one, change both.
//
// WHOSE LIST. On the server there is no "me" looking at the screen, so each
// caller says whose personal list counts:
//   * the published feed: the family's list plus the personal list of the
//     account that CREATED the link (calendarPublications/{token}.createdBy).
//     A link is that person's own calendar handed to their phone, so it
//     should look like their calendar in the app does. Anyone else's private
//     list stays theirs; the family list applies to every link.
//   * reminders: the family list decides what is sent at all; each person's
//     own list is then honoured per device (a push to a subscription whose
//     uid has hidden that person is skipped).
//
// HIDDEN FROM CHOSEN ACCOUNTS (reference/settings `hiddenDatePeopleFor`, an
// admin's "hide Nora from Papa, leave her for the boys"). Each entry counts
// only for the accounts in its `forUids`, never for the family as a whole:
//   * the published feed: entries that name the link's creator — the same
//     "a link is its creator's own calendar" rule as their personal list;
//   * reminders: entries join the per-uid sets (byUid), so they skip the
//     named accounts' devices and nobody else's. They must NEVER reach the
//     family set, which decides whether a celebration is sent at all — that
//     would take Nora's birthday off the boys' phones too.
// A missing or malformed field is an empty list: the date is shown.

export const BIRTHDAY_KEYWORDS = [
  'birthday', 'birthdays', 'bday', 'b-day', "b'day", 'birthday party',
  'name day', 'nameday', 'name-day',
  'geburtstag', 'geburtstage', 'geburtstagsfeier', 'geburtstagsparty',
  'geburtstagsfest', 'geburtstagsessen', 'namenstag',
];

// Same list, same order, as ANNIVERSARY_KEYWORDS in eventKeywordFlags.ts.
export const ANNIVERSARY_KEYWORDS = [
  'anniversary', 'wedding anniversary', 'dating anniversary',
  'engagement anniversary', 'our anniversary', 'engaged', 'valentine',
  'valentines', 'valentinstag', "mother's day", 'mothers day', 'muttertag',
  "father's day", 'fathers day', 'vatertag', "new year's eve",
  'new years eve', 'nye', 'jahrestag', 'hochzeitstag',
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMatcher(keywords) {
  const pattern = keywords.map((k) => escapeRegExp(k).replace(/\s+/g, '\\s+')).join('|');
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`, 'iu');
  return (text) => !!text && re.test(text);
}

const birthdayMatcher = buildMatcher(BIRTHDAY_KEYWORDS);
const anniversaryMatcher = buildMatcher(ANNIVERSARY_KEYWORDS);

export const hiddenKey = {
  member: (id) => `member:${id}`,
  extended: (id) => `extended:${id}`,
  pet: (id) => `pet:${id}`,
  linked: (linkId, personId) => `linked:${linkId}:${personId}`,
};

export const NO_HIDDEN_PEOPLE = Object.freeze({ keys: new Set(), names: [], matchers: [] });

export function normalizeName(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const HONORIFICS = new Set([
  'aunt', 'auntie', 'aunty', 'uncle', 'grandma', 'granny', 'grandpa', 'grandad',
  'granddad', 'grandmother', 'grandfather', 'nana', 'nan', 'oma', 'opa', 'omi',
  'opi', 'tante', 'onkel', 'cousin', 'cousine', 'mr', 'mrs', 'ms', 'miss', 'dr',
  'frau', 'herr', 'my', 'our',
]);

const AMBIGUOUS = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'summer', 'winter', 'spring', 'autumn', 'easter', 'noel',
]);

const MIN_NAME_LENGTH = 3;

export function candidateNames(name) {
  const full = normalizeName(name || '');
  if (!full) return [];
  const out = [];
  if (full.length >= MIN_NAME_LENGTH) out.push(full);
  const first = full.split(' ').find((t) => !HONORIFICS.has(t.replace(/\.$/, '')));
  if (first && first !== full && first.length >= MIN_NAME_LENGTH) out.push(first);
  return out;
}

const B = '[^\\p{L}\\p{N}_]';
const NB = '(?![\\p{L}\\p{N}_])';

function compile(name) {
  const e = escapeRegExp(name).replace(/ /g, '\\s+');
  return { name, re: new RegExp(`(?:^|${B})${e}s?${NB}`, 'u'), ambiguous: AMBIGUOUS.has(name) };
}

function matcherHits(m, title) {
  if (!m.re.test(title)) return false;
  if (!m.ambiguous) return true;
  const e = escapeRegExp(m.name);
  return (
    new RegExp(`^\\s*${e}\\s*[-–—:,&]`, 'u').test(title) ||
    new RegExp(`${e}'?s${NB}`, 'u').test(title) ||
    new RegExp(`(?:^|${B})(?:for|with|fur)\\s+${e}${NB}`, 'u').test(title)
  );
}

/** lists: arrays of { id, name } (a Firestore read may hand back anything — junk is skipped). */
export function buildHiddenPeople(lists, current = {}) {
  const keys = new Set();
  const rawNames = [];
  for (const list of lists || []) {
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      if (!p || typeof p.id !== 'string' || !p.id) continue;
      keys.add(p.id);
      if (typeof p.name === 'string' && p.name) rawNames.push(p.name);
    }
  }
  if (!keys.size) return NO_HIDDEN_PEOPLE;
  const lookup = (prefix, recs) => {
    for (const r of Array.isArray(recs) ? recs : []) {
      if (r && keys.has(`${prefix}:${r.id}`) && typeof r.name === 'string' && r.name) rawNames.push(r.name);
    }
  };
  lookup('member', current.members);
  lookup('extended', current.extendedBirthdays);
  lookup('pet', current.pets);
  const names = [...new Set(rawNames.flatMap(candidateNames))];
  return { keys, names, matchers: names.map(compile) };
}

/** Port of cleanForUids: strings only, no blanks, no repeats. */
export function cleanForUids(uids) {
  if (!Array.isArray(uids)) return [];
  const out = [];
  for (const u of uids) if (typeof u === 'string' && u && !out.includes(u)) out.push(u);
  return out;
}

/** Port of hiddenForAccount: the `hiddenDatePeopleFor` entries that name `uid`, as plain { id, name } entries. */
export function hiddenForAccount(list, uid) {
  if (!uid || !Array.isArray(list)) return [];
  const out = [];
  for (const e of list) {
    if (!e || typeof e.id !== 'string' || !e.id) continue;
    if (!cleanForUids(e.forUids).includes(uid)) continue;
    out.push({ id: e.id, name: typeof e.name === 'string' ? e.name : '', hiddenAt: e.hiddenAt, ...(e.by ? { by: e.by } : {}) });
  }
  return out;
}

/** Port of accountHiddenLists: an account's own list, the family's, and the chosen-accounts entries that name it. */
export function accountHiddenLists({ personal, family, forSome, uid }) {
  return [personal || undefined, family || undefined, hiddenForAccount(forSome, uid)];
}

export function titleNamesHiddenPerson(title, hp) {
  if (!title || !hp.matchers.length) return false;
  const t = normalizeName(title);
  return hp.matchers.some((m) => matcherHits(m, t));
}

export function visibleDateMembers(members, hp) {
  if (!hp.keys.size) return members;
  return members.filter((m) => !hp.keys.has(hiddenKey.member(m.id)));
}

export function visibleExtendedBirthdays(list, hp) {
  if (!hp.keys.size) return list;
  return list.filter((e) => !hp.keys.has(hiddenKey.extended(e.id)));
}

export function anniversaryIsHidden(rec, hp) {
  if (!hp.keys.size) return false;
  if ((rec.memberIds || []).some((id) => hp.keys.has(hiddenKey.member(id)))) return true;
  return titleNamesHiddenPerson(rec.title, hp);
}

export function visibleAnniversaries(list, hp) {
  if (!hp.keys.size) return list;
  return list.filter((a) => !anniversaryIsHidden(a, hp));
}

export function eventIsHiddenDate(ev, hp) {
  if (!hp.keys.size) return false;
  const title = ev.title || '';
  const birthday = birthdayMatcher(title);
  const anniversary = anniversaryMatcher(title);
  if (!birthday && !anniversary) return false;
  if (titleNamesHiddenPerson(title, hp)) return true;
  const tags = Array.isArray(ev.memberIds) ? ev.memberIds : [];
  const hiddenTags = tags.filter((id) => hp.keys.has(hiddenKey.member(id)));
  if (anniversary && hiddenTags.length > 0) return true;
  return birthday && tags.length > 0 && hiddenTags.length === tags.length;
}

export function visibleEvents(events, hp) {
  if (!hp.keys.size) return events;
  return events.filter((e) => !eventIsHiddenDate(e, hp));
}

/**
 * The feed's occasion sources (server.js readFamilyOccasionSources) with every
 * hidden person's dates taken out. Returns a new object; the input is not
 * touched.
 */
export function hideOccasionSources(sources, hp) {
  if (!hp.keys.size) return sources;
  return {
    ...sources,
    members: visibleDateMembers(sources.members || [], hp),
    nameCelebrationMembers: visibleDateMembers(sources.nameCelebrationMembers || [], hp),
    extendedBirthdays: visibleExtendedBirthdays(sources.extendedBirthdays || [], hp),
    anniversaries: visibleAnniversaries(sources.anniversaries || [], hp),
  };
}


// --- The published feed -----------------------------------------------------

/**
 * Who the published feed leaves out: the family's list (reference/settings
 * `hiddenDatePeople`), the link owner's own list (prefs/{createdBy}
 * `hiddenDatePeople`) and every chosen-accounts entry (reference/settings
 * `hiddenDatePeopleFor`) that names the owner — see WHOSE LIST above. With no
 * usable owner uid the chosen-accounts entries count for nobody, exactly as
 * the owner's personal list is then not read. `sources` is the feed's
 * occasion sources when the link includes birthdays, so a person renamed
 * since they were hidden is still matched by their current name.
 */
export function feedHiddenPeople({ familyList, ownerList, forList = [], ownerUid = null }, sources = null) {
  return buildHiddenPeople(accountHiddenLists({ personal: ownerList, family: familyList, forSome: forList, uid: ownerUid }), {
    members: [...(sources?.members || []), ...(sources?.nameCelebrationMembers || [])],
    extendedBirthdays: sources?.extendedBirthdays || [],
  });
}

/**
 * The feed's two inputs with a hidden person's dates taken out: the typed
 * calendar entries that are their birthday or anniversary, and the derived
 * occasions. Nothing else about the feed changes.
 */
export function hideFromFeed({ events, occasionSources }, hp) {
  return {
    events: visibleEvents(events || [], hp),
    occasionSources: occasionSources ? hideOccasionSources(occasionSources, hp) : occasionSources,
  };
}

/** A uid is only ever used as one path segment. Anything else reads no personal list. */
export function safeOwnerUid(uid) {
  return typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : null;
}

// --- Daily reminders (runDailyCelebrations) ---------------------------------

/**
 * The family's hidden set, plus one per account that has anything hidden
 * just for it: its personal list (prefs/{uid}) and the chosen-accounts
 * entries (reference/settings `hiddenDatePeopleFor`) that name it. `family`
 * is built from the family list ALONE — it decides whether a celebration is
 * sent at all, and a chosen-accounts entry must only ever skip the devices of
 * the accounts it names. `byUid` only holds accounts with somebody hidden.
 */
export function remindersHiddenPeople({ familyList, forList = [], prefs = [], members = [], extendedBirthdays = [] }) {
  const current = { members, extendedBirthdays };
  const family = buildHiddenPeople([familyList], current);
  const personalByUid = new Map();
  for (const p of Array.isArray(prefs) ? prefs : []) {
    if (!p || typeof p.uid !== 'string' || !p.uid) continue;
    personalByUid.set(p.uid, p.hiddenDatePeople);
  }
  const uids = new Set(personalByUid.keys());
  for (const e of Array.isArray(forList) ? forList : []) for (const u of cleanForUids(e && e.forUids)) uids.add(u);
  const byUid = new Map();
  for (const uid of uids) {
    const hp = buildHiddenPeople([personalByUid.get(uid), hiddenForAccount(forList, uid)], current);
    if (hp.keys.size) byUid.set(uid, hp);
  }
  return { family, byUid };
}

/**
 * Is this morning's celebration one of a hidden person's dates? The cron sets
 * `memberId` on a member's birthday, name day and name celebration; the rest
 * are told apart by the key server/yearlyCelebrations.mjs gives them:
 *   extbday-<id>      → extended:<id>
 *   contactbday-<id>  → extended:contact-<id> (the id the app gives it)
 *   annivrec-<id>     → hidden when that anniversary involves a hidden person.
 * A business anniversary belongs to nobody and is never hidden.
 */
export function celebrationIsHidden(c, hp, anniversaries = []) {
  if (!c || !hp || !hp.keys.size) return false;
  if (c.memberId) return hp.keys.has(hiddenKey.member(c.memberId));
  const key = String(c.key || '');
  if (key.startsWith('extbday-')) return hp.keys.has(hiddenKey.extended(key.slice('extbday-'.length)));
  if (key.startsWith('contactbday-')) return hp.keys.has(hiddenKey.extended(`contact-${key.slice('contactbday-'.length)}`));
  if (key.startsWith('annivrec-')) {
    const id = key.slice('annivrec-'.length);
    const rec = (anniversaries || []).find((a) => a && a.id === id);
    return rec ? anniversaryIsHidden(rec, hp) : false;
  }
  return false;
}
