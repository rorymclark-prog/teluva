import React, { useEffect, useState } from 'react';
import { X, Copy, Check, Users, ShieldCheck, Loader2, Share2, Link, Sparkles, Globe, PartyPopper, Plus, Trash2, Trophy, TrendingUp, UserMinus, AlertTriangle } from 'lucide-react';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { loadFamilyRoles, setFamilyMemberRole, removeFamilyMember, loadSettings, saveSettings, loadSpaceInfo, saveFoundingDate, loadBusinessMilestones, saveBusinessMilestones, deleteFamily, loadAiUsage } from '../utils/db';
import { FamilyRole, FamilyMemberRole, IdCountry, BusinessMilestonesDoc, BusinessMilestoneEntry, BusinessMilestoneKind, HeadcountLog, AiUsage } from '../types';
import { COUNTRY_OPTIONS } from './HubSettingsModal';
import { headcountTrend } from '../utils/businessMilestone';
import SheetGrabber from './SheetGrabber';

const MILESTONE_KINDS: BusinessMilestoneKind[] = ['First customer', 'New location', 'Certification / licence', 'Revenue target', 'Product launch', 'Funding', 'Award / recognition', 'Other'];

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// Today's date in the USER'S timezone as YYYY-MM-DD. Same convention as
// toISODate() in utils/vehicle.ts and utils/businessMilestone.ts — never
// Date#toISOString(), which shifts to UTC and rolls the date over early
// for anyone east of Greenwich.
function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

interface FamilySettingsProps {
  onClose: () => void;
}

const ROLE_OPTIONS: FamilyRole[] = ['admin', 'member', 'child'];

