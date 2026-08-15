import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { FamilyMember, VaultCategory, VaultDocument, FamilyDocument, Vehicle, SlipItem, AiUsage, ReferralKind, ReferralRecord, DocReadResult, DocPassage } from '../types';
import { readDocument, EXPECTED_READER_VERSION } from '../utils/docReader';
import { auth } from '../lib/firebase';
import {
  loadFamilyInfo, loadHousehold, loadFinances, loadTimeline,
  loadDocuments, saveDocuments, uploadVaultFile, deleteVaultFile, loadCalendarEvents,
  loadChatHistory, saveChatHistory, uploadChatAttachment, uploadRecipePhoto, loadSpaceInfo, uploadSlipPhoto,
  uploadChatAttachmentWithPath, loadSlips, isHintSeen, markHintSeen, loadAiUsage, loadSettings,
  loadAssets, uploadAssetPhoto,
} from '../utils/db';
import { computeChatInsights } from '../utils/chatInsights';
import { redactHousehold, redactFinances, redactMember, redactInfoNumbers } from '../utils/aiRedact';
// Edit/delete-existing-records feature: display labels + apply-time re-resolution
// live here (this shared component only gets append-only wiring).
import { annotateDestructiveEdits } from '../utils/aiDestructive';
import { PackRequest, resolveTopics } from '../utils/exportPack';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { useT } from '../i18n/LangContext';
import { compressImageToAvatar } from '../utils/imageCompress';
import ImageLightbox from './ImageLightbox';
import { looksLikePdf } from '../utils/fileType';
import { computeFileHash, findLikelyDuplicate, findLikelyDuplicateByType, DupMatch } from '../utils/documentDedup';
import {
  Sparkles, Send, Loader2, Check, X, Wand2, User, Bot, MessageSquarePlus,
  Paperclip, FileText, Image as ImageIcon, Mic, MicOff, AlertTriangle, Camera,
  ClipboardPaste, ChevronRight, CalendarClock, Undo2, ChevronDown, ScanLine,
  FolderDown, MessageCircleQuestion, Quote, RefreshCw,
} from 'lucide-react';
import DocumentAskModal, { type DocumentAskModalDoc } from './DocumentAskModal';
import type { ScannedFile } from './DocumentScannerModal';
// Lazy: this camera-UI component pulls in jsPDF (page-compile) — deferring it
// keeps that weight out of every chat-panel load for the majority of visits
// that never touch the scanner (only mounted once scannerEverOpened, below).
const DocumentScannerModal = React.lazy(() => import('./DocumentScannerModal'));
import { speechLocaleFor } from '../utils/speechLocale';
import { UndoRecord, landingLabel, countIrreversibleEdits } from '../utils/aiUndo';

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
// Scoped by PERSON as well as space, mirroring the cloud copy at
// families/{familyId}/chat/{uid}. Space alone isn't enough: a household shares
// a tablet, and a space-only key would hand whoever signs in next the previous
// person's conversation — including its un-applied edit cards. 'none' is the
// bucket used while either id is still resolving.
// 'family_' prefix is load-bearing, not decorative: lib/firebase.ts's
// logout() sweeps every localStorage key starting with 'family_' so a
// different account signing in on the same device never inherits stale
// data. Without this prefix, a Business Hub user who visited several spaces
// in one session would leave every space's chat transcript — including any
// un-applied AI edit cards referencing that space's members/documents —
// resident on the device indefinitely after signing out.
const chatKey = (familyId: string | null, uid: string | null) =>
  `family_assistant_chat_v2_${familyId || 'none'}_${uid || 'none'}`;
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
  /* A filed document. When it is a referral, imaging request, lab result,
   * specialist letter or sick note, the referral* fields below are also set and
   * it is filed into Referrals & Results as well.
   *
   * Deliberately extra fields on `document` rather than a separate edit kind.
   * The document path already owns uploading, de-duplication, owner inference
   * and the partial-failure reporting — all the places this feature has been
   * bitten before. A parallel kind would have to reimplement every one of them,
   * and a referral IS a document; it just belongs in one more list. */
  | { kind: 'document'; name: string; category: VaultCategory; member?: string; imageIndex?: number; fileUrl?: string; fileStoragePath?: string; fileName?: string; fileMimeType?: string; fileSize?: number; contentHash?: string;
      referralKind?: ReferralKind | string; referralDate?: string; referralReason?: string; referralProvider?: string }
  | { kind: 'calendar_event'; title: string; date: string; time?: string; category?: string; memberNames?: string[] }
  | { kind: 'list_add'; list: 'vehicles' | 'pets' | 'utilities' | 'banks' | 'insurance' | 'benefits' | 'timeline' | 'shopping'; item: Record<string, string> }
  | { kind: 'asset'; name: string; category?: string; assignedMember?: string; make?: string; model?: string; serialNumber?: string; purchaseDate?: string; purchasePrice?: string; notes?: string; photoUrl?: string }  // photoUrl is filled client-side after Apply, from an attached photo — never sent by the model
  | { kind: 'recipe'; title: string; ingredients: string[]; steps: string[]; tags?: string[]; photoUrl?: string }  // photoUrl is filled client-side after Apply — never sent by the model
  | { kind: 'slip'; shop?: string; item: string; purchaseDate?: string; amount?: string; currency?: string; assignedTo?: string; returnByDate?: string; warrantyUntil?: string; notes?: string; photoUrl?: string; photoStoragePath?: string }  // a purchase receipt/till slip — photoUrl/photoStoragePath are filled client-side after Apply — never sent by the model
  | { kind: 'household_set'; field: 'address' | 'doorCode' | 'wifiName' | 'wifiPassword' | 'garageCode'; value: string }
  | { kind: 'transit_pass'; member: string; name: string; operator?: string; cardNumber?: string; zone?: string; validFrom?: string; validUntil?: string; notes?: string }
  | { kind: 'care_schedule'; member: string; careKind: string; provider?: string; lastVisit?: string; intervalMonths?: number; nextDue?: string; notes?: string }
  | { kind: 'saying'; member: string; text: string; said?: string; context?: string }
  /* One jab. Its own kind rather than fields on `document`, because the useful
   * case is a vaccination CARD or booklet — one photo listing many jabs across
   * many years. Those become several records off a single scan, so they cannot
   * ride on one document edit the way a referral does. */
  | { kind: 'vaccination'; member: string; name: string; date?: string; notes?: string }
  /* A visa or residence permit. The third section found to be unreachable by the
   * assistant — after referrals and vaccinations — and the first one a test
   * caught rather than a user. A permit sticker is one of the highest-stakes
   * expiry dates a family has; being unable to file it from a scan was the worst
   * of the three gaps. */
  | { kind: 'visa'; member: string; country: string; number?: string; expiryDate?: string; permitType?: string; issuingAuthority?: string; sponsor?: string; conditions?: string; notes?: string }
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
  // Who takes over, and the instructions for whoever finds this. Store-and-recall
  // only, exactly like estate_record — the assistant records the stated intent and
  // never advises on it. Whether the named successor can actually sign in is
  // COMPUTED from the live roles collection at render time (utils/successor.ts),
  // never taken from what the AI wrote here.
  | { kind: 'designated_successor'; name: string; whatTheyShouldDo?: string }
  | { kind: 'emergency_instructions'; keysAndSafes?: string; letter?: string;
      notifyContacts?: { name: string; relation?: string; phone?: string; email?: string; notes?: string }[];
      accountsToClose?: { name: string; accountRef?: string; notes?: string }[] }
  // Append one or more service/repair records — read from a service booklet,
  // workshop invoice, or stamped maintenance page — onto an EXISTING vehicle's
  // serviceLog. The vehicle is matched (client-side, in aiApply) by VIN, then
  // registration plate, then name. Store-and-recall only: records exactly what
  // the document shows, never an interpretation ("overdue"/"you must…").
  | { kind: 'service_record'; vehicle?: string; plate?: string; vin?: string; records: { date: string; work: string; odometer?: string; cost?: string; garage?: string; notes?: string }[] }
  // The one-line family status — the fridge whiteboard (HubSettings.status).
  // REPLACES the existing line, exactly like household_set; never appends.
  | { kind: 'hub_status'; text: string }
  // --- EDIT/DELETE existing records (confirm-before-destroy; see utils/aiDestructive.ts) ---
  // clear_field blanks ONE member field ("remove Papa's old phone"); it rides the
  // normal member-edit path (aiApply.applyMemberEdits) so it can only ever touch a
  // whitelisted field, never a whole record.
  | { kind: 'clear_field'; member: string; field: string }
  // delete_record / update_record target an EXISTING record by its stable context
  // id. `label` is stamped CLIENT-SIDE (annotateDestructiveEdits) for the Apply
  // card — the model never supplies it — and apply RE-RESOLVES the id against live
  // data, never trusting a stale id/label from chat history.
  | { kind: 'delete_record'; targetKind: string; id: string; label?: string }
  | { kind: 'update_record'; targetKind: string; id: string; fields: Record<string, string>; label?: string };

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
  /* A folder the assistant offered to prepare — "all Sophie's medical reports
   * and results". Deliberately NOT an AiEdit: every edit WRITES something and
   * rides the Apply pipeline, and an export writes nothing at all. Giving it
   * the same card would mean an "Apply" button that changes no data, and an
   * Undo that has nothing to undo. See utils/exportPack.ts. */
  exportRequest?: PackRequest;
  /* A document the assistant offered to READ, and the phrase to search it for.
   * Like exportRequest this is not an AiEdit — it writes nothing. It is a
   * pointer plus a search term, never any of the document's text: the chat
   * model has no access to document contents and must not, because it can write
   * to the vault and a lease is prose a landlord wrote. Tapping it runs the
   * separate, read-only /api/doc-read. See sanitizeReadDoc in server.js. */
  readDoc?: { id: string; name: string; question: string };
  /* The document read that belongs to THIS message, rendered inline below it.
   *
   * Deliberately never persisted: patchRead() updates state without touching
   * saveChatHistory, so passages from a lease never reach the stored chat
   * history. They are cheap to fetch again and expensive to leak — the whole
   * design keeps document text out of everything the chat model can see, and
   * writing it into the history that gets replayed into that model would undo
   * exactly that. Reopening an old conversation shows the question and the
   * Read button, not the clauses. */
  readKey?: string;          // stable handle for patching this message as the read progresses
  readPending?: boolean;
  readResult?: DocReadResult;
  readError?: string;
  applied?: boolean;
  image?: string;             // legacy single dataUrl preview — kept for messages persisted before multi-attach
  images?: string[];          // dataUrl previews on a user message — swapped to Storage URLs once uploaded, see send()
  sourceImage?: Attachment;   // legacy single source — kept for messages persisted before multi-attach
  sourceImages?: Attachment[]; // carried on the assistant message so 'document' edits can file the right scan
  warnings?: string[];        // client-side safety-net notices (e.g. a likely-missed passport record) — display only, never persisted server-side
  undo?: UndoRecord[];        // ids of the records THIS apply created (captured at Apply time) — lets "Undo" delete exactly them and flip the card back to un-applied
}

