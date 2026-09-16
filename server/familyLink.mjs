/**
 * Linked families — what one household lets another household see.
 *
 * The whole feature rests on this file. Everything else (endpoints, UI) is
 * plumbing; this is the boundary. Two rules it exists to enforce:
 *
 *  1. SHARING IS AN ALLOWLIST, NEVER A BLOCKLIST. A FamilyMember carries
 *     passports, medical records, ID numbers, financial accounts and filed
 *     documents. If this projected "everything except X" then every field
 *     added to FamilyMember in future would be shared across households by
 *     default, and nobody would notice until it was already true.
 *  2. EVERY FIELD IS CLASSIFIED EXPLICITLY. MEMBER_FIELD_CLASSIFICATION names
 *     all of them, share and never-share alike, and familyLink.test.mjs reads
 *     src/types.ts and fails when FamilyMember grows a field this file has not
 *     been told about. A new field is a decision, not a default.
 *
 * There is no stored projection. /api/family-link/profiles reads the other
 * household's live member docs and projects them per request, so revoking a
 * link or un-sharing a person takes effect immediately and no copy of anyone's
 * data lives anywhere it can go stale or be forgotten.
 */

// Fields the OTHER household may see for a person explicitly shared with them.
// Deliberately small: this is "the aunt can see her nephew's name, face,
// birthday, sizes and wish list", not "the aunt has a second vault".
export const SHAREABLE_MEMBER_FIELDS = [
  'id',
  'name',
  'nickname',
  'role',
  'birthdate',
  'avatarColor',
  'avatarUrl',
  'avatarStyle',
  'clothingSizes',
  'favorites',
  // The care card — opt-in per person, per family, and NEVER in the default
  // set. See the 'care' category below for why these three are here at all.
  'medical',
  'emergencyContactName',
  'emergencyContactPhone',
  // What the names MEAN — the 'about' category. Etymology of a name that
  // already crosses; see below for why this one is a default and name days
  // are not.
  'nameMeanings',
  // What they are into — the 'interests' category. A nested object; the real
  // boundary is SHAREABLE_PREFERENCE_FIELDS.
  'preferences',
  // Name days and name celebrations — the 'celebrations' category, OPT-IN.
  'nameDay',
  'nameDayFeast',
  'nameCelebrations',
  'nameCelebrationResolvedDates',
];

// Everything else on FamilyMember, named so the coverage test can prove the
// two lists together account for the whole type. Grouped by why it is out.
export const NEVER_SHARE_MEMBER_FIELDS = [
  'addressHistory', // Former homes remain private to the originating household.
  // Identity documents and government numbers
  'passport', 'passports', 'identifiers', 'identity', 'taxNumber', 'nationality',
  // Health — special-category data under GDPR Art. 9. `medical` moved to the
  // share list for the 'care' category, but only five of its fields cross;
  // SHAREABLE_MEDICAL_FIELDS below is the real boundary.
  'referrals', 'careSchedule', 'growthHistory',
  // Money and accounts
  'financialAccounts', 'digitalAccounts',
  // Filed papers
  'documents', 'nonResidentGuardians',
  // Contact details and whereabouts — sharing a child's address or phone with
  // a second household is a different decision from sharing their shoe size,
  // and this feature is not how it gets made.
  'address', 'phone', 'email',
  'travel', 'placeOfBirth', 'birthHospital',
  // Exact birth data — the birth-chart inputs, not the birthday
  'birthTime', 'birthTimeZone', 'birthLatitude', 'birthLongitude', 'astrologyBlurb',
  // Work / school
  'employer', 'jobTitle', 'workPhone', 'workAddress', 'education', 'startDate',
  'cv', 'employeePreferences',
  // Household-internal bookkeeping and settings
  'linkedUid', 'spouse', 'isOnline', 'languages',
  /* `preferences` moved OUT of this list — see the 'interests' category and
     projectPreferences below. It is a nested object and only SOME of it
     crosses: dietaryRestrictions is carved out and rides with `care`. */
  /* nameDay, nameDayFeast, nameCelebrations, nameCelebrationResolvedDates and
     nameMeanings moved OUT of this list in v320 — see the 'about' and
     'celebrations' categories. These two stay: `nameCelebrationDismissed` and
     `noCelebrations` record that a family declined to keep a name day, which
     is a decision about their own household and not a fact about the person.
     A far side reading "they turned this off" learns something they were not
     offered and cannot act on. */
  'nameCelebrationDismissed', 'noCelebrations',
  // GENDER. It used to cross with the name, under "identity always crosses".
  // Nothing on the other side ever did anything with it — no label, no sizing
  // rule, no sort — so it was a demographic fact broadcast to every connected
  // household with no switch to turn it off, which is precisely the field
  // where that is least acceptable. Removed rather than made a toggle: a
  // toggle still asks somebody to defend the answer.
  'gender',
  // Keepsakes — the family's own memory, not a shared feed
  'sayings', 'favoriteQuotes', 'birthdayPhotos', 'timelapseGuide',
  'avatarOriginalUrl',
];

