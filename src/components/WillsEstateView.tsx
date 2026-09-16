import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollText, Plus, Pencil, Trash2, X, Loader2, Info, User, Landmark,
  HandHeart, Paperclip, Upload, Eye, AlertCircle, MapPin, Phone, HandCoins,
  Users, Key, Check, Lock, UserPlus, Send, Clock, Printer, BellRing, ThumbsUp,
} from 'lucide-react';
import {
  EstateRecord, FamilyMember, VaultDocument, FamilyDocument, InsurancePolicy,
  WillsEstateDoc, DesignatedSuccessor, SuccessorShareLevel, EmergencyInstructions, NotifyContact, AccountToClose, FamilyMemberRole,
  WillsAccessDoc, PendingWillReader, FinancesInfo, EstateDocStatus, EstateRegistryStatus,
} from '../types';
import { loadWillsEstate, saveWillsEstate, loadDocuments, saveDocuments, uploadVaultFile, loadFinances, loadFamilyRoles, saveWillsAccess, createEstateInvite, cancelPendingWillReader, loadReleaseState, requestWillRelease, approveWillRelease, declineWillRelease } from '../utils/db';
import type { ReleaseRequestRow, FindabilityEntry } from '../utils/db';
import { RELEASE_WAIT_DAYS, QUIET_DAYS, waitLabel, daysLeft } from '../utils/releaseCopy';
import { grantableMembers, withReader, staleReaders, pendingWillReaders, pendingInviteFor, isInviteExpired } from '../utils/willsAccess';
import { useWillsAccess } from '../hooks/useWillsAccess';
import { useSharedDoc } from '../hooks/useSharedDoc';
import RemoteChangeHint from './RemoteChangeHint';
import { auth } from '../lib/firebase';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { computeEstateReadiness } from '../utils/estateReadiness';
import type { EstateReadiness } from '../utils/estateReadiness';
import { ESTATE_DOC_KINDS, ESTATE_DOC_STATUSES, REGISTRY_STATUSES, isReviewStale, reviewAgeLabel, statusLabel, findabilityGap } from '../utils/willsEstate';
import { isFuneralPolicy, funeralCoverLines } from '../utils/funeralCover';
import type { FuneralCoverLine } from '../utils/funeralCover';
import { resolveSuccessorAccess, SuccessorAccess, SuccessorAccessResult } from '../utils/successor';
import DocumentViewer from './DocumentViewer';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import SheetGrabber from './SheetGrabber';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import FirstHoursPack from './FirstHoursPack';
import { buildFirstHoursPack } from '../utils/firstHours';
import { listFamilyLinks, loadFamilyLinkProfiles } from '../utils/familyLink';

/** A person another household shares with us, offered as a successor. */
interface ConnectedCandidate {
  linkId: string;
  householdName: string;
  memberId: string;
  name: string;
}

const FUNERAL_WISHES_KIND = 'Funeral wishes';

function newId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

interface EstateForm {
  id: string;
  kind: string;
  forMember: string;
  originalLocation: string;
  heldBy: string;
  notaryName: string;
  notaryPhone: string;
  executor: string;
  status: EstateDocStatus;
  registered: EstateRegistryStatus;
  registryName: string;
  lastReviewed: string;
  notes: string;
  linkedDocIds: string[];
  linkedPolicyIds: string[];
}

const BLANK_FORM: EstateForm = {
  id: '', kind: ESTATE_DOC_KINDS[0].kind, forMember: '', originalLocation: '', heldBy: '',
  notaryName: '', notaryPhone: '', executor: '', status: 'unknown', registered: 'unknown',
  registryName: '', lastReviewed: '', notes: '', linkedDocIds: [],
  linkedPolicyIds: [],
};

function toForm(r: EstateRecord): EstateForm {
  return {
    id: r.id,
    kind: r.kind,
    forMember: r.forMember || '',
    originalLocation: r.originalLocation || '',
    heldBy: r.heldBy || '',
    notaryName: r.notaryName || '',
    notaryPhone: r.notaryPhone || '',
    executor: r.executor || '',
    status: r.status || 'unknown',
    registered: r.registered || 'unknown',
    registryName: r.registryName || '',
    lastReviewed: r.lastReviewed || '',
    notes: r.notes || '',
    linkedDocIds: r.linkedDocIds ? [...r.linkedDocIds] : [],
    linkedPolicyIds: r.linkedPolicyIds ? [...r.linkedPolicyIds] : [],
  };
}

// A saved scan is a copy, in the general Document Vault (category 'Legal') —
// converted to the viewer's shape the same way DocumentVault does.
function toFamilyDoc(v: VaultDocument): FamilyDocument {
  return {
    id: v.id, name: v.name, category: 'Other',
    fileType: v.fileType, fileName: v.fileName, fileSize: v.fileSize,
    uploadedAt: v.uploadedAt, notes: v.notes, fileData: v.downloadUrl,
  };
}

