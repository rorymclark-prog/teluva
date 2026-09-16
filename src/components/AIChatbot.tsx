import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { FamilyMember, VaultCategory, VaultDocument, FamilyDocument, Vehicle, SlipItem, AiUsage, ReferralKind, ReferralRecord, DocReadResult, DocPassage, InsurancePolicy, AnniversaryKind } from '../types';
import { readDocument, EXPECTED_READER_VERSION } from '../utils/docReader';
import { searchVault, coverageLine, type VaultSearchOutcome } from '../utils/vaultSearch';
import { auth } from '../lib/firebase';
import {
  loadFamilyInfo, loadHousehold, loadFinances, loadTimeline,
  loadDocuments, saveDocuments, uploadVaultFile, deleteVaultFile, loadCalendarEvents,
  loadChatHistory, saveChatHistory, uploadChatAttachment, uploadRecipePhoto, loadSpaceInfo, uploadSlipPhoto,
  uploadChatAttachmentWithPath, loadSlips, isHintSeen, markHintSeen, loadAiUsage, loadSettings,
  loadAssets, uploadAssetPhoto, loadRecipes, loadFamilyWords, loadWillsEstate, loadShopping, loadAnniversaries, loadExtendedBirthdays,
} from '../utils/db';
import { computeChatInsights } from '../utils/chatInsights';
import { boundCalendar } from '../utils/calendarWindow';
import { calendarForChat } from '../utils/importantEvents';
import { redactHousehold, redactFinances, redactMember, redactInfoNumbers } from '../utils/aiRedact';
import { buildRevealIndex, resolveReveals, groupReveals, formatRevealsForCopy, MAX_REVEALS_PER_MESSAGE } from '../utils/aiReveal';
import type { RevealIndex, RevealedValue } from '../utils/aiReveal';
// Edit/delete-existing-records feature: display labels + apply-time re-resolution
// live here (this shared component only gets append-only wiring).
import { annotateDestructiveEdits, hasDestructiveEdits, buildPatch, recordPhrase, findInContext } from '../utils/aiDestructive';
import { pruneUnchangedEdits } from '../utils/aiNoOp';
import { planAttachment, rejectionMessage, looksLikeFilePath, sniffFileType, ATTACH_ACCEPT } from '../utils/attachments';
import { isAppleTouch, emptyClipboardAdvice, emptyPasteAdvice, copiedNameOnlyAdvice, composerHint } from '../utils/platform';
import { applyMemberFieldEdit } from '../utils/aiApply';
import { PackRequest, resolveTopics } from '../utils/exportPack';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { useHiddenPeople } from '../contexts/HiddenPeopleContext';
import { markHiddenDatesForChat } from '../utils/hiddenPeople';
import { useWillsAccess } from '../hooks/useWillsAccess';
import { useT } from '../i18n/LangContext';
import { compressImageToAvatar } from '../utils/imageCompress';
import ImageLightbox from './ImageLightbox';
import { looksLikePdf } from '../utils/fileType';
import { computeFileHash, findLikelyDuplicate, findLikelyDuplicateByType, DupMatch } from '../utils/documentDedup';
import {
  Sparkles, Send, Loader2, Check, X, Wand2, User, Bot, MessageSquarePlus, Search,
  Paperclip, FileText, Image as ImageIcon, Mic, MicOff, AlertTriangle, Camera,
  ClipboardPaste, ChevronRight, CalendarClock, Undo2, ChevronDown, ScanLine,
  FolderDown, MessageCircleQuestion, Quote, RefreshCw, IdCard, Copy,
} from 'lucide-react';
import DocumentAskModal, { type DocumentAskModalDoc } from './DocumentAskModal';
import type { ScannedFile } from './DocumentScannerModal';
// Lazy: this camera-UI component pulls in jsPDF (page-compile) — deferring it
// keeps that weight out of every chat-panel load for the majority of visits
// that never touch the scanner (only mounted once scannerEverOpened, below).
const DocumentScannerModal = React.lazy(() => import('./DocumentScannerModal'));
import { speechLocaleFor } from '../utils/speechLocale';
import { UndoRecord, landingLabel, countIrreversibleEdits } from '../utils/aiUndo';
import { isHhMm, isIsoDate, referralStatusForAppointment } from '../utils/referralAppointment';
import { readLastGoogleImport } from '../utils/googleCalendarImport';

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
  /* A household TRADESPERSON — plumber, electrician, boiler service, locksmith,
   * the neighbour with the spare key. Its own kind rather than a stretched
   * 'provider' or 'contact': provider's `type` is a closed enum of medical and
   * financial professionals (VALID_PROVIDER_TYPES in aiApply.ts) with no room
   * for a trade, and a contact is a person you phone rather than a trade you
   * book — a contact carries no trade, no account reference and no "our usual"
   * flag, which are the three things that make this list worth having when a
   * pipe bursts. `trade` is matched case-insensitively against VendorTrade in
   * aiApply.ts; anything unrecognised lands as 'Other' with the word the model
   * used kept in notes rather than thrown away. */
  | { kind: 'vendor'; name: string; trade?: string; company?: string; phone?: string; afterHoursPhone?: string; accountRef?: string; lastServiceDate?: string; isUsual?: boolean; notes?: string }
  /* A non-resident parent/guardian, attached to an EXISTING member's own
   * profile (see NonResidentGuardian in types.ts). CONTACT INFO ONLY — same
   * trust level as 'contact'/'provider' above. Deliberately does NOT carry any
   * document/photo field: a custody letter or ID copy is manual-upload-only,
   * through MemberGuardians.tsx's own upload button, so a person explicitly
   * chooses which guardian record a legal document attaches to rather than it
   * being auto-filed from a scan — the same boundary avatarUrl draws. See
   * aiEditCoverage.test.ts's COVERAGE_MAP entry for nonResidentGuardians. */
  | { kind: 'guardian'; member: string; name: string; relationship?: string; relationshipOther?: string; phone?: string; email?: string; address?: string; notes?: string }
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
      referralKind?: ReferralKind | string; referralDate?: string; referralReason?: string; referralProvider?: string;
      /** The date printed on the document (YYYY-MM-DD) — what places it on the life timeline. Never the upload date. */
      documentDate?: string;
      /** The APPOINTMENT the letter books ("Termin am 22.09. um 10:30") — YYYY-MM-DD / HH:MM. Not referralDate, which is the date printed on the letter. */
      appointmentDate?: string; appointmentTime?: string }
  | { kind: 'calendar_event'; title: string; date: string; time?: string; category?: string; memberNames?: string[]; endDate?: string; destination?: string; /** Only when the user asks to mark or un-mark it — medical appointments are important on their own. */ important?: boolean }
  | { kind: 'list_add'; list: 'vehicles' | 'pets' | 'utilities' | 'banks' | 'insurance' | 'benefits' | 'timeline' | 'shopping'; item: Record<string, string> }
  | { kind: 'asset'; name: string; category?: string; assignedMember?: string; make?: string; model?: string; serialNumber?: string; purchaseDate?: string; purchasePrice?: string; notes?: string; imageIndex?: number; photoUrl?: string }  // imageIndex picks which attached photo is this item's, when multiple were sent in one turn; photoUrl is filled client-side after Apply — never sent by the model
  | { kind: 'recipe'; title: string; ingredients: string[]; steps: string[]; tags?: string[]; imageIndex?: number; photoUrl?: string }  // imageIndex picks which attached photo is this recipe's, when multiple were sent in one turn; photoUrl is filled client-side after Apply — never sent by the model
  | { kind: 'slip'; shop?: string; item: string; purchaseDate?: string; amount?: string; currency?: string; assignedTo?: string; returnByDate?: string; warrantyUntil?: string; notes?: string; imageIndex?: number; photoUrl?: string; photoStoragePath?: string }  // a purchase receipt/till slip — imageIndex picks which attached photo is this slip's, when multiple were sent in one turn; photoUrl/photoStoragePath are filled client-side after Apply — never sent by the model
  /* The `field` union must stay in step with HOUSEHOLD_SET_FIELDS in
   * utils/aiApply.ts — that Set is the runtime gate, this is the compile-time
   * one, and a name in only one of them is either a silently-dropped edit or a
   * type that lies. The lock/key fields are the locksmith case (see
   * HouseholdInfo in types.ts). */
  | {
      kind: 'household_set';
      field: 'address' | 'doorCode' | 'wifiName' | 'wifiPassword' | 'garageCode'
        | 'lockBrand' | 'keyCardNumber' | 'spareKeyWith' | 'safeBrand' | 'safeSerial' | 'alarmProvider' | 'alarmCode';
      value: string;
    }
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
  // A yearly recurring date the family wants to remember — a wedding
  // anniversary, Valentine's Day, and the like. `date` is 'MM-DD', recurring
  // with no year, same convention as a member's name_day. `anniversaryKind`
  // is named to avoid colliding with this edit's own `kind` discriminant (the
  // same reason `estate_record` calls its type field `docKind`, not `kind`).
  // memberNames resolves to memberIds client-side, the same as calendar_event
  // above — optional, since a date like Valentine's Day may tag nobody.
  | { kind: 'anniversary'; title: string; anniversaryKind?: AnniversaryKind; date: string; originalYear?: number; memberNames?: string[]; notes?: string }
  /* A birthday for someone who ISN'T a family member — a grandparent, a
   * godparent, a friend. `date` is MM-DD because the day is what recurs and
   * the birth year is often simply not known; originalYear is separate and
   * optional, and powers the age count when it IS known. Replaces the old
   * habit of filing these onto a contact's `birthdate`, which never reached
   * the calendar — see utils/extendedBirthdaySources.ts. */
  | { kind: 'extended_birthday'; name: string; relationship?: string; date: string; originalYear?: number; notes?: string }
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
  // The same thing for the PROPERTY: work done on the house, by a tradesperson
  // or by anyone else. Appends onto HouseholdInfo.homeServiceLog. There is only
  // one house, so unlike service_record there is nothing to match against — it
  // always has somewhere to land. `by` is a name; when it matches a vendor in
  // the directory, aiApply stamps the link, but the name is stored either way
  // so the record survives that vendor being deleted. Store-and-recall only:
  // what the invoice or the user said, never a verdict ("that's overdue").
  | { kind: 'home_service'; records: { date: string; work: string; by?: string; trade?: string; area?: string; cost?: string; warrantyUntil?: string; notes?: string }[] }
  | { kind: 'pet_health'; records: { pet?: string; date: string; what: string; type?: string; vet?: string; cost?: string; nextDue?: string; notes?: string }[] }
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
  | { kind: 'trip_attach'; document: string; trip?: string; role?: string; member?: string }  // link an EXISTING vault document (by its name) into a trip's travel pack — resolved client-side in aiApply.applyTripAttachEdits; ids never travel through the model. Applied in a SECOND onApplyEdits pass after fileScans, so "here's the scan, attach it to the travel pack" works in one message.
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
  /* A folder the assistant offered to prepare — "all Mia's medical reports
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
  /* ID numbers the assistant pointed at, resolved by THIS browser and rendered
   * below the bubble. See utils/aiReveal.ts for the whole design.
   *
   * Persisted nowhere, for the same reason readResult isn't: slimForCloud
   * strips it before localStorage, and saveChatHistory's field list (db.ts)
   * never picked it up. Reopening the conversation shows the reply with the
   * numbers gone — which is right, because the number was never the message,
   * it was a lookup the browser performed while the user was watching. */
  reveals?: RevealedValue[];
  /* True when the model named more numbers than one message will show. Carried
   * so the UI can SAY the list was cut rather than serve a short one silently. */
  revealsTruncated?: boolean;
  /* A vault-wide search the assistant asked for, and what it found.
   *
   * Same contract as readDoc and for the same reason: the model contributes a
   * query string and receives nothing back. The sweep runs in this browser
   * against text this browser extracted, so the passages below a result have
   * never been anywhere a model could read them.
   *
   * Never persisted — slimForCloud strips all four fields. The passages are a
   * lookup performed while the user watched, not part of the conversation, and
   * writing lease text into a history that gets replayed into the chat model
   * would hand it exactly what this design keeps away from it. Reopening an old
   * conversation shows the question, not the clauses. */
  search?: { query: string };
  searchKey?: string;
  searchPending?: boolean;
  searchProgress?: { done: number; total: number };
  searchResult?: VaultSearchOutcome;
  searchError?: string;
  readError?: string;
  applied?: boolean;
  image?: string;             // legacy single dataUrl preview — kept for messages persisted before multi-attach
  images?: string[];          // dataUrl previews on a user message — swapped to Storage URLs once uploaded, see send()
  sourceImage?: Attachment;   // legacy single source — kept for messages persisted before multi-attach
  sourceImages?: Attachment[]; // carried on the assistant message so 'document' edits can file the right scan
  warnings?: string[];        // client-side safety-net notices (e.g. a likely-missed passport record) — display only, never persisted server-side
  /** Edits dropped because applying them would have changed nothing (see utils/aiNoOp) — reassurance, not a warning; display only. */
  alreadySaved?: string[];
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
/**
 * The bubble shown while every document is being swept, and the one after.
 *
 * Written here for the same reason readingLine is: the model reliably opens
 * with what it cannot do, and "I can't see inside your documents" is a refusal
 * of the exact thing happening on screen. Both lines claim only what the APP is
 * doing — searching filed documents for a phrase — and nothing whatsoever about
 * what is in them. The result card underneath is the only thing that says what
 * was found, and it says it in the documents' own words.
 */
