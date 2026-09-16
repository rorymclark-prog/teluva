import { useCallback, useEffect, useState } from 'react';
import {
  X, Users, Loader2, Plus, Copy, Check, Share2, Link2, Gift, Shirt,
  ShieldCheck, Trash2, ChevronDown, RefreshCcw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import SheetGrabber from './SheetGrabber';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { FamilyMember } from '../types';
import {
  FamilyLink, SharedMember, listFamilyLinks, createFamilyLink, acceptFamilyLink,
  setFamilyLinkShare, loadFamilyLinkProfiles, revokeFamilyLink, sharedAge,
  SHARE_CATEGORIES, ALL_SHARE_CATEGORIES, DEFAULT_SHARE_CATEGORIES, categoriesForMember,
} from '../utils/familyLink';
import type { ShareCategory, ShareMode } from '../utils/familyLink';

interface Props {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  /** This space's own people — the list an admin picks from when sharing. */
  members: FamilyMember[];
  hubName: string;
}

/**
 * Connected families.
 *
 * A second household is NOT a second space. Nobody switches into it, nobody
 * gains a role there, and no document, ID number or medical record crosses.
 * What crosses is a short list of people each admin picks, and for each of
 * them only name, photo, birthday, sizes and wish list — the allowlist in
 * server/familyLink.mjs, enforced on the server before anything reaches this
 * screen.
 *
 * Two decisions this UI has to carry honestly:
 *
 *  1. CONNECTING SHARES NOTHING. The share list starts empty on both sides, so
 *     accepting a code cannot quietly open a household. The panel says so
 *     rather than leaving people to infer it from an empty list.
 *  2. EACH SIDE CHOOSES SEPARATELY. What they share with you and what you
 *     share with them are different lists. Showing them in one place, next to
 *     each other, is the only way that reads as a fact rather than a bug.
 *
 * Everyone in the family can OPEN this and see the cousins — that is the whole
 * point of it. Only an admin can connect, change what is shared, or disconnect.
 */
export default function ConnectedFamilies({ open, onClose, isAdmin, members, hubName }: Props) {
  useBodyScrollLock(open);

  const [links, setLinks] = useState<FamilyLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  // Which link is expanded, and what we have loaded for it. Profiles are
  // fetched per link on demand — the payload carries photos.
  const [openLinkId, setOpenLinkId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, SharedMember[]>>({});
  const [profilesBusy, setProfilesBusy] = useState<string | null>(null);
  const [editingShareFor, setEditingShareFor] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLinks(await listFamilyLinks());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load connected families.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setJoinCode('');
    setJoinError(null);
    setOpenLinkId(null);
    setEditingShareFor(null);
    refresh();
  }, [open, refresh]);

  /* NO AUTO-EXPAND — and this was deliberately reversed, so read this before
   * adding it back.
   *
   * There used to be an effect here that opened the single connected family
   * automatically, on the reasoning that with one link there is nothing to
   * choose between and the tap only hides the people. That reasoning came from
   * a real moment (Rory opened the panel, saw one row, asked where the profiles
   * were) and it is still true in isolation — but it made the panel behave
   * differently depending on how many households you happen to be linked to,
   * and it fetched another family's member list on open without anyone asking
   * for it. Rory asked for collapsed-by-default across both surfaces; the same
   * effect was removed from ConnectedInline.tsx at the same time.
   *
   * If the "where are the profiles?" problem comes back, the fix is a clearer
   * affordance on the row, not an automatic fetch. */

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function handleCreate() {
    setBusy('create');
    setError(null);
    try {
      const link = await createFamilyLink();
      setLinks((prev) => [link, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a code.');
    } finally {
      setBusy(null);
    }
  }

  async function handleAccept() {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setBusy('accept');
    setJoinError(null);
    try {
      await acceptFamilyLink(code);
      setJoinCode('');
      await refresh();
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : 'Could not connect.');
    } finally {
      setBusy(null);
    }
  }

  async function handleOpen(link: FamilyLink) {
    if (openLinkId === link.id) { setOpenLinkId(null); return; }
    setOpenLinkId(link.id);
    setEditingShareFor(null);
    /* ALWAYS REFETCH. This used to bail on `if (profiles[link.id]) return`,
     * which cached the first answer for the life of the panel. The other
     * household can tick a name at any moment and there is no signal here when
     * they do — so the very first expansion, made before they had shared
     * anybody, pinned an empty list in place and re-opening the row kept
     * showing it. The old list stays on screen while this reloads, so a
     * refetch never blanks the panel. */
    if (!profiles[link.id]) setProfilesBusy(link.id);
    try {
      const { members: shared } = await loadFamilyLinkProfiles(link.id);
      setProfiles((p) => ({ ...p, [link.id]: shared }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that family.');
    } finally {
      setProfilesBusy(null);
    }
  }

  /* ONE saver for both dials. Who is shared and what crosses for them are a
   * single decision as far as the document is concerned — the server replaces
   * the whole per-side map on every call, so sending one without the other
   * would quietly wipe the one left out. */
  async function saveShare(
    link: FamilyLink,
    ids: string[],
    fields: Record<string, ShareCategory[]>,
    mode: ShareMode = link.shareMode || 'chosen',
  ) {
    // Optimistic — the server re-validates every id against this space's own
    // member index, so the worst case is this row snapping back on refresh.
    setLinks((prev) => prev.map((l) => (
      l.id === link.id ? { ...l, sharedByMe: ids, shareFields: fields, shareMode: mode } : l
    )));
    setBusy(`share-${link.id}`);
    try {
      const saved = await setFamilyLinkShare(link.id, ids, fields, mode);
      setLinks((prev) => prev.map((l) => (
        l.id === link.id ? {
          ...l,
          sharedByMe: saved.sharedByMe,
          shareFields: saved.shareFields,
          shareMode: saved.shareMode || mode,
          excludedByMe: saved.excludedByMe,
        } : l
      )));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save what you share.');
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  function handleToggleShare(link: FamilyLink, memberId: string) {
    const on = link.sharedByMe.includes(memberId);
    const ids = on
      ? link.sharedByMe.filter((id) => id !== memberId)
      : [...link.sharedByMe, memberId];
    // Un-sharing drops that person's categories too: a rule kept for somebody
    // nobody can see would come back silently if they were ever re-shared.
    const fields = { ...(link.shareFields || {}) };
    if (on) delete fields[memberId];
    void saveShare(link, ids, fields);
  }

  function handleToggleCategory(link: FamilyLink, memberId: string, cat: ShareCategory) {
    const current = categoriesForMember(link.shareFields, memberId);
    const next = current.includes(cat)
      ? current.filter((c) => c !== cat)
      : ALL_SHARE_CATEGORIES.filter((c) => current.includes(c) || c === cat);
    void saveShare(link, link.sharedByMe, { ...(link.shareFields || {}), [memberId]: next });
  }

  /* KEEPING UP AS THE FAMILY GROWS. Rory, twice: "i added new family members
   * bit the other family cannot see them", then "all these new members and
   * none show up on the other family".
   *
   * Switching TO 'everyone' shares everybody currently in the space and every
   * person added afterwards. Switching back to 'chosen' freezes the list where
   * it stands rather than emptying it — the safe direction of a mode change is
   * the one that does not silently un-share people you could see a second
   * ago. */
  function handleSetMode(link: FamilyLink, mode: ShareMode) {
    const ids = mode === 'everyone' ? members.map((m) => m.id) : link.sharedByMe;
    void saveShare(link, ids, link.shareFields || {}, mode);
  }

  async function handleRevoke(link: FamilyLink) {
    setBusy(`revoke-${link.id}`);
    try {
      await revokeFamilyLink(link.id);
      setLinks((prev) => prev.filter((l) => l.id !== link.id));
      setProfiles((p) => { const n = { ...p }; delete n[link.id]; return n; });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disconnect.');
    } finally {
      setBusy(null);
    }
  }

  function handleCopy(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2500);
    }).catch(() => {});
  }

  function handleShareCode(code: string) {
    const text = `Connect our families on Teluva — open Teluva, tap Connected families, and enter the code ${code}. It expires in 14 days.`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({ title: 'Connect our families on Teluva', text }).catch(() => {});
    } else {
      handleCopy(code);
    }
  }

  const active = links.filter((l) => l.status === 'active');
  const pending = links.filter((l) => l.status === 'pending');

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
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
            aria-labelledby="connected-families-title"
            className="card relative w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6 z-10"
          >
            <SheetGrabber onClose={onClose} className="mb-3" />

            <div className="flex items-start justify-between gap-3 pb-4 border-b border-cream-200">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl bg-dusk-100 flex items-center justify-center shrink-0">
                  <Link2 className="w-5 h-5 text-dusk-700" />
                </div>
                <div>
                  <h2 id="connected-families-title" className="font-display text-xl font-bold text-ink-900 leading-tight">
                    Connected families
                  </h2>
                  <p className="text-[13px] text-ink-500 mt-0.5">
                    Cousins, nieces and nephews — sizes, birthdays and wish lists.
                  </p>
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

            {/* What actually crosses. Said once, up front, in the words a
                person would use — not buried under a "learn more". */}
            <div className="mt-4 rounded-2xl bg-sage-50 border border-sage-200 p-3.5 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-sage-700 shrink-0 mt-0.5" />
              <p className="text-[12.5px] text-ink-700 leading-relaxed">
                A connected family sees <span className="font-semibold">only the people you pick</span>, and only their
                name, photo, birthday, clothing sizes and wish list. Never documents, ID numbers, medical notes,
                addresses or phone numbers. They never enter {hubName} — and you choose separately from what they choose.
              </p>
            </div>

            {error && <p className="mt-4 text-[13px] text-rosa-700 bg-rosa-50 rounded-xl px-3 py-2">{error}</p>}

            {loading ? (
              <div className="flex items-center justify-center py-10 text-ink-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {active.length === 0 && pending.length === 0 && (
                  <p className="text-[13px] text-ink-400 py-2">
                    No families connected yet.
                    {isAdmin ? ' Create a code below and send it to them, or enter theirs.' : ' An admin can connect one.'}
                  </p>
                )}

                {active.map((link) => {
                  const shared = profiles[link.id] || [];
                  const isOpen = openLinkId === link.id;
                  return (
                    <div key={link.id} className="rounded-2xl border border-cream-200 bg-white overflow-hidden">
                      <button
                        type="button"
                        onClick={() => handleOpen(link)}
                        aria-expanded={isOpen}
                        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-cream-50 cursor-pointer"
                      >
                        <div className="w-9 h-9 rounded-xl bg-clay-50 text-clay-600 flex items-center justify-center shrink-0">
                          <Users className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-bold text-ink-900 truncate">{link.otherName || 'Connected family'}</p>
                          <p className="text-[12px] text-ink-500 tabular-nums">
                            {link.sharedWithMeCount} shared with you · {link.sharedByMe.length} shared by you
                          </p>
                        </div>
                        <ChevronDown className={`w-4 h-4 text-ink-400 shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                      </button>

                      {isOpen && (
                        <div className="px-4 pb-4 space-y-3 border-t border-cream-200 pt-3">
                          {profilesBusy === link.id ? (
                            <div className="flex items-center gap-2 text-ink-400 text-[13px] py-3">
                              <Loader2 className="w-4 h-4 animate-spin" /> Loading their family…
                            </div>
                          ) : shared.length === 0 ? (
                            <p className="text-[13px] text-ink-400 py-1">
                              Nobody from their family is showing yet. Their admin picks who you can see.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {shared.map((m) => (
                                <div key={m.id}><SharedMemberCard member={m} /></div>
                              ))}
                            </div>
                          )}

                          {isAdmin && (
                            <div className="pt-1">
                              {/* THE QUESTION THIS ANSWERS is "why can't they
                                  see the baby?". Before this, the only place
                                  that fact existed was the difference between
                                  two numbers on two different screens, and the
                                  app said nothing at all. */}
                              {link.status === 'active' && (link.shareMode || 'chosen') === 'chosen'
                                && members.length > link.sharedByMe.length && (
                                <div className="mb-2.5 rounded-2xl border border-clay-300 bg-clay-50 px-3.5 py-3">
                                  <p className="text-[13px] font-bold text-ink-900">
                                    {members.length - link.sharedByMe.length}{' '}
                                    {members.length - link.sharedByMe.length === 1 ? 'person' : 'people'} in your
                                    family {link.otherName || 'they'} cannot see.
                                  </p>
                                  <p className="text-[12.5px] text-ink-600 mt-0.5">
                                    You are picking people one by one, so anyone you add stays hidden
                                    until you tick them.
                                  </p>
                                  <button
                                    type="button"
                                    disabled={busy === `share-${link.id}`}
                                    onClick={() => handleSetMode(link, 'everyone')}
                                    className="btn-primary text-[12.5px] px-3 py-1.5 mt-2.5"
                                  >
                                    <Users className="w-3.5 h-3.5" /> Share everyone, and keep it that way
                                  </button>
                                </div>
                              )}
                              {link.status === 'active' && link.shareMode === 'everyone' && (
                                <div className="mb-2.5 rounded-2xl border border-sage-200 bg-sage-50 px-3.5 py-2.5 flex items-start gap-2.5">
                                  <Users className="w-4 h-4 text-sage-700 shrink-0 mt-0.5" />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[13px] font-semibold text-ink-900">
                                      Everyone, including whoever you add next.
                                    </p>
                                    <p className="text-[12.5px] text-ink-500 mt-0.5">
                                      {link.excludedByMe?.length
                                        ? `${link.excludedByMe.length} left out on purpose.`
                                        : 'Untick anyone below to leave them out.'}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={busy === `share-${link.id}`}
                                    onClick={() => handleSetMode(link, 'chosen')}
                                    className="btn-quiet text-[12px] px-2.5 py-1 shrink-0"
                                  >
                                    Pick instead
                                  </button>
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() => setEditingShareFor(editingShareFor === link.id ? null : link.id)}
                                className="btn-quiet w-full justify-center text-[13px]"
                              >
                                <Users className="w-3.5 h-3.5" />
                                {editingShareFor === link.id ? 'Done' : `Choose who ${link.otherName || 'they'} can see`}
                              </button>

                              {editingShareFor === link.id && (
                                <div className="mt-2.5 space-y-1.5">
                                  {members.length === 0 && (
                                    <p className="text-[13px] text-ink-400">Add someone to your family first.</p>
                                  )}
                                  {members.map((m) => {
                                    const on = link.sharedByMe.includes(m.id);
                                    const cats = categoriesForMember(link.shareFields, m.id);
                                    return (
                                      <div
                                        key={m.id}
                                        className="rounded-xl bg-cream-50 border border-cream-200 overflow-hidden"
                                      >
                                        <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={on}
                                            disabled={busy === `share-${link.id}`}
                                            onChange={() => handleToggleShare(link, m.id)}
                                            className="w-4 h-4 accent-clay-500 cursor-pointer"
                                          />
                                          <span className="text-[13px] text-ink-700 flex-1 truncate">{m.name}</span>
                                          {on && (
                                            <span className="chip bg-sage-100 text-sage-700 tabular-nums">
                                              {cats.includes('care')
                                                ? 'care info too'
                                                : cats.length === DEFAULT_SHARE_CATEGORIES.length
                                                  ? 'shared'
                                                  : `${cats.length} of ${DEFAULT_SHARE_CATEGORIES.length}`}
                                            </span>
                                          )}
                                        </label>

                                        {/* WHAT crosses, once you have said WHO. Only under a person
                                            who is actually shared — offering the dial for somebody
                                            nobody can see is a setting that does nothing. */}
                                        {on && (
                                          <div className="px-3 pb-2.5 pt-0.5 flex flex-wrap gap-1.5">
                                            {SHARE_CATEGORIES.map((c) => {
                                              const active = cats.includes(c.id);
                                              return (
                                                <button
                                                  key={c.id}
                                                  type="button"
                                                  onClick={() => handleToggleCategory(link, m.id, c.id)}
                                                  disabled={busy === `share-${link.id}`}
                                                  title={c.hint}
                                                  aria-pressed={active}
                                                  className={`chip cursor-pointer transition-colors ${
                                                    active
                                                      ? c.optIn
                                                        /* Health data reads differently from a shoe
                                                           size, so it must LOOK different when on —
                                                           a row of identical green chips is how you
                                                           stop noticing which one is the serious. */
                                                        ? 'bg-clay-100 text-clay-700 border border-clay-300 font-bold'
                                                        : 'bg-sage-100 text-sage-700 border border-sage-200'
                                                      : 'bg-cream-200 text-ink-400 border border-transparent line-through'
                                                  }`}
                                                >
                                                  {c.label}
                                                </button>
                                              );
                                            })}
                                            <span className="w-full text-[11.5px] text-ink-400 mt-0.5">
                                              Their name is always shared — everything else is your call.
                                            </span>
                                            {cats.includes('care') && (
                                              <span className="w-full text-[11.5px] text-clay-700 font-semibold">
                                                {link.otherName || 'They'} can see {m.name}&rsquo;s allergies,
                                                medicines and emergency number. Switch it off when they
                                                are home again.
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={() => handleRevoke(link)}
                                disabled={busy === `revoke-${link.id}`}
                                className="btn-quiet w-full justify-center text-[13px] text-rosa-700 mt-2"
                              >
                                {busy === `revoke-${link.id}`
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : <Trash2 className="w-3.5 h-3.5" />}
                                Disconnect this family
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {pending.map((link) => (
                  <div key={link.id} className="rounded-2xl border border-honey-200 bg-honey-50 p-4 space-y-2.5">
                    <p className="text-[13px] font-bold text-ink-900">Waiting for them to enter this code</p>
                    <p className="font-mono text-2xl font-bold tracking-[0.2em] text-clay-700 tabular-nums">{link.code}</p>
                    <p className="text-[12px] text-ink-500">
                      Their family admin opens Teluva → Connected families → enters this code. It expires in 14 days.
                    </p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => handleCopy(link.code || '')} className="btn-quiet flex-1 justify-center text-[13px]">
                        {copiedCode === link.code ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedCode === link.code ? 'Copied' : 'Copy code'}
                      </button>
                      <button type="button" onClick={() => handleShareCode(link.code || '')} className="btn-quiet flex-1 justify-center text-[13px]">
                        <Share2 className="w-3.5 h-3.5" /> Send
                      </button>
                    </div>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(link)}
                        disabled={busy === `revoke-${link.id}`}
                        className="btn-quiet w-full justify-center text-[13px] text-rosa-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Cancel this code
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {isAdmin && !loading && (
              <div className="mt-5 pt-5 border-t border-cream-200 space-y-4">
                <div>
                  <h3 className="section-label mb-2">Connect another family</h3>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={busy === 'create'}
                    className="btn-primary w-full justify-center text-[13px] disabled:opacity-50"
                  >
                    {busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Create a connection code
                  </button>
                </div>

                <div>
                  <h3 className="section-label mb-2">Or enter their code</h3>
                  <div className="flex gap-2">
                    <input
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder="ABCD1234"
                      maxLength={8}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      className="field flex-1 font-mono tracking-[0.15em] uppercase"
                    />
                    <button
                      type="button"
                      onClick={handleAccept}
                      disabled={!joinCode.trim() || busy === 'accept'}
                      className="btn-primary shrink-0 justify-center text-[13px] disabled:opacity-40"
                    >
                      {busy === 'accept' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                      Connect
                    </button>
                  </div>
                  {joinError && <p className="mt-2 text-[13px] text-rosa-700">{joinError}</p>}
                </div>

                <button type="button" onClick={refresh} className="btn-quiet w-full justify-center text-[12.5px]">
                  <RefreshCcw className="w-3.5 h-3.5" /> Refresh
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** One person from the other household, showing only what actually arrived. */
interface SharedMemberCardProps { member: SharedMember }

function SharedMemberCard({ member }: SharedMemberCardProps) {
  const [openWishlist, setOpenWishlist] = useState(false);
  const age = sharedAge(member.birthdate);
  const sizes = member.clothingSizes || {};
  const sizeBits = [
    sizes.tops && `tops ${sizes.tops}`,
    sizes.bottoms && `bottoms ${sizes.bottoms}`,
    sizes.shoes && `shoes ${sizes.shoes}`,
    sizes.dressSize && `dress ${sizes.dressSize}`,
    sizes.jacketSize && `jacket ${sizes.jacketSize}`,
    sizes.ringSize && `ring ${sizes.ringSize}`,
  ].filter(Boolean) as string[];
  const favorites = member.favorites || [];

  return (
    <div className="rounded-xl border border-cream-200 bg-cream-50 p-3">
      <div className="flex items-center gap-3">
        {member.avatarUrl ? (
          <img src={member.avatarUrl} alt={member.name} className="w-11 h-11 rounded-full object-cover shrink-0 bg-white" />
        ) : (
          <div className={`w-11 h-11 rounded-full ${member.avatarColor || 'bg-clay-500'} text-white font-bold flex items-center justify-center uppercase shrink-0`}>
            {member.name.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-ink-900 truncate">
            {member.nickname ? `${member.name} (${member.nickname})` : member.name}
          </p>
          <p className="text-[12px] text-ink-500 tabular-nums">
            {age ? `${age}` : ''}{age && member.birthdate ? ' · ' : ''}{member.birthdate || ''}
          </p>
        </div>
      </div>

      {sizeBits.length > 0 && (
        <p className="mt-2 text-[12px] text-ink-600 flex items-start gap-1.5">
          <Shirt className="w-3.5 h-3.5 shrink-0 mt-0.5 text-ink-400" />
          <span>{sizeBits.join(' · ')}</span>
        </p>
      )}

      {favorites.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpenWishlist((v) => !v)}
            aria-expanded={openWishlist}
            className="text-[12px] text-clay-700 font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Gift className="w-3.5 h-3.5" />
            {favorites.length} gift idea{favorites.length !== 1 ? 's' : ''}
            <ChevronDown className={`w-3 h-3 transition-transform ${openWishlist ? '' : '-rotate-90'}`} />
          </button>
          {openWishlist && (
            <ul className="mt-1.5 space-y-1">
              {favorites.map((f) => (
                <li key={f.id} className="text-[12.5px] text-ink-700 flex items-center gap-2">
                  <span className={`flex-1 truncate ${f.bought ? 'line-through text-ink-400' : ''}`}>{f.title}</span>
                  {f.targetPrice && <span className="text-ink-400 tabular-nums shrink-0">{f.targetPrice}</span>}
                  {f.bought && <span className="chip bg-cream-200 text-ink-500 shrink-0">already bought</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
