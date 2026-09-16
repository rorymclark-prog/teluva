// "Hide <Name>'s dates" — the state, the two sheets and the one hook every
// surface reads.
//
// The rules live in utils/hiddenPeople.ts (pure, tested, mirrored on the
// server). This file only holds the three lists, saves changes to them, and
// draws the two sheets:
//   * HideDatesSheet — opened from a person's row: "Just for me" (the default),
//     "Everyone in this family", or — admins only — "Choose who", a checklist
//     of the family's accounts; and a line saying nothing is deleted. For an
//     admin, a person who is already hidden opens it as "Change who", with
//     how they are hidden now already chosen;
//   * HiddenDatesManager — "Hidden dates", with "Show again" per person,
//     "Change who" on every row for an admin, and a picker for hiding several
//     at once (with "Choose who" for admins too).
// All three places choose a scope with the same ScopeEditor, so they can't
// drift apart.
//
// CHANGE WHO REPLACES (v356). Hiding again only ever adds; "Change who" says
// how the person is hidden from now on, and the admin's own list, the
// family's list and the chosen-accounts list are all made to say exactly that
// (utils/hiddenPeople.ts rehide). The family and chosen-accounts lists are
// ONE settings save; the admin's own list is a second write, done in the
// order that leaves the person more hidden, never less, if it fails
// (rehideOrder). Other accounts' own lists are private and never touched.
//
// WHERE THE LISTS LIVE. "Just for me" is families/{id}/prefs/{uid}, which only
// that account can read or write (firestore.rules), changed inside a
// transaction (db.updatePersonalHiddenDates). "Everyone in this family" is
// HubSettings.hiddenDatePeople, and "Choose who" is
// HubSettings.hiddenDatePeopleFor — each entry a person plus the uids it is
// hidden from. Both are saved by Dashboard with the settings they were read
// from as the merge base, so a change here never overwrites anything else on
// the settings doc. "Choose who" is a separate field, not a flag on the family
// list, so a phone still on v354 simply doesn't know about it and shows the
// dates (fails open) instead of reading an entry as "hidden from everyone".
//
// WHAT AN ACCOUNT SEES. Its own list ∪ the family list ∪ the chosen-accounts
// entries that name it (utils/hiddenPeople.ts accountHiddenLists — the same
// set the calendar feed and the reminders use on the server). An account an
// entry does not name sees nothing of that entry: not the hide, not the row.
// An account it DOES name is always told ("Hidden for you by the family" in
// its settings list, "Dates hidden" on the person's own screen), because a
// birthday that silently vanishes looks like lost data, and hiding the fact
// of hiding from the very person it's about is not something this app does.
//
// ADMINS ONLY IS A POLICY, NOT A LOCK. "Choose who" is offered to admins
// (canHideForSome), but firestore.rules lets any member who can write the
// settings doc change any key on it — the same trust v354's family list runs
// on. The gate decides what the app offers, not what the database refuses.
//
// OFF, NOT EMPTY. With no provider (business spaces, signed out) the hook
// returns `enabled: false` and a hidden set with nobody in it, so the filters
// every surface runs are no-ops and no Hide action is drawn.
import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { EyeOff, Eye, Loader2, Users, User, UserCheck, X } from 'lucide-react';
import type { AnniversaryRecord, ExtendedBirthday, FamilyMember, FamilyMemberRole, FamilyRole, HiddenDatePerson, HiddenDatePersonFor, Pet } from '../types';
import {
  accountHiddenLists, buildHiddenPeople, cleanForUids, hiddenFromWords, hiddenKey, hiddenRows, hideAccounts,
  NO_HIDDEN_PEOPLE, rehide, rehideOrder, rowChoice, rowHidesFor, startingTicks, withHidden, withHiddenFor,
  withoutHidden, withoutHiddenFor,
  type HideAccount, type HiddenListRow, type HiddenPeople, type HiddenScope, type RehideChoice, type SettingsHiddenLists,
} from '../utils/hiddenPeople';
import { loadAnniversaries, loadHousehold, loadPersonalPrefs, updatePersonalHiddenDates } from '../utils/db';
import { formatNameDay } from '../utils/nameDay';
import SheetGrabber from '../components/SheetGrabber';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

/** Somebody a Hide action can point at. `dates` is what they have, in words ("Birthday 12 April"). */
export interface HideTarget {
  key: string;
  name: string;
  dates?: string[];
}

/**
 * What "Show again" came to: `shown` — this account sees them again;
 * `still-hidden` — every change it could make saved, but a list it can't
 * change still hides them (the family's list for a child account, an admin's
 * "Choose who" for anyone else); `failed` — a save didn't go through.
 */
export type ShowAgainResult = 'shown' | 'still-hidden' | 'failed';

/**
 * What "Change who" came to: `saved`; `failed` — nothing changed; `partial` —
 * the new choice is in place but the old list couldn't be cleared, so the
 * person is hidden from MORE accounts than chosen until it is tried again.
 */
export type ChangeWhoResult = 'saved' | 'partial' | 'failed';

interface HiddenPeopleValue {
  /** False in business spaces and when signed out: draw no Hide actions, no manager, no calendar line. */
  enabled: boolean;
  /** The demo: sheets open, nothing can be saved. */
  readOnly: boolean;
  /** The effective set — all three lists, as they apply to this account — for the filters in utils/hiddenPeople.ts. */
  hidden: HiddenPeople;
  /**
   * One row per person on the settings list, saying which list(s) hide them.
   * An admin also gets the rows they manage for other accounts, which hide
   * nothing from the admin — see `hiddenCount`.
   */
  rows: HiddenListRow[];
  /** How many rows actually stop THIS account seeing someone: what "N people's dates hidden" counts. */
  hiddenCount: number;
  isHidden: (key: string) => boolean;
  /**
   * Open the Hide sheet. For an admin, a person already on a list opens it as
   * "Change who", prefilled with how they are hidden now.
   */
  openHideSheet: (target: HideTarget) => void;
  /** May this account use "Change who" (admins — the same gate as "Choose who")? */
  canChangeWho: boolean;
  openManager: () => void;
  /**
   * From the person's own screen: show them again FOR THIS ACCOUNT — off its
   * own list, off the family list if it may change that (as in v354), and its
   * own uid off a "Choose who" entry if it is an admin.
   */
  showAgain: (key: string) => Promise<ShowAgainResult>;
}