export default function WillsEstateView(
  { members, refreshKey = 0, hubName = 'your family' }:
  { members: FamilyMember[]; refreshKey?: number; hubName?: string },
) {
  /* `canWrite` (admin OR member) is NOT the gate here any more.
   *
   * Since v230 reference/willsEstate is admin-and-named-readers-only in
   * firestore.rules — the will was previously readable by every member,
   * which on this vault included a teenager, because the "children are
   * read-only" distinction only ever governed writes. Editing is admins
   * only, matching the rule; reading is admins plus whoever an admin has
   * explicitly named. See utils/willsAccess.ts. */
  const { role, familyId, isAdmin } = useFamilyCtx();
  const { access, mayRead, mayWrite: canWrite, loading: accessLoading, refresh: refreshAccess } = useWillsAccess();
  const [savingAccess, setSavingAccess] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [records, setRecords] = useState<EstateRecord[]>([]);
  // Who takes over, and the "if something happens to you" material that
  // doesn't belong to one specific document (see EmergencyInstructions in
  // types.ts) — both live in the SAME shared doc as `records`, not a second
  // store.
  const [successor, setSuccessor] = useState<DesignatedSuccessor | undefined>(undefined);
  const [instructions, setInstructions] = useState<EmergencyInstructions | undefined>(undefined);
  /* The people a connected household shares with us — candidates for "who
     takes over" who are, by definition, not in our own member list. Loaded
     read-only and never written back; the estate doc stores only the id and
     the household name. */
  const [connectedPeople, setConnectedPeople] = useState<ConnectedCandidate[]>([]);

  // The live roles collection — needed only to answer "can the designated
  // person actually get in today" (resolveSuccessorAccess). Same source
  // ReadinessCard/FamilySettings already read for the same reason.
  const [roles, setRoles] = useState<Record<string, FamilyMemberRole>>({});
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  // Funeral-type policies from Finances — loaded here (not just in Insurance)
  // so a 'Funeral wishes' record can link to its policy and surface the
  // policy number and who-to-call right where a bereaved family looks.
  const [funeralPolicies, setFuneralPolicies] = useState<InsurancePolicy[]>([]);
  /* Requests to open the will. Loaded through the server rather than read off
     the willsAccess doc, because that same call is what SETTLES a clock that has
     run out — there is no scheduler, so somebody looking is what makes it real. */
  const [releaseRequests, setReleaseRequests] = useState<ReleaseRequestRow[]>([]);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineError, setDeclineError] = useState<string | null>(null);
  const readiness = useMemo(() => computeEstateReadiness({
    records, successor, instructions, hasFuneralCover: funeralPolicies.length > 0,
  }), [records, successor, instructions, funeralPolicies]);
  const [packOpen, setPackOpen] = useState(false);

  /* Assembled, never stored — see utils/firstHours.ts. Rebuilt from whatever
   * this view already loaded, so it cannot drift from what is on screen. */
  const firstHours = useMemo(
    () => buildFirstHoursPack({ insurance: funeralPolicies } as FinancesInfo, { records, instructions }),
    [funeralPolicies, records, instructions],
  );
  const [loading, setLoading] = useState(true);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [form, setForm] = useState<EstateForm | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [viewingDoc, setViewingDoc] = useState<VaultDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Two independent "fixed inset-0" overlays render conditionally inside
  // this always-mounted view — the detail modal (viewingId) and the add/edit
  // form modal (isFormOpen). Each locks background scroll on its own boolean
  // (reference-counted, so nesting is safe); called unconditionally, before
  // the loading early-return below.
  useBodyScrollLock(viewingId !== null);
  useBodyScrollLock(isFormOpen && !!form);

  // The access answer comes first — everything else waits on it, because
  // loading the estate document before we know whether this person may see it
  // is exactly the request the rule will refuse.
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      try {
        const out = await loadReleaseState();
        if (active) setReleaseRequests(out.requests || []);
      } catch { if (active) setReleaseRequests([]); }
    })();
    return () => { active = false; };
  }, [isAdmin, refreshKey]);

  const declineRequest = async (id: string) => {
    setDecliningId(id); setDeclineError(null);
    try {
      const out = await declineWillRelease(id);
      setReleaseRequests(out.requests || []);
    } catch (e) {
      setDeclineError(e instanceof Error ? e.message : 'Could not refuse that request.');
    } finally { setDecliningId(null); }
  };

  useEffect(() => {
    if (accessLoading) return;
    if (!mayRead) { setLoading(false); return; }
    let active = true;
    (async () => {
      const [estate, docs, finances] = await Promise.all([loadWillsEstate(), loadDocuments(), loadFinances()]);
      if (active) {
        setRecords(estate?.records || []);
        setSuccessor(estate?.successor);
        setInstructions(estate?.instructions);
        setDocuments(docs || []);
        setFuneralPolicies((finances?.insurance || []).filter(p => isFuneralPolicy(p.type)));
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [refreshKey, accessLoading, mayRead]);

  useEffect(() => {
    if (!familyId) return;
    let active = true;
    loadFamilyRoles(familyId).then((r) => { if (active) setRoles(r); }).catch(() => { if (active) setRoles({}); });
    return () => { active = false; };
  }, [familyId]);

  // ── Who may open this page ────────────────────────────────────────────────
  // Three ways in, all admin-only, all landing on the same willsAccess doc:
  // name someone already here (toggleReader), invite someone who isn't
  // (inviteSuccessor — the grant travels with the invite), or withdraw an
  // invite before it's used (cancelInvite).
  async function toggleReader(targetUid: string, granted: boolean) {
    setAccessError(null);
    setSavingAccess(targetUid);
    const next = withReader(access, targetUid, granted);
    const ok = await saveWillsAccess(next, auth.currentUser?.email || '');
    if (ok) refreshAccess();
    else setAccessError('That didn\u2019t save. Check your connection and try again.');
    setSavingAccess(null);
  }

  /** Mints the invite and hands back the code — the caller does the sharing. */
  async function inviteSuccessor(name: string, replacePendingId?: string): Promise<string> {
    const { code } = await createEstateInvite(name, replacePendingId);
    refreshAccess();
    return code;
  }

  async function cancelInvite(entry: PendingWillReader): Promise<boolean> {
    const ok = await cancelPendingWillReader(entry);
    if (ok) refreshAccess();
    return ok;
  }

  // Live updates for BOTH shared documents this view writes: the estate records
  // (+ successor + instructions, same doc) and the shared Document Vault it
  // attaches legal files into. Held while the record form is open or a file is
  // being attached.
  const busy = isFormOpen || attaching;
  const remoteWaiting = useSharedDoc<WillsEstateDoc>(
    'willsEstate',
    (v) => { setRecords(v.records || []); setSuccessor(v.successor); setInstructions(v.instructions); },
    { hold: busy },
  );
  useSharedDoc<{ docs: VaultDocument[] }>(
    'documents', (v) => setDocuments(v.docs || []), { hold: busy },
  );

  /* Candidates from connected households. A failure here is silent on
     purpose: not being able to list the cousins must never stop the estate
     page loading, and the picker simply falls back to your own family. */
  useEffect(() => {
    if (!mayRead) return;
    let active = true;
    (async () => {
      try {
        const links = (await listFamilyLinks()).filter((l) => l.status === 'active');
        const packs = await Promise.all(links.map(async (l) => {
          const { members: people } = await loadFamilyLinkProfiles(l.id);
          return people.map((p) => ({
            linkId: l.id,
            householdName: l.otherName || 'a connected family',
            memberId: p.id,
            name: p.name,
          }));
        }));
        if (active) setConnectedPeople(packs.flat());
      } catch {
        if (active) setConnectedPeople([]);
      }
    })();
    return () => { active = false; };
  }, [mayRead]);

  // Every save writes the WHOLE shared doc (records + successor +
  // instructions) — omitting a field here would tell the three-way merge
  // this client is deliberately blanking it (see mergeShared.ts: an absent
  // local key only survives the merge if it still matches `base`, which
  // isn't reliably true across a live-subscribed view), so every persist*
  // helper below always carries the other two fields' CURRENT state.
  const persist = async (updated: EstateRecord[]) => {
    setRecords(updated);
    await saveWillsEstate({ records: updated, successor, instructions });
  };

  const persistSuccessor = async (next: DesignatedSuccessor | undefined) => {
    setSuccessor(next);
    await saveWillsEstate({ records, successor: next, instructions });
  };

  const persistInstructions = async (next: EmergencyInstructions | undefined) => {
    setInstructions(next);
    await saveWillsEstate({ records, successor, instructions: next });
  };

  // ── Open/close ──

  const openNewForm = () => {
    setForm({ ...BLANK_FORM });
    setError(null);
    setAttachError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (r: EstateRecord) => {
    setForm(toForm(r));
    setError(null);
    setAttachError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setForm(null);
  };

  // ── Attach / view a scan (real Document Vault entries, category 'Legal') ──

  const handleAttachChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !form) return;
    if (file.size > 20 * 1024 * 1024) {
      setAttachError('File is larger than 20 MB. Please compress it first.');
      return;
    }
    setAttaching(true);
    setAttachError(null);
    try {
      const docId = newId();
      const { storagePath, downloadUrl } = await uploadVaultFile(file, docId);
      const resolvedMember = members.find(m => m.name.trim().toLowerCase() === form.forMember.trim().toLowerCase());
      const newDoc: VaultDocument = {
        id: docId,
        name: `${form.kind}${form.forMember ? ` — ${form.forMember}` : ''}`,
        category: 'Legal',
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        storagePath,
        downloadUrl,
        uploadedAt: new Date().toISOString().slice(0, 10),
        uploadedBy: auth.currentUser?.displayName || auth.currentUser?.email || undefined,
        memberId: resolvedMember?.id,
        notes: 'Wills & Estate scan',
      };
      const nextDocs = [newDoc, ...documents];
      setDocuments(nextDocs);
      await saveDocuments(nextDocs);
      setForm(prev => (prev ? { ...prev, linkedDocIds: [...prev.linkedDocIds, newDoc.id] } : prev));
    } catch {
      setAttachError("Couldn't upload that file — please try again.");
    } finally {
      setAttaching(false);
    }
  };

  const unlinkDoc = (docId: string) => {
    setForm(prev => (prev ? { ...prev, linkedDocIds: prev.linkedDocIds.filter(id => id !== docId) } : prev));
  };

  const linkedDocsFor = (ids?: string[]) => (ids || []).map(id => documents.find(d => d.id === id)).filter((d): d is VaultDocument => !!d);

  const linkedPoliciesFor = (ids?: string[]) =>
    (ids || []).map(id => funeralPolicies.find(p => p.id === id)).filter((p): p is InsurancePolicy => !!p);

  const togglePolicyLink = (policyId: string) => setForm(prev => {
    if (!prev) return prev;
    const current = prev.linkedPolicyIds;
    const next = current.includes(policyId) ? current.filter(id => id !== policyId) : [...current, policyId];
    return { ...prev, linkedPolicyIds: next };
  });

  // ── Save / delete ──

  const handleSave = async () => {
    if (!form) return;
    if (!form.kind.trim()) {
      setError('Choose which kind of document this is');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const isNew = !form.id;
      const id = isNew ? newId() : form.id;
      const record: EstateRecord = {
        id,
        kind: form.kind.trim(),
        forMember: form.forMember.trim() || undefined,
        originalLocation: form.originalLocation.trim() || undefined,
        heldBy: form.heldBy.trim() || undefined,
        notaryName: form.notaryName.trim() || undefined,
        notaryPhone: form.notaryPhone.trim() || undefined,
        executor: form.executor.trim() || undefined,
        status: form.status,
        registered: form.registered,
        registryName: form.registryName.trim() || undefined,
        lastReviewed: form.lastReviewed || undefined,
        linkedDocIds: form.linkedDocIds.length ? form.linkedDocIds : undefined,
        linkedPolicyIds: form.linkedPolicyIds.length ? form.linkedPolicyIds : undefined,
        notes: form.notes.trim() || undefined,
      };
      const next = isNew ? [...records, record] : records.map(r => (r.id === id ? record : r));
      await persist(next);
      closeForm();
    } finally {
      setSaving(false);
    }
  };

  // Confirmation now lives in ConfirmDeleteButton (in-place two-step) at the
  // call site — a bare window.confirm() looks and behaves like a broken
  // webpage inside the iOS home-screen PWA.
  const handleDelete = async (id: string) => {
    await persist(records.filter(r => r.id !== id));
    if (form?.id === id) closeForm();
    if (viewingId === id) setViewingId(null);
  };

  const sorted = [...records].sort((a, b) => {
    const aStale = isReviewStale(a.lastReviewed) ? 0 : 1;
    const bStale = isReviewStale(b.lastReviewed) ? 0 : 1;
    if (aStale !== bStale) return aStale - bStale;
    return String(a.kind).localeCompare(String(b.kind));
  });
  const viewing = records.find(r => r.id === viewingId) || null;

  // Locked out. Return BEFORE the loading branch and before anything that
  // could leak the contents — no record count, no successor name, nothing
  // that answers "what's in there" for someone who isn't allowed to know.
  if (!accessLoading && !mayRead) {
    // NOT LockedCard any more. "Ask an admin for access" is sound advice right
    // up until the admin is the person whose will it is — see ReleaseDoorbell.
    return <ReleaseDoorbell isChild={role === 'child'} />;
  }

  if (loading) {
    return (
      <div className="card p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clay-500 mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-4">
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleAttachChange} accept="*/*" />
      <datalist id="estate-formember-options">
        <option value="Whole family" />
        {members.map(m => <option key={m.id} value={m.name} />)}
      </datalist>
      {/* The successor list deliberately reaches past this household: a
          sister-in-law is often the right person to take over and is exactly
          who is not a member here. The label says whose family they are in, so
          two Marias do not become one. */}
      <datalist id="successor-name-options">
        {members.map(m => <option key={m.id} value={m.name} />)}
        {connectedPeople.map(c => (
          <option key={`${c.linkId}-${c.memberId}`} value={c.name} label={c.householdName} />
        ))}
      </datalist>

      {/* A running clock outranks everything else on this page: it is the only
          thing here that gets worse if it is scrolled past. */}
      {isAdmin && (
        <ReleaseRequestsCard
          requests={releaseRequests}
          onDecline={declineRequest}
          busyId={decliningId}
          error={declineError}
        />
      )}

      {/* Who can open this — admins only. Deliberately the FIRST thing an
          admin sees after any live request: the whole point of the lock is
          knowing, at a glance, exactly who else can read this page. */}
      {isAdmin && (
        <AccessCard
          access={access}
          roles={roles}
          savingUid={savingAccess}
          error={accessError}
          onToggle={toggleReader}
          onCancelInvite={cancelInvite}
        />
      )}

      {/* Who takes over — the designated person */}
      <SuccessorCard
        successor={successor}
        members={members}
        connectedPeople={connectedPeople}
        roles={roles}
        canWrite={canWrite}
        onSave={persistSuccessor}
        isAdmin={isAdmin}
        willsAccess={access}
        savingUid={savingAccess}
        onGrantReader={(targetUid: string) => toggleReader(targetUid, true)}
        onInvite={inviteSuccessor}
        onCancelInvite={cancelInvite}
      />

      {/* "If something happens to you" — keys/letter + who to tell + what to close */}
      <InstructionsCard
        instructions={instructions}
        canWrite={canWrite}
        onSave={persistInstructions}
      />

      <EstateReadinessCard readiness={readiness} />

      <FuneralCoverCard policies={funeralPolicies} />

      {/* Header card */}
      <div className="card overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-cream-200 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-ink-100 text-ink-700 shrink-0">
              <ScrollText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-ink-900">Wills &amp; Estate</h2>
              <p className="text-[13px] text-ink-400 font-medium">
                Where the important documents are, and who to call.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setPackOpen(true)}
              className="btn-quiet text-xs px-3 py-2"
              title="A printable page for the first day or two"
            >
              <Printer className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">First hours</span>
            </button>
            {canWrite && (
              <button onClick={openNewForm} className="btn-primary text-xs px-3 py-2">
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            )}
          </div>
        </div>

        {/* Plain-language, persistent disclaimer — store-and-recall only */}
        <div className="px-5 sm:px-6 py-3.5 bg-cream-50 border-b border-cream-200 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-ink-400 mt-0.5 shrink-0" />
          <p className="text-[12px] text-ink-500 leading-relaxed">
            This is a record of what your family has told the app — which documents exist, whose they are, and where
            the signed original is kept. It isn't legal advice, and a saved scan is a copy, not the legal original.
          </p>
        </div>

        {/* List */}
        <div className="p-4 sm:p-5">
          {records.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-ink-50 text-ink-500 flex items-center justify-center">
                <ScrollText className="w-8 h-8" />
              </div>
              <p className="text-[14px] font-medium text-ink-700">No wills or estate documents recorded yet</p>
              <p className="text-[12px] text-ink-500 mt-1 max-w-xs mx-auto">
                Add the first one — which document, whose it is, and where the signed original is kept.
              </p>
              {canWrite && (
                <button onClick={openNewForm} className="btn-primary mt-5 text-xs px-4 py-2">
                  <Plus className="w-3.5 h-3.5" />
                  Add a record
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map(r => {
                const stale = isReviewStale(r.lastReviewed);
                const linked = linkedDocsFor(r.linkedDocIds);
                const linkedPolicies = linkedPoliciesFor(r.linkedPolicyIds);
                return (
                  <button
                    key={r.id}
                    onClick={() => setViewingId(r.id)}
                    className="w-full flex items-start justify-between gap-3 px-3 py-3 rounded-xl hover:bg-cream-50 group transition-colors text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span className="chip bg-ink-100 text-ink-700">{r.kind}</span>
                        {r.forMember && <span className="chip bg-cream-200 text-ink-600">{r.forMember}</span>}
                        <span className={`chip ${stale ? 'bg-honey-100 text-honey-700' : 'bg-sage-100 text-sage-700'}`}>
                          {reviewAgeLabel(r.lastReviewed)}
                        </span>
                      </div>
                      {r.originalLocation && (
                        <p className="text-[14px] font-semibold text-ink-900 flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-ink-400 shrink-0" />
                          {r.originalLocation}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[12px] text-ink-500">
                        {/* A draft says so on the row. The whole point of the
                            field is that it stops being invisible. */}
                        {r.status && r.status !== 'unknown' && (
                          <span className={`chip ${r.status === 'draft' ? 'bg-honey-100 text-honey-800' : 'bg-sage-100 text-sage-700'}`}>
                            {statusLabel(r.status)}
                          </span>
                        )}
                        {r.registered === 'registered' && (
                          <span className="chip bg-dusk-100 text-dusk-700">
                            {r.registryName ? `In ${r.registryName}` : 'Registered'}
                          </span>
                        )}
                        {r.heldBy && <span className="flex items-center gap-1"><User className="w-3 h-3" />{r.heldBy}</span>}
                        {r.notaryName && <span className="flex items-center gap-1"><Landmark className="w-3 h-3" />{r.notaryName}</span>}
                        {r.executor && <span className="flex items-center gap-1"><HandHeart className="w-3 h-3" />Executor: {r.executor}</span>}
                      </div>
                      {/* Only where the gap is real — see findabilityGap. This
                          reports how Austrian probate works; it does not tell
                          anybody what to do about it. */}
                      {findabilityGap(r) && (
                        <p className="mt-2 rounded-xl border border-honey-300 bg-honey-50 px-3 py-2 text-[12px] text-ink-700 leading-snug flex gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-honey-700 shrink-0 mt-0.5" />
                          <span>{findabilityGap(r)}</span>
                        </p>
                      )}
                      {linked.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-ink-400 mt-1.5">
                          <Paperclip className="w-3 h-3" />
                          {linked.length} scan{linked.length === 1 ? '' : 's'} attached
                        </span>
                      )}
                      {linkedPolicies.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-ink-400 mt-1.5 ml-3">
                          <Phone className="w-3 h-3" />
                          {linkedPolicies.length} funeral polic{linkedPolicies.length === 1 ? 'y' : 'ies'} linked
                        </span>
                      )}
                    </div>
                    {canWrite && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditForm(r); }}
                        className="btn-quiet p-1.5 shrink-0 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Detail modal — read view, open to everyone ── */}
      {viewing && (
        <div
          className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto anim-fade"
          onClick={() => setViewingId(null)}
        >
          <div
            className="w-full max-w-lg mt-12 mb-8 rounded-2xl bg-white shadow-xl anim-pop overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <SheetGrabber onClose={() => setViewingId(null)} />
            <div className="flex items-start justify-between p-6 pb-3 gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="font-display text-xl font-semibold text-ink-900">{viewing.kind}</h3>
                  {viewing.forMember && <span className="chip bg-cream-200 text-ink-600">{viewing.forMember}</span>}
                </div>
                <span className={`chip mt-2 inline-block ${isReviewStale(viewing.lastReviewed) ? 'bg-honey-100 text-honey-700' : 'bg-sage-100 text-sage-700'}`}>
                  {reviewAgeLabel(viewing.lastReviewed)}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {canWrite && (
                  <button onClick={() => { setViewingId(null); openEditForm(viewing); }} className="btn-quiet p-2">
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => setViewingId(null)} className="btn-quiet p-2">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="px-6 pb-6 space-y-4">
              {/* Who to call, and the policy number — the single most important
                  thing on this record, shown big and plain for someone who is
                  grieving and probably didn't enter this data themselves. */}
              {viewing.kind === FUNERAL_WISHES_KIND && linkedPoliciesFor(viewing.linkedPolicyIds).length > 0 && (
                <div className="rounded-3xl bg-ink-900 text-white p-5 space-y-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-white/60">Who to call, and the policy number</p>
                  {linkedPoliciesFor(viewing.linkedPolicyIds).map((p, i) => (
                    <div key={p.id} className={i > 0 ? 'pt-4 border-t border-white/10' : ''}>
                      <p className="text-lg font-bold leading-tight">{p.provider}{p.type ? ` · ${p.type}` : ''}</p>
                      {p.claimsPhone && (
                        <a href={`tel:${p.claimsPhone.replace(/\s+/g, '')}`} className="block text-2xl sm:text-3xl font-mono font-extrabold tabular-nums text-honey-200 mt-1 hover:underline">
                          {p.claimsPhone}
                        </a>
                      )}
                      {p.burialSocietyContact && (
                        <p className="text-[14px] font-semibold text-white/90 mt-1">{p.burialSocietyContact}</p>
                      )}
                      {!p.claimsPhone && !p.burialSocietyContact && (
                        <p className="text-[13px] text-white/60 italic mt-1">No phone number on file for this policy.</p>
                      )}
                      {p.policyNumber && (
                        <p className="text-[13px] font-mono tabular-nums text-white/70 mt-1.5">Policy {p.policyNumber}</p>
                      )}
                      {p.beneficiary && (
                        <p className="text-[12px] text-white/60 mt-0.5 flex items-center gap-1"><HandCoins className="w-3 h-3" /> Payable to: {p.beneficiary}</p>
                      )}
                      {p.repatriationIncluded && (
                        <p className="text-[12px] text-white/60 mt-0.5">Includes repatriation{p.repatriationDestination ? ` to ${p.repatriationDestination}` : ''}.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {viewing.originalLocation && (
                <div>
                  <p className="section-label mb-1">Where the signed original is kept</p>
                  <p className="text-[14px] text-ink-800 font-medium flex items-start gap-1.5">
                    <MapPin className="w-4 h-4 text-ink-400 mt-0.5 shrink-0" />
                    {viewing.originalLocation}
                  </p>
                </div>
              )}
              {viewing.heldBy && (
                <div>
                  <p className="section-label mb-1">Held by</p>
                  <p className="text-[14px] text-ink-700">{viewing.heldBy}</p>
                </div>
              )}
              {(viewing.notaryName || viewing.notaryPhone) && (
                <div>
                  <p className="section-label mb-1">Notary / solicitor</p>
                  <p className="text-[14px] text-ink-700">
                    {viewing.notaryName}
                    {viewing.notaryPhone && (
                      <>
                        {viewing.notaryName ? ' · ' : ''}
                        <a href={`tel:${viewing.notaryPhone}`} className="text-clay-600 hover:underline">{viewing.notaryPhone}</a>
                      </>
                    )}
                  </p>
                </div>
              )}
              {viewing.executor && (
                <div>
                  <p className="section-label mb-1">Executor</p>
                  <p className="text-[14px] text-ink-700">{viewing.executor}</p>
                </div>
              )}
              {viewing.notes && (
                <div>
                  <p className="section-label mb-1">Notes</p>
                  <p className="text-[14px] text-ink-700 whitespace-pre-wrap">{viewing.notes}</p>
                </div>
              )}
              {linkedDocsFor(viewing.linkedDocIds).length > 0 && (
                <div>
                  <p className="section-label mb-2">Attached scans</p>
                  <div className="space-y-1.5">
                    {linkedDocsFor(viewing.linkedDocIds).map(d => (
                      <button
                        key={d.id}
                        onClick={() => setViewingDoc(d)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-cream-50 hover:bg-cream-100 transition-colors text-left"
                      >
                        <Eye className="w-3.5 h-3.5 text-ink-400 shrink-0" />
                        <span className="text-[13px] text-ink-700 truncate flex-1">{d.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Add/edit form modal ── */}
      {isFormOpen && form && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto anim-fade">
          <div className="w-full max-w-lg mt-12 mb-8 rounded-2xl bg-white shadow-xl anim-pop">
            <SheetGrabber onClose={closeForm} />
            <RemoteChangeHint show={remoteWaiting} className="mx-6 mt-4" />

            <div className="flex items-center justify-between p-6 border-b border-cream-200">
              <h3 className="font-display text-lg font-semibold text-ink-900">
                {form.id ? 'Edit record' : 'New record'}
              </h3>
              <button onClick={closeForm} className="btn-quiet p-2">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {error && (
                <div className="flex items-center justify-between gap-2 bg-rosa-500/10 rounded-xl px-4 py-3">
                  <p className="text-[12px] text-rosa-600">{error}</p>
                  <button onClick={() => setError(null)}>
                    <X className="w-3.5 h-3.5 text-rosa-600" />
                  </button>
                </div>
              )}

              {/* Which document */}
              <div>
                <label className="field-label">Which document</label>
                <select
                  value={form.kind}
                  onChange={e => setForm(prev => (prev ? { ...prev, kind: e.target.value } : prev))}
                  className="field w-full"
                >
                  {ESTATE_DOC_KINDS.map(k => (
                    <option key={k.kind} value={k.kind}>
                      {k.kind}{k.atHint ? ` (${k.atHint})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* WHAT STATE IT IS IN. The product boundary made concrete: a
                  Word file nobody printed and a notarised original used to
                  render as the same tidy row. */}
              <div>
                <label className="field-label">What state is it in</label>
                <select
                  value={form.status}
                  onChange={e => setForm(prev => (prev ? { ...prev, status: e.target.value as EstateDocStatus } : prev))}
                  className="field w-full"
                >
                  {ESTATE_DOC_STATUSES.map(o => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                <p className="text-[12px] text-ink-400 mt-1">
                  {ESTATE_DOC_STATUSES.find(o => o.id === form.status)?.detail}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">In a will register</label>
                  <select
                    value={form.registered}
                    onChange={e => setForm(prev => (prev ? { ...prev, registered: e.target.value as EstateRegistryStatus } : prev))}
                    className="field w-full"
                  >
                    {REGISTRY_STATUSES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Which register</label>
                  <input
                    type="text"
                    placeholder="e.g. ÖZTR"
                    value={form.registryName}
                    onChange={e => setForm(prev => (prev ? { ...prev, registryName: e.target.value } : prev))}
                    className="field w-full"
                  />
                </div>
              </div>

              {/* Whose */}
              <div>
                <label className="field-label">Whose</label>
                <input
                  type="text"
                  list="estate-formember-options"
                  placeholder="e.g. Erika, or Whole family"
                  value={form.forMember}
                  onChange={e => setForm(prev => (prev ? { ...prev, forMember: e.target.value } : prev))}
                  className="field w-full"
                />
              </div>

              {/* Where the original is */}
              <div>
                <label className="field-label">Where the signed original is kept</label>
                <input
                  type="text"
                  placeholder="e.g. Notar Huber's office, or the home safe"
                  value={form.originalLocation}
                  onChange={e => setForm(prev => (prev ? { ...prev, originalLocation: e.target.value } : prev))}
                  className="field w-full"
                />
              </div>

              {/* Held by */}
              <div>
                <label className="field-label">Held by <span className="text-ink-400 font-normal">(a named person or institution, optional)</span></label>
                <input
                  type="text"
                  placeholder="e.g. Rory, the bank, Notar Huber"
                  value={form.heldBy}
                  onChange={e => setForm(prev => (prev ? { ...prev, heldBy: e.target.value } : prev))}
                  className="field w-full"
                />
              </div>

              {/* Notary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Notary / solicitor name</label>
                  <input
                    type="text"
                    value={form.notaryName}
                    onChange={e => setForm(prev => (prev ? { ...prev, notaryName: e.target.value } : prev))}
                    className="field w-full"
                  />
                </div>
                <div>
                  <label className="field-label">Notary / solicitor phone</label>
                  <input
                    type="tel"
                    value={form.notaryPhone}
                    onChange={e => setForm(prev => (prev ? { ...prev, notaryPhone: e.target.value } : prev))}
                    className="field w-full"
                  />
                </div>
              </div>

              {/* Executor */}
              <div>
                <label className="field-label">Executor</label>
                <input
                  type="text"
                  placeholder="Who is named to carry it out"
                  value={form.executor}
                  onChange={e => setForm(prev => (prev ? { ...prev, executor: e.target.value } : prev))}
                  className="field w-full"
                />
              </div>

              {/* Last reviewed */}
              <div>
                <label className="field-label">Last reviewed</label>
                <input
                  type="date"
                  value={form.lastReviewed}
                  onChange={e => setForm(prev => (prev ? { ...prev, lastReviewed: e.target.value } : prev))}
                  className="field w-full"
                />
                <p className="text-[11px] text-ink-400 mt-1">
                  Marriages, births and property moves are common reasons to check a will is still current.
                </p>
              </div>

              {/* Notes */}
              <div>
                <label className="field-label">Notes</label>
                <textarea
                  rows={3}
                  placeholder="Anything else worth remembering — never the document's legal content"
                  value={form.notes}
                  onChange={e => setForm(prev => (prev ? { ...prev, notes: e.target.value } : prev))}
                  className="field w-full resize-none"
                />
              </div>

              {/* Link to funeral cover policies (only relevant for Funeral wishes) —
                  so the policy number and who-to-call live right alongside the
                  wishes themselves, not stranded in a different corner of the app. */}
              {form.kind === FUNERAL_WISHES_KIND && (
                <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4 space-y-2.5">
                  <label className="text-xs font-semibold text-ink-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" /> Linked funeral cover
                  </label>
                  {funeralPolicies.length === 0 ? (
                    <p className="text-[12px] text-ink-400">
                      No funeral cover, burial society, or repatriation policy recorded yet — add one in Insurance.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {funeralPolicies.map(p => {
                        const active = form.linkedPolicyIds.includes(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => togglePolicyLink(p.id)}
                            className={`chip cursor-pointer transition-colors ${active ? 'bg-clay-500 text-white' : 'bg-cream-100 text-ink-500 hover:bg-cream-200'}`}
                          >
                            {p.provider || 'Unnamed'}{p.type ? ` · ${p.type}` : ''}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Attached scans */}
              <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4 space-y-2.5">
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5" /> Attached scans
                </label>
                {attachError && (
                  <div className="p-2.5 bg-rosa-50 border border-rosa-100 rounded-xl text-[12px] text-rosa-700 flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rosa-500" />
                    <span>{attachError}</span>
                  </div>
                )}
                {linkedDocsFor(form.linkedDocIds).length > 0 && (
                  <div className="space-y-1.5">
                    {linkedDocsFor(form.linkedDocIds).map(d => (
                      <div key={d.id} className="flex items-center gap-2 rounded-xl bg-white border border-cream-200 p-2.5">
                        <span className="text-[13px] text-ink-700 truncate flex-1">{d.name}</span>
                        <button type="button" onClick={() => setViewingDoc(d)} className="p-1 text-ink-400 hover:text-ink-700" title="View">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => unlinkDoc(d.id)} className="p-1 text-ink-300 hover:text-rosa-500" title="Remove from this record">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={attaching}
                  className="btn-quiet text-xs px-3 py-2 disabled:opacity-60"
                >
                  {attaching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {attaching ? 'Uploading…' : 'Attach a scan'}
                </button>
                <p className="text-[11px] text-ink-400">
                  A scan is a copy, kept in the Document Vault (Legal) — the signed original is what matters.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 p-6 pt-0">
              <div>
                {form.id && (
                  <ConfirmDeleteButton
                    onConfirm={() => handleDelete(form.id)}
                    ariaLabel={`Delete record for ${form.originalLocation || form.kind || 'this estate item'}`}
                    hint="Only removes this note — any attached scan stays in the Document Vault."
                    variant="danger-text"
                    className="rounded-xl px-3 text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </ConfirmDeleteButton>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={closeForm} className="btn-quiet text-xs px-4 py-2">
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving || attaching} className="btn-primary text-xs px-5 py-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <DocumentViewer
        document={viewingDoc ? toFamilyDoc(viewingDoc) : null}
        memberName={viewingDoc ? (members.find(m => m.id === viewingDoc.memberId)?.name ?? 'the family') : ''}
        onClose={() => setViewingDoc(null)}
      />

      {packOpen && (
        <FirstHoursPack pack={firstHours} hubName={hubName} onClose={() => setPackOpen(false)} />
      )}
    </div>
  );
}

// ── Who takes over ──────────────────────────────────────────────────────
// "If something happens to you, who steps in — and can they actually get in
// today." The access badge is the whole point of this card: naming someone
// with no way to sign in is the exact failure mode this feature exists to
// prevent, so it's shown plainly rather than buried in a tooltip.
const ACCESS_STYLE: Record<SuccessorAccess, string> = {
  admin: 'bg-sage-100 text-sage-700',
  member: 'bg-honey-100 text-honey-700',
  'no-account': 'bg-honey-100 text-honey-700',
  unknown: 'bg-cream-200 text-ink-500',
};

/**
 * HOW MUCH THE NAMED PERSON IS TOLD — three rungs, not a switch.
 *
 * Rory: "sort out the will thing i still think we should be able to toggle it
 * on and off etc send a notification i dunno make it easy for families that
 * are all on the app."
 *
 * A plain on/off was the obvious build and the wrong one. "On" would mean
 * handing another household a document that can hold where a safe is and what
 * is in it; "off" means a sister finds out she was responsible for an estate
 * at the worst possible moment. The rungs separate three genuinely different
 * decisions, and the copy states the CONSEQUENCE of each rather than naming
 * the level — "she can read what you want her to do" is a sentence somebody
 * can agree or disagree with; "instructions" is not.
 */
const SHARE_RUNGS: Array<{ id: SuccessorShareLevel; label: string; detail: (who: string) => string }> = [
  {
    id: 'fact',
    label: 'Only that you named them',
    detail: (who) => `${who} sees that you chose them, and nothing else.`,
  },
  {
    id: 'instructions',
    label: 'And what you want them to do',
    detail: (who) => `${who} can read your note — the bank to ring, the school to tell. Most families want this one: it is the part that is useless if they only read it afterwards.`,
  },
  {
    id: 'documents',
    label: 'And which papers exist',
    detail: (who) => `${who} also sees that there is a will, a power of attorney and so on, and when each was last looked at. Never where any of it is kept, and never the documents themselves.`,
  },
];

function SuccessorShareLadder({ level, householdName, personName, onChange }: {
  level: SuccessorShareLevel;
  householdName: string;
  personName: string;
  onChange: (next: SuccessorShareLevel) => void;
}) {
  const who = personName.trim().split(/\s+/)[0] || 'They';
  return (
    <div className="mt-3 rounded-2xl border border-cream-200 bg-cream-50/70 p-3.5">
      <p className="text-[12.5px] font-bold text-ink-900">
        What {householdName} is told
      </p>
      <p className="text-[12px] text-ink-500 mt-0.5 mb-2.5">
        They see this on their own screen as soon as you change it.
      </p>
      <div className="space-y-1.5">
        {SHARE_RUNGS.map((rung) => {
          const on = rung.id === level;
          return (
            <button
              key={rung.id}
              type="button"
              onClick={() => onChange(rung.id)}
              aria-pressed={on}
              className={`w-full text-left rounded-xl border px-3.5 py-2.5 transition-colors cursor-pointer ${
                on
                  ? 'border-clay-400 bg-white shadow-soft'
                  : 'border-cream-200 bg-white/50 hover:bg-white'
              }`}
            >
              <span className="flex items-start gap-2.5">
                {/* A filled dot rather than a checkbox: these are rungs on one
                    ladder, not four independent switches, and a row of
                    checkboxes would invite somebody to try to tick the third
                    without the second. */}
                <span className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                  on ? 'border-clay-500' : 'border-ink-200'
                }`}>
                  {on && <span className="w-2 h-2 rounded-full bg-clay-500" />}
                </span>
                <span className="min-w-0">
                  <span className={`block text-[13.5px] ${on ? 'font-bold text-ink-900' : 'font-semibold text-ink-700'}`}>
                    {rung.label}
                  </span>
                  <span className="block text-[12px] text-ink-500 mt-0.5 leading-snug">
                    {rung.detail(who)}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[11.5px] text-ink-400 mt-2.5">
        Turning it down again takes effect immediately — nothing is kept on their side.
      </p>
    </div>
  );
}

function SuccessorCard({
  successor, members, connectedPeople, roles, canWrite, onSave,
  isAdmin, willsAccess, savingUid, onGrantReader, onInvite, onCancelInvite,
}: {
  connectedPeople: ConnectedCandidate[];
  successor?: DesignatedSuccessor;
  members: FamilyMember[];
  roles: Record<string, FamilyMemberRole>;
  canWrite: boolean;
  onSave: (next: DesignatedSuccessor | undefined) => void;
  isAdmin: boolean;
  willsAccess: WillsAccessDoc | null;
  savingUid: string | null;
  onGrantReader: (uid: string) => Promise<void>;
  onInvite: (name: string, replacePendingId?: string) => Promise<string>;
  onCancelInvite: (entry: PendingWillReader) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(successor?.name || '');
  const [what, setWhat] = useState(successor?.whatTheyShouldDo || '');

  // Re-sync local draft from the saved value whenever it changes elsewhere —
  // but never while THIS user is actively editing (would overwrite their
  // in-progress typing the moment a remote snapshot lands).
  useEffect(() => {
    if (editing) return;
    setName(successor?.name || '');
    setWhat(successor?.whatTheyShouldDo || '');
  }, [successor, editing]);

  const access = resolveSuccessorAccess(successor, members, roles);

  const save = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      onSave(undefined);
      setEditing(false);
      return;
    }
    const key = trimmedName.toLowerCase();
    const matched = members.find(m => m.name.trim().toLowerCase() === key);
    // Own family wins a name clash — they are the ones who can actually be
    // granted access, so resolving to them is the more useful answer.
    const cousin = matched ? undefined : connectedPeople.find(c => c.name.trim().toLowerCase() === key);
    onSave({
      name: trimmedName,
      memberId: matched?.id,
      fromLinkId: cousin?.linkId,
      sharedMemberId: cousin?.memberId,
      fromFamilyName: cousin?.householdName,
      whatTheyShouldDo: what.trim(),
      setAt: new Date().toISOString(),
    });
    setEditing(false);
  };

  return (
    <div className="card overflow-hidden">
      <div className="p-5 sm:p-6 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-sage-100 text-sage-700 shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-ink-900">Who takes over</h2>
            <p className="text-[13px] text-ink-400 font-medium">
              If something happens to you, who steps in — and can they get in today.
            </p>
          </div>
        </div>
        {canWrite && !editing && successor?.name && (
          <button onClick={() => setEditing(true)} className="btn-quiet p-2 shrink-0">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="px-5 sm:px-6 pb-5 sm:pb-6">
        {editing ? (
          <div className="space-y-3 p-4 rounded-2xl border border-clay-200 bg-clay-50/60">
            <div>
              <label className="field-label">Name</label>
              <input
                autoFocus
                className="field w-full"
                list="successor-name-options"
                placeholder="e.g. Thandi, or someone outside the app"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">What they're expected to do</label>
              <textarea
                rows={3}
                className="field w-full resize-none"
                placeholder="e.g. Take over the vault, notify the bank, tell the kids' school"
                value={what}
                onChange={e => setWhat(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(false)} className="btn-quiet text-xs px-3 py-1.5">Cancel</button>
              <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
            </div>
          </div>
        ) : successor?.name ? (
          <div className="space-y-2">
            <p className="text-[15px] font-semibold text-ink-900 flex items-center gap-2 flex-wrap">
              {successor.name}
              {successor.fromFamilyName && (
                <span className="chip bg-dusk-100 text-dusk-700">in {successor.fromFamilyName}</span>
              )}
            </p>
            {successor.fromFamilyName && (
              <p className="text-[12.5px] text-ink-500">
                They are in a connected family, so they have no way into this vault today —
                naming them is not access. You choose below how much they are told.
              </p>
            )}
            {/* THE LADDER. Only for somebody in a CONNECTED household: for a
                person in your own vault the real mechanic is the reader grant
                below, not disclosure, and offering both would suggest they are
                alternatives. */}
            {successor.fromFamilyName && canWrite && (
              <SuccessorShareLadder
                level={successor.shareLevel || 'fact'}
                householdName={successor.fromFamilyName}
                personName={successor.name}
                onChange={(next) => onSave({
                  ...successor,
                  shareLevel: next,
                  shareLevelSetAt: new Date().toISOString(),
                })}
              />
            )}
            {successor.whatTheyShouldDo && (
              <p className="text-[13px] text-ink-600 whitespace-pre-wrap">{successor.whatTheyShouldDo}</p>
            )}
            {access && <span className={`chip inline-block mt-1 ${ACCESS_STYLE[access.status]}`}>{access.label}</span>}
            {isAdmin && access && (
              <EstateAccessActions
                successorName={successor.name}
                resolved={access}
                willsAccess={willsAccess}
                savingUid={savingUid}
                onGrantReader={onGrantReader}
                onInvite={onInvite}
                onCancelInvite={onCancelInvite}
              />
            )}
          </div>
        ) : (
          <p className="text-[13px] text-ink-500">
            Nobody is named yet.{' '}
            {canWrite && (
              <button onClick={() => setEditing(true)} className="text-clay-600 font-semibold hover:underline">
                Name someone
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Getting the named person actually able to open this ──────────────────
//
// Rory's ask, verbatim: "can we give access to this person even tho they may
// not be on the app? perhaps a good reason for that person designated to
// download the app right? so we should be able to send a private note to that
// person and say hey so-and-so, i have designated you to help with my estate
// in the event of death, you can find full access to my records and will in
// this app."
//
// Naming a successor and locking the will are two halves that don't meet on
// their own: v230 will only let an admin name someone who ALREADY has a login
// here, and the successor usually doesn't. So this closes it three ways —
// one tap if they're already in the vault, an invite that CARRIES the grant if
// they're not, and a visible pending state in between. The invite has to carry
// the grant rather than remind the admin to come back and tick a box, because
// the day it matters is the day they can't.
//
// Admin-only (rendered behind isAdmin): everything here writes willsAccess,
// which the rule lets admins alone write.
function estateInviteMessage(ownerName: string, code: string) {
  return {
    title: `${ownerName} has named you to look after their estate`,
    text: [
      `${ownerName} has named you as the person who steps in if something happens to them.`,
      `Accepting does not open their will. It records that you are the person, and shows you where the signed will is kept — with a notary, in a register, wherever they have said. If the day comes that you need to read the whole thing, you ask for it from inside the app, and it opens after seven days unless they say no.`,
      `Everything is kept in Teluva, a private family vault. You'll need to sign in with a Google account.`,
      `Invite code ${code}. It works once, and runs out in 14 days.`,
      `Teluva is still in testing, so if Google turns you away, reply with the address you tried.`,
    ].join('\n\n'),
  };
}


/**
 * HOW READY IS THIS. Rory: "some basic instructions to come up when someone
 * is doing there will and maybe a seperate progress slider thats says how
 * ready one is."
 *
 * The two are one component on purpose. Instructions parked at the top of a
 * page get read once and scrolled past forever; a bare percentage says you
 * are at 40% and nothing about what the rest is. Here the instruction IS the
 * step — each undone item carries its own sentence, and the bar is simply how
 * many are done.
 *
 * Collapsed by default once anything is done, because a checklist that will
 * not fold away turns into nagging, and this page is one people open when
 * they are already uneasy.
 */
/**
 * Funeral cover, read-only, on the page where it is needed.
 *
 * ONE WRITER, TWO PLACES TO READ. Insurance under Finances remains the only
 * screen that can change any of this; there is deliberately no edit control
 * here, because two editors for one policy is how a claims number ends up
 * differing depending on which screen you opened.
 *
 * The card renders even with nothing on file. An estate page that silently
 * omits funeral cover reads as "there is none" to the person who most needs to
 * know whether to look — so the empty state says plainly that nothing is
 * recorded and where to put it, rather than the section vanishing.
 */
function FuneralCoverCard({ policies }: { policies: InsurancePolicy[] }) {
  const lines = useMemo(() => funeralCoverLines(policies), [policies]);

  return (
    <div className="card overflow-hidden">
      <div className="p-5 sm:p-6 border-b border-cream-200 flex items-center gap-3">
        <div className="p-2 rounded-xl bg-clay-100 text-clay-700 shrink-0">
          <HandHeart className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold text-ink-900">Funeral cover</h3>
          <p className="text-[13px] text-ink-400 font-medium">
            The number to ring in the first day, before anyone reads a will.
          </p>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-3">
        {lines.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-cream-300 bg-cream-50/60 px-4 py-4">
            <p className="text-[13.5px] font-semibold text-ink-700">
              No funeral cover or burial society recorded.
            </p>
            <p className="text-[12.5px] text-ink-500 mt-1.5 leading-relaxed">
              If there is a policy or a society, add it under <strong>Finances → Insurance</strong> and
              set its type to Funeral cover, Burial society or Repatriation cover. It will appear here.
              If there genuinely is none, that is worth saying out loud in the letter below — it is the
              first thing a family discovers, usually at the worst moment.
            </p>
          </div>
        ) : lines.map((l: FuneralCoverLine) => (
          <div key={l.id} className="rounded-2xl border border-cream-200 bg-white px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-bold text-ink-900 break-words">{l.provider}</p>
                <p className="text-[12px] text-ink-400 font-medium mt-0.5">{l.type}</p>
              </div>
              {l.policyNumber && (
                <span className="text-[12px] font-semibold text-ink-600 tabular-nums shrink-0 bg-cream-100 rounded-lg px-2 py-1">
                  {l.policyNumber}
                </span>
              )}
            </div>

            {l.callValue && (
              <div className="mt-2.5">
                {l.callIsPhone ? (
                  <a
                    href={`tel:${l.callTel}`}
                    className="inline-flex items-center gap-2 rounded-xl bg-ink-900 text-white px-3.5 py-2 text-[13px] font-bold hover:bg-ink-800 transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5" /> {l.callLabel}: {l.callValue}
                  </a>
                ) : (
                  <p className="text-[13px] text-ink-700">
                    <span className="font-semibold">{l.callLabel}:</span> {l.callValue}
                  </p>
                )}
              </div>
            )}

            <div className="mt-2 space-y-1">
              {l.beneficiary && (
                <p className="text-[12.5px] text-ink-500">Pays out to <strong className="text-ink-700">{l.beneficiary}</strong></p>
              )}
              {l.repatriation && <p className="text-[12.5px] text-ink-500">{l.repatriation}</p>}
              {l.bare && (
                <p className="text-[12.5px] text-clay-700">
                  No policy number and no number to ring — add them in Insurance while you still can.
                </p>
              )}
              {l.waitingNote && (
                <p className="text-[12.5px] text-clay-700 flex items-start gap-1.5">
                  <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {l.waitingNote}
                </p>
              )}
            </div>
          </div>
        ))}

        <p className="text-[12px] text-ink-400 leading-relaxed">
          Shown here, changed under Finances → Insurance. Waiting periods are read from the dates on
          the policy — this is what the policy says, not a decision about any particular claim.
        </p>
      </div>
    </div>
  );
}

function EstateReadinessCard({ readiness }: { readiness: EstateReadiness }) {
  const [open, setOpen] = useState(readiness.percent === 0);
  const { percent, doneCount, steps, next } = readiness;
  const tone = percent >= 80 ? 'bg-sage-500' : percent >= 40 ? 'bg-honey-500' : 'bg-clay-500';

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full text-left p-5 sm:p-6 cursor-pointer"
        aria-expanded={open}
      >
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <h2 className="font-display text-lg font-semibold text-ink-900">How ready this is</h2>
          <span className="text-[15px] font-bold text-ink-900 tabular-nums shrink-0">{percent}%</span>
        </div>
        <div className="h-2 rounded-full bg-cream-200 overflow-hidden" role="presentation">
          <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${percent}%` }} />
        </div>
        <p className="text-[12.5px] text-ink-500 mt-2">
          {doneCount} of {steps.length} done
          {next && <> · next: <span className="font-semibold text-ink-700">{next.label}</span></>}
        </p>
      </button>

      {open && (
        <div className="px-5 sm:px-6 pb-5 sm:pb-6 space-y-2">
          {steps.map(step => (
            <div
              key={step.id}
              className={`rounded-xl border px-3.5 py-2.5 ${
                step.done ? 'border-cream-200 bg-cream-50/50' : 'border-cream-300 bg-white'
              }`}
            >
              <p className="text-[13.5px] font-semibold flex items-start gap-2">
                <span className={`mt-0.5 w-4 h-4 rounded-full shrink-0 flex items-center justify-center ${
                  step.done ? 'bg-sage-500 text-white' : 'border-2 border-ink-200'
                }`}>
                  {step.done && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
                </span>
                <span className={step.done ? 'text-ink-400 line-through decoration-ink-200' : 'text-ink-900'}>
                  {step.label}
                </span>
              </p>
              {/* The instruction only where it is still needed. */}
              {!step.done && (
                <p className="text-[12.5px] text-ink-500 mt-1 ml-6 leading-snug">{step.how}</p>
              )}
            </div>
          ))}
          <p className="text-[11.5px] text-ink-400 pt-1 leading-snug">
            This is about what Teluva has recorded, not about whether a document is
            legally sound. Only a lawyer or notary can tell you that.
          </p>
        </div>
      )}
    </div>
  );
}

function EstateAccessActions({
  successorName, resolved, willsAccess, savingUid, onGrantReader, onInvite, onCancelInvite,
}: {
  successorName: string;
  resolved: SuccessorAccessResult;
  willsAccess: WillsAccessDoc | null;
  savingUid: string | null;
  onGrantReader: (uid: string) => Promise<void>;
  onInvite: (name: string, replacePendingId?: string) => Promise<string>;
  onCancelInvite: (entry: PendingWillReader) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const granted = !!resolved.uid && (willsAccess?.readerUids || []).includes(resolved.uid);
  const pending = pendingInviteFor(willsAccess, successorName);
  const expired = pending ? isInviteExpired(pending) : false;

  const ownerName = auth.currentUser?.displayName || auth.currentUser?.email || 'Someone';
  const joinUrl = code ? `${window.location.origin}/join/${code}` : null;
  const message = code ? estateInviteMessage(ownerName, code) : null;

  async function send(replacePendingId?: string) {
    setBusy(true);
    setError(null);
    try {
      setCode(await onInvite(successorName, replacePendingId));
    } catch (e: any) {
      setError(e?.message || 'Could not create the invite. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(entry: PendingWillReader) {
    setBusy(true);
    setError(null);
    const ok = await onCancelInvite(entry);
    if (!ok) setError('Could not withdraw that invite. Check your connection and try again.');
    setBusy(false);
  }

  function copy() {
    if (!joinUrl || !message) return;
    navigator.clipboard.writeText(`${message.text}\n\n${joinUrl}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => setError('Could not copy — select the link above instead.'));
  }

  function share() {
    if (!joinUrl || !message) return;
    // Deliberately a SECOND tap, not chained onto the one that minted the code:
    // the share sheet needs a live user gesture, and an await in between is
    // enough for Safari to refuse it. It also means the message is read before
    // it's sent, which for this particular message seems fair.
    if (navigator.share) navigator.share({ title: message.title, text: message.text, url: joinUrl }).catch(() => {});
    else copy();
  }

  // Already an admin — they can open this by rule, nothing to arrange.
  if (resolved.status === 'admin') return null;

  // Once a code exists the only thing left is to send it. Shown INSTEAD of the
  // rows below, which would otherwise say "invite sent, waiting for them to
  // sign in" while it is still sitting on this screen unsent.
  if (code && message) {
    return (
      <div className="pt-2 space-y-2">
        <div className="rounded-xl border border-sage-200 bg-sage-50/70 p-3 space-y-2">
          <p className="text-[12px] font-semibold text-ink-900">Ready to send to {successorName}</p>
          <p className="text-[12px] text-ink-600 leading-relaxed whitespace-pre-wrap">{message.text}</p>
          <p className="text-[11px] font-mono text-ink-500 break-all">{joinUrl}</p>
          <div className="flex gap-2">
            <button onClick={share} className="btn-primary text-xs px-3 py-1.5 flex-1 justify-center">
              <Send className="w-3.5 h-3.5" /> Send it
            </button>
            <button onClick={copy} className="btn-quiet text-xs px-3 py-1.5">
              {copied ? <Check className="w-3.5 h-3.5" /> : null}{copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-[11px] text-ink-400 leading-relaxed">
            The link only works once. If you lose it, withdraw the invite below and send a fresh one.
          </p>
        </div>
        {error && <p role="alert" className="text-[11px] text-rosa-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="pt-2 space-y-2">
      {granted ? (
        <p className="text-[12px] text-sage-700 flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          You have let them open this page — they can read the will now.
        </p>
      ) : resolved.uid ? (
        // In the vault already; the will is what they still can't see.
        <>
          <p className="text-[12px] text-ink-500 leading-relaxed">
            They&rsquo;re in the vault, but this page is locked to admins and the people you name.
          </p>
          <button
            onClick={() => onGrantReader(resolved.uid!)}
            disabled={savingUid === resolved.uid}
            className="btn-primary text-xs px-3 py-1.5 disabled:opacity-60"
          >
            {savingUid === resolved.uid
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Lock className="w-3.5 h-3.5" />}
            Let them open this page
          </button>
        </>
      ) : pending && !expired ? (
        <div className="rounded-xl bg-cream-100 border border-cream-200 p-3 space-y-2">
          <p className="text-[12px] text-ink-700 leading-relaxed">
            Invite sent {new Date(pending.invitedAt).toLocaleDateString()} &mdash; waiting for them to sign in.
            They&rsquo;ll be able to open this page the moment they do.
          </p>
          <button onClick={() => cancel(pending)} disabled={busy} className="btn-quiet text-[11px] px-2.5 py-1 disabled:opacity-60">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
            Withdraw the invite
          </button>
        </div>
      ) : (
        <>
          <p className="text-[12px] text-ink-500 leading-relaxed">
            {pending
              ? `The invite you sent ${new Date(pending.invitedAt).toLocaleDateString()} ran out before it was used.`
              : `${successorName} can't open any of this yet. Send them a private link — they join the vault as a member, and this page opens for them automatically.`}
          </p>
          <button onClick={() => send(pending?.id)} disabled={busy} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-60">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
            {pending ? 'Send a new invite' : 'Invite them'}
          </button>
        </>
      )}

      {error && <p role="alert" className="text-[11px] text-rosa-600">{error}</p>}
    </div>
  );
}

// ── If something happens to you ─────────────────────────────────────────
// Keys/safes + a free-text letter, who must be told, and what to close down.
// Three independent sub-sections sharing one EmergencyInstructions object —
// each saves through the same `onSave` (patch-style: spreads over whatever
// is already there) so editing one never touches the others.
function InstructionsCard({ instructions, canWrite, onSave }: {
  instructions?: EmergencyInstructions;
  canWrite: boolean;
  onSave: (next: EmergencyInstructions | undefined) => void;
}) {
  const [editingText, setEditingText] = useState(false);
  const [keysAndSafes, setKeysAndSafes] = useState(instructions?.keysAndSafes || '');
  const [letter, setLetter] = useState(instructions?.letter || '');
  const [addingContact, setAddingContact] = useState(false);
  const [editContactId, setEditContactId] = useState<string | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);

  useEffect(() => {
    if (editingText) return;
    setKeysAndSafes(instructions?.keysAndSafes || '');
    setLetter(instructions?.letter || '');
  }, [instructions, editingText]);

  const patch = (fields: Partial<EmergencyInstructions>) => {
    onSave({ ...(instructions || {}), ...fields, updatedAt: new Date().toISOString() });
  };

  const saveText = () => {
    patch({ keysAndSafes: keysAndSafes.trim() || undefined, letter: letter.trim() || undefined });
    setEditingText(false);
  };

  const notifyContacts = instructions?.notifyContacts || [];
  const accountsToClose = instructions?.accountsToClose || [];

  const addContact = (c: NotifyContact) => { patch({ notifyContacts: [...notifyContacts, c] }); setAddingContact(false); };
  const updateContact = (c: NotifyContact) => { patch({ notifyContacts: notifyContacts.map(x => x.id === c.id ? c : x) }); setEditContactId(null); };
  const deleteContact = (id: string) => patch({ notifyContacts: notifyContacts.filter(x => x.id !== id) });

  const addAccount = (a: AccountToClose) => { patch({ accountsToClose: [...accountsToClose, a] }); setAddingAccount(false); };
  const updateAccount = (a: AccountToClose) => { patch({ accountsToClose: accountsToClose.map(x => x.id === a.id ? a : x) }); setEditAccountId(null); };
  const deleteAccount = (id: string) => patch({ accountsToClose: accountsToClose.filter(x => x.id !== id) });
  const toggleAccountClosed = (id: string) => patch({ accountsToClose: accountsToClose.map(x => x.id === id ? { ...x, closed: !x.closed } : x) });

  const hasText = !!(instructions?.keysAndSafes || instructions?.letter);

  return (
    <div className="card overflow-hidden divide-y divide-cream-200">
      <div className="p-5 sm:p-6 flex items-start gap-3">
        <div className="p-2 rounded-xl bg-clay-50 text-clay-600 shrink-0">
          <Key className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-semibold text-ink-900">If something happens to you</h2>
          <p className="text-[13px] text-ink-400 font-medium">
            Where the physical keys are, who needs to be told, what to close down — and a letter, in your own words.
          </p>
        </div>
      </div>

      {/* Keys/safes + letter */}
      <div className="p-5 sm:p-6 space-y-3">
        {editingText ? (
          <>
            <div>
              <label className="field-label">Where physical keys, safes and deeds are kept</label>
              <input
                className="field w-full"
                placeholder="e.g. Spare key with neighbour Frau Berger, safe combination in the blue notebook"
                value={keysAndSafes}
                onChange={e => setKeysAndSafes(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">Letter to your family</label>
              <textarea
                rows={5}
                className="field w-full resize-none"
                placeholder="Anything you'd want them to read first — in your own words"
                value={letter}
                onChange={e => setLetter(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingText(false)} className="btn-quiet text-xs px-3 py-1.5">Cancel</button>
              <button onClick={saveText} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
            </div>
          </>
        ) : (
          <>
            {instructions?.keysAndSafes && (
              <div>
                <p className="section-label mb-1">Keys, safes &amp; deeds</p>
                <p className="text-[14px] text-ink-800">{instructions.keysAndSafes}</p>
              </div>
            )}
            {instructions?.letter && (
              <div>
                <p className="section-label mb-1">Letter to your family</p>
                <p className="text-[14px] text-ink-700 whitespace-pre-wrap">{instructions.letter}</p>
              </div>
            )}
            {!hasText && <p className="text-[13px] text-ink-500">Nothing written yet.</p>}
            {canWrite && (
              <button onClick={() => setEditingText(true)} className="btn-quiet text-xs px-3 py-1.5">
                <Pencil className="w-3.5 h-3.5" /> {hasText ? 'Edit' : 'Add'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Who must be told */}
      <div className="p-5 sm:p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="section-label">Who must be told</h3>
          {canWrite && !addingContact && (
            <button onClick={() => { setAddingContact(true); setEditContactId(null); }} className="btn-quiet text-xs px-2.5 py-1.5">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          )}
        </div>
        {addingContact && <NotifyContactForm onSave={addContact} onCancel={() => setAddingContact(false)} />}
        {notifyContacts.length === 0 && !addingContact ? (
          <p className="text-[13px] text-ink-500">Nobody listed yet — a sibling, employer HR, the landlord, a solicitor.</p>
        ) : (
          <div className="space-y-2">
            {notifyContacts.map(c => (
              editContactId === c.id ? (
                <div key={c.id}>
                  <NotifyContactForm initial={c} onSave={updateContact} onCancel={() => setEditContactId(null)} />
                </div>
              ) : (
                <div key={c.id} className="flex items-start justify-between gap-2 p-3 rounded-xl bg-cream-50 border border-cream-200">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold text-ink-800">{c.name}{c.relation ? ` · ${c.relation}` : ''}</p>
                    {c.phone && (
                      <a href={`tel:${c.phone.replace(/\s+/g, '')}`} className="text-[12.5px] text-clay-600 hover:underline block">
                        {c.phone}
                      </a>
                    )}
                    {c.email && <p className="text-[12px] text-ink-500 truncate">{c.email}</p>}
                    {c.notes && <p className="text-[12px] text-ink-400">{c.notes}</p>}
                  </div>
                  {canWrite && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => { setEditContactId(c.id); setAddingContact(false); }} className="p-1.5 text-ink-400 hover:text-ink-700" title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <ConfirmDeleteButton onConfirm={() => deleteContact(c.id)} ariaLabel={`Remove ${c.name}`} />
                    </div>
                  )}
                </div>
              )
            ))}
          </div>
        )}
      </div>

      {/* Accounts & subscriptions to close */}
      <div className="p-5 sm:p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="section-label">Accounts &amp; subscriptions to close</h3>
          {canWrite && !addingAccount && (
            <button onClick={() => { setAddingAccount(true); setEditAccountId(null); }} className="btn-quiet text-xs px-2.5 py-1.5">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          )}
        </div>
        {addingAccount && <AccountForm onSave={addAccount} onCancel={() => setAddingAccount(false)} />}
        {accountsToClose.length === 0 && !addingAccount ? (
          <p className="text-[13px] text-ink-500">Nothing listed yet — subscriptions, memberships, contracts.</p>
        ) : (
          <div className="space-y-2">
            {accountsToClose.map(a => (
              editAccountId === a.id ? (
                <div key={a.id}>
                  <AccountForm initial={a} onSave={updateAccount} onCancel={() => setEditAccountId(null)} />
                </div>
              ) : (
                <div key={a.id} className="flex items-start justify-between gap-2 p-3 rounded-xl bg-cream-50 border border-cream-200">
                  <label className="flex items-start gap-2 min-w-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!a.closed}
                      onChange={() => toggleAccountClosed(a.id)}
                      disabled={!canWrite}
                      className="mt-1 rounded"
                    />
                    <span className="min-w-0">
                      <p className={`text-[13.5px] font-semibold ${a.closed ? 'text-ink-400 line-through' : 'text-ink-800'}`}>{a.name}</p>
                      {a.accountRef && <p className="text-[12px] text-ink-400 font-mono">Ref: {a.accountRef}</p>}
                      {a.notes && <p className="text-[12px] text-ink-400">{a.notes}</p>}
                    </span>
                  </label>
                  {canWrite && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => { setEditAccountId(a.id); setAddingAccount(false); }} className="p-1.5 text-ink-400 hover:text-ink-700" title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <ConfirmDeleteButton onConfirm={() => deleteAccount(a.id)} ariaLabel={`Remove ${a.name}`} />
                    </div>
                  )}
                </div>
              )
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NotifyContactForm({ initial, onSave, onCancel }: {
  initial?: NotifyContact;
  onSave: (c: NotifyContact) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [relation, setRelation] = useState(initial?.relation || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!name.trim()) { setError('Add a name'); return; }
    onSave({
      id: initial?.id || newId(),
      name: name.trim(),
      relation: relation.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input autoFocus className="field" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
        <input className="field" placeholder="Relation (e.g. Sister, Solicitor)" value={relation} onChange={e => setRelation(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input className="field" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
        <input className="field" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <input className="field" placeholder="Note (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
      {error && <p role="alert" className="text-[11px] text-rosa-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}

function AccountForm({ initial, onSave, onCancel }: {
  initial?: AccountToClose;
  onSave: (a: AccountToClose) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [accountRef, setAccountRef] = useState(initial?.accountRef || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!name.trim()) { setError('Add a name'); return; }
    onSave({
      id: initial?.id || newId(),
      name: name.trim(),
      accountRef: accountRef.trim() || undefined,
      notes: notes.trim() || undefined,
      closed: initial?.closed,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <input autoFocus className="field" placeholder="e.g. Netflix, gym membership, mobile contract" value={name} onChange={e => setName(e.target.value)} />
      <input className="field" placeholder="Account / customer reference (optional)" value={accountRef} onChange={e => setAccountRef(e.target.value)} />
      <input className="field" placeholder="Note (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
      {error && <p role="alert" className="text-[11px] text-rosa-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}

// ── Locked ──────────────────────────────────────────────────────────────
// What someone without access sees. It names WHO to ask rather than just
// refusing — a dead end with no next step reads as a broken app, and the
// person who can grant access is always an admin of this space.
/* ── THE DOORBELL ────────────────────────────────────────────────────────────
 *
 * What a named person sees instead of a dead end.
 *
 * The old locked screen said "ask an admin to give you access", which is sound
 * advice right up until the admin is the person whose will it is. That sentence
 * was the whole gap: there was no path at all from "you were named" to "you can
 * read it", so the will simply became unreadable the moment its owner was gone.
 *
 * This screen is that path. It does not decide anything — server/willsRelease.mjs
 * does — it asks, and then tells the truth about what is happening.
 */
/**
 * RUNG ONE, for somebody an estate invite named: who holds the signed will.
 *
 * This is the whole of what being named gets you before the will opens, and it
 * is deliberately not much: a custodian, or the fact that it is lodged in a
 * register. Knowing a notary in Vienna holds it does not let anyone take it —
 * it lets them ring the right doorbell on the worst day of their life instead
 * of searching a house. The hiding place appears only when nobody holds it and
 * no register has it, at which point it is the only answer that exists.
 */
function WhereItIsCard({ entries }: { entries: FindabilityEntry[] }) {
  const line = (e: FindabilityEntry) => {
    if (e.heldBy) return `Held by ${e.heldBy}`;
    if (e.notaryName) return `With the notary ${e.notaryName}`;
    if (e.registered) return e.registryName ? `Lodged in ${e.registryName}` : 'Lodged in a will register';
    if (e.originalLocation) return `Kept at ${e.originalLocation}`;
    return null;
  };
  return (
    <div className="card p-5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 flex items-center gap-1.5">
        <MapPin className="w-3 h-3" /> Where the signed will is
      </p>
      <div className="mt-2.5 space-y-2.5">
        {entries.map((e, i) => {
          const where = line(e);
          return (
            <div key={i} className="rounded-xl border border-cream-200 px-3.5 py-3">
              <p className="text-[12px] text-ink-400">{e.kind || 'Will'}</p>
              {where ? (
                <p className="text-[14px] text-ink-900 font-medium mt-0.5">{where}</p>
              ) : (
                /* Said out loud rather than shown as an empty card. The point of
                   telling somebody early is that they can still ask. */
                <p className="text-[13.5px] text-ink-700 mt-0.5 leading-relaxed">
                  Nothing has been written down about where this is kept. It is worth asking
                  them now &mdash; on the day it matters, there is nobody left to ask.
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[12px] text-ink-500 mt-3 leading-relaxed">
        You were named to help with this estate, so you can see where the signed will is
        even though the rest of this page is still private.
      </p>
    </div>
  );
}

function ReleaseDoorbell({ isChild }: { isChild: boolean }) {
  const [requests, setRequests] = useState<ReleaseRequestRow[] | null>(null);
  const [findability, setFindability] = useState<FindabilityEntry[] | null>(null);
  const [named, setNamed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justAsked, setJustAsked] = useState(false);
  const uid = auth.currentUser?.uid || '';

  const refresh = async () => {
    try {
      const out = await loadReleaseState();
      setRequests(out.requests || []);
      setFindability(out.findability || null);
      setNamed(!!out.youAreNamed);
      // The sweep may have opened it on this very call — the person waiting is
      // usually the one whose visit settles their own clock.
      if (out.youMayRead) window.location.reload();
    } catch {
      setRequests([]);
    }
  };
  useEffect(() => { if (!isChild) refresh(); /* eslint-disable-next-line */ }, [isChild]);

  const mine = (requests || []).find((r) => r.requestedBy === uid && !r.declinedAt && !r.releasedAt);
  const declined = (requests || []).find((r) => r.requestedBy === uid && r.declinedAt);
  const others = (requests || []).filter(
    (r) => r.requestedBy !== uid && !r.declinedAt && !r.releasedAt,
  );

  const ask = async () => {
    setBusy(true); setError(null);
    try { await requestWillRelease(); setJustAsked(true); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not send that.'); }
    finally { setBusy(false); }
  };

  const agree = async (id: string) => {
    setBusy(true); setError(null);
    try {
      const out = await approveWillRelease(id);
      if (out.released) { window.location.reload(); return; }
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not record that.'); }
    finally { setBusy(false); }
  };

  if (isChild) return <LockedCard isChild />;

  return (
    <div className="max-w-lg space-y-4">
      <div className="card p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-ink-900 text-white flex items-center justify-center">
          <Lock className="w-7 h-7" />
        </div>
        <h2 className="font-display text-xl font-semibold text-ink-900">
          {named ? 'You were named for this' : 'Wills & Estate is private'}
        </h2>
        <p className="text-[13px] text-ink-500 leading-relaxed mt-2 max-w-xs mx-auto">
          {named
            ? 'Being named means you can find the will and ask to read it. It does not open it — that stays theirs to decide while they can.'
            : 'Only the people an admin has named can open this. Everything else in the vault is unchanged.'}
        </p>
      </div>

      {findability && findability.length > 0 && <WhereItIsCard entries={findability} />}

      {/* Somebody else has already asked. Agreeing is the fast door — and it is
          offered BEFORE the button to ask separately, because two people asking
          separately is two clocks and helps nobody. */}
      {others.length > 0 && (
        <div className="card p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 flex items-center gap-1.5">
            <BellRing className="w-3 h-3" /> Somebody has asked
          </p>
          <div className="mt-2.5 space-y-2.5">
            {others.map((r) => (
              <div key={r.id} className="rounded-xl border border-cream-200 px-3.5 py-3">
                <p className="text-[13.5px] text-ink-800">
                  <strong>{r.requestedByName || 'Someone named'}</strong> asked to read the will.
                </p>
                <p className="text-[12.5px] text-ink-500 mt-1">
                  It opens on its own {waitLabel(daysLeft(r.requestedAt))} if nobody refuses.
                  If you agree it should be opened, it may open sooner.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => agree(r.id)}
                  className="btn-primary text-[13px] px-4 py-2 mt-2.5 inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <ThumbsUp className="w-3.5 h-3.5" /> I agree it should be opened
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-5">
        {mine ? (
          <>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 flex items-center gap-1.5">
              <Clock className="w-3 h-3" /> You have asked
            </p>
            <p className="text-[13.5px] text-ink-800 mt-2 leading-relaxed">
              {justAsked ? 'Sent. ' : ''}
              This opens {waitLabel(daysLeft(mine.requestedAt))} unless an admin of this space refuses.
              They have been told you asked.
            </p>
            <p className="text-[12.5px] text-ink-500 mt-2 leading-relaxed">
              If somebody else who was named also agrees it should be opened, it can open sooner —
              but only once this space has been unused for {QUIET_DAYS} days. While its owner is
              still using the app, the {RELEASE_WAIT_DAYS} days stand, so they keep the chance to say no.
            </p>
          </>
        ) : declined ? (
          <>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
              Your request was refused
            </p>
            <p className="text-[13.5px] text-ink-800 mt-2 leading-relaxed">
              An admin of this space refused it. You can ask again, and that starts a fresh
              {' '}{RELEASE_WAIT_DAYS} days — but it may be worth speaking to them first.
            </p>
            <button type="button" disabled={busy} onClick={ask}
              className="btn-quiet text-[13px] px-4 py-2 mt-3 disabled:opacity-50">
              Ask again
            </button>
          </>
        ) : (
          <>
            <p className="text-[13.5px] text-ink-800 leading-relaxed">
              If you are meant to have this — you are handling someone&rsquo;s estate, or they asked
              you to — you can ask for it here.
            </p>
            <p className="text-[12.5px] text-ink-500 mt-2 leading-relaxed">
              Every admin of this space is told straight away and can refuse. If nobody refuses,
              it opens after {RELEASE_WAIT_DAYS} days. Nothing here decides that anyone has died;
              it only notices that nobody answered.
            </p>
            <button
              type="button"
              disabled={busy || requests === null}
              onClick={ask}
              className="btn-primary text-[13px] px-4 py-2 mt-3 inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <BellRing className="w-3.5 h-3.5" /> Ask to read the will
            </button>
          </>
        )}
        {error && <p className="text-[12.5px] text-clay-700 mt-2">{error}</p>}
      </div>
    </div>
  );
}

/**
 * The owner's side: who has asked, and the button that refuses them.
 *
 * Shown to admins ABOVE everything else on the page, because a request with a
 * clock running is the only thing here that gets worse if it is scrolled past.
 */
function ReleaseRequestsCard({ requests, onDecline, busyId, error }: {
  requests: ReleaseRequestRow[];
  onDecline: (id: string) => void;
  busyId: string | null;
  error: string | null;
}) {
  const live = requests.filter((r) => !r.declinedAt && !r.releasedAt);
  const opened = requests.filter((r) => r.releasedAt);
  if (!live.length && !opened.length) return null;

  return (
    <div className="card overflow-hidden border-clay-300">
      <div className="p-5 border-b border-cream-200 flex items-center gap-3">
        <div className="p-2 rounded-xl bg-clay-100 text-clay-700 shrink-0">
          <BellRing className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold text-ink-900">Someone asked to read your will</h3>
          <p className="text-[13px] text-ink-400 font-medium">You can refuse. Doing nothing lets it open.</p>
        </div>
      </div>
      <div className="p-5 space-y-3">
        {live.map((r) => (
          <div key={r.id} className="rounded-2xl border border-clay-300 bg-clay-50 px-4 py-3.5">
            <p className="text-[14px] font-bold text-ink-900">{r.requestedByName || 'Someone named'}</p>
            <p className="text-[12.5px] text-ink-600 mt-1">
              Asked on {new Date(r.requestedAt).toLocaleDateString()}.
              {' '}Opens <strong>{waitLabel(daysLeft(r.requestedAt))}</strong> unless you refuse.
            </p>
            {(r.approvals || []).length > 1 && (
              <p className="text-[12.5px] text-clay-700 mt-1">
                {(r.approvals || []).length} of the people you named agree it should be opened. It will
                open at once if this space goes {QUIET_DAYS} days unused.
              </p>
            )}
            <button
              type="button"
              disabled={busyId === r.id}
              onClick={() => onDecline(r.id)}
              className="btn-quiet text-[13px] px-4 py-2 mt-2.5 disabled:opacity-50"
            >
              No — refuse this
            </button>
          </div>
        ))}
        {opened.map((r) => (
          <div key={r.id} className="rounded-2xl border border-cream-200 px-4 py-3">
            <p className="text-[13.5px] text-ink-800">
              <strong>{r.requestedByName || 'Someone named'}</strong> can now read it — opened{' '}
              {new Date(r.releasedAt!).toLocaleDateString()}.
            </p>
            <p className="text-[12.5px] text-ink-500 mt-1">
              {r.releasedBecause === 'two-approvals-owner-quiet'
                ? 'Two of the people you named agreed while this space had gone unused.'
                : `Nobody refused it within ${RELEASE_WAIT_DAYS} days.`}
              {' '}To undo this, remove them in “Who can open this”.
            </p>
          </div>
        ))}
        {error && <p className="text-[12.5px] text-clay-700">{error}</p>}
      </div>
    </div>
  );
}

function LockedCard({ isChild }: { isChild: boolean }) {
  return (
    <div className="max-w-lg">
      <div className="card p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-ink-900 text-white flex items-center justify-center">
          <Lock className="w-7 h-7" />
        </div>
        <h2 className="font-display text-xl font-semibold text-ink-900">Wills &amp; Estate is private</h2>
        <p className="text-[13px] text-ink-500 leading-relaxed mt-2 max-w-xs mx-auto">
          {isChild
            ? 'This part of the vault is kept for the grown-ups who look after it.'
            : 'Only the people an admin has named can open this. Everything else in the vault is unchanged.'}
        </p>
        {!isChild && (
          <p className="text-[12px] text-ink-400 leading-relaxed mt-4 max-w-xs mx-auto">
            If you&rsquo;re meant to have it &mdash; you&rsquo;re handling someone&rsquo;s estate, or they&rsquo;ve
            asked you to &mdash; ask an admin of this space to give you access.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Who can open this ───────────────────────────────────────────────────
// Admin-only. Rory's ask, verbatim: "we should lock the will right? and give
// access to certain people — i don't want the kids going through it."
//
// Admins are not listed: they already have access by rule, and a toggle that
// can't be switched off reads as a bug. Children are not listed at all.
function AccessCard({
  access, roles, savingUid, error, onToggle, onCancelInvite,
}: {
  access: WillsAccessDoc | null;
  roles: Record<string, FamilyMemberRole>;
  savingUid: string | null;
  error: string | null;
  onToggle: (uid: string, granted: boolean) => void;
  onCancelInvite: (entry: PendingWillReader) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const candidates = grantableMembers(roles);
  const readers = access?.readerUids || [];
  // People an estate invite named (v329). They cannot read this page; they can
  // find the will and ask. Shown here because this is the card that answers
  // "who can open this", and "nobody yet, but two people are waiting to ask"
  // is part of that answer — an invisible list is a list nobody can revoke.
  const named = (access?.namedUids || []).filter((u) => !readers.includes(u));
  const stale = staleReaders(access, roles);
  const grantedCount = readers.filter(u => !stale.includes(u)).length;
  // Estate invites that have been sent but not redeemed. Listed here as well
  // as on the successor card because this is the card that answers "who can
  // open this" — and an invite in flight is part of that answer.
  const pending = pendingWillReaders(access);

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-4 sm:p-5 text-left hover:bg-cream-50 transition-colors"
      >
        <div className="p-2 rounded-xl bg-ink-900 text-white shrink-0">
          <Lock className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-ink-900">Who can open this</p>
          <p className="text-[12px] text-ink-500">
            {grantedCount === 0
              ? 'Admins only. Nobody else in the family can see this page.'
              : `Admins, plus ${grantedCount} named ${grantedCount === 1 ? 'person' : 'people'}.`}
            {named.length > 0 && ` ${named.length} named for later.`}
            {pending.length > 0 && ` ${pending.length} ${pending.length === 1 ? 'invite' : 'invites'} waiting.`}
          </p>
        </div>
        <span className="chip bg-ink-100 text-ink-700 shrink-0">{open ? 'Hide' : 'Change'}</span>
      </button>

      {open && (
        <div className="px-4 sm:px-5 pb-5 pt-1 space-y-3 border-t border-cream-200">
          <p className="text-[12px] text-ink-500 leading-relaxed pt-3">
            Giving someone access lets them read this page &mdash; the will, the letter, who to call. It does not
            let them change anything, and it doesn&rsquo;t touch the rest of the vault.
          </p>
          <p className="text-[12px] text-ink-500 leading-relaxed">
            Accepting an estate invite does <strong>not</strong> do this. It names them: they can see where the
            signed will is kept, and can ask to read the rest &mdash; which you are told about, and can refuse.
            Ticking someone here opens it for them today.
          </p>

          {candidates.length === 0 ? (
            <p className="text-[12px] text-ink-400 italic">
              There&rsquo;s nobody else to name yet. Everyone in this space is either an admin (who already has
              access) or a child.
            </p>
          ) : (
            <div className="space-y-1.5">
              {candidates.map(c => {
                const granted = readers.includes(c.uid);
                const busy = savingUid === c.uid;
                return (
                  <button
                    key={c.uid}
                    onClick={() => onToggle(c.uid, !granted)}
                    disabled={busy}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors text-left disabled:opacity-60 ${
                      granted ? 'border-sage-300 bg-sage-50' : 'border-cream-200 hover:bg-cream-50'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-md shrink-0 flex items-center justify-center ${
                      granted ? 'bg-sage-600 text-white' : 'border border-ink-200'
                    }`}>
                      {busy
                        ? <Loader2 className="w-3 h-3 animate-spin text-ink-400" />
                        : granted ? <Check className="w-3.5 h-3.5" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink-900 truncate">{c.label}</p>
                      {c.email && c.email !== c.label && (
                        <p className="text-[11px] text-ink-400 truncate">{c.email}</p>
                      )}
                    </div>
                    <span className={`chip shrink-0 ${
                      granted ? 'bg-sage-100 text-sage-700'
                        : named.includes(c.uid) ? 'bg-honey-100 text-honey-700'
                        : 'bg-cream-200 text-ink-500'
                    }`}>
                      {granted ? 'Can open' : named.includes(c.uid) ? 'Named, cannot open' : 'No access'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* A grant outlives the person: remove someone, or promote them to
              admin, and their uid stays on the list — silently re-granting
              access if they're ever re-added. Show it rather than pretend. */}
          {stale.length > 0 && (
            <div className="rounded-xl bg-honey-50 border border-honey-200 p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-honey-600 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-ink-700 leading-relaxed">
                  {stale.length} old {stale.length === 1 ? 'grant is' : 'grants are'} left over from
                  {stale.length === 1 ? ' someone who' : ' people who'} left this space or became an admin.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {stale.map(u => (
                    <button
                      key={u}
                      onClick={() => onToggle(u, false)}
                      disabled={savingUid === u}
                      className="btn-quiet text-[11px] px-2.5 py-1 rounded-lg disabled:opacity-60"
                    >
                      {savingUid === u ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                      Clear {u.slice(0, 6)}&hellip;
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Invites that carry this access but haven't been redeemed. Shown
              because an invite in flight is a grant in flight: it lands the
              moment they sign in, with nobody having to approve it again. */}
          {pending.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[11px] font-semibold text-ink-500 uppercase tracking-wide">Invited, not joined yet</p>
              {pending.map(p => {
                const expired = isInviteExpired(p);
                return (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-cream-200">
                    <div className="w-5 h-5 rounded-md shrink-0 flex items-center justify-center bg-cream-200 text-ink-500">
                      <Clock className="w-3 h-3" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink-900 truncate">{p.name}</p>
                      <p className="text-[11px] text-ink-400 truncate">
                        {expired
                          ? `Invite ran out ${p.expiresAt ? new Date(p.expiresAt).toLocaleDateString() : ''}`
                          : `Invited ${new Date(p.invitedAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    <button
                      onClick={async () => { setCancelling(p.id); await onCancelInvite(p); setCancelling(null); }}
                      disabled={cancelling === p.id}
                      className="btn-quiet text-[11px] px-2.5 py-1 rounded-lg shrink-0 disabled:opacity-60"
                    >
                      {cancelling === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                      {expired ? 'Clear' : 'Withdraw'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {error && <p role="alert" className="text-[11px] text-rosa-600">{error}</p>}

          <p className="text-[11px] text-ink-400 leading-relaxed">
            Only people who already have a login for this space can be named here. To give access to someone outside
            the family &mdash; the person handling your estate &mdash; name them under &ldquo;Who takes over&rdquo; and
            send them an invite from there; it carries this access with it.
          </p>
        </div>
      )}

    </div>
  );
}