/**
 * The chat bubble shown whenever a document is about to be read — written here,
 * in the app, never by the model. See where it is used in send().
 *
 * Every word of it is checked against one rule: it must not imply anything
 * about what the document contains, in either direction. "Here's what your
 * lease says about repairs" quietly promises a passage exists, and when none is
 * found the sheet that opens a second later contradicts the sentence above it.
 * The honest claim is only ever about what the APP is doing — searching a named
 * file for a named phrase — and about whose words the answer will be.
 */
function readingLine(readDoc: { name: string; question: string }): string {
  const q = (readDoc.question || '').trim();
  return q
    ? `Reading “${readDoc.name}” for “${q}” now — you'll see the document's own wording, not mine.`
    : `Opening “${readDoc.name}” and searching it now — you'll see the document's own wording, not mine.`;
}

/**
 * The same line once the read has finished.
 *
 * The message text is written once, when the read STARTS, and never patched —
 * so without this every completed read says "reading it now" for the rest of
 * the conversation's life. On a message from a previous session that is worse
 * than untidy: it reads as though the answer below is being produced this
 * second, which is exactly the wrong thing to believe about a stored one.
 *
 * Past tense is the only change. The same rule applies as above: it may say
 * what the APP did, never anything about what the document turned out to
 * contain — a hint either way here would be contradicted by the passages a
 * centimetre below it.
 */
/**
 * A read that was in flight when the app last closed is DEAD, not pending.
 *
 * readPending is persisted with the rest of the message, and nothing restarts
 * the read on restore — so a conversation reopened after the app was closed
 * (or the tab killed, or the phone's PWA evicted) mid-read comes back with a
 * spinner that spins for ever and no way out of it. That is literally what
 * "it does this and never comes back" looks like, and it survives every
 * reload because the stuck state is what gets saved again.
 *
 * The read itself is cheap to redo and its result was deliberately never
 * stored, so the honest restored state is "interrupted, try again" — which is
 * also the only state with a button on it.
 */
function revivePendingReads<T extends { readPending?: boolean; readResult?: unknown }>(msgs: T[]): T[] {
  return msgs.map((m) => (m.readPending && !m.readResult
    ? { ...m, readPending: false, readError: 'INTERRUPTED' }
    : m));
}

/** Sentinel for the state above — replaced with real prose at render time so
 *  the stored transcript never carries a UI string. */
const READ_INTERRUPTED = 'INTERRUPTED';

function readDoneLine(readDoc: { name: string; question: string }): string {
  const q = (readDoc.question || '').trim();
  return q
    ? `Looked through “${readDoc.name}” for “${q}” — below is the document's own wording, not mine.`
    : `Searched “${readDoc.name}” — below is the document's own wording, not mine.`;
}

/* How many passages the conversation shows before deferring to the full sheet.
 * A chat bubble is a poor place to scroll through nine clauses, and the sheet
 * exists precisely for that. Three is enough to answer most questions outright;
 * the count of what is left is always stated, never quietly dropped. */
const INLINE_PASSAGE_LIMIT = 3;
/* Same reasoning as the sheet's cap: on the screen where someone decides
 * whether to believe "it isn't in there", fifty German stems read as flailing
 * and make the claim less credible, not more. */
const INLINE_TERMS_PREVIEW = 6;

const pageList = (pages: number[]): string =>
  pages.length <= 2 ? pages.join(' and ') : `${pages.slice(0, -1).join(', ')} and ${pages[pages.length - 1]}`;

/**
 * The document's own words, in the conversation.
 *
 * Everything rendered here is either a slice the server cut out of text this
 * browser extracted, or a fixed string written in this file. Nothing the chat
 * model wrote appears in it — that is what makes "Teluva quotes, it does not
 * advise" a property of the code rather than a promise about a model.
 */
