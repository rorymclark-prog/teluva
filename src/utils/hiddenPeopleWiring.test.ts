import { readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

/**
 * "Hide <Name>'s dates" — the wiring a unit test of the filter would miss.
 *
 * hiddenPeople.test.ts proves the rules. What is proven HERE is that every
 * screen that shows a birthday, name day or anniversary actually runs them:
 * a surface that reads `members` or `events` straight from props instead of
 * the filtered copy would keep showing a hidden person's birthday and pass
 * every other test in the suite.
 *
 * Every guard is a function, and each one is also run against a copy of its
 * file with the wiring taken out (the CONTROL cases at the bottom). A guard
 * that still passes on the broken copy is not guarding anything.
 */
const root = join(import.meta.dirname ?? __dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const src = {
  dashboard: read('src/components/Dashboard.tsx'),
  calendar: read('src/components/FamilyCalendar.tsx'),
  needs: read('src/components/NeedsAttention.tsx'),
  memberDates: read('src/components/MemberCalendarDates.tsx'),
  onThisDay: read('src/components/OnThisDay.tsx'),
  overlay: read('src/components/CelebrationOverlay.tsx'),
  gifts: read('src/components/GiftsOccasionsView.tsx'),
  giftOccasions: read('src/utils/giftOccasions.ts'),
  stats: read('src/components/FamilyStats.tsx'),
  quiz: read('src/components/FamilyQuiz.tsx'),
  timeline: read('src/components/TimelineView.tsx'),
  lifeTimeline: read('src/utils/lifeTimeline.ts'),
  flashback: read('src/components/FlashbackCard.tsx'),
  household: read('src/components/SharedHousehold.tsx'),
  sharedProfile: read('src/components/SharedProfile.tsx'),
  extended: read('src/components/ExtendedBirthdaysView.tsx'),
  anniversaries: read('src/components/AnniversariesView.tsx'),
  chat: read('src/components/AIChatbot.tsx'),
  settings: read('src/components/HubSettingsModal.tsx'),
  context: read('src/contexts/HiddenPeopleContext.tsx'),
};

let n = 0;
const check = (label: string, cond: boolean) => {
  assert.ok(cond, `FAILED: ${label}`);
  n++;
};

// --- The guards --------------------------------------------------------------

const guards = {
  provider: (s: string) => {
    const c = strip(s);
    return /<HiddenPeopleProvider\s[^>]*enabled=\{!isBusinessSpace && \(demo \|\| !!accountUid\)\}/.test(c)
      && /readOnly=\{demo\}/.test(c)
      && /familyList=\{settings\.hiddenDatePeople\}/.test(c)
      && /saveFamilyList=\{saveFamilyHiddenDates\}/.test(c)
      && c.indexOf('<HiddenPeopleProvider') < c.indexOf('<AssistantBubble')
      && c.indexOf('</HiddenPeopleProvider>') > c.indexOf('<AssistantBubble');
  },
  familySaveIsMergeSafe: (s: string) =>
    /const saveFamilyHiddenDates = useCallback\([\s\S]{0,400}const base = settingsRef\.current;[\s\S]{0,300}saveSettings\(next, base\)/.test(strip(s)),
  calendar: (s: string) => {
    const c = strip(s);
    return /const dateMembers = useMemo\(\(\) => visibleDateMembers\(members, hiddenPeople\)/.test(c)
      && /const shownEvents: CalendarEvent\[\] = useMemo\(\(\) => withoutHiddenDates\(events, hiddenPeople\)/.test(c)
      && /buildCalendarBirthdays\(dateMembers\)/.test(c)
      && /buildCalendarNameCelebrations\(dateMembers\)/.test(c)
      && /buildCalendarAnniversaries\(visibleAnniversaries\(anniversaryRecords, hiddenPeople\), shownEvents\)/.test(c)
      && /buildCalendarExtendedBirthdays\(visibleExtendedBirthdays\(extendedBirthdayRecords, hiddenPeople\)\)/.test(c)
      && /buildCalendarPetBirthdays\(visiblePets\(pets, hiddenPeople\)\)/.test(c)
      && /buildIcs\(shownEvents,/.test(c)
      && !/buildIcs\(events,/.test(c)
      && /<HiddenDatesLine\b/.test(c)
      && /<HideDatesButton target=\{hideTarget\}/.test(c);
  },
  needs: (s: string) => /computeNudges\(members, hiddenPeople\)/.test(strip(s))
    && /computeExtendedBirthdayNudges\(visibleExtendedBirthdays\(/.test(strip(s)),
  memberDates: (s: string) => /computeNudges\(\[member\], hiddenPeople\)/.test(strip(s)),
  onThisDay: (s: string) => /buildInsights\([^)]*hidden\)/.test(strip(s)),
  overlay: (s: string) => /hidden\.keys\.has\(hiddenKey\.member\(m\.id\)\)/.test(strip(s)),
  gifts: (s: string) => /buildGiftOccasions\(\{[^}]*hidden/.test(strip(s)),
  stats: (s: string) => (strip(s).match(/hidden\.keys\.has\(hiddenKey\.member\(/g) || []).length >= 3,
  quiz: (s: string) => /metric: nextBirthday,/.test(strip(s)) && /generateQuestions\(selectedMembers, hidden\)/.test(strip(s)),
  timeline: (s: string) => /buildLifeTimeline\(\{[^}]*\bhidden\b/.test(strip(s)),
  lifeTimeline: (s: string) => {
    const c = strip(s);
    return /const events = visibleEvents\(/.test(c)
      && /hidden\.keys\.has\(hiddenKey\.member\(m\.id\)\)/.test(c)
      && /visibleAnniversaries\(/.test(c);
  },
  flashback: (s: string) => /buildMemories\(members, visibleEvents\(events, hidden\)\)/.test(strip(s)),
  household: (s: string) => /visibleLinkedPeople\(linkId, members, hidden\)/.test(strip(s)),
  sharedProfile: (s: string) => /<HideDatesButton[\s\S]{0,200}hiddenKey\.linked\(linkId, member\.id\)/.test(strip(s)),
  profile: (s: string) => /<HideDatesButton[\s\S]{0,200}hiddenKey\.member\(selectedMember\.id\)/.test(strip(s)),
  extended: (s: string) => /<HideDatesButton[\s\S]{0,200}hiddenKey\.extended\(viewing\.id\)/.test(strip(s))
    && /<HiddenDatesState\s+personKey=\{hiddenKey\.extended\(b\.id\)\}\s+target=\{\{ key: hiddenKey\.extended\(b\.id\), name: b\.name,/.test(strip(s)),
  anniversaries: (s: string) => /anniversarySuggestions\(visibleEvents\(events, hiddenPeople\), anniversaries\)/.test(strip(s)),
  chat: (s: string) => /const context = markHiddenDatesForChat\(\{/.test(strip(s)),
  settingsKeepsKeys: (s: string) => /onSave\(\{\s*\.\.\.settings,/.test(strip(s)),
  settingsRow: (s: string) => /hiddenDates\.enabled &&/.test(strip(s)) && /hiddenDates\.openManager/.test(strip(s)),

  // --- v355 "Choose who": hidden from chosen accounts ---------------------------
  /** Dashboard hands the provider the separate list, its save, the accounts, and offers it to admins only. */
  providerChooseWho: (s: string) => {
    const c = strip(s);
    return /<HiddenPeopleProvider\s[^>]*canHideForSome=\{isAdmin \|\| demo\}/.test(c)
      && /forList=\{settings\.hiddenDatePeopleFor\}/.test(c)
      && /saveForList=\{saveHiddenDatesFor\}/.test(c)
      && /loadAccounts=\{loadHideAccounts\}/.test(c);
  },
  /** The same merge-safe shape as the family list: explicit base, everything else spread through. */
  forSaveIsMergeSafe: (s: string) =>
    /const saveHiddenDatesFor = useCallback\([\s\S]{0,200}const base = settingsRef\.current;\s*const next: HubSettings = \{ \.\.\.base, hiddenDatePeopleFor: change\(base\.hiddenDatePeopleFor \|\| \[\]\) \};\s*const ok = await saveSettings\(next, base\);/.test(strip(s)),
  /** What this account sees is all three lists — the one value every filter and the chat read. */
  effectiveSet: (s: string) => /buildHiddenPeople\(accountHiddenLists\(\{ personal, family, forSome, uid \}\)/.test(strip(s)),
  /** Other people's "Choose who" entries are visible to admins only; everyone else sees just the ones naming them. */
  rowsForAdminsOnly: (s: string) => /hiddenRows\(personal, family, \{ list: forSome, uid, manage: canHideForSome \}\)/.test(strip(s)),
  /** The third scope is drawn only for admins, says what it does, and the sheet's editor passes the gate on. */
  chooseWhoOffered: (s: string) => {
    const c = strip(s);
    return /\{canHideForSome && option\(\s*'some',[^,]*, 'Choose who',\s*`Only the people you tick stop seeing \$\{whose\}\. Everyone else still does\.`/.test(c)
      && /<ScopeChoice scope=\{scope\} setScope=\{setScope\} canHideForFamily=\{canHideForFamily\} canHideForSome=\{canHideForSome\} name=\{name\} several=\{several\} \/>/.test(c)
      && /<HideDatesSheet[\s\S]{0,600}canHideForSome=\{canHideForSome\}/.test(c)
      && /<ScopeEditor\s+key=\{openId\}\s+now=\{now\}\s+name=\{name\}\s+canHideForFamily=\{canHideForFamily\}\s+canHideForSome=\{canHideForSome\}/.test(c);
  },
  /**
   * Each opening is a fresh editor (keyed), a new hide starts with nobody
   * ticked (startingTicks(null) is [] — unit-tested), and the button stays
   * shut until somebody is.
   */
  confirmNeedsATick: (s: string) => {
    const c = strip(s);
    return /const start = useMemo\(\(\) => new Set\(startingTicks\(now, me, accounts\.map\(\(a\) => a\.uid\)\)\), \[now, me, accounts\]\);\s*const ticks = touched \?\? start;/.test(c)
      && /<ScopeEditor\s+key=\{openId\}/.test(c)
      && /disabled=\{readOnly \|\| busy \|\| blocked \|\| \(some && picked\.length === 0\)\}/.test(c)
      && /\{some \? hideFromWords\(picked\.length\) : confirmWords\(/.test(c)
      && /n === 1 \? 'Hide from 1 person' : `Hide from \$\{n\} people`/.test(c);
  },
  /** "N people's dates hidden" counts what is hidden from THIS account, "Choose who" entries naming it included. */
  lineCountsForMe: (s: string) => {
    const c = strip(s);
    return /const hiddenCount = useMemo\(\(\) => rows\.filter\(\(r\) => rowHidesFor\(r, uid\)\)\.length/.test(c)
      && /const \{ enabled, hiddenCount, openManager \} = useHiddenPeople\(\);/.test(c);
  },
  /** A ticked account that can't change the entry is told, in words, and not given the other names. */
  tickedAccountIsTold: (s: string) =>
    /manageSome \? hiddenFromWords\(r\.forUids \|\| \[\], accounts, me\) : 'Hidden for you by the family'/.test(strip(s)),
  /** "Show again" on a person's own screen that couldn't fully show them opens the list that says why. */
  /** The chat's datesHidden marking uses the provider's set — the asking account's own three lists. */
  chatReadsProvider: (s: string) => /const \{ hidden: hiddenPeople \} = useHiddenPeople\(\);/.test(strip(s))
    && /extendedBirthdays: extendedBirthdaysCtx \}, hiddenPeople\);/.test(strip(s)),
  profileShowAgainExplains: (s: string) => /if \(readOnly \|\| \(await showAgain\(personKey\)\) !== 'shown'\) openManager\(\);/.test(strip(s)),

  // --- v356 "Change who": replace how someone is hidden ---------------------------
  /** A new hide starts at "Just for me"; "Change who" starts at how they are hidden now. */
  scopeStartsRight: (s: string) => /const \[scope, setScope\] = useState<HiddenScope>\(now\?\.scope \?\? 'me'\);/.test(strip(s)),
  /**
   * The picker ("Choose people to hide") uses the same editor as the sheet —
   * "Choose who" for admins, the same checklist and button words — and hands
   * the ticked accounts to hide(), which gives each person picked their own
   * chosen-accounts entry (withHiddenFor: new, or merged into theirs).
   */
  pickerOffersChooseWho: (s: string) => {
    const c = strip(s);
    return /<ScopeEditor\s+key=\{pickId\}\s+now=\{null\}\s+name="them"\s+several\s+canHideForFamily=\{canHideForFamily\}\s+canHideForSome=\{canHideForSome\}/.test(c)
      && /onHide\(candidates\.filter\(\(c\) => picked\.has\(c\.key\)\), choice\.scope, choice\.scope === 'some' \? choice\.forUids : undefined\)/.test(c)
      && /return saveForList\(\(list\) => people\.reduce\(\(l, p\) => withHiddenFor\(l, p, forUids\), list\)\);/.test(c)
      && /onHide=\{hide\}/.test(c);
  },
  /**
   * Every row an admin sees gets "Change who" — whichever list(s) hide the
   * person, "Just for you" and "For everyone" included (v355 only managed
   * "Choose who" rows, which was the dead end) — opening an editor prefilled
   * from the row that saves through changeWho. Everyone else keeps v355's rows.
   */
  everyAdminRowChangesWho: (s: string) => {
    const c = strip(s);
    return /const admin = canHideForSome;/.test(c)
      && /\{admin && \(\s*<div className="mt-2 flex flex-wrap gap-2">\s*<button[\s\S]{0,900}<UserCheck className="w-3\.5 h-3\.5" \/> Change who\s*<\/button>/.test(c)
      && /\{admin && whoKey === key && \([\s\S]{0,300}<ScopeEditor\s+key=\{whoId\}\s+compact\s+now=\{rowChoice\(r, me\)\}/.test(c)
      && /const result = await onChangeWho\(r\.person, choice\);/.test(c)
      && /onChangeWho=\{changeWho\}/.test(c)
      && /\{!admin && !onlyLocked && showAgainButton\}/.test(c);
  },
  /**
   * changeWho: admins only; the family and chosen-accounts lists in ONE
   * settings save; and the write that adds the person to their new place
   * first (rehideOrder), so a failure leaves them more hidden, never less.
   */
  changeWhoWrites: (s: string) => {
    const c = strip(s);
    const body = c.slice(c.indexOf('const changeWho = useCallback('), c.indexOf('const showAgainHow = useCallback('));
    return /if \(readOnly \|\| !canHideForSome \|\| !uid\) return 'failed';/.test(body)
      && /const \[first, second\] = rehideOrder\(choice\);\s*if \(!\(await steps\[first\]\(\)\)\) return 'failed';\s*return \(await steps\[second\]\(\)\) \? 'saved' : 'partial';/.test(body)
      && /settings: async \(\) => \{[\s\S]{0,200}return saveSettingsLists\(/.test(body)
      && /personal: async \(\) => \{[\s\S]{0,200}updatePersonalHiddenDates\(uid, \(l\) => rehide\(\{ personal: l \}, person, choice, uid\)\.personal\)/.test(body)
      && !/saveFamilyList|saveForList/.test(body);
  },
  /** Dashboard's save for both lists at once: explicit base, both keys set from it, everything else spread through. */
  listsSaveIsMergeSafe: (s: string) => {
    const c = strip(s);
    return /const saveHiddenDateLists = useCallback\([\s\S]{0,300}const base = settingsRef\.current;\s*const lists = change\(\{ family: base\.hiddenDatePeople \|\| \[\], forSome: base\.hiddenDatePeopleFor \|\| \[\] \}\);\s*const next: HubSettings = \{ \.\.\.base, hiddenDatePeople: lists\.family, hiddenDatePeopleFor: lists\.forSome \};\s*const ok = await saveSettings\(next, base\);/.test(c)
      && /saveSettingsLists=\{saveHiddenDateLists\}/.test(c);
  },
  /**
   * A hidden person's own screen offers an admin "Change who" (hiding them
   * took the Hide button away), and the sheet opens for an admin as "Change
   * who", prefilled, for anyone already on a row.
   */
  cardChangesWho: (s: string) => {
    const c = strip(s);
    return /\{canChangeWho && name && \([\s\S]{0,300}openHideSheet\(\{ key: personKey, name, dates: target\?\.dates \}\);[\s\S]{0,200}Change who/.test(c)
      && /<HiddenDatesState personKey=\{target\.key\} target=\{target\}/.test(c)
      && /canChangeWho: canHideForSome,/.test(c)
      && /const row = canHideForSome \? rows\.find\(\(r\) => r\.person\.id === t\.key\) : undefined;\s*setSheet\(\(s\) => \(\{ target: t, now: row \? rowChoice\(row, uid\) : null,/.test(c)
      && /if \(sheet\?\.now\) \{[\s\S]{0,200}await changeWho\(person, choice\)/.test(c);
  },
  managerTitle: (s: string) => /id="hidden-dates-title"\s+title="Hidden dates"/.test(strip(s)),
};

// --- Every surface -----------------------------------------------------------

check('Dashboard provides the lists to everything under it, chat included', guards.provider(src.dashboard));
check('the family list is saved with the settings it was read from as the base', guards.familySaveIsMergeSafe(src.dashboard));
check('the calendar: grid, agenda, birthdays, name days, anniversaries, extended, pets, .ics export, quiet line, Hide action', guards.calendar(src.calendar));
const emptyBecauseHidden = (s: string) => {
  const c = strip(s);
  return /shownBirthdays\.length === 0 && birthdaysHiddenHere \? \(\s*<HiddenHereNote/.test(c)
    && /shownExtendedBirthdays\.length === 0 && extendedHiddenHere \? \(\s*<HiddenHereNote/.test(c);
};
check('a birthday panel emptied by a Hide says so instead of "add one"', emptyBecauseHidden(src.calendar));
check('home "Needs attention": birthday nudges', guards.needs(src.needs));
check('a member\'s "Relevant dates"', guards.memberDates(src.memberDates));
check('home "On this day"', guards.onThisDay(src.onThisDay));
check('the birthday confetti overlay', guards.overlay(src.overlay));
check('Gifts & occasions', guards.gifts(src.gifts));
check('giftOccasions takes the hidden set', /hidden = NO_HIDDEN_PEOPLE/.test(src.giftOccasions));
check('Family stats: next birthday, per person and family-wide', guards.stats(src.stats));
check('Family quiz: "whose birthday is next"', guards.quiz(src.quiz));
check('Life timeline passes the hidden set', guards.timeline(src.timeline));
check('Life timeline drops births, anniversaries and dated entries', guards.lifeTimeline(src.lifeTimeline));
check('Flashback card', guards.flashback(src.flashback));
check('a connected family\'s "Coming up"', guards.household(src.household));
check('a connected family\'s person: Hide action', guards.sharedProfile(src.sharedProfile));
check('a member\'s profile: Hide action', guards.profile(src.dashboard));
check('Extended birthdays: Hide action and "Dates hidden" on the row', guards.extended(src.extended));
check('Anniversaries does not suggest a hidden person\'s calendar entry', guards.anniversaries(src.anniversaries));
check('the assistant\'s context marks hidden dates', guards.chat(src.chat));
check('Settings keeps every key it did not edit (a partial save deleted them)', guards.settingsKeepsKeys(src.settings));
check('Settings has the "Hidden dates" row', guards.settingsRow(src.settings) && />Hidden dates<\/span>/.test(src.settings));

// The sheet says what it does, and says nothing is deleted.
check('scope "Just for me" is the default for a new hide; "Change who" starts at how they are hidden now', guards.scopeStartsRight(src.context));
check('all three scopes are offered', src.context.includes('Just for me') && src.context.includes('Everyone in this family') && src.context.includes("'Choose who'"));

// v355 — "Choose who".
check('Dashboard wires "Choose who": admins only, the separate list, its save, the accounts', guards.providerChooseWho(src.dashboard));
check('the chosen-accounts list is saved with an explicit base and the rest spread through', guards.forSaveIsMergeSafe(src.dashboard));
check('what an account sees is its own ∪ family ∪ entries naming it (filters and chat alike)', guards.effectiveSet(src.context));
check('only admins see "Choose who" entries that don\'t name them', guards.rowsForAdminsOnly(src.context));
check('"Choose who" is drawn for admins, with its copy', guards.chooseWhoOffered(src.context));
check('nothing is ticked by default and confirm waits for a tick', guards.confirmNeedsATick(src.context));
check('the calendar line counts what is hidden from this account', guards.lineCountsForMe(src.context));
check('a ticked account is told it is hidden for them', guards.tickedAccountIsTold(src.context));
check('a profile "Show again" that is still hidden opens the list', guards.profileShowAgainExplains(src.context));
check('the chat reads the provider\'s effective set', guards.chatReadsProvider(src.chat));
check('the sheet says nothing is deleted', /Nothing is deleted\./.test(src.context));
check('the button says what it does', /Hide \{target\.name\}&rsquo;s dates/.test(src.context));
check('a failed save is said out loud', /That didn(’|&rsquo;)t save/.test(src.context));

// v356 — "Change who".
check('the picker offers "Choose who" to admins, with the same editor as the sheet', guards.pickerOffersChooseWho(src.context));
check('every row an admin sees has "Change who", prefilled; other accounts keep their rows', guards.everyAdminRowChangesWho(src.context));
check('"Change who" is admins only, one settings save, ordered to fail more hidden', guards.changeWhoWrites(src.context));
check('both settings lists are saved together with an explicit base and the rest spread through', guards.listsSaveIsMergeSafe(src.dashboard));
check('a hidden person\'s card offers an admin "Change who"; the sheet opens prefilled', guards.cardChangesWho(src.context));
check('the manager is called "Hidden dates"', guards.managerTitle(src.context));

// --- CONTROLS ----------------------------------------------------------------

const broken = (label: string, guard: (s: string) => boolean, s: string, from: string | RegExp, to: string) => {
  const mutated = s.replace(from, to);
  assert.notStrictEqual(mutated, s, `CONTROL mutation did not apply: ${label} — update this control`);
  check(`CONTROL: ${label}`, guard(s) && !guard(mutated));
};

broken('calendar exporting raw events', guards.calendar, src.calendar, 'buildIcs(shownEvents,', 'buildIcs(events,');
broken('calendar birthdays from raw members', guards.calendar, src.calendar, 'buildCalendarBirthdays(dateMembers)', 'buildCalendarBirthdays(members)');
broken('an emptied panel asking to add a birthday', emptyBecauseHidden, src.calendar, 'shownExtendedBirthdays.length === 0 && extendedHiddenHere ? (', 'false ? (');
broken('provider enabled in business spaces', guards.provider, src.dashboard, 'enabled={!isBusinessSpace && (demo || !!accountUid)}', 'enabled={true}');
broken('family list saved without a base', guards.familySaveIsMergeSafe, src.dashboard, 'saveSettings(next, base)', 'saveSettings(next)');
broken('nudges without the hidden set', guards.needs, src.needs, 'computeNudges(members, hiddenPeople)', 'computeNudges(members)');
broken('overlay without the check', guards.overlay, src.overlay, 'hidden.keys.has(hiddenKey.member(m.id))', 'false');
broken('quiz without the filter', guards.quiz, src.quiz, 'metric: nextBirthday,', 'metric: (m) => daysUntilNextBirthday(m.birthdate, today),');
broken('flashback on raw events', guards.flashback, src.flashback, 'visibleEvents(events, hidden)', 'events');
broken('household upcoming unfiltered', guards.household, src.household, 'visibleLinkedPeople(linkId, members, hidden)', 'members');
broken('chat context unmarked', guards.chat, src.chat, 'const context = markHiddenDatesForChat({', 'const context = ({');
broken('settings partial save', guards.settingsKeepsKeys, src.settings, /onSave\(\{\s*\.\.\.settings,/, 'onSave({');
broken('timeline without the set', guards.lifeTimeline, src.lifeTimeline, /const events = visibleEvents\([^;]*;/, 'const events = input.events;');

// v355 controls.
broken('"Choose who" offered to every writer, not admins', guards.providerChooseWho, src.dashboard, 'canHideForSome={isAdmin || demo}', 'canHideForSome={canWrite || demo}');
broken('the chosen-accounts list not handed to the provider', guards.providerChooseWho, src.dashboard, 'forList={settings.hiddenDatePeopleFor}', 'forList={undefined}');
broken('chosen-accounts save without a base', guards.forSaveIsMergeSafe, src.dashboard,
  /(hiddenDatePeopleFor: change\(base\.hiddenDatePeopleFor \|\| \[\]\) \};\s*const ok = await )saveSettings\(next, base\)/, '$1saveSettings(next)');
broken('chosen-accounts save rebuilding the doc (a forgotten key is a DELETE)', guards.forSaveIsMergeSafe, src.dashboard,
  '{ ...base, hiddenDatePeopleFor:', '{ hiddenDatePeopleFor:');
broken('effective set without the chosen-accounts list', guards.effectiveSet, src.context,
  'accountHiddenLists({ personal, family, forSome, uid })', '[personal, family]');
broken('every account shown every "Choose who" entry', guards.rowsForAdminsOnly, src.context, 'manage: canHideForSome }', 'manage: true }');
broken('"Choose who" drawn for everyone', guards.chooseWhoOffered, src.context, '{canHideForSome && option(', '{option(');
broken('the choice not offering "Choose who"', guards.chooseWhoOffered, src.context,
  'canHideForFamily={canHideForFamily} canHideForSome={canHideForSome} name={name} several={several} />', 'canHideForFamily={canHideForFamily} name={name} several={several} />');
broken('the sheet\'s editor not offering "Choose who"', guards.chooseWhoOffered, src.context,
  /(key=\{openId\}\s+now=\{now\}\s+name=\{name\}\s+canHideForFamily=\{canHideForFamily\}\s+)canHideForSome=\{canHideForSome\}/, '$1canHideForSome={false}');
broken('ticks carried over between openings', guards.confirmNeedsATick, src.context, /<ScopeEditor\s+key=\{openId\}/, '<ScopeEditor');
broken('confirm enabled with nobody ticked', guards.confirmNeedsATick, src.context, 'disabled={readOnly || busy || blocked || (some && picked.length === 0)}', 'disabled={readOnly || busy || blocked}');
broken('the calendar line counting rows managed for others', guards.lineCountsForMe, src.context,
  'rows.filter((r) => rowHidesFor(r, uid)).length', 'rows.length');
broken('a ticked account told nothing', guards.tickedAccountIsTold, src.context, ": 'Hidden for you by the family'", ": ''");
broken('chat marked with a set of its own', guards.chatReadsProvider, src.chat, 'extendedBirthdays: extendedBirthdaysCtx }, hiddenPeople);', 'extendedBirthdays: extendedBirthdaysCtx }, NO_HIDDEN_PEOPLE);');
broken('a still-hidden profile "Show again" doing nothing', guards.profileShowAgainExplains, src.context, "!== 'shown') openManager();", "=== 'failed') openManager();");

// v356 controls.
broken('"Change who" opening on "Just for me" whatever the row says', guards.scopeStartsRight, src.context, "useState<HiddenScope>(now?.scope ?? 'me')", "useState<HiddenScope>('me')");
broken('the picker without "Choose who"', guards.pickerOffersChooseWho, src.context,
  /(key=\{pickId\}\s+now=\{null\}\s+name="them"\s+several\s+canHideForFamily=\{canHideForFamily\}\s+)canHideForSome=\{canHideForSome\}/, '$1canHideForSome={false}');
broken('the picker dropping the ticked accounts', guards.pickerOffersChooseWho, src.context,
  /(picked\.has\(c\.key\)\), choice\.scope), choice\.scope === 'some' \? choice\.forUids : undefined\)/, '$1)');
broken('"Change who" only on "Choose who" rows (the v355 dead end)', guards.everyAdminRowChangesWho, src.context,
  /\{admin && \((\s*<div className="mt-2 flex flex-wrap gap-2">)/, '{admin && some && ($1');
broken('"Change who" not prefilled from the row', guards.everyAdminRowChangesWho, src.context, 'now={rowChoice(r, me)}', 'now={null}');
broken('non-admins given admin rows', guards.everyAdminRowChangesWho, src.context, 'const admin = canHideForSome;', 'const admin = true;');
broken('"Change who" for any settings writer', guards.changeWhoWrites, src.context,
  "if (readOnly || !canHideForSome || !uid) return 'failed';", "if (readOnly || !uid) return 'failed';");
broken('"Change who" removing before adding (a failure would show them)', guards.changeWhoWrites, src.context,
  'const [first, second] = rehideOrder(choice);', 'const [second, first] = rehideOrder(choice);');
broken('"Change who" as two settings saves', guards.changeWhoWrites, src.context, 'return saveSettingsLists((l) => {', 'return saveForList((l) => {');
broken('both-lists save without a base', guards.listsSaveIsMergeSafe, src.dashboard,
  /(hiddenDatePeopleFor: lists\.forSome \};\s*const ok = await )saveSettings\(next, base\)/, '$1saveSettings(next)');
broken('both-lists save rebuilding the doc (a forgotten key is a DELETE)', guards.listsSaveIsMergeSafe, src.dashboard,
  '{ ...base, hiddenDatePeople: lists.family,', '{ hiddenDatePeople: lists.family,');
broken('the card chip without "Change who"', guards.cardChangesWho, src.context, '{canChangeWho && name && (', '{false && (');
broken('the sheet opening as a new hide for someone already hidden', guards.cardChangesWho, src.context,
  'now: row ? rowChoice(row, uid) : null,', 'now: null,');
broken('the manager still titled for "you"', guards.managerTitle, src.context, 'title="Hidden dates"', 'title="People whose dates you’ve hidden"');

console.log(`hiddenPeopleWiring.test.ts: ${n} checks passed.`);
