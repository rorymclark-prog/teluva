import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Link2, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { listFamilyLinks, loadFamilyLinkProfiles, sharedAge } from '../utils/familyLink';
import NamedByThemCard from './NamedByThemCard';
import { sharedSizeEntries, sharedWishes } from './SharedProfile';
import type { FamilyLink, SharedMember, NamedByThem } from '../utils/familyLink';

/* CONNECTED PEOPLE, IN THE FAMILY LIST — Rory's own design, and the right one:
 * "it should be a line under your family, then you click and it expands all the
 * other profiles you connected to".
 *
 * The cousins were previously only reachable inside a modal, behind a second
 * tap on the family row, which put the people three taps from the screen that
 * asks "who is family". They belong in the same list as everyone else.
 *
 * WHAT THIS IS NOT: a member. These people live in another household and are
 * projected through the allowlist in server/familyLink.mjs, so they get their
 * own row style, no drag handle, and no route into the member profile panel —
 * there is no medical, document or ID data behind them to show. The modal
 * stays for the ADMIN actions (connect, choose who they see, disconnect).
 */
export default function ConnectedInline({
  onManage,
  members = [],
  onOpenPerson,
  onOpenHousehold,
  openPersonId,
  openHouseholdId,
}: {
  onManage: () => void;
  members?: Array<{ id: string; name: string }>;
  /* The chosen person is rendered by the Dashboard in the SAME panel a member
   * uses — "i want it to open normally like the other profiles not a new
   * modal". This component only reports the choice. */
  onOpenPerson: (member: SharedMember, householdName: string, linkId: string) => void;
  /* Their picture opens the HOUSEHOLD, the way a person's opens a person.
   * Same panel, same rule — this component only reports it. */
  onOpenHousehold: (payload: {
    link: FamilyLink;
    members: SharedMember[];
    photoUrl?: string;
    namedByThem: NamedByThem | null;
  }) => void;
  openPersonId?: string | null;
  openHouseholdId?: string | null;
}) {
  /* The named person is one of OURS — the server sends only an id, because a
   * name from our own space is a name we already have. */
  const memberName = (id: string) => members.find((m) => m.id === id)?.name || 'someone in your family';

  const [links, setLinks] = useState<FamilyLink[]>([]);
  const [profiles, setProfiles] = useState<Record<string, SharedMember[]>>({});
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [named, setNamed] = useState<Record<string, NamedByThem | null>>({});
  /* Their own picture of themselves, if they have set one. A household name
   * with no face is the least recognisable thing in a list of families. */
  const [photos, setPhotos] = useState<Record<string, string>>({});

  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await listFamilyLinks();
      setLinks(all.filter((l) => l.status === 'active'));
    } catch {
      setLinks([]);            // a link list that will not load is not worth an error card here
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* WHY THIS EXISTS. Rory: "there needs to be a refresh button on the app
   * because i had to close it … this was to see other family members".
   *
   * Everything on this panel describes a DIFFERENT household, and nothing on
   * this side is told when they change it. The link list was fetched once at
   * mount and the profiles were cached per link, so a person shared five
   * minutes ago stayed invisible until the app was killed and reopened —
   * which made v316's "share everyone, including whoever you add next"
   * technically true and practically useless.
   *
   * Refetches the list AND every open household, because refreshing the list
   * alone would update the counts while leaving the faces beneath them stale,
   * which is worse than not refreshing at all. */
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const all = await listFamilyLinks();
      const active = all.filter((l) => l.status === 'active');
      setLinks(active);
      const open = active.filter((l) => openIds.includes(l.id));
      const fetched = await Promise.all(open.map(async (l) => {
        try {
          return { id: l.id, ...(await loadFamilyLinkProfiles(l.id)) };
        } catch {
          return null;         // one household failing must not blank the others
        }
      }));
      for (const r of fetched) {
        if (!r) continue;
        setProfiles((p) => ({ ...p, [r.id]: r.members }));
        setNamed((n) => ({ ...n, [r.id]: r.namedByThem || null }));
        if (r.otherPhotoUrl) setPhotos((ph) => ({ ...ph, [r.id]: r.otherPhotoUrl! }));
      }
    } catch {
      /* Leave what is on screen. A refresh that fails should look like
         nothing happened, not like the other family disconnected. */
    } finally {
      setRefreshing(false);
    }
  }, [openIds]);

  /* Coming back to the app is the moment you most expect it to be current, and
   * it is also the cheapest moment to check — one request, only when somebody
   * is actually looking. A timer that fires against a hidden tab is battery
   * spent on a screen nobody can see. */
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshAll(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    // …and a slow poll for the case Rory actually hit: the app left open on
    // one screen while the other household adds somebody.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshAll();
    }, 90_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(timer);
    };
  }, [refreshAll]);

  async function toggle(link: FamilyLink) {
    const isOpen = openIds.includes(link.id);
    setOpenIds((prev) => (isOpen ? prev.filter((id) => id !== link.id) : [...prev, link.id]));
    if (isOpen) return;
    /* Always refetch: the other household can share somebody at any moment and
     * nothing tells this side when they do. Keep the old list on screen. */
    if (!profiles[link.id]) setBusy(link.id);
    try {
      const { members: people, namedByThem, otherPhotoUrl } = await loadFamilyLinkProfiles(link.id);
      setProfiles((p) => ({ ...p, [link.id]: people }));
      setNamed((n) => ({ ...n, [link.id]: namedByThem || null }));
      if (otherPhotoUrl) setPhotos((ph) => ({ ...ph, [link.id]: otherPhotoUrl }));
    } catch {
      setProfiles((p) => ({ ...p, [link.id]: p[link.id] || [] }));
    } finally {
      setBusy(null);
    }
  }

  /* The household page needs the people, and the photo may not have arrived
   * if this link was never expanded. Fetch first, then open — never open an
   * empty page, and never leave it blank when the network fails. */
  async function openHousehold(link: FamilyLink) {
    const have = profiles[link.id];
    /* Open on what we have so the page appears instantly, then refetch behind
       it. Returning the cache and stopping there is how a household that
       gained three people yesterday still shows one — the same shape as the
       v308 cached-empty-list bug, in a different function. */
    if (have) {
      onOpenHousehold({ link, members: have, photoUrl: photos[link.id], namedByThem: named[link.id] || null });
      void refreshAll();
      return;
    }
    setBusy(link.id);
    try {
      const { members: people, namedByThem, otherPhotoUrl } = await loadFamilyLinkProfiles(link.id);
      setProfiles((p) => ({ ...p, [link.id]: people }));
      setNamed((n) => ({ ...n, [link.id]: namedByThem || null }));
      if (otherPhotoUrl) setPhotos((ph) => ({ ...ph, [link.id]: otherPhotoUrl }));
      onOpenHousehold({ link, members: people, photoUrl: otherPhotoUrl, namedByThem: namedByThem || null });
    } catch {
      onOpenHousehold({ link, members: [], photoUrl: photos[link.id], namedByThem: null });
    } finally {
      setBusy(null);
    }
  }

  if (loading || links.length === 0) {
    /* Nothing connected yet: one quiet line that opens the panel, rather than
     * a section header standing over an empty space. */
    return (
      <button
        type="button"
        onClick={onManage}
        className="w-full flex items-center gap-3 text-left rounded-2xl border border-cream-200 bg-cream-50/60 px-3.5 py-3 hover:bg-cream-100 transition-colors cursor-pointer"
      >
        <div className="w-9 h-9 rounded-xl bg-dusk-100 text-dusk-700 flex items-center justify-center shrink-0">
          <Link2 className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-bold text-ink-900">Connected families</p>
          <p className="text-[12px] text-ink-500">Cousins’ birthdays, sizes and wish lists</p>
        </div>
        <ChevronDown className="w-4 h-4 text-ink-400 shrink-0 -rotate-90" />
      </button>
    );
  }

  return (
    <div className="space-y-2.5 pt-1">
      <div className="flex items-center justify-between gap-2">
        <h4 className="section-label flex-1">Connected families</h4>
        {/* A LABELLED, VISIBLE CONTROL, not a pull-to-refresh gesture. It
            refreshes on its own when you come back to the app and every 90
            seconds while you are looking, but Rory asked for a button and he
            is right to: when you are waiting for a cousin to appear, the
            difference between "it will update" and "I made it update" is the
            difference between trusting the screen and closing the app. */}
        <button
          type="button"
          onClick={() => void refreshAll()}
          disabled={refreshing}
          className="chip bg-cream-200 text-ink-600 flex items-center gap-1 cursor-pointer hover:bg-cream-300 transition-colors disabled:opacity-60"
          title="Check for people they have shared since"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Checking…' : 'Refresh'}
        </button>
        <button
          type="button"
          onClick={onManage}
          className="chip bg-cream-200 text-ink-600 flex items-center gap-1 cursor-pointer hover:bg-cream-300 transition-colors"
          title="Connect a family, choose who they see, or disconnect"
        >
          <Settings2 className="w-3.5 h-3.5" /> Manage
        </button>
      </div>

      {links.map((link) => {
        const isOpen = openIds.includes(link.id);
        const people = profiles[link.id] || [];
        return (
          <div key={link.id} className="rounded-2xl border border-cream-200 overflow-hidden">
            {/* Two targets, because they do different things: their picture
                opens THEM (the household page), the rest expands the people.
                Nested buttons are invalid HTML, so these are siblings in a row
                rather than a button inside a button. */}
            <div className={`w-full flex items-center gap-3 px-3.5 py-3 transition-colors ${
              openHouseholdId === link.id ? 'bg-clay-50' : 'bg-cream-50/60'
            }`}>
              <button
                type="button"
                onClick={() => void openHousehold(link)}
                className="shrink-0 cursor-pointer rounded-xl transition-transform hover:scale-105 active:scale-95"
                aria-label={`Open ${link.otherName || 'this family'}`}
                title={`Open ${link.otherName || 'this family'}`}
              >
                {photos[link.id] ? (
                  <img
                    src={photos[link.id]}
                    alt={link.otherName || 'Connected family'}
                    className="w-9 h-9 rounded-xl object-cover border border-cream-200"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-xl bg-dusk-100 text-dusk-700 flex items-center justify-center">
                    <Link2 className="w-4 h-4" />
                  </div>
                )}
              </button>
              <button
                type="button"
                onClick={() => toggle(link)}
                aria-expanded={isOpen}
                className="min-w-0 flex-1 flex items-center gap-3 text-left cursor-pointer"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold text-ink-900 truncate">{link.otherName || 'Connected family'}</p>
                  <p className="text-[12px] text-ink-500 tabular-nums">
                    {link.sharedWithMeCount} {link.sharedWithMeCount === 1 ? 'person' : 'people'} shared with you
                  </p>
                </div>
                <ChevronDown className={`w-4 h-4 text-ink-400 shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
              </button>
            </div>

            {isOpen && (
              <div className="px-2.5 pb-2.5 pt-0.5 space-y-1.5">
                {/* Being named as somebody's successor and not knowing it is the
                    failure every estate guide warns about. The fact crosses;
                    what they want done stays in their own estate document. */}
                {/* Rendered by the shared card since v317: what may be shown
                    depends on the rung THEY chose, and that rule living in two
                    components is how one of them ends up a rung behind. */}
                {named[link.id] && (
                  <NamedByThemCard named={named[link.id]!} memberName={memberName} compact />
                )}
                {busy === link.id && people.length === 0 ? (
                  <p className="flex items-center gap-2 text-[12.5px] text-ink-400 px-1 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading their family…
                  </p>
                ) : people.length === 0 ? (
                  <p className="text-[12.5px] text-ink-400 px-1 py-2">
                    Nobody from their family is showing yet. Their admin chooses who you can see.
                  </p>
                ) : (
                  people.map((m) => (
                    <SharedRow
                      key={m.id}
                      member={m}
                      selected={openPersonId === m.id}
                      onOpen={() => onOpenPerson(m, link.otherName || '', link.id)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}

    </div>
  );
}

function initial(name: string): string {
  return (name.trim()[0] || '?').toUpperCase();
}

/* One shared person, styled like a member row and opening a real profile.
 * The subtitle names what is actually behind the tap, so a person with only a
 * name and a birthday reads as sparse rather than broken — which is exactly
 * what tapping Rat1 felt like before. */
const SharedRow: React.FC<{ member: SharedMember; onOpen: () => void; selected?: boolean }> = ({ member, onOpen, selected }) => {
  const age = sharedAge(member.birthdate);
  const sizes = sharedSizeEntries(member).length;
  const wishes = sharedWishes(member).length;
  const extras = [
    sizes ? `${sizes} ${sizes === 1 ? 'size' : 'sizes'}` : '',
    wishes ? `${wishes} on their wish list` : '',
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-xl border transition-colors cursor-pointer ${
        selected ? 'border-clay-400 bg-clay-50' : 'border-cream-200 bg-white hover:bg-cream-50'
      }`}
    >
      <div className={`w-9 h-9 rounded-full ${member.avatarColor || 'bg-clay-500'} text-white flex items-center justify-center shrink-0 font-bold text-[14px]`}>
        {member.avatarUrl
          ? <img src={member.avatarUrl} alt={member.name} className="w-full h-full rounded-full object-cover" />
          : initial(member.name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-bold text-ink-900 truncate">
          {member.name}
          {member.nickname && <span className="font-medium text-ink-500"> · {member.nickname}</span>}
        </p>
        <p className="text-[12px] text-ink-500 tabular-nums truncate">
          {[age || (member.birthdate ? member.birthdate : ''), ...extras].filter(Boolean).join(' · ') || 'Name only'}
        </p>
      </div>
      <ChevronDown className="w-4 h-4 text-ink-400 shrink-0 -rotate-90" />
    </button>
  );
};