const OFF: HiddenPeopleValue = {
  enabled: false,
  readOnly: true,
  hidden: NO_HIDDEN_PEOPLE,
  rows: [],
  hiddenCount: 0,
  isHidden: () => false,
  openHideSheet: () => {},
  canChangeWho: false,
  openManager: () => {},
  showAgain: async () => 'failed',
};

const HiddenPeopleContext = createContext<HiddenPeopleValue>(OFF);

export function useHiddenPeople(): HiddenPeopleValue {
  return useContext(HiddenPeopleContext);
}

// --- What dates a person has, in words, for the sheet and the picker --------

function birthdayWords(ymd?: string): string | null {
  if (!ymd || ymd.length < 10) return null;
  const md = formatNameDay(ymd.slice(5, 10));
  return md ? `Birthday ${md}` : null;
}

export function memberDates(m: FamilyMember, anniversaries: AnniversaryRecord[] = []): string[] {
  const out: string[] = [];
  const b = birthdayWords(m.birthdate);
  if (b) out.push(b);
  const nd = formatNameDay(m.nameDay);
  if (nd) out.push(`Name day ${nd}`);
  else if ((m.nameCelebrations || []).length) out.push('Name day');
  for (const a of anniversaries) if ((a.memberIds || []).includes(m.id)) out.push(a.title);
  return out;
}

export function extendedDates(e: ExtendedBirthday): string[] {
  const md = formatNameDay(e.date);
  return md ? [`Birthday ${md}`] : [];
}

/** A person shared by a connected family: only what crossed the link. */
export function linkedDates(m: { birthdate?: string; nameDay?: string }): string[] {
  const out: string[] = [];
  const b = birthdayWords(m.birthdate);
  if (b) out.push(b);
  const nd = formatNameDay(m.nameDay);
  if (nd) out.push(`Name day ${nd}`);
  return out;
}

export function petDates(p: Pet): string[] {
  const b = birthdayWords(p.birthdate);
  return b ? [b] : [];
}

// --- Provider ----------------------------------------------------------------

interface ProviderProps {
  children: React.ReactNode;
  enabled: boolean;
  readOnly: boolean;
  /** The signed-in account; its own list is loaded again whenever this or `spaceId` changes. */
  uid: string | null;
  spaceId: string | null;
  /** Can this account change the family's list? (Children and viewers cannot write settings.) */
  canHideForFamily: boolean;
  familyList: HiddenDatePerson[] | undefined;
  /** Apply a change to HubSettings.hiddenDatePeople and save it. Resolves false if the save failed. */
  saveFamilyList: (change: (list: HiddenDatePerson[]) => HiddenDatePerson[]) => Promise<boolean>;
  /**
   * May this account hide someone from chosen accounts ("Choose who"), and
   * manage every such entry? Admins — see ADMINS ONLY IS A POLICY above.
   */
  canHideForSome: boolean;
  /** HubSettings.hiddenDatePeopleFor. */
  forList: HiddenDatePersonFor[] | undefined;
  /** Apply a change to HubSettings.hiddenDatePeopleFor and save it (merge-safe, like saveFamilyList). */
  saveForList: (change: (list: HiddenDatePersonFor[]) => HiddenDatePersonFor[]) => Promise<boolean>;
  /**
   * "Change who": apply a change to BOTH settings lists and save them in one
   * save (merge-safe, like the two above), so a person moved from one to the
   * other is never on neither, and a failure never leaves half a change.
   */
  saveSettingsLists: (change: (lists: SettingsHiddenLists) => SettingsHiddenLists) => Promise<boolean>;
  /**
   * The family's accounts (families/{id}/roles) for the "Choose who"
   * checklist. Only called while a sheet that needs it is open and
   * canHideForSome; an empty answer is read as "couldn't load" — a real
   * family always has at least the admin who is asking.
   */
  loadAccounts: () => Promise<Record<string, FamilyMemberRole>>;
  members: FamilyMember[];
  extendedBirthdays: ExtendedBirthday[];
}

type AccountsState = 'idle' | 'loading' | 'ready' | 'failed';

