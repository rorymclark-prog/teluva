/* Timeline builder: local CSV/ICS parsing, or AI extraction from complete
 * historical documents. Every candidate is reviewed; originals are unchanged.
 * Saved scans use the authenticated document OCR path, with per-file coverage
 * and errors reported. Demo never invokes AI or OCR. */

import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, Sparkles, AlertCircle, CalendarPlus } from 'lucide-react';
import SheetGrabber from './SheetGrabber';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { auth } from '../lib/firebase';
import { isDemoMode } from '../utils/demoData';
import { collectDocPages } from '../utils/docReader';
import { extractTimelineDocx, timelineTextChunks, type TimelineDocumentSource } from '../utils/timelineDocuments';
import { extractDocText } from '../utils/docText';
import { LIFE_CATEGORIES } from '../utils/lifeTimeline';
import {
  parseCsv,
  parseIcs,
  parseFreeTextLines,
  findDuplicates,
  BORN_WORD,
  datePrecisionChange,
  importRowReason as rowReason,
  type ImportGrain as Grain,
  type TimelineCandidate,
  type TimelineImportMember,
} from '../utils/timelineImport';
import type { LifeCategory, TimelineEntry } from '../types';

export interface TimelineImportModalProps {
  open: boolean;
  documents?: TimelineDocumentSource[];
  onClose: () => void;
  /** FamilyMember-shaped: `birthdate` lets a "Nora born …" row be recognised as already known. */
  members: TimelineImportMember[];
  existing: TimelineEntry[];
  /** Preselected on every row nobody is named on — the person whose timeline this is. */
  defaultMemberId?: string;
  isBusinessSpace?: boolean;
  demo?: boolean;
  onImport: (entries: TimelineEntry[], batchId: string) => Promise<void> | void;
}

interface ReviewRow extends TimelineCandidate {
  checked: boolean;
  keepUndated?: boolean;
}

const ACCEPTED_EXTENSIONS = '.csv,.tsv,.txt,.ics,.pdf,.docx';
const ACCEPTED_MIME = 'text/csv,text/tab-separated-values,text/plain,text/calendar,application/pdf';
const IMAGE_NAME_RE = /\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/i;
const VALID_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Pure helpers — no component state.
// ---------------------------------------------------------------------------

const grainOf = (row: Pick<ReviewRow, 'datePrecision'>): Grain => row.datePrecision || 'day';

function isRowReady(row: ReviewRow): boolean {
  return (row.keepUndated || VALID_DATE_RE.test(row.date)) && row.title.trim().length > 0;
}

function normalizeForGrain(date: string, grain: Grain): string {
  if (grain === 'year') return `${date.slice(0, 4)}-01-01`;
  if (grain === 'month') return `${date.slice(0, 7)}-01`;
  return date;
}

function buildRows(candidates: TimelineCandidate[], defaultMemberId: string | undefined, business: boolean): ReviewRow[] {
  return candidates.map((c) => {
    const memberIds = c.memberIds.length === 0 && !c.preserveUnassigned && defaultMemberId ? [defaultMemberId] : c.memberIds;
    // No kind given: a birth reads as a milestone, anything else as a memory
    // (what categoryOfEntry shows for an entry without one). Medical never
    // lands on a business timeline.
    let category: LifeCategory = c.category || (BORN_WORD.test(c.title) ? 'milestone' : 'memory');
    if (business && category === 'medical') category = 'other';
    const row: ReviewRow = { ...c, category, memberIds, checked: false };
    row.checked = rowReason(row) === null;
    return row;
  });
}

