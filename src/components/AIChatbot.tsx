import React, { useState, useEffect, useRef } from 'react';
import { FamilyMember, VaultCategory, VaultDocument, FamilyDocument } from '../types';
import { auth } from '../lib/firebase';
import {
  loadFamilyInfo, loadHousehold, loadFinances, loadTimeline,
  loadDocuments, saveDocuments, uploadVaultFile, deleteVaultFile, loadCalendarEvents,
  loadChatHistory, saveChatHistory,
} from '../utils/db';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { useT } from '../i18n/LangContext';
import { compressImageToAvatar } from '../utils/imageCompress';
import ImageLightbox from './ImageLightbox';
import { looksLikePdf } from '../utils/fileType';
import { computeFileHash, findLikelyDuplicate, findLikelyDuplicateByType, DupMatch } from '../utils/documentDedup';
import {
  Sparkles, Send, Loader2, Check, X, Wand2, User, Bot, MessageSquarePlus,
  Paperclip, FileText, Image as ImageIcon, Mic, MicOff, AlertTriangle, Camera,
} from 'lucide-react';
import DocumentScannerModal, { ScannedFile } from './DocumentScannerModal';

// Web Speech API — may be undefined in unsupported browsers
const SR: any = (typeof window !== 'undefined')
  ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  : undefined;

const CHAT_KEY = 'assistant_chat_v1';
const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);

export type AiEdit =
  | { kind: 'new_member'; name: string; role?: string; nickname?: string; birthdate?: string }
  | { kind: 'member'; member: string; field: string; value: string }
  | { kind: 'passport'; member: string; country: string; number: string; expiry?: string }
  | { kind: 'contact'; name: string; relation?: string; phone?: string; email?: string; birthdate?: string }
  | { kind: 'provider'; name: string; type?: string; specialty?: string; practiceName?: string; phone?: string; afterHoursPhone?: string; email?: string; address?: string; forMember?: string }
  | { kind: 'number'; label: string; value: string }
  | { kind: 'document'; name: string; category: VaultCategory; member?: string; imageIndex?: number }
  | { kind: 'calendar_event'; title: string; date: string; time?: string; category?: string; memberNames?: string[] }
  | { kind: 'list_add'; list: 'vehicles' | 'pets' | 'utilities' | 'banks' | 'insurance' | 'benefits' | 'timeline' | 'shopping'; item: Record<string, string> }
  | { kind: 'asset'; name: string; category?: string; assignedMember?: string; make?: string; model?: string; serialNumber?: string; purchaseDate?: string; purchasePrice?: string; notes?: string }
  | { kind: 'household_set'; field: 'address' | 'doorCode' | 'wifiName' | 'wifiPassword' | 'garageCode'; value: string }
  | { kind: 'transit_pass'; member: string; name: string; operator?: string; cardNumber?: string; zone?: string; validFrom?: string; validUntil?: string; notes?: string }
  | { kind: 'care_schedule'; member: string; careKind: string; provider?: string; lastVisit?: string; intervalMonths?: number; nextDue?: string; notes?: string }
  | { kind: 'saying'; member: string; text: string; said?: string; context?: string }
  | { kind: 'family_word'; word: string; meaning: string; coinedBy?: string; approxDate?: string };

interface Attachment { name: string; mimeType: string; dataUrl: string; }

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
  images?: string[];          // dataUrl previews on a user message (stripped from storage)
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

