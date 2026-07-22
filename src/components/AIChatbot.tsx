import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FamilyMember, VaultCategory, VaultDocument, FamilyDocument, Vehicle, SlipItem } from '../types';
import { auth } from '../lib/firebase';
import {
  loadFamilyInfo, loadHousehold, loadFinances, loadTimeline,
  loadDocuments, saveDocuments, uploadVaultFile, deleteVaultFile, loadCalendarEvents,
  loadChatHistory, saveChatHistory, uploadChatAttachment, uploadRecipePhoto, loadSpaceInfo, uploadSlipPhoto,
  uploadChatAttachmentWithPath, loadSlips, isHintSeen, markHintSeen,
} from '../utils/db';
import { computeChatInsights } from '../utils/chatInsights';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { useT } from '../i18n/LangContext';
import { compressImageToAvatar } from '../utils/imageCompress';
import ImageLightbox from './ImageLightbox';
import { looksLikePdf } from '../utils/fileType';
import { computeFileHash, findLikelyDuplicate, findLikelyDuplicateByType, DupMatch } from '../utils/documentDedup';
import {
  Sparkles, Send, Loader2, Check, X, Wand2, User, Bot, MessageSquarePlus,
  Paperclip, FileText, Image as ImageIcon, Mic, MicOff, AlertTriangle, Camera,
  ClipboardPaste, ChevronRight, CalendarClock,
} from 'lucide-react';
import DocumentScannerModal, { ScannedFile } from './DocumentScannerModal';

// Web Speech API — may be undefined in unsupported browsers
const SR: any = (typeof window !== 'undefined')
  ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  : undefined;

// Space-scoped localStorage key — same reasoning as membersKey()/calendarKey()/
// infoKey() in utils/db.ts: a fixed key is shared by every space a browser has
// ever viewed, so a Business Hub login switching spaces (Family <-> Business)
// would re-hydrate the PREVIOUS space's cached conversation — including AI
// edit cards referencing that space's own members/documents — into the new
// one. 'none' is the bucket used while familyId hasn't resolved yet.
const chatKey = (familyId: string | null) => `assistant_chat_v1_${familyId || 'none'}`;
const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);

export type AiEdit =
  | { kind: 'new_member'; name: string; role?: string; nickname?: string; birthdate?: string }
  | { kind: 'member'; member: string; field: string; value: string }
  | { kind: 'passport'; member: string; country: string; number: string; expiry?: string }
  | { kind: 'contact'; name: string; relation?: string; phone?: string; email?: string; birthdate?: string }
  | { kind: 'provider'; name: string; type?: string; specialty?: string; practiceName?: string; phone?: string; afterHoursPhone?: string; email?: string; address?: string; forMember?: string }
  | { kind: 'number'; label: string; value: string }
  // fileUrl/fileStoragePath/fileName/fileMimeType/fileSize/contentHash are stamped
  // client-side the moment the attachment finishes uploading (see send()) — the
  // model must NEVER supply them. They make the edit SELF-CONTAINED: Apply can
  // file the scan from the edit alone, with nothing needed from chat history.
  | { kind: 'document'; name: string; category: VaultCategory; member?: string; imageIndex?: number; fileUrl?: string; fileStoragePath?: string; fileName?: string; fileMimeType?: string; fileSize?: number; contentHash?: string }
  | { kind: 'calendar_event'; title: string; date: string; time?: string; category?: string; memberNames?: string[] }
  | { kind: 'list_add'; list: 'vehicles' | 'pets' | 'utilities' | 'banks' | 'insurance' | 'benefits' | 'timeline' | 'shopping'; item: Record<string, string> }
  | { kind: 'asset'; name: string; category?: string; assignedMember?: string; make?: string; model?: string; serialNumber?: string; purchaseDate?: string; purchasePrice?: string; notes?: string }
  | { kind: 'recipe'; title: string; ingredients: string[]; steps: string[]; tags?: string[]; photoUrl?: string }  // photoUrl is filled client-side after Apply — never sent by the model
  | { kind: 'slip'; shop?: string; item: string; purchaseDate?: string; amount?: string; currency?: string; assignedTo?: string; returnByDate?: string; warrantyUntil?: string; notes?: string; photoUrl?: string; photoStoragePath?: string }  // a purchase receipt/till slip — photoUrl/photoStoragePath are filled client-side after Apply — never sent by the model
  | { kind: 'household_set'; field: 'address' | 'doorCode' | 'wifiName' | 'wifiPassword' | 'garageCode'; value: string }
  | { kind: 'transit_pass'; member: string; name: string; operator?: string; cardNumber?: string; zone?: string; validFrom?: string; validUntil?: string; notes?: string }
  | { kind: 'care_schedule'; member: string; careKind: string; provider?: string; lastVisit?: string; intervalMonths?: number; nextDue?: string; notes?: string }
  | { kind: 'saying'; member: string; text: string; said?: string; context?: string }
  | { kind: 'favorite_quote'; member: string; text: string; source?: string; note?: string }
  | { kind: 'family_word'; word: string; meaning: string; coinedBy?: string; approxDate?: string }
  | {
      kind: 'cv'; member: string; summary?: string;
      roles?: { title: string; employer?: string; startDate?: string; endDate?: string; current?: boolean; notes?: string }[];
      education?: { institution: string; qualification?: string; fieldOfStudy?: string; startDate?: string; endDate?: string; notes?: string }[];
      qualifications?: { name: string; issuer?: string; issueDate?: string; expiryDate?: string; notes?: string }[];
      skills?: string[]; languages?: string[];
      fileDocumentId?: string; // client-only — stamped after the attached CV photo/PDF is filed; the model never supplies this
    }
  | { kind: 'estate_record'; docKind: string; forMember?: string; originalLocation?: string; heldBy?: string; notaryName?: string; notaryPhone?: string; executor?: string; lastReviewed?: string; notes?: string }
  // Append one or more service/repair records — read from a service booklet,
  // workshop invoice, or stamped maintenance page — onto an EXISTING vehicle's
  // serviceLog. The vehicle is matched (client-side, in aiApply) by VIN, then
  // registration plate, then name. Store-and-recall only: records exactly what
  // the document shows, never an interpretation ("overdue"/"you must…").
  | { kind: 'service_record'; vehicle?: string; plate?: string; vin?: string; records: { date: string; work: string; odometer?: string; cost?: string; garage?: string; notes?: string }[] };

interface Attachment { name: string; mimeType: string; dataUrl: string; }

// An Attachment after its Storage upload resolved: dataUrl is now an https
// download URL, and storagePath/fileSize/contentHash were captured from the
// base64 before it was discarded. The extras are absent when the upload failed.
interface PersistedAttachment extends Attachment {
  storagePath?: string;
  fileSize?: number;
  contentHash?: string;
}

// A document edit that looks like it might already be saved — surfaced inline
// so the user can pick Replace or Keep both before Apply actually files it.
interface DocDuplicateFlag {
  editIdx: number; // index within that message's docEdits array
  name: string;
  match: DupMatch<VaultDocument>;
  resolution?: 'replace' | 'keep';
}

// Attach up to this many files/photos to a single message — plenty for a
// multi-page ID or several documents at once, without ballooning the request.
const MAX_ATTACHMENTS = 6;

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  edits?: AiEdit[];
  applied?: boolean;
  image?: string;             // legacy single dataUrl preview — kept for messages persisted before multi-attach
  images?: string[];          // dataUrl previews on a user message — swapped to Storage URLs once uploaded, see send()
  sourceImage?: Attachment;   // legacy single source — kept for messages persisted before multi-attach
  sourceImages?: Attachment[]; // carried on the assistant message so 'document' edits can file the right scan
  warnings?: string[];        // client-side safety-net notices (e.g. a likely-missed passport record) — display only, never persisted server-side
}

interface Props {
  members: FamilyMember[];
  onApplyEdits: (edits: AiEdit[]) => Promise<void>;
  // File a scanned document into a member's own Documents tab (in addition to the vault)
  onAddMemberDoc: (memberId: string, doc: FamilyDocument) => Promise<void>;
  isBusinessSpace?: boolean;
  /** Open the "fun avatar" generator for whichever profile is currently active. Omitted (no chip shown) when the caller can't use it (not admin, or nothing selected). */
  onOpenFunAvatar?: () => void;
  /** Jump to a member's own profile tab — used by the heads-up card to make each item tappable. */
  onGo?: (memberId: string, tab: string) => void;
  /** Jump to a top-level view (e.g. 'vehicles', 'slips') — the view-nudge counterpart of onGo. */
  onGoView?: (view: string) => void;
}