/** CSV/ICS parse exactly; free text gets the local line-by-line pass. */
function localParse(text: string, members: TimelineImportMember[]): { candidates: TimelineCandidate[]; unparsedLines: string[] } {
  const trimmed = text.trim();
  if (!trimmed) return { candidates: [], unparsedLines: [] };
  if (/^BEGIN:VCALENDAR|^BEGIN:VEVENT/im.test(trimmed)) return { candidates: parseIcs(text), unparsedLines: [] };
  const csvRows = parseCsv(text, members);
  if (csvRows.length > 0) return { candidates: csvRows, unparsedLines: [] };
  return parseFreeTextLines(text, members);
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

const CATEGORY_IDS = new Set<string>(LIFE_CATEGORIES.map((c) => c.id));

/**
 * The AI half. The server already sanitised the rows (sourceText verified
 * against the text we sent, category closed to LifeCategory, memberIds
 * filtered to the ids we offered); this shapes them into TimelineCandidate
 * and defends against a malformed network response.
 */
async function fetchAssistantRows(text: string, members: TimelineImportMember[], today: string, document = false): Promise<TimelineCandidate[]> {
  const token = await auth.currentUser?.getIdToken();
  const resp = await fetch('/api/timeline/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ text, members: members.map((m) => ({ id: m.id, name: m.name })), today, document }),
  });
  if (!resp.ok) {
    let msg = `Could not read that text (${resp.status}).`;
    try { const j = await resp.json(); if (j?.error) msg = j.error; } catch { /* keep default */ }
    throw new Error(msg);
  }
  const data = await resp.json();
  const rows: unknown[] = Array.isArray(data?.rows) ? data.rows : [];
  const known = new Set(members.map((m) => m.id));
  return rows
    .filter((r): r is Record<string, unknown> => {
      const x = r as Record<string, unknown> | null;
      return !!x && typeof x.date === 'string' && typeof x.title === 'string' && typeof x.sourceText === 'string';
    })
    .map((r, i) => {
      const precision = r.datePrecision === 'month' || r.datePrecision === 'year' ? r.datePrecision : undefined;
      const category = typeof r.category === 'string' && CATEGORY_IDS.has(r.category) ? (r.category as LifeCategory) : 'other';
      return {
        key: `ai-${crypto.randomUUID()}`,
        date: r.date as string,
        ...(precision ? { datePrecision: precision } : {}),
        title: r.title as string,
        category,
        memberIds: Array.isArray(r.memberIds) ? (r.memberIds as unknown[]).filter((id): id is string => typeof id === 'string' && known.has(id)) : [],
        note: typeof r.note === 'string' && r.note ? r.note : undefined,
        sourceText: r.sourceText as string,
      };
    });
}

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------

