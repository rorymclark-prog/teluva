import React, { useEffect, useRef, useState } from 'react';
import { Users, Briefcase, User, ChevronDown, Check, Loader2, Plus, X, Sparkles, KeyRound } from 'lucide-react';
import { SpaceMembership, SpaceType } from '../types';
import { NewBusinessExtra, suggestBusinessInfo } from '../utils/db';

const TYPE_ICON: Record<SpaceType, typeof Users> = { family: Users, business: Briefcase, personal: User };
const TYPE_LABEL: Record<SpaceType, string> = { family: 'Family', business: 'Business', personal: 'Personal' };

// Small "this came from your chat" tag shown under a prefilled field — clicking
// the X clears just that field's value (it stays editable either way, the tag
// only communicates provenance and offers a one-click way to blank it).
function SuggestedTag({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex items-center gap-1 mt-1 pl-0.5 text-[10.5px] text-clay-600">
      <Sparkles className="w-3 h-3 shrink-0" />
      <span className="flex-1">Suggested from your chat — edit or clear</span>
      <button type="button" onClick={onClear} className="text-ink-400 hover:text-ink-600 cursor-pointer" title="Clear suggestion">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

/**
 * The header's one left-hand control: who you are and where you are.
 *
 * It used to be a grey pill sitting NEXT TO the hub title, which meant a
 * one-space household read its own name twice in a row — "Clark-Family Hub"
 * as the heading and "Clark-Family Hub" again in the pill beside it. So the
 * title itself is now the trigger, the way a workspace name is in Slack,
 * Notion or Linear: one name, tap it to switch or to reach the settings behind
 * it.
 *
 * `footer` is where the account actions live (settings, backup, sign out).
 * They were previously five unlabelled icon buttons occupying a permanent row
 * of the header — prime space for things you touch once a year.
 *
 * Still renders with a single space, so "create a business" stays reachable.
 */
export default function SpaceSwitcher({ spaces, activeId, canCreate, onSwitch, onCreate, onJoin, avatar, title, footer }: {
  spaces: SpaceMembership[];
  activeId: string | null;
  canCreate: boolean;
  onSwitch: (spaceId: string) => Promise<void>;
  onCreate: (name: string, extra?: NewBusinessExtra) => Promise<void>;
  /**
   * Join a DIFFERENT space with an invite code — independent of `canCreate`,
   * since accepting an invite to somewhere else has nothing to do with
   * permissions on the space currently open. Any signed-in member can always
   * try; the server is the real gate (a bad/used/expired code just errors).
   */
  onJoin: (code: string) => Promise<void>;
  /** The hub photo / shield, rendered inside the trigger. */
  avatar?: React.ReactNode;
  /** The hub name. Falls back to the active space's own name. */
  title?: string;
  /** Account actions, appended below the spaces list. */
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const newNameRef = useRef(''); // mirrors newName so the async suggestion fetch can check the LATEST value, not a stale closure
  const ref = useRef<HTMLDivElement>(null);

  // AI-suggested business fields — pulled from the user's other space's chat
  // history / member records the moment "Create a business" opens. Purely a
  // convenience prefill: never blocks the name field, never auto-submits, and
  // the whole app behaves exactly as before when nothing useful is found.
  const [nameSuggested, setNameSuggested] = useState(false);
  const [bizAddress, setBizAddress] = useState('');
  const [addressSuggested, setAddressSuggested] = useState(false);
  const [bizReg, setBizReg] = useState('');
  const [regSuggested, setRegSuggested] = useState(false);
  const [bizIndustry, setBizIndustry] = useState('');
  const [industrySuggested, setIndustrySuggested] = useState(false);
  const [hasBizSuggestion, setHasBizSuggestion] = useState(false); // whether to show the address/reg/industry block at all

  useEffect(() => { newNameRef.current = newName; }, [newName]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Refetched every time the create-a-business form opens (deliberately not
  // cached — see suggestBusinessInfo's own doc comment). suggestBusinessInfo()
  // never throws, so no try/catch is needed here.
  useEffect(() => {
    if (!creating) return;
    let cancelled = false;
    void suggestBusinessInfo().then((s) => {
      if (cancelled) return;
      if (s.name && !newNameRef.current.trim()) {
        setNewName(s.name);
        setNameSuggested(true);
      }
      if (s.address) { setBizAddress(s.address); setAddressSuggested(true); }
      if (s.registrationNumber) { setBizReg(s.registrationNumber); setRegSuggested(true); }
      if (s.industry) { setBizIndustry(s.industry); setIndustrySuggested(true); }
      if (s.address || s.registrationNumber || s.industry) setHasBizSuggestion(true);
    });
    return () => { cancelled = true; };
  }, [creating]);

  const resetCreateForm = () => {
    setCreating(false);
    setNewName(''); setNameSuggested(false);
    setBizAddress(''); setAddressSuggested(false);
    setBizReg(''); setRegSuggested(false);
    setBizIndustry(''); setIndustrySuggested(false);
    setHasBizSuggestion(false);
  };

  const pick = async (spaceId: string) => {
    if (spaceId === activeId || busy) return;
    setBusy(true); setError(null);
    try {
      await onSwitch(spaceId);
      // onSwitch reloads the app on success — nothing more to do here.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch space.');
      setBusy(false);
    }
  };

  const resetJoinForm = () => { setJoining(false); setJoinCode(''); };

  const join = async () => {
    const code = joinCode.trim();
    if (!code || busy) return;
    setBusy(true); setError(null);
    try {
      await onJoin(code);
      // Matches FamilyOnboarding.tsx's own join flow: a full reload picks up
      // the new space everywhere at once (nav, claims, cached data) rather
      // than trying to thread "a space was just added" through every piece
      // of state that cares.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join that space.');
      setBusy(false);
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true); setError(null);
    const extra: NewBusinessExtra = {};
    const address = bizAddress.trim();
    const registrationNumber = bizReg.trim();
    const industry = bizIndustry.trim();
    if (address) extra.address = address;
    if (registrationNumber) extra.registrationNumber = registrationNumber;
    if (industry) extra.industry = industry;
    try {
      await onCreate(name, Object.keys(extra).length ? extra : undefined);
      // onCreate reloads the app on success — nothing more to do here.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the business.');
      setBusy(false);
    }
  };

  const active = spaces.find((s) => s.id === activeId) || spaces[0];
  const ActiveIcon = active ? (TYPE_ICON[active.type] || Users) : Briefcase;

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        data-tour="data-controls"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-w-0 items-center gap-2.5 rounded-2xl -m-1 p-1 pr-2 transition-colors hover:bg-white/10 cursor-pointer disabled:opacity-60 text-white"
        title="Spaces, settings and account"
      >
        {avatar ?? (busy
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <ActiveIcon className="w-4 h-4 shrink-0" />)}
        <h1 className="font-display text-lg font-semibold text-white leading-tight truncate">
          {title || active?.name || TYPE_LABEL[active?.type || 'family']}
        </h1>
        {busy && avatar && <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-white/50" />}
        <ChevronDown className={`w-4 h-4 shrink-0 text-white/50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="menu" className="absolute left-0 mt-2 w-64 bg-white rounded-2xl border border-cream-300 shadow-lift p-1.5 z-50">
          {spaces.map((s) => {
            const Icon = TYPE_ICON[s.type] || Users;
            const isActive = s.id === activeId;
            return (
              <button
                key={s.id}
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); void pick(s.id); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-semibold transition-colors cursor-pointer ${isActive ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-cream-100'}`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left truncate">{s.name || TYPE_LABEL[s.type]}</span>
                {isActive && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            );
          })}

          {canCreate && !joining && (
            <>
              <div className="my-1.5 border-t border-cream-200" />
              {creating ? (
                <div className="p-2 space-y-2">
                  <div>
                    <input
                      type="text"
                      autoFocus
                      placeholder="e.g. Bhanu Pty"
                      value={newName}
                      onChange={(e) => { setNewName(e.target.value); setNameSuggested(false); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
                      className="field w-full text-[13px]"
                      disabled={busy}
                    />
                    {nameSuggested && newName && (
                      <SuggestedTag onClear={() => { setNewName(''); setNameSuggested(false); }} />
                    )}
                  </div>

                  {hasBizSuggestion && (
                    <>
                      <div>
                        <input
                          type="text"
                          placeholder="Business address (optional)"
                          value={bizAddress}
                          onChange={(e) => { setBizAddress(e.target.value); setAddressSuggested(false); }}
                          className="field w-full text-[12.5px]"
                          disabled={busy}
                        />
                        {addressSuggested && bizAddress && (
                          <SuggestedTag onClear={() => { setBizAddress(''); setAddressSuggested(false); }} />
                        )}
                      </div>
                      <div>
                        <input
                          type="text"
                          placeholder="Registration / VAT number (optional)"
                          value={bizReg}
                          onChange={(e) => { setBizReg(e.target.value); setRegSuggested(false); }}
                          className="field w-full text-[12.5px]"
                          disabled={busy}
                        />
                        {regSuggested && bizReg && (
                          <SuggestedTag onClear={() => { setBizReg(''); setRegSuggested(false); }} />
                        )}
                      </div>
                      <div>
                        <input
                          type="text"
                          placeholder="Industry (optional)"
                          value={bizIndustry}
                          onChange={(e) => { setBizIndustry(e.target.value); setIndustrySuggested(false); }}
                          className="field w-full text-[12.5px]"
                          disabled={busy}
                        />
                        {industrySuggested && bizIndustry && (
                          <SuggestedTag onClear={() => { setBizIndustry(''); setIndustrySuggested(false); }} />
                        )}
                      </div>
                    </>
                  )}

                  <div className="flex items-center gap-2">
                    <button type="button" onClick={resetCreateForm} disabled={busy} className="btn-quiet text-[12px] px-2.5 py-1.5 flex-1">Cancel</button>
                    <button type="button" onClick={() => void create()} disabled={busy || !newName.trim()} className="btn-primary text-[12px] px-2.5 py-1.5 flex-1 disabled:opacity-40">
                      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Create'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-semibold text-clay-600 hover:bg-clay-50 transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>Create a business</span>
                </button>
              )}
            </>
          )}

          {/* Join a DIFFERENT space with an invite code — deliberately NOT
              gated behind canCreate. Before this, a second invite link only
              ever worked for a brand-new account: FamilyOnboarding.tsx's
              codeFromUrl() auto-submit only mounts while familyId is still
              null, so anyone who already had a space (the common case for a
              second invite — you're already in your own family, someone
              else invites you into theirs) had no way to accept it at all;
              the link just silently opened their existing dashboard. */}
          {!creating && (
            <>
              <div className="my-1.5 border-t border-cream-200" />
              {joining ? (
                <div className="p-2 space-y-2">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Invite code"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void join(); }}
                    className="field w-full text-[13px]"
                    disabled={busy}
                  />
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={resetJoinForm} disabled={busy} className="btn-quiet text-[12px] px-2.5 py-1.5 flex-1">Cancel</button>
                    <button type="button" onClick={() => void join()} disabled={busy || !joinCode.trim()} className="btn-primary text-[12px] px-2.5 py-1.5 flex-1 disabled:opacity-40">
                      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Join'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setJoining(true)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-semibold text-ink-600 hover:bg-cream-100 transition-colors cursor-pointer"
                >
                  <KeyRound className="w-4 h-4 shrink-0" />
                  <span>Join another space with a code</span>
                </button>
              )}
            </>
          )}

          {error && (
            <div className="flex items-start gap-1.5 mt-1 px-2.5 py-1.5 text-[11px] text-rosa-600">
              <span className="flex-1">{error}</span>
              <button type="button" onClick={() => setError(null)}><X className="w-3 h-3" /></button>
            </div>
          )}

          {/* Account actions. Closing on click is handled here rather than in
              each item, so the caller can pass plain buttons and a <label>
              file-picker without every one of them knowing about this menu. */}
          {footer && !creating && !joining && (
            <div onClick={() => setOpen(false)}>
              <div className="my-1.5 border-t border-cream-200" />
              {footer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