// Sub-allowlists. A shared object is projected field by field too, or the same
// blocklist-by-accident problem just moves one level down.
const SHAREABLE_SIZE_FIELDS = [
  'tops', 'bottoms', 'shoes', 'outerwear', 'hatValue', 'dressSize',
  'jacketSize', 'ringSize', 'heightCm', 'lastUpdated',
];
// `weightKg` is health-adjacent, `underwear` is nobody else's business, and
// `notes` is free text that can hold anything at all.
const NEVER_SHARE_SIZE_FIELDS = ['weightKg', 'underwear', 'notes'];

/**
 * THE CARE CARD. Rory: "if i am looking after my sisters kids i want to be
 * able to see emergency contact info like the baby sitter".
 *
 * This is the fridge note, not the medical file. The test is one question:
 * would a competent adult minding this child for an afternoon act on it? An
 * allergy, a rescue inhaler, a daily dose, a condition to mention at a
 * hospital desk, a blood group, and a number to ring. Everything else on
 * MedicalRecord fails that test and stays home.
 *
 * Deliberately OUT, each for its own reason rather than by omission:
 *  · vaccinations, surgeries, familyHistory — a medical history, not a
 *    handover. A sitter cannot act on any of it and an aunt does not need it.
 *  · organDonor — an end-of-life decision. It belongs to the person and to a
 *    hospital, and it has no business appearing on a cousin's phone.
 *  · preferredPharmacy, notes — free text that can hold literally anything,
 *    which is how the careful field next to it gets undone.
 *
 * Also out, and worth naming because it is the one that will get asked for:
 * the MEDICAL AID / INSURANCE NUMBER. It sits with passport and ID numbers on
 * `identity`, and the cost of it leaking is fraud, while the cost of not
 * having it is one phone call to the parent standing by their phone. If it
 * ever crosses it gets its own decision, not a ride on this one.
 */
/* ── WHAT A NAME MEANS ────────────────────────────────────────────────────
 * Rory: shared profiles "just boring at the moment" — they should carry the
 * star sign, the name day and what the name means.
 *
 * The STAR SIGN needs nothing here at all. It is a pure function of the
 * birthdate, which already crosses under the 'birthday' category, so the far
 * side computes it with the same utils/astrology.ts everybody else uses. That
 * also gates it correctly for free: no birthday shared, no sign shown, and no
 * second switch to explain.
 *
 * A NAME MEANING is stored, so it has to cross. Two things are stripped:
 * `source` (a citation the other household paid to research is theirs) and
 * `confirmed` (a projection only ever carries confirmed entries, so a flag
 * that is always true is noise a reader could get wrong). `confidence` is
 * MANDATORY and non-negotiable — types.ts says every surface rendering a
 * meaning must render the hedge beside it, because a derivation stated flat
 * is the app asserting folk etymology as fact about somebody's own family.
 */
const SHAREABLE_NAME_MEANING_FIELDS = [
  'token', 'role', 'meaning', 'origin', 'explanation', 'alsoKnown', 'confidence',
];
const NEVER_SHARE_NAME_MEANING_FIELDS = ['id', 'source', 'confirmed', 'key'];

export const NAME_MEANING_FIELD_CLASSIFICATION = {
  share: SHAREABLE_NAME_MEANING_FIELDS,
  never: NEVER_SHARE_NAME_MEANING_FIELDS,
};

const MEANING_TEXT_CAP = 600;
const MAX_MEANINGS = 8;

/** Only confirmed entries, capped, with the hedge intact. */
export function projectNameMeanings(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => m && typeof m === 'object' && m.confirmed === true)
    .filter((m) => typeof m.token === 'string' && m.token.trim()
      && typeof m.meaning === 'string' && m.meaning.trim())
    .slice(0, MAX_MEANINGS)
    .map((m) => {
      const out = pick(m, SHAREABLE_NAME_MEANING_FIELDS);
      for (const k of ['token', 'meaning', 'origin', 'explanation', 'alsoKnown']) {
        if (typeof out[k] === 'string') out[k] = out[k].slice(0, MEANING_TEXT_CAP);
      }
      // A missing or unknown confidence must not render as certainty.
      if (!['established', 'likely', 'contested'].includes(out.confidence)) out.confidence = 'likely';
      return out;
    });
}

/* A surname is held ONCE per space (FamilyInfo.surnameMeanings), not on each
 * member, so the far side would otherwise see "Leo — Sanskrit" and nothing
 * for Clark. Folded in per member here rather than projected as a household
 * block, so it stays gated by the SAME per-member switch as everything else:
 * a household sharing one child and not another must not have its surname
 * leak the second child's existence. The member's own entry wins for a token
 * they hold themselves, exactly as utils/nameMeanings.ts meaningsFor does. */
export function mergeNameMeanings(member, surnameMeanings) {
  const own = Array.isArray(member?.nameMeanings) ? member.nameMeanings : [];
  const shared = Array.isArray(surnameMeanings) ? surnameMeanings : [];
  if (!shared.length) return own;
  const key = (t) => String(t || '').trim().toLowerCase();
  const mine = new Set(own.map((m) => key(m && m.token)));
  const tokens = new Set(String(member?.name || '').split(/\s+/).map(key).filter(Boolean));
  const add = shared.filter((sm) => sm && tokens.has(key(sm.token)) && !mine.has(key(sm.token)));
  return [...own, ...add];
}

