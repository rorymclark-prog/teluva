// One trip, one traveller, everything they might be asked to produce.
//
// The design constraint that decided the layout: this screen is read by someone
// who is somewhere else, possibly rattled, possibly on a bad connection, and
// quite possibly holding a phone in one hand at a desk while an official waits.
// So: no tabs, no accordions hiding required things, big targets, plain words,
// and the two panels that matter under stress — what is missing, and what to do
// if the documents are gone — pinned at the top and bottom rather than filed
// among the rest.
//
// It also prints, deliberately. Paper does not run out of battery at a border.

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, AlertTriangle, CheckCircle2, Circle, FileText, Printer,
  LifeBuoy, Phone, MapPin, CalendarDays, ChevronDown, ChevronRight, Paperclip,
  Sparkles, Loader2, Upload, ClipboardPaste, Info, Trash2,
} from 'lucide-react';
import type { FamilyMember, VaultDocument, FamilyDocument } from '../types';
import type { TripDocRole } from '../types';
import {
  buildLostDocumentsBrief, buildTripChecklist, buildTripGlance, docsAwaitingFacts,
  keyFactsCurrent, missingRequired, suggestTripRole,
  type Trip, type TripChecklistRow,
} from '../utils/trip';
import { clipboardImageFile } from '../utils/tripDocUpload';
import { getEmergencyNumbers } from '../utils/emergencyNumbers';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { toFamilyDoc } from '../utils/vaultDoc';
import CopyableValue from './CopyableValue';
import PdfThumbnail from './PdfThumbnail';
import DocumentViewer from './DocumentViewer';

interface Props {
  trip: Trip;
  /** The travellers on this trip, already filtered by the caller. */
  travellers: FamilyMember[];
  vaultDocs: readonly VaultDocument[];
  /** Whose pack to open on. Falls back to the first traveller. */
  focusMemberId?: string | null;
  /** False for a view-only account: the pack still reads, nothing can be attached. */
  canWrite?: boolean;
  /** Attach an already-uploaded vault document to this trip in a given role. */
  onAttach?: (docId: string, role: TripDocRole, memberId?: string) => void;
  /**
   * Upload a NEW file (from the device or the clipboard) into the vault and
   * attach it in one step — utils/tripDocUpload.ts on the host side. Returns
   * the vault doc it attached (which may be an existing copy, matched by
   * content) so this pack can offer the re-file undo on a redirected attach.
   */
  onUploadAttach?: (file: File, role: TripDocRole, memberId?: string) => Promise<{ ok: boolean; message?: string; docId?: string; docName?: string; deduped?: boolean }>;
  onDetach?: (docId: string, role: TripDocRole) => void;
  /**
   * Hide an AUTO-PULLED card from this trip only (CalendarEvent.tripDocsHidden)
   * — the file stays saved everywhere. Removal in the pack is ONLY ever
   * trip-scoped: a per-card file delete shipped in v274/v275 and was rejected
   * twice ("i dont want to delete it from the vault", "it's annoying") —
   * deleting a file belongs to the Document Vault, never to a packing list.
   */
  onHideDoc?: (docId: string) => void;
  /** Re-file an attached document under a different item (utils/trip.ts moveTripDoc). */
  onMove?: (docId: string, fromRole: TripDocRole, toRole: TripDocRole) => void;
  /**
   * Extract key facts (utils/docKeyFacts.ts) for ONE attached vault document
   * and persist them; the host refreshes vaultDocs so the glance card and the
   * viewer re-render with the facts. Unset in demo / view-only.
   */
  onExtractKeyFacts?: (vaultDocId: string) => Promise<{ ok: boolean; message?: string }>;
  /**
   * Jump to the profile tab where a typed-in gap is actually fixed. Passport
   * number and expiry live on the IDs tab; the insurance numbers and the
   * travel emergency contact on the Travel tab. The caller closes this pack
   * first — the point is to take the person to the fix, not stack screens.
   */
  onGoProfile?: (memberId: string, tab: 'ids' | 'travel') => void;
  onClose: () => void;
}

/** Roles a document can be attached in, in the order the checklist shows them. */
const ATTACHABLE: { role: TripDocRole; label: string }[] = [
  { role: 'ticket', label: 'Tickets & bookings' },
  { role: 'accommodation', label: 'Where you are staying' },
  { role: 'insurance', label: 'Travel insurance policy' },
  { role: 'consent', label: 'Parental consent letter' },
  { role: 'birthCertificate', label: 'Birth certificate' },
  { role: 'passportCopy', label: 'Passport copy' },
  { role: 'visa', label: 'Visa' },
  { role: 'other', label: 'Other papers' },
];