export default function TimelineImportModal({
  open, onClose, members, existing, documents = [], defaultMemberId, isBusinessSpace = false, demo = false, onImport,
}: TimelineImportModalProps) {
  // Called unconditionally, ahead of the `if (!open) return null` below.
  useBodyScrollLock(open);

  const [step, setStep] = useState<1 | 2>(1);
  const [pastedText, setPastedText] = useState('');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assistantNotice, setAssistantNotice] = useState<string | null>(null);
  const [demoSkippedCount, setDemoSkippedCount] = useState(0);
  const [readError, setReadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [documentSelection, setDocumentSelection] = useState<string[] | null>(null);
  const [scanReport, setScanReport] = useState<string[]>([]);
  const stopScan = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const memberList: TimelineImportMember[] = useMemo(
    () => members.map((m) => ({ id: m.id, name: m.name, ...(m.birthdate ? { birthdate: m.birthdate } : {}) })),
    [members],
  );
  const categories = LIFE_CATEGORIES.filter((c) => !(isBusinessSpace && c.id === 'medical'));
  const demoOnly = demo || isDemoMode();

  function resetState() {
    setStep(1);
    setScanReport([]);
    setDocumentSelection(null);
    setPastedText('');
    setRows([]);
    setIsDragging(false);
    setIsProcessing(false);
    setIsSubmitting(false);
    setAssistantNotice(null);
    setDemoSkippedCount(0);
    setReadError(null);
    setSubmitError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleClose() {
    if (isProcessing || isSubmitting) return;
    resetState();
    onClose();
  }

  async function runPipeline(text: string) {
    setReadError(null);
    setDemoSkippedCount(0);
    const { candidates: localCandidates, unparsedLines } = localParse(text, memberList);
    let allCandidates = localCandidates;

    if (unparsedLines.length > 0) {
      if (demoOnly) {
        // Demo mode never calls the assistant — say plainly what was left out.
        setDemoSkippedCount(unparsedLines.length);
      } else {
        const n = unparsedLines.length;
        setAssistantNotice(`Reading ${n} line${n === 1 ? '' : 's'} with the assistant…`);
        setIsProcessing(true);
        try {
          const aiCandidates = await fetchAssistantRows(unparsedLines.join('\n'), memberList, todayLocal());
          allCandidates = [...allCandidates, ...aiCandidates];
        } catch (e) {
          setReadError(e instanceof Error ? e.message : 'Could not read some of that text — please try again.');
        } finally {
          setAssistantNotice(null);
          setIsProcessing(false);
        }
      }
    }

    if (allCandidates.length === 0) {
      setReadError((prev) => prev ?? "I couldn't find any dates in that — try one moment per line, or upload a CSV or calendar (.ics) file.");
      return;
    }

    const withDupes = findDuplicates(allCandidates, existing, memberList);
    setRows(buildRows(withDupes, defaultMemberId, isBusinessSpace));
    setStep(2);
  }

  function reviewCandidates(candidates: TimelineCandidate[]) {
    const prepared = buildRows(candidates, defaultMemberId, isBusinessSpace);
    setRows(buildRows(findDuplicates(prepared, existing, memberList), undefined, isBusinessSpace));
    if (candidates.length) setStep(2);
  }

  async function readHistoricalText(text: string, source: TimelineDocumentSource): Promise<TimelineCandidate[]> {
    const found: TimelineCandidate[] = [];
    for (const chunk of timelineTextChunks(text)) {
      if (stopScan.current) break;
      const candidates = demoOnly ? localParse(chunk, memberList).candidates : await fetchAssistantRows(chunk, memberList, todayLocal(), true);
      found.push(...candidates.map(c => ({...c, sourceName: source.name, sourceDocument: source.sourceDocument, preserveUnassigned: true, docIds: source.vaultId ? [source.vaultId] : undefined,
        memberIds: c.memberIds.length ? c.memberIds : source.memberIds,
        note: [c.note, `Source: ${source.name}`, `Evidence: ${c.sourceText}`].filter(Boolean).join('\n')})));
    }
    return found;
  }

  async function scanSavedDocuments() {
    if (isProcessing) return;
    stopScan.current = false;
    setIsProcessing(true); setReadError(null); setScanReport([]);
    const selected = documents.filter(d => documentSelection === null || documentSelection.includes(d.id));
    const found: TimelineCandidate[] = [];
    const report: string[] = [];
    for (let index=0;index<selected.length;index++) {
      if (stopScan.current) break;
      const doc = selected[index];
      setAssistantNotice(`Reading ${index+1} of ${selected.length}: ${doc.name}`);
      try {
        let text = '';
        let partial = false;
        if (/\.docx$/i.test(doc.fileName || '') || doc.fileType.includes('wordprocessingml')) {
          const response = await fetch(doc.src);
          if (!response.ok) throw new Error('File could not be downloaded.');
          text = await extractTimelineDocx(await response.arrayBuffer());
        } else if (demoOnly) {
          const result = await extractDocText(doc.src,doc.fileType);
          text = result.pages.map(p=>p.text).join('\n');
          partial = result.coverage.pagesWithoutText.length > 0;
        } else {
          const result = await collectDocPages(doc);
          if (result.kind !== 'ok') throw new Error(result.message);
          text = result.pages.map(p=>p.text).join('\n');
          partial = result.coverage.pagesWithoutText.length > 0;
        }
        if (!text.trim()) throw new Error('No readable text; open the source and check it.');
        const candidates = await readHistoricalText(text,doc);
        found.push(...candidates);
        report.push(`${doc.name}: ${candidates.length} candidate moments${partial ? ' · some pages could not be read' : ''}${candidates.length >= 80 ? ' · many results; check the source for additional events' : ''}`);
      } catch (error) {
        report.push(`${doc.name}: not fully read — ${error instanceof Error ? error.message : 'try again'}`);
      }
      setScanReport([...report]);
    }
    if (stopScan.current) report.push('Stopped early. Only completed results are shown.');
    setScanReport(report);
    setAssistantNotice(null);setIsProcessing(false);
    if (found.length) reviewCandidates(found);
    else setReadError('No candidate moments found in the documents read. Check the reading report below; unread files are not proof that your history is empty.');
  }

  async function handleFile(file: File) {
    setReadError(null);
    setDemoSkippedCount(0);
    if (file.size > 20*1024*1024) { setReadError('Choose a file smaller than 20 MB.'); return; }
    stopScan.current = false;
    setScanReport([]);
    const name = file.name.toLowerCase();
    if (file.type.startsWith('image/') || IMAGE_NAME_RE.test(name)) {
      setReadError("Photos can't be read here yet — only text that's typed, pasted, or already inside a PDF or calendar file. Try a CSV, a calendar (.ics) file, or paste the dates as text.");
      return;
    }
    setIsProcessing(true);
    try {
      if (name.endsWith('.docx')) {
        const text = await extractTimelineDocx(await file.arrayBuffer());
        const candidates = await readHistoricalText(text,{id:'upload',name:file.name,category:'Other',src:'',fileType:file.type,memberIds:defaultMemberId?[defaultMemberId]:[]});
        if(candidates.length) reviewCandidates(candidates); else setReadError('No candidate moments found. Try pasting the relevant section.');
        return;
      }
      if (name.endsWith('.pdf') || file.type === 'application/pdf') {
        const dataUrl = await readFileAsDataUrl(file);
        const { pages } = await extractDocText(dataUrl, 'application/pdf');
        const text = pages.map((p) => p.text).join('\n');
        if (!text.trim()) {
          setReadError("This PDF has no selectable text — it looks like a scan, which can't be read here. Try pasting the dates as text instead.");
          return;
        }
        const candidates = await readHistoricalText(text,{id:'upload',name:file.name,category:'Other',src:'',fileType:file.type,memberIds:defaultMemberId?[defaultMemberId]:[]});
        if(candidates.length) reviewCandidates(candidates); else setReadError('No candidate moments found. Try pasting the relevant section.');
        return;
      }
      const text = await readFileAsText(file);
      if (!text.trim()) {
        setReadError('That file looks empty.');
        return;
      }
      await runPipeline(text);
    } catch (e) {
      setReadError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (!isProcessing) setIsDragging(true);
  }
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (isProcessing) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function updateRow(key: string, patch: Partial<ReviewRow>) {
    if (patch.date) patch.keepUndated = false;
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function toggleRowMember(key: string, memberId: string) {
    setRows((prev) => prev.map((r) => {
      if (r.key !== key) return r;
      const has = r.memberIds.includes(memberId);
      return { ...r, memberIds: has ? r.memberIds.filter((id) => id !== memberId) : [...r.memberIds, memberId] };
    }));
  }
  function selectAllReady() {
    setRows((prev) => prev.map((r) => (isRowReady(r) ? { ...r, checked: true } : r)));
  }
  function setPersonForSelected(memberId: string) {
    setRows((prev) => prev.map((r) => (r.checked ? { ...r, memberIds: [memberId] } : r)));
  }
  function setGrain(row: ReviewRow, to: Grain) {
    const date = datePrecisionChange(row.date, grainOf(row), to);
    updateRow(row.key, { datePrecision: to === 'day' ? undefined : to, date, needsDate: !date, keepUndated:false });
  }

  async function handleAdd() {
    setSubmitError(null);
    const checkedRows = rows.filter((r) => r.checked);
    const notReady = checkedRows.filter((r) => !isRowReady(r));
    if (notReady.length > 0) {
      const names = notReady.slice(0, 3).map((r) => r.title.trim() || '(untitled)').join(', ');
      setSubmitError(
        `${notReady.length === 1 ? 'One selected moment needs' : `${notReady.length} selected moments need`} a date and a title before they can be added: ${names}${notReady.length > 3 ? '…' : ''}.`,
      );
      return;
    }
    if (checkedRows.length === 0) return;

    const batchId = newId('import');
    const entries: TimelineEntry[] = checkedRows.map((r) => {
      const grain = grainOf(r);
      const category: LifeCategory = isBusinessSpace && r.category === 'medical' ? 'other' : (r.category || 'memory');
      return {
        id: newId('tl'),
        date: r.keepUndated ? '' : normalizeForGrain(r.date, grain),
        ...(!r.keepUndated && grain !== 'day' ? { datePrecision: grain } : {}),
        title: r.title.trim(),
        category,
        ...(r.note?.trim() ? { note: r.note.trim() } : {}),
        ...(r.memberIds.length > 0 ? { memberIds: r.memberIds } : {}),
        ...(r.docIds?.length ? {docIds:r.docIds} : {}),
        ...(r.sourceDocument ? {sourceDocument:r.sourceDocument} : {}),
        source: 'import',
        importBatchId: batchId,
      };
    });

    setIsSubmitting(true);
    try {
      await onImport(entries, batchId);
      handleClose();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not add these moments — please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!open) return null;

  const readyCount = rows.filter((r) => r.checked && isRowReady(r)).length;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm anim-fade flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Import dates">
      <div className="card rounded-t-3xl sm:rounded-2xl max-w-2xl w-full max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col anim-sheet">
        <SheetGrabber onClose={handleClose} />

        <div className="p-4 bg-white border-b border-cream-200 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 rounded-xl bg-ink-800 text-white shrink-0">
              <CalendarPlus className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold text-ink-900">
                {step === 1 ? 'Build my timeline' : 'Check before adding'}
              </h3>
              <p className="text-[12px] text-ink-400 mt-0.5">
                {step === 1
                  ? "Read saved documents or upload a CV. Review each moment before adding it."
                  : `${readyCount} moment${readyCount === 1 ? '' : 's'} ready to add`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isProcessing || isSubmitting}
            className="p-1.5 hover:bg-cream-100 text-ink-400 hover:text-ink-700 rounded-xl transition-colors cursor-pointer shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* No `justify-center` and `min-h-0` rather than a positive min-height
            — see DocumentScannerModal.tsx for why that combination breaks
            scrolling on a short viewport. */}
        <div className="p-5 flex-1 overflow-y-auto flex flex-col min-h-0 gap-4">
          {scanReport.length > 0 && <details className="rounded-xl border border-cream-200 p-3" open><summary className="text-sm font-semibold">Document reading report</summary><ul className="text-xs space-y-1 mt-2">{scanReport.map((line,i)=><li key={i}>{line}</li>)}</ul></details>}
          {isProcessing && <button type="button" className="btn-quiet text-xs" onClick={()=>{stopScan.current=true;}}>Stop after this request</button>}
          {step === 1 ? (
            <div className="space-y-3">
              {documents.length > 0 && <section className="rounded-2xl border border-cream-200 p-4 space-y-3" aria-label="Read uploaded documents">
                <h4 className="font-semibold">Use documents already uploaded · {documents.length}</h4>
                <p className="text-xs text-ink-500">Scan saved profile and vault documents, including CVs and certificates. Existing records stay in place; possible duplicates are left unchecked.</p>
                <details><summary className="text-sm cursor-pointer">Choose documents ({documentSelection === null ? documents.length : documentSelection.length} selected)</summary>
                  <div className="flex gap-2"><button type="button" disabled={isProcessing} className="btn-quiet text-xs" onClick={()=>setDocumentSelection(null)}>Select all documents</button><button type="button" disabled={isProcessing} className="btn-quiet text-xs" onClick={()=>setDocumentSelection([])}>Clear selection</button></div>
                  <div className="max-h-44 overflow-y-auto">{documents.map(doc=><label key={doc.id} className="flex gap-2 py-2 text-xs"><input type="checkbox" disabled={isProcessing} checked={documentSelection === null || documentSelection.includes(doc.id)} onChange={e=>setDocumentSelection(previous=>e.target.checked?[...(previous || documents.map(d=>d.id)),doc.id]:(previous || documents.map(d=>d.id)).filter(id=>id!==doc.id))}/>{doc.name} · {doc.category}{!doc.memberIds.length?' · Shared / unassigned':''}</label>)}</div>
                </details>
                <p className="text-xs text-ink-500">{demoOnly ? 'Demo reads text locally; AI and scanned-image reading are disabled.' : 'Selected document text is sent to Teluva’s AI service (Google Gemini). Saved scans may also use image reading. This uses your usual AI allowance. Nothing is added until you review it.'}</p>
                <button type="button" className="btn-primary text-sm" disabled={isProcessing || documentSelection?.length===0} onClick={scanSavedDocuments}>Read selected documents</button>
              </section>}
              <div>
                <label className="field-label" htmlFor="timeline-import-text">Paste a list of dates</label>
                <textarea
                  id="timeline-import-text"
                  className="field min-h-[140px] resize-y"
                  placeholder={'One moment per line works best, for example:\n12.04.2019 Nora born\nMarch 2019 — moved to Vienna\n2015 Jonas started school'}
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  disabled={isProcessing}
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => runPipeline(pastedText)}
                  disabled={!pastedText.trim() || isProcessing}
                  className="btn-primary text-[13px] px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Read these dates
                </button>
              </div>

              <div className="text-[11px] font-semibold text-ink-400 uppercase tracking-wide text-center">or</div>

              <div
                onDragOver={handleDragOver}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => { if (!isProcessing) fileInputRef.current?.click(); }}
                role="button"
                tabIndex={0}
                onKeyDown={(e: KeyboardEvent) => { if (!isProcessing && (e.key === 'Enter' || e.key === ' ')) fileInputRef.current?.click(); }}
                className={`rounded-2xl border-2 border-dashed p-5 text-center transition-colors ${isProcessing ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} ${isDragging ? 'border-clay-400 bg-clay-50' : 'border-cream-300 hover:border-cream-400 hover:bg-cream-50'}`}
              >
                <Upload className={`w-6 h-6 mx-auto mb-2 ${isDragging ? 'text-clay-500' : 'text-ink-400'}`} />
                <p className="text-[13px] font-semibold text-ink-700">Upload a CV or timeline file</p>
                <p className="text-[12px] text-ink-400 mt-0.5">CV in PDF or Word (.docx), CSV / TSV, calendar (.ics), or text. Up to 20 MB.</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={`${ACCEPTED_EXTENSIONS},${ACCEPTED_MIME}`}
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </div>

              {isProcessing && !assistantNotice && (
                <p className="text-[12px] text-ink-500 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Reading…
                </p>
              )}
              {assistantNotice && (
                <p className="text-[12px] text-clay-700 flex items-center gap-1.5 bg-clay-50 border border-clay-200 rounded-xl px-3 py-2" role="status">
                  <Sparkles className="w-3.5 h-3.5" /> {assistantNotice}
                </p>
              )}
              {readError && (
                <p className="text-[12px] text-rosa-700 bg-rosa-50 border border-rosa-100 rounded-xl px-3 py-2 flex items-start gap-2" role="alert">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {readError}
                </p>
              )}
              {demoSkippedCount > 0 && (
                <p className="text-[12px] text-ink-400">
                  Demo: {demoSkippedCount} line{demoSkippedCount === 1 ? '' : 's'} had no date we could read here, and the assistant isn't used in the demo, so {demoSkippedCount === 1 ? 'it was' : 'they were'} left out.
                </p>
              )}
              <p className="text-[11px] text-ink-400">
                CV and document text is sent to Google Gemini to find work, education and other dated moments. Review dates and people before saving. For scanned files, save them in the Vault first, then use Read selected documents. Demo uses local text parsing only.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {demoSkippedCount > 0 && (
                <p className="text-[12px] text-ink-400">
                  Demo: {demoSkippedCount} line{demoSkippedCount === 1 ? '' : 's'} with no readable date {demoSkippedCount === 1 ? 'was' : 'were'} left out — the assistant isn't used in the demo.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-cream-200">
                <button type="button" onClick={selectAllReady} className="btn-quiet text-[12px] px-3 py-1.5">
                  Select all ready
                </button>
                {members.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-semibold text-ink-400">Set person for selected:</span>
                    {members.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setPersonForSelected(m.id)}
                        className="chip bg-cream-100 text-ink-600 border border-cream-300 hover:bg-cream-200 transition-colors"
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {submitError && (
                <p className="text-[12px] text-rosa-700 bg-rosa-50 border border-rosa-100 rounded-xl px-3 py-2 flex items-start gap-2" role="alert">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {submitError}
                </p>
              )}

              <div className="space-y-2.5">
                {rows.map((row) => {
                  const reason = row.keepUndated && !row.duplicateOf ? 'Will be kept without a date' : rowReason(row);
                  const grain = grainOf(row);
                  return (
                    <div
                      key={row.key}
                      className={`rounded-2xl border p-3 ${row.checked ? 'border-clay-200 bg-clay-50/40' : 'border-cream-200 bg-white'}`}
                    >
                      <div className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={row.checked}
                          onChange={(e) => updateRow(row.key, { checked: e.target.checked })}
                          className="mt-2 w-4 h-4 rounded border-cream-300 text-clay-700 focus:ring-2 focus:ring-clay-700 cursor-pointer shrink-0"
                          aria-label={`Include ${row.title || 'this moment'}`}
                        />
                        <div className="flex-1 min-w-0 space-y-2">
                          <input
                            type="text"
                            value={row.title}
                            onChange={(e) => updateRow(row.key, { title: e.target.value })}
                            placeholder="Title"
                            className="field py-2"
                            aria-label="Title"
                          />
                          {!row.date && <label className="flex gap-2 text-xs"><input type="checkbox" checked={!!row.keepUndated} onChange={e=>updateRow(row.key,{keepUndated:e.target.checked,checked:e.target.checked})}/>Keep this moment without a date</label>}
                          <div className="flex flex-wrap gap-2">
                            {grain === 'month' ? (
                              <input
                                type="month"
                                value={row.date ? row.date.slice(0, 7) : ''}
                                onChange={(e) => updateRow(row.key, { date: e.target.value ? `${e.target.value}-01` : '', needsDate: !e.target.value })}
                                className="field py-2 w-auto"
                                aria-label="Month and year"
                              />
                            ) : grain === 'year' ? (
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]{4}"
                                maxLength={4}
                                placeholder="YYYY"
                                value={row.date ? row.date.slice(0, 4) : ''}
                                onChange={(e) => {
                                  const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                                  updateRow(row.key, { date: digits.length === 4 ? `${digits}-01-01` : '', needsDate: digits.length !== 4 });
                                }}
                                className="field py-2 w-20 tabular-nums"
                                aria-label="Year"
                              />
                            ) : (
                              <input
                                type="date"
                                value={row.date || ''}
                                onChange={(e) => updateRow(row.key, { date: e.target.value, needsDate: !e.target.value })}
                                className="field py-2 w-auto"
                                aria-label="Date"
                              />
                            )}
                            <select
                              value={grain}
                              onChange={(e) => setGrain(row, e.target.value as Grain)}
                              className="field py-2 w-auto"
                              aria-label="How exact is the date"
                            >
                              <option value="day">Exact day</option>
                              <option value="month">Month only</option>
                              <option value="year">Year only</option>
                            </select>
                            <select
                              value={row.category || 'memory'}
                              onChange={(e) => updateRow(row.key, { category: e.target.value as LifeCategory })}
                              className="field py-2 w-auto"
                              aria-label="Kind"
                            >
                              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>
                          </div>
                          {members.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {members.map((m) => {
                                const active = row.memberIds.includes(m.id);
                                return (
                                  <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => toggleRowMember(row.key, m.id)}
                                    aria-pressed={active}
                                    className={`chip border transition-colors ${active ? 'bg-clay-700 text-white border-clay-700' : 'bg-white text-ink-600 border-cream-300 hover:bg-cream-100'}`}
                                  >
                                    {m.name}
                                  </button>
                                );
                              })}
                              {row.memberIds.length === 0 && <span className="text-[11px] text-ink-400 self-center">Whole family</span>}
                            </div>
                          )}
                          <input
                            type="text"
                            value={row.note || ''}
                            onChange={(e) => updateRow(row.key, { note: e.target.value })}
                            placeholder="Note (optional)"
                            className="field py-2 text-[13px]"
                            aria-label="Note"
                          />
                          {row.sourceText && (
                            <p className="text-[11px] text-ink-400 truncate" title={row.sourceText}>from: {row.sourceText}</p>
                          )}
                          {(reason || row.repeats) && (
                            <div className="flex flex-wrap gap-1.5">
                              {reason && <span className="chip bg-honey-100 text-honey-800">{reason}</span>}
                              {row.repeats && <span className="chip bg-cream-200 text-ink-600">Repeats — only the first date was brought in</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {step === 2 && (
          <div className="p-4 bg-white border-t border-cream-200 flex items-center justify-between gap-3">
            <button type="button" onClick={() => setStep(1)} className="btn-quiet text-[13px] px-4 py-2.5">
              Back
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={readyCount === 0 || isSubmitting}
              className="btn-primary text-[13px] px-5 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Adding…' : `Add ${readyCount} moment${readyCount === 1 ? '' : 's'}`}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