export default function AIChatbot({ members, onApplyEdits, onAddMemberDoc, isBusinessSpace, onOpenFunAvatar }: Props) {
  const { uid } = useFamilyCtx();
  const { lang, t } = useT();
  const suggestions = buildSuggestions(members, isBusinessSpace);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const raw = localStorage.getItem(CHAT_KEY);
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
  }, [uid]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, streamWordCount]);

  // Strip heavy/base64 fields (image(s), sourceImage(s)) before persisting;
  // keep edits + applied so cards restore their applied state.
  const slimForCloud = (msgs: ChatMessage[]) =>
    msgs.map(({ image, images, sourceImage, sourceImages, ...m }) => m);

  // Persist the conversation (minus heavy image data) on this device.
  useEffect(() => {
    try {
      const slim = slimForCloud(messages.slice(-60));
      localStorage.setItem(CHAT_KEY, JSON.stringify(slim));
    } catch { /* ignore */ }
  }, [messages]);

  const startNewChat = () => {
    stopStreaming();
    setMessages([]);
    setError(null);
    setInput('');
    setAttachments([]);
    try { localStorage.removeItem(CHAT_KEY); } catch { /* ignore */ }
    if (uid) saveChatHistory(uid, []);
  };

  const buildContext = async () => {
    const [info, household, finances, timeline, docs, events] = await Promise.all([
      loadFamilyInfo(), loadHousehold(), loadFinances(), loadTimeline(), loadDocuments(), loadCalendarEvents(),
    ]);
    const documents = (docs || []).map(d => ({ name: d.name, category: d.category, memberId: d.memberId, uploadedAt: d.uploadedAt }));
    return { members: slimMembers(members), info, household, finances, timeline, documents, calendar: events || [], isBusinessSpace: !!isBusinessSpace };
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
    setMessages(prev => [...prev, { role: 'user', text: msg || fallbackText, images: atts.length ? atts.map(a => a.dataUrl) : undefined }]);
    setLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Please sign in first.');
      const token = await user.getIdToken();
      const context = await buildContext();

      const body: any = { message: msg, context, history, lang };
      if (atts.length) body.images = atts.map(a => ({ mimeType: a.mimeType, data: a.dataUrl.split(',')[1] }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'The assistant is unavailable right now.');

      const rawEdits: AiEdit[] = Array.isArray(data.edits) ? data.edits : [];
      // Backfill the owner on scanned documents so the preview shows "+ <name>'s
      // profile" and Apply files onto the person, even when the AI left it blank.
      const edits: AiEdit[] = rawEdits.map(e => {
        if (e.kind !== 'document') return e;
        const owner = inferDocOwner(e, rawEdits);
        return owner ? { ...e, member: owner.name } : e;
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
        sourceImages: atts.length ? atts : undefined,
        warnings: warnings.length ? warnings : undefined,
      };
      setMessages(prev => {
        const updatedMessages = [...prev, assistantMsg];
        if (uid) saveChatHistory(uid, slimForCloud(updatedMessages));
        return updatedMessages;
      });
      startStreaming(assistantMsg.text);
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
      const src = srcs[e.imageIndex ?? 0] || srcs[0];
      if (!src) continue;
      const blob = dataUrlToBlob(src.dataUrl);
      const hash = await computeFileHash(blob);
      const ownerId = resolveMemberByName(e.member)?.id;
      const sameSlot = existing.filter((d) => d.category === e.category && (d.memberId || '') === (ownerId || ''));
      const match = findLikelyDuplicate({ fileName: src.name, fileSize: blob.size, contentHash: hash }, existing)
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
    if (!srcs.length) return;
    let existing = await loadDocuments();
    const today = new Date().toISOString().slice(0, 10);
    const by = auth.currentUser?.displayName || auth.currentUser?.email || 'Family';
    const added: VaultDocument[] = [];

    for (let i = 0; i < docEdits.length; i++) {
      const e = docEdits[i];
      const src = srcs[e.imageIndex ?? 0] || srcs[0];
      const blob = dataUrlToBlob(src.dataUrl);
      const file = new File([blob], src.name, { type: src.mimeType });
      const hash = await computeFileHash(blob);

      const flag = resolutions[i];
      if (flag?.resolution === 'replace') {
        try { await deleteVaultFile(flag.match.doc.storagePath); } catch (err) { console.error('Replace: old file delete failed (removing metadata anyway):', err); }
        existing = existing.filter(d => d.id !== flag.match.doc.id);
      }

      const id = newId();
      const { storagePath, downloadUrl } = await uploadVaultFile(file, id);
      added.push({
        id, name: e.name, category: e.category,
        fileName: src.name, fileType: src.mimeType, fileSize: blob.size,
        storagePath, downloadUrl, uploadedAt: today, uploadedBy: by, contentHash: hash,
      });

      // Also file on the member's profile when the doc names its owner. Store the
      // Storage download URL (not the base64 image) so the member's Firestore doc
      // stays tiny and can never blow the 1 MiB limit — it renders the same, since
      // MemberDocuments/DocumentViewer use fileData directly as an <img src>.
      const owner = resolveMemberByName(e.member);
      if (owner) {
        await onAddMemberDoc(owner.id, {
          id: 'doc-' + id,
          name: e.name,
          category: MEMBER_DOC_CAT[e.category] || 'Other',
          fileType: src.mimeType,
          fileName: src.name,
          fileSize: blob.size,
          uploadedAt: today,
          fileData: downloadUrl,
          contentHash: hash,
        });
      }
    }
    if (added.length) await saveDocuments([...added, ...existing]);
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
    let flags: DocDuplicateFlag[] = flagsOverride ?? (docDuplicates[idx] || []);
    if (flagsOverride === undefined && docEdits.length && srcs.length && !(idx in docDuplicates)) {
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
      const dataEdits = edits.filter(e => e.kind !== 'document');
      if (dataEdits.length) await onApplyEdits(dataEdits);
      if (docEdits.length && srcs.length) {
        const resolutions: Record<number, DocDuplicateFlag> = {};
        flags.forEach(f => { resolutions[f.editIdx] = f; });
        await fileScans(docEdits, srcs, resolutions);
      } else if (docEdits.length && !srcs.length) {
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
  if (e.kind === 'transit_pass') return `${e.member}: add travel pass “${e.name}”${e.validUntil ? ` (valid to ${e.validUntil})` : ''}`;
  if (e.kind === 'care_schedule') return `${e.member}: add ${e.careKind}${e.intervalMonths ? ` every ${e.intervalMonths} mo` : ''}${e.lastVisit ? ` (last ${e.lastVisit})` : ''}`;
  if (e.kind === 'saying') return `${e.member}: save a saying — “${e.text}”${e.said ? ` (${e.said})` : ''}`;
  if (e.kind === 'family_word') return `Add family word: “${e.word}” — ${e.meaning}${e.coinedBy ? ` (${e.coinedBy})` : ''}`;
  return JSON.stringify(e);
}