/* ── NAME DAYS ARE OPT-IN, AND THAT IS NOT AN OVERSIGHT ───────────────────
 * A name day names a feast: 'Hl. Josef', or a tradition field reading
 * 'Gaudiya Vaishnava / Hindu'. That is religious belief — special-category
 * data under GDPR Art. 9, the same article that keeps the medical fields
 * opt-in above. It does not become ordinary because it is warm and festive.
 *
 * So this is the second optIn category, for the same reason as the first: a
 * default here would have handed every already-connected household a reading
 * of what religion a child's family keeps, on deploy day, with nobody having
 * chosen anything. `nameMeanings` genuinely is ordinary by comparison — an
 * etymology of a name the other side already has — so it is a default.
 */
const SHAREABLE_CELEBRATION_FIELDS = [
  'id', 'kind', 'title', 'celebrationOf', 'matchType', 'tradition',
  'explanation', 'dateType', 'date', 'movableRule', 'resolvedDates',
  'primary',
];
const NEVER_SHARE_CELEBRATION_FIELDS = ['source', 'confirmed', 'notify'];

export const CELEBRATION_FIELD_CLASSIFICATION = {
  share: SHAREABLE_CELEBRATION_FIELDS,
  never: NEVER_SHARE_CELEBRATION_FIELDS,
};

const MAX_CELEBRATIONS = 12;

/** Confirmed celebrations only — an unconfirmed one is a proposal the family
 *  has not accepted, and proposing somebody else's religion is worse than
 *  saying nothing. `notify` is theirs: whether THEY get a reminder is not a
 *  fact about the person. */
export function projectCelebrations(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && typeof c === 'object' && c.confirmed === true)
    .filter((c) => typeof c.title === 'string' && c.title.trim())
    .slice(0, MAX_CELEBRATIONS)
    .map((c) => {
      const out = pick(c, SHAREABLE_CELEBRATION_FIELDS);
      for (const k of ['title', 'celebrationOf', 'tradition', 'explanation', 'movableRule']) {
        if (typeof out[k] === 'string') out[k] = out[k].slice(0, MEANING_TEXT_CAP);
      }
      return out;
    });
}

const SHAREABLE_MEDICAL_FIELDS = [
  'bloodGroup', 'allergies', 'emergencyMedication', 'medications', 'conditions',
];
const NEVER_SHARE_MEDICAL_FIELDS = [
  'vaccinations', 'surgeries', 'organDonor', 'familyHistory',
  'preferredPharmacy', 'notes',
];

/**
 * WHAT THEY LIKE — the gift question.
 *
 * Rory: "especially for families connected so they know what presents or
 * gifts to buy". Sizes answer what fits and the wish list answers what they
 * asked for; this answers the case those two miss, which is the ordinary one
 * — no list was written, and you want to buy something they will like.
 *
 * ONE FIELD IS CARVED OUT AND IT IS THE INTERESTING ONE. `dietaryRestrictions`
 * is not here. It reads like a preference and is not one: it holds "coeliac"
 * (health) or "halal", "kosher", "vegetarian for Ekadashi" (religion), both
 * special-category data under GDPR Art. 9 — the same reasoning that made name
 * days opt-in. So it does not ride in a default category. It travels with
 * `care` instead, which is opt-in and already carries allergies, and where the
 * reason to know it is the true one: you are feeding somebody's child, not
 * buying them a jumper.
 *
 * Everything else here is what you would happily say out loud at a birthday.
 */
const SHAREABLE_PREFERENCE_FIELDS = [
  'hobbies', 'sports', 'colorPreferences', 'clothingBrands',
  'favoriteBooks', 'favoriteMovies', 'favoriteGames', 'favoriteMusic',
  'favoriteMeals', 'dislikedFoods',
];
/** Carved out on purpose — see above. `dietaryRestrictions` is NOT "never
 *  shared"; it crosses under `care`, which is why it is named here rather
 *  than left unclassified. */
const CARE_ONLY_PREFERENCE_FIELDS = ['dietaryRestrictions'];

export const PREFERENCE_FIELD_CLASSIFICATION = {
  share: SHAREABLE_PREFERENCE_FIELDS,
  careOnly: CARE_ONLY_PREFERENCE_FIELDS,
};

/** Free text somebody typed for themselves, rendering on another household's
 *  phone. Capped per field for the same reason whatTheyShouldDo is. */
const PREFERENCE_TEXT_CAP = 400;

export function projectPreferences(prefs, fields) {
  if (!prefs || typeof prefs !== 'object') return {};
  const out = {};
  for (const f of fields) {
    const v = prefs[f];
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (trimmed) out[f] = trimmed.slice(0, PREFERENCE_TEXT_CAP);
  }
  return out;
}