function formatDate(value?: string): string {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Sat 12 Sept" — the journey strip's date voice. */
function shortDayDate(value?: string): string {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "12 Sept – 3 Oct 2026" for the hero kicker (the CSS uppercases it). */
function heroDateRange(trip: Trip): string {
  const start = new Date(`${trip.startDate}T00:00:00`);
  const end = new Date(`${trip.endDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return '';
  const endStr = Number.isNaN(end.getTime()) ? '' : end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (trip.startDate === trip.endDate || !endStr) {
    return start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  const startStr = start.toLocaleDateString('en-GB', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

/** "Ben Clark" → "BC". One letter for a single-word name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] || '' : '')).toUpperCase();
}

/** "Back on Thursday" reads better than a date when the trip is happening now. */
function whenLabel(trip: Trip): string {
  if (trip.status === 'active') {
    if (trip.daysUntilEnd === 0) return 'Home today';
    if (trip.daysUntilEnd === 1) return 'Home tomorrow';
    return `Home in ${trip.daysUntilEnd} days · ${formatDate(trip.endDate)}`;
  }
  if (trip.status === 'upcoming') {
    if (trip.daysUntilStart === 0) return 'Leaving today';
    if (trip.daysUntilStart === 1) return 'Leaving tomorrow';
    return `In ${trip.daysUntilStart} days · ${formatDate(trip.startDate)}`;
  }
  return `Ended ${formatDate(trip.endDate)}`;
}

/**
 * Which role an "Attach" on this row should file the document under.
 *
 * The passport row is the interesting one: the row itself is typed-in details,
 * not a document, so attaching there means attaching a COPY of the passport —
 * which is exactly the thing that matters when the original is lost. Rows that
 * are pure typed-in data (the insurance 24/7 number) get no attach button,
 * because a document is not what is missing.
 */
function attachRoleFor(row: TripChecklistRow): TripDocRole | null {
  if (row.role === 'passport') return 'passportCopy';
  if (row.role === 'insuranceDetails' || row.role === 'emergencyContact') return null;
  return row.role;
}

/**
 * The attached documents under a checklist row — as CARDS with a real
 * thumbnail, opening in the app's own DocumentViewer, exactly like the vault
 * shows them. The first version rendered a bare text pill linking to
 * `downloadUrl` in a new tab, which on a phone means being thrown out of the
 * app into the browser's PDF screen with no way back but the back-gesture.
 * The pack is read at a desk with an official waiting; leaving the app to see
 * your own document is the wrong price.
 */
/** One thumbnail, the same three-way rule the vault list uses: the image
 *  itself, a rendered PDF first page, or a file icon. Shared by the attached
 *  cards and the picker so the two can never show the same file differently. */
function DocThumb({ doc, size = 'w-11 h-11' }: { doc: FamilyDocument; size?: string }) {
  // fileData carries either a real source (a data URI for a member document,
  // an https URL for a vault one via toFamilyDoc) or the literal 'PLACEHOLDER'
  // for pre-upload records — which renders as the icon, never as a broken img.
  const src = doc.fileData && doc.fileData !== 'PLACEHOLDER' ? doc.fileData : null;
  if (src && doc.fileType?.startsWith('image/')) {
    return <img src={src} alt="" loading="lazy" className={`${size} rounded-lg object-cover border border-cream-200 shrink-0 bg-white`} />;
  }
  if (src && doc.fileType === 'application/pdf') {
    return <PdfThumbnail src={src} size={size} />;
  }
  return (
    <span className={`${size} rounded-lg bg-cream-100 border border-cream-200 flex items-center justify-center shrink-0`}>
      <FileText className="w-4 h-4 text-ink-400" />
    </span>
  );
}

function DocCards({ row, byId, onOpen, attachedIds, onDetachDoc, onHideDoc }: {
  row: TripChecklistRow;
  byId: Map<string, FamilyDocument>;
  onOpen: (doc: FamilyDocument) => void;
  /** Ids attached to THIS row's role on the trip — everything else in row.docIds was auto-pulled by name. */
  attachedIds?: Set<string>;
  onDetachDoc?: (docId: string) => void;
  onHideDoc?: (docId: string) => void;
}) {
  const docs = row.docIds.map((id) => byId.get(id)).filter((doc): doc is FamilyDocument => !!doc);
  if (docs.length === 0) return null;
  return (
    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2 mt-2.5">
      {docs.map((doc) => {
        // ONE action per card, and it is only ever trip-scoped: detach an
        // attached card, hide an auto-pulled one (tripDocsHidden). The file is
        // never touched from here — a per-card file delete shipped in v274/275
        // and was rejected twice; deleting files belongs to the vault. Styled
        // as a visible labeled button, not a ghost icon ("an x etc etc that I
        // can't even see").
        const attached = attachedIds?.has(doc.id) ?? false;
        const remove = attached ? onDetachDoc : onHideDoc;
        return (
          <div
            key={doc.id}
            className="flex items-center gap-1.5 p-2 rounded-xl border border-cream-300 bg-white hover:bg-cream-100 hover:border-cream-400 transition-colors shadow-soft"
          >
            <button
              type="button"
              onClick={() => onOpen(doc)}
              className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
            >
              <DocThumb doc={doc} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold text-ink-900 truncate">{doc.name}</span>
                {/* Meaningless on paper — the printed pack lists the file by name only. */}
                <span className="block text-[11px] text-ink-400 font-medium print:hidden">Tap to view</span>
              </span>
            </button>
            {remove && (
              // A small bin, per the owner ("just make it a little bin not
              // big remove label") — but ALWAYS-TINTED, never the ghost-gray
              // icon he couldn't see before it. Despite the bin glyph the
              // action is still trip-only; the title keeps saying so.
              <button
                type="button"
                onClick={() => remove(doc.id)}
                aria-label={`Remove ${doc.name} from this trip`}
                title="Removes it from this trip only — the file stays saved in your vault"
                className="shrink-0 min-w-[40px] min-h-[40px] -my-1 flex items-center justify-center rounded-lg bg-cream-100 border border-cream-200 text-ink-500 hover:border-rosa-300 hover:bg-rosa-50 hover:text-rosa-600 print:hidden cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function TripPack({ trip, travellers, vaultDocs, focusMemberId, canWrite = true, onAttach, onUploadAttach, onDetach, onHideDoc, onMove, onExtractKeyFacts, onGoProfile, onClose }: Props) {
  useBodyScrollLock(true);
  const [selectedId, setSelectedId] = useState<string>(
    () => focusMemberId || travellers[0]?.id || '',
  );
  const [lostOpen, setLostOpen] = useState(false);
  /** The document open in the in-app viewer, BY ID — the doc itself is derived
   *  from byId below so an extraction that refreshes vaultDocs re-renders the
   *  open viewer with its new facts instead of a stale snapshot. Renders at
   *  z-[100], above this pack's z-[70] — the file opens OVER the pack and
   *  closes back to it, instead of a new browser tab you leave the app for. */
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);
  /** Bulk extraction progress for the glance card's one-push button. */
  const [extracting, setExtracting] = useState<{ done: number; total: number; current: string } | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  /** Which role the document picker is currently choosing FOR. */
  const [pickingRole, setPickingRole] = useState<TripDocRole | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  /** Upload-into-picker state (device file / clipboard image). */
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /**
   * What the last attach actually DID, when that differs from what the tap
   * said — a consent letter picked from the Tickets picker gets filed under
   * Parental consent letter (the mis-file that started all of this must not
   * be attachable at all), and this banner says so, with the override.
   */
  const [attachNotice, setAttachNotice] = useState<{ text: string; undo?: { docId: string; from: TripDocRole; to: TripDocRole } } | null>(null);

  // The picker renders below the checklist, and the gap that opens it sits at
  // the TOP of the screen — on a phone that means the thing a tap just created
  // is off-screen, which reads as the tap doing nothing. Bring it into view.
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pickingRole) pickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [pickingRole]);

  const member = travellers.find((t) => t.id === selectedId) || travellers[0] || null;
  // BOTH document catalogues, one lookup. A row's docIds mixes two id spaces:
  // trip attachments live in the shared VAULT, but a passport's scanned page
  // (passports[].photoDocId) points into the MEMBER's own documents — stored
  // there so the bytes don't ride along in the member record. Resolving
  // against the vault alone silently dropped exactly those scans, which is
  // how a passport row could say "Attach another" while showing no file at
  // all ("passport thumbnails must appear").
  const byId = useMemo(() => {
    const map = new Map<string, FamilyDocument>(vaultDocs.map((doc) => [doc.id, toFamilyDoc(doc)]));
    for (const doc of member?.documents || []) map.set(doc.id, doc);
    return map;
  }, [vaultDocs, member]);

  const viewingDoc = viewingDocId ? byId.get(viewingDocId) || null : null;
  /** Extraction is only offered for VAULT documents — a member-record scan has
   *  no storagePath for the OCR fallback and its typed-in details are already
   *  on the checklist. */
  const viewingVaultDoc = viewingDocId ? vaultDocs.find((doc) => doc.id === viewingDocId) : undefined;

  const rows = useMemo(
    () => (member ? buildTripChecklist(trip, member, vaultDocs) : []),
    [trip, member, vaultDocs],
  );
  const glance = useMemo(() => buildTripGlance(trip, travellers, vaultDocs), [trip, travellers, vaultDocs]);
  const awaitingFacts = useMemo(() => docsAwaitingFacts(trip, vaultDocs), [trip, vaultDocs]);
  const gaps = useMemo(() => missingRequired(rows), [rows]);
  // The board view's numbers (v287, Vision Board 05): every traveller's
  // REQUIRED rows counted in one pass, feeding the hero ring, the
  // per-traveller readiness list and the "one thing to finish" card. Optional
  // papers are excluded exactly as the old essentials bar excluded them — an
  // optional row must never hold the ring under 100%.
  const party = useMemo(() => {
    const per = travellers.map((traveller) => {
      const tRows = buildTripChecklist(trip, traveller, vaultDocs);
      const required = tRows.filter((row) => row.required);
      return {
        traveller,
        ready: required.filter((row) => row.present).length,
        total: required.length,
        gaps: missingRequired(tRows),
      };
    });
    const ready = per.reduce((sum, p) => sum + p.ready, 0);
    const total = per.reduce((sum, p) => sum + p.total, 0);
    const gapCount = per.reduce((sum, p) => sum + p.gaps.length, 0);
    const firstWithGap = per.find((p) => p.gaps.length > 0);
    return {
      per, ready, total, gapCount,
      oneThing: firstWithGap ? { owner: firstWithGap.traveller, row: firstWithGap.gaps[0] } : null,
    };
  }, [travellers, trip, vaultDocs]);

  /** Route a gap to its fix — same rules as the per-member gaps card: typed-in
   *  details go to the profile tab that edits them, documents open the attach
   *  picker here (switching the pack to that traveller first). */
  const goFix = (ownerId: string, row: TripChecklistRow) => {
    const profileTab = row.role === 'passport' ? 'ids' as const
      : (row.role === 'insuranceDetails' || row.role === 'emergencyContact') ? 'travel' as const
      : null;
    if (profileTab && onGoProfile) { onGoProfile(ownerId, profileTab); return; }
    const attachRole = attachRoleFor(row);
    if (attachRole && canWrite && onAttach) {
      setSelectedId(ownerId);
      setPickingRole(attachRole);
      setPickerQuery('');
    }
  };

  const brief = useMemo(
    () => (member ? buildLostDocumentsBrief(trip, member) : null),
    [trip, member],
  );
  // Only ever populated for a country emergencyNumbers.ts has verified. An
  // unknown destination shows nothing rather than a plausible-looking guess.
  const localNumbers = trip.destinationCountry ? getEmergencyNumbers(trip.destinationCountry) : null;

  // One push reads every attached document that hasn't been read yet, in
  // order, and says which one it is on — a silent multi-minute spinner over
  // three PDFs would read as a hang. Sequential on purpose: each document is
  // its own OCR + AI call, and firing them in parallel is how a phone on
  // hotel wifi times out all of them at once.
  const runExtractAll = async () => {
    if (!onExtractKeyFacts || extracting) return;
    const waiting = docsAwaitingFacts(trip, vaultDocs);
    if (waiting.length === 0) return;
    setExtractError(null);
    const failures: string[] = [];
    for (let i = 0; i < waiting.length; i++) {
      setExtracting({ done: i, total: waiting.length, current: waiting[i].name });
      const result = await onExtractKeyFacts(waiting[i].id).catch(() => ({ ok: false as const }));
      if (!result.ok) failures.push(waiting[i].name);
    }
    setExtracting(null);
    if (failures.length) {
      setExtractError(`Couldn’t read ${failures.join(', ')} — trying again often works.`);
    }
  };

  const roleLabel = (role: TripDocRole) => ATTACHABLE.find((entry) => entry.role === role)?.label || role;

  /**
   * Where an attach from the picker actually files a document. The picker's
   * scope is a strong hint but the document's own NAME wins when it plainly
   * says the file is a different kind of paper — "Parental Consent Affidavit"
   * tapped from the Tickets picker goes under the consent row, full stop. The
   * v268 nudge text warned about exactly this and still let the mis-file
   * happen; the report came back as "consent forms must not be uploaded to
   * the tickets section", so now it cannot be. The banner + Filed-under
   * select remain the (deliberate) override path.
   */
  const resolveAttachRole = (docName: string, picked: TripDocRole): TripDocRole => {
    const usual = suggestTripRole(docName);
    return usual && usual !== picked ? usual : picked;
  };

  const attachResolved = (docId: string, docName: string, picked: TripDocRole, deduped = false) => {
    const filed = resolveAttachRole(docName, picked);
    // A consent letter, birth certificate or passport copy belongs to ONE
    // person; a ticket or hotel booking is usually the whole party's.
    // Computed from the role the doc actually lands in, not the row that
    // opened the picker.
    const personal = filed === 'consent' || filed === 'birthCertificate' || filed === 'passportCopy' || filed === 'visa';
    onAttach?.(docId, filed, personal && member ? member.id : undefined);
    const parts: string[] = [];
    if (deduped) parts.push(`“${docName}” was already in the vault, so that copy was attached.`);
    if (filed !== picked) parts.push(`${deduped ? 'It' : `“${docName}”`} looks like it belongs under “${roleLabel(filed)}”, so it was filed there instead of “${roleLabel(picked)}”.`);
    setAttachNotice(parts.length ? { text: parts.join(' '), ...(filed !== picked ? { undo: { docId, from: filed, to: picked } } : {}) } : null);
    setPickingRole(null);
  };

  const handleUploadFile = async (file: File) => {
    if (!onUploadAttach || !pickingRole) return;
    const picked = pickingRole;
    const filed = resolveAttachRole(file.name, picked);
    const personal = filed === 'consent' || filed === 'birthCertificate' || filed === 'passportCopy' || filed === 'visa';
    setUploadBusy(true);
    setUploadError(null);
    const res = await onUploadAttach(file, filed, personal && member ? member.id : undefined)
      .catch(() => ({ ok: false as const, message: 'Upload failed. Check your connection and try again.' }));
    setUploadBusy(false);
    if (!res.ok) {
      setUploadError(res.message || 'Upload failed — please try again.');
      return; // picker stays open; the file is still in hand
    }
    const name = ('docName' in res && res.docName) || file.name;
    const parts: string[] = [];
    if ('deduped' in res && res.deduped) parts.push(`“${name}” was already in the vault, so that copy was attached.`);
    if (filed !== picked) parts.push(`${parts.length ? 'It' : `“${name}”`} looks like it belongs under “${roleLabel(filed)}”, so it was filed there instead of “${roleLabel(picked)}”.`);
    const docId = 'docId' in res ? res.docId : undefined;
    setAttachNotice(parts.length ? { text: parts.join(' '), ...(filed !== picked && docId ? { undo: { docId, from: filed, to: picked } } : {}) } : null);
    setPickingRole(null);
  };

  const handlePasteClipboard = async () => {
    setUploadError(null);
    let file: File | 'unreadable-file' | null = null;
    try {
      file = await clipboardImageFile();
    } catch {
      setUploadError('Your browser blocked clipboard access — copy the image again and allow access when asked, or use “Upload from this device”.');
      return;
    }
    if (file === 'unreadable-file') {
      // The copied file IS there — the browser just refuses to hand a FILE to a
      // button, only to a real paste keystroke or a drop. Say exactly that, and
      // warn about the screenshot trap: taking a screenshot to show the problem
      // REPLACES the copied file on the clipboard, which is how "⌘V pasted the
      // wrong thing" happens.
      setUploadError('Your copied file is on the clipboard, but the browser only releases a file on a real paste — press ⌘V (Ctrl+V on Windows) right now and it will attach. (Copying or screenshotting anything else first replaces it.) Or drag the file from the Finder onto this window.');
      return;
    }
    if (!file) {
      setUploadError('Nothing pasteable on the clipboard. Copy the file or image again, then press ⌘V (Ctrl+V on Windows) while this picker is open — or drag the file onto this window, or use “Upload from this device”.');
      return;
    }
    await handleUploadFile(file);
  };

  // The Paste BUTTON can only ever see images: the async clipboard API
  // exposes screenshots and copied photos, never a file copied in the
  // Finder/Files app — which is exactly what "paste from clipboard does
  // nothing" turned out to be (a copied PDF the API cannot show us). A real
  // ⌘V/Ctrl+V paste EVENT does carry that file, so while the picker is open
  // we catch one anywhere on the page. Ref-routed so the listener always
  // calls the current closure without re-subscribing every render.
  const uploadFileRef = useRef(handleUploadFile);
  uploadFileRef.current = handleUploadFile;
  useEffect(() => {
    if (!pickingRole) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = e.clipboardData?.files?.[0];
      if (file) {
        e.preventDefault();
        void uploadFileRef.current(file);
      }
      // No file → leave the event alone (pasting text into the search box).
    };
    window.addEventListener('paste', onPaste);
    // Same idea, zero keyboard: DRAG the file onto the open picker. The paste
    // BUTTON can never see a copied file (browsers only hand files over on a
    // real ⌘V keystroke or a drop — "can we skip this control-V step" is a
    // platform rule, not our choice), so a drop is the click-only alternative.
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }
    };
    const onDrop = (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        e.preventDefault();
        void uploadFileRef.current(file);
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [pickingRole]);

  // Vault documents offerable for the role being picked. Already-attached ones
  // are filtered out so the list cannot produce a duplicate attachment.
  const pickable = useMemo(() => {
    if (!pickingRole) return [];
    const already = new Set(trip.docs.filter((ref) => ref.role === pickingRole).map((ref) => ref.id));
    const query = pickerQuery.trim().toLowerCase();
    return vaultDocs.filter((doc) => {
      if (already.has(doc.id)) return false;
      if (!query) return true;
      return doc.name.toLowerCase().includes(query) || doc.category.toLowerCase().includes(query);
    });
  }, [pickingRole, pickerQuery, vaultDocs, trip.docs]);

  return (
    <>
    <AnimatePresence>
      {/* z-[70], not the z-50 every other modal in this app uses. The Ember
          shell puts its mobile nav at z-60 and the floating Capture/Appearance
          triggers at z-61, so a z-50 modal is COVERED by them on a phone —
          measured in the browser, not assumed. That affects every modal here
          and wants a single fix at the shell level; this one sits above the
          chrome in the meantime, because the phone is the screen this pack
          exists for and a nav bar across the lost-passport steps is not a
          cosmetic problem. */}
      <div className="fixed inset-0 z-[70] flex print:static print:z-auto">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm print:hidden"
        />

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
          className="relative m-auto w-full h-full sm:h-auto sm:max-h-[92dvh] sm:max-w-2xl flex flex-col bg-cream-50 sm:rounded-[28px] border-0 sm:border sm:border-cream-300/60 shadow-2xl overflow-hidden print:static print:max-h-none print:max-w-none print:h-auto print:rounded-none print:border-0 print:shadow-none print:bg-white"
        >
          {/* Paper keeps the old plain header — the hero is a screen thing. */}
          <div className="hidden print:block p-5 pb-4 border-b border-ink-900/20">
            <h2 className="font-display text-2xl font-bold text-ink-900">{trip.title}</h2>
            <p className="text-[13px] text-ink-500 font-medium mt-1">
              {[trip.destination, `${formatDate(trip.startDate)}${trip.endDate && trip.endDate !== trip.startDate ? ` – ${formatDate(trip.endDate)}` : ''}`]
                .filter(Boolean).join(' · ')}
            </p>
          </div>

          {/* The trip as one connected journey, not a folder of papers —
              Vision Board 05. A self-contained dark gradient (the same device
              as the .ember-view-heading family) so it renders identically in
              light/dark and Classic/Ember. Kept COMPACT on purpose: this
              header is pinned above the scroll area, and a tall hero on a
              phone is a scroll tax paid on every open. */}
          <div className="trip-hero shrink-0 print:hidden">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="trip-hero-kicker">
                  {travellers.length > 1 ? 'Family trip' : 'Trip'} · {heroDateRange(trip)}
                </p>
                <h2 className="font-display text-[24px] sm:text-3xl font-extrabold leading-[1.05] tracking-tight mt-1.5 text-white [text-wrap:balance]">
                  {trip.title}
                </h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[12.5px] font-medium text-white/70">
                  {trip.destination && (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap"><MapPin className="w-3.5 h-3.5 shrink-0" />{trip.destination}</span>
                  )}
                  <span className="inline-flex items-center gap-1 whitespace-nowrap"><CalendarDays className="w-3.5 h-3.5 shrink-0" />{whenLabel(trip)}</span>
                </div>
                {travellers.length > 0 && (
                  <div className="flex items-center mt-3">
                    {travellers.map((traveller, index) => (
                      <span
                        key={traveller.id}
                        className={`w-7 h-7 rounded-full bg-white/15 border border-white/25 text-white text-[10.5px] font-bold flex items-center justify-center ${index > 0 ? '-ml-1.5' : ''}`}
                      >
                        {initials(traveller.name)}
                      </span>
                    ))}
                    <span className="ml-2 text-[12px] font-semibold text-white/70">
                      {travellers.length === 1
                        ? travellers[0].name.split(/\s+/)[0] || travellers[0].name
                        : `${travellers.length} travellers`}
                    </span>
                  </div>
                )}
              </div>
              <div className="shrink-0 flex flex-col items-end gap-2.5">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => window.print()}
                    className="p-2 rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors cursor-pointer"
                    title="Print this pack"
                    aria-label="Print this pack"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                  <button
                    onClick={onClose}
                    className="p-2 rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors cursor-pointer"
                    title="Close"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {/* The board's readiness ring — the whole party's required
                    rows, in one number. Sage only at 100%: a nearly-green
                    ring over a missing passport would be a lie. */}
                {party.total > 0 && (
                  <div
                    className="relative w-16 h-16 self-center"
                    role="img"
                    aria-label={`${party.ready} of ${party.total} essentials ready`}
                  >
                    <svg viewBox="0 0 48 48" className="w-16 h-16 -rotate-90">
                      <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="4" />
                      <circle
                        cx="24" cy="24" r="20" fill="none"
                        stroke={party.ready === party.total ? '#86C4A3' : '#E9B35E'}
                        strokeWidth="4" strokeLinecap="round"
                        strokeDasharray={`${(party.ready / party.total) * 125.66} 125.66`}
                      />
                    </svg>
                    <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
                      <span className="text-[13px] font-extrabold text-white tabular-nums">{party.ready}/{party.total}</span>
                      <span className="text-[8px] font-bold tracking-[.12em] text-white/60 mt-0.5">READY</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5 print:overflow-visible print:p-0">
            {/* One thing to finish — the board's priority card. The single
                next action for the whole party, above everything, with the
                route to its fix. The full per-person list still lives in the
                gaps card below; this is the "if you only do one thing" cut. */}
            {party.oneThing ? (() => {
              const { owner, row } = party.oneThing;
              const ownerFirst = owner.name.split(/\s+/)[0] || owner.name;
              const profileTab = row.role === 'passport' || row.role === 'insuranceDetails' || row.role === 'emergencyContact';
              const canRoute = profileTab ? !!onGoProfile : !!(attachRoleFor(row) && canWrite && onAttach);
              return (
                <div className="rounded-2xl border border-cream-300/70 border-l-4 border-l-clay-500 bg-white shadow-soft px-4 sm:px-5 py-3.5 print:hidden">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-clay-600">
                    {party.gapCount === 1 ? 'One thing to finish' : `First of ${party.gapCount} things to finish`}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-1">
                    <div className="min-w-0 flex-1 basis-52">
                      <p className="text-[14px] font-bold text-ink-900 leading-snug">
                        {row.label}{travellers.length > 1 ? ` — ${ownerFirst}` : ''}
                      </p>
                      <p className="text-[12.5px] text-ink-500 leading-snug mt-0.5">{row.note}</p>
                    </div>
                    {canRoute && (
                      <button
                        type="button"
                        onClick={() => goFix(owner.id, row)}
                        className="btn-primary text-[12.5px] px-4 py-2 shrink-0"
                      >
                        Review now
                      </button>
                    )}
                  </div>
                </div>
              );
            })() : party.total > 0 && (
              <div className="rounded-2xl border border-sage-200 bg-sage-50 px-4 sm:px-5 py-3 flex items-center gap-2.5 print:hidden">
                <CheckCircle2 className="w-4 h-4 text-sage-600 shrink-0" />
                <p className="text-[13px] font-semibold text-sage-800">Everything required is ready — enjoy the trip.</p>
              </div>
            )}

            {/* Journey — the trip as a line, not a date field. Only what the
                data actually knows: leave, away, home. No invented flight
                numbers or times; bookings live on the checklist as papers. */}
            {trip.status !== 'past' && (
              <div className="rounded-2xl border border-cream-300/70 bg-white overflow-hidden print:hidden">
                <div className="px-4 sm:px-5 py-3 border-b border-cream-200">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink-400">Journey</h3>
                </div>
                <ol className="relative px-4 sm:px-5 py-4 space-y-4">
                  <span className="absolute left-[21px] sm:left-[25px] top-6 bottom-6 w-px bg-cream-300" aria-hidden="true" />
                  <li className="relative pl-6">
                    <span className="absolute left-0 top-1 w-[11px] h-[11px] rounded-full bg-dusk-500 ring-2 ring-white" aria-hidden="true" />
                    <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400 tabular-nums">{shortDayDate(trip.startDate)}</p>
                    <p className="text-[13.5px] font-bold text-ink-900 mt-0.5">
                      {trip.destination ? `Leave for ${trip.destination}` : 'Departure'}
                    </p>
                  </li>
                  {trip.lengthDays > 1 && (
                    <li className="relative pl-6">
                      <span className="absolute left-0 top-1 w-[11px] h-[11px] rounded-full bg-honey-500 ring-2 ring-white" aria-hidden="true" />
                      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400 tabular-nums">
                        {trip.lengthDays} day{trip.lengthDays === 1 ? '' : 's'}
                      </p>
                      <p className="text-[13.5px] font-bold text-ink-900 mt-0.5">
                        {trip.destination ? `In ${trip.destination}` : 'Away'}
                      </p>
                    </li>
                  )}
                  <li className="relative pl-6">
                    <span className="absolute left-0 top-1 w-[11px] h-[11px] rounded-full bg-clay-500 ring-2 ring-white" aria-hidden="true" />
                    <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400 tabular-nums">{shortDayDate(trip.endDate)}</p>
                    <p className="text-[13.5px] font-bold text-ink-900 mt-0.5">Home</p>
                  </li>
                </ol>
              </div>
            )}

            {/* Traveller readiness — the board's side panel, and ALSO the
                traveller selector (it replaces the old pill row): tapping a
                person switches the papers checklist below to them. */}
            {travellers.length > 0 && (
              <div className="rounded-2xl border border-cream-300/70 bg-white overflow-hidden print:hidden">
                <div className="px-4 sm:px-5 py-3 border-b border-cream-200 flex items-baseline gap-2">
                  <h3 className="flex-1 text-[11px] font-bold uppercase tracking-wide text-ink-400">Traveller readiness</h3>
                  {travellers.length > 1 && (
                    <span className="text-[11px] text-ink-400 font-medium whitespace-nowrap">tap a name for their papers</span>
                  )}
                </div>
                <div className="divide-y divide-cream-200">
                  {party.per.map(({ traveller, ready, total }) => {
                    const selected = traveller.id === member?.id;
                    return (
                      <button
                        key={traveller.id}
                        type="button"
                        onClick={() => setSelectedId(traveller.id)}
                        aria-pressed={selected}
                        className={`w-full flex items-center gap-3 px-4 sm:px-5 py-3 text-left transition-colors cursor-pointer ${selected ? 'bg-clay-50/60' : 'hover:bg-cream-50'}`}
                      >
                        <span className={`w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0 ${selected ? 'bg-clay-500 text-white' : 'bg-cream-100 border border-cream-300 text-ink-600'}`}>
                          {initials(traveller.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-bold text-ink-900">{traveller.name.split(/\s+/)[0] || traveller.name}</span>
                          <span className="block text-[11.5px] text-ink-500 font-medium">
                            {total === 0 ? 'Nothing required' : ready === total ? 'Everything ready' : `${total - ready} to sort`}
                          </span>
                        </span>
                        {total > 0 && (
                          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11.5px] font-bold tabular-nums ${ready === total ? 'bg-sage-100 text-sage-700' : 'bg-honey-100 text-honey-800'}`}>
                            {ready}/{total}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* At a glance — every detail someone reads OUT LOUD on a trip
                (passport numbers, booking references, the assistance line) in
                one card, instead of scattered across rows and inside PDFs.
                Trip-wide on purpose: whoever holds the phone at the desk is
                usually reading another traveller's number. Prints, because
                this card is most of what the paper version is FOR. */}
            <div className="rounded-2xl border border-dusk-100 bg-white overflow-hidden print:border-ink-900/20">
              <div className="px-4 sm:px-5 py-3 border-b border-dusk-100/70 bg-dusk-50/60 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-dusk-600 shrink-0" />
                <h3 className="flex-1 text-[13px] font-bold text-ink-800">At a glance</h3>
                <span className="text-[12px] text-ink-500 font-medium whitespace-nowrap tabular-nums">
                  {formatDate(trip.startDate)}{trip.endDate && trip.endDate !== trip.startDate ? ` – ${formatDate(trip.endDate)}` : ''}
                </span>
              </div>
              {glance.length > 0 ? (
                <div className="px-4 sm:px-5 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                  {glance.map((section) => (
                    <div key={section.key} className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-dusk-600 mb-1 truncate">{section.title}</p>
                      <div className="space-y-1.5">
                        {section.facts.map((fact) => (
                          <div key={`${fact.label}-${fact.value}`} className="min-w-0">
                            <p className="text-[11px] text-ink-400 leading-tight">
                              {fact.label}
                              {!fact.verified && <span className="text-honey-700 font-semibold"> · read from a photo</span>}
                            </p>
                            <CopyableValue value={fact.value} label={fact.label} className="text-[13.5px] font-semibold text-ink-900 tabular-nums break-words block">
                              {fact.value}
                            </CopyableValue>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-4 sm:px-5 py-3 text-[12.5px] text-ink-500 leading-snug">
                  Passport numbers, booking references and the numbers to call will collect here as details and papers are added.
                </p>
              )}
              {canWrite && onExtractKeyFacts && (awaitingFacts.length > 0 || extracting) && (
                <div className="px-4 sm:px-5 pb-3.5 pt-1 print:hidden">
                  <button
                    type="button"
                    disabled={!!extracting}
                    onClick={() => { void runExtractAll(); }}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-dusk-200 bg-dusk-50 px-3.5 py-2.5 text-[13px] font-bold text-dusk-700 hover:bg-dusk-100 transition-colors cursor-pointer disabled:opacity-70 disabled:cursor-default"
                  >
                    {extracting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        <span className="truncate">Reading “{extracting.current}”… ({extracting.done + 1} of {extracting.total})</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 shrink-0" />
                        <span>Read details from your {awaitingFacts.length === 1 ? 'attached document' : `${awaitingFacts.length} attached documents`}</span>
                      </>
                    )}
                  </button>
                  <p className="text-[11.5px] text-ink-400 leading-snug mt-1.5">
                    Pulls phone numbers, references and dates out of the papers themselves — word for word, nothing invented.
                  </p>
                </div>
              )}
              {extractError && (
                <p className="px-4 sm:px-5 pb-3 text-[12px] text-rosa-700 leading-snug print:hidden">{extractError}</p>
              )}
            </div>

            {!member ? (
              <p className="text-[14px] text-ink-500">Nobody is tagged on this trip yet.</p>
            ) : (
              <>
                {/* Gaps first. This is the whole reason to open the pack early.

                    Every gap is a BUTTON that goes to its own fix. The first
                    version listed the problems as plain text — six headlines,
                    nothing tappable, and the fixes living on other screens
                    with no route to them. On a phone that opened as a wall of
                    warnings you could do nothing about, which reads as broken,
                    not informative ("it's unclear what to do and I can't even
                    click nothing"). A problem this screen names, this screen
                    must route to: typed-in details go to the profile tab that
                    edits them, documents open the attach picker right here. */}
                {gaps.length > 0 && (
                  <div className="rounded-2xl border bg-honey-50 border-honey-100 overflow-hidden">
                    <div className="px-4 sm:px-5 py-3 border-b border-honey-100 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-honey-700" />
                      <h3 className="text-[13px] font-bold text-honey-900">
                        Sort {gaps.length === 1 ? 'this' : `these ${gaps.length}`} before {trip.status === 'active' ? 'anything else' : 'you go'}
                      </h3>
                    </div>
                    <div className="divide-y divide-honey-100/70">
                      {gaps.map((row) => {
                        // Typed-in details are fixed on the profile; documents
                        // are fixed here, by attaching one from the vault.
                        const profileTab = row.role === 'passport' ? 'ids' as const
                          : (row.role === 'insuranceDetails' || row.role === 'emergencyContact') ? 'travel' as const
                          : null;
                        const attachRole = profileTab ? null : attachRoleFor(row);
                        const go = profileTab && onGoProfile ? () => onGoProfile(member.id, profileTab)
                          : attachRole && canWrite && onAttach ? () => { setPickingRole(attachRole); setPickerQuery(''); }
                          : null;
                        const actionLabel = profileTab
                          ? `Add it on ${member.name.split(/\s+/)[0] || member.name}’s profile`
                          : 'Attach it from the vault';
                        const body = (
                          <>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-bold text-honey-900">{row.label}</span>
                              <span className="block text-[12.5px] text-honey-800/90 mt-0.5 leading-snug">{row.note}</span>
                              {go && (
                                <span className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-bold text-clay-700">
                                  {actionLabel} <ChevronRight className="w-3.5 h-3.5" />
                                </span>
                              )}
                            </span>
                          </>
                        );
                        return go ? (
                          <button
                            key={row.key}
                            type="button"
                            onClick={go}
                            className="w-full flex text-left px-4 sm:px-5 py-3 hover:bg-honey-100/50 transition-colors cursor-pointer"
                          >
                            {body}
                          </button>
                        ) : (
                          <div key={row.key} className="flex px-4 sm:px-5 py-3">{body}</div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* The pack itself. */}
                <div className="rounded-2xl border border-cream-300/70 bg-white overflow-hidden">
                  <div className="px-4 sm:px-5 py-3 border-b border-cream-200">
                    <h3 className="text-[13px] font-bold text-ink-800">
                      {member.name.split(/\s+/)[0] || member.name}&apos;s papers for this trip
                    </h3>
                    {/* Where the FILES are. "Where do I actually see the
                        documents?" is what this screen looked like without it:
                        a tick can come from typed-in details alone, so a
                        checklist can be all green while holding zero papers,
                        and nothing said where an attached file would appear.
                        One state-aware line — before anything is attached it
                        says what will happen; after, it says what to tap. */}
                    <p className="text-[12px] text-ink-500 mt-0.5 leading-snug print:hidden">
                      {trip.docs.length === 0
                        ? 'No files are attached to this trip yet. Each paper you attach shows under its item as a file you can tap to open.'
                        : 'Tap a file under an item to open it.'}
                    </p>
                  </div>
                  <div className="divide-y divide-cream-200">
                    {rows.map((row) => (
                      <div key={row.key} className="px-4 sm:px-5 py-3.5 flex gap-3 transition-colors hover:bg-cream-50/60">
                        <div className="shrink-0 pt-0.5">
                          {row.present
                            ? <CheckCircle2 className="w-4 h-4 text-sage-600" />
                            : <Circle className={`w-4 h-4 ${row.required ? 'text-honey-600' : 'text-ink-300'}`} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="text-[14px] font-bold text-ink-900">{row.label}</p>
                            {row.expiryDate && (() => {
                              // Many borders want a passport valid ~6 months
                              // BEYOND the trip, so "fine today" can still be
                              // worth a squint — honey inside that window,
                              // rosa once actually expired before the trip
                              // ends. Neutral otherwise: an expiry date is
                              // information, not an alarm.
                              const expiry = new Date(`${row.expiryDate}T00:00:00`);
                              const tripEnd = new Date(`${trip.endDate}T00:00:00`);
                              const sixMonthsPast = new Date(tripEnd); sixMonthsPast.setMonth(sixMonthsPast.getMonth() + 6);
                              const tone = Number.isNaN(expiry.getTime()) ? 'neutral'
                                : expiry < tripEnd ? 'expired'
                                : expiry < sixMonthsPast ? 'soon' : 'neutral';
                              return (
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
                                  tone === 'expired' ? 'bg-rosa-100 text-rosa-700'
                                  : tone === 'soon' ? 'bg-honey-100 text-honey-800'
                                  : 'bg-cream-100 text-ink-500'
                                }`}>
                                  {tone === 'expired' ? 'expires mid-trip · ' : tone === 'soon' ? 'under 6 months validity · ' : 'expires '}
                                  {formatDate(row.expiryDate)}
                                </span>
                              );
                            })()}
                          </div>
                          {row.detail ? (
                            <CopyableValue value={row.detail} label={row.label} className="text-[13px] text-ink-700 font-medium mt-0.5 block">
                              {row.detail}
                            </CopyableValue>
                          ) : (
                            <p className="text-[12.5px] text-ink-500 mt-0.5 leading-snug">{row.note}</p>
                          )}
                          <DocCards
                            row={row}
                            byId={byId}
                            onOpen={(doc) => setViewingDocId(doc.id)}
                            attachedIds={(() => {
                              const roleFor = attachRoleFor(row);
                              return new Set((trip.docs || []).filter((ref) => ref.role === roleFor).map((ref) => ref.id));
                            })()}
                            onDetachDoc={canWrite && onDetach && attachRoleFor(row)
                              ? (docId) => onDetach(docId, attachRoleFor(row)!)
                              : undefined}
                            onHideDoc={canWrite ? onHideDoc : undefined}
                          />
                          {canWrite && onAttach && attachRoleFor(row) && (
                            <button
                              type="button"
                              onClick={() => { setPickingRole(attachRoleFor(row)); setPickerQuery(''); }}
                              className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-bold text-clay-600 hover:text-clay-700 cursor-pointer print:hidden"
                            >
                              <Paperclip className="w-3.5 h-3.5" />
                              {row.present ? 'Attach another' : row.role === 'passport' ? 'Attach a copy' : 'Attach'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* What the last attach actually did, when it differs from what
                    was tapped — a redirected filing or a content-matched
                    existing copy. Dismissible, and the redirect carries its own
                    one-tap override so obeying the document's name never traps
                    a deliberate choice. */}
                {attachNotice && (
                  <div className="rounded-2xl border border-honey-200 bg-honey-50 px-4 py-3 flex items-start gap-2.5 print:hidden">
                    <Info className="w-4 h-4 text-honey-700 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] text-honey-900 leading-snug">{attachNotice.text}</p>
                      {attachNotice.undo && onMove && (
                        <button
                          type="button"
                          onClick={() => {
                            if (attachNotice.undo) onMove(attachNotice.undo.docId, attachNotice.undo.from, attachNotice.undo.to);
                            setAttachNotice(null);
                          }}
                          className="mt-1 text-[12px] font-bold text-clay-700 hover:text-clay-800 cursor-pointer"
                        >
                          Put it under “{roleLabel(attachNotice.undo.to)}” anyway
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setAttachNotice(null)}
                      className="p-1 rounded-full text-honey-700 hover:bg-honey-100 cursor-pointer shrink-0"
                      aria-label="Dismiss"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Document picker. A flat searchable list of what is already in
                    the vault — attaching is a LINK, never a copy, so a document
                    stays in one place and the trip merely points at it. */}
                {pickingRole && (
                  <div ref={pickerRef} className="rounded-2xl border border-clay-200 bg-white overflow-hidden print:hidden">
                    <div className="px-4 sm:px-5 py-3 border-b border-cream-200 flex items-center gap-2">
                      <Paperclip className="w-4 h-4 text-clay-600" />
                      <h3 className="flex-1 text-[13px] font-bold text-ink-800">
                        Attach to “{ATTACHABLE.find((entry) => entry.role === pickingRole)?.label}”
                      </h3>
                      <button
                        type="button"
                        onClick={() => setPickingRole(null)}
                        className="p-1.5 rounded-full text-ink-400 hover:text-ink-700 hover:bg-cream-100 cursor-pointer"
                        aria-label="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="p-3 sm:p-4 space-y-2">
                      <input
                        type="search"
                        value={pickerQuery}
                        onChange={(e) => setPickerQuery(e.target.value)}
                        placeholder="Search your documents…"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-[14px] text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-clay-400"
                      />
                      {/* New-file paths. The picker used to offer ONLY what the
                          vault already held — but the boarding pass is in
                          Downloads and the consent letter is a screenshot on
                          the clipboard, and detouring through the vault tab
                          means losing the row you were completing ("this going
                          to already existing files annoying"). Both paths land
                          the file in the vault AND on this row in one tap. */}
                      {canWrite && onUploadAttach && (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              disabled={uploadBusy}
                              onClick={() => fileInputRef.current?.click()}
                              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-clay-200 bg-clay-50 px-3 py-2.5 text-[12.5px] font-bold text-clay-700 hover:bg-clay-100 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
                            >
                              {uploadBusy ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <Upload className="w-4 h-4 shrink-0" />}
                              <span className="truncate">{uploadBusy ? 'Uploading…' : 'Upload from this device'}</span>
                            </button>
                            <button
                              type="button"
                              disabled={uploadBusy}
                              onClick={() => { void handlePasteClipboard(); }}
                              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-clay-200 bg-clay-50 px-3 py-2.5 text-[12.5px] font-bold text-clay-700 hover:bg-clay-100 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
                            >
                              <ClipboardPaste className="w-4 h-4 shrink-0" />
                              <span className="truncate">Paste from clipboard</span>
                            </button>
                          </div>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*,application/pdf,.pdf"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = ''; // same file picked twice must fire again
                              if (f) void handleUploadFile(f);
                            }}
                          />
                          {uploadError && (
                            <p className="text-[12px] text-rosa-700 leading-snug">{uploadError}</p>
                          )}
                          {/* The drop path is invisible unless named — it only
                              ever surfaced inside an error message before. */}
                          <p className="text-[11.5px] text-ink-400 leading-snug">
                            You can also drag a file from the Finder or Files app anywhere onto this window — it attaches straight away.
                          </p>
                        </>
                      )}
                      <div className="max-h-64 overflow-y-auto space-y-1.5">
                        {pickable.length === 0 ? (
                          <p className="text-[13px] text-ink-500 py-3 px-1 leading-snug">
                            {vaultDocs.length === 0
                              ? 'No documents in the vault yet. Upload it there (or send it to Teluva in chat) and it will show up here.'
                              : 'Nothing matches. Try a different word, or check it is uploaded to the vault.'}
                          </p>
                        ) : pickable.map((doc) => (
                          <button
                            key={doc.id}
                            type="button"
                            onClick={() => attachResolved(doc.id, doc.name, pickingRole)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border border-cream-300 bg-white hover:bg-cream-100 text-left transition-colors cursor-pointer"
                          >
                            <DocThumb doc={toFamilyDoc(doc)} size="w-9 h-9" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-semibold text-ink-900 truncate">{doc.name}</span>
                              <span className="block text-[11.5px] text-ink-500">{doc.category}</span>
                              {/* The mis-file announcing itself BEFORE the tap —
                                  and since v270 the tap OBEYS the name: this is
                                  a statement of what will happen, not a warning
                                  the tap then ignores (which is how a consent
                                  letter ended up under Tickets anyway). */}
                              {(() => {
                                const usual = suggestTripRole(doc.name);
                                if (!usual || usual === pickingRole) return null;
                                const label = ATTACHABLE.find((entry) => entry.role === usual)?.label;
                                return label ? (
                                  <span className="block text-[11.5px] font-semibold text-honey-700">
                                    Will be filed under “{label}” — its name says what it is
                                  </span>
                                ) : null;
                              })()}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Detach. Kept out of the checklist rows themselves — a row is
                    read under pressure and should not carry a destructive
                    control next to the thing you came to look at. */}
                {canWrite && onDetach && trip.docs.length > 0 && (
                  <details className="rounded-2xl border border-cream-300/70 bg-white overflow-hidden print:hidden">
                    <summary className="px-4 sm:px-5 py-3 text-[13px] font-semibold text-ink-600 cursor-pointer">
                      Manage attached documents ({trip.docs.length})
                    </summary>
                    <div className="divide-y divide-cream-200 border-t border-cream-200">
                      {trip.docs.map((ref) => (
                        <div key={`${ref.role}-${ref.id}`} className="flex items-center gap-2.5 px-4 sm:px-5 py-2.5">
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-medium text-ink-800 truncate">
                              {byId.get(ref.id)?.name || 'Document no longer in the vault'}
                            </span>
                            {/* "Filed under" is EDITABLE, not a caption. A paper
                                picked while the picker was scoped to the wrong
                                row used to be stuck there — the only way out was
                                Remove and start again, which is how a consent
                                letter stayed filed under "Tickets & bookings". */}
                            {onMove ? (
                              <label className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-500">
                                <span className="shrink-0">Filed under</span>
                                <select
                                  value={ref.role}
                                  onChange={(e) => {
                                    const to = e.target.value as TripDocRole;
                                    if (to !== ref.role) onMove(ref.id, ref.role, to);
                                  }}
                                  className="min-w-0 max-w-full truncate rounded-lg border border-cream-300 bg-cream-50 px-1.5 py-0.5 text-[11.5px] font-semibold text-ink-700 cursor-pointer focus:outline-none focus:border-clay-400"
                                >
                                  {ATTACHABLE.map((entry) => (
                                    <option key={entry.role} value={entry.role}>{entry.label}</option>
                                  ))}
                                </select>
                              </label>
                            ) : (
                              <span className="block text-[11.5px] text-ink-500">
                                {ATTACHABLE.find((entry) => entry.role === ref.role)?.label || ref.role}
                              </span>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => onDetach(ref.id, ref.role)}
                            className="shrink-0 text-[12px] font-bold text-rosa-600 hover:text-rosa-700 cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* If it all goes wrong. Collapsed by default so it does not
                    dominate a calm trip, but always present and never behind a
                    menu — printing expands it, because paper has no toggle. */}
                {brief && (
                  <div className="rounded-2xl border border-rosa-100 bg-rosa-50/60 overflow-hidden print:border-ink-900/20">
                    <button
                      type="button"
                      onClick={() => setLostOpen((open) => !open)}
                      aria-expanded={lostOpen}
                      className="w-full px-4 sm:px-5 py-3.5 flex items-center gap-2.5 text-left cursor-pointer print:hidden"
                    >
                      <LifeBuoy className="w-4 h-4 text-rosa-600 shrink-0" />
                      <span className="flex-1 text-[13.5px] font-bold text-rosa-800">
                        Lost your passport or documents?
                      </span>
                      <ChevronDown className={`w-4 h-4 text-rosa-600 transition-transform ${lostOpen ? 'rotate-180' : ''}`} />
                    </button>

                    <div className={`${lostOpen ? 'block' : 'hidden'} print:block px-4 sm:px-5 pb-4 pt-1 print:pt-4 space-y-4`}>
                      <h3 className="hidden print:block text-[13px] font-bold text-ink-900">If your documents are lost or stolen</h3>

                      <ol className="space-y-2">
                        {brief.steps.map((step, index) => (
                          <li key={step} className="flex gap-2.5 text-[13px] text-ink-800 leading-snug">
                            <span className="shrink-0 w-5 h-5 rounded-full bg-rosa-100 text-rosa-800 text-[11px] font-bold flex items-center justify-center">
                              {index + 1}
                            </span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>

                      {brief.passports.length > 0 && (
                        <div className="rounded-xl bg-white border border-cream-300/70 p-3.5">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500 mb-2">
                            Passport details — what a replacement is issued from
                          </p>
                          <div className="space-y-2">
                            {brief.passports.map((passport) => (
                              <div key={passport.number} className="text-[13px]">
                                <CopyableValue value={passport.number} label="Passport number" className="font-bold text-ink-900">
                                  {passport.number}
                                </CopyableValue>
                                <p className="text-[12px] text-ink-500 font-medium">
                                  {[passport.country, passport.issueDate && `issued ${formatDate(passport.issueDate)}`,
                                    passport.expiryDate && `expires ${formatDate(passport.expiryDate)}`]
                                    .filter(Boolean).join(' · ')}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Numbers to call. Only real ones. */}
                      <div className="space-y-2">
                        {brief.insuranceEmergencyNumber && (
                          <a href={`tel:${brief.insuranceEmergencyNumber.replace(/\s/g, '')}`}
                             className="flex items-center gap-2.5 rounded-xl bg-white border border-cream-300/70 px-3.5 py-2.5">
                            <Phone className="w-4 h-4 text-dusk-600 shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-bold text-ink-900">{brief.insuranceEmergencyNumber}</span>
                              <span className="block text-[11.5px] text-ink-500 font-medium">
                                {brief.insuranceProvider || 'Travel insurer'} — 24/7 assistance
                                {brief.insurancePolicyNumber ? ` · policy ${brief.insurancePolicyNumber}` : ''}
                              </span>
                            </span>
                          </a>
                        )}
                        {brief.homeContact && (
                          <div className="flex items-center gap-2.5 rounded-xl bg-white border border-cream-300/70 px-3.5 py-2.5">
                            <Phone className="w-4 h-4 text-sage-600 shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-bold text-ink-900">{brief.homeContact}</span>
                              <span className="block text-[11.5px] text-ink-500 font-medium">Someone at home</span>
                            </span>
                          </div>
                        )}
                        {localNumbers?.numbers.map((entry) => (
                          <div key={entry.number} className="flex items-center gap-2.5 rounded-xl bg-white border border-cream-300/70 px-3.5 py-2.5">
                            <Phone className="w-4 h-4 text-rosa-600 shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-bold text-ink-900">{entry.number}</span>
                              <span className="block text-[11.5px] text-ink-500 font-medium">{entry.label}</span>
                            </span>
                          </div>
                        ))}
                      </div>

                      {!brief.insuranceEmergencyNumber && (
                        <p className="text-[12px] text-rosa-800/90 leading-snug">
                          No insurer assistance number is saved. Add it under Travel on
                          {' '}{member.name.split(/\s+/)[0] || member.name}&apos;s profile before departure — it is the number to
                          call before paying for treatment abroad.
                        </p>
                      )}
                      {!localNumbers && (
                        <p className="text-[12px] text-ink-500 leading-snug">
                          Teluva does not have verified emergency numbers for this destination, so none are shown
                          rather than a number that might be wrong. 112 works across the EU and from most mobiles worldwide.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>

    {/* The in-app viewer, over the pack (z-[100] > z-[70]). Closing it lands
        back HERE, mid-checklist, not on a browser tab.

        The v265 close-hang seen from this host turned out to be the viewer's
        own bug — its AnimatePresence exit stalls under a PDF iframe (see the
        note in DocumentViewer.tsx, which now unmounts without an exit
        animation). Bisected: image docs closed fine, PDFs did not. The
        conditional mount here predates that fix and stays — it is the same
        unmount-on-close behaviour, one level up. */}
    {viewingDoc && (
      <DocumentViewer
        document={viewingDoc}
        memberName={member?.name || ''}
        onClose={() => setViewingDocId(null)}
        onExtractKeyFacts={
          canWrite && onExtractKeyFacts && viewingVaultDoc
            ? () => onExtractKeyFacts(viewingVaultDoc.id)
            : undefined
        }
        factsStale={viewingVaultDoc ? !keyFactsCurrent(viewingVaultDoc) : false}
      />
    )}
    </>
  );
}