function slimMembers(members: FamilyMember[]) {
  return members.map(m => {
    const { avatarUrl, documents, digitalAccounts, favorites, growthHistory, ...rest } = m as any;
    return {
      ...rest,
      documents: (documents || []).map((d: any) => ({ name: d.name, category: d.category, uploadedAt: d.uploadedAt })),
      // NEVER send stored passwords to the AI; keep only what lets it answer "what accounts does X have"
      digitalAccounts: (digitalAccounts || []).map((a: any) => ({ service: a.service, username: a.username })),
      // Strip base64 wishlist images (huge + would truncate the whole context)
      favorites: (favorites || []).map((f: any) => ({ name: f.name, price: f.price, notes: f.notes })),
      // Keep only the latest growth entry — history is bulky and rarely asked
      growthHistory: (growthHistory || []).slice(-1),
    };
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/data:(.*?);base64/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64 || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// dataUrlToBlob() only understands base64 data: URLs. Since attachments are
// uploaded to Storage the moment a message sends, an Attachment's dataUrl is
// normally an https download URL by the time Apply runs — and atob() on that
// decoded to an EMPTY string, so the "blob" was ZERO BYTES: an empty file went
// into the vault with no error, and every scan hashed identically so duplicate
// detection misfired. Fetch remote URLs instead of pretending to decode them.
async function attachmentToBlob(src: Attachment): Promise<Blob> {
  if (/^https?:\/\//i.test(src.dataUrl)) {
    const res = await fetch(src.dataUrl);
    if (!res.ok) throw new Error("Couldn't read the attached photo back from storage.");
    return res.blob();
  }
  return dataUrlToBlob(src.dataUrl);
}

// The original bytes of attachments uploaded in THIS session, keyed by their
// Storage path. Lets Apply upload a proper full copy into the vault's own
// documents/ prefix (exactly as before this change) without re-downloading,
// while the stamped fileUrl on the edit remains the durable fallback for an
// Apply that happens after a reload. Deliberately module-level and bounded —
// it is a cache, never a source of truth, and losing it costs nothing.
const sessionAttachmentBlobs = new Map<string, Blob>();
const MAX_CACHED_ATTACHMENT_BLOBS = 12;
function cacheAttachmentBlob(storagePath: string, blob: Blob) {
  if (sessionAttachmentBlobs.size >= MAX_CACHED_ATTACHMENT_BLOBS) {
    const oldest = sessionAttachmentBlobs.keys().next().value;
    if (oldest) sessionAttachmentBlobs.delete(oldest);
  }
  sessionAttachmentBlobs.set(storagePath, blob);
}

const firstName = (m: FamilyMember): string => (m.nickname || m.name).trim().split(/\s+/)[0];

// Starter suggestions built from the REAL family/team, not placeholders.
function buildSuggestions(members: FamilyMember[], isBusinessSpace?: boolean): string[] {
  if (isBusinessSpace) {
    if (!members.length) {
      return [
        'Add a new team member',
        'What can you help me with?',
        'What’s coming up on the calendar?',
      ];
    }
    return Array.from(new Set([
      `When does ${firstName(members[0])}’s residence permit expire?`,
      'Whose passport expires soonest?',
      'What documents are missing for the team?',
      'What’s coming up on the calendar?',
    ]));
  }
  if (!members.length) {
    return [
      'Add a new family member',
      'What can you help me with?',
      'What’s coming up on the calendar?',
    ];
  }
  const kids = members.filter(m => m.role === 'Child');
  const a = kids[0] || members[0];
  const b = kids[1] || kids[0] || members[0];
  return Array.from(new Set([
    `What’s ${firstName(a)}’s shoe size?`,
    'When does my residence permit expire?',
    `How old is ${firstName(b)} and what clothes size should I get?`,
    'Whose passport expires soonest?',
  ]));
}

export default function AIChatbot({ members, onApplyEdits, onAddMemberDoc, isBusinessSpace, onOpenFunAvatar, onGo, onGoView }: Props) {
  const { uid, familyId } = useFamilyCtx();
  const { lang, t } = useT();
  const suggestions = buildSuggestions(members, isBusinessSpace);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const raw = localStorage.getItem(chatKey(familyId));
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);
  // Duplicate-document flags for a message's pending Apply, keyed by message
  // index → one entry per flagged document edit (editIdx = index within that
  // message's own docEdits array). Apply is held until every flag is resolved.
  const [docDuplicates, setDocDuplicates] = useState<Record<number, DocDuplicateFlag[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  // Progressive word-by-word reveal of the latest assistant reply — null means
  // "not streaming" (either no reply yet, or the reveal has finished).
  const [streamWordCount, setStreamWordCount] = useState<number | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Heads-up card: vehicles + slips aren't in `members`, so load them once (same
  // sources NeedsAttention uses) to feed the deterministic expiry/gap index.
  const [hVehicles, setHVehicles] = useState<Vehicle[]>([]);
  const [hSlips, setHSlips] = useState<SlipItem[]>([]);
  // Dismiss persists per-day via the existing isHintSeen/markHintSeen convention
  // (per space + device). A fresh key each day means the card returns tomorrow if
  // there's still something to surface, but stays gone for the rest of today.
  const headsUpKey = `chat_headsup_${new Date().toISOString().slice(0, 10)}`;
  const [headsUpDismissed, setHeadsUpDismissed] = useState(() => isHintSeen(headsUpKey));
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopStreaming = () => {
    if (streamTimerRef.current) { clearInterval(streamTimerRef.current); streamTimerRef.current = null; }
    setStreamWordCount(null);
  };

  // Word-by-word reveal at ~30ms/word for the reply that just arrived.
  const startStreaming = (fullText: string) => {
    if (streamTimerRef.current) clearInterval(streamTimerRef.current);
    const words = fullText.trim().split(/\s+/).filter(Boolean);
    if (words.length <= 1) { setStreamWordCount(null); return; }
    let count = 1;
    setStreamWordCount(count);
    streamTimerRef.current = setInterval(() => {
      count++;
      setStreamWordCount(count);
      if (count >= words.length) {
        if (streamTimerRef.current) { clearInterval(streamTimerRef.current); streamTimerRef.current = null; }
        setStreamWordCount(null);
      }
    }, 30);
  };

  // Clean up speech recognition + any in-flight streaming reveal on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
      if (streamTimerRef.current) { clearInterval(streamTimerRef.current); streamTimerRef.current = null; }
    };
  }, []);

  useEffect(() => {
    if (!uid) { setMessages([]); return; }
    loadChatHistory(uid).then(history => {
      if (history.length > 0) setMessages(history);
    });
  }, [uid, familyId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, streamWordCount]);

  // Attachments are uploaded to Storage as soon as a message sends (see send()),
  // so images/sourceImages normally hold small https download URLs by the time
  // this runs — safe to persist. Only the raw base64 data: URLs are stripped
  // (the legacy singular image/sourceImage fields are never written by current
  // code, so those always drop). If an upload is still in flight or failed,
  // its dataUrl is still `data:` and gets stripped here rather than bloating
  // storage — that attachment just won't survive a reload, same as before.
  const isRemoteUrl = (src: string) => /^https?:\/\//i.test(src);
  // A message still carrying a document scan that (a) hasn't been Applied yet and
  // (b) never got a durable Storage URL on its edit (its send-time upload failed).
  // For such a message the inline base64 is the ONLY surviving copy of the scan —
  // and stripping it for storage is EXACTLY what produced "the photo is no longer
  // in this chat" after a reload. So we keep the bytes for these until the doc is
  // filed; the very next save after Apply drops them (applied → not pending).
  const hasUnfiledDocScan = (m: Partial<ChatMessage>) =>
    !m.applied && Array.isArray(m.edits) &&
    m.edits.some((e) => e.kind === 'document' && !e.fileUrl);
  const slimForCloud = (msgs: ChatMessage[]) =>
    msgs.map(({ image, sourceImage, images, sourceImages, ...m }) => {
      const keepBytes = hasUnfiledDocScan(m);
      return {
        ...m,
        images: images?.every(isRemoteUrl) ? images : (keepBytes ? images : undefined),
        sourceImages: sourceImages?.every((a) => isRemoteUrl(a.dataUrl)) ? sourceImages : (keepBytes ? sourceImages : undefined),
      };
    });

  // Persist the conversation (minus heavy image data) on this device.
  useEffect(() => {
    try {
      const slim = slimForCloud(messages.slice(-60));
      localStorage.setItem(chatKey(familyId), JSON.stringify(slim));
    } catch { /* ignore */ }
  }, [messages, familyId]);

  // Load the vehicles + slips the heads-up card needs (members are already a
  // prop). Only worth doing while the opening state can show — reloads per space.
  useEffect(() => {
    let cancelled = false;
    loadHousehold().then((h) => { if (!cancelled) setHVehicles(h?.vehicles || []); }).catch(() => { if (!cancelled) setHVehicles([]); });
    loadSlips().then((s) => { if (!cancelled) setHSlips(s || []); }).catch(() => { if (!cancelled) setHSlips([]); });
    return () => { cancelled = true; };
  }, [familyId]);

  // Deterministic expiry/gap index for the heads-up card — same function that
  // feeds buildContext, so the card and the AI agree. Recomputed only when its
  // inputs change.
  const insights = useMemo(
    () => computeChatInsights({ members, vehicles: hVehicles, slips: hSlips }),
    [members, hVehicles, hSlips],
  );
  const headsUp = [...insights.expiries, ...insights.gaps].slice(0, 4);
  const dismissHeadsUp = () => { markHintSeen(headsUpKey); setHeadsUpDismissed(true); };

  const startNewChat = () => {
    stopStreaming();
    setMessages([]);
    setError(null);
    setInput('');
    setAttachments([]);
    try { localStorage.removeItem(chatKey(familyId)); } catch { /* ignore */ }
    if (uid) saveChatHistory(uid, []);
  };

  const buildContext = async () => {
    const [info, household, finances, timeline, docs, events, spaceInfo, slips] = await Promise.all([
      loadFamilyInfo(), loadHousehold(), loadFinances(), loadTimeline(), loadDocuments(), loadCalendarEvents(), loadSpaceInfo(), loadSlips(),
    ]);
    // Say plainly, for each vault document, whether it is actually on a person's
    // profile Documents tab or only in the shared vault — because that is the
    // "says it's there but it isn't" complaint: the assistant saw a flat vault
    // list it called "documents" and reported a scan as "in his documents" when
    // the profile tab (which renders member.documents) showed nothing.
    //
    // Derive this from GROUND TRUTH — actual presence in a member's own
    // documents — NOT from the vault doc's memberId. memberId is only a hint:
    // the manual upload and bulk-import panels stamp memberId on a vault doc
    // WITHOUT copying it to the member's profile, so trusting memberId would
    // reintroduce the exact bug through those paths. A vault doc with id X is on
    // a profile iff some member.documents entry has id "doc-" + X (the linkage
    // fileScans mints).
    const ownerOfDocId = new Map<string, string>();
    for (const m of members) {
      for (const md of (m.documents || [])) ownerOfDocId.set(md.id, m.name);
    }
    const documents = (docs || []).map(d => {
      const ownerName = ownerOfDocId.get('doc-' + d.id);
      return {
        name: d.name,
        category: d.category,
        uploadedAt: d.uploadedAt,
        // "on <name>'s profile" vs "shared vault only (not on anyone's profile)"
        location: ownerName ? `on ${ownerName}'s profile` : 'shared vault only',
      };
    });
    // Business Milestones: only surface name+foundingDate (never address/
    // registrationNumber/industry) and only when a founding date is actually
    // set — keeps the AI's BUSINESS ANNIVERSARY instruction a no-op until then.
    const spaceInfoCtx = (spaceInfo && spaceInfo.foundingDate) ? { name: spaceInfo.name, foundingDate: spaceInfo.foundingDate } : undefined;
    // Precomputed, deterministic expiry/gap index (no AI, pure code over the data
    // above) — the AUTHORITATIVE answer for "what expires in the next N months"
    // and "what's missing", so the model never has to eyeball raw dates. Compact:
    // just the factual text + daysUntil (negative = overdue).
    const insights = computeChatInsights({ members, vehicles: household?.vehicles || [], slips: slips || [] });
    const expiries = insights.expiries.map((n) => ({ text: n.text, daysUntil: n.days }));
    const gaps = insights.gaps.map((n) => ({ text: n.text }));
    return { members: slimMembers(members), info, household, finances, timeline, documents, calendar: events || [], isBusinessSpace: !!isBusinessSpace, spaceInfo: spaceInfoCtx, expiries, gaps };
  };

  const onPasteImage = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items) as DataTransferItem[]) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        if (attachments.length >= MAX_ATTACHMENTS) {
          setError(`You can attach up to ${MAX_ATTACHMENTS} files at once.`);
          return;
        }
        try {
          let dataUrl = await fileToDataUrl(file);
          dataUrl = await compressImageToAvatar(dataUrl, 1600, 0.82);
          setAttachments(prev => [...prev, { name: `screenshot-${prev.length + 1}.jpg`, mimeType: 'image/jpeg', dataUrl }]);
          setError(null);
        } catch {
          setError("Couldn't read the pasted image.");
        }
        return;
      }
      // Desktop Ctrl+V of a copied PDF — route it through the same attachment
      // path with no image compression.
      if (item.type === 'application/pdf') {
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        if (attachments.length >= MAX_ATTACHMENTS) {
          setError(`You can attach up to ${MAX_ATTACHMENTS} files at once.`);
          return;
        }
        try {
          const dataUrl = await fileToDataUrl(file);
          setAttachments(prev => [...prev, { name: file.name || `clipboard-${prev.length + 1}.pdf`, mimeType: 'application/pdf', dataUrl }]);
          setError(null);
        } catch {
          setError("Couldn't read the pasted PDF.");
        }
        return;
      }
    }
  };

  // iOS Safari (and desktop) fallback: a user-gesture-triggered read of the
  // async Clipboard API. On iOS, pasting a copied Photos image into a plain
  // input does NOT populate onPaste's clipboardData with the image, so this
  // button is the only reachable paste path there. Feature-detected at the
  // call site (button only renders when navigator.clipboard.read exists).
  const pasteFromClipboard = async () => {
    if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
      setError('Pasting from the clipboard is not supported on this device — use Attach instead.');
      return;
    }
    if (attachments.length >= MAX_ATTACHMENTS) {
      setError(`You can attach up to ${MAX_ATTACHMENTS} files at once.`);
      return;
    }
    try {
      const clipItems = await navigator.clipboard.read();
      let added = 0;
      for (const clipItem of clipItems) {
        if (attachments.length + added >= MAX_ATTACHMENTS) break;
        const pdfType = clipItem.types.find(ty => ty === 'application/pdf');
        const imageType = clipItem.types.find(ty => ty.startsWith('image/'));
        if (pdfType) {
          const blob = await clipItem.getType(pdfType);
          const file = new File([blob], `clipboard-${Date.now()}.pdf`, { type: 'application/pdf' });
          const dataUrl = await fileToDataUrl(file);
          setAttachments(prev => [...prev, { name: file.name, mimeType: 'application/pdf', dataUrl }]);
          added++;
        } else if (imageType) {
          const blob = await clipItem.getType(imageType);
          const file = new File([blob], `clipboard-${Date.now()}.png`, { type: imageType });
          let dataUrl = await fileToDataUrl(file);
          dataUrl = await compressImageToAvatar(dataUrl, 1600, 0.82);
          setAttachments(prev => [...prev, { name: `pasted-${prev.length + 1}.jpg`, mimeType: 'image/jpeg', dataUrl }]);
          added++;
        }
      }
      if (added === 0) {
        setError('No image or PDF found on the clipboard — copy one first, then tap Paste.');
      } else {
        setError(null);
      }
    } catch (err) {
      const name = (err && typeof err === 'object' && 'name' in err) ? (err as { name?: string }).name : undefined;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setError('Clipboard access was blocked — allow it in your browser, or use Attach instead.');
      } else {
        setError("Couldn't read the clipboard. Try Attach instead.");
      }
    }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (!files.length) return;

    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) { setError(`You can attach up to ${MAX_ATTACHMENTS} files at once.`); return; }
    const toProcess = files.slice(0, room);
    if (files.length > room) setError(`You can attach up to ${MAX_ATTACHMENTS} files at once — added the first ${room}.`);
    else setError(null);

    const next: Attachment[] = [];
    for (const file of toProcess) {
      if (file.size > 20 * 1024 * 1024) { setError('One of those files is over 20MB — please use a smaller scan.'); continue; }
      try {
        let dataUrl = await fileToDataUrl(file);
        let mimeType = file.type || 'application/octet-stream';
        // Shrink photos before sending — a raw phone photo is too big for the
        // request and slows the scan; 1600px is plenty for OCR. PDFs pass through.
        if (mimeType.startsWith('image/')) {
          // 1200px @ 0.75 is plenty for OCR and keeps the payload small on mobile
          dataUrl = await compressImageToAvatar(dataUrl, 1200, 0.75);
          mimeType = 'image/jpeg';
        }
        next.push({ name: file.name, mimeType, dataUrl });
      } catch {
        setError("Couldn't read one of those files.");
      }
    }
    if (next.length) setAttachments(prev => [...prev, ...next]);
  };

  const onScanResult = (file: ScannedFile) => {
    if (attachments.length >= MAX_ATTACHMENTS) {
      setError(`You can attach up to ${MAX_ATTACHMENTS} files at once.`);
      return;
    }
    setAttachments(prev => [...prev, { name: file.name, mimeType: file.type, dataUrl: file.data }]);
  };

  const toggleVoice = () => {
    if (!SR) return;

    if (listening) {
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      return; // onend will set listening=false
    }

    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;

    rec.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };

    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    rec.onerror = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };

  const send = async (text: string, retryAtts?: Attachment[] | null) => {
    const msg = text.trim();
    const atts = retryAtts !== undefined ? (retryAtts || []) : attachments;
    if ((!msg && atts.length === 0) || loading) return;
    stopStreaming(); // cancel any reveal still playing from a prior reply
    setError(null);
    setInput('');
    setAttachments([]);
    setIsScanning(atts.length > 0);

    const history = messages.map(m => ({ role: m.role, text: m.text }));
    const fallbackText = atts.length === 1 ? `📎 ${atts[0].name}` : `📎 ${atts.length} files`;
    const userMsg: ChatMessage = { role: 'user', text: msg || fallbackText, images: atts.length ? atts.map(a => a.dataUrl) : undefined };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Please sign in first.');
      const token = await user.getIdToken();
      const context = await buildContext();

      const body: any = { message: msg, context, history, lang };
      if (atts.length) body.images = atts.map(a => ({ mimeType: a.mimeType, data: a.dataUrl.split(',')[1] }));

      // Upload each attachment to Storage in parallel with the AI request (not
      // blocking it) so the persisted copy of this message can hold a small,
      // durable https URL instead of the raw base64 — previously that image
      // data was stripped before ever being saved, so an attached scan was
      // silently gone from the chat the moment the app reloaded.
      // Also computes the hash/size from the base64 while it is still in hand —
      // after the upload resolves, `dataUrl` is an https URL and those bytes are
      // gone from the message. Everything computed here is stamped onto the
      // document edits below, which is what makes filing independent of chat.
      const uploadFailures: string[] = [];
      const uploadPromise: Promise<PersistedAttachment[]> = atts.length
        ? Promise.all(atts.map(async (a) => {
            const blob = dataUrlToBlob(a.dataUrl);
            const contentHash = await computeFileHash(blob);
            // Retry the Storage upload: on mobile the single most common cause of
            // "the photo didn't file" was a transient upload failure (flaky
            // connection), which left the edit without a durable URL. Three tries
            // with backoff turns almost all of those into successes. If it still
            // fails, the base64 is retained in the message (see hasUnfiledDocScan)
            // so a later Apply can re-upload from it — the scan is never lost.
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                const { url, storagePath } = await uploadChatAttachmentWithPath(a.dataUrl, a.mimeType, user.uid);
                cacheAttachmentBlob(storagePath, blob);
                return { ...a, dataUrl: url, storagePath, fileSize: blob.size, contentHash };
              } catch (e) {
                if (attempt === 3) {
                  console.error('Chat attachment upload failed after 3 tries; base64 kept for retry-on-apply:', e);
                  uploadFailures.push(a.name);
                  return { ...a };
                }
                await new Promise((r) => setTimeout(r, 400 * attempt));
              }
            }
            return { ...a }; // unreachable; satisfies the type checker
          }))
        : Promise.resolve([]);

      const [res, persistedAtts] = await Promise.all([
        fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }),
        uploadPromise,
      ]);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'The assistant is unavailable right now.');

      const rawEdits: AiEdit[] = Array.isArray(data.edits) ? data.edits : [];
      // Backfill the owner on scanned documents so the preview shows "+ <name>'s
      // profile" and Apply files onto the person, even when the AI left it blank.
      const edits: AiEdit[] = rawEdits.map(e => {
        if (e.kind !== 'document') return e;
        const owner = inferDocOwner(e, rawEdits);
        const withOwner = owner ? { ...e, member: owner.name } : e;
        // Stamp the uploaded scan onto the edit itself. This is the whole point
        // of the change: from here on, filing the document needs NOTHING from
        // chat history — not the message, not sourceImages, not localStorage,
        // not surviving the 50-message truncation in saveChatHistory. Skipped
        // when the upload failed (no storagePath), so those cards keep today's
        // behaviour rather than pointing at a URL that doesn't exist.
        const src = persistedAtts[e.imageIndex ?? 0] || persistedAtts[0];
        if (!src?.storagePath) return withOwner;
        return {
          ...withOwner,
          fileUrl: src.dataUrl, fileStoragePath: src.storagePath,
          fileName: src.name, fileMimeType: src.mimeType,
          fileSize: src.fileSize, contentHash: src.contentHash,
        };
      });
      // Safety net for a known failure mode: the model sometimes files a passport
      // scan as a plain document without the matching structured passport edit
      // (most often when it's photographed alongside other images). We can't
      // fabricate the passport number/country ourselves, so don't silently
      // create a blank record — just warn visibly so the user knows to check.
      const passportGaps = edits.filter(e =>
        e.kind === 'document' && e.category === 'Identity' && /passport/i.test(e.name) &&
        !edits.some(p => p.kind === 'passport' && resolveMemberByName(p.member)?.id === resolveMemberByName(e.member)?.id),
      );
      const warnings = passportGaps.map(e => {
        const owner = resolveMemberByName((e as Extract<AiEdit, { kind: 'document' }>).member);
        return `Looks like ${owner ? owner.name + "'s" : 'a'} passport, but no passport record was extracted — check ID & Passports and add it if it's missing.`;
      });
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        text: data.reply || '…',
        edits: edits.length ? edits : undefined,
        sourceImages: persistedAtts.length ? persistedAtts : undefined,
        warnings: warnings.length ? warnings : undefined,
      };
      setMessages(prev => {
        // Patch the earlier optimistic user message's images to the uploaded
        // Storage URLs too, so both sides of this exchange survive a reload.
        const withUploadedImages = persistedAtts.length
          ? prev.map(m => (m === userMsg ? { ...m, images: persistedAtts.map(a => a.dataUrl) } : m))
          : prev;
        const updatedMessages = [...withUploadedImages, assistantMsg];
        if (uid) saveChatHistory(uid, slimForCloud(updatedMessages));
        return updatedMessages;
      });
      startStreaming(assistantMsg.text);
      // A failed attachment upload used to only console.error, so the user found
      // out much later — when Apply mysteriously couldn't file the document.
      // Say it now, while the photo is still on their screen to re-send.
      if (uploadFailures.length) {
        setError(`Couldn't save ${uploadFailures.join(', ')} to storage — the photo may not be available later. Send it again if the document doesn't file.`);
      }
    } catch (e: any) {
      const raw = e?.message || 'Something went wrong.';
      // "Load failed" is Safari/iOS's fetch abort error — surface a clearer message
      // and restore the attachments + text so the user can retry without re-uploading.
      const errMsg = raw === 'Load failed' || raw === 'Failed to fetch'
        ? 'Network error — the scan timed out. Tap Retry to try again.'
        : raw;
      setMessages(prev => prev.slice(0, -1)); // remove optimistic user message
      setInput(msg);                           // restore text
      if (atts.length) setAttachments(atts);   // restore attachments
      setError(errMsg);
    } finally {
      setLoading(false);
      setIsScanning(false);
    }
  };

  // Vault categories → member-document categories (two historic enums)
  const MEMBER_DOC_CAT: Record<VaultCategory, FamilyDocument['category']> = {
    Identity: 'ID', Medical: 'Health', Education: 'Education', Travel: 'Travel',
    Financial: 'Other', Legal: 'Other', Other: 'Other',
  };

  const resolveMemberByName = (name?: string): FamilyMember | undefined => {
    const q = (name || '').trim().toLowerCase();
    if (!q) return undefined;
    return members.find(m => m.name.toLowerCase() === q || (m.nickname || '').toLowerCase() === q)
      || members.find(m => m.name.toLowerCase().split(/\s+/)[0] === q.split(/\s+/)[0]);
  };

  // Safety net: work out who a scanned document belongs to even when the AI
  // forgets to tag "member" — so a passport/ID reliably lands on the person's
  // OWN Documents tab, not just the shared vault. Tries, in order: the AI's own
  // tag → a member named in the document title → (for personal docs) the single
  // person referenced elsewhere in the same batch (e.g. a passport edit for Sophie
  // means this Identity scan is Sophie's).
  const inferDocOwner = (
    doc: Extract<AiEdit, { kind: 'document' }>,
    batch: AiEdit[],
  ): FamilyMember | undefined => {
    const explicit = resolveMemberByName(doc.member);
    if (explicit) return explicit;

    const nameL = (doc.name || '').toLowerCase();
    const byTitle = members.find(m => {
      const first = m.name.toLowerCase().split(/\s+/)[0];
      return (m.name && nameL.includes(m.name.toLowerCase()))
        || (m.nickname && nameL.includes(m.nickname.toLowerCase()))
        || (first.length >= 3 && nameL.includes(first));
    });
    if (byTitle) return byTitle;

    const PERSONAL: VaultCategory[] = ['Identity', 'Medical', 'Education', 'Travel'];
    if (PERSONAL.includes(doc.category)) {
      const names = new Set<string>();
      for (const e of batch) {
        if ((e.kind === 'passport' || e.kind === 'member') && e.member) names.add(e.member.toLowerCase());
        else if (e.kind === 'new_member' && e.name) names.add(e.name.toLowerCase());
      }
      if (names.size === 1) return resolveMemberByName([...names][0]);
    }
    return undefined;
  };

  type DocEdit = Extract<AiEdit, { kind: 'document' }>;

  // Checks each document edit against the vault before anything is saved —
  // returns one flag per edit that looks like it might already exist, so the
  // user can choose Replace or Keep both instead of silently getting a second copy.
  const checkDocDuplicates = async (docEdits: DocEdit[], srcs: Attachment[]): Promise<DocDuplicateFlag[]> => {
    const existing = await loadDocuments();
    const flags: DocDuplicateFlag[] = [];
    for (let i = 0; i < docEdits.length; i++) {
      const e = docEdits[i];
      // Prefer the signature stamped onto the edit at upload time: it was
      // computed from the real base64 and is always right. Deriving it from a
      // chat attachment only works while the message still carries a usable
      // image — and, before attachmentToBlob, silently hashed an EMPTY blob
      // once the dataUrl had become an https URL, so every scan looked like a
      // duplicate of every other.
      let fileName = e.fileName;
      let fileSize = e.fileSize;
      let hash = e.contentHash;
      if (!hash) {
        const src = srcs[e.imageIndex ?? 0] || srcs[0];
        if (!src) continue;
        const blob = await attachmentToBlob(src);
        fileName = src.name;
        fileSize = blob.size;
        hash = await computeFileHash(blob);
      }
      const ownerId = resolveMemberByName(e.member)?.id;
      const sameSlot = existing.filter((d) => d.category === e.category && (d.memberId || '') === (ownerId || ''));
      const match = findLikelyDuplicate({ fileName: fileName || '', fileSize: fileSize ?? 0, contentHash: hash }, existing)
        || findLikelyDuplicateByType(e.name, sameSlot);
      if (match) flags.push({ editIdx: i, name: e.name, match });
    }
    return flags;
  };

  // File the scanned image(s) for any 'document' edits: always into the shared
  // Document Vault, AND into the named member's own Documents tab when the AI
  // says who the document belongs to (e.g. Sophie's passport). When multiple
  // images were attached in one turn, each 'document' edit's imageIndex picks
  // which one it came from (untagged/out-of-range edits fall back to the
  // first image, matching the old single-attachment behaviour). `resolutions`
  // carries the user's Replace/Keep-both choice for any edit flagged as a
  // likely duplicate by checkDocDuplicates (absent = no flag, nothing to resolve).
  const fileScans = async (docEdits: DocEdit[], srcs: Attachment[], resolutions: Record<number, DocDuplicateFlag>) => {
    // Nothing to file only when BOTH sources are missing: an edit stamped with
    // its own fileUrl needs no chat attachment at all.
    if (!srcs.length && !docEdits.some(e => e.fileUrl)) return;
    let existing = await loadDocuments();
    const today = new Date().toISOString().slice(0, 10);
    const by = auth.currentUser?.displayName || auth.currentUser?.email || 'Family';
    const added: VaultDocument[] = [];
    const skipped: string[] = [];

    for (let i = 0; i < docEdits.length; i++) {
      const e = docEdits[i];
      const src = srcs[e.imageIndex ?? 0] || srcs[0];

      const flag = resolutions[i];
      if (flag?.resolution === 'replace') {
        try { await deleteVaultFile(flag.match.doc.storagePath); } catch (err) { console.error('Replace: old file delete failed (removing metadata anyway):', err); }
        existing = existing.filter(d => d.id !== flag.match.doc.id);
      }

      const id = newId();
      // Three ways to get the file into the vault, in order of preference:
      //  1. the edit is stamped AND we still hold the original bytes from this
      //     session — upload a full copy under documents/, exactly as before;
      //  2. the edit is stamped but the bytes are gone (Apply after a reload) —
      //     adopt the chat-attachment object itself as the vault file. It already
      //     lives permanently in the bucket under families/{id}/, which
      //     storage.rules grants the same family-scoped read as documents/, so
      //     no copy, no re-download, and nothing to go wrong. Trade-off worth
      //     naming: deleting this vault document also deletes the chat photo;
      //  3. no stamp at all (a card saved before this change) — today's exact
      //     path from the chat attachment, so old cards behave no worse.
      let fileName: string, fileType: string, fileSize: number, hash: string;
      let storagePath: string, downloadUrl: string;
      const cachedBlob = e.fileStoragePath ? sessionAttachmentBlobs.get(e.fileStoragePath) : undefined;
      if (e.fileUrl && e.fileStoragePath && !cachedBlob) {
        fileName = e.fileName || src?.name || e.name;
        fileType = e.fileMimeType || src?.mimeType || 'application/octet-stream';
        fileSize = e.fileSize ?? 0;
        hash = e.contentHash || '';
        // Deliberately NOT e.fileStoragePath. One photo can produce several
        // document edits (a scan showing both a passport and a residence
        // permit), and they all stamp the SAME chat-attachment path — so
        // handing that path to the delete machinery would mean deleting one
        // document destroys the file behind its siblings, and behind the copy
        // on the member's profile, leaving them pointing at a dead URL. An
        // empty path makes deletion metadata-only for these: the chat-attachment
        // object is orphaned rather than deleted. Orphaning bytes is a cost;
        // silently destroying another document's file is not acceptable in a
        // vault holding passports and IDs.
        storagePath = '';
        downloadUrl = e.fileUrl;
      } else {
        // The guard above now lets this loop run when SOME edits are stamped,
        // so `srcs` can legitimately be empty here while `src` is undefined —
        // e.g. one attachment in a multi-image send failed to upload, leaving
        // its edit unstamped while its sibling's succeeded. Dereferencing
        // `src` would throw, and because saveDocuments() only runs after the
        // whole loop, that would lose EVERY document in the turn including the
        // stamped ones that were fine. Skip just this one instead.
        if (!src && !cachedBlob) {
          console.error('No source available for unstamped document edit; skipping:', e.name);
          skipped.push(e.name);
          continue;
        }
        const blob = cachedBlob ?? await attachmentToBlob(src);
        fileName = e.fileName || src?.name || e.name;
        fileType = e.fileMimeType || src?.mimeType || blob.type || 'application/octet-stream';
        fileSize = blob.size;
        hash = e.contentHash || await computeFileHash(blob);
        const file = new File([blob], fileName, { type: fileType });
        ({ storagePath, downloadUrl } = await uploadVaultFile(file, id));
      }

      // Resolve the owner ONCE, and infer it (from the document's own name, and
      // sibling edits in the same turn) rather than trusting a bare e.member that
      // an upstream step may not have backfilled. This is exactly how the e-card
      // ended up in the vault but not on Rory's profile: e.member was blank, the
      // bare resolveMemberByName returned nothing, and the profile copy was
      // skipped — even though the name "Rory Michael Clark Austrian e-card" names
      // him unambiguously.
      const owner = inferDocOwner(e, docEdits);

      added.push({
        id, name: e.name, category: e.category,
        fileName, fileType, fileSize,
        // Attribute the vault copy to its owner. Without this, EVERY chat-filed
        // vault document had memberId undefined — so the Document Vault couldn't
        // show whose it was, and the assistant (which is sent the vault list) saw
        // an unowned doc and couldn't tell it apart from the person's profile.
        memberId: owner?.id,
        storagePath, downloadUrl, uploadedAt: today, uploadedBy: by, contentHash: hash || undefined,
      });

      // Also file on the member's profile when we could identify the owner. Store
      // the Storage download URL (not the base64 image) so the member's Firestore
      // doc stays tiny and can never blow the 1 MiB limit — it renders the same,
      // since MemberDocuments/DocumentViewer use fileData directly as an <img src>.
      if (owner) {
        await onAddMemberDoc(owner.id, {
          id: 'doc-' + id,
          name: e.name,
          category: MEMBER_DOC_CAT[e.category] || 'Other',
          fileType,
          fileName,
          fileSize,
          uploadedAt: today,
          fileData: downloadUrl,
          contentHash: hash || undefined,
        });
      }
    }
    if (added.length) await saveDocuments([...added, ...existing]);
    // Never let a document fail to file in silence — that is the whole class of
    // bug this work exists to kill. Whatever else succeeded is already saved.
    if (skipped.length) {
      setError(
        `Saved everything else, but ${skipped.length === 1 ? `"${skipped[0]}" couldn't be filed` : `${skipped.length} documents couldn't be filed`} — the photo didn't finish uploading. Please re-attach and send it again.`
      );
    }
  };

  // `flagsOverride`, when passed, is used instead of reading docDuplicates[idx]
  // from state — needed because a setTimeout-deferred call (see resolveDocDuplicate)
  // still closes over whatever docDuplicates looked like at the moment the
  // enclosing render created this function, which can be a render *before* the
  // setDocDuplicates update that resolved the flag. Passing the just-computed
  // array directly sidesteps that stale-closure read entirely.
  const applyEdits = async (idx: number, edits: AiEdit[], flagsOverride?: DocDuplicateFlag[]) => {
    const msg = messages[idx];
    const srcs = msg?.sourceImages || (msg?.sourceImage ? [msg.sourceImage] : []);
    // Re-resolve the scan's owner at APPLY time too (not just parse time), so
    // re-applying an older card — whose stored edit predates the fix and has no
    // member — still files onto the person's Documents, not just the vault.
    const docEdits: DocEdit[] = edits
      .filter((e): e is DocEdit => e.kind === 'document')
      .map(e => {
        if (resolveMemberByName(e.member)) return e;
        const owner = inferDocOwner(e, edits);
        return owner ? { ...e, member: owner.name } : e;
      });

    // Check-then-commit: the first click (when this message hasn't been
    // checked yet) only checks for duplicates and, if any are found, stops
    // here so the user can resolve them — nothing is saved until they do.
    // `flags` stays a single local variable throughout so this never depends
    // on whether the setDocDuplicates state update has re-rendered yet.
    // A document edit is fileable when it carries its own stamped Storage URL,
    // even if the chat message has lost its images entirely — that is the whole
    // point of stamping. Chat attachments remain the fallback for older cards.
    const canFileDocs = srcs.length > 0 || docEdits.some(e => e.fileUrl);

    let flags: DocDuplicateFlag[] = flagsOverride ?? (docDuplicates[idx] || []);
    if (flagsOverride === undefined && docEdits.length && canFileDocs && !(idx in docDuplicates)) {
      setApplyingIdx(idx);
      try {
        flags = await checkDocDuplicates(docEdits, srcs);
        setDocDuplicates(prev => ({ ...prev, [idx]: flags }));
      } catch (e: any) {
        setError(e?.message || "Couldn't check for duplicates.");
        setApplyingIdx(null);
        return;
      }
      setApplyingIdx(null);
      if (flags.length) return; // wait for Replace/Keep-both on each flagged item
    }
    if (flags.length && flags.some(f => !f.resolution)) return; // still waiting on a choice

    setApplyingIdx(idx);
    try {
      // A recipe edit carries an optional photo of the original card/page —
      // upload it now (the model never supplies a URL itself) and stamp it
      // onto the edit before it flows into the normal dataEdits path. If the
      // photo is no longer available (e.g. after a reload), the recipe still
      // saves — just without its photo.
      let resolvedEdits = edits;
      if (srcs.length && edits.some(e => e.kind === 'recipe')) {
        try {
          const photoUrl = await uploadRecipePhoto(srcs[0].dataUrl);
          resolvedEdits = edits.map(e => (e.kind === 'recipe' ? { ...e, photoUrl } : e));
        } catch {
          // Non-fatal — recipe text below still gets saved without a photo.
        }
      }
      // A slip edit carries an optional photo of the receipt/till slip itself —
      // upload it now, same non-fatal pattern as the recipe photo above (thermal
      // till slips fade fast, so capturing the image is the point, but a failed
      // upload must not block saving the return/warranty dates the user gave).
      if (srcs.length && edits.some(e => e.kind === 'slip')) {
        try {
          const { url, storagePath } = await uploadSlipPhoto(srcs[0].dataUrl);
          resolvedEdits = resolvedEdits.map(e => (e.kind === 'slip' ? { ...e, photoUrl: url, photoStoragePath: storagePath } : e));
        } catch {
          // Non-fatal — slip text below still gets saved without a photo.
        }
      }

      // A cv edit can carry an attached CV photo/PDF ("here's Nomvula's CV").
      // File it onto the member's own Documents tab (same vault-upload path
      // fileScans uses, so it's a full-resolution Storage copy, not a
      // shrunk inline base64) and stamp the new document's id onto the edit's
      // fileDocumentId — the model itself never supplies this id. Only the
      // first attached image is used, same limitation the recipe-photo and
      // document-scan paths already have. Business-only (defense-in-depth —
      // the system prompt never offers this edit kind outside a business space).
      if (srcs.length && isBusinessSpace) {
        const cvEdit = resolvedEdits.find((e): e is Extract<AiEdit, { kind: 'cv' }> => e.kind === 'cv');
        const owner = cvEdit ? resolveMemberByName(cvEdit.member) : undefined;
        if (cvEdit && owner) {
          try {
            // attachmentToBlob, not dataUrlToBlob — after the send-time upload
            // this dataUrl is an https URL, which atob() turned into zero bytes.
            const blob = await attachmentToBlob(srcs[0]);
            const file = new File([blob], srcs[0].name, { type: srcs[0].mimeType });
            const hash = await computeFileHash(blob);
            const docId = newId();
            const { downloadUrl } = await uploadVaultFile(file, docId);
            await onAddMemberDoc(owner.id, {
              id: 'doc-' + docId,
              name: `${owner.name}'s CV`,
              category: 'Other',
              fileType: srcs[0].mimeType,
              fileName: srcs[0].name,
              fileSize: blob.size,
              uploadedAt: new Date().toISOString().slice(0, 10),
              fileData: downloadUrl,
              contentHash: hash,
            });
            resolvedEdits = resolvedEdits.map(e => (e.kind === 'cv' ? { ...e, fileDocumentId: 'doc-' + docId } : e));
          } catch {
            // Non-fatal — the structured CV fields below still get saved without the filed copy.
          }
        }
      }

      const dataEdits = resolvedEdits.filter(e => e.kind !== 'document');
      if (dataEdits.length) await onApplyEdits(dataEdits);
      if (docEdits.length && canFileDocs) {
        const resolutions: Record<number, DocDuplicateFlag> = {};
        flags.forEach(f => { resolutions[f.editIdx] = f; });
        await fileScans(docEdits, srcs, resolutions);
      } else if (docEdits.length && !canFileDocs) {
        // Image is stripped from persisted history — after a reload we can't
        // file the scan. Don't fail silently: the data edits applied, but the
        // user must re-attach the photo to store the document itself.
        setError('Your other changes were saved, but the photo itself is no longer in this chat (it was cleared when the app reloaded). Please re-attach the photo and send it again to file the document.');
      }
      setMessages(prev => {
        const updated = prev.map((m, i) => i === idx ? { ...m, applied: true } : m);
        // Persist the applied flag to cloud so the card stays "Applied" after a
        // reload or on another device — otherwise the Apply button reappears.
        if (uid) saveChatHistory(uid, slimForCloud(updated));
        return updated;
      });
    } catch (e: any) {
      setError(e?.message || "Couldn't save those changes.");
    } finally {
      setApplyingIdx(null);
    }
  };

  const resolveDocDuplicate = (idx: number, editIdx: number, resolution: 'replace' | 'keep', edits: AiEdit[]) => {
    setDocDuplicates(prev => {
      const updated = (prev[idx] || []).map(f => f.editIdx === editIdx ? { ...f, resolution } : f);
      // Once every flagged doc has a choice, auto-commit — no need for a
      // second manual Apply click. Deferred so this state update flushes first.
      if (updated.length && updated.every(f => f.resolution)) {
        setTimeout(() => applyEdits(idx, edits, updated), 0);
      }
      return { ...prev, [idx]: updated };
    });
  };

  const dismissEdits = (idx: number) => {
    setMessages(prev => prev.map((m, i) => i === idx ? { ...m, edits: undefined } : m));
    setDocDuplicates(prev => { const next = { ...prev }; delete next[idx]; return next; });
  };

  return (
    <div className="overflow-hidden h-full flex flex-col font-sans">
      {/* Header — sits on the panel's .glass background, so it's tinted, not opaque */}
      <div className="p-4 sm:p-5 border-b border-cream-200 bg-cream-50/70 flex items-center gap-3">
        <div
          className="p-2.5 rounded-2xl text-white shrink-0"
          style={{ backgroundImage: 'linear-gradient(135deg, var(--color-clay-500), var(--color-clay-600))' }}
        >
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="min-w-0 hidden sm:block">
          <h2 className="font-display text-xl font-semibold text-ink-900">{isBusinessSpace ? 'Business assistant' : 'Family assistant'}</h2>
          <p className="text-[13px] text-ink-500 font-medium truncate">Ask, tell me a fact, or attach a document to scan.</p>
        </div>
        <h2 className="font-display text-lg font-semibold text-ink-900 sm:hidden">Assistant</h2>
        <button
          onClick={startNewChat}
          disabled={loading || messages.length === 0}
          className="btn-quiet text-xs px-3.5 py-2 ml-auto shrink-0 border border-cream-300 disabled:opacity-40"
          title="Clear the conversation and start fresh"
        >
          <MessageSquarePlus className="w-4 h-4" />
          <span>New chat</span>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 space-y-5">
            {!headsUpDismissed && headsUp.length > 0 && (
              <div className="w-full max-w-md rounded-2xl border border-cream-300 bg-white/70 overflow-hidden text-left shrink-0">
                <div className="px-4 py-2.5 border-b border-cream-200 flex items-center gap-2">
                  <CalendarClock className="w-4 h-4 text-clay-500 shrink-0" />
                  <span className="font-semibold text-[13px] text-ink-900">Heads-up</span>
                  <button
                    type="button"
                    onClick={dismissHeadsUp}
                    title="Dismiss for today"
                    className="ml-auto p-1 -mr-1 text-ink-400 hover:text-ink-700 rounded-lg"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="divide-y divide-cream-100">
                  {headsUp.map((n) => {
                    const Icon = n.icon;
                    const overdue = n.days != null && n.days < 0;
                    return (
                      <button
                        key={n.key}
                        type="button"
                        onClick={() => (n.view ? onGoView?.(n.view) : onGo?.(n.memberId, n.tab))}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-cream-50 transition-colors group"
                      >
                        <div className={`p-1.5 rounded-lg shrink-0 ${overdue ? 'bg-rosa-100 text-rosa-700' : 'bg-cream-200 text-ink-500'}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <span className="flex-1 text-[12.5px] text-ink-800 font-medium">{n.text}</span>
                        <ChevronRight className="w-4 h-4 text-ink-300 group-hover:text-ink-500 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="w-14 h-14 rounded-2xl bg-clay-50 text-clay-600 flex items-center justify-center">
              <Wand2 className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h3 className="font-display text-lg font-semibold text-ink-900">How can I help?</h3>
              <p className="text-[13px] text-ink-500 max-w-sm">
                {isBusinessSpace
                  ? 'Tell me a fact like “Rory’s residence permit expires in March”, ask “when does the team’s insurance renew?”, or 📎 attach an ID or contract and I\'ll read it and file it.'
                  : 'Tell me a fact like “Mia wears EU 30 shoes”, ask “when does Papa\'s passport expire?”, or 📎 attach a passport/certificate and I\'ll read it and file it.'}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-md">
              {suggestions.map(s => (
                <button key={s} onClick={() => send(s)} className="chip bg-cream-100 text-ink-600 border border-cream-300 hover:bg-cream-200 transition-colors">
                  {s}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-sm pt-1">
              {isBusinessSpace ? (
                <>
                  <button
                    onClick={() => send("Give me a quick check-up across the whole team: anything expired or expiring soon (passports, residence permits, visas, driver's licenses), and anything important that looks incomplete.")}
                    className="chip bg-clay-50 text-clay-700 border border-clay-200 hover:bg-clay-100 transition-colors px-3 py-1.5 text-[12px]"
                  >
                    📋 Team check-up
                  </button>
                  <button
                    onClick={() => send('What documents are missing for the team?')}
                    className="chip bg-clay-50 text-clay-700 border border-clay-200 hover:bg-clay-100 transition-colors px-3 py-1.5 text-[12px]"
                  >
                    📄 Missing documents
                  </button>
                  <button
                    onClick={() => send("What's coming up on the calendar in the next few weeks?")}
                    className="chip bg-clay-50 text-clay-700 border border-clay-200 hover:bg-clay-100 transition-colors px-3 py-1.5 text-[12px]"
                  >
                    📅 What's coming up
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => send("Give me a quick check-up across the whole family: anything expired or expiring soon (passports, residence permits, visas, driver's licenses), anyone missing a blood type or emergency contact, and anything important that looks incomplete.")}
                    className="chip bg-clay-50 text-clay-700 border border-clay-200 hover:bg-clay-100 transition-colors px-3 py-1.5 text-[12px]"
                  >
                    🩺 Family check-up
                  </button>
                  <button
                    onClick={() => send("Suggest birthday and Christmas gift ideas for each child, based on their likes, wishlist and current sizes.")}
                    className="chip bg-clay-50 text-clay-700 border border-clay-200 hover:bg-clay-100 transition-colors px-3 py-1.5 text-[12px]"
                  >
                    🎁 Gift ideas
                  </button>
                  <button
                    onClick={() => send("What's coming up on the family calendar in the next few weeks?")}
                    className="chip bg-clay-50 text-clay-700 border border-clay-200 hover:bg-clay-100 transition-colors px-3 py-1.5 text-[12px]"
                  >
                    📅 What's coming up
                  </button>
                </>
              )}
              {onOpenFunAvatar && (
                <button
                  onClick={onOpenFunAvatar}
                  className="chip bg-clay-50 text-clay-700 border border-clay-200 hover:bg-clay-100 transition-colors px-3 py-1.5 text-[12px]"
                >
                  🎨 Fun avatar
                </button>
              )}
            </div>
            <button
              onClick={() => setScannerOpen(true)}
              className="btn-primary mt-1"
            >
              <Camera className="w-4 h-4" />
              Scan a document
            </button>
          </div>
        )}

        {messages.map((m, i) => {
          const isStreamingThis = m.role === 'assistant' && streamWordCount !== null && i === messages.length - 1;
          const shownText = isStreamingThis
            ? m.text.trim().split(/\s+/).filter(Boolean).slice(0, streamWordCount!).join(' ')
            : m.text;
          return (
          <div key={i} className={`flex items-start gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-soft text-white ${m.role === 'user' ? 'bg-dusk-500' : ''}`}
              style={m.role === 'assistant' ? { backgroundImage: 'linear-gradient(135deg, var(--color-clay-500), var(--color-clay-600))' } : undefined}
            >
              {m.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>
            <div className={`max-w-[80%] space-y-2 ${m.role === 'user' ? 'items-end' : ''}`}>
              {(() => {
                const imgs = m.images || (m.image ? [m.image] : []);
                if (imgs.length === 0) return null;
                const thumb = (src: string, key?: number, small?: boolean) => looksLikePdf(src) ? (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setLightboxSrc(src)}
                    className={`flex items-center gap-2 rounded-2xl border border-cream-300 shadow-soft bg-white cursor-zoom-in ${small ? 'w-20 h-20 flex-col justify-center' : 'px-3 py-2.5'}`}
                  >
                    <FileText className={small ? 'w-6 h-6 text-rosa-600' : 'w-5 h-5 text-rosa-600'} />
                    <span className={`font-semibold text-ink-700 ${small ? 'text-[10px]' : 'text-[13px]'}`}>PDF</span>
                  </button>
                ) : (
                  <img
                    key={key}
                    src={src}
                    alt="attachment"
                    onClick={() => setLightboxSrc(src)}
                    className={small ? 'w-20 h-20 object-cover rounded-2xl border border-cream-300 shadow-soft cursor-zoom-in' : 'max-w-[180px] rounded-2xl border border-cream-300 shadow-soft cursor-zoom-in'}
                  />
                );
                if (imgs.length === 1) return thumb(imgs[0]);
                return (
                  <div className={`flex flex-wrap gap-1.5 ${m.role === 'user' ? 'justify-end' : ''}`}>
                    {imgs.map((src, k) => thumb(src, k, true))}
                  </div>
                );
              })()}
              <div
                className={`p-3 rounded-2xl text-[14px] leading-relaxed ${m.role === 'user' ? 'text-white rounded-tr-sm' : 'bg-white/80 border border-cream-200 text-ink-800 rounded-tl-sm'}`}
                style={m.role === 'user' ? { backgroundImage: 'linear-gradient(135deg, var(--color-clay-500), var(--color-clay-600))' } : undefined}
              >
                {shownText}
              </div>

              {m.edits && m.edits.length > 0 && (
                <div className="rounded-2xl border border-clay-200 bg-clay-50/70 p-3 space-y-2">
                  <p className="text-[12px] font-semibold text-clay-700 flex items-center gap-1.5">
                    <Wand2 className="w-3.5 h-3.5" /> I'd like to save these — apply?
                  </p>
                  <ul className="space-y-1">
                    {m.edits.map((e, j) => (
                      <li key={j} className="text-[13px] text-ink-700 flex items-start gap-1.5">
                        <span className="text-clay-400 mt-0.5">•</span>
                        <span>{describeEdit(e)}</span>
                      </li>
                    ))}
                  </ul>
                  {!m.applied && docDuplicates[i]?.some(f => !f.resolution) && (
                    <div className="space-y-2 pt-1">
                      {docDuplicates[i]!.filter(f => !f.resolution).map((f) => (
                        <div key={f.editIdx} className="p-2.5 rounded-xl bg-honey-50 border border-honey-200 space-y-1.5">
                          <p className="text-[12px] text-honey-800 flex items-start gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>
                              "{f.name}" looks like it may already be saved as "{f.match.doc.name}".
                              {f.match.confidence === 'probable' && ' Same filename and size.'}
                              {f.match.confidence === 'probable-type' && ' Looks like the same kind of document, just under a different name.'}
                            </span>
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => resolveDocDuplicate(i, f.editIdx, 'replace', m.edits!)}
                              className="btn-primary text-xs px-2.5 py-1 flex-1 justify-center"
                            >
                              Replace existing
                            </button>
                            <button
                              onClick={() => resolveDocDuplicate(i, f.editIdx, 'keep', m.edits!)}
                              className="btn-quiet text-xs px-2.5 py-1 flex-1 justify-center"
                            >
                              Keep both
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {m.applied ? (
                    <p className="text-[12px] font-semibold text-sage-700 flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" /> {t.ai_applied}
                    </p>
                  ) : (
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => applyEdits(i, m.edits!)}
                        disabled={applyingIdx === i || !!docDuplicates[i]?.some(f => !f.resolution)}
                        className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
                      >
                        {applyingIdx === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {t.btn_apply}
                      </button>
                      <button onClick={() => dismissEdits(i)} className="btn-quiet text-xs px-3 py-1.5">
                        <X className="w-3.5 h-3.5" /> {t.btn_cancel}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {m.warnings && m.warnings.length > 0 && (
                <div className="rounded-2xl border border-honey-200 bg-honey-50 p-3 space-y-1">
                  {m.warnings.map((w, j) => (
                    <p key={j} className="text-[12.5px] text-honey-800 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span>{w}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )})}

        {loading && (
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-xl text-white flex items-center justify-center shrink-0"
              style={{ backgroundImage: 'linear-gradient(135deg, var(--color-clay-500), var(--color-clay-600))' }}
            >
              <Bot className="w-4 h-4" />
            </div>
            <div className="p-3 rounded-2xl bg-white/80 border border-cream-200 rounded-tl-sm text-[13px] font-medium">
              <span className="anim-shimmer">{isScanning ? 'Reading the document…' : 'Thinking…'}</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-cream-200 bg-white/70">
        {error && <p className="text-[12px] text-rosa-700 mb-2">{error}</p>}

        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {attachments.map((att, k) => (
              <div key={k} className="flex items-center gap-2 p-2 rounded-xl bg-cream-100 border border-cream-300 w-fit max-w-full">
                {att.mimeType.startsWith('image/') ? (
                  <img src={att.dataUrl} alt="" className="w-8 h-8 rounded-lg object-cover border border-cream-300" />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-rosa-100 text-rosa-700 flex items-center justify-center"><FileText className="w-4 h-4" /></div>
                )}
                <span className="text-[12px] font-semibold text-ink-700 truncate max-w-[140px]">{att.name}</span>
                <button onClick={() => setAttachments(prev => prev.filter((_, i) => i !== k))} className="p-1 text-ink-400 hover:text-rosa-500 rounded-lg"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            {attachments.length < MAX_ATTACHMENTS && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={loading}
                title="Add another file or photo"
                className="w-9 h-9 rounded-xl border border-dashed border-cream-300 text-ink-400 hover:text-clay-600 hover:border-clay-300 flex items-center justify-center disabled:opacity-40"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 items-center">
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple onChange={onPickFile} className="hidden" />
          {SR && (
            <button
              type="button"
              onClick={toggleVoice}
              disabled={loading}
              title={listening ? 'Stop recording' : 'Speak your message'}
              className={`h-11 w-11 shrink-0 rounded-2xl border font-semibold text-sm transition-colors disabled:opacity-40 flex items-center justify-center ${
                listening
                  ? 'bg-rosa-500 text-white border-rosa-500 anim-pulse-soft'
                  : 'bg-white hover:bg-cream-100 text-ink-700 border-cream-300'
              }`}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            disabled={loading || attachments.length >= MAX_ATTACHMENTS}
            title="Scan a document with your camera"
            className="btn-quiet h-11 w-11 !p-0 shrink-0 disabled:opacity-40"
          >
            <Camera className="w-4 h-4" />
          </button>
          {typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.read === 'function' && (
            <button
              type="button"
              onClick={pasteFromClipboard}
              disabled={loading || attachments.length >= MAX_ATTACHMENTS}
              title="Paste a copied image or PDF from your clipboard"
              className="btn-quiet h-11 w-11 !p-0 shrink-0 disabled:opacity-40"
            >
              <ClipboardPaste className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={loading || attachments.length >= MAX_ATTACHMENTS}
            title={`Attach up to ${MAX_ATTACHMENTS} photos, PDFs or files at once — or paste a screenshot with Ctrl+V / Cmd+V. For Google Drive files, open the file in Drive and use File → Download first.`}
            className="btn-quiet h-11 px-3 shrink-0 disabled:opacity-40"
          >
            <Paperclip className="w-4 h-4" />
            <span className="hidden sm:inline">Attach</span>
          </button>
          <input
            type="text"
            placeholder={attachments.length > 0 ? 'Add a note, or just send to scan…' : 'Ask or tell me something…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPasteImage}
            disabled={loading}
            className="field flex-1 h-11"
          />
          <button type="submit" disabled={(!input.trim() && attachments.length === 0) || loading} className="btn-primary h-11 w-11 !p-0 shrink-0 disabled:opacity-40">
            <Send className="w-4 h-4" />
          </button>
        </form>
        <p className="text-[11px] text-ink-400 mt-2 text-center">
          {t.ai_hint.split('Ctrl+V').length > 1
            ? <>{t.ai_hint.split('Ctrl+V')[0]}<kbd className="px-1 py-0.5 bg-cream-200 rounded text-[10px] font-mono">Ctrl+V</kbd>{t.ai_hint.split('Ctrl+V')[1]}</>
            : t.ai_hint
          }
        </p>
      </div>

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} name="Chat attachment" />
      <DocumentScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onUse={onScanResult}
        title="Document Scanner"
      />
    </div>
  );
}

function describeEdit(e: AiEdit): string {
  if (e.kind === 'new_member') return `Add a new ${(e.role || 'family member').toLowerCase()}: ${e.name}${e.nickname ? ` “${e.nickname}”` : ''}`;
  if (e.kind === 'member') return `${e.member}: set ${e.field.replace(/_/g, ' ')} → “${e.value}”`;
  if (e.kind === 'passport') return `${e.member}: add ${e.country} passport ${e.number}${e.expiry ? ` (exp ${e.expiry})` : ''}`;
  if (e.kind === 'contact') return `Add contact ${e.name}${e.relation ? ` (${e.relation})` : ''}${e.phone ? ` · ${e.phone}` : ''}${e.birthdate ? ` · birthday ${e.birthdate}` : ''}`;
  if (e.kind === 'provider') return `Add ${(e.type || 'provider').toLowerCase()}: ${e.name}${e.specialty ? ` (${e.specialty})` : ''}${e.forMember ? ` — for ${e.forMember}` : ''}`;
  if (e.kind === 'number') return `Add number “${e.label}” → ${e.value}`;
  if (e.kind === 'document') return `Save the scan “${e.name}” to Documents (${e.category})${e.member ? ` + ${e.member}’s profile` : ''}`;
  if (e.kind === 'calendar_event') return `Add to calendar: “${e.title}” on ${e.date}${e.time ? ' at ' + e.time : ''}`;
  if (e.kind === 'list_add') return `Add to ${e.list}: ${Object.values(e.item).filter(Boolean).slice(0, 3).join(' · ')}`;
  if (e.kind === 'household_set') return `Set household ${e.field.replace(/([A-Z])/g, ' $1').toLowerCase()}: "${e.value}"`;
  if (e.kind === 'asset') return `Add asset: ${e.name}${e.category ? ` (${e.category})` : ''}`;
  if (e.kind === 'recipe') return `Save recipe “${e.title}”${e.tags?.length ? ` · ${e.tags.join(', ')}` : ''} (${(e.ingredients || []).length} ingredients, ${(e.steps || []).length} steps)`;
  if (e.kind === 'slip') return `File slip: ${e.item}${e.shop ? ` at ${e.shop}` : ''}${e.returnByDate ? ` · return by ${e.returnByDate}` : ''}`;
  if (e.kind === 'transit_pass') return `${e.member}: add travel pass “${e.name}”${e.validUntil ? ` (valid to ${e.validUntil})` : ''}`;
  if (e.kind === 'care_schedule') return `${e.member}: add ${e.careKind}${e.intervalMonths ? ` every ${e.intervalMonths} mo` : ''}${e.lastVisit ? ` (last ${e.lastVisit})` : ''}`;
  if (e.kind === 'saying') return `${e.member}: save a saying — “${e.text}”${e.said ? ` (${e.said})` : ''}`;
  if (e.kind === 'favorite_quote') return `${e.member}: save a favorite quote — “${e.text}”${e.source ? ` — ${e.source}` : ''}`;
  if (e.kind === 'family_word') return `Add family word: “${e.word}” — ${e.meaning}${e.coinedBy ? ` (${e.coinedBy})` : ''}`;
  if (e.kind === 'cv') {
    const parts = [
      e.roles?.length ? `${e.roles.length} role${e.roles.length === 1 ? '' : 's'}` : '',
      e.education?.length ? `${e.education.length} education entr${e.education.length === 1 ? 'y' : 'ies'}` : '',
      e.qualifications?.length ? `${e.qualifications.length} qualification${e.qualifications.length === 1 ? '' : 's'}` : '',
      e.skills?.length ? `${e.skills.length} skill${e.skills.length === 1 ? '' : 's'}` : '',
      e.languages?.length ? `${e.languages.length} language${e.languages.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(', ');
    return `${e.member}: update CV${parts ? ` — ${parts}` : ''}`;
  }
  if (e.kind === 'estate_record') return `Save ${e.docKind}${e.forMember ? ` for ${e.forMember}` : ''}${e.originalLocation ? ` — original at ${e.originalLocation}` : ''}`;
  if (e.kind === 'service_record') {
    const n = e.records?.length || 0;
    const tgt = e.plate || e.vehicle || e.vin || 'the vehicle';
    return `Add ${n} service record${n === 1 ? '' : 's'} to ${tgt}`;
  }
  return JSON.stringify(e);
}