export function HiddenPeopleProvider({
  children, enabled, readOnly, uid, spaceId, canHideForFamily, familyList, saveFamilyList,
  canHideForSome, forList, saveForList, saveSettingsLists, loadAccounts, members, extendedBirthdays,
}: ProviderProps) {
  const [personal, setPersonal] = useState<HiddenDatePerson[]>([]);
  /* The Hide sheet: who it is for, how they are hidden now ("Change who";
     null for a new hide), and a count that gives every opening a fresh
     editor. Closing keeps the rest, so the sheet doesn't go blank while it
     animates away. */
  const [sheet, setSheet] = useState<{ target: HideTarget; now: RehideChoice | null; id: number; open: boolean } | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);

  useEffect(() => {
    setPersonal([]);
    if (!enabled || readOnly || !uid) return;
    let cancelled = false;
    loadPersonalPrefs(uid).then((p) => {
      if (!cancelled) setPersonal(Array.isArray(p.hiddenDatePeople) ? p.hiddenDatePeople : []);
    });
    return () => { cancelled = true; };
  }, [enabled, readOnly, uid, spaceId]);

  /* The family's accounts, read when a sheet that shows them opens (and again
     each time, so an account that joined a minute ago can be ticked). Held in
     a ref so a parent that passes a fresh function every render can't turn
     this into a read loop. A failed read keeps an earlier good copy: the list
     only goes to "couldn't load" when there's nothing to show. */
  const loadAccountsRef = useRef(loadAccounts);
  loadAccountsRef.current = loadAccounts;
  const [accountRoles, setAccountRoles] = useState<Record<string, FamilyMemberRole> | null>(null);
  const [accountsState, setAccountsState] = useState<AccountsState>('idle');
  const [accountsTry, setAccountsTry] = useState(0);
  useEffect(() => { setAccountRoles(null); setAccountsState('idle'); }, [spaceId]);
  const wantAccounts = enabled && canHideForSome && (!!sheet?.open || managerOpen);
  useEffect(() => {
    if (!wantAccounts) return;
    let cancelled = false;
    const keepOrFail = () => { if (!cancelled) setAccountsState((s) => (s === 'ready' ? 'ready' : 'failed')); };
    setAccountsState((s) => (s === 'ready' ? 'ready' : 'loading'));
    loadAccountsRef.current().then((roles) => {
      if (cancelled) return;
      if (roles && Object.keys(roles).length > 0) { setAccountRoles(roles); setAccountsState('ready'); }
      else keepOrFail();
    }, keepOrFail);
    return () => { cancelled = true; };
  }, [wantAccounts, spaceId, accountsTry]);
  const accounts = useMemo(() => hideAccounts(accountRoles, members, uid), [accountRoles, members, uid]);
  const retryAccounts = useCallback(() => setAccountsTry((n) => n + 1), []);

  const family = enabled ? familyList : undefined;
  const forSome = enabled ? forList : undefined;
  // THE EFFECTIVE SET: own list ∪ family list ∪ the "Choose who" entries that
  // name this account. Every filter in the app, and the chat's datesHidden
  // marking (AIChatbot → markHiddenDatesForChat), reads this one value.
  const hidden = useMemo(
    () => (enabled
      ? buildHiddenPeople(accountHiddenLists({ personal, family, forSome, uid }), { members, extendedBirthdays })
      : NO_HIDDEN_PEOPLE),
    [enabled, personal, family, forSome, uid, members, extendedBirthdays],
  );
  const rows = useMemo(
    () => (enabled ? hiddenRows(personal, family, { list: forSome, uid, manage: canHideForSome }) : []),
    [enabled, personal, family, forSome, uid, canHideForSome],
  );
  const hiddenCount = useMemo(() => rows.filter((r) => rowHidesFor(r, uid)).length, [rows, uid]);

  const hide = useCallback(async (targets: HideTarget[], scope: HiddenScope, forUids: string[] = []): Promise<boolean> => {
    if (readOnly || !targets.length) return false;
    const at = new Date().toISOString();
    const people: HiddenDatePerson[] = targets.map((t) => ({ id: t.key, name: t.name, hiddenAt: at, ...(uid ? { by: uid } : {}) }));
    const add = (list: HiddenDatePerson[]) => people.reduce(withHidden, list);
    if (scope === 'me') {
      if (!uid) return false;
      const saved = await updatePersonalHiddenDates(uid, add);
      if (saved) setPersonal(saved);
      return !!saved;
    }
    if (scope === 'some') {
      // Hiding someone again ADDS accounts to their entry (withHiddenFor);
      // it never un-hides them from anyone already on it.
      if (!canHideForSome || !cleanForUids(forUids).length) return false;
      return saveForList((list) => people.reduce((l, p) => withHiddenFor(l, p, forUids), list));
    }
    if (!canHideForFamily) return false;
    return saveFamilyList(add);
  }, [readOnly, uid, canHideForFamily, saveFamilyList, canHideForSome, saveForList]);

  /*
   * "Change who": from now on, hide `person` exactly as `choice` says, on
   * every list this account may change (utils/hiddenPeople.ts rehide). Admins
   * only, like "Choose who". Other accounts' own lists (prefs/{uid}) are
   * private to them and are neither read nor written: someone Papa hid for
   * himself stays hidden for Papa whatever is chosen here.
   *
   * Two writes: the family and chosen-accounts lists in ONE settings save
   * (nothing in between, nothing half-done), and this account's own list in
   * its transaction. rehideOrder puts the one that adds them to their new
   * place first, so a failure after it leaves them hidden from everyone the
   * new choice says and, for now, the old list too — 'partial' — and never
   * shown to anyone the admin meant to hide them from. Each write re-applies
   * rehide to its list as it is at that moment; the lists as this screen has
   * them only decide which writes are needed at all. Ticking nobody is
   * refused — "Show again" is how a hide ends.
   */
  const changeWho = useCallback(async (person: HiddenDatePerson, choice: RehideChoice): Promise<ChangeWhoResult> => {
    if (readOnly || !canHideForSome || !uid) return 'failed';
    if (choice.scope === 'some' && !cleanForUids(choice.forUids).length) return 'failed';
    const cur = { personal, family: family || [], forSome: forSome || [] };
    const plan = rehide(cur, person, choice, uid);
    const steps = {
      personal: async () => {
        if (plan.personal === cur.personal) return true;
        const saved = await updatePersonalHiddenDates(uid, (l) => rehide({ personal: l }, person, choice, uid).personal);
        if (saved) setPersonal(saved);
        return !!saved;
      },
      settings: async () => {
        if (plan.family === cur.family && plan.forSome === cur.forSome) return true;
        return saveSettingsLists((l) => {
          const next = rehide({ family: l.family, forSome: l.forSome }, person, choice, uid);
          return { family: next.family, forSome: next.forSome };
        });
      },
    };
    const [first, second] = rehideOrder(choice);
    if (!(await steps[first]())) return 'failed';
    return (await steps[second]()) ? 'saved' : 'partial';
  }, [readOnly, canHideForSome, uid, personal, family, forSome, saveSettingsLists]);

  /*
   * Take someone off the lists. `for-me` (the person's own screen): off this
   * account's list, off the family list if it may change that (v354's
   * behaviour), and this account's uid off a "Choose who" entry if it is an
   * admin — other accounts on that entry keep it hidden. `for-everyone` (the
   * manager's "Show again"): the whole "Choose who" entry goes too.
   */
  const showAgainHow = useCallback(async (key: string, how: 'for-me' | 'for-everyone'): Promise<ShowAgainResult> => {
    if (readOnly) return 'failed';
    let ok = true;
    let still = false;
    if (personal.some((p) => p.id === key)) {
      const saved = uid ? await updatePersonalHiddenDates(uid, (l) => withoutHidden(l, key)) : null;
      if (saved) setPersonal(saved); else ok = false;
    }
    if ((family || []).some((p) => p.id === key)) {
      if (canHideForFamily) ok = (await saveFamilyList((l) => withoutHidden(l, key))) && ok;
      else still = true;
    }
    const entry = (forSome || []).find((e) => e?.id === key);
    const namesMe = !!uid && !!entry && cleanForUids(entry.forUids).includes(uid);
    if (entry && (how === 'for-everyone' || namesMe)) {
      if (canHideForSome) {
        ok = (await saveForList((l) => (how === 'for-everyone' ? withoutHiddenFor(l, key) : withoutHiddenFor(l, key, uid as string)))) && ok;
      } else if (namesMe) {
        still = true;
      }
    }
    return !ok ? 'failed' : still ? 'still-hidden' : 'shown';
  }, [readOnly, uid, personal, family, forSome, canHideForFamily, saveFamilyList, canHideForSome, saveForList]);
  const showAgain = useCallback((key: string) => showAgainHow(key, 'for-me'), [showAgainHow]);

  // An admin opening the sheet for someone already on a list gets "Change
  // who" — adding more accounts to a hide they couldn't otherwise shrink was
  // v355's dead end. Everyone else, and anyone not yet hidden: a new hide.
  const openHideSheet = useCallback((t: HideTarget) => {
    const row = canHideForSome ? rows.find((r) => r.person.id === t.key) : undefined;
    setSheet((s) => ({ target: t, now: row ? rowChoice(row, uid) : null, id: (s?.id ?? 0) + 1, open: true }));
  }, [canHideForSome, rows, uid]);

  const value = useMemo<HiddenPeopleValue>(() => (enabled ? {
    enabled,
    readOnly,
    hidden,
    rows,
    hiddenCount,
    isHidden: (key: string) => hidden.keys.has(key),
    openHideSheet,
    canChangeWho: canHideForSome,
    openManager: () => setManagerOpen(true),
    showAgain,
  } : OFF), [enabled, readOnly, hidden, rows, hiddenCount, openHideSheet, canHideForSome, showAgain]);

  const accountsProps: AccountsProps = { accounts, state: accountsState, onRetry: retryAccounts, me: uid };
  const closeSheet = () => setSheet((s) => (s ? { ...s, open: false } : s));
  const sheetRow = sheet?.now ? rows.find((r) => r.person.id === sheet.target.key) : undefined;

  return (
    <HiddenPeopleContext.Provider value={value}>
      {children}
      {enabled && (
        <>
          <HideDatesSheet
            open={!!sheet?.open}
            openId={sheet?.id ?? 0}
            target={sheet?.target ?? null}
            now={sheet?.now ?? null}
            nowWords={sheetRow ? rowWords(sheetRow, true, accounts, uid) : ''}
            readOnly={readOnly}
            canHideForFamily={canHideForFamily}
            canHideForSome={canHideForSome}
            accountsProps={accountsProps}
            onClose={closeSheet}
            onSave={async (choice) => {
              const t = sheet?.target;
              if (!t) return SAVE_FAILED;
              if (sheet?.now) {
                const person = sheetRow?.person ?? { id: t.key, name: t.name, hiddenAt: new Date().toISOString() };
                const result = await changeWho(person, choice);
                if (result === 'saved') closeSheet();
                return changeWhoError(result, choice, t.name);
              }
              const ok = await hide([t], choice.scope, choice.scope === 'some' ? choice.forUids : undefined);
              if (ok) closeSheet();
              return ok ? null : SAVE_FAILED;
            }}
          />
          <HiddenDatesManager
            open={managerOpen}
            readOnly={readOnly}
            canHideForFamily={canHideForFamily}
            canHideForSome={canHideForSome}
            accountsProps={accountsProps}
            rows={rows}
            members={members}
            extendedBirthdays={extendedBirthdays}
            onClose={() => setManagerOpen(false)}
            onShowAgain={showAgainHow}
            onChangeWho={changeWho}
            onHide={hide}
          />
        </>
      )}
    </HiddenPeopleContext.Provider>
  );
}