function searchingLine(q: string): string {
  return `Searching your filed documents for “${q}” — you'll see the documents' own wording, not mine.`;
}

function searchDoneLine(q: string): string {
  return `Searched your filed documents for “${q}”. Here's what came up, in their own wording.`;
}

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

/**
 * One matching passage, with the query's words marked.
 *
 * The marks are offsets docSearch computed against the very string it is
 * slicing, so this renders them positionally rather than searching the text
 * again. Re-finding the words here would be a second, independent matcher that
 * could disagree with the one that ranked the document — and a highlight that
 * lands on the wrong word quietly undermines the only promise this feature
 * makes, which is that these are the document's words and not ours.
 */
function MarkedSnippet({ text, marks }: { text: string; marks: [number, number][] }) {
  if (!marks.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  marks.forEach(([a, b], i) => {
    if (a > at) out.push(text.slice(at, a));
    out.push(<mark key={i} className="bg-honey-200 text-ink-900 rounded px-0.5">{text.slice(a, b)}</mark>);
    at = b;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

/**
 * What a vault-wide search found, under the message that asked for it.
 *
 * Three things share this card, and the third is the one that earns it:
 *
 *  1. the ranked documents, each with the passages that matched, verbatim;
 *  2. a way into the full reader for any of them, because a keyword match is a
 *     signpost and the reader is the thing that actually reads a document;
 *  3. THE ACCOUNTING. How many documents were searched, how many are scans with
 *     no text layer, how many failed to load, how many are out of bounds. This
 *     is not a footnote. "Nothing found" is unreadable without it — a family
 *     whose six most relevant papers are phone photographs would otherwise be
 *     told, in effect, that their vault does not contain what it plainly does.
 */
function VaultSearchCard({
  msg, onOpen,
}: {
  msg: ChatMessage;
  onOpen: (target: { id: string; name: string; question: string }) => void;
}) {
  const query = msg.search?.query || '';

  if (msg.searchPending) {
    const p = msg.searchProgress;
    return (
      <div className="rounded-2xl border border-ink-200 bg-white/70 px-3 py-3 text-[13px] text-ink-600 flex items-center gap-2">
        <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
        <span className="min-w-0 truncate">
          {p && p.total > 1
            /* The count is named because the first search on a device reads
             * every document, and a spinner with no number attached to it is
             * indistinguishable from one that has hung. */
            ? `Looking through your documents — ${p.done} of ${p.total}…`
            : 'Looking through your documents…'}
        </span>
      </div>
    );
  }

  if (msg.searchError) {
    return (
      <div className="rounded-2xl border border-ink-200 bg-white/70 px-3 py-3 text-[13px] text-ink-600">
        {msg.searchError}
      </div>
    );
  }

  const r = msg.searchResult;
  if (!r) return null;
  const coverage = coverageLine(r);

  return (
    <div className="rounded-2xl border border-ink-200 bg-white/70 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-100 text-[11.5px] font-semibold uppercase tracking-wide text-ink-600">
        <Search className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 min-w-0 truncate">
          {r.hits.length
            ? `${r.hits.length} document${r.hits.length === 1 ? '' : 's'} mention “${query}”`
            : `Nothing found for “${query}”`}
        </span>
      </div>

      {r.hits.length > 0 && (
        <ul className="divide-y divide-ink-100">
          {r.hits.map((h) => (
            <li key={h.docId} className="px-3 py-2.5 space-y-1.5">
              <div className="flex items-start gap-2">
                <FileText className="w-3.5 h-3.5 shrink-0 mt-0.5 text-ink-400" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-ink-800 break-words">{h.name}</div>
                  <div className="text-[11.5px] text-ink-500">{h.category}</div>
                </div>
              </div>

              {h.snippets.map((sn, i) => (
                <blockquote
                  key={i}
                  className="ml-5 border-l-2 border-ink-200 pl-2 text-[12.5px] leading-relaxed text-ink-700"
                >
                  <span className="text-[11px] text-ink-400 mr-1">p.{sn.page}</span>
                  …<MarkedSnippet text={sn.text} marks={sn.marks} />…
                </blockquote>
              ))}

              {/* A name-only hit says so. Without this line a scan that matched
                * its filename and quoted nothing looks like a document whose
                * contents were searched and found to say very little. */}
              {h.snippets.length === 0 && (
                <div className="ml-5 text-[12px] text-ink-500">
                  {h.matchedName
                    ? 'Matched on the name — this one is a scan with no readable text, so its contents were not searched.'
                    : 'No passage to quote from this one.'}
                </div>
              )}

              <button
                type="button"
                onClick={() => onOpen({ id: h.docId, name: h.name, question: query })}
                className="ml-5 text-[12px] font-semibold text-honey-800 underline underline-offset-2 cursor-pointer"
              >
                Read this one properly
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="px-3 py-2 border-t border-ink-100 text-[11.5px] text-ink-500 space-y-1">
        <div>
          {r.searched === 1 ? 'Searched the text of 1 document.' : `Searched the text of ${r.searched} documents.`}
          {coverage ? ` ${coverage}` : ''}
        </div>
        {!r.hits.length && (
          /* Offered because the sweep is free. The reader costs an AI action
           * per document and the user has to pick one; this costs nothing and
           * they can try as many words as they like. */
          <div>These are word matches, so a different word often works — try what the document itself would say.</div>
        )}
      </div>
    </div>
  );
}

function slimMembers(members: FamilyMember[], revealIndex: RevealIndex) {
  return members.map(m => {
    const { avatarUrl, documents, digitalAccounts, favorites, growthHistory, referrals, nonResidentGuardians, ...rest } = m as any;
    return {
      // Government identity numbers (identifiers) and bank/routing numbers
      // (financialAccounts) were riding along inside ...rest — see aiRedact.ts
      // for exactly what goes and what deliberately stays.
      ...redactMember(rest),
      /* The CATALOGUE of ID numbers on file for this person — {id, label} only,
       * never a value. redactMember above has just deleted every one of these
       * numbers from what leaves the browser, and that is unchanged; this is
       * the list of handles the model may point AT, so it can stop telling
       * people a number it holds no copy of is unreachable. Resolution happens
       * back in this browser against a map it built itself. utils/aiReveal.ts
       * has the full reasoning, including what is deliberately NOT here (bank
       * accounts, door codes, the free-text "Important Numbers" values).
       *
       * Omitted entirely when empty so the model is never shown an empty array
       * and tempted to explain it. */
      revealable: revealIndex.handlesByMember.get((m as any).id) || undefined,
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
        appointmentDate: r.appointmentDate, appointmentTime: r.appointmentTime,
      })),
      /* Non-resident guardians: contact fields only, never the attached
       * documents' bytes. These were about to ride along untouched inside
       * ...rest the same way referrals once did (see the comment above) —
       * each guardian's `documents` array holds inline base64 FamilyDocument
       * data (custody papers, ID copies), and sending that on every chat turn
       * would repeat exactly the mistake the referrals fix above corrected.
       * Contact fields stay so the assistant can dedupe ("Mia already has a
       * guardian named Alex on file") and answer read-only questions; only
       * document METADATA is kept, matching the `documents` line above. */
      nonResidentGuardians: (nonResidentGuardians || []).map((g: any) => ({
        id: g.id, name: g.name, relationship: g.relationship, relationshipOther: g.relationshipOther,
        phone: g.phone, email: g.email, address: g.address, notes: g.notes,
        documents: (g.documents || []).map((d: any) => ({ id: d.id, name: d.name, category: d.category, uploadedAt: d.uploadedAt })),
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
  const { uid, familyId, isAdmin } = useFamilyCtx();
  const { hidden: hiddenPeople } = useHiddenPeople();

  /* Which copy button last fired, so it can show a tick instead of staying
   * mute. A copy is invisible by definition — nothing on screen changes, and
   * the clipboard is somewhere else — so without this the only way to find out
   * whether the tap registered is to go and paste it somewhere. Keyed by the
   * handle id (or `all:<message index>` for the whole card) so exactly one
   * button acknowledges, not every button on every card. */
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyReveal = (key: string, text: string) => {
    // Fire-and-forget: a clipboard rejection (permission, insecure context)
    // must not throw out of an onClick. The tick is only shown on success, so
    // a silent failure stays silent rather than claiming a copy that
    // did not happen.
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedKey(key);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedKey(null), 1600);
    }).catch(() => {});
  };
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);
  const { mayRead: mayReadWills } = useWillsAccess();
  const { lang, t } = useT();
  const suggestions = buildSuggestions(members, isBusinessSpace);
  /* Starts empty on purpose. Restoring here looks right but cannot work:
     familyId is still null on the first render, so it would read the 'none'
     bucket rather than this space's. The cached conversation is hydrated in the
     effect below, the moment the space is known. */
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // A scan/send/apply/undo can take a while, and closing the chat panel fully
  // UNMOUNTS this component (see AssistantBubble.tsx's `{open && <AIChatbot/>}`)
  // — the in-flight async work keeps running (nothing aborts a fetch on
  // unmount), but every persistence call below used to be nested inside a
  // setMessages(prev => {...}) updater, coupling "does this get saved" to
  // whether React still processes a state update for an already-unmounted
  // component — never a guarantee worth relying on for a network write. This
  // ref mirrors `messages` on every render (kept in sync by the effect right
  // after it's declared below `messages`) so the six persistence sites can
  // compute off it directly and call saveChatHistory as a plain, unconditional
  // statement — a Firestore write that runs to completion regardless of
  // mount state, same as the fetch that produced it. The visible messages
  // list still updates the normal way via setMessages; this only decouples
  // *persistence* from *mount*.
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
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

  /**
   * Sweep every filed document for a phrase, here in the browser.
   *
   * The counterpart to runInlineRead, and deliberately cheaper: that one spends
   * an AI action per document because the server reads the document properly.
   * This one spends nothing at all. It fetches each document once, extracts its
   * text once, caches that on the device, and from then on a search is a
   * keyword match over data already in hand — which is what makes "try another
   * word" a reasonable thing to suggest rather than an invoice.
   *
   * loadDocuments() runs here, not on the message, so download URLs stay out of
   * the transcript — same rule as the reader.
   */
  const runVaultSearch = useCallback(async (query: string, searchKey: string) => {
    const patch = (p: Partial<ChatMessage>) =>
      setMessages((prev) => prev.map((m) => (m.searchKey === searchKey ? { ...m, ...p } : m)));

    try {
      const docs = await loadDocuments();
      const candidates = (docs || [])
        .filter((d) => d && d.id && d.downloadUrl)
        .map((d) => ({
          id: d.id,
          name: d.name,
          category: d.category,
          fileType: d.fileType,
          src: d.downloadUrl,
          contentHash: d.contentHash,
          fileSize: d.fileSize,
          uploadedAt: d.uploadedAt,
        }));

      if (!candidates.length) {
        patch({
          searchPending: false,
          searchError: "There aren't any documents filed yet, so there was nothing to search. File one from the Documents screen and I can look through it.",
        });
        return;
      }

      const result = await searchVault(familyId || 'local', candidates, query, {
        isBusinessSpace,
        // Progress matters more here than in the reader: the first search on a
        // device extracts every document, which is slow in a way that looks
        // broken if nothing on screen moves.
        onProgress: (p) => patch({ searchProgress: { done: p.done, total: p.total } }),
      });
      patch({ searchPending: false, searchProgress: undefined, searchResult: result });
    } catch {
      patch({
        searchPending: false,
        searchProgress: undefined,
        searchError: "I couldn't search your documents just now — please try again.",
      });
    }
  }, [familyId, isBusinessSpace]);

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
  const [error, setErrorText] = useState<string | null>(null);
  // Some errors have an obvious next step, and telling someone to "tap the
  // paperclip" is worse than simply offering the paperclip. `setError` keeps
  // its old one-argument shape so every existing call site clears the action
  // for free — only the one that has a next step passes it.
  const [errorAction, setErrorAction] = useState<'pick' | null>(null);
  const setError = (msg: string | null, action: 'pick' | null = null) => {
    setErrorText(msg);
    setErrorAction(msg ? action : null);
  };
  // Undo-last-apply: which applied card is asking "Undo this?" for confirmation,
  // and which is mid-undo (so its control shows a spinner and can't double-fire).
  // Which edit cards are expanded, keyed by message index. Undefined means
  // "use the default", which is collapsed once there are more than two.
  const [expandedEdits, setExpandedEdits] = useState<Record<number, boolean>>({});
  const [confirmingUndoIdx, setConfirmingUndoIdx] = useState<number | null>(null);
  const [undoingIdx, setUndoingIdx] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Read once: the answer cannot change while the panel is open, and it is
  // used only to choose wording (see utils/platform.ts).
  const appleTouch = useMemo(() => isAppleTouch(), []);
  // Progressive word-by-word reveal of the latest assistant reply — null means
  // "not streaming" (either no reply yet, or the reveal has finished).
  const [streamWordCount, setStreamWordCount] = useState<number | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Mount the (lazy) scanner once, the first time it's actually opened, and
  // never unmount it again — same reasoning as Dashboard.tsx's ExportPackModal.
  const [scannerEverOpened, setScannerEverOpened] = useState(false);
  useEffect(() => { if (scannerOpen) setScannerEverOpened(true); }, [scannerOpen]);
  // Heads-up card: vehicles + slips + insurance aren't in `members`, so load
  // them once (same sources NeedsAttention uses) to feed the deterministic
  // expiry/gap index. hInsurance feeds computeFuneralCoverNudges — a lapsed
  // funeral policy is exactly the kind of thing this card exists to surface.
  const [hVehicles, setHVehicles] = useState<Vehicle[]>([]);
  const [hSlips, setHSlips] = useState<SlipItem[]>([]);
  const [hInsurance, setHInsurance] = useState<InsurancePolicy[]>([]);
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
  const inputRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Push `input` into the box when something OTHER than typing changed it —
  // dictation, an "ask this about the photo" chip, clearing on send, restoring
  // a failed message. The equality guard is what makes this safe: while you
  // type, state and DOM already agree, so this no-ops and never touches the
  // caret. Without it every keystroke would rewrite the node and bounce the
  // caret to the start.
  //
  // No autosize maths any more — a contenteditable grows on its own, and its
  // max-height class takes over from there.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if ((el.textContent || '') === input) return;
    el.textContent = input;
    // Programmatic writes put the caret at position 0, which makes dictating a
    // second sentence type it backwards into the first. Send it to the end.
    if (input && document.activeElement === el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
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
  /* Both storage paths run through here: Firestore (saveChatHistory) and this
   * device's localStorage cache.
   *
   * `reveals` and `revealsTruncated` are destructured off and thrown away, and
   * that is the ONLY thing standing between a passport number and disk. The
   * spread below is `...m`, so anything not named here survives — db.ts's
   * saveChatHistory happens to re-pick an explicit field list and would have
   * dropped them anyway, but localStorage.setItem takes this output verbatim
   * and would have written every revealed ID number into the device cache in
   * plaintext, where nothing ever expires it. Naming them here rather than
   * relying on the other end's field list is the difference between the
   * guarantee holding by design and holding by coincidence.
   *
   * Same rule and same reason as readResult (patchRead never saves): a value
   * that is cheap to look up again and expensive to leak is looked up again. */
  const slimForCloud = (msgs: ChatMessage[]) =>
    msgs.map(({ image, sourceImage, images, sourceImages, reveals, revealsTruncated,
               search, searchKey, searchPending, searchProgress, searchResult, searchError, ...m }) => {
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
    loadFinances().then((f) => { if (!cancelled) setHInsurance(f?.insurance || []); }).catch(() => { if (!cancelled) setHInsurance([]); });
    loadAiUsage().then((u) => { if (!cancelled) setAiUsage(u); }).catch(() => { if (!cancelled) setAiUsage(null); });
    return () => { cancelled = true; };
  }, [familyId]);

  // Deterministic expiry/gap index for the heads-up card — same function that
  // feeds buildContext, so the card and the AI agree. Recomputed only when its
  // inputs change.
  const insights = useMemo(
    () => computeChatInsights({ members, vehicles: hVehicles, slips: hSlips, insurance: hInsurance }),
    [members, hVehicles, hSlips, hInsurance],
  );
  const headsUp = [...insights.expiries, ...insights.gaps].slice(0, 4);
  const dismissHeadsUp = () => { markHintSeen(headsUpKey); setHeadsUpDismissed(true); };

  const startNewChat = () => {
    stopStreaming();
    setMessages([]);
    setError(null);
    setInput('');
    setAttachments([]);
    // All the per-message card state below is keyed by ARRAY INDEX, not a
    // stable message id — resetting `messages` to [] restarts indices at 0,
    // so without this, the new chat's first proposal card would silently
    // inherit whatever docDuplicates[0]/expandedEdits[0]/etc. was left over
    // from the previous chat: an "Applied" tick on a message never applied,
    // a duplicate-doc warning that belonged to a different upload, or a card
    // stuck mid-spinner. Found 2026-08-15, chat-function audit.
    setApplyingIdx(null);
    setDocDuplicates({});
    setExpandedEdits({});
    setConfirmingUndoIdx(null);
    setUndoingIdx(null);
    try { localStorage.removeItem(chatKey(familyId, uid)); } catch { /* ignore */ }
    if (uid) saveChatHistory(uid, []);
  };

  const buildContext = async () => {
    const [info, household, finances, timeline, docs, events, spaceInfo, slips, hubSettings, assets, recipes, familyWords, willsEstate, shopping, anniversaries, extendedBirthdays] = await Promise.all([
      loadFamilyInfo(), loadHousehold(), loadFinances(), loadTimeline(), loadDocuments(), loadCalendarEvents(), loadSpaceInfo(), loadSlips(), loadSettings(), loadAssets(),
      loadRecipes(), loadFamilyWords(), mayReadWills ? loadWillsEstate() : Promise.resolve(null), loadShopping(), loadAnniversaries(), loadExtendedBirthdays(),
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
        // Set means it is already on the life timeline — nothing to add there.
        docDate: d.docDate,
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
    const insights = computeChatInsights({ members, vehicles: household?.vehicles || [], slips: slips || [], insurance: finances?.insurance || [] });
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
      // When this device last brought Google Calendar in (null = never, here).
      // Lets "when is my appointment?" be answered honestly when the answer
      // is "your Google Calendar hasn't synced for two weeks" rather than
      // "you have nothing booked". See utils/googleCalendarImport.ts.
      googleLastImportedAt: readLastGoogleImport(auth.currentUser?.uid, familyId),
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
    // Recipe Book: unlike assetsCtx above, the ingredients/steps ARE the thing
    // a family would actually ask the assistant for — "what's in Mama's
    // lasagne" needs the recipe's substance, not just its title — so this rides
    // through closer to full, the way `timeline` does below, rather than being
    // slimmed to identifiers only. id still carries through for the same
    // delete_record/update_record targeting reason as assets/slips/documents.
    // photoUrl (the Storage URL of the original card/page photo) is the one
    // field dropped: no value to a text model, and it would just burn tokens on
    // every turn.
    const recipesCtx = (recipes || []).map(r => ({
      id: r.id, title: r.title, ingredients: r.ingredients, steps: r.steps, tags: r.tags,
    }));
    // Family Dictionary (invented/mangled words the family adopted). Small,
    // content-only records with nothing bulky or binary on them, so — unlike
    // assetsCtx — passed through in full rather than slimmed. The point of
    // surfacing these at all is to let the assistant answer "what does
    // 'boo-blerries' mean?" and recognise a word it's already been told about,
    // instead of filing a near-duplicate the next time it hears the same story.
    const familyWordsCtx = familyWords?.words || [];
    // Wills & Estate: store-and-recall only (see WillsEstateDoc in types.ts) —
    // "where's the will" and "who's the executor" are exactly the questions
    // this feature exists to answer, so nothing here gets redacted the way
    // household/finances secrets do (see redactHousehold/redactFinances below).
    // records carry ids for the same delete_record/update_record targeting
    // reason as assets/slips/documents above. successor and instructions are
    // single objects rather than arrays, so — like familyWordsCtx — they ride
    // through unslimmed; there's nothing bulky/binary on either to strip.
    //
    // Since v230 this document is admin-and-named-readers-only, so for anyone
    // else it isn't loaded at all and `willsEstate` is null — the assistant
    // then simply has no estate context and answers "I don't have that",
    // which is the honest answer for someone who can't open the screen. The
    // gate is here as well as in the rule because the assistant is the one
    // surface that would happily read the whole vault out loud.
    const willsEstateCtx = {
      records: willsEstate?.records || [],
      successor: willsEstate?.successor,
      instructions: willsEstate?.instructions,
    };
    // Shopping list: tiny, content-only records (name/checked/addedAt, no
    // binary fields), so — like familyWordsCtx — passed through in full. Lets
    // the assistant answer "is milk on the list?" and avoid adding a duplicate
    // "Milk" entry when asked to add one that's already there.
    const shoppingCtx = shopping || [];
    // Anniversaries & Special Days: small, content-only records (no binary
    // fields), so — like familyWordsCtx and shoppingCtx — passed through in
    // full rather than slimmed. id carries through for the same
    // delete_record/update_record targeting reason as assets/slips/documents,
    // even though that targeting isn't wired up yet (see aiDestructive.ts) —
    // cheap to include now, and free of a second pass if it ever is.
    const anniversariesCtx = anniversaries || [];
    // Extended Family & Friends' Birthdays: READ-ONLY context for now — the
    // assistant can answer "when is grandma's birthday" but there's no
    // create/update/delete op wired for this doc yet (see ExtendedBirthday
    // in types.ts; deliberately scoped out of the 2026-08-19 pass alongside
    // the CRUD view itself, same "ship the core value first" call as the
    // rest of this feature).
    const extendedBirthdaysCtx = extendedBirthdays || [];
    // info.numbers is the one free-text bucket in the vault — nothing forces
    // what goes in the "value" of an "Important Numbers" entry, so unlike
    // every other field here it cannot be redacted by naming a key. Strip the
    // value unconditionally rather than send it to Gemini on every turn.
    const infoCtx = info ? { ...info, numbers: redactInfoNumbers(info.numbers) } : info;
    // Life timeline: the moments ride through whole, except their photos —
    // Storage URLs are no use to a text model — which become a count.
    const timelineCtx = timeline
      ? { ...timeline, entries: (timeline.entries || []).map(({ photos, ...rest }) => (photos?.length ? { ...rest, photoCount: photos.length } : rest)) }
      : timeline;
    /* Built HERE, from the same `members` slimMembers is about to redact, and
     * returned to send() so the request and the response that answers it are
     * resolved against one snapshot. Not a ref and not state on purpose: the
     * value map must not outlive the turn that produced it, and a stale index
     * would resolve a handle to a number the family has since corrected. */
    const revealIndex = buildRevealIndex(members, { isAdmin });
    // "Hide Nora's dates": the records stay, so a direct question still gets
    // an answer; each of that person's dates carries datesHidden:true and the
    // server's HIDDEN DATES rule keeps the assistant from bringing them up on
    // its own. A no-op when nobody is hidden.
    const context = markHiddenDatesForChat({ members: slimMembers(members, revealIndex), info: infoCtx, household: redactHousehold(household), finances: redactFinances(finances), timeline: timelineCtx, documents, calendar: calendarForChat(boundCalendar(events || []), { business: !!isBusinessSpace }), isBusinessSpace: !!isBusinessSpace, spaceInfo: spaceInfoCtx, expiries, gaps, slips: slips || [], assets: assetsCtx, hubStatus: hubStatusCtx, calendarSync: calendarSyncCtx, recipes: recipesCtx, familyWords: familyWordsCtx, willsEstate: willsEstateCtx, shopping: shoppingCtx, anniversaries: anniversariesCtx, extendedBirthdays: extendedBirthdaysCtx }, hiddenPeople);
    // `raw` NEVER LEAVES THE DEVICE. It is the same records, unredacted and
    // unslimmed, kept only so pruneUnchangedEdits can answer "would applying
    // this edit change anything?" against what is actually stored. The
    // redacted `context` above cannot answer that: aiRedact strips identity
    // numbers and bank credentials entirely, so an ID number that is already
    // on file looks, from the context copy, like a brand-new value — exactly
    // the edits we most want to recognise as no-ops. Same shape as `context`
    // on purpose, so findInContext() can walk it unchanged.
    // Only `context` is put in the request body (see send()).
    const raw = { members, info, household, finances, timeline, documents, calendar: events || [], slips: slips || [], assets: assets || [] };
    return { context, raw, revealIndex };
  };

  // ONE INGEST PATH for every way a file can arrive — Attach, camera, paste,
  // drag-and-drop, the clipboard button. They used to be separate handlers
  // with separate ideas of what was allowed, and drag-and-drop did not exist
  // at all, so the same PDF succeeded or vanished depending on which gesture
  // you happened to reach for. Now the gesture only decides how the File
  // objects are obtained; what happens to them is decided in exactly one place.
  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) { setError(`You can attach up to ${MAX_ATTACHMENTS} files at once.`); return; }

    const next: Attachment[] = [];
    const rejected: { name: string; reason: string }[] = [];
    let overflow = 0;

    for (const file of files) {
      if (next.length >= room) { overflow++; continue; }
      const plan = planAttachment(file.name, file.type);
      if (plan.kind === 'reject') { rejected.push({ name: file.name, reason: plan.reason }); continue; }
      if (file.size > 20 * 1024 * 1024) {
        rejected.push({ name: file.name, reason: 'it’s over 20MB — send a smaller scan, or one page at a time.' });
        continue;
      }
      try {
        let dataUrl = await fileToDataUrl(file);
        let mimeType = plan.mimeType;
        if (plan.kind === 'image') {
          // 1200px @ 0.75 is plenty for OCR and keeps the payload small on a
          // phone. If the browser cannot decode the format — Chrome still
          // can't read HEIC, which is what every iPhone produces by default —
          // send the original bytes instead of losing the file: the model
          // reads HEIC directly even where <canvas> refuses to.
          try {
            dataUrl = await compressImageToAvatar(dataUrl, 1200, 0.75);
            mimeType = 'image/jpeg';
          } catch { /* keep the original bytes and their real type */ }
        }
        next.push({ name: file.name || `attachment-${attachments.length + next.length + 1}`, mimeType, dataUrl });
      } catch {
        rejected.push({ name: file.name, reason: 'it couldn’t be read — try attaching it again.' });
      }
    }

    if (next.length) setAttachments(prev => [...prev, ...next]);

    const notes: string[] = [];
    if (rejected.length) notes.push(rejectionMessage(rejected));
    if (overflow) notes.push(`You can attach up to ${MAX_ATTACHMENTS} files at once — ${overflow === 1 ? 'one was' : `${overflow} were`} left out.`);
    setError(notes.length ? notes.join(' ') : null);
  };

  const onPasteFiles = async (e: React.ClipboardEvent) => {
    const cd = e.clipboardData;
    if (!cd) return;

    // BOTH lists, because the browsers disagree about which one they fill.
    // Safari — iPad included — populates clipboardData.files for a pasted
    // image while items enumerates as empty, so reading items alone made
    // paste look dead on exactly the device this was reported from. Chrome
    // does the opposite for some sources. Collect from each and de-duplicate
    // on name+size+type, which is as much identity as a File exposes.
    const seen = new Set<string>();
    const collect = (f: File | null): File | null => {
      if (!f) return null;
      const key = `${f.name}|${f.size}|${f.type}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return f;
    };
    const files = [
      ...(Array.from(cd.items || []) as DataTransferItem[])
        .filter(it => it.kind === 'file')
        .map(it => collect(it.getAsFile())),
      ...(Array.from(cd.files || []) as File[]).map(f => collect(f)),
    ].filter((f): f is File => !!f);

    if (files.length) {
      // BEFORE any await. preventDefault only counts while the event is still
      // being dispatched, and naming the files below needs to read their bytes.
      e.preventDefault();
      // A pasted screenshot has no filename at all. Give it one before it
      // reaches addFiles so the attachment chip, the chat bubble and the filed
      // document don't all end up called "attachment-1" — and when there is no
      // type either, read the first bytes rather than assuming PNG, or a PDF
      // gets filed as a picture and quietly mangled.
      const named = await Promise.all(files.map(async (f, i) => {
        if (f.name) return f;
        const sniffed = f.type ? null : await sniffFileType(f);
        const type = sniffed?.mime || f.type;
        const ext = sniffed?.ext || f.type.split('/')[1] || 'png';
        return new File([f], `pasted-${i + 1}.${ext}`, { type });
      }));
      await addFiles(named);
      return;
    }

    // No file on the clipboard. Before letting the paste through, catch the
    // one case that looks broken: copying a file in Finder or Explorer puts
    // only its LOCATION on the clipboard, never its contents, so pasting types
    // a path into the message box and the document never arrives. Nothing is
    // wrong with the app, but nothing the user wanted happened either — so say
    // which two gestures do work rather than leaving a path sitting in the
    // box. Anything that isn't a bare path is ordinary text and is pasted.
    const pastedText = cd.getData('text/plain') || '';
    if (looksLikeFilePath(pastedText)) {
      e.preventDefault();
      setError(copiedNameOnlyAdvice(isAppleTouch()));
      return;
    }

    // Ordinary text into a RICH box. Left to itself the browser would paste
    // the source's markup — fonts, colours, links, whole table structures from
    // a web page — into a composer that sends plain text, so what you saw and
    // what got sent would differ. Insert the plain-text flavour by hand.
    // execCommand is deprecated and still the only insertion that survives in
    // the undo stack and fires `input` for React to pick up.
    if (pastedText) {
      e.preventDefault();
      document.execCommand('insertText', false, pastedText);
      return;
    }

    // Nothing at all: no file, no text, no types. The paste happened — this
    // handler only runs because it did — and the browser handed over an empty
    // DataTransfer.
    //
    // DO NOT NAME A CAUSE HERE. The previous wording blamed an in-app browser,
    // which is one cause of this and was the wrong one for the person reading
    // it (a home-screen PWA). iOS withholding a document copied in Files is
    // another; a clipboard that really was empty is a third; and this code
    // cannot tell them apart, because the whole symptom is that nothing
    // arrived to inspect. Say what happened, offer the route that always
    // works, and let the button do the explaining.
    if (!pastedText && !(cd.types || []).length) {
      setError(emptyPasteAdvice(isAppleTouch()), 'pick');
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
    try {
      const clipItems = await navigator.clipboard.read();
      const files: File[] = [];
      for (const clipItem of clipItems) {
        // Prefer a real document over a preview image: some apps put BOTH a
        // PDF and a rendered thumbnail of it on the clipboard, and the
        // thumbnail is the useless half.
        const type = clipItem.types.find(ty => ty === 'application/pdf')
          || clipItem.types.find(ty => ty.startsWith('image/'));
        if (!type) continue;
        const blob = await clipItem.getType(type);
        const ext = type === 'application/pdf' ? 'pdf' : (type.split('/')[1] || 'png');
        files.push(new File([blob], `clipboard-${files.length + 1}.${ext}`, { type }));
      }
      if (!files.length) {
        setError(emptyClipboardAdvice(isAppleTouch()));
        return;
      }
      await addFiles(files);
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
    await addFiles(files);
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
      const { context, raw, revealIndex } = await buildContext();

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
      // DROP THE EDITS THAT WOULD CHANGE NOTHING.
      //
      // Reading a document makes the model re-state every fact it recognises,
      // including the ones already on file — so a consent letter that names a
      // passport number comes back as an update_record setting that passport
      // to the number it already has. Applying it is harmless; SHOWING it is
      // not. update_record counts as destructive, so the Apply card renders
      // expanded and refuses to collapse, and a scan contributing two genuinely
      // new facts arrives as a nine-row batch with four rewrite-looking rows in
      // it. Train someone to skim past those and you have trained them to skim
      // past a real deletion — the noise attacks the safeguard directly.
      //
      // Compared against `raw`, never `context`: aiRedact strips identity
      // numbers out of what the model is sent, so the context copy would report
      // every already-saved ID number as a change. The lookups mirror the exact
      // merges apply performs, and every uncertain case (unknown field, missing
      // record, empty patch) keeps the edit — see utils/aiNoOp.ts for why that
      // asymmetry is what makes this safe to do without asking.
      const { edits: liveEdits, skipped: alreadySaved } = pruneUnchangedEdits(edits, {
        resolveMember: (name: string) => (resolveMemberByName(name) as unknown as Record<string, unknown>) || null,
        applyMemberField: (m, field, value) =>
          (applyMemberFieldEdit(m as unknown as FamilyMember, field, value) as unknown as Record<string, unknown>) || null,
        resolveUpdate: (targetKind, id, fields) => {
          const found = findInContext(raw, targetKind, id);
          if (!found) return null;
          const patch = buildPatch(targetKind, fields);
          if (!Object.keys(patch).length) return null;
          return { record: found.record, patch, phrase: recordPhrase(targetKind, found.record) };
        },
      });
      // NOTE the next block reads `edits`, NOT `liveEdits`, and must keep doing
      // so: it warns when a passport scan arrived with no structured passport
      // record beside it. A passport that is already on file is pruned above,
      // and treating that absence as "nothing was extracted" would fire the
      // warning on precisely the families who have nothing to fix.
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
      // "the whole household" and quietly turning "Mia's records" into
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

      /* A vault-wide sweep. Already length-capped and space-checked server-side
       * (sanitizeSearch); re-checked for shape only, because a malformed payload
       * should drop the search rather than throw. Unlike readDoc there is no id
       * to resolve — the query names nothing, it is just words to look for. */
      const rawSearch = (data as { search?: { query?: unknown } }).search;
      const searchReq = rawSearch && typeof rawSearch.query === 'string' && rawSearch.query.trim()
        ? { query: rawSearch.query.trim() }
        : undefined;

      /* The model named some ID numbers it thinks were asked for. It has never
       * seen one — only the {id,label} catalogue slimMembers put in `revealable`
       * — so this is a pointer, and the resolution is a lookup in a map THIS
       * browser built one request ago. An id that was never offered finds
       * nothing and is dropped, the same way the document reader drops an
       * unoffered document id. utils/aiReveal.ts carries the full design. */
      const { revealed, truncated: revealsTruncated } = resolveReveals(
        (data as { reveals?: unknown }).reveals,
        revealIndex,
      );

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
        // The model's prose is replaced for a search for exactly the reason it
        // is replaced for a read: told it cannot see document contents, it
        // opens by saying so, and that sentence lands directly above the
        // passages it claims not to have. See readingLine.
        text: readDoc ? readingLine(readDoc)
          : searchReq ? searchingLine(searchReq.query)
          : (data.reply || '…'),
        readKey: readDoc ? `${readDoc.id}::${performance.now()}` : undefined,
        readPending: !!readDoc,
        search: searchReq,
        searchKey: searchReq ? `s::${performance.now()}` : undefined,
        searchPending: !!searchReq,
        edits: liveEdits.length ? liveEdits : undefined,
        exportRequest,
        readDoc,
        sourceImages: persistedAtts.length ? persistedAtts : undefined,
        warnings: warnings.length ? warnings : undefined,
        // Reported, never silently swallowed. "Everything in that letter was
        // already saved" is a real answer about a document — and a batch that
        // quietly came back shorter than the model announced would be its own
        // small mystery.
        alreadySaved: alreadySaved.length ? alreadySaved.map(s => s.reason) : undefined,
        // Never persisted — see the field's doc comment on ChatMessage, and
        // slimForCloud, which strips it on the way to both storage paths.
        reveals: revealed.length ? revealed : undefined,
        revealsTruncated: revealsTruncated || undefined,
      };
      // Patch the earlier optimistic user message's images to the uploaded
      // Storage URLs too, so both sides of this exchange survive a reload.
      // Computed off messagesRef (not the setMessages updater's `prev`) and
      // persisted unconditionally BEFORE touching React state, so closing the
      // chat panel mid-request no longer loses the reply — see messagesRef's
      // doc comment above.
      const withUploadedImages = persistedAtts.length
        ? messagesRef.current.map(m => (m === userMsg ? { ...m, images: persistedAtts.map(a => a.dataUrl) } : m))
        : messagesRef.current;
      const updatedMessages = [...withUploadedImages, assistantMsg];
      if (uid) saveChatHistory(uid, slimForCloud(updatedMessages));
      setMessages(updatedMessages);
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
      // Same principle, no AI cost: the person has said what they are looking
      // for, so look for it rather than offering a button that would.
      if (searchReq && assistantMsg.searchKey) void runVaultSearch(searchReq.query, assistantMsg.searchKey);
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
  // The prompt constrains "category" to this list, but nothing enforces it at
  // the Gemini API level (no responseSchema) — an off-list string would sit in
  // VaultDocument.category forever, unrecognized by MEMBER_DOC_CAT above and
  // any UI that switches on it. Mirrors the same clamp Dashboard.tsx already
  // does for asset edits' category (pre-publish audit).
  const VALID_VAULT_CATS: VaultCategory[] = ['Identity', 'Education', 'Medical', 'Financial', 'Legal', 'Travel', 'Other'];
  const clampVaultCategory = (c: VaultCategory): VaultCategory => (VALID_VAULT_CATS.includes(c) ? c : 'Other');

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
  // person referenced elsewhere in the same batch (e.g. a passport edit for Mia
  // means this Identity scan is Mia's).
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
      // The fuzzy type-match ("same kind of document, different name") only
      // fires when we can actually name whose slot we're comparing against —
      // ownerId undefined (member not resolved) used to fall back to matching
      // every OTHER unowned document of the same category as "the same slot",
      // which cross-matched two different people's scans that both happened
      // to lack a resolved member (2026-08-17 audit). The byte-exact hash
      // check above still runs regardless of scope — it can't false-positive.
      const ownerId = resolveMemberByName(e.member)?.id;
      const match = findLikelyDuplicate({ fileName: fileName || '', fileSize: fileSize ?? 0, contentHash: hash }, existing)
        || (ownerId
          ? findLikelyDuplicateByType(e.name, existing.filter((d) => d.category === e.category && d.memberId === ownerId))
          : null);
      if (match) flags.push({ editIdx: i, name: e.name, match });
    }
    return flags;
  };

  // File the scanned image(s) for any 'document' edits: always into the shared
  // Document Vault, AND into the named member's own Documents tab when the AI
  // says who the document belongs to (e.g. Mia's passport). When multiple
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
      const category = clampVaultCategory(e.category);

      added.push({
        id, name: e.name, category,
        fileName, fileType, fileSize,
        // Attribute the vault copy to its owner. Without this, EVERY chat-filed
        // vault document had memberId undefined — so the Document Vault couldn't
        // show whose it was, and the assistant (which is sent the vault list) saw
        // an unowned doc and couldn't tell it apart from the person's profile.
        memberId: owner?.id,
        storagePath, downloadUrl, uploadedAt: today, uploadedBy: by, contentHash: hash || undefined,
        // The date printed on it is what puts it on the life timeline. A
        // referral's own date is the same fact, so it stands in when the model
        // gave only that; the timeline shows the referral row and hides this
        // copy, since they share a Storage object.
        docDate: [e.documentDate, e.referralDate].find(d => /^\d{4}-\d{2}-\d{2}$/.test(d || '')),
      });

      // Also file on the member's profile when we could identify the owner. Store
      // the Storage download URL (not the base64 image) so the member's Firestore
      // doc stays tiny and can never blow the 1 MiB limit — it renders the same,
      // since MemberDocuments/DocumentViewer use fileData directly as an <img src>.
      if (owner) {
        await onAddMemberDoc(owner.id, {
          id: 'doc-' + id,
          name: e.name,
          category: MEMBER_DOC_CAT[category] || 'Other',
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
          // A letter that states the appointment ("Termin am 22.09. um 10:30")
          // files as BOOKED with that date, which is what puts it on the
          // calendar grid (utils/referralAppointment.ts). Before 2026-09-13
          // every scanned referral filed 'open' with no appointment at all,
          // however plainly the letter gave one.
          const appointmentDate = isIsoDate(e.appointmentDate) ? e.appointmentDate : undefined;
          const appointmentTime = appointmentDate && isHhMm(e.appointmentTime) ? e.appointmentTime : undefined;
          const referral: ReferralRecord = {
            id: 'ref-' + id,
            kind: e.referralKind,
            date: /^\d{4}-\d{2}-\d{2}$/.test(e.referralDate || '') ? e.referralDate : undefined,
            providerName: e.referralProvider?.trim() || undefined,
            reason: e.referralReason?.trim() || undefined,
            status: referralStatusForAppointment('open', appointmentDate),
            ...(appointmentDate ? { appointmentDate } : {}),
            ...(appointmentTime ? { appointmentTime } : {}),
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
      // Each of the three blocks below uploads per-EDIT, not once for the whole
      // batch: with multiple photos attached in one turn (e.g. two recipe cards),
      // each edit's own imageIndex (defaulting to 0) picks which attached photo
      // is its — previously every edit of a kind shared srcs[0], so a second
      // recipe/slip/asset in the same batch silently got the first one's photo
      // (2026-08-17 audit).
      if (srcs.length && edits.some(e => e.kind === 'recipe')) {
        resolvedEdits = await Promise.all(resolvedEdits.map(async (e) => {
          if (e.kind !== 'recipe') return e;
          try {
            const src = srcs[e.imageIndex ?? 0] || srcs[0];
            const photoUrl = await uploadRecipePhoto(src.dataUrl);
            return { ...e, photoUrl };
          } catch {
            return e; // Non-fatal — recipe text below still gets saved without a photo.
          }
        }));
      }
      // A slip edit carries an optional photo of the receipt/till slip itself —
      // upload it now, same non-fatal pattern as the recipe photo above (thermal
      // till slips fade fast, so capturing the image is the point, but a failed
      // upload must not block saving the return/warranty dates the user gave).
      if (srcs.length && edits.some(e => e.kind === 'slip')) {
        resolvedEdits = await Promise.all(resolvedEdits.map(async (e) => {
          if (e.kind !== 'slip') return e;
          try {
            const src = srcs[e.imageIndex ?? 0] || srcs[0];
            const { url, storagePath } = await uploadSlipPhoto(src.dataUrl);
            return { ...e, photoUrl: url, photoStoragePath: storagePath };
          } catch {
            return e; // Non-fatal — slip text below still gets saved without a photo.
          }
        }));
      }
      // An asset edit carries an optional photo of the item itself (a serial
      // plate close-up, the item on a shelf) — upload it now, same non-fatal
      // pattern as recipe/slip above. Without this, photographing an item and
      // asking the assistant to file it produced a text-only record with the
      // photo silently dropped — the item on screen had no picture even though
      // the whole point of the message was a photo of it.
      if (srcs.length && edits.some(e => e.kind === 'asset')) {
        resolvedEdits = await Promise.all(resolvedEdits.map(async (e) => {
          if (e.kind !== 'asset') return e;
          try {
            const src = srcs[e.imageIndex ?? 0] || srcs[0];
            const photoUrl = await uploadAssetPhoto(src.dataUrl);
            return { ...e, photoUrl };
          } catch {
            return e; // Non-fatal — asset details below still get saved without a photo.
          }
        }));
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
      // trip_attach references a vault document BY NAME — one being filed by
      // fileScans in this very batch, as often as not ("here's the consent
      // letter, attach it to the travel pack"). So it runs in a SECOND
      // onApplyEdits pass, after the scan exists in the vault; everything else
      // keeps its original order.
      const dataEdits = resolvedEdits.filter(e => e.kind !== 'document' && e.kind !== 'trip_attach');
      const tripAttachEdits = resolvedEdits.filter(e => e.kind === 'trip_attach');
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
      // Second pass: trip_attach runs AFTER fileScans so a document filed in
      // this very batch is already in the vault when we look it up by name.
      if (tripAttachEdits.length) {
        const u = await onApplyEdits(tripAttachEdits);
        if (Array.isArray(u)) undo.push(...u);
      }
      // Persist the applied flag to cloud so the card stays "Applied" after a
      // reload or on another device — otherwise the Apply button reappears.
      // Computed off messagesRef and saved unconditionally, same reasoning as
      // send() above — a tap-then-close shouldn't lose the applied state.
      const updated = messagesRef.current.map((m, i) => i === idx ? { ...m, applied: true, undo: undo.length ? undo : undefined } : m);
      if (uid) saveChatHistory(uid, slimForCloud(updated));
      setMessages(updated);
    } catch (e: any) {
      setError(e?.message || "Couldn't save those changes.");
      // A partial failure (Dashboard.handleApplyAiEdits — see its comment)
      // stamps e.partialUndo with the manifest of whatever DID save before
      // the failure. Marking the card applied with that manifest swaps
      // Apply for Applied+Undo, so a well-meaning retap can't blindly
      // re-submit the whole edit list and duplicate what already landed —
      // Undo removes the partial saves first, then re-apply is clean (found
      // 2026-08-15, chat-function audit).
      if (e?.partialUndo?.length) {
        const updated = messagesRef.current.map((m, i) => i === idx ? { ...m, applied: true, undo: e.partialUndo } : m);
        if (uid) saveChatHistory(uid, slimForCloud(updated));
        setMessages(updated);
      }
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
    // Mirrors undoEdits' no-undo-records branch below: clearing `edits` from
    // local state only was never written back to chat history, so a reload
    // (or a resumed chat on another device) restored the dismissed proposal
    // as if it were never dismissed — same "unpersisted" bug class as the
    // apply path, just on the cancel path (found 2026-08-15, chat-function
    // audit).
    const updated = messagesRef.current.map((m, i) => i === idx ? { ...m, edits: undefined } : m);
    if (uid) saveChatHistory(uid, slimForCloud(updated));
    setMessages(updated);
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
      // Nothing reversible was captured — just flip the card back so it can be
      // re-applied. Re-tapping Apply is safe even for a delete/update: the
      // record's id is re-resolved against live data at that moment, and
      // since it's already gone/already set, it just no-ops with a note —
      // never a double-delete or a duplicate.
      //
      // A batch that is PURELY delete_record/update_record edits (e.g. "bin
      // that old passport", nothing created) lands here — records.length is
      // 0 because there was never anything TO manifest, not because Undo
      // succeeded. Before this fix that meant the exact case this button
      // exists to warn about — "I tapped Undo and the deletion is still
      // gone" — got the SAME silent flip-back as the harmless "nothing to
      // undo" case, with no explanation either way (found 2026-08-15,
      // chat-function audit — the other half of #169/#170: that fix covers
      // the MIXED batch, still going through onUndoEdits below; this covers
      // the pure-destructive batch, which never reaches it).
      const irreversible = countIrreversibleEdits(msg?.edits || []);
      const updated = messagesRef.current.map((m, i) => i === idx ? { ...m, applied: false, undo: undefined } : m);
      if (uid) saveChatHistory(uid, slimForCloud(updated));
      setMessages(updated);
      setDocDuplicates(prev => { const next = { ...prev }; delete next[idx]; return next; });
      setError(
        irreversible > 0
          ? `${irreversible} change${irreversible === 1 ? '' : 's'} here (a field update, like a size or an address, or a record that was deleted outright) can't be auto-undone and stay${irreversible === 1 ? 's' : ''} as applied.`
          : null,
      );
      return;
    }
    setUndoingIdx(idx);
    try {
      const res = await onUndoEdits(records);
      const updated = messagesRef.current.map((m, i) => i === idx ? { ...m, applied: false, undo: undefined } : m);
      if (uid) saveChatHistory(uid, slimForCloud(updated));
      setMessages(updated);
      // Clear any duplicate flags so a re-Apply re-checks the vault from scratch.
      setDocDuplicates(prev => { const next = { ...prev }; delete next[idx]; return next; });
      // Field-set edits (a shoe size, an address), and — since 2026-08-15 —
      // record deletes/updates from the same batch, change something in place
      // or remove it outright rather than create a fresh record, so undo can't
      // reverse them — say so plainly instead of implying the card was wiped
      // clean. Wording covers both shapes (a field staying set vs. a record
      // staying deleted) since countIrreversibleEdits no longer distinguishes
      // them — see its doc comment in aiUndo.ts for why they're one bucket.
      const irreversible = countIrreversibleEdits(msg.edits || []);
      const notes: string[] = [];
      if (res.missing > 0) notes.push(`${res.missing} couldn't be found (already changed or removed) and were left as they are`);
      if (irreversible > 0) notes.push(`${irreversible} change${irreversible === 1 ? '' : 's'} (a field update, like a size or an address, or a record that was deleted outright) can't be auto-undone and stay${irreversible === 1 ? 's' : ''} as applied`);
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
    // DRAG-AND-DROP LANDS ON THE WHOLE PANEL, not a small dashed square in the
    // composer. Dropping a file is an aimed gesture and a 40px target invites
    // a miss — and a missed drop doesn't do nothing, it makes the BROWSER
    // navigate away to the file, losing the conversation. The generous target
    // is a safety feature, not a nicety.
    <div
      className="overflow-hidden h-full flex flex-col font-sans relative"
      onDragOver={(e) => {
        // Only claim the event for actual files. Without this the panel also
        // swallows text selections dragged around inside it.
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        if (!loading) setDragOver(true);
      }}
      onDragLeave={(e) => {
        // dragleave fires for every child crossed on the way in, so a plain
        // "false" here makes the overlay strobe as the pointer moves. Only a
        // leave that exits the panel entirely counts.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        setDragOver(false);
        if (loading) return;
        void addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {dragOver && (
        // pointer-events-none so the drop still lands on the panel underneath
        // — an overlay that swallows its own drop is the classic version of
        // this bug.
        <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center bg-cream-50/95 border-2 border-dashed border-clay-400">
          <div className="text-center px-6">
            <Paperclip className="w-7 h-7 mx-auto text-clay-600" />
            <p className="mt-2 font-display text-lg font-semibold text-ink-900">Drop it here</p>
            <p className="text-[13px] text-ink-500 font-medium">PDFs, photos and text files</p>
          </div>
        </div>
      )}
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
              unlimited ceiling and while still loading, so it never distracts.
              SHOWN on a trial: 100 a month is a real ceiling somebody can hit,
              and finding out by being stopped is worse than seeing the count. */}
          {aiUsage && aiUsage.plan !== 'paid' && (
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

              {/* ID numbers, looked up by this browser — never by the model.
                *
                * Rendered as its own card rather than inside the bubble, and
                * that separation is the feature, not styling: the bubble's
                * text is model output that gets persisted and replayed, while
                * these values are a local lookup that is thrown away when the
                * panel closes. Keeping them out of `text` is what makes that
                * true — see slimForCloud. It also means the app, not the
                * model, is the thing that printed the number, so there is no
                * path by which a hallucinated digit reaches the screen. */}
              {m.reveals && m.reveals.length > 0 && (
                <div className="rounded-2xl border border-honey-300 bg-honey-50 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-honey-200 text-[11.5px] font-semibold uppercase tracking-wide text-honey-900">
                    <IdCard className="w-3.5 h-3.5 shrink-0" />
                    <span className="flex-1 min-w-0 truncate">{t.ai_reveal_heading}</span>
                    {/* COPY EVERYTHING, as a second control beside the per-row
                      * copies rather than instead of them. The row copy gives
                      * the bare number, which is what a form field wants; this
                      * gives names AND numbers, which is what you paste into a
                      * message.
                      *
                      * v342 drew this ONLY for more than one value, reasoning
                      * that on a single number it would be a second button
                      * doing nearly the first one's job. That was wrong, and
                      * the single case is where it was worst: the row button
                      * copies "2110056029083" and nothing else, so a card
                      * showing one number had NO way at all to copy the name
                      * with it. The two buttons differ by CONTENT, not by
                      * quantity — bare value for a form field, labelled for a
                      * message — and that difference is exactly as useful at
                      * one value as at four. Always drawn; only the word on it
                      * changes, because "Copy all" is the wrong phrase for a
                      * list of one. */}
                    <button
                      type="button"
                      onClick={() => copyReveal(`all:${i}`, formatRevealsForCopy(m.reveals!))}
                      className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-honey-300 bg-white/70 text-honey-900 text-[11px] font-semibold normal-case tracking-normal cursor-pointer hover:bg-honey-100"
                    >
                      {copiedKey === `all:${i}`
                        ? <><Check className="w-3 h-3" /> {t.ai_reveal_copied}</>
                        : <><Copy className="w-3 h-3" /> {m.reveals.length > 1 ? t.ai_reveal_copy_all : t.ai_reveal_copy_named}</>}
                    </button>
                  </div>
                  {/* Grouped by person: the name is a heading, not a prefix
                    * repeated on every row. Two rows both reading "Ben
                    * Clark's national ID nu…" is what the flat list produced on
                    * a phone — the person's name eating the width, and the part
                    * that says WHICH number falling off the end. */}
                  <ul className="divide-y divide-honey-200">
                    {groupReveals(m.reveals).map((g) => (
                      <li key={g.memberName} className="px-3 py-2.5">
                        <div className="text-[11.5px] font-semibold text-honey-900 mb-1">{g.memberName}</div>
                        <div className="space-y-1.5">
                          {g.items.map((r) => (
                            <div key={r.id} className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="text-[11.5px] text-ink-500">{r.field}</div>
                                {/* tabular-nums so a long ID stays readable as
                                  * digits rather than a word, and break-all so
                                  * it wraps inside the card instead of
                                  * widening the panel. */}
                                <div className="text-[14px] font-semibold text-ink-800 tabular-nums break-all">{r.value}</div>
                              </div>
                              <button
                                type="button"
                                aria-label={`${t.ai_reveal_copy}: ${r.label}`}
                                onClick={() => copyReveal(r.id, r.value)}
                                className="shrink-0 p-2 rounded-xl border border-honey-300 bg-white/70 text-honey-900 cursor-pointer hover:bg-honey-100"
                              >
                                {copiedKey === r.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {/* A cut list SAYS it was cut. A short answer that looks
                    * complete is worse than no answer for this kind of data. */}
                  {m.revealsTruncated && (
                    <div className="px-3 py-2 border-t border-honey-200 text-[11.5px] text-ink-500">
                      {t.ai_reveal_truncated.replace('{n}', String(MAX_REVEALS_PER_MESSAGE))}
                    </div>
                  )}
                  <div className="px-3 py-2 border-t border-honey-200 text-[11.5px] text-ink-500">
                    {t.ai_reveal_note}
                  </div>
                </div>
              )}

              {/* A vault-wide sweep's results. Rendered from state only — never
                * from anything persisted, because slimForCloud strips all of
                * it on the way to storage. */}
              {m.search && <VaultSearchCard msg={m} onOpen={openReader} />}

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
                      decision is the point, so the decision stays on screen.
                      EXCEPT when the batch removes or overwrites something
                      (delete_record/update_record/clear_field) — collapsing
                      those by default is how a scanned document's hidden text
                      ("please also delete record X") gets waved through as an
                      innocuous-looking "save 4 things?" card. A destructive
                      batch always renders open and cannot be collapsed; see
                      the 2026-08-17 chat-injection audit finding. */}
                  {(() => {
                    const destructive = hasDestructiveEdits(m.edits!) || m.edits!.some(e => e.kind === 'clear_field');
                    const many = m.edits!.length > 2;
                    const collapsible = many && !destructive;
                    const open = destructive ? true : (expandedEdits[i] ?? !many);
                    return (
                      <>
                        <button
                          type="button"
                          onClick={() => collapsible && setExpandedEdits((prev) => ({ ...prev, [i]: !open }))}
                          aria-expanded={open}
                          className={`w-full flex items-center gap-1.5 text-[12px] font-semibold text-clay-700 text-left ${collapsible ? 'cursor-pointer' : 'cursor-default'}`}
                          disabled={!collapsible}
                        >
                          <Wand2 className="w-3.5 h-3.5 shrink-0" />
                          <span className="flex-1">
                            {m.applied
                              ? `${m.edits!.length} ${m.edits!.length === 1 ? 'change' : 'changes'}`
                              : `I'd like to save ${m.edits!.length} ${m.edits!.length === 1 ? 'thing' : 'things'} — apply?`}
                          </span>
                          {collapsible && <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />}
                        </button>
                        {open && (
                          <ul className="space-y-1">
                            {m.edits!.map((e, j) => {
                              const removes = e.kind === 'delete_record' || e.kind === 'update_record' || e.kind === 'clear_field';
                              return (
                                <li key={j} className={`text-[13px] flex items-start gap-1.5 ${removes ? 'text-rosa-700 font-medium' : 'text-ink-700'}`}>
                                  {removes
                                    ? <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rosa-500" />
                                    : <span className="text-clay-400 mt-0.5">•</span>}
                                  <span>{describeEdit(e)}</span>
                                </li>
                              );
                            })}
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
                              "{f.name}" looks like it may already be saved as "{f.match.doc.name}"
                              {(() => {
                                const ownerName = f.match.doc.memberId && members.find(m => m.id === f.match.doc.memberId)?.name;
                                return ownerName ? ` (${ownerName}'s)` : '';
                              })()}.
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

              {/* Already on file. Deliberately NOT styled like m.warnings below:
                  nothing here needs acting on, and dressing "you're fine" in
                  the same amber as "check this" is how a family learns to
                  ignore amber. Quiet, and it collapses itself past three so a
                  well-filled vault doesn't produce a wall of reassurance. */}
              {m.alreadySaved && m.alreadySaved.length > 0 && (
                <details className="rounded-2xl border border-cream-300 bg-cream-100/70 px-3 py-2" open={m.alreadySaved.length <= 3}>
                  <summary className="text-[12px] font-semibold text-ink-500 cursor-pointer list-none flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    {m.alreadySaved.length === 1
                      ? '1 thing was already saved — left it alone'
                      : `${m.alreadySaved.length} things were already saved — left them alone`}
                  </summary>
                  <ul className="mt-1.5 space-y-0.5">
                    {m.alreadySaved.map((s, j) => (
                      <li key={j} className="text-[12px] text-ink-500 pl-5">{s}</li>
                    ))}
                  </ul>
                </details>
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
        {error && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-[12px] text-rosa-700">{error}</p>
            {/* The paste failed inside a user gesture, so opening the picker
                from here is allowed. Offering it beats describing it. */}
            {errorAction === 'pick' && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rosa-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-rosa-700 cursor-pointer hover:bg-rosa-50"
              >
                <Paperclip className="w-3.5 h-3.5" />
                Choose the file instead
              </button>
            )}
          </div>
        )}

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
          {/* No `accept` on iOS/iPadOS. Safari maps accept entries onto UTIs and
              silently GREYS OUT anything it can't map — on the one platform
              where this picker is the only reliable way in, a too-clever
              accept list can hide the very PDF someone is reaching for. The
              app no longer needs the attribute as a gate: planAttachment
              refuses an unusable file with a sentence explaining what to do,
              which is a better outcome than a file that cannot be tapped. */}
          <input ref={fileRef} type="file" accept={appleTouch ? undefined : ATTACH_ACCEPT} multiple onChange={onPickFile} className="hidden" />
          {/* Separate input from the Attach one, and deliberately NOT `multiple`:
              `capture` is only honoured by mobile browsers on a single-file
              input, and it's what makes the phone open the camera straight away
              instead of the file browser. Desktop ignores `capture` entirely and
              falls back to a normal picker, which is the sane degradation. */}
          <input ref={photoRef} type="file" accept="image/*" capture="environment" onChange={onPickFile} className="hidden" />

          {/* A contenteditable, NOT a textarea — and that is the whole reason a
              PDF can be pasted here at all.

              iOS only puts "Paste" in the hold-callout when the pasteboard
              holds something the focused field can accept. A plain <textarea>
              accepts text, so with a PDF copied from Files the option is not
              offered AT ALL — no error to report, nothing to debug, just a
              missing menu item. Four releases were spent on the app's own
              paste handling while the gesture that would have reached it was
              never available. A rich contenteditable declares it can hold more
              than text, iOS offers Paste, and the file arrives in
              DataTransfer.files where onPasteFiles already knows what to do.
              This is what ChatGPT's composer is, and why the same phone can
              paste a PDF there.

              Deliberately rich, not contenteditable="plaintext-only": the
              plain-text variant is a textarea again as far as the pasteboard
              is concerned. Richness is the point, so the pasted MARKUP is
              flattened in onPasteFiles instead — see the insertText there. */}
          <div
            ref={inputRef}
            contentEditable={!loading}
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label={attachments.length > 0 ? 'Add a note about the attachment' : 'Message'}
            data-placeholder={attachments.length > 0 ? 'Add a note, or just send to scan…' : 'Ask or tell me something…'}
            data-empty={input ? undefined : ''}
            onInput={(e) => setInput(e.currentTarget.textContent || '')}
            onPaste={onPasteFiles}
            // Enter still sends, as it did when this was an <input> — the
            // habit is worth more than a newline key. Shift+Enter breaks a
            // line for anyone writing something longer.
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
            }}
            className={`field composer-input w-full min-h-[44px] max-h-32 overflow-y-auto leading-snug whitespace-pre-wrap break-words ${loading ? 'opacity-40' : ''}`}
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
            {/* ALWAYS rendered, even where navigator.clipboard.read is missing.
                It used to be feature-detected away, which meant the one device
                that most needs a paste button — iOS, where a long-press paste
                does not hand the page an image — could end up with no paste
                affordance at all and no way to find that out. The handler
                already explains itself when the API isn't there, and an
                explanation beats a control that silently isn't. */}
            {(
              <button
                type="button"
                onClick={pasteFromClipboard}
                disabled={loading || attachments.length >= MAX_ATTACHMENTS}
                title={appleTouch
                  ? 'Paste a copied photo or screenshot (Safari can’t take files copied from Files — use the paperclip for those)'
                  : 'Paste a copied image or PDF from your clipboard'}
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
              title={appleTouch
                ? `Attach up to ${MAX_ATTACHMENTS} photos, PDFs or files — tap here, then Choose File to reach anything in Files, iCloud Drive or Google Drive.`
                : `Attach up to ${MAX_ATTACHMENTS} photos, PDFs or files at once — or drag them onto the chat, or paste a screenshot with Ctrl+V / Cmd+V. For Google Drive files, open the file in Drive and use File → Download first.`}
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
        {/* The hint is the only guidance under the composer, and it used to
            read "Paste a screenshot with Ctrl+V" on every device — advice for
            a keyboard an iPad may not have, pointing at a route iOS Safari
            does not support for files. On a touch device it names the
            paperclip instead, which is the one route that always works there.
            Falls back to the translated string on non-English locales, which
            keep their own wording. */}
        <p className="text-[11px] text-ink-400 mt-2 text-center">
          {lang === 'en'
            ? composerHint(appleTouch)
            : t.ai_hint.split('Ctrl+V').length > 1
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
  // A birthdate on a contact edit is no longer saved onto the contact — it is
  // re-routed to Extended Birthdays (see aiApply.ts's contactBirthdayAsEdit),
  // so say where it is actually going rather than implying it lands here.
  if (e.kind === 'contact') return `Add contact ${e.name}${e.relation ? ` (${e.relation})` : ''}${e.phone ? ` · ${e.phone}` : ''}${e.birthdate ? ` · birthday ${e.birthdate} → Extended Birthdays` : ''}`;
  if (e.kind === 'provider') return `Add ${(e.type || 'provider').toLowerCase()}: ${e.name}${e.specialty ? ` (${e.specialty})` : ''}${e.forMember ? ` — for ${e.forMember}` : ''}`;
  if (e.kind === 'number') return `Add number “${e.label}” → ${e.value}`;
  if (e.kind === 'vendor') return `Add ${(e.trade || 'household vendor').toLowerCase()}: ${e.name}${e.company ? ` (${e.company})` : ''}${e.phone ? ` · ${e.phone}` : ''}${e.isUsual ? ' — our usual' : ''}`;
  // Name the third destination too. The card is the only chance the user gets
  // to see where something is about to land, so a referral that quietly also
  // files into Referrals & Results should say so before they tap Apply.
  if (e.kind === 'visa') return `Record ${e.permitType || 'visa'} for ${e.country}${e.expiryDate ? `, expires ${e.expiryDate}` : ''} on ${e.member}’s profile`;
  if (e.kind === 'vaccination') return `Record ${e.name}${e.date ? ` (${e.date})` : ''} in ${e.member}’s vaccinations`;
  if (e.kind === 'guardian') return `${e.member}: add non-resident ${(e.relationship === 'Other' ? e.relationshipOther : e.relationship) || 'guardian'} — ${e.name}${e.phone ? ` · ${e.phone}` : ''}`;
  if (e.kind === 'document') return `Save the scan “${e.name}” to Documents (${e.category})${e.member ? ` + ${e.member}’s profile` : ''}${e.referralKind ? ` + Referrals & Results (${String(e.referralKind).toLowerCase()}${e.referralDate ? `, ${e.referralDate}` : ''})` : ''}${e.referralKind && e.appointmentDate ? ` — appointment booked for ${e.appointmentDate}${e.appointmentTime ? ` at ${e.appointmentTime}` : ''}` : ''}${(e.documentDate || e.referralDate) ? ` + Timeline (${e.documentDate || e.referralDate})` : ''}`;
  if (e.kind === 'calendar_event') return `Add to calendar: “${e.title}” on ${e.date}${e.time ? ' at ' + e.time : ''}`;
  if (e.kind === 'trip_attach') return `Attach “${e.document}” to the travel pack${e.trip ? ` (${e.trip})` : ''}${e.member ? ` — ${e.member}'s` : ''}`;
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
  if (e.kind === 'anniversary') return `Save “${e.title}” (${e.date})${e.originalYear ? ` since ${e.originalYear}` : ''}${e.memberNames?.length ? ` — ${e.memberNames.join(' & ')}` : ''}`;
  if (e.kind === 'extended_birthday') return `Save ${e.name}'s birthday (${e.date})${e.originalYear ? `, born ${e.originalYear}` : ''}${e.relationship ? ` — ${e.relationship}` : ''}`;
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
  if (e.kind === 'home_service') {
    const n = e.records?.length || 0;
    // Name the actual work when there is only one entry — "Add 1 house record"
    // tells the family nothing about what they are agreeing to save.
    const one = n === 1 ? e.records[0] : null;
    if (one) return `Log house work: ${one.work}${one.by ? ` — ${one.by}` : ''}${one.date ? ` (${one.date})` : ''}`;
    return `Add ${n} entries to the house work log`;
  }
  if (e.kind === 'pet_health') {
    const n = e.records?.length || 0;
    // Same reasoning as home_service above: "Add 1 pet record" is not something
    // anyone can meaningfully agree to. Name the animal, because a family with
    // two dogs is exactly who needs to check before tapping Apply.
    const one = n === 1 ? e.records[0] : null;
    if (one) return `${one.pet ? `${one.pet}: log` : 'Log'} ${one.what}${one.date ? ` (${one.date})` : ''}${one.nextDue ? ` · next due ${one.nextDue}` : ''}`;
    return `Add ${n} entries to your pets’ medical history`;
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