const SHAREABLE_FAVORITE_FIELDS = [
  'id', 'title', 'category', 'imageUrl', 'isWishlist', 'targetPrice',
  'webLink', 'bought', 'addedAt',
];
// `notes` on a wish-list item is where a parent writes things like why the
// child wants it or who already promised it.
const NEVER_SHARE_FAVORITE_FIELDS = ['notes'];

/**
 * WHAT CROSSES, PER PERSON. The allowlist above is the ceiling — the most any
 * connected household can ever see. These categories are the dial INSIDE that
 * ceiling, so an admin can share a child's birthday without their sizes, or a
 * teenager's wish list without their photo.
 *
 * Identity (name, nickname, role, gender, avatarColor) is NOT a category and
 * always crosses: a row with no name is not a person, it is a puzzle. The
 * colour is the initial-circle background, not a photograph.
 *
 * ABSENT MEANS ALL. Every link made before this existed keeps sharing exactly
 * what it shared yesterday. Defaulting to "nothing" would silently blank the
 * cousins on the other side, and it would look like a bug over there, not a
 * policy here.
 */
export const SHARE_CATEGORIES = [
  { id: 'photo', label: 'Photo', fields: ['avatarUrl', 'avatarStyle'] },
  { id: 'birthday', label: 'Birthday', fields: ['birthdate'] },
  /* THE STAR SIGN IS NOT HERE, AND THAT IS DELIBERATE. It is a pure function
   * of the birthdate above, so the far side computes it from what already
   * crossed. Adding a field would mean two sources for one fact and a switch
   * somebody could set to "sign yes, birthday no", which cannot be honoured. */
  {
    id: 'about',
    label: 'What their name means',
    fields: ['nameMeanings'],
    /* A DEFAULT, unlike 'care' and 'celebrations'. The test is not "is this
     * field new" — it is "would a household be upset to find this crossed
     * without being asked". An etymology of a name the other side already
     * has, carrying its own confidence hedge, fails that test in the good
     * direction. Written down so the next person can see the test being
     * applied rather than skipped. */
  },
  {
    id: 'celebrations',
    label: 'Name days',
    fields: ['nameDay', 'nameDayFeast', 'nameCelebrations', 'nameCelebrationResolvedDates'],
    /* OPT-IN, for the same reason as 'care' and not because it is delicate
     * about parties. A name day names a feast — 'Hl. Josef', or a tradition
     * field reading 'Gaudiya Vaishnava / Hindu'. That is religious belief:
     * special-category data under GDPR Art. 9, the same article that keeps
     * the medical fields out of the defaults. Warm and festive does not make
     * it ordinary, and a default here would have told every already-connected
     * household what religion a child's family keeps, on deploy day, with
     * nobody choosing it. */
    optIn: true,
  },
  /* The third gift answer, beside Sizes and Wish list. A DEFAULT: the test is
   * "would a household be upset to find this crossed without being asked",
   * and a favourite colour is not that — it is the thing you WANT the cousin
   * buying the present to know. The one field in `preferences` that would
   * fail that test, dietaryRestrictions, is not in this category. */
  { id: 'interests', label: 'What they like', fields: ['preferences'] },
  { id: 'sizes', label: 'Sizes', fields: ['clothingSizes'] },
  { id: 'wishes', label: 'Wish list', fields: ['favorites'] },
  {
    id: 'care',
    label: 'In your care',
    fields: ['medical', 'emergencyContactName', 'emergencyContactPhone'],
    /* OPT-IN ALWAYS — the one category the "absent means all" rule must not
     * reach. Every link that exists today has no shareFields entry, so making
     * `care` part of the default would hand a child's allergies and
     * medication to every already-connected household the moment this
     * deployed, with nobody choosing it and nobody told. That is not a
     * migration, it is a disclosure. DEFAULT_CATEGORY_IDS below is what an
     * absent entry means; this is excluded from it. */
    optIn: true,
  },
];

const CATEGORY_IDS = SHARE_CATEGORIES.map((c) => c.id);
/** What an absent per-member entry means. Opt-in categories are NOT in it. */
export const DEFAULT_CATEGORY_IDS = SHARE_CATEGORIES.filter((c) => !c.optIn).map((c) => c.id);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const CATEGORISED_FIELDS = new Set(SHARE_CATEGORIES.flatMap((c) => c.fields));

/** Identity — the part of the projection no toggle can switch off. */
export const ALWAYS_SHARED_FIELDS = SHAREABLE_MEMBER_FIELDS.filter(
  (f) => !CATEGORISED_FIELDS.has(f),
);

/**
 * Clean a per-member category map coming off the wire. Only ids that are
 * actually shared may carry one, and only known categories survive — an
 * unknown string would otherwise sit in the document looking like a rule.
 */
export function sanitizeShareFields(raw, sharedIds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const allowed = new Set(sharedIds || []);
  const out = {};
  for (const [id, cats] of Object.entries(raw)) {
    if (!allowed.has(id) || !Array.isArray(cats)) continue;
    const clean = CATEGORY_IDS.filter((c) => cats.includes(c));
    // The DEFAULT set is what an absent entry already means, so storing it is
    // noise that would then have to be kept in step with any category added
    // later. Store the exceptions — and note this is compared against the
    // default, not the full set: a person with all five categories on IS an
    // exception and must be written down, or turning `care` on would be
    // silently discarded on save.
    if (!sameSet(clean, DEFAULT_CATEGORY_IDS)) out[id] = clean;
  }
  return out;
}