const SAVE_FAILED = 'That didn’t save. Check your connection and try again.';

/** What to say after "Change who" didn't fully save (null when it did). */
function changeWhoError(result: ChangeWhoResult, choice: RehideChoice, name: string): string | null {
  if (result === 'saved') return null;
  if (result === 'failed') return SAVE_FAILED;
  // 'partial': the new choice is in place and the old list still hides them
  // as well — more hidden than asked for, never less. Trying again finishes it.
  return choice.scope === 'me'
    ? `Saved for you, but ${name} is still hidden from the others as before. Check your connection and try again.`
    : `Saved, but ${name} is still on your own list too, so you still won’t see their dates. Check your connection and try again.`;
}

// --- The pieces both sheets share -------------------------------------------

function Sheet({ open, onClose, labelledBy, children, z = 'z-[100]' }: {
  open: boolean; onClose: () => void; labelledBy: string; children: React.ReactNode; z?: string;
}) {
  useBodyScrollLock(open);
  return (
    <AnimatePresence>
      {open && (
        <div className={`fixed inset-0 ${z} flex items-end sm:items-center justify-center p-0 sm:p-4`}>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 15 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            className="card relative w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6 z-10"
          >
            <SheetGrabber onClose={onClose} className="mb-3" />
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function SheetHeader({ id, title, sub, onClose }: { id: string; title: string; sub?: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 pb-4 border-b border-cream-200">
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-11 h-11 rounded-2xl bg-dusk-100 flex items-center justify-center shrink-0">
          <EyeOff className="w-5 h-5 text-dusk-700" />
        </div>
        <div className="min-w-0">
          <h2 id={id} className="font-display text-xl font-bold text-ink-900 leading-tight break-words">{title}</h2>
          {sub && <p className="text-[13px] text-ink-500 mt-0.5">{sub}</p>}
        </div>
      </div>
      <button
        onClick={onClose}
        className="p-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-cream-100 cursor-pointer shrink-0"
        aria-label="Close"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}

function ScopeChoice({ scope, setScope, canHideForFamily, canHideForSome = false, name, several = false }: {
  scope: HiddenScope; setScope: (s: HiddenScope) => void; canHideForFamily: boolean;
  /** Offer "Choose who" (admins). Not drawn at all otherwise — a greyed-out option would only invite "why not me?". */
  canHideForSome?: boolean; name: string;
  /** The picker: several people at once, called "them". */
  several?: boolean;
}) {
  // Its own group name: the manager can have a row's "Change who" and the
  // picker open at once, and radios sharing a name untick each other.
  const group = useId();
  const whose = several ? 'them' : `${name}’s dates`;
  const option = (value: HiddenScope, icon: React.ReactNode, title: string, detail: string, disabled = false) => {
    const on = scope === value;
    return (
      <label
        className={`flex items-start gap-3 rounded-2xl border p-3.5 transition-colors ${
          disabled ? 'opacity-60 cursor-not-allowed border-cream-200' :
          on ? 'border-dusk-400 bg-dusk-50 cursor-pointer' : 'border-cream-200 hover:bg-cream-100 cursor-pointer'
        }`}
      >
        <input
          type="radio"
          name={group}
          value={value}
          checked={on}
          disabled={disabled}
          onChange={() => setScope(value)}
          className="mt-1 accent-dusk-600"
        />
        {icon}
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink-900">{title}</span>
          <span className="block text-[12.5px] text-ink-500 leading-snug">{detail}</span>
        </span>
      </label>
    );
  };
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Who stops seeing them</legend>
      {option('me', <User className="w-4 h-4 text-dusk-700 shrink-0 mt-0.5" />, 'Just for me', `You stop seeing ${several ? 'them' : name}. Everyone else still does.`)}
      {option(
        'family', <Users className="w-4 h-4 text-dusk-700 shrink-0 mt-0.5" />, 'Everyone in this family',
        canHideForFamily ? 'Nobody in this family sees them.' : 'Your account can’t change this for everyone.',
        !canHideForFamily,
      )}
      {canHideForSome && option(
        'some', <UserCheck className="w-4 h-4 text-dusk-700 shrink-0 mt-0.5" />, 'Choose who',
        `Only the people you tick stop seeing ${whose}. Everyone else still does.`,
      )}
    </fieldset>
  );
}

// --- "Choose who": the family's accounts as a checklist -----------------------

interface AccountsProps {
  accounts: HideAccount[];
  state: AccountsState;
  onRetry: () => void;
  me: string | null;
}

function roleWords(role: FamilyRole): string {
  return role === 'admin' ? 'Admin' : role === 'child' ? 'Child account' : 'Member';
}

/** The confirm button's words for a "Choose who" hide: it counts people, and stays shut at nobody. */
function hideFromWords(n: number): string {
  if (n <= 0) return 'Tick who to hide from';
  return n === 1 ? 'Hide from 1 person' : `Hide from ${n} people`;
}

/**
 * One checkbox per sign-in account in the family, named the way the family
 * knows them (utils/hiddenPeople.ts hideAccounts). Everyone is listed —
 * other admins, and the admin doing the ticking.
 */
function AccountChecklist({ accountsProps, checked, onToggle }: {
  accountsProps: AccountsProps; checked: Set<string>; onToggle: (uid: string) => void;
}) {
  const { accounts, state, onRetry } = accountsProps;
  if (!accounts.length && (state === 'idle' || state === 'loading')) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-ink-500 px-1 py-2">
        <Loader2 className="w-4 h-4 animate-spin shrink-0" /> Loading the family&rsquo;s accounts&hellip;
      </p>
    );
  }
  if (!accounts.length) {
    return (
      <div className="rounded-xl bg-rosa-50 px-3 py-2.5">
        <p className="text-[13px] text-rosa-700">Couldn&rsquo;t load the family&rsquo;s accounts. Check your connection and try again.</p>
        <button type="button" onClick={onRetry} className="btn-quiet !py-1 !px-2.5 text-[12.5px] mt-2">Try again</button>
      </div>
    );
  }
  return (
    <fieldset>
      <legend className="text-[12.5px] font-semibold text-ink-700 mb-1.5">Hide from</legend>
      <ul className="max-h-64 overflow-y-auto rounded-2xl border border-cream-200 divide-y divide-cream-200">
        {accounts.map((a) => (
          <li key={a.uid}>
            <label className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-cream-100">
              <input
                type="checkbox"
                checked={checked.has(a.uid)}
                onChange={() => onToggle(a.uid)}
                className="accent-dusk-600 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink-900 truncate">
                  {a.label}{a.isMe && <span className="font-normal text-ink-500"> (you)</span>}
                </span>
                <span className="block text-[12px] text-ink-500">{roleWords(a.role)}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/**
 * Choosing who stops seeing someone: the three scopes, the account checklist
 * under "Choose who", and the confirm button. The ONE editor the Hide sheet,
 * a manager row's "Change who" and the manager's picker all use.
 *
 * `now` is how the person is hidden today ("Change who"): that scope starts
 * chosen, and "Choose who" starts with whoever doesn't see them now ticked
 * (utils/hiddenPeople.ts startingTicks). A new hide (`now` null) starts at
 * "Just for me" — the smaller step — with nobody ticked. Each opening mounts
 * a fresh editor (callers key it), so nothing carries over between openings.
 */
function ScopeEditor({
  now, name, several = false, canHideForFamily, canHideForSome, accountsProps, readOnly, compact = false,
  blocked = false, confirmWords, onCancel, onSave, onBusy, children,
}: {
  now: RehideChoice | null; name: string; several?: boolean;
  canHideForFamily: boolean; canHideForSome: boolean; accountsProps: AccountsProps; readOnly: boolean;
  /** Smaller buttons, for inside a manager row. */
  compact?: boolean;
  /** Something outside the editor isn't ready yet (the picker, with nobody picked). */
  blocked?: boolean;
  /** The confirm button's words for "Just for me" / "Everyone"; "Choose who" always counts people (hideFromWords). */
  confirmWords: (scope: 'me' | 'family') => React.ReactNode;
  onCancel: () => void;
  /** Resolves null when it saved, or what to tell the person when it didn't. */
  onSave: (choice: RehideChoice) => Promise<string | null>;
  onBusy?: (busy: boolean) => void;
  /** Drawn between the choice and the buttons (the "Nothing is deleted" line). */
  children?: React.ReactNode;
  key?: number;   // tolerated so `<ScopeEditor key={…} … />` type-checks (same reason as Tile in FamilyStats.tsx)
}) {
  const { accounts, me } = accountsProps;
  const [scope, setScope] = useState<HiddenScope>(now?.scope ?? 'me');
  // Untouched, the ticks follow `now` and the accounts as they load; the
  // first tap takes a copy and from then on it is the person's list.
  const [touched, setTouched] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useMemo(() => new Set(startingTicks(now, me, accounts.map((a) => a.uid))), [now, me, accounts]);
  const ticks = touched ?? start;
  const toggle = (uid: string) => setTouched((prev) => {
    const next = new Set(prev ?? start);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  });
  // Once the accounts are loaded, only accounts still in the family are
  // counted and saved — one that has since left drops off the entry here
  // rather than being counted in a number nobody can see ticked.
  const picked = accounts.length ? [...ticks].filter((u) => accounts.some((a) => a.uid === u)) : [...ticks];
  const some = scope === 'some' && canHideForSome;
  const choice: RehideChoice = some ? { scope: 'some', forUids: picked } : scope === 'family' ? { scope: 'family' } : { scope: 'me' };
  const small = compact ? '!py-1.5 !px-3 text-[13px]' : '';

  return (
    <div>
      <ScopeChoice scope={scope} setScope={setScope} canHideForFamily={canHideForFamily} canHideForSome={canHideForSome} name={name} several={several} />
      {some && (
        <div className="mt-3">
          <AccountChecklist accountsProps={accountsProps} checked={ticks} onToggle={toggle} />
          {/* The people it's hidden from are told, in their own settings list
              — this says so up front rather than implying a secret. */}
          <p className="mt-2 text-[12.5px] text-ink-500 leading-snug">
            {several
              ? <>The people you tick see in their settings whose dates are hidden for them.</>
              : <>The people you tick see in their settings that {name}&rsquo;s dates are hidden for them.</>}
          </p>
        </div>
      )}
      {children}
      {error && <p className="mt-3 text-[13px] text-rosa-700 bg-rosa-50 rounded-xl px-3 py-2">{error}</p>}
      <div className={`${compact ? 'mt-3' : 'mt-5'} flex flex-wrap justify-end gap-2`}>
        <button type="button" onClick={onCancel} className={`btn-quiet ${small}`}>Cancel</button>
        <button
          type="button"
          disabled={readOnly || busy || blocked || (some && picked.length === 0)}
          onClick={async () => {
            setBusy(true);
            onBusy?.(true);
            setError(null);
            const err = await onSave(choice);
            setBusy(false);
            onBusy?.(false);
            if (err) setError(err);
          }}
          className={`btn-primary ${small} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {busy ? <Loader2 className={compact ? 'w-3.5 h-3.5 animate-spin' : 'w-4 h-4 animate-spin'} /> : <EyeOff className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />}
          {some ? hideFromWords(picked.length) : confirmWords(scope === 'family' ? 'family' : 'me')}
        </button>
      </div>
    </div>
  );
}

function ReadOnlyNote() {
  return (
    <p className="text-[12.5px] text-ink-500 bg-cream-100 rounded-xl px-3 py-2">
      This is the demo, so nothing here can be changed. In your own family this works as described.
    </p>
  );
}

// --- "Hide Nora's dates" / "Change who doesn't see Nora's dates" --------------

function HideDatesSheet({
  open, openId, target, now, nowWords, readOnly, canHideForFamily, canHideForSome, accountsProps, onClose, onSave,
}: {
  open: boolean;
  /** A new number per opening: the editor is remounted, so it starts fresh. */
  openId: number;
  target: HideTarget | null;
  /** How they are hidden now — "Change who" (admins). Null: a new hide. */
  now: RehideChoice | null;
  /** `now` in words, as the settings list says it ("Just for you", "Hidden from Papa"). */
  nowWords: string;
  readOnly: boolean; canHideForFamily: boolean;
  canHideForSome: boolean; accountsProps: AccountsProps;
  onClose: () => void; onSave: (choice: RehideChoice) => Promise<string | null>;
}) {
  const name = target?.name || '';
  const change = !!now;

  return (
    <Sheet open={open} onClose={onClose} labelledBy="hide-dates-title">
      <SheetHeader
        id="hide-dates-title"
        title={change ? `Change who doesn’t see ${name}’s dates` : `Hide ${name}’s dates`}
        sub="Their birthday, name day and anniversaries stop showing on the calendar, the home screen, in reminders and in the calendar feed."
        onClose={onClose}
      />
      {change && nowWords && (
        <p className="mt-4 text-[12.5px] text-ink-500">
          <span className="font-semibold text-ink-700">Now:</span> {nowWords}. What you choose here replaces that.
        </p>
      )}
      {target?.dates && target.dates.length > 0 && (
        <p className={`${change && nowWords ? 'mt-1.5' : 'mt-4'} text-[12.5px] text-ink-500`}>
          <span className="font-semibold text-ink-700">{name}:</span> {target.dates.join(' · ')}
        </p>
      )}
      <div className="mt-4">
        <ScopeEditor
          key={openId}
          now={now}
          name={name}
          canHideForFamily={canHideForFamily}
          canHideForSome={canHideForSome}
          accountsProps={accountsProps}
          readOnly={readOnly}
          confirmWords={(s) => (change ? (s === 'family' ? 'Hide from everyone' : 'Hide just for me') : <>Hide {name}&rsquo;s dates</>)}
          onCancel={onClose}
          onSave={onSave}
        >
          <p className="mt-4 text-[13px] text-ink-700 leading-relaxed">
            Nothing is deleted. You can show {name}&rsquo;s dates again at any time in Settings.
          </p>
          {readOnly && <div className="mt-3"><ReadOnlyNote /></div>}
        </ScopeEditor>
      </div>
    </Sheet>
  );
}

// --- "Hidden dates" -----------------------------------------------------------

function scopeWords(scopes: HiddenScope[]): string {
  if (scopes.includes('me') && scopes.includes('family')) return 'For you and for everyone in this family';
  if (scopes.includes('family')) return 'For everyone in this family';
  return scopes.includes('me') ? 'Just for you' : '';
}

/**
 * What a row says about who it hides the person from. A "Choose who" entry
 * reads "Hidden from Papa and Ben" to an admin (who manages it) and "Hidden
 * for you by the family" to an account it names that can't change it — never
 * the other names on the entry, which are the admin's business.
 */
function rowWords(r: HiddenListRow, manageSome: boolean, accounts: HideAccount[], me: string | null): string {
  const parts = [scopeWords(r.scopes)].filter(Boolean);
  if (r.scopes.includes('some')) parts.push(manageSome ? hiddenFromWords(r.forUids || [], accounts, me) : 'Hidden for you by the family');
  return parts.join(' · ');
}

function HiddenDatesManager({
  open, readOnly, canHideForFamily, canHideForSome, accountsProps, rows, members, extendedBirthdays,
  onClose, onShowAgain, onChangeWho, onHide,
}: {
  open: boolean; readOnly: boolean; canHideForFamily: boolean; canHideForSome: boolean; accountsProps: AccountsProps;
  rows: HiddenListRow[]; members: FamilyMember[]; extendedBirthdays: ExtendedBirthday[];
  onClose: () => void; onShowAgain: (key: string, how: 'for-me' | 'for-everyone') => Promise<ShowAgainResult>;
  onChangeWho: (person: HiddenDatePerson, choice: RehideChoice) => Promise<ChangeWhoResult>;
  onHide: (targets: HideTarget[], scope: HiddenScope, forUids?: string[]) => Promise<boolean>;
}) {
  const me = accountsProps.me;
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickId, setPickId] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // "Change who": the row being edited. Each opening is a fresh editor.
  const [whoKey, setWhoKey] = useState<string | null>(null);
  const [whoId, setWhoId] = useState(0);
  // Pets and anniversaries are not on Dashboard; read them when the picker is
  // first opened, the same way the calendar reads them for itself.
  const [pets, setPets] = useState<Pet[]>([]);
  const [anniversaries, setAnniversaries] = useState<AnniversaryRecord[]>([]);

  useEffect(() => {
    if (!open) { setPicking(false); setPicked(new Set()); setError(null); setWhoKey(null); return; }
    if (readOnly) return;
    let cancelled = false;
    loadHousehold().then((h) => { if (!cancelled) setPets(h?.pets || []); }).catch(() => {});
    loadAnniversaries().then((a) => { if (!cancelled) setAnniversaries(a); }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, readOnly]);

  const hiddenKeys = useMemo(() => new Set(rows.map((r) => r.person.id)), [rows]);
  const candidates = useMemo<HideTarget[]>(() => {
    const out: HideTarget[] = [
      ...members.map((m) => ({ key: hiddenKey.member(m.id), name: m.name, dates: memberDates(m, anniversaries) })),
      ...extendedBirthdays.map((e) => ({ key: hiddenKey.extended(e.id), name: e.name, dates: extendedDates(e) })),
      ...pets.map((p) => ({ key: hiddenKey.pet(p.id), name: p.name, dates: petDates(p) })),
    ];
    return out.filter((c) => c.name && c.dates && c.dates.length > 0 && !hiddenKeys.has(c.key));
  }, [members, extendedBirthdays, pets, anniversaries, hiddenKeys]);

  const toggle = (key: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <Sheet open={open} onClose={onClose} labelledBy="hidden-dates-title">
      {/* "Hidden dates", not "People whose dates you've hidden": an account
          may only have rows the family chose for it. */}
      <SheetHeader
        id="hidden-dates-title"
        title="Hidden dates"
        sub="Their birthdays, name days and anniversaries are kept, just not shown."
        onClose={onClose}
      />
      {readOnly && <div className="mt-4"><ReadOnlyNote /></div>}

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-ink-500">Nobody&rsquo;s dates are hidden.</p>
      ) : (
        <ul className="mt-4 divide-y divide-cream-200">
          {rows.map((r) => {
            const key = r.person.id;
            const some = r.scopes.includes('some');
            const forUids = r.forUids || [];
            // An admin can change how anyone on this list is hidden, whichever
            // list(s) hide them ("Change who" on every row). Anyone else sees a
            // "Choose who" entry only because it names them, and can't change it.
            const admin = canHideForSome;
            const manageSome = some && admin;
            const lockedForMe = some && !admin;
            // "Show again" takes them off every list this account can change.
            // A person hidden only by lists it can't change gets no button when
            // that list is an admin's "Choose who" (the note says who can), and
            // v354's greyed-out button when it is the family's list.
            const onlyLocked = lockedForMe && !r.scopes.includes('me') && !(r.scopes.includes('family') && canHideForFamily);
            const canShow = !readOnly && (r.scopes.includes('me') || canHideForFamily || manageSome) && !onlyLocked;
            // An admin who is one of several on the entry can take just
            // themselves off it. (With the family list on the row too there is
            // no "just me": that list hides them from everyone.)
            const showForMe = manageSome && !!me && forUids.includes(me) && forUids.length > 1 && !r.scopes.includes('family');
            const run = async (how: 'for-me' | 'for-everyone') => {
              setBusyKey(`${how}:${key}`);
              setError(null);
              if ((await onShowAgain(key, how)) === 'failed') setError(SAVE_FAILED);
              setBusyKey(null);
            };
            const busy = (how: string) => busyKey === `${how}:${key}`;
            const showAgainButton = (
              <button
                type="button"
                disabled={!canShow || !!busyKey}
                onClick={() => run('for-everyone')}
                className="btn-quiet !py-1.5 !px-3 text-[13px] shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy('for-everyone') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                Show again
              </button>
            );
            return (
              <li key={key} className="py-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink-900 truncate">{r.person.name}</p>
                    <p className="text-[12px] text-ink-500">{rowWords(r, manageSome, accountsProps.accounts, me)}</p>
                    {lockedForMe && (
                      <p className="text-[11.5px] text-ink-400">An admin chose this. Only an admin can change it.</p>
                    )}
                    {!lockedForMe && !canHideForFamily && r.scopes.includes('family') && !r.scopes.includes('me') && !readOnly && (
                      <p className="text-[11.5px] text-ink-400">Your account can&rsquo;t change the family&rsquo;s list.</p>
                    )}
                  </div>
                  {!admin && !onlyLocked && showAgainButton}
                </div>
                {admin && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!!busyKey}
                      aria-expanded={whoKey === key}
                      onClick={() => {
                        setError(null);
                        if (whoKey === key) { setWhoKey(null); return; }
                        setWhoKey(key);
                        setWhoId((n) => n + 1);
                      }}
                      className="btn-quiet !py-1.5 !px-3 text-[13px] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <UserCheck className="w-3.5 h-3.5" /> Change who
                    </button>
                    {showForMe && (
                      <button
                        type="button"
                        disabled={readOnly || !!busyKey}
                        onClick={() => run('for-me')}
                        className="btn-quiet !py-1.5 !px-3 text-[13px] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {busy('for-me') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                        Show for me
                      </button>
                    )}
                    {showAgainButton}
                  </div>
                )}
                {admin && whoKey === key && (
                  // Opens on how they are hidden now; saving REPLACES it, and a
                  // failure is said here, in the row it happened in.
                  <div className="mt-3 rounded-2xl bg-cream-100 p-3">
                    <ScopeEditor
                      key={whoId}
                      compact
                      now={rowChoice(r, me)}
                      name={r.person.name}
                      canHideForFamily={canHideForFamily}
                      canHideForSome={canHideForSome}
                      accountsProps={accountsProps}
                      readOnly={readOnly}
                      confirmWords={(s) => (s === 'family' ? 'Hide from everyone' : 'Hide just for me')}
                      onCancel={() => setWhoKey(null)}
                      onBusy={(b) => setBusyKey(b ? `who:${key}` : null)}
                      onSave={async (choice) => {
                        const result = await onChangeWho(r.person, choice);
                        if (result === 'saved') setWhoKey(null);
                        return changeWhoError(result, choice, r.person.name);
                      }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && !picking && <p className="mt-3 text-[13px] text-rosa-700 bg-rosa-50 rounded-xl px-3 py-2">{error}</p>}

      <div className="mt-5 pt-4 border-t border-cream-200">
        {!picking ? (
          <button type="button" onClick={() => { setPicking(true); setPickId((n) => n + 1); }} className="btn-quiet w-full sm:w-auto">
            <EyeOff className="w-4 h-4" /> Choose people to hide
          </button>
        ) : (
          <div>
            <h3 className="text-sm font-bold text-ink-900">Choose people to hide</h3>
            {candidates.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">Nobody else has a date to hide.</p>
            ) : (
              <ul className="mt-2 max-h-72 overflow-y-auto rounded-2xl border border-cream-200 divide-y divide-cream-200">
                {candidates.map((c) => (
                  <li key={c.key}>
                    <label className="flex items-start gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-cream-100">
                      <input
                        type="checkbox"
                        checked={picked.has(c.key)}
                        onChange={() => toggle(c.key)}
                        className="mt-1 accent-dusk-600"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink-900">{c.name}</span>
                        <span className="block text-[12px] text-ink-500">{(c.dates || []).join(' · ')}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {/* The same editor as the sheet: "Choose who" for admins, the same
                checklist, the same button words. Each person picked gets their
                own chosen-accounts entry (merged into one they already have). */}
            <div className="mt-3">
              <ScopeEditor
                key={pickId}
                now={null}
                name="them"
                several
                canHideForFamily={canHideForFamily}
                canHideForSome={canHideForSome}
                accountsProps={accountsProps}
                readOnly={readOnly}
                blocked={picked.size === 0}
                confirmWords={() => (picked.size === 1 ? 'Hide 1 person’s dates' : `Hide ${picked.size} people’s dates`)}
                onCancel={() => { setPicking(false); setPicked(new Set()); }}
                onSave={async (choice) => {
                  const ok = await onHide(candidates.filter((c) => picked.has(c.key)), choice.scope, choice.scope === 'some' ? choice.forUids : undefined);
                  if (ok) { setPicking(false); setPicked(new Set()); }
                  return ok ? null : SAVE_FAILED;
                }}
              >
                <p className="mt-3 text-[13px] text-ink-700">Nothing is deleted. You can show anyone again here.</p>
              </ScopeEditor>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/**
 * "Dates hidden · Show again" — drawn in place of the Hide button on a screen
 * that belongs to the person (their profile, their row in a list), so hiding
 * someone never makes them look deleted. Nothing when they aren't hidden.
 * For an admin it also offers "Change who" — the Hide sheet, opened with how
 * they are hidden now — since hiding them took away the Hide button that
 * would otherwise lead there. `target` gives the sheet their name and dates.
 */
export function HiddenDatesState({ personKey, target, className = '' }: {
  personKey: string; target?: HideTarget; className?: string;
}) {
  const { enabled, readOnly, isHidden, rows, canChangeWho, openHideSheet, openManager, showAgain } = useHiddenPeople();
  if (!enabled || !isHidden(personKey)) return null;
  const name = target?.name || rows.find((r) => r.person.id === personKey)?.person.name || '';
  return (
    // Each phrase stays whole; in a narrow header the buttons drop to their own line.
    <span className={`inline-flex flex-wrap items-center gap-x-1 whitespace-nowrap text-[12px] text-ink-500 ${className}`}>
      <EyeOff className="w-3.5 h-3.5 shrink-0" />
      <span>Dates hidden</span>
      {canChangeWho && name && (
        <>
          <span aria-hidden="true">&middot;</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openHideSheet({ key: personKey, name, dates: target?.dates }); }}
            className="font-semibold text-dusk-700 hover:underline cursor-pointer"
          >
            Change who
          </button>
        </>
      )}
      <span aria-hidden="true">&middot;</span>
      <button
        type="button"
        onClick={async (e) => {
          e.stopPropagation();
          // The demo, a failed save, or a list this account can't change (the
          // family's, or an admin's "Choose who"): the settings list says which.
          if (readOnly || (await showAgain(personKey)) !== 'shown') openManager();
        }}
        className="font-semibold text-dusk-700 hover:underline cursor-pointer"
      >
        Show again
      </button>
    </span>
  );
}

/**
 * "Hide Nora's dates" — the one labelled button every surface uses. With
 * `showHiddenState`, a hidden person gets HiddenDatesState instead of the
 * button just disappearing.
 */
export function HideDatesButton({ target, className = '', showHiddenState = false }: {
  target: HideTarget; className?: string; showHiddenState?: boolean;
}) {
  const { enabled, isHidden, openHideSheet } = useHiddenPeople();
  if (!enabled) return null;
  if (isHidden(target.key)) {
    return showHiddenState ? <HiddenDatesState personKey={target.key} target={target} className={`px-2 py-1 ${className}`} /> : null;
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); openHideSheet(target); }}
      className={`inline-flex items-center gap-1 text-[12px] font-semibold text-ink-500 hover:text-ink-800 rounded-full px-2 py-1 hover:bg-cream-100 cursor-pointer ${className}`}
    >
      <EyeOff className="w-3.5 h-3.5 shrink-0" />
      Hide {target.name}&rsquo;s dates
    </button>
  );
}

/**
 * "2 people's dates hidden · Manage" — the quiet line on screens that would
 * otherwise have shown them. It counts the people hidden FROM THIS ACCOUNT
 * (hiddenCount): someone an admin hid from this account counts, so the gap on
 * the calendar is explained; someone an admin hid from other accounts doesn't,
 * because this calendar still shows them.
 */
export function HiddenDatesLine({ className = '' }: { className?: string }) {
  const { enabled, hiddenCount, openManager } = useHiddenPeople();
  if (!enabled || hiddenCount === 0) return null;
  const n = hiddenCount;
  return (
    <p className={`text-[12px] text-ink-500 flex flex-wrap items-center gap-x-1.5 whitespace-nowrap ${className}`}>
      <EyeOff className="w-3.5 h-3.5 shrink-0" />
      <span>{n === 1 ? '1 person’s dates hidden' : `${n} people’s dates hidden`}</span>
      <span aria-hidden="true">&middot;</span>
      <button type="button" onClick={openManager} className="font-semibold text-dusk-700 hover:underline cursor-pointer">
        Manage
      </button>
    </p>
  );
}