function InlineDocAnswer({ msg, onAskAgain, onRetryRead }: {
  msg: ChatMessage;
  onAskAgain?: () => void;
  onRetryRead?: () => void;
}) {
  if (msg.readPending) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-cream-200 bg-white/70 px-3.5 py-3 text-[13px] text-ink-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-sage-600" />
        Reading {msg.readDoc?.name || 'the document'}…
      </div>
    );
  }

  if (msg.readError) {
    const interrupted = msg.readError === READ_INTERRUPTED;
    return (
      <div className="rounded-2xl border border-rosa-200 bg-rosa-50 px-3.5 py-3 space-y-2">
        <p className="text-[13px] leading-relaxed text-rosa-800">
          {interrupted
            ? `This read didn't finish — the app closed before “${msg.readDoc?.name || 'the document'}” came back.`
            : msg.readError}
        </p>
        {/* Every failed read now has a way forward. Without this the message is
            a dead end: the answer is not there, and nothing on screen can go
            and get it. */}
        {onRetryRead && (
          <button
            type="button"
            onClick={onRetryRead}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rosa-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-rosa-700 cursor-pointer hover:bg-rosa-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Try reading it again
          </button>
        )}
      </div>
    );
  }

  const result = msg.readResult;
  if (!result) return null;

  /* This answer came out of an older reader.
   *
   * Chat messages are stored whole, so every reader result ever produced is
   * still on screen somewhere above, rendered by today's code and therefore
   * indistinguishable from an answer given a second ago. The cost is not
   * cosmetic: it is scrolling back, seeing the answer that prompted a fix, and
   * concluding the fix didn't work — or acting on a worse answer than the app
   * would give now. So say which it is, and where the current one lives.
   *
   * Absent-means-old is safe: the stamp is sent on every response, so the only
   * way to have none is to predate it. */
  const stale = (result.readerVersion ?? 0) < EXPECTED_READER_VERSION;

  /* The read fell back to a keyword sweep. Say so, ABOVE the passages — the
   * whole failure was that this state looked exactly like a good answer. */
  const degradedNote = result.degraded ? (
    <div className="rounded-2xl border border-honey-200 bg-honey-50 px-3.5 py-2.5 space-y-2">
      <p className="text-[12.5px] leading-relaxed text-honey-900">
        This one timed out before it could work through the whole document, so below is what a
        plain word search turned up — real wording from your document, but not sorted by what you
        asked, and with no summary. Trying again usually gets the full read.
      </p>
      {onRetryRead && (
        <button
          type="button"
          onClick={onRetryRead}
          className="inline-flex items-center gap-1.5 rounded-xl border border-honey-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-honey-900 cursor-pointer hover:bg-honey-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Read it properly
        </button>
      )}
    </div>
  ) : null;

  const { coverage } = result;
  const unread = coverage.pagesWithoutText;
  // Surfaced passages only. The set-aside ones still travel in the payload and
  // are shown in the full sheet — putting them in the conversation unlabelled
  // would present text the reader decided was NOT about this question as though
  // it were the answer.
  const surfaced = result.passages.filter((p: DocPassage) => p.surfaced !== false);
  // Pick by relevance, then read in document order. Slicing the
  // document-ordered list would let page 1 fill every slot on a lease whose
  // substance is on pages 7 and 8 — see DocPassage.rank.
  const shown = [...surfaced]
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .slice(0, INLINE_PASSAGE_LIMIT)
    .sort((a, b) => a.page - b.page || a.charStart - b.charStart);
  const moreCount = surfaced.length - shown.length;

  const terms = result.searchedFor.slice(0, INLINE_TERMS_PREVIEW);
  const termsRest = result.searchedFor.length - terms.length;
  const termLine = terms.length
    ? `Searched for: ${terms.join(', ')}${termsRest > 0 ? `, and ${termsRest} more` : ''}.`
    : '';

  /* "Ask the same question again" was advice, and advice you have to act on by
   * scrolling, retyping and remembering exactly how you phrased it is advice
   * most people won't take — they'll read the old answer instead. The button
   * resends the question the PERSON typed, not readDoc.question: on a stale
   * result that field holds whatever the old reader was given, which on a
   * pre-v194 bubble is the single keyword that caused the bad answer. */
  const staleNote = stale ? (
    <div className="rounded-2xl border border-cream-300 bg-cream-100 px-3.5 py-2.5 space-y-2">
      <p className="text-[12.5px] leading-relaxed text-ink-600">
        This was answered by an earlier version of the reader — it&rsquo;s kept here as a record of the
        conversation. The reader has changed since; ask again for what it would say today.
      </p>
      {onAskAgain && (
        <button
          type="button"
          onClick={onAskAgain}
          className="inline-flex items-center gap-1.5 rounded-xl border border-sage-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-sage-700 cursor-pointer hover:bg-sage-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Ask this again
        </button>
      )}
    </div>
  ) : null;

  if (shown.length === 0) {
    // A FIXED TEMPLATE, and the most important text in this component.
    //
    // "Your lease doesn't mention that" is the single most damaging sentence
    // this feature could produce, and it is the DEFAULT output of every
    // extraction gap, missed synonym and image-only page. So nothing here is
    // allowed to say it: the claim is about the search, never about the
    // document, and any page we failed to read is named out loud.
    return (
      <div className="space-y-2">
        {staleNote}
        {degradedNote}
        <div className="rounded-2xl border border-honey-200 bg-honey-50 px-3.5 py-3 space-y-2">
          <p className="text-[13.5px] font-semibold text-ink-900">No passage matched those words.</p>
          <p className="text-[13px] leading-relaxed text-ink-700">
            That doesn&rsquo;t mean the document doesn&rsquo;t cover it — wording, scan quality and
            search terms all affect this. {termLine}
          </p>
          {unread.length > 0 && (
            <p className="text-[13px] leading-relaxed text-honey-900">
              I also couldn&rsquo;t read {unread.length === 1 ? 'page' : 'pages'} {pageList(unread)} at
              all, so I can&rsquo;t tell you it isn&rsquo;t in {unread.length === 1 ? 'that one' : 'those'}.
            </p>
          )}
          {unread.length === 0 && !coverage.verifiable && (
            <p className="text-[13px] leading-relaxed text-honey-900">
              This was read as an image rather than as text, so a word the reader missed would look
              exactly like a word that isn&rsquo;t there.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {staleNote}
      {degradedNote}
      {result.answer && (
        // The answer, and the only place in this component where a sentence
        // someone reads was written by a model rather than sliced out of their
        // document. It is rendered FIRST because it is what was asked for, and
        // the quotes it was built from are directly below it — which is the
        // whole arrangement: a claim and its source on one screen, so the
        // reader can check the interesting sentence against the German.
        <div className="rounded-2xl border border-sage-200 bg-sage-50 px-3.5 py-3 space-y-1.5">
          <p className="text-[13.5px] leading-relaxed text-ink-900 whitespace-pre-wrap">{result.answer}</p>
          <p className="text-[11.5px] leading-relaxed text-ink-500">
            From the parts of your document below — check them before you act on this.
          </p>
          {!coverage.verifiable && (
            // A FIXED template, not a request to the model. The answer above is
            // prose, and prose can drift into "your lease doesn't cover that" —
            // the one claim that cannot be true of a document read off
            // photographs, where a handwritten figure or a blank in a printed
            // form is invisible. The model is told not to; this says it anyway,
            // in words that live in the codebase and cannot drift.
            <p className="text-[11.5px] leading-relaxed text-honey-900">
              This was read from images of the pages, so I can tell you what I found — never that
              something isn&rsquo;t in there. Handwriting and blanks in a printed form often don&rsquo;t
              come through.
            </p>
          )}
        </div>
      )}
      {result.related && (
        // Nothing contained the words the user typed; these clauses are on
        // screen because they are ABOUT what was asked. Saying which of the two
        // happened is not a detail — a related clause presented as a match is
        // how someone ends up believing a lease says something it does not.
        <p className="text-[13px] leading-relaxed text-ink-600 px-0.5">
          Nothing in this document uses those words. These parts are about the same thing —
          read them yourself before relying on them.
        </p>
      )}
      {shown.map((p: DocPassage, i: number) => (
        <div key={i} data-copy-scan="1" className="rounded-2xl border border-cream-300 bg-cream-50 px-3.5 py-3 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="chip bg-sage-100 text-sage-700">{p.topic}</span>
            <span className="chip bg-cream-200 text-ink-600 tabular-nums">page {p.page}</span>
            {!coverage.verifiable && <span className="chip bg-honey-100 text-honey-800">read from an image</span>}
            {!p.matchedSearch && (
              // Honest attribution of why this is on screen: the deterministic
              // sweep did not find it, so a model chose it. A different level of
              // trust, said out loud rather than blended in with the rest.
              <span className="chip bg-cream-200 text-ink-500">nearby, not a direct match</span>
            )}
          </div>
          {p.translation && (
            // The translation goes ABOVE the original, because for a reader who
            // does not speak the document's language the original is evidence
            // rather than information — but it stays on screen, in full, so the
            // translation is checkable rather than a replacement.
            <p className="text-[13.5px] leading-relaxed text-ink-800">{p.translation}</p>
          )}
          <div className="flex gap-2">
            <Quote className="w-3.5 h-3.5 text-ink-300 shrink-0 mt-1" />
            <p className={`text-[13.5px] leading-relaxed whitespace-pre-wrap ${p.translation ? 'text-ink-500 text-[12.5px]' : 'text-ink-800'}`}>{p.text}</p>
          </div>
        </div>
      ))}

      <p className="text-[12px] leading-relaxed text-ink-500">
        {msg.readDoc?.name ? `From ${msg.readDoc.name}. ` : ''}
        These are its own words — Teluva doesn&rsquo;t interpret them or give legal advice.
        {moreCount > 0 && ` ${moreCount} more ${moreCount === 1 ? 'passage' : 'passages'} matched — open the reader to see ${moreCount === 1 ? 'it' : 'them'}.`}
        {unread.length > 0 && ` I couldn't read ${unread.length === 1 ? 'page' : 'pages'} ${pageList(unread)}, so I can't speak for ${unread.length === 1 ? 'it' : 'them'}.`}
      </p>
    </div>
  );
}

interface Props {
  members: FamilyMember[];
  // Returns the undo manifest — ids of the non-document records this apply created — so the card can offer an exact reversal. (Older callers may still return void.)
  onApplyEdits: (edits: AiEdit[]) => Promise<UndoRecord[] | void>;
  // File a scanned document into a member's own Documents tab (in addition to the vault)
  onAddMemberDoc: (memberId: string, doc: FamilyDocument) => Promise<void>;
  /** Files a scanned referral / lab result / imaging request into Referrals & Results. */
  onAddReferral: (memberId: string, rec: ReferralRecord) => Promise<void>;
  isBusinessSpace?: boolean;
  /** Open the "fun avatar" generator for whichever profile is currently active. Omitted (no chip shown) when the caller can't use it (not admin, or nothing selected). */
  onOpenFunAvatar?: () => void;
  /** Open the confirm screen for a folder the assistant offered to prepare. */
  onPrepareExport?: (request: PackRequest) => void;
  /** Jump to a member's own profile tab — used by the heads-up card to make each item tappable. */
  onGo?: (memberId: string, tab: string) => void;
  /** Jump to a top-level view (e.g. 'vehicles', 'slips') — the view-nudge counterpart of onGo. */
  onGoView?: (view: string) => void;
  /** Delete exactly the records an earlier Apply created (its undo manifest), reversing that Apply. Returns how many were removed vs. not found. Omitted → no Undo control shown. */
  onUndoEdits?: (records: UndoRecord[]) => Promise<{ undone: number; missing: number }>;
  /** A pending draft (prefilled text + optional photo) from CopyableValue's "Scan"
      action elsewhere in the app — loaded into the composer on mount. This
      component only exists while AssistantBubble has it open, so "on mount" is
      exactly "whenever the panel that carries a fresh draft opens." */
  initialDraft?: { text: string; attachment?: { name: string; mimeType: string; dataUrl: string } } | null;
  /** Called once, right after initialDraft is applied, so the caller can clear
      it — otherwise a later plain open of the panel (no new scan) would replay it. */
  onDraftApplied?: () => void;
}

function slimMembers(members: FamilyMember[]) {
  return members.map(m => {
    const { avatarUrl, documents, digitalAccounts, favorites, growthHistory, referrals, ...rest } = m as any;
    return {
      // Government identity numbers (identifiers) and bank/routing numbers
      // (financialAccounts) were riding along inside ...rest — see aiRedact.ts
      // for exactly what goes and what deliberately stays.
      ...redactMember(rest),
      // id is included so the AI can reference a specific member document for delete_record.
      documents: (documents || []).map((d: any) => ({ id: d.id, name: d.name, category: d.category, uploadedAt: d.uploadedAt })),
      // NEVER send stored passwords to the AI; keep only what lets it answer "what accounts does X have"
      digitalAccounts: (digitalAccounts || []).map((a: any) => ({ service: a.service, username: a.username })),
      // Strip base64 wishlist images (huge + would truncate the whole context)
      favorites: (favorites || []).map((f: any) => ({ name: f.name, price: f.price, notes: f.notes })),
      // Keep only the latest growth entry — history is bulky and rarely asked
      growthHistory: (growthHistory || []).slice(-1),
      /* Referrals: the summary only, never the file.
       *
       * These were passing through untouched inside ...rest — redactMember only
       * strips identity and bank numbers — so every message carried each
       * referral's storagePath, contentHash and downloadUrl. A downloadUrl is a
       * permanent bearer link that opens the scan WITHOUT signing in, so those
       * were the most sensitive strings in the object and they were leaving on
       * every turn. Meanwhile the system prompt told the model this section was
       * "NOT currently included in FAMILY DATA" and to never claim to see it —
       * so the app was both over-sending the data and instructing the model to
       * deny it. Fixed on both sides; the prompt now describes what is actually sent.
       *
       * What remains is what the assistant actually needs: enough to say "you
       * already have that X-ray referral from March" instead of filing it twice.
       * Same shape and same reasoning as the documents line above. */
      referrals: (referrals || []).map((r: any) => ({
        id: r.id, kind: r.kind, date: r.date, reason: r.reason, status: r.status, providerName: r.providerName,
      })),
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

export default function AIChatbot({ members, onApplyEdits, onAddMemberDoc, onAddReferral, isBusinessSpace, onOpenFunAvatar, onGo, onGoView, onUndoEdits, onPrepareExport, initialDraft, onDraftApplied }: Props) {
  const { uid, familyId } = useFamilyCtx();
  const { lang, t } = useT();
  const suggestions = buildSuggestions(members, isBusinessSpace);
  /* Starts empty on purpose. Restoring here looks right but cannot work:
     familyId is still null on the first render, so it would read the 'none'
     bucket rather than this space's. The cached conversation is hydrated in the
     effect below, the moment the space is known. */
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  // The document reader, opened from a chat answer. Holds the resolved vault
  // document (we need its downloadUrl, which never goes near the chat model)
  // plus the phrase to search for.
  const [readerDoc, setReaderDoc] = useState<{ doc: DocumentAskModalDoc; question: string } | null>(null);
  const [readerLoading, setReaderLoading] = useState<string | null>(null);

  /**
   * Resolve a document the assistant named, and open the reader on it.
   *
   * The vault record is fetched HERE, on the client, at tap time — the chat
   * response carried only an id. That is the whole point: the downloadUrl, and
   * everything behind it, never passes through the model that can write to the
   * vault. If the id no longer resolves (deleted in another tab, or the list
   * moved on), say so plainly rather than opening an empty sheet.
   */
  /**
   * Read the document and put its own words in the conversation.
   *
   * "I just want the AI to answer in chat" — so the answer is rendered HERE,
   * under the message that prompted it, and not behind a button that opens a
   * sheet. Chat is the mouthpiece for the vault; a pointer to a second screen
   * is a signpost, not an answer.
   *
   * The document's text still never touches the chat model. This calls the same
   * read-only /api/doc-read the sheet does (via utils/docReader.ts) and renders
   * the passages the server sliced out of text extracted in this browser. The
   * chat model contributed one document id and one search phrase, and sees
   * nothing that comes back.
   *
   * loadDocuments() runs here rather than being carried on the message so the
   * document's downloadUrl never enters the chat transcript either.
   */
  const runInlineRead = useCallback(async (
    target: { id: string; name: string; question: string },
    readKey: string,
  ) => {
    // Matched on readKey, not object identity: each patch REPLACES the message
    // object, so a second patch keyed on the original reference would silently
    // find nothing and the spinner would spin for ever.
    const patchRead = (p: Partial<ChatMessage>) =>
      setMessages((prev) => prev.map((m) => (m.readKey === readKey ? { ...m, ...p } : m)));

    try {
      const docs = await loadDocuments();
      const found = (docs || []).find((d) => d.id === target.id);
      if (!found) {
        patchRead({
          readPending: false,
          readError: `I can't find “${target.name}” in the vault any more — it may have been removed.`,
        });
        return;
      }

      /* The three-minute ceiling that stops a stalled read from leaving a
       * spinner with no way out now lives INSIDE readDocument (see
       * DOC_READ_CLIENT_TIMEOUT_MS), so it applies identically here and in the
       * Document Vault's sheet. A timeout it was each call site's job to
       * remember is a timeout half the app doesn't have. */
      const outcome = await readDocument(
        {
          name: found.name,
          category: found.category,
          fileType: found.fileType,
          src: found.downloadUrl,
          storagePath: found.storagePath,
          contentHash: found.contentHash,
        },
        target.question,
        { isBusinessSpace, language: lang },
      );

      if (outcome.kind === 'result') patchRead({ readPending: false, readResult: outcome.result });
      else patchRead({ readPending: false, readError: outcome.message });
    } catch (e) {
      patchRead({
        readPending: false,
        readError: (e as Error)?.message === 'read-timeout'
          ? `Reading “${target.name}” took too long and I stopped waiting. Long scanned documents can take a while — trying again often works.`
          : `I couldn't open “${target.name}” just now — please try again, or open it from the Documents screen.`,
      });
    }
    // `lang` belongs here: it decides the language the answer and every
    // translation come back in. Left out, this closure keeps whatever language
    // was set when the chat first rendered, and changing the app's language
    // silently has no effect on the one feature it matters most to.
  }, [isBusinessSpace, lang]);

  const openReader = useCallback(async (target: { id: string; name: string; question: string }) => {
    setReaderLoading(target.id);
    try {
      const docs = await loadDocuments();
      const found = (docs || []).find((d) => d.id === target.id);
      if (!found) {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          text: `I can't find “${target.name}” in the vault any more — it may have been removed. Try the Documents screen.`,
        }]);
        return;
      }
      setReaderDoc({
        doc: {
          id: found.id,
          name: found.name,
          category: found.category,
          fileType: found.fileType,
          src: found.downloadUrl,
          storagePath: found.storagePath,
          contentHash: found.contentHash,
        },
        question: target.question,
      });
    } catch {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        text: `I couldn't open “${target.name}” just now — please try again, or open it from the Documents screen.`,
      }]);
    } finally {
      setReaderLoading(null);
    }
  }, []);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Load a pending draft from CopyableValue's "Scan" action, if this mount was
  // triggered by one. Runs once (mount only) — this component is unmounted
  // whenever the panel closes, so "on mount" already means "a fresh open."
  useEffect(() => {
    if (!initialDraft) return;
    setInput(initialDraft.text);
    if (initialDraft.attachment) setAttachments([initialDraft.attachment]);
    onDraftApplied?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [loading, setLoading] = useState(false);
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);
  // Duplicate-document flags for a message's pending Apply, keyed by message
  // index → one entry per flagged document edit (editIdx = index within that
  // message's own docEdits array). Apply is held until every flag is resolved.
  const [docDuplicates, setDocDuplicates] = useState<Record<number, DocDuplicateFlag[]>>({});
  const [error, setError] = useState<string | null>(null);
  // Undo-last-apply: which applied card is asking "Undo this?" for confirmation,
  // and which is mid-undo (so its control shows a spinner and can't double-fire).
  // Which edit cards are expanded, keyed by message index. Undefined means
  // "use the default", which is collapsed once there are more than two.
  const [expandedEdits, setExpandedEdits] = useState<Record<number, boolean>>({});
  const [confirmingUndoIdx, setConfirmingUndoIdx] = useState<number | null>(null);
  const [undoingIdx, setUndoingIdx] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  // Progressive word-by-word reveal of the latest assistant reply — null means
  // "not streaming" (either no reply yet, or the reveal has finished).
  const [streamWordCount, setStreamWordCount] = useState<number | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Mount the (lazy) scanner once, the first time it's actually opened, and
  // never unmount it again — same reasoning as Dashboard.tsx's ExportPackModal.
  const [scannerEverOpened, setScannerEverOpened] = useState(false);
  useEffect(() => { if (scannerOpen) setScannerEverOpened(true); }, [scannerOpen]);
  // Heads-up card: vehicles + slips aren't in `members`, so load them once (same
  // sources NeedsAttention uses) to feed the deterministic expiry/gap index.
  const [hVehicles, setHVehicles] = useState<Vehicle[]>([]);
  const [hSlips, setHSlips] = useState<SlipItem[]>([]);
  // Honest usage indicator ("12 of 30 AI actions used this month") — read
  // from the server, never recomputed client-side. null while loading/
  // unavailable, in which case the indicator just doesn't show.
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);
  const refreshAiUsage = () => { loadAiUsage().then(setAiUsage).catch(() => {}); };
  // Dismiss persists per-day via the existing isHintSeen/markHintSeen convention
  // (per space + device). A fresh key each day means the card returns tomorrow if
  // there's still something to surface, but stays gone for the rest of today.
  const headsUpKey = `chat_headsup_${new Date().toISOString().slice(0, 10)}`;
  const [headsUpDismissed, setHeadsUpDismissed] = useState(() => isHintSeen(headsUpKey));
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Grow the composer with what's being typed, up to the max-height its class
  // sets (past that it scrolls itself). Driven off `input` rather than the
  // change event so dictation, "ask this about the photo" chips and anything
  // else that writes into the box resizes it too. The reset to 'auto' is
  // required: scrollHeight can never report SMALLER than the current fixed
  // height, so without it the box only ever grows.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

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

  /* Restore the conversation.
   *
   * `uid` is null on the FIRST render of every single app open — auth resolves a
   * tick later, it cannot be synchronous. The old `if (!uid) setMessages([])`
   * therefore fired on every launch, wiped the history that had just been
   * restored from localStorage above, and the persist effect below then wrote
   * that empty array straight back over the cache. The local copy was destroyed
   * on every open and the chat only reappeared if the cloud read came back — so
   * a slow or offline read showed an empty assistant with nothing to Apply.
   *
   * Clearing is only ever right on a real SIGN-OUT: uid went from something to
   * nothing. Tracked with a ref so a first render can't be mistaken for one.
   *
   * The cloud read waits for familyId too. loadChatHistory reads through the
   * module-level FAMILY_ID, which setFamilyId() populates alongside the context
   * value — firing before it is set reads from the wrong path. */
  // Holds the uid rather than a flag, because clearing on sign-out has to remove
  // the key belonging to the person who just LEFT — by then `uid` is already null.
  const lastUid = useRef<string | null>(null);
  const hydrated = useRef(false);
  useEffect(() => {
    if (!uid) {
      if (lastUid.current) {         // signed out — the chat is no longer ours
        try { localStorage.removeItem(chatKey(familyId, lastUid.current)); } catch { /* ignore */ }
        lastUid.current = null;
        hydrated.current = false;
        setMessages([]);
      }
      return;                        // still resolving: keep the cached chat on screen
    }
    lastUid.current = uid;
    if (!familyId) return;

    /* Cache first, network second. The useState initialiser above runs on the
     * first render, when familyId is still null — so it reads chatKey(null),
     * the 'none' bucket, which nothing ever writes to. It has always come back
     * empty. The real cache only becomes readable at this point, once the space
     * is known, so read it HERE and paint immediately; the cloud read below
     * then corrects it. Only when there's nothing on screen, so this can never
     * overwrite a conversation already in progress. */
    setMessages((current) => {
      if (current.length > 0) return current;
      try {
        const raw = localStorage.getItem(chatKey(familyId, uid));
        const cached = raw ? JSON.parse(raw) : [];
        return Array.isArray(cached) ? revivePendingReads(cached) : current;
      } catch { return current; }
    });
    hydrated.current = true;         // the cache is now safe to write again

    loadChatHistory(uid).then(history => {
      // StoredChatMessage is a loose shape (role: string) that db.ts widens on
      // the way out; the runtime objects are ChatMessages and carry readPending.
      if (history.length > 0) setMessages(revivePendingReads(history as unknown as ChatMessage[]));
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

  /* Persist the conversation (minus heavy image data) on this device.
   *
   * Held until the restore above has run. Both effects depend on familyId, so
   * the render where it resolves fires this one too — with `messages` still the
   * empty starting array, because the restore's setMessages hasn't committed
   * yet. Without the guard that empty array is written straight over the cached
   * conversation. */
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      const slim = slimForCloud(messages.slice(-60));
      localStorage.setItem(chatKey(familyId, uid), JSON.stringify(slim));
    } catch { /* ignore */ }
  }, [messages, familyId]);

  // Load the vehicles + slips the heads-up card needs (members are already a
  // prop). Only worth doing while the opening state can show — reloads per space.
  useEffect(() => {
    let cancelled = false;
    loadHousehold().then((h) => { if (!cancelled) setHVehicles(h?.vehicles || []); }).catch(() => { if (!cancelled) setHVehicles([]); });
    loadSlips().then((s) => { if (!cancelled) setHSlips(s || []); }).catch(() => { if (!cancelled) setHSlips([]); });
    loadAiUsage().then((u) => { if (!cancelled) setAiUsage(u); }).catch(() => { if (!cancelled) setAiUsage(null); });
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
    try { localStorage.removeItem(chatKey(familyId, uid)); } catch { /* ignore */ }
    if (uid) saveChatHistory(uid, []);
  };

  /* The calendar, bounded.
   *
   * Every event ever synced used to go to the model on every single message. On
   * the live account that is 554 entries and 88% of the entire payload — enough
   * to blow the server's context cap on its own, which silently truncated the
   * JSON and took the authoritative expiry data with it. An imported Google
   * Calendar only makes this worse over time, and it is the one input a user can
   * grow without limit without meaning to.
   *
   * A window instead. Chat needs the calendar to answer "what's on this week"
   * and to avoid creating a duplicate event; neither needs 2019. Recent past is
   * kept because "when was that appointment?" is a real question, and undated
   * entries are kept rather than guessed at. Newest-first, capped, so a
   * pathological calendar cannot dominate what the assistant sees about people.
   */
  const CAL_PAST_DAYS = 60;
  const CAL_FUTURE_DAYS = 365;
  const CAL_MAX = 150;
  const boundCalendar = (events: { date?: string }[]) => {
    const today = new Date();
    const floor = new Date(today); floor.setDate(floor.getDate() - CAL_PAST_DAYS);
    const ceil = new Date(today); ceil.setDate(ceil.getDate() + CAL_FUTURE_DAYS);
    const iso = (d: Date) => d.toLocaleDateString('en-CA');
    const from = iso(floor), to = iso(ceil);
    return (events || [])
      .filter((e) => {
        const d = String(e?.date || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return true;   // undated: keep, don't guess
        return d >= from && d <= to;
      })
      .sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')))
      .slice(0, CAL_MAX);
  };

  const buildContext = async () => {
    const [info, household, finances, timeline, docs, events, spaceInfo, slips, hubSettings, assets] = await Promise.all([
      loadFamilyInfo(), loadHousehold(), loadFinances(), loadTimeline(), loadDocuments(), loadCalendarEvents(), loadSpaceInfo(), loadSlips(), loadSettings(), loadAssets(),
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
        // id lets the AI reference a specific vault document for delete_record.
        id: d.id,
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
    // slips carry ids so the AI can target one for delete_record/update_record ("bin that Media Markt receipt").
    // Door/garage codes + the Wi-Fi password, and bank IBAN/BIC, are removed
    // here — the LAST point before this object is POSTed to /api/chat and on to
    // Gemini. Redacting at the boundary (rather than at each loader) means every
    // future caller of loadHousehold/loadFinances keeps the full record for the
    // UI, and only the AI path loses them. See aiRedact.ts.
    // hubStatus: read-write (see the "hub_status" AiEdit kind) — the one-line
    // "fridge whiteboard", genuinely meant to be posted/read via chat.
    //
    // calendarSync: READ-ONLY, deliberately. Subscribing to a feed is pasting
    // in another calendar's private URL, and toggling Google auto-sync flips
    // a real integration on a real external account — both closer in kind to
    // digitalAccounts (also manual-write-only, see aiRedact.ts) than to data
    // the assistant should be able to change on someone's say-so in chat.
    // What WAS a bug: this summary didn't exist in context at all, so a
    // simple "what calendars am I subscribed to?" got "I don't have that
    // information" even though the data is loaded elsewhere in this same app.
    const hubStatusCtx = hubSettings?.status;
    const calendarSyncCtx = {
      subscribedFeeds: (hubSettings?.calendarFeeds || []).map(f => ({
        label: f.label, lastSyncedAt: f.lastSyncedAt, eventCount: f.eventCount, lastError: f.lastError,
      })),
      autoSyncToGoogleEnabled: !!hubSettings?.autoSyncEventsToGoogle,
    };
    // assets carry ids so the AI can target one for delete_record/update_record
    // ("that's the same pump, just update the serial number") instead of its
    // ONLY prior option — creating a second, near-duplicate entry — which is
    // exactly what happened before this field existed: the assistant had no
    // way to see what was already in the inventory. Slim on purpose (no
    // photos/prices/notes) since this rides on every chat turn.
    const assetsCtx = (assets || []).map(a => ({
      id: a.id, name: a.name, category: a.category, make: a.make, model: a.model,
      serialNumber: a.serialNumber, assignedMember: a.assignedMember,
    }));
    // info.numbers is the one free-text bucket in the vault — nothing forces
    // what goes in the "value" of an "Important Numbers" entry, so unlike
    // every other field here it cannot be redacted by naming a key. Strip the
    // value unconditionally rather than send it to Gemini on every turn.
    const infoCtx = info ? { ...info, numbers: redactInfoNumbers(info.numbers) } : info;
    return { members: slimMembers(members), info: infoCtx, household: redactHousehold(household), finances: redactFinances(finances), timeline, documents, calendar: boundCalendar(events || []), isBusinessSpace: !!isBusinessSpace, spaceInfo: spaceInfoCtx, expiries, gaps, slips: slips || [], assets: assetsCtx, hubStatus: hubStatusCtx, calendarSync: calendarSyncCtx };
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
    // Map the app's UI language to a speech locale so German/Afrikaans (etc.)
    // transcribe correctly; fall back to the browser default, then en-US.
    rec.lang = speechLocaleFor(lang, navigator.language || 'en-US');
    rec.interimResults = true;
    rec.continuous = true; // keep listening across pauses instead of one breath

    // Append to whatever is already typed rather than clobbering it. In
    // continuous mode event.results holds every result so far (finalised ones
    // plus the current interim), so we rebuild deterministically each event —
    // idempotent, no duplication or flicker.
    const base = input;
    rec.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      const spoken = transcript.trim();
      const sep = base && spoken && !/\s$/.test(base) ? ' ' : '';
      setInput(base + sep + spoken);
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
      // Monthly AI-action limit reached — a normal, expected state, not a
      // broken-app error. Show it as a plain assistant reply (its text
      // already says what happened and that everything else still works)
      // rather than the red error banner, and refresh the usage indicator so
      // it immediately reads e.g. "30 of 30" without waiting for a reload.
      if (res.status === 402 && data?.limitReached) {
        setMessages(prev => [...prev, { role: 'assistant', text: data.error || "You've used all your AI actions this month." }]);
        refreshAiUsage();
        return;
      }
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
      // Stamp a plain-language, display-only label onto any destructive edit
      // (delete_record/update_record) so the Apply card spells out WHAT will be
      // removed/changed and on WHOSE record — a mis-heard command is caught by
      // eye before Apply. Purely cosmetic: apply RE-RESOLVES the id against fresh
      // data (see utils/aiDestructive) and ignores this label. Uses the context
      // we just built, so no extra load. Mutates the freshly-created edit objects.
      annotateDestructiveEdits(edits, context);
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
      // A folder the assistant offered to gather. Member NAMES are resolved to
      // ids here, against the live member list — the server never sees ids and
      // the model is never trusted with one. A name that matches nobody is
      // dropped rather than guessed at; if that empties the list the request is
      // discarded entirely, because an empty member list legitimately means
      // "the whole household" and quietly turning "Sophie's records" into
      // everyone's would be the worst possible failure here.
      let exportRequest: PackRequest | undefined;
      const rawExport = data.export;
      if (rawExport && onPrepareExport) {
        const topics = resolveTopics(rawExport.preset, rawExport.topics);
        const names: string[] = Array.isArray(rawExport.members) ? rawExport.members : [];
        const ids = names.map((n) => resolveMemberByName(n)?.id).filter((id): id is string => !!id);
        const askedForPeople = names.length > 0;
        if (topics.length && (!askedForPeople || ids.length > 0)) {
          exportRequest = {
            title: typeof rawExport.title === 'string' ? rawExport.title : '',
            memberIds: ids,
            topics,
          };
        }
      }

      // Already validated server-side against the document list this same
      // request sent, so an id here is one the user genuinely has. Re-checked
      // for shape only — a malformed payload should drop the offer, not throw.
      const rawRead = (data as { readDoc?: { id?: unknown; name?: unknown; question?: unknown } }).readDoc;
      const readDoc = rawRead && typeof rawRead.id === 'string' && rawRead.id
        ? {
            id: rawRead.id,
            name: typeof rawRead.name === 'string' ? rawRead.name : 'this document',
            question: typeof rawRead.question === 'string' ? rawRead.question : '',
          }
        : undefined;

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        // WHEN A DOCUMENT IS BEING READ, THE MODEL'S PROSE IS THROWN AWAY.
        //
        // Not for tidiness — because that sentence is where the whole feature
        // leaked. Told it may not read documents itself, the model reliably
        // opens with what it CANNOT do ("I can only store and retrieve the
        // document itself… I cannot read the content"), which reads as a flat
        // refusal even in the build where the reader works perfectly. The
        // reader was live for a week and the first thing the user saw was
        // still a refusal.
        //
        // So the moment a document read is resolved, the bubble is entirely
        // app-authored: a fixed template, naming the document and the phrase,
        // claiming nothing about what the document contains. That is also the
        // stronger legal position — with the reply replaced, there is now NO
        // path by which model prose about a document's contents can reach the
        // screen, rather than a rule asking it not to.
        text: readDoc ? readingLine(readDoc) : (data.reply || '…'),
        readKey: readDoc ? `${readDoc.id}::${performance.now()}` : undefined,
        readPending: !!readDoc,
        edits: edits.length ? edits : undefined,
        exportRequest,
        readDoc,
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
      refreshAiUsage(); // this call just counted against this month's quota — keep the indicator honest

      // READ IT NOW, IN THE CONVERSATION — don't wait to be asked twice.
      //
      // The user has already said what they want to know. Answering "here is a
      // button that will find out" makes them ask the same question a second
      // time in a different way, which is the app forgetting what it was told
      // one line earlier.
      //
      // The passages land inline under this message (see InlineDocAnswer). The
      // button below stays as a way into the full sheet — where the search box,
      // the set-aside passages and the who-can-answer list live — but nothing
      // has to be tapped to get an answer.
      //
      // Cost is real and accepted: /api/doc-read counts as its own AI action,
      // so a document question spends two rather than one. That is the price of
      // the question actually being answered, and readDoc is only ever set for
      // questions genuinely about a document's contents.
      if (readDoc && assistantMsg.readKey) void runInlineRead(readDoc, assistantMsg.readKey);
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
  const fileScans = async (docEdits: DocEdit[], srcs: Attachment[], resolutions: Record<number, DocDuplicateFlag>): Promise<UndoRecord[]> => {
    // Nothing to file only when BOTH sources are missing: an edit stamped with
    // its own fileUrl needs no chat attachment at all.
    if (!srcs.length && !docEdits.some(e => e.fileUrl)) return [];
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

        /* Referrals & Results gets its own copy.
         *
         * Until now the assistant had no way to reach this section at all — it
         * has 24 edit kinds and none of them was a referral — so a photographed
         * referral letter could only ever become a generic document. It filed
         * successfully, in a sensible place, and the section the user built it
         * for stayed empty. That is the whole "you scan something and it doesn't
         * save to all the relevant places" complaint.
         *
         * Same uploaded file, same Storage object, referenced a third time. The
         * record carries its own date and kind, which is what makes a run of lab
         * results a history rather than a pile. */
        if (e.referralKind) {
          const referral: ReferralRecord = {
            id: 'ref-' + id,
            kind: e.referralKind,
            date: /^\d{4}-\d{2}-\d{2}$/.test(e.referralDate || '') ? e.referralDate : undefined,
            providerName: e.referralProvider?.trim() || undefined,
            reason: e.referralReason?.trim() || undefined,
            status: 'open',
            fileName,
            fileType,
            fileSize,
            storagePath,
            downloadUrl,
            contentHash: hash || undefined,
            addedAt: new Date().toISOString(),
          };
          await onAddReferral(owner.id, referral);
        }
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
    // Undo manifest for the docs just filed: the vault id is the anchor, and its
    // member-profile copy (id 'doc-'+id, stripped by deleteDocumentEverywhere via
    // the vault doc) rides along. memberId lets Undo route through the same
    // delete-everywhere helper so nothing is half-removed.
    return added.map(d => ({ domain: 'document' as const, id: d.id, memberId: d.memberId, label: d.name }));
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
      // An asset edit carries an optional photo of the item itself (a serial
      // plate close-up, the item on a shelf) — upload it now, same non-fatal
      // pattern as recipe/slip above. Without this, photographing an item and
      // asking the assistant to file it produced a text-only record with the
      // photo silently dropped — the item on screen had no picture even though
      // the whole point of the message was a photo of it.
      if (srcs.length && edits.some(e => e.kind === 'asset')) {
        try {
          const photoUrl = await uploadAssetPhoto(srcs[0].dataUrl);
          resolvedEdits = resolvedEdits.map(e => (e.kind === 'asset' ? { ...e, photoUrl } : e));
        } catch {
          // Non-fatal — asset details below still get saved without a photo.
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

      // Collect the undo manifest as we apply: onApplyEdits returns the ids of
      // the non-document records it created (via before/after diffing in the
      // Dashboard), and fileScans returns the vault-document ids. Merged onto the
      // message so a later Undo can delete exactly these and nothing else.
      const undo: UndoRecord[] = [];
      const dataEdits = resolvedEdits.filter(e => e.kind !== 'document');
      if (dataEdits.length) {
        const u = await onApplyEdits(dataEdits);
        if (Array.isArray(u)) undo.push(...u);
      }
      if (docEdits.length && canFileDocs) {
        const resolutions: Record<number, DocDuplicateFlag> = {};
        flags.forEach(f => { resolutions[f.editIdx] = f; });
        const u = await fileScans(docEdits, srcs, resolutions);
        if (Array.isArray(u)) undo.push(...u);
      } else if (docEdits.length && !canFileDocs) {
        // Image is stripped from persisted history — after a reload we can't
        // file the scan. Don't fail silently: the data edits applied, but the
        // user must re-attach the photo to store the document itself.
        setError('Your other changes were saved, but the photo itself is no longer in this chat (it was cleared when the app reloaded). Please re-attach the photo and send it again to file the document.');
      }
      setMessages(prev => {
        const updated = prev.map((m, i) => i === idx ? { ...m, applied: true, undo: undo.length ? undo : undefined } : m);
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

  // Undo the MOST RECENT apply of this message: delete exactly the records it
  // created (its stored manifest) and flip the card back to un-applied so it can
  // be re-Applied (which mints fresh ids). Only the records this apply minted are
  // touched — field-set edits that merely changed a value stay, and are called
  // out in the copy. If a record can't be found (already changed/removed on
  // another device), Undo removes what it can and says how many it couldn't.
  const undoEdits = async (idx: number) => {
    setConfirmingUndoIdx(null);
    const msg = messages[idx];
    const records = msg?.undo || [];
    if (!onUndoEdits || !records.length) {
      // Nothing reversible was captured — just flip the card back so it can be re-applied.
      setMessages(prev => {
        const updated = prev.map((m, i) => i === idx ? { ...m, applied: false, undo: undefined } : m);
        if (uid) saveChatHistory(uid, slimForCloud(updated));
        return updated;
      });
      setDocDuplicates(prev => { const next = { ...prev }; delete next[idx]; return next; });
      return;
    }
    setUndoingIdx(idx);
    try {
      const res = await onUndoEdits(records);
      setMessages(prev => {
        const updated = prev.map((m, i) => i === idx ? { ...m, applied: false, undo: undefined } : m);
        if (uid) saveChatHistory(uid, slimForCloud(updated));
        return updated;
      });
      // Clear any duplicate flags so a re-Apply re-checks the vault from scratch.
      setDocDuplicates(prev => { const next = { ...prev }; delete next[idx]; return next; });
      // Field-set edits (a shoe size, an address) change a value in place rather
      // than create a record, so undo can't reverse them — say so plainly instead
      // of implying the card was wiped clean.
      const irreversible = countIrreversibleEdits(msg.edits || []);
      const notes: string[] = [];
      if (res.missing > 0) notes.push(`${res.missing} couldn't be found (already changed or removed) and were left as they are`);
      if (irreversible > 0) notes.push(`${irreversible} field change${irreversible === 1 ? '' : 's'} (like a size or an address) can't be auto-undone and stay${irreversible === 1 ? 's' : ''} set`);
      setError(
        notes.length
          ? `Undid ${res.undone} item${res.undone === 1 ? '' : 's'}. ${notes.join('; ')}.`
          : null,
      );
    } catch (e: any) {
      setError(e?.message || "Couldn't undo those changes.");
    } finally {
      setUndoingIdx(null);
    }
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
          {/* Honest usage indicator — shown quietly, never as a nag. Numbers come
              straight from the server (loadAiUsage); the client never computes
              the limit itself. Hidden entirely on the paid plan's effectively-
              unlimited ceiling and while still loading, so it never distracts. */}
          {aiUsage && aiUsage.plan === 'free' && (
            <p className="text-[11px] text-ink-400 truncate mt-0.5" title={`Resets on ${aiUsage.resetsOn}`}>
              {aiUsage.used} of {aiUsage.limit} AI actions used this month
            </p>
          )}
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
            // Derived, not stored: m.text froze at "reading it now" when the
            // read started, and a finished read must stop claiming to be
            // in progress — see readDoneLine.
            : (m.readDoc && !m.readPending ? readDoneLine(m.readDoc) : m.text);
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

              {/* The answer itself, in the conversation — no tap required. */}
              {m.readDoc && (
                <InlineDocAnswer
                  msg={m}
                  /* Gated on "can this be re-run", not on "did it error".
                   * InlineDocAnswer renders a "Read it properly" button in the
                   * DEGRADED branch too — a read that timed out inside the
                   * model step and fell back to the raw keyword sweep. That
                   * button was being drawn with no handler, so the one case
                   * where retrying is most likely to work did nothing at all
                   * when tapped. */
                  onRetryRead={(m.readError || m.readResult?.degraded) && m.readDoc && m.readKey
                    ? () => {
                        // Same readKey, so the patch lands on THIS message
                        // rather than creating a second answer below it.
                        // readResult is cleared too: retrying a DEGRADED read
                        // must not leave the fallback's passages on screen
                        // underneath a spinner, where they read as the answer.
                        setMessages((prev) => prev.map((x) => (x.readKey === m.readKey
                          ? { ...x, readError: undefined, readResult: undefined, readPending: true } : x)));
                        void runInlineRead(m.readDoc!, m.readKey!);
                      }
                    : undefined}
                  onAskAgain={(() => {
                    // What the person typed, not what the old reader was sent.
                    // Attachments are deliberately not carried over: the read
                    // works off the stored document, and re-uploading a photo
                    // from a months-old bubble would file it a second time.
                    for (let j = i - 1; j >= 0; j--) {
                      const t = messages[j].role === 'user' ? messages[j].text.trim() : '';
                      if (t && !t.startsWith('📎')) return () => void send(t, null);
                      if (messages[j].role === 'user') break;
                    }
                    return undefined;
                  })()}
                />
              )}

              {m.readDoc && (
                /* Writes nothing, so no Apply card — same reasoning as the
                   export button below. The passages are already above; this is
                   the way into the full sheet, where the search box, the
                   set-aside passages and the list of people who can actually
                   advise you live. */
                <button
                  type="button"
                  onClick={() => void openReader(m.readDoc!)}
                  disabled={readerLoading === m.readDoc.id}
                  className="w-full rounded-2xl border border-sage-200 bg-sage-50/70 p-3 flex items-center gap-2.5 text-left cursor-pointer hover:bg-sage-50 disabled:opacity-60 disabled:cursor-wait"
                >
                  <span className="w-8 h-8 rounded-xl bg-white border border-sage-200 flex items-center justify-center shrink-0">
                    {readerLoading === m.readDoc.id
                      ? <Loader2 className="w-4 h-4 text-sage-600 animate-spin" />
                      : <MessageCircleQuestion className="w-4 h-4 text-sage-600" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-sage-700 truncate">
                      Open {m.readDoc.name}
                    </span>
                    <span className="block text-[12px] text-ink-500 truncate">
                      Search it again, see everything it found, or share a clause
                    </span>
                  </span>
                </button>
              )}

              {m.exportRequest && onPrepareExport && (
                /* Not an Apply card. Nothing is being written, so there is
                   nothing to confirm here — the confirmation that matters is
                   the one on the export screen, where the user sees the real
                   counts and can change the selection before anything leaves
                   the device. */
                <button
                  type="button"
                  onClick={() => onPrepareExport(m.exportRequest!)}
                  className="w-full rounded-2xl border border-dusk-200 bg-dusk-50/70 p-3 flex items-center gap-2.5 text-left cursor-pointer hover:bg-dusk-50"
                >
                  <span className="w-8 h-8 rounded-xl bg-white border border-dusk-200 flex items-center justify-center shrink-0">
                    <FolderDown className="w-4 h-4 text-dusk-600" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-dusk-700 truncate">
                      {m.exportRequest.title?.trim() || 'Prepare this folder'}
                    </span>
                    <span className="block text-[12px] text-ink-500">
                      See what's in it, then share or download
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-dusk-500 shrink-0" />
                </button>
              )}

              {m.edits && m.edits.length > 0 && (
                <div className="rounded-2xl border border-clay-200 bg-clay-50/70 p-3 space-y-2">
                  {/* Collapsed by default past two items. A long list pushed the
                      Apply button down past the bottom of the panel, which on a
                      phone made it unreachable — the list is the detail, the
                      decision is the point, so the decision stays on screen. */}
                  {(() => {
                    const many = m.edits!.length > 2;
                    const open = expandedEdits[i] ?? !many;
                    return (
                      <>
                        <button
                          type="button"
                          onClick={() => setExpandedEdits((prev) => ({ ...prev, [i]: !open }))}
                          aria-expanded={open}
                          className={`w-full flex items-center gap-1.5 text-[12px] font-semibold text-clay-700 text-left ${many ? 'cursor-pointer' : 'cursor-default'}`}
                          disabled={!many}
                        >
                          <Wand2 className="w-3.5 h-3.5 shrink-0" />
                          <span className="flex-1">
                            {m.applied
                              ? `${m.edits!.length} ${m.edits!.length === 1 ? 'change' : 'changes'}`
                              : `I'd like to save ${m.edits!.length} ${m.edits!.length === 1 ? 'thing' : 'things'} — apply?`}
                          </span>
                          {many && <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />}
                        </button>
                        {open && (
                          <ul className="space-y-1">
                            {m.edits!.map((e, j) => (
                              <li key={j} className="text-[13px] text-ink-700 flex items-start gap-1.5">
                                <span className="text-clay-400 mt-0.5">•</span>
                                <span>{describeEdit(e)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    );
                  })()}
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
                    <div className="space-y-1.5">
                      <p className="text-[12px] font-semibold text-sage-700 flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5" /> {t.ai_applied}
                      </p>
                      {/* Where each edit landed — kills the "it says saved but I can't find it" doubt. */}
                      <ul className="space-y-0.5">
                        {m.edits!.map((e, j) => (
                          <li key={j} className="text-[11.5px] text-ink-400 pl-5 truncate">
                            → {landingLabel(e, (n) => resolveMemberByName(n)?.name)}
                          </li>
                        ))}
                      </ul>
                      {onUndoEdits && m.undo && m.undo.length > 0 && (
                        confirmingUndoIdx === i ? (
                          <div className="flex items-center gap-2 pt-0.5 pl-5">
                            <span className="text-[11.5px] text-ink-500">Undo this?</span>
                            <button
                              onClick={() => undoEdits(i)}
                              disabled={undoingIdx === i}
                              className="btn-quiet text-[11px] px-2 py-0.5 text-rosa-700 disabled:opacity-50"
                            >
                              {undoingIdx === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />} Yes, undo
                            </button>
                            <button
                              onClick={() => setConfirmingUndoIdx(null)}
                              disabled={undoingIdx === i}
                              className="btn-quiet text-[11px] px-2 py-0.5 disabled:opacity-50"
                            >
                              Keep
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmingUndoIdx(i)}
                            className="ml-5 text-[11px] text-ink-400 hover:text-rosa-600 underline underline-offset-2 inline-flex items-center gap-1"
                          >
                            <Undo2 className="w-3 h-3" /> Undo
                          </button>
                        )
                      )}
                    </div>
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

        {/* Composer: the message gets its own full-width row, the tools sit
            under it.
            Everything used to share ONE row — mic, camera, paste, Attach, the
            text box and Send. Five 44px controls plus gaps eat ~260px, so on a
            375px phone the actual typing area was a ~60px slot showing about
            two characters of what you'd written. The row split is the fix:
            nothing competes with the message for width any more, which is also
            what lets it be a growing textarea rather than a single line. */}
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="space-y-2">
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple onChange={onPickFile} className="hidden" />
          {/* Separate input from the Attach one, and deliberately NOT `multiple`:
              `capture` is only honoured by mobile browsers on a single-file
              input, and it's what makes the phone open the camera straight away
              instead of the file browser. Desktop ignores `capture` entirely and
              falls back to a normal picker, which is the sane degradation. */}
          <input ref={photoRef} type="file" accept="image/*" capture="environment" onChange={onPickFile} className="hidden" />

          <textarea
            ref={inputRef}
            rows={1}
            placeholder={attachments.length > 0 ? 'Add a note, or just send to scan…' : 'Ask or tell me something…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPasteImage}
            // Enter still sends, as it did when this was an <input> — the
            // habit is worth more than a newline key. Shift+Enter breaks a
            // line for anyone writing something longer.
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
            }}
            disabled={loading}
            className="field w-full resize-none min-h-[44px] max-h-32 leading-snug"
          />

          <div className="flex items-center gap-2">
            {SR && (
              <button
                type="button"
                onClick={toggleVoice}
                disabled={loading}
                title={listening ? 'Stop recording' : 'Speak your message'}
                aria-label={listening ? 'Stop recording' : 'Speak your message'}
                className={`h-11 w-11 shrink-0 rounded-2xl border font-semibold text-sm transition-colors disabled:opacity-40 flex items-center justify-center ${
                  listening
                    ? 'bg-rosa-500 text-white border-rosa-500 anim-pulse-soft'
                    : 'bg-white hover:bg-cream-100 text-ink-700 border-cream-300'
                }`}
              >
                {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            )}
            {/* Camera means camera. It used to open the document scanner —
                corner detection, crop, deskew — which is the right tool for a
                letter on a table and the wrong one for photographing a rash, a
                meter reading or a note on a fridge. Point-and-shoot is now the
                plain Camera icon; the scanner keeps its own ScanLine one next
                to it, so both are one tap away and neither is disguised as the
                other. */}
            <button
              type="button"
              onClick={() => photoRef.current?.click()}
              disabled={loading || attachments.length >= MAX_ATTACHMENTS}
              title="Take a photo"
              aria-label="Take a photo"
              className="btn-quiet h-11 w-11 !p-0 shrink-0 disabled:opacity-40"
            >
              <Camera className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              disabled={loading || attachments.length >= MAX_ATTACHMENTS}
              title="Scan a document — finds the edges and straightens it"
              aria-label="Scan a document"
              className="btn-quiet h-11 w-11 !p-0 shrink-0 disabled:opacity-40"
            >
              <ScanLine className="w-4 h-4" />
            </button>
            {typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.read === 'function' && (
              <button
                type="button"
                onClick={pasteFromClipboard}
                disabled={loading || attachments.length >= MAX_ATTACHMENTS}
                title="Paste a copied image or PDF from your clipboard"
                aria-label="Paste from clipboard"
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
              aria-label="Attach a file"
              className="btn-quiet h-11 w-11 !p-0 shrink-0 disabled:opacity-40"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <button type="submit" disabled={(!input.trim() && attachments.length === 0) || loading} className="btn-primary h-11 w-11 !p-0 shrink-0 ml-auto disabled:opacity-40">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
        <p className="text-[11px] text-ink-400 mt-2 text-center">
          {t.ai_hint.split('Ctrl+V').length > 1
            ? <>{t.ai_hint.split('Ctrl+V')[0]}<kbd className="px-1 py-0.5 bg-cream-200 rounded text-[10px] font-mono">Ctrl+V</kbd>{t.ai_hint.split('Ctrl+V')[1]}</>
            : t.ai_hint
          }
        </p>
      </div>

      {/* The reader, opened from an answer above. The chat never receives a
          single character of the document — this sheet fetches the file itself
          and calls the separate read-only endpoint. Chat is the mouthpiece; the
          reading happens somewhere that cannot write. */}
      <DocumentAskModal
        doc={readerDoc?.doc ?? null}
        isBusinessSpace={isBusinessSpace}
        autoQuestion={readerDoc?.question}
        onClose={() => setReaderDoc(null)}
      />

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} name="Chat attachment" />
      {scannerEverOpened && (
        <Suspense fallback={null}>
          <DocumentScannerModal
            open={scannerOpen}
            onClose={() => setScannerOpen(false)}
            onUse={onScanResult}
            title="Document Scanner"
          />
        </Suspense>
      )}
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
  // Name the third destination too. The card is the only chance the user gets
  // to see where something is about to land, so a referral that quietly also
  // files into Referrals & Results should say so before they tap Apply.
  if (e.kind === 'visa') return `Record ${e.permitType || 'visa'} for ${e.country}${e.expiryDate ? `, expires ${e.expiryDate}` : ''} on ${e.member}’s profile`;
  if (e.kind === 'vaccination') return `Record ${e.name}${e.date ? ` (${e.date})` : ''} in ${e.member}’s vaccinations`;
  if (e.kind === 'document') return `Save the scan “${e.name}” to Documents (${e.category})${e.member ? ` + ${e.member}’s profile` : ''}${e.referralKind ? ` + Referrals & Results (${String(e.referralKind).toLowerCase()}${e.referralDate ? `, ${e.referralDate}` : ''})` : ''}`;
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
  if (e.kind === 'designated_successor') return `Record ${e.name} as the person who takes over`;
  if (e.kind === 'emergency_instructions') {
    const bits: string[] = [];
    if (e.keysAndSafes) bits.push('where the keys are');
    if (e.letter) bits.push('a letter');
    if (e.notifyContacts?.length) bits.push(`${e.notifyContacts.length} to tell`);
    if (e.accountsToClose?.length) bits.push(`${e.accountsToClose.length} to close`);
    return `Save emergency instructions${bits.length ? ` — ${bits.join(', ')}` : ''}`;
  }
  if (e.kind === 'service_record') {
    const n = e.records?.length || 0;
    const tgt = e.plate || e.vehicle || e.vin || 'the vehicle';
    return `Add ${n} service record${n === 1 ? '' : 's'} to ${tgt}`;
  }
  if (e.kind === 'hub_status') return `Update the family status: “${e.text}”`;
  // EDIT/DELETE existing records: clear_field describes itself directly; delete/
  // update rely on the client-stamped `label` (annotateDestructiveEdits) which
  // names WHAT + WHOSE record — the whole point of confirm-before-destroy.
  if (e.kind === 'clear_field') return `${e.member}: clear ${e.field.replace(/_/g, ' ')}`;
  if (e.kind === 'delete_record') return e.label || `Remove a ${e.targetKind.replace(/_/g, ' ')}`;
  if (e.kind === 'update_record') return e.label || `Update a ${e.targetKind.replace(/_/g, ' ')}`;
  return JSON.stringify(e);
}