/** Which categories may cross for this person? Absent entry = the defaults. */
export function categoriesFor(link, familyId, memberId) {
  const map = link?.shareFields;
  const forFamily = map && typeof map === 'object' ? map[familyId] : null;
  const cats = forFamily && typeof forFamily === 'object' ? forFamily[memberId] : null;
  return Array.isArray(cats) ? cats.filter((c) => CATEGORY_IDS.includes(c)) : DEFAULT_CATEGORY_IDS.slice();
}

export const MEMBER_FIELD_CLASSIFICATION = {
  share: SHAREABLE_MEMBER_FIELDS,
  never: NEVER_SHARE_MEMBER_FIELDS,
  sizes: { share: SHAREABLE_SIZE_FIELDS, never: NEVER_SHARE_SIZE_FIELDS },
  favorites: { share: SHAREABLE_FAVORITE_FIELDS, never: NEVER_SHARE_FAVORITE_FIELDS },
  medical: { share: SHAREABLE_MEDICAL_FIELDS, never: NEVER_SHARE_MEDICAL_FIELDS },
};

const pick = (src, keys) => {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const k of keys) {
    const v = src[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
};

/**
 * Project one FamilyMember down to what a linked household may see.
 * Returns null for anything that is not a usable member doc — a caller that
 * gets null must drop the person, not fall back to the raw doc.
 */
export function projectSharedMember(member, categories, surnameMeanings) {
  if (!member || typeof member !== 'object') return null;
  if (typeof member.id !== 'string' || !member.id) return null;
  // An omitted argument means the DEFAULTS — the shape every call had before
  // categories existed. It deliberately does NOT mean "everything the
  // allowlist permits" any more: an opt-in category must never be reachable
  // by forgetting to pass an argument.
  const on = new Set(Array.isArray(categories) ? categories : DEFAULT_CATEGORY_IDS);
  const out = pick(member, ALWAYS_SHARED_FIELDS);

  /* WHICH SWITCHES ARE ON — so the far side can tell "nothing here" apart
   * from "not shared", which from over there look identical.
   *
   * Rory hit both halves of this. First: "it says i have no shared sizes or
   * wish list but i have not not shared, everything is shared" — the app had
   * guessed withholding where there was only an empty field. Then, looking at
   * a profile with two tabs: "there must be wishlist and all other possible
   * things to show, BUT if there is nothing to show it must say so and so
   * hasn't filled it yet."
   *
   * Both are the same missing bit of information, and only the server has it.
   * A client that renders "Papi has not added a wish list" for a category
   * somebody switched OFF is stating something false about another family —
   * which is precisely why the "Not shared" tab was deleted in v320. With
   * this list the empty state is only ever drawn for a category that is ON,
   * where "nothing added yet" is simply true.
   *
   * WHAT THIS DISCLOSES, stated plainly rather than glossed: the far side
   * learns which of these switches are on for this person, and can infer the
   * rest. That is a fact about a sharing decision between two households who
   * already chose to connect — not a fact about the person — and no screen
   * ever renders the complement. It buys the difference between an honest
   * empty state and a guess. */
  out.sharedCategories = CATEGORY_IDS.filter((c) => on.has(c));
  if (on.has('photo')) Object.assign(out, pick(member, ['avatarUrl', 'avatarStyle']));
  if (on.has('birthday')) Object.assign(out, pick(member, ['birthdate']));
  if (on.has('sizes')) {
    const sizes = pick(member.clothingSizes, SHAREABLE_SIZE_FIELDS);
    if (Object.keys(sizes).length) out.clothingSizes = sizes;
  }
  if (on.has('wishes') && Array.isArray(member.favorites)) {
    const favs = member.favorites
      .slice(0, 60)
      .map((f) => pick(f, SHAREABLE_FAVORITE_FIELDS))
      .filter((f) => f.title);
    if (favs.length) out.favorites = favs;
  }
  /* `surnameMeanings` is the household's, folded in by the caller (see
     mergeNameMeanings) — a surname is held once per space, so without this a
     shared profile would explain Leo and say nothing about Clark. */
  if (on.has('about')) {
    const meanings = projectNameMeanings(mergeNameMeanings(member, surnameMeanings));
    if (meanings.length) out.nameMeanings = meanings;
  }
  if (on.has('celebrations')) {
    Object.assign(out, pick(member, ['nameDay', 'nameDayFeast']));
    const cels = projectCelebrations(member.nameCelebrations);
    if (cels.length) out.nameCelebrations = cels;
    /* The cron's per-year resolutions for movable days, narrowed to the
       celebrations that actually crossed — otherwise the key set alone would
       name celebrations the far side was never shown. */
    const ids = new Set(cels.map((c) => c.id));
    const raw = member.nameCelebrationResolvedDates;
    if (raw && typeof raw === 'object') {
      const kept = {};
      for (const [id, years] of Object.entries(raw)) {
        if (ids.has(id) && years && typeof years === 'object') kept[id] = years;
      }
      if (Object.keys(kept).length) out.nameCelebrationResolvedDates = kept;
    }
  }
  if (on.has('interests')) {
    const prefs = projectPreferences(member.preferences, SHAREABLE_PREFERENCE_FIELDS);
    if (Object.keys(prefs).length) out.preferences = prefs;
  }
  if (on.has('care')) {
    const med = pick(member.medical, SHAREABLE_MEDICAL_FIELDS);
    if (Object.keys(med).length) out.medical = med;
    Object.assign(out, pick(member, ['emergencyContactName', 'emergencyContactPhone']));
    /* The carve-out lands here. MERGED, not assigned: `interests` may have
       already put the gift fields on out.preferences, and a bare assignment
       would drop them for exactly the households that switched both on. */
    const care = projectPreferences(member.preferences, CARE_ONLY_PREFERENCE_FIELDS);
    if (Object.keys(care).length) out.preferences = { ...(out.preferences || {}), ...care };
  }
  return out;
}

/** A link is stored once, with the two sides in fixed a/b slots. */
export function linkOtherSide(link, familyId) {
  if (!link) return null;
  if (link.aId === familyId) return { id: link.bId || null, name: link.bName || '' };
  if (link.bId === familyId) return { id: link.aId, name: link.aName || '' };
  return null;
}

export function isLinkParty(link, familyId) {
  return !!link && (link.aId === familyId || link.bId === familyId);
}

/**
 * Can this caller accept this invitation? Pure so every refusal is testable
 * without a database. The self-link check is the important one: accepting your
 * own code would make a household "linked" to itself and every profiles read
 * would then be answered out of the same space.
 */
export function checkAcceptLink({ link, callerFamilyId, callerRole, now = new Date() }) {
  if (!link) return { ok: false, status: 404, error: 'That connection code was not found.' };
  if (callerRole !== 'admin') return { ok: false, status: 403, error: 'Only an admin can connect another family.' };
  if (link.status === 'active') return { ok: false, status: 410, error: 'That connection code was already used.' };
  if (link.status === 'revoked') return { ok: false, status: 410, error: 'That connection was cancelled.' };
  if (link.aId === callerFamilyId) {
    return { ok: false, status: 400, error: 'That is your own code — send it to the other family instead.' };
  }
  if (link.expiresAt && new Date(link.expiresAt) < now) {
    return { ok: false, status: 410, error: 'That connection code has expired — ask for a new one.' };
  }
  return { ok: true };
}

/** Which member ids of MY space am I offering to the other side? */
export function sanitizeSharedIds(raw, validIds) {
  if (!Array.isArray(raw)) return [];
  const valid = new Set(validIds || []);
  const seen = new Set();
  const out = [];
  for (const v of raw) {
    if (typeof v !== 'string' || !v) continue;
    if (!valid.has(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 40) break;
  }
  return out;
}

/** The per-side share map lives on the link doc, keyed by family id. */
export function sharedIdsFor(link, familyId) {
  const share = link?.share;
  if (!share || typeof share !== 'object') return [];
  const ids = share[familyId];
  return Array.isArray(ids) ? ids : [];
}

/**
 * KEEPING UP WITH A FAMILY THAT GROWS. Rory, twice: "i added new family
 * members bit the other family cannot see them", then "all these new members
 * and none show up on the other family".
 *
 * A stored list of ids is a snapshot, and a family is not. Somebody adds a
 * baby and the aunt's screen keeps showing four people, with nothing anywhere
 * to explain why. So a side may be in one of two modes:
 *
 *   'chosen'   — the stored id list, exactly as before. What every existing
 *                link stays on, because flipping it would share people who
 *                were deliberately left out, and nobody asked for that.
 *   'everyone' — every member of my space right now, minus anyone explicitly
 *                left out. New links start here; a member added a second ago
 *                crosses immediately.
 *
 * RESOLVED AT READ TIME, not synced. There is no stored projection anywhere in
 * this feature and this does not add one: no job to fall behind, no copy to go
 * stale, and un-sharing still takes effect the instant it is saved. The member
 * index at families/{id}/metadata/members is the one extra read.
 *
 * The exclusions live under their own key rather than reusing `share`. One key
 * meaning "the chosen" in one mode and "the refused" in the other is how a
 * later reader shares exactly the people who were meant to be hidden.
 */
export const SHARE_MODES = ['chosen', 'everyone'];

export function shareModeFor(link, familyId) {
  const m = link?.shareMode;
  const v = m && typeof m === 'object' ? m[familyId] : null;
  // Absent means 'chosen' — the behaviour of every link written before modes
  // existed. A default of 'everyone' here would widen old links on deploy.
  return SHARE_MODES.includes(v) ? v : 'chosen';
}

export function excludedIdsFor(link, familyId) {
  const ex = link?.shareExclude;
  const ids = ex && typeof ex === 'object' ? ex[familyId] : null;
  return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string' && x) : [];
}

/**
 * The ids that actually cross for one side. `allMemberIds` is that family's
 * own member index; it is only consulted in 'everyone' mode, and a caller that
 * cannot supply it gets the stored list, never a guess.
 */
export function resolveSharedIds(link, familyId, allMemberIds) {
  if (shareModeFor(link, familyId) !== 'everyone') return sharedIdsFor(link, familyId);
  if (!Array.isArray(allMemberIds)) return sharedIdsFor(link, familyId);
  const excluded = new Set(excludedIdsFor(link, familyId));
  // Same 40 cap as sanitizeSharedIds — one path must not be able to send more
  // people across than the other.
  return allMemberIds.filter((id) => typeof id === 'string' && id && !excluded.has(id)).slice(0, 40);
}

/**
 * WHAT A NAMED SUCCESSOR IN ANOTHER HOUSEHOLD IS TOLD.
 *
 * Rory: "sort out the will thing i still think we should be able to toggle it
 * on and off etc send a notification i dunno make it easy for families that
 * are all on the app."
 *
 * A ladder, not a switch — see SuccessorShareLevel in src/types.ts for why.
 * This function is the entire boundary for it, and it is pure so the rules
 * below can be read in one sitting and tested without a database:
 *
 *  1. THE DESIGNATION MUST POINT AT SOMEBODY THEY CAN ALREADY SEE. If we did
 *     not check this, the id itself would confirm the existence of a member
 *     the other household is not shared. This check predates the ladder and
 *     survives it unchanged.
 *  2. AN ABSENT LEVEL IS 'fact'. Every designation made before the ladder
 *     existed keeps disclosing exactly what it disclosed yesterday. A level
 *     added later must never widen a decision somebody already made — the
 *     same rule as the share-category defaults above, for the same reason.
 *  3. FREE TEXT CROSSES ONLY AS `whatTheyShouldDo` (at 'instructions') AND AS
 *     THE FINDABILITY LINE (at every rung — see below). `notes` can hold
 *     literally anything and never crosses. The 'documents' rung answers "is
 *     there a will at all, and is it current" — a KIND and a DATE.
 *
 *  3b. WHO HOLDS THE WILL CROSSES AT EVERY RUNG, INCLUDING 'fact'.
 *
 *     This reverses what this file used to do, and the reversal is the whole
 *     point. The old rule treated `heldBy` as "how you get at it" and withheld
 *     it — protecting a signed original from a named successor who was chosen
 *     precisely because they will one day have to produce it. A will nobody can
 *     find is not a protected will, it is a lost one, and in Austria a
 *     home-written will is in no register and no heir may search for it: if the
 *     person holding it does not know they hold it, it is gone.
 *
 *     So `heldBy`, `notaryName`, `registered` and `registryName` cross at every
 *     rung. They name a CUSTODIAN — a person or office to ask. Knowing that a
 *     notary in Vienna has the will does not let you take it.
 *
 *     `originalLocation` is different. "In the safe behind the painting" is a
 *     hiding place, and it stays behind — EXCEPT when there is no custodian and
 *     no registration, because then it is the only findability fact that
 *     exists, and withholding it protects nothing while losing everything.
 *
 *     `notaryPhone` deliberately stays back. The office name is enough to find
 *     the office; a direct line is a contact detail, and adding one was not
 *     part of the decision that opened this rung.
 *  4. THE FILES NEVER CROSS AT ANY RUNG. linkedDocIds and linkedPolicyIds are
 *     pointers into another household's vault, so they sit on
 *     NEVER_SHARE_ESTATE_FIELDS below and no rung reaches them.
 *
 *     THERE IS NO DEATH TRIGGER BEHIND THEM. This comment used to say there
 *     was, and that sentence was worse than useless: a maintainer who believes
 *     a stronger gate sits further back will relax a weaker one in front of it.
 *     What actually holds these inside the owning household is the wills lock
 *     (reference/willsEstate — admins and named readers, nobody else) and the
 *     release ladder in willsRelease.mjs: a named person asks and nobody
 *     refuses for seven days, or two named people agree while the owner has
 *     been quiet. Nothing anywhere in this app decides that somebody has died.
 */
export const SUCCESSOR_SHARE_LEVELS = ['fact', 'instructions', 'documents'];

export function successorLevelOf(successor) {
  const v = successor?.shareLevel;
  return SUCCESSOR_SHARE_LEVELS.includes(v) ? v : 'fact';
}

/** Estate-record fields that may cross at the 'documents' rung. Nothing here
 *  is free text and nothing here locates anything. */
const SHAREABLE_ESTATE_FIELDS = ['kind', 'lastReviewed'];

/** The custodian: who to ask for the signed original. Crosses at EVERY rung.
 *  See rule 3b — these name a person or office, they do not open a safe. */
const FINDABILITY_ESTATE_FIELDS = ['heldBy', 'notaryName', 'registered', 'registryName'];

/** The hiding place. Crosses ONLY when the four fields above are all empty,
 *  because at that point it is the only answer to "where is it" in existence. */
const LAST_RESORT_ESTATE_FIELD = 'originalLocation';
/** Named so a future field on EstateRecord is a decision, not a default —
 *  estateCoverage in familyLink.test.mjs fails when the type grows past these
 *  two lists. */
const NEVER_SHARE_ESTATE_FIELDS = [
  'id', 'forMember', 'notaryPhone',
  'executor', 'linkedDocIds', 'linkedPolicyIds', 'notes',
  /* `status` stays HERE. v323 put all three of status/registered/registryName
     on this list; v326 moved the two REGISTRY fields onto the findability line,
     because "it is lodged with a notary" is the complete answer to "where is
     the will" and the court finds it from there.
     
     `status` did not move, and the reason is the one v323 gave: of the three it
     is both the most useful and the most exposing. "They have been meaning to
     write a will for two years" is a judgement about somebody's affairs, not a
     fact about where a document is, and it is not ours to forward. Findability
     was the case that justified widening the rung; this is not that case.
     
     If it should ever cross it needs its own asking, not a silent upgrade. */
  'status',
];

export const ESTATE_FIELD_CLASSIFICATION = {
  share: SHAREABLE_ESTATE_FIELDS,
  findability: FINDABILITY_ESTATE_FIELDS,
  lastResort: [LAST_RESORT_ESTATE_FIELD],
  never: NEVER_SHARE_ESTATE_FIELDS,
};

/** Which records this applies to: a will, a codicil, a testament. A power of
 *  attorney or a funeral wish is not the document whose loss ends the estate,
 *  and widening the fact rung was decided for the will. */
const WILL_KIND = /will|codicil|testament/i;

const cap = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/**
 * "Who do I ask for the signed original?" — answered at every rung.
 *
 * Returns one entry per will-shaped record, or null when there are none. Each
 * entry is either a custodian, or (only when there is no custodian at all) the
 * place it is kept, or a plain admission that nobody has recorded either.
 *
 * THE `unrecorded` FLAG IS NOT A JUDGEMENT ABOUT SOMEBODY'S AFFAIRS. It is the
 * one thing a named successor can still act on while the person is alive: ask
 * them. Withholding it means they find out on the day it is too late to ask.
 */
export function projectFindability(records) {
  if (!Array.isArray(records)) return null;
  const out = records
    .filter((r) => r && typeof r === 'object' && WILL_KIND.test(String(r.kind || '')))
    .slice(0, 3)
    .map((r) => {
      const held = cap(r.heldBy, 200);
      const notary = cap(r.notaryName, 200);
      const registered = r.registered === 'registered' ? 'registered' : undefined;
      const registry = registered ? cap(r.registryName, 200) : '';
      const entry = { kind: cap(r.kind, 80) };
      if (held) entry.heldBy = held;
      if (notary) entry.notaryName = notary;
      if (registered) entry.registered = 'registered';
      if (registry) entry.registryName = registry;
      // Last resort ONLY. A custodian or a registration answers the question
      // without opening anything; the hiding place is what is left when
      // neither exists.
      if (!held && !notary && !registered) {
        const where = cap(r[LAST_RESORT_ESTATE_FIELD], 300);
        if (where) entry.originalLocation = where;
        else entry.unrecorded = true;
      }
      return entry;
    });
  return out.length ? out : null;
}

export function projectDesignation(successor, ourSharedIds, byName, records) {
  const succ = successor;
  if (!succ || typeof succ !== 'object') return null;
  if (typeof succ.sharedMemberId !== 'string' || !succ.sharedMemberId) return null;
  // Rule 1. Unchanged by the ladder: a level cannot make an invisible person
  // visible, it only decides how much is said about a visible one.
  if (!Array.isArray(ourSharedIds) || !ourSharedIds.includes(succ.sharedMemberId)) return null;

  const level = successorLevelOf(succ);
  const out = {
    memberId: succ.sharedMemberId,
    byName: byName || '',
    level,
    setAt: typeof succ.shareLevelSetAt === 'string' ? succ.shareLevelSetAt : undefined,
  };

  // Rule 3b: unconditional. Placed above the level checks so that it is
  // structurally impossible to gate it on a rung by a later edit.
  const find = projectFindability(records);
  if (find) out.findWill = find;

  if (level === 'instructions' || level === 'documents') {
    const what = typeof succ.whatTheyShouldDo === 'string' ? succ.whatTheyShouldDo.trim() : '';
    // Capped: this is another household's free text rendering on our screen,
    // and an unbounded string is a denial-of-service on a phone.
    if (what) out.whatTheyShouldDo = what.slice(0, 2000);
  }

  if (level === 'documents' && Array.isArray(records)) {
    const docs = records
      .filter((r) => r && typeof r === 'object')
      .slice(0, 25)
      .map((r) => pick(r, SHAREABLE_ESTATE_FIELDS))
      .filter((r) => typeof r.kind === 'string' && r.kind.trim())
      .map((r) => ({ ...r, kind: String(r.kind).slice(0, 80) }));
    if (docs.length) out.documents = docs;
  }

  return out;
}