function initials(displayName: string, email: string): string {
  const name = displayName || email;
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/**
 * Admin-only panel: shows the family join code and lets the admin manage member roles.
 * Rendered as a slide-in modal — parent component gates rendering to isAdmin only.
 */
export default function FamilySettings({ onClose }: FamilySettingsProps) {
  const { familyId, uid: currentUid, aiEligible, aiConsent, setAiConsent, spaces } = useFamilyCtx();
  const isBusinessSpace = spaces.find((s) => s.id === familyId)?.type === 'business';

  // --- Country (drives which ID/passport template MemberIDs shows) — each
  // space (family and business) has its own, independent of the other.
  const [country, setCountry] = useState<IdCountry>('AT');
  const [countrySaving, setCountrySaving] = useState(false);
  useEffect(() => {
    loadSettings().then((s) => { if (s?.country) setCountry(s.country); });
  }, [familyId]);
  const handleCountryChange = async (value: IdCountry) => {
    setCountry(value);
    setCountrySaving(true);
    try {
      const current = (await loadSettings()) || {};
      await saveSettings({ ...current, country: value });
    } finally {
      setCountrySaving(false);
    }
  };

  // --- Founding date (Business Milestones) — business-only. The whole panel
  // is already admin-gated by the parent (Dashboard renders FamilySettings
  // for admins only), same as the Country field above needs no extra check.
  const [foundingDate, setFoundingDate] = useState('');
  const [foundingSaving, setFoundingSaving] = useState(false);
  const [foundingError, setFoundingError] = useState<string | null>(null);
  useEffect(() => {
    if (!isBusinessSpace) return;
    loadSpaceInfo().then((info) => { if (info?.foundingDate) setFoundingDate(info.foundingDate); });
  }, [familyId, isBusinessSpace]);
  const handleFoundingDateChange = async (value: string) => {
    setFoundingDate(value);
    setFoundingError(null);
    if (!value) return;
    setFoundingSaving(true);
    try {
      await saveFoundingDate(value);
    } catch (err: any) {
      setFoundingError(err?.message ?? 'Could not save the founding date');
    } finally {
      setFoundingSaving(false);
    }
  };

  // --- Business Milestones (business-only): owner-defined growth timeline +
  // headcount log, alongside the founding date above. Read utils/businessMilestone.ts
  // first if extending this — nextMilestoneAnniversary/headcountTrend live there,
  // shared with NeedsAttention/CelebrationOverlay so an anniversary resurfaces
  // the same way a birthday does.
  const [milestonesDoc, setMilestonesDoc] = useState<BusinessMilestonesDoc>({ milestones: [], headcount: [] });
  const [milestonesLoading, setMilestonesLoading] = useState(false);
  const [milestonesError, setMilestonesError] = useState<string | null>(null);
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('');
  const [newMilestoneDate, setNewMilestoneDate] = useState('');
  const [newMilestoneKind, setNewMilestoneKind] = useState<BusinessMilestoneKind>('First customer');
  const [newHeadcountDate, setNewHeadcountDate] = useState(localToday());
  const [newHeadcountCount, setNewHeadcountCount] = useState('');

  useEffect(() => {
    if (!isBusinessSpace) return;
    setMilestonesLoading(true);
    loadBusinessMilestones()
      .then((d) => setMilestonesDoc(d || { milestones: [], headcount: [] }))
      .catch(() => setMilestonesDoc({ milestones: [], headcount: [] }))
      .finally(() => setMilestonesLoading(false));
  }, [familyId, isBusinessSpace]);

  const persistMilestones = async (next: BusinessMilestonesDoc) => {
    setMilestonesDoc(next);
    setMilestonesError(null);
    try {
      await saveBusinessMilestones(next);
    } catch (err: any) {
      setMilestonesError(err?.message ?? 'Could not save — please try again');
    }
  };

  const handleAddMilestone = () => {
    if (!newMilestoneTitle.trim() || !newMilestoneDate) return;
    const entry: BusinessMilestoneEntry = {
      id: newId('ms'),
      title: newMilestoneTitle.trim(),
      date: newMilestoneDate,
      kind: newMilestoneKind,
    };
    persistMilestones({ ...milestonesDoc, milestones: [...milestonesDoc.milestones, entry] });
    setNewMilestoneTitle('');
    setNewMilestoneDate('');
  };

  const handleDeleteMilestone = (id: string) => {
    persistMilestones({ ...milestonesDoc, milestones: milestonesDoc.milestones.filter((m) => m.id !== id) });
  };

  const handleAddHeadcount = () => {
    const count = parseInt(newHeadcountCount, 10);
    if (!newHeadcountDate || Number.isNaN(count) || count < 0) return;
    const entry: HeadcountLog = { id: newId('hc'), date: newHeadcountDate, count };
    persistMilestones({ ...milestonesDoc, headcount: [...milestonesDoc.headcount, entry] });
    setNewHeadcountCount('');
  };

  const handleDeleteHeadcount = (id: string) => {
    persistMilestones({ ...milestonesDoc, headcount: milestonesDoc.headcount.filter((h) => h.id !== id) });
  };

  const sortedMilestones = [...milestonesDoc.milestones].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const sortedHeadcount = [...milestonesDoc.headcount].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const trend = headcountTrend(milestonesDoc.headcount);

  // --- Invite codes (single-use, 14-day, server-issued) ---
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<'member' | 'child'>('member');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const joinUrl = inviteCode ? `${window.location.origin}/join/${inviteCode}` : null;

  async function handleGenerateInvite() {
    setInviteLoading(true);
    setInviteError(null);
    try {
      const { auth } = await import('../lib/firebase');
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/create-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: inviteRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not create an invite.');
      setInviteCode(data.code);
    } catch (e: any) {
      setInviteError(e?.message || 'Could not create an invite.');
    } finally {
      setInviteLoading(false);
    }
  }

  function handleCopy() {
    if (!joinUrl) return;
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  function handleShare() {
    if (!joinUrl) return;
    if (navigator.share) {
      navigator.share({
        title: 'Join our Family Vault',
        text: `Tap this link to join our private family vault (invite code ${inviteCode}).`,
        url: joinUrl,
      }).catch(() => {});
    } else {
      handleCopy();
    }
  }

  // --- Member roles ---
  const [roles, setRoles] = useState<Record<string, FamilyMemberRole>>({});
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [savingUid, setSavingUid] = useState<string | null>(null);

  useEffect(() => {
    if (!familyId) return;
    setRolesLoading(true);
    loadFamilyRoles(familyId)
      .then((r) => { setRoles(r); setRolesLoading(false); })
      .catch((err) => {
        setRolesError(err?.message ?? 'Could not load members');
        setRolesLoading(false);
      });
  }, [familyId]);

  async function handleRoleChange(targetUid: string, newRole: FamilyRole) {
    if (!familyId) return;
    // Prevent admin self-demotion
    if (targetUid === currentUid && newRole !== 'admin') return;

    setSavingUid(targetUid);
    try {
      await setFamilyMemberRole(familyId, targetUid, newRole);
      setRoles((prev) => ({
        ...prev,
        [targetUid]: { ...prev[targetUid], role: newRole },
      }));
    } catch (err: any) {
      setRolesError(err?.message ?? 'Could not update role');
    } finally {
      setSavingUid(null);
    }
  }

  // --- Removing a member ---
  // Two-step: the row's "Remove" button arms a confirmation panel that NAMES
  // the person and spells out exactly what they lose, because this is the one
  // irreversible action in this panel (they can only come back via a fresh
  // invite code). removingUid = armed; removeBusyUid = in flight.
  const [removingUid, setRemovingUid] = useState<string | null>(null);
  const [removeBusyUid, setRemoveBusyUid] = useState<string | null>(null);

  async function handleRemoveMember(targetUid: string) {
    setRemoveBusyUid(targetUid);
    setRolesError(null);
    try {
      await removeFamilyMember(targetUid);
      setRoles((prev) => {
        const next = { ...prev };
        delete next[targetUid];
        return next;
      });
      setRemovingUid(null);
    } catch (err: any) {
      setRolesError(err?.message ?? 'Could not remove that member');
    } finally {
      setRemoveBusyUid(null);
    }
  }

  // --- AI assistant consent (GDPR opt-in/withdrawal) ---
  const [aiSaving, setAiSaving] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Honest usage indicator — same server-read numbers as the assistant sheet
  // (AIChatbot.tsx), never recomputed client-side. Loaded once per space.
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);
  useEffect(() => {
    let active = true;
    loadAiUsage().then((u) => { if (active) setAiUsage(u); });
    return () => { active = false; };
  }, [familyId]);

  async function handleToggleAi() {
    if (aiSaving) return;
    setAiSaving(true);
    setAiError(null);
    try {
      await setAiConsent(!aiConsent);
    } catch (err: any) {
      setAiError(err?.message ?? 'Could not update the AI assistant setting');
    } finally {
      setAiSaving(false);
    }
  }

  // --- Danger zone: permanently delete this family/business (admin-only —
  // this whole panel is already admin-gated by the parent). Genuine
  // confirmation: the exact space name must be typed, not just clicked twice.
  // Server-side (/api/delete-family) independently re-checks the typed name
  // and re-verifies admin status — this is not the real safety check, just
  // the UI gate in front of it. ---
  const spaceName = spaces.find((s) => s.id === familyId)?.name || (isBusinessSpace ? 'this business' : 'this family');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDeleteFamily() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteFamily(deleteTyped.trim());
      // The space is gone server-side — force a full reload so FamilyProvider
      // re-resolves everything from scratch (another remaining space, or
      // onboarding) instead of the app trying to keep rendering against a
      // family that no longer exists.
      window.location.reload();
    } catch (err: any) {
      setDeleteError(err?.message ?? 'Could not delete. Please try again.');
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink-900/30 backdrop-blur-sm anim-fade" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-md h-full bg-cream-50 shadow-2xl flex flex-col overflow-y-auto anim-sheet">
        {/* Mobile grabber bar */}
        <SheetGrabber onClose={onClose} className="shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-cream-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-sage-100 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-sage-600" />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold text-ink-900 leading-tight">
                {isBusinessSpace ? 'Business Settings' : 'Family Settings'}
              </h2>
              <p className="text-[11px] text-ink-400 font-medium leading-tight">Admin controls</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-quiet p-2" title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 p-6 space-y-6">
          {/* Section 0: Country — drives which ID/passport fields show. Each
              space has its own, so a family and its business can differ. */}
          <div className="card p-5 space-y-2">
            <h3 className="section-label flex items-center gap-2">
              <Globe size={14} />
              Country
            </h3>
            <p className="text-[13px] text-ink-500">
              Sets which ID & passport fields {isBusinessSpace ? 'this business' : 'this family'} sees. Independent from your other space.
            </p>
            <select
              value={country}
              onChange={(e) => handleCountryChange(e.target.value as IdCountry)}
              disabled={countrySaving}
              className="field disabled:opacity-60"
            >
              {COUNTRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Section 0b: Founding date (Business Milestones) — business-only */}
          {isBusinessSpace && (
            <div className="card p-5 space-y-2">
              <h3 className="section-label flex items-center gap-2">
                <PartyPopper size={14} />
                Founding date
              </h3>
              <p className="text-[13px] text-ink-500">
                When this business was founded or registered. Shows an anniversary reminder each year and lets the assistant add it to the calendar.
              </p>
              <input
                type="date"
                value={foundingDate}
                onChange={(e) => handleFoundingDateChange(e.target.value)}
                disabled={foundingSaving}
                max={localToday()}
                className="field disabled:opacity-60"
              />
              {foundingError && (
                <p className="text-xs text-rosa-700 bg-rosa-50 rounded-xl px-3 py-2">{foundingError}</p>
              )}
            </div>
          )}

          {/* Section 0c: Milestones & growth (Business Milestones) — business-only.
              Owner-defined growth events + a manually-kept headcount log. An
              anniversary of any milestone below resurfaces the way a birthday
              does, via NeedsAttention/CelebrationOverlay (see nextMilestoneAnniversary
              in utils/businessMilestone.ts). */}
          {isBusinessSpace && (
            <div className="card p-5 space-y-4">
              <h3 className="section-label flex items-center gap-2">
                <Trophy size={14} />
                Milestones &amp; growth
              </h3>
              <p className="text-[13px] text-ink-500 -mt-1">
                First customer, a new location, a certification, a revenue target hit — log the moments worth remembering.
                Each one gets its own anniversary reminder, just like a birthday.
              </p>

              {milestonesError && (
                <p className="text-xs text-rosa-700 bg-rosa-50 rounded-xl px-3 py-2">{milestonesError}</p>
              )}

              {/* Add a milestone */}
              <div className="space-y-2 p-3 rounded-xl bg-cream-50 border border-cream-200">
                <input
                  type="text"
                  placeholder="e.g. Signed our first customer, Café Wien"
                  value={newMilestoneTitle}
                  onChange={(e) => setNewMilestoneTitle(e.target.value)}
                  className="field w-full text-[13px]"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={newMilestoneDate}
                    max={localToday()}
                    onChange={(e) => setNewMilestoneDate(e.target.value)}
                    className="field flex-1 text-[13px]"
                  />
                  <select
                    value={newMilestoneKind}
                    onChange={(e) => setNewMilestoneKind(e.target.value as BusinessMilestoneKind)}
                    className="field w-auto text-[13px]"
                  >
                    {MILESTONE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                  <button
                    onClick={handleAddMilestone}
                    disabled={!newMilestoneTitle.trim() || !newMilestoneDate}
                    className="btn-primary shrink-0 px-3 py-2 disabled:opacity-40"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              {/* Milestone list */}
              {!milestonesLoading && sortedMilestones.length > 0 && (
                <div className="space-y-1.5">
                  {sortedMilestones.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-cream-200">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-ink-800 truncate">{m.title}</p>
                        <p className="text-[11px] text-ink-400">{m.date} · {m.kind}</p>
                      </div>
                      <button onClick={() => handleDeleteMilestone(m.id)} className="p-1.5 text-ink-300 hover:text-rosa-600 rounded-lg shrink-0" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Headcount log */}
              <div className="pt-3 border-t border-cream-200 space-y-2.5">
                <h4 className="text-[12px] font-semibold text-ink-500 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp size={12} /> Headcount over time
                </h4>
                {trend && (
                  <p className="text-[13px] text-ink-600">
                    {trend.latest.count} today
                    {trend.deltaSinceFirst !== 0 && (
                      <span className="text-ink-400"> · {trend.deltaSinceFirst > 0 ? '+' : ''}{trend.deltaSinceFirst} since {trend.first.date}</span>
                    )}
                    {trend.isAllTimeHigh && trend.deltaSinceFirst > 0 && <span className="text-sage-600 font-medium"> · biggest the team's been 🌱</span>}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={newHeadcountDate}
                    max={localToday()}
                    onChange={(e) => setNewHeadcountDate(e.target.value)}
                    className="field flex-1 text-[13px]"
                  />
                  <input
                    type="number"
                    min={0}
                    placeholder="Count"
                    value={newHeadcountCount}
                    onChange={(e) => setNewHeadcountCount(e.target.value)}
                    className="field w-24 text-[13px]"
                  />
                  <button
                    onClick={handleAddHeadcount}
                    disabled={!newHeadcountDate || !newHeadcountCount}
                    className="btn-primary shrink-0 px-3 py-2 disabled:opacity-40"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {sortedHeadcount.length > 0 && (
                  <div className="space-y-1.5">
                    {sortedHeadcount.map((h) => (
                      <div key={h.id} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-cream-200">
                        <p className="text-[13px] text-ink-700 flex-1">{h.date} — <span className="font-semibold">{h.count}</span></p>
                        <button onClick={() => handleDeleteHeadcount(h.id)} className="p-1 text-ink-300 hover:text-rosa-600 rounded-lg shrink-0" title="Delete">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Section 1: Invite codes */}
          <div className="card p-5 space-y-3">
            <h3 className="section-label flex items-center gap-2">
              <Link size={13} />
              Invite someone
            </h3>
            <p className="text-[13px] text-ink-500">
              Create a single-use invite code (valid 14 days). Send the link — they tap it, sign in with Google, and join.
            </p>

            <div className="flex items-center gap-2">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'member' | 'child')}
                className="field w-auto text-[13px]"
              >
                <option value="member">Invite as member</option>
                <option value="child">{isBusinessSpace ? 'Invite as viewer (view only)' : 'Invite as child (view only)'}</option>
              </select>
              <button
                onClick={handleGenerateInvite}
                disabled={inviteLoading}
                className={`flex-1 justify-center gap-2 disabled:opacity-40 ${inviteCode ? 'btn-quiet' : 'btn-primary'}`}
              >
                {inviteLoading ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />}
                {inviteCode ? 'New invite code' : 'Create invite code'}
              </button>
            </div>

            {inviteError && (
              <p className="text-xs text-rosa-700 bg-rosa-50 rounded-xl px-3 py-2">{inviteError}</p>
            )}

            {inviteCode && (
              <>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-cream-100 border border-cream-300 rounded-xl px-3 py-2 text-[13px] font-mono font-bold text-ink-800 break-all select-all leading-relaxed text-center tracking-widest">
                    {inviteCode}
                  </code>
                  <button
                    onClick={handleCopy}
                    title={copied ? 'Copied!' : 'Copy link'}
                    className="shrink-0 btn-quiet p-2 rounded-xl"
                  >
                    {copied ? <Check size={16} className="text-sage-500" /> : <Copy size={16} />}
                  </button>
                </div>
                <button
                  onClick={handleShare}
                  className="btn-primary w-full justify-center gap-2"
                >
                  <Share2 size={15} />
                  {typeof navigator !== 'undefined' && navigator.share ? 'Share invite link' : 'Copy invite link'}
                </button>
                {copied && <p className="text-xs text-sage-600 text-center">Link copied to clipboard!</p>}
              </>
            )}
          </div>

          {/* Section 2: Family Members */}
          <div className="card p-5 space-y-4">
            <h3 className="section-label flex items-center gap-2">
              <Users size={14} />
              {isBusinessSpace ? 'Team Members' : 'Family Members'}
            </h3>

            {rolesLoading && (
              <div className="flex items-center justify-center py-6 text-ink-400">
                <Loader2 size={20} className="animate-spin mr-2" />
                <span className="text-sm">Loading members…</span>
              </div>
            )}

            {rolesError && (
              <p className="text-sm text-rosa-700 bg-rosa-50 rounded-xl px-3 py-2">{rolesError}</p>
            )}

            {!rolesLoading && !rolesError && Object.keys(roles).length === 0 && (
              <p className="text-[13px] text-ink-400">No members found.</p>
            )}

            {!rolesLoading && (Object.entries(roles) as [string, FamilyMemberRole][]).map(([memberUid, member]) => {
              const isSelf = memberUid === currentUid;
              const isSaving = savingUid === memberUid;
              const avatarText = initials(member.displayName, member.email);

              const personLabel = member.displayName || member.email;
              const isRemoving = removeBusyUid === memberUid;

              return (
                <div key={memberUid} className="space-y-2">
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-sage-100 text-sage-700 flex items-center justify-center text-xs font-bold shrink-0">
                      {avatarText}
                    </div>

                    {/* Name + email */}
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-ink-800 truncate">
                        {personLabel}
                        {isSelf && <span className="ml-1 text-ink-400 font-normal">(you)</span>}
                      </div>
                      <div className="text-[11px] text-ink-400 truncate">{member.email}</div>
                    </div>

                    {/* Role selector */}
                    <div className="relative shrink-0">
                      {isSaving
                        ? <Loader2 size={16} className="animate-spin text-ink-400" />
                        : (
                          <select
                            value={member.role}
                            onChange={(e) => handleRoleChange(memberUid, e.target.value as FamilyRole)}
                            disabled={isSelf}
                            className="field text-xs py-1 px-2 pr-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                            title={isSelf ? 'Cannot change your own role' : undefined}
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        )
                      }
                    </div>

                    {/* Remove — never offered for yourself (the server refuses
                        self-removal too, so a space can't be orphaned). */}
                    {!isSelf && (
                      <button
                        type="button"
                        onClick={() => setRemovingUid(removingUid === memberUid ? null : memberUid)}
                        disabled={isRemoving}
                        title={`Remove ${personLabel}`}
                        aria-label={`Remove ${personLabel}`}
                        className="shrink-0 btn-quiet p-2 rounded-xl text-rosa-600 disabled:opacity-40"
                      >
                        {isRemoving ? <Loader2 size={15} className="animate-spin" /> : <UserMinus size={15} />}
                      </button>
                    )}
                  </div>

                  {removingUid === memberUid && (
                    <div className="rounded-xl bg-rosa-50 border border-rosa-200 p-3 space-y-2">
                      <p className="text-[13px] font-medium text-rosa-800">
                        Remove {personLabel} from {isBusinessSpace ? 'this business' : 'this family'}?
                      </p>
                      <p className="text-[11px] text-rosa-700 leading-relaxed">
                        They immediately lose access to everything in {isBusinessSpace ? 'this business space' : 'this family vault'} —
                        every member profile, document scan, passport and ID record, the calendar,
                        household and finance details, and the assistant. Anything they added stays here.
                        They can only come back with a new invite code.
                      </p>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setRemovingUid(null)}
                          disabled={isRemoving}
                          className="btn-quiet flex-1 justify-center text-[13px] disabled:opacity-40"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(memberUid)}
                          disabled={isRemoving}
                          className="btn-danger flex-1 justify-center gap-2 text-[13px] disabled:opacity-40"
                        >
                          {isRemoving && <Loader2 size={14} className="animate-spin" />}
                          {isRemoving ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Section 3: AI assistant (adults only — child accounts never see this) */}
          {aiEligible && (
            <div className="card p-5 space-y-4">
              <h3 className="section-label flex items-center gap-2">
                <Sparkles size={14} />
                AI Assistant
              </h3>

              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-ink-800">AI assistant</div>
                  <p className="text-[11px] text-ink-400 leading-relaxed mt-0.5">
                    Answer questions, read documents from photos, and restyle avatars. Processed by Google Vertex AI in the EU — your content is not used to train Google's models.
                  </p>
                  <p className="text-[11px] text-ink-400 leading-relaxed mt-1">
                    Turning this off immediately stops AI processing and disables the assistant everywhere in Teluva.
                  </p>
                  {aiError && (
                    <p className="text-xs text-rosa-700 bg-rosa-50 rounded-xl px-3 py-2 mt-2">{aiError}</p>
                  )}
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={aiConsent}
                  aria-label="AI assistant"
                  disabled={aiSaving}
                  onClick={handleToggleAi}
                  className={`relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${aiConsent ? 'bg-sage-500' : 'bg-cream-300'}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-cream-50 shadow-sm transition-transform duration-200 ${aiConsent ? 'translate-x-5' : 'translate-x-0'}`}
                  />
                </button>
              </div>

              {/* Honest usage indicator — server numbers only, shown quietly
                  (no warning colours, no nagging) below the toggle. Hidden on
                  the paid plan's effectively-unlimited ceiling. */}
              {aiUsage && aiUsage.plan === 'free' && (
                <p className="text-[11px] text-ink-400 border-t border-cream-200 pt-3">
                  {aiUsage.used} of {aiUsage.limit} AI actions used this month · resets {aiUsage.resetsOn}
                </p>
              )}
            </div>
          )}

          {/* Birthday reminders (Web Push) now live in HubSettingsModal, which
              every member can reach — this panel is admin-only, so mounting the
              card here meant nobody but the admin could ever turn notifications
              on or learn they must add the app to their Home Screen first. */}

          {/* Section 5: Danger zone — permanent deletion */}
          <div className="card p-5 space-y-3 border border-rosa-200">
            <h3 className="section-label flex items-center gap-2 text-rosa-700">
              <AlertTriangle size={14} />
              Danger zone
            </h3>

            {!showDeleteConfirm ? (
              <>
                <p className="text-[13px] text-ink-500">
                  Permanently delete {isBusinessSpace ? 'this business' : 'this family'} — every member
                  profile, document and photo file, calendar event, password, and record. This cannot be
                  undone.
                </p>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="btn-quiet w-full justify-center text-rosa-700 border border-rosa-200 hover:bg-rosa-50"
                >
                  Delete {isBusinessSpace ? 'business' : 'family'}…
                </button>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-[13px] text-rosa-700 bg-rosa-50 border border-rosa-100 rounded-xl px-3 py-2">
                  This permanently deletes <b>every member profile, document/photo file, calendar event,
                  password, and record</b> belonging to &ldquo;{spaceName}&rdquo; — for everyone in it.
                  There is no undo and no recovery.
                </p>
                <p className="text-[13px] text-ink-500">
                  Type <b>{spaceName}</b> below to confirm.
                </p>
                <input
                  type="text"
                  value={deleteTyped}
                  onChange={(e) => setDeleteTyped(e.target.value)}
                  placeholder={spaceName}
                  disabled={deleting}
                  className="field disabled:opacity-60"
                  autoFocus
                />
                {deleteError && (
                  <p className="text-xs text-rosa-700 bg-rosa-50 rounded-xl px-3 py-2">{deleteError}</p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setShowDeleteConfirm(false); setDeleteTyped(''); setDeleteError(null); }}
                    disabled={deleting}
                    className="btn-quiet flex-1 justify-center disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteFamily}
                    disabled={deleting || deleteTyped.trim().toLowerCase() !== spaceName.trim().toLowerCase()}
                    className="flex-1 justify-center gap-2 bg-rosa-500 hover:bg-rosa-700 text-white rounded-2xl px-4 py-2.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center"
                  >
                    {deleting ? <Loader2 size={15} className="animate-spin" /> : null}
                    Permanently delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
