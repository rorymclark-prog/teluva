import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { FamilyMember, ReferralRecord, ReferralKind, ReferralStatus, HealthcareProvider } from '../types';
import { loadFamilyInfo, uploadReferralFile, uploadReferralPhoto, deleteReferralFile } from '../utils/db';
import { isDemoMode } from '../utils/demoData';
import { compressImageToAvatar } from '../utils/imageCompress';
import { computeFileHash, hashDataUrl, findLikelyDuplicate, DupMatch } from '../utils/documentDedup';
import { buildReferralGroups, ReferralSeries } from '../utils/referralGrouping';
import PdfThumbnail from './PdfThumbnail';
import type { ScannedFile } from './DocumentScannerModal';
const DocumentScannerModal = React.lazy(() => import('./DocumentScannerModal'));
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import {
  FileText, Camera, Upload, Plus, Trash2, Pencil, Check, X,
  AlertCircle, AlertTriangle, Loader2, ExternalLink, Calendar, ChevronDown, Layers,
} from 'lucide-react';

const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);

const REFERRAL_KINDS: ReferralKind[] = ['Referral', 'Imaging', 'Lab result', 'Specialist letter', 'Sick note', 'Other'];

// Doctor/specialist types worth offering in the provider picker — mirrors
// ImportantInfo.tsx's local MEDICAL_PROVIDER_TYPES (kept as its own copy
// here since that list isn't exported for reuse).
const MEDICAL_PROVIDER_TYPES = ['GP practice', 'Dentist', 'Optician', 'Specialist', 'Pharmacy'];

const KIND_CHIP: Record<string, string> = {
  Referral: 'bg-dusk-100 text-dusk-700',
  Imaging: 'bg-clay-100 text-clay-600',
  'Lab result': 'bg-sage-100 text-sage-700',
  'Specialist letter': 'bg-honey-100 text-honey-700',
  'Sick note': 'bg-rosa-100 text-rosa-700',
  Other: 'bg-cream-200 text-ink-600',
};

const STATUS_LABEL: Record<ReferralStatus, string> = { open: 'Open', booked: 'Booked', done: 'Done' };
const STATUS_CHIP: Record<ReferralStatus, string> = {
  open: 'bg-rosa-100 text-rosa-700',
  booked: 'bg-honey-100 text-honey-700',
  done: 'bg-sage-100 text-sage-700',
};

// Storage's own cap (see storage.rules) — far more headroom than the 700KB
// Firestore-inline limit MemberDocuments.tsx has to work around, because
// referral files never touch a Firestore document body.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Days since `date` (positive = in the past). Display-only signal for "this
// referral has sat open for a while" — never a push/reminder on its own.
function daysSince(dateStr?: string): number | null {
  if (!dateStr) return null;
  const then = new Date(dateStr + 'T00:00:00');
  if (isNaN(then.getTime())) return null;
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

type PendingUpload = { kind: 'file'; file: File } | { kind: 'scan'; scan: ScannedFile };

interface MemberReferralsProps {
  member: FamilyMember;
  onUpdate: (patch: Partial<FamilyMember>) => void;
}

export default function MemberReferrals({ member, onUpdate }: MemberReferralsProps) {
  const [records, setRecords] = useState<ReferralRecord[]>(() => member.referrals || []);
  const [providers, setProviders] = useState<HealthcareProvider[]>([]);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [previewRecord, setPreviewRecord] = useState<ReferralRecord | null>(null);
  const demo = isDemoMode();

  // Reset local state when the selected member changes.
  useEffect(() => {
    setRecords(member.referrals || []);
    setAdding(false);
    setEditId(null);
  }, [member.id]);

  // Read-only self-load of the family's doctor directory for the provider
  // picker — same self-load pattern ImportantInfo.tsx uses for FamilyInfo.
  // Providers are still only ever ADDED/EDITED on Info → Doctors & Specialists;
  // this never writes back to that list.
  useEffect(() => {
    let active = true;
    loadFamilyInfo()
      .then((info) => {
        if (active) setProviders((info?.providers || []).filter((p) => MEDICAL_PROVIDER_TYPES.includes(p.type)));
      })
      .catch(() => { /* provider picker just falls back to free text */ });
    return () => { active = false; };
  }, []);

  const persist = (next: ReferralRecord[]) => {
    setRecords(next);
    onUpdate({ referrals: next });
  };

  const handleSave = (rec: ReferralRecord) => {
    const exists = records.find((r) => r.id === rec.id);
    persist(exists ? records.map((r) => (r.id === rec.id ? rec : r)) : [...records, rec]);
    setAdding(false);
    setEditId(null);
  };

  const handleDelete = async (rec: ReferralRecord) => {
    const label = rec.reason ? `${rec.kind} — ${rec.reason}` : rec.kind;
    if (!window.confirm(`Delete "${label}"? This removes the file and its details from ${member.name}'s Referrals & Results. This can't be undone.`)) return;
    if (!demo) await deleteReferralFile(rec.storagePath);
    persist(records.filter((r) => r.id !== rec.id));
  };

  const quickSetStatus = (rec: ReferralRecord, status: ReferralStatus) => {
    persist(records.map((r) => (r.id === rec.id ? { ...r, status } : r)));
  };

  // Repeated same-test lab results / imaging read as ONE series with multiple
  // dates, not N unrelated rows — see referralGrouping.ts for the grouping
  // rule and the safety note on why this stays chronology-only (order and
  // count, never a comparison of what's in a result).
  const groups = useMemo(() => buildReferralGroups(records), [records]);

  const firstName = member.name.split(/\s+/)[0] || member.name;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold text-ink-900 flex items-center gap-2">
          <span className="w-1.5 h-3.5 bg-ink-800 rounded-full inline-block"></span>
          Referrals &amp; Results
        </h3>
        {!adding && (
          <button onClick={() => { setAdding(true); setEditId(null); }} className="btn-primary text-xs px-3 py-1.5">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        )}
      </div>
      <p className="text-[12.5px] text-ink-400 -mt-2">
        Referral letters, X-rays, scans, lab results and specialist letters — everything a doctor hands {firstName}.
      </p>

      <div className="card p-5 space-y-4">
        {adding && (
          <ReferralForm
            member={member}
            providers={providers}
            existing={records}
            onSave={handleSave}
            onCancel={() => setAdding(false)}
            demo={demo}
          />
        )}

        {groups.length === 0 && !adding ? (
          <div className="py-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-clay-50 text-clay-600 mb-3">
              <FileText className="w-5 h-5" />
            </div>
            <p className="text-[13px] text-ink-400">Nothing filed yet — add a referral letter, scan, or result.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {groups.map((item) => {
              if (item.type === 'single') {
                const rec = item.record;
                return editId === rec.id ? (
                  <div key={rec.id}>
                    <ReferralForm
                      member={member}
                      providers={providers}
                      existing={records}
                      initial={rec}
                      onSave={handleSave}
                      onCancel={() => setEditId(null)}
                      demo={demo}
                    />
                  </div>
                ) : (
                  <div key={rec.id}>
                    <ReferralRow
                      rec={rec}
                      onEdit={() => { setEditId(rec.id); setAdding(false); }}
                      onDelete={() => handleDelete(rec)}
                      onView={() => setPreviewRecord(rec)}
                      onStatus={(s) => quickSetStatus(rec, s)}
                    />
                  </div>
                );
              }

              // A record inside this series is being edited — drop out of the
              // grouped card and reuse the exact same form/edit flow a single
              // record gets, rather than building a second editing UI.
              const editingRec = item.records.find((r) => r.id === editId);
              if (editingRec) {
                return (
                  <div key={item.key}>
                    <ReferralForm
                      member={member}
                      providers={providers}
                      existing={records}
                      initial={editingRec}
                      onSave={handleSave}
                      onCancel={() => setEditId(null)}
                      demo={demo}
                    />
                  </div>
                );
              }

              return (
                <div key={item.key}>
                  <ReferralSeriesCard
                    series={item}
                    onEdit={(rec) => { setEditId(rec.id); setAdding(false); }}
                    onDelete={(rec) => handleDelete(rec)}
                    onView={(rec) => setPreviewRecord(rec)}
                    onStatus={(rec, s) => quickSetStatus(rec, s)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {previewRecord && (
        <ReferralPreview record={previewRecord} memberName={member.name} onClose={() => setPreviewRecord(null)} />
      )}
    </section>
  );
}

/* ---------------- Row ---------------- */

function ReferralRow({
  rec, onEdit, onDelete, onView, onStatus,
}: {
  rec: ReferralRecord;
  onEdit: () => void;
  onDelete: () => void;
  onView: () => void;
  onStatus: (s: ReferralStatus) => void;
}) {
  const status = rec.status || 'open';
  const overdueDays = status === 'open' ? daysSince(rec.date) : null;
  const flagOverdue = overdueDays != null && overdueDays >= 14;

  return (
    <div className="p-3.5 rounded-2xl border border-cream-200 bg-white flex flex-col sm:flex-row sm:items-start gap-3 hover:bg-cream-50 hover:border-cream-300 transition-colors">
      <button type="button" onClick={onView} className="shrink-0" title="View">
        {rec.fileType === 'application/pdf' ? (
          <PdfThumbnail src={rec.downloadUrl} size="w-14 h-14" />
        ) : (
          <img src={rec.downloadUrl} alt="" className="w-14 h-14 rounded-xl object-cover border border-cream-200" referrerPolicy="no-referrer" />
        )}
      </button>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`chip ${KIND_CHIP[rec.kind] || KIND_CHIP.Other}`}>{rec.kind}</span>
          <span className={`chip ${STATUS_CHIP[status]}`}>{STATUS_LABEL[status]}</span>
          {flagOverdue && (
            <span className="chip bg-rosa-100 text-rosa-700 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Not yet booked · {overdueDays}d
            </span>
          )}
        </div>
        <p className="text-[14px] font-semibold text-ink-900 truncate">
          {rec.reason || rec.kind}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-ink-500">
          {rec.date && (
            <span className="tabular-nums flex items-center gap-1"><Calendar className="w-3 h-3" />{rec.date}</span>
          )}
          {rec.providerName && <span>{rec.providerName}</span>}
          {status === 'booked' && rec.appointmentDate && (
            <span className="tabular-nums">Appt {rec.appointmentDate}</span>
          )}
        </div>
        {rec.notes && <p className="text-[12px] text-ink-400 italic">{rec.notes}</p>}

        {/* Quick lifecycle change — no need to open the edit form just to move a referral along */}
        <div className="flex items-center gap-1 pt-1">
          {(['open', 'booked', 'done'] as ReferralStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onStatus(s)}
              className={`px-2 py-0.5 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer ${
                status === s ? 'bg-ink-800 text-white' : 'bg-cream-100 text-ink-500 hover:bg-cream-200'
              }`}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0 self-start">
        <button onClick={onEdit} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg" title="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ---------------- Series (repeated same-test results, grouped) ----------------
 * Chronology and count ONLY — dates, order, "N on file". This never compares,
 * plots, or characterizes what's inside a result (no trend arrows, no "rising"/
 * "improving" language, no value-based colour). The app files and finds
 * documents; it does not read or evaluate them. See referralGrouping.ts.
 */

function ReferralSeriesCard({
  series, onEdit, onDelete, onView, onStatus,
}: {
  series: ReferralSeries;
  onEdit: (rec: ReferralRecord) => void;
  onDelete: (rec: ReferralRecord) => void;
  onView: (rec: ReferralRecord) => void;
  onStatus: (rec: ReferralRecord, s: ReferralStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = series.records.length;
  const latest = series.records[0]; // already sorted newest-first
  const earlierCount = total - 1;
  const latestStatus = latest.status || 'open';
  const overdueDays = latestStatus === 'open' ? daysSince(latest.date) : null;
  const flagOverdue = overdueDays != null && overdueDays >= 14;

  return (
    <div className="rounded-2xl border border-cream-200 bg-white overflow-hidden hover:border-cream-300 transition-colors">
      <div className="p-3.5 flex flex-col sm:flex-row sm:items-start gap-3">
        <button type="button" onClick={() => onView(latest)} className="shrink-0" title="View most recent">
          {latest.fileType === 'application/pdf' ? (
            <PdfThumbnail src={latest.downloadUrl} size="w-14 h-14" />
          ) : (
            <img src={latest.downloadUrl} alt="" className="w-14 h-14 rounded-xl object-cover border border-cream-200" referrerPolicy="no-referrer" />
          )}
        </button>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`chip ${KIND_CHIP[series.kind] || KIND_CHIP.Other}`}>{series.kind}</span>
            <span className="chip bg-dusk-50 text-dusk-700 flex items-center gap-1">
              <Layers className="w-3 h-3" /> {total} on file
            </span>
            <span className={`chip ${STATUS_CHIP[latestStatus]}`}>{STATUS_LABEL[latestStatus]}</span>
            {flagOverdue && (
              <span className="chip bg-rosa-100 text-rosa-700 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Not yet booked · {overdueDays}d
              </span>
            )}
          </div>
          <p className="text-[14px] font-semibold text-ink-900 truncate">{series.label}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-ink-500">
            <span className="tabular-nums flex items-center gap-1">
              <Calendar className="w-3 h-3" />Most recent{latest.date ? `: ${latest.date}` : ''}
            </span>
            {latest.providerName && <span>{latest.providerName}</span>}
            {latestStatus === 'booked' && latest.appointmentDate && (
              <span className="tabular-nums">Appt {latest.appointmentDate}</span>
            )}
          </div>
          {latest.notes && <p className="text-[12px] text-ink-400 italic">{latest.notes}</p>}

          {/* Quick lifecycle change for the most recent result only — older ones
              in the series are already resolved in the vast majority of cases. */}
          <div className="flex items-center gap-1 pt-1">
            {(['open', 'booked', 'done'] as ReferralStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onStatus(latest, s)}
                className={`px-2 py-0.5 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer ${
                  latestStatus === s ? 'bg-ink-800 text-white' : 'bg-cream-100 text-ink-500 hover:bg-cream-200'
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 self-start">
          <button onClick={() => onEdit(latest)} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit most recent">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(latest)} className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg" title="Delete most recent">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {earlierCount > 0 && (
        <div className="border-t border-cream-100">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="w-full px-3.5 py-2 text-[12px] font-semibold text-ink-500 hover:text-ink-700 hover:bg-cream-50 flex items-center gap-1.5 cursor-pointer"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            {expanded ? 'Hide earlier results' : `Show ${earlierCount} earlier result${earlierCount > 1 ? 's' : ''}`}
          </button>
          {expanded && (
            <div className="divide-y divide-cream-100">
              {series.records.slice(1).map((rec, i) => {
                // Chronological position within the series — oldest is #1 —
                // so "this is the third of these" is visible at a glance.
                // Order and count only, nothing about what the result says.
                const position = total - 1 - i;
                const s = rec.status || 'open';
                return (
                  <div key={rec.id} className="px-3.5 py-2.5 flex items-center gap-3">
                    <span
                      className="text-[11px] font-semibold text-ink-300 tabular-nums w-5 shrink-0"
                      title={`${position} of ${total}, in order filed`}
                    >
                      #{position}
                    </span>
                    <button type="button" onClick={() => onView(rec)} className="shrink-0" title="View">
                      {rec.fileType === 'application/pdf' ? (
                        <PdfThumbnail src={rec.downloadUrl} size="w-9 h-9" />
                      ) : (
                        <img src={rec.downloadUrl} alt="" className="w-9 h-9 rounded-lg object-cover border border-cream-200" referrerPolicy="no-referrer" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
                        {rec.date && <span className="tabular-nums text-ink-700 font-medium">{rec.date}</span>}
                        <span className={`chip ${STATUS_CHIP[s]}`}>{STATUS_LABEL[s]}</span>
                      </div>
                      {rec.providerName && <p className="text-[11.5px] text-ink-400 truncate">{rec.providerName}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => onEdit(rec)} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => onDelete(rec)} className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Add / edit form ---------------- */

function ReferralForm({
  member, providers, existing, initial, onSave, onCancel, demo,
}: {
  member: FamilyMember;
  providers: HealthcareProvider[];
  existing: ReferralRecord[];
  initial?: ReferralRecord;
  onSave: (rec: ReferralRecord) => void;
  onCancel: () => void;
  demo: boolean;
}) {
  const isPreset = (k: string) => REFERRAL_KINDS.includes(k as ReferralKind) && k !== 'Other';
  const [kind, setKind] = useState<string>(initial && isPreset(initial.kind) ? initial.kind : (initial ? 'Other' : 'Referral'));
  const [customKind, setCustomKind] = useState(initial && !isPreset(initial.kind) ? initial.kind : '');
  const [date, setDate] = useState(initial?.date || '');
  const [providerId, setProviderId] = useState(initial?.providerId || '');
  const [providerName, setProviderName] = useState(initial?.providerName || '');
  const [reason, setReason] = useState(initial?.reason || '');
  const [appointmentDate, setAppointmentDate] = useState(initial?.appointmentDate || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Mount the (lazy) scanner once, the first time it's actually opened, and
  // never unmount it again — otherwise an always-rendered-with-an-open-prop
  // lazy component downloads its chunk on first paint regardless. See
  // Dashboard.tsx's ExportPackModal for the same pattern and reasoning.
  const [scannerEverOpened, setScannerEverOpened] = useState(false);
  useEffect(() => { if (scannerOpen) setScannerEverOpened(true); }, [scannerOpen]);
  const [duplicateMatch, setDuplicateMatch] = useState<DupMatch<ReferralRecord> | null>(null);
  const [pendingHash, setPendingHash] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleProviderSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pid = e.target.value;
    setProviderId(pid);
    if (pid) {
      const p = providers.find((pr) => pr.id === pid);
      setProviderName(p ? p.name : '');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setDuplicateMatch(null);
    setPendingUpload({ kind: 'file', file: f });
  };

  const handleScannerResult = (scan: ScannedFile) => {
    setError(null);
    setDuplicateMatch(null);
    setPendingUpload({ kind: 'scan', scan });
  };

  const pendingLabel = pendingUpload
    ? pendingUpload.kind === 'file'
      ? `${pendingUpload.file.name} (${formatBytes(pendingUpload.file.size)})`
      : `${pendingUpload.scan.type === 'application/pdf' ? 'Scanned PDF' : 'Camera scan'} (${formatBytes(pendingUpload.scan.size)})`
    : initial
      ? `Current file: ${initial.fileName} (${formatBytes(initial.fileSize)})`
      : null;

  const doSave = async (hash?: string) => {
    const finalKind = (kind === 'Other' && customKind.trim()) ? customKind.trim() : kind;
    const recordId = initial?.id || newId();
    const oldStoragePath = initial?.storagePath;

    let fileMeta: Pick<ReferralRecord, 'fileName' | 'fileType' | 'fileSize' | 'storagePath' | 'downloadUrl' | 'contentHash'> | null =
      initial
        ? {
            fileName: initial.fileName,
            fileType: initial.fileType,
            fileSize: initial.fileSize,
            storagePath: initial.storagePath,
            downloadUrl: initial.downloadUrl,
            contentHash: initial.contentHash,
          }
        : null;

    if (pendingUpload) {
      if (pendingUpload.kind === 'file') {
        const file = pendingUpload.file;
        if (file.size > MAX_UPLOAD_BYTES) {
          setError(`"${file.name}" is larger than 20 MB — please use a smaller file.`);
          return;
        }
        if (file.type.startsWith('image/')) {
          const dataUrl = await fileToDataUrl(file);
          const compressed = await compressImageToAvatar(dataUrl, 1600, 0.85);
          const bytesCount = Math.round((compressed.length * 3) / 4);
          const up = demo
            ? { storagePath: '', downloadUrl: compressed }
            : await uploadReferralPhoto(compressed, member.id, recordId, 'image/jpeg');
          fileMeta = { fileName: file.name, fileType: 'image/jpeg', fileSize: bytesCount, storagePath: up.storagePath, downloadUrl: up.downloadUrl, contentHash: hash };
        } else {
          const up = demo
            ? { storagePath: '', downloadUrl: await fileToDataUrl(file) }
            : await uploadReferralFile(file, member.id, recordId);
          fileMeta = { fileName: file.name, fileType: file.type || 'application/octet-stream', fileSize: file.size, storagePath: up.storagePath, downloadUrl: up.downloadUrl, contentHash: hash };
        }
      } else {
        const scan = pendingUpload.scan;
        const up = demo
          ? { storagePath: '', downloadUrl: scan.data }
          : await uploadReferralPhoto(scan.data, member.id, recordId, scan.type);
        fileMeta = { fileName: scan.name, fileType: scan.type, fileSize: scan.size, storagePath: up.storagePath, downloadUrl: up.downloadUrl, contentHash: hash };
      }
    }

    if (!fileMeta) {
      setError('Please attach a photo or PDF.');
      return;
    }

    const rec: ReferralRecord = {
      id: recordId,
      kind: finalKind,
      date: date || undefined,
      providerId: providerId || undefined,
      providerName: providerName.trim() || undefined,
      reason: reason.trim() || undefined,
      status: initial?.status || 'open',
      appointmentDate: appointmentDate || undefined,
      notes: notes.trim() || undefined,
      ...fileMeta,
      addedAt: initial?.addedAt || new Date().toISOString(),
    };

    onSave(rec);

    // Best-effort cleanup of a replaced file — only AFTER the new one is
    // safely referenced on the saved record, and only when it actually changed.
    if (oldStoragePath && oldStoragePath !== rec.storagePath && !demo) {
      void deleteReferralFile(oldStoragePath);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const finalKind = (kind === 'Other' && customKind.trim()) ? customKind.trim() : kind;
    if (!finalKind.trim()) { setError('Please choose or enter a kind.'); return; }
    if (!pendingUpload && !initial) { setError('Please attach a photo or PDF.'); return; }

    setUploading(true);
    try {
      if (pendingUpload && !duplicateMatch) {
        const hash = pendingUpload.kind === 'file'
          ? await computeFileHash(pendingUpload.file)
          : await hashDataUrl(pendingUpload.scan.data);
        const sig = pendingUpload.kind === 'file'
          ? { fileName: pendingUpload.file.name, fileSize: pendingUpload.file.size, contentHash: hash }
          : { fileName: pendingUpload.scan.name, fileSize: pendingUpload.scan.size, contentHash: hash };
        const others = existing.filter((r) => r.id !== initial?.id);
        const match = findLikelyDuplicate(sig, others);
        if (match) {
          setDuplicateMatch(match);
          setPendingHash(hash);
          setUploading(false);
          return; // wait for the user to confirm or cancel
        }
        await doSave(hash);
      } else {
        await doSave(pendingUpload ? pendingHash : undefined);
      }
    } catch (err) {
      console.error('Referral save failed:', err);
      setError(demo ? "Couldn't save in demo mode." : "Couldn't save — check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  const confirmDuplicate = async () => {
    setUploading(true);
    try {
      await doSave(pendingHash);
    } catch (err) {
      console.error('Referral save failed:', err);
      setError("Couldn't save — check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-4 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-3">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="field-label">Kind</label>
            <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
              {REFERRAL_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            {kind === 'Other' && (
              <input
                className="field mt-2"
                placeholder="Describe what this is"
                value={customKind}
                onChange={(e) => setCustomKind(e.target.value)}
              />
            )}
          </div>
          <div>
            <label className="field-label">Date on the document</label>
            <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="field-label">Doctor / practice</label>
            <select className="field" value={providerId} onChange={handleProviderSelect}>
              <option value="">— choose from directory —</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.practiceName ? ` · ${p.practiceName}` : ''}</option>
              ))}
            </select>
            {!providerId && (
              <input
                className="field mt-2"
                placeholder="Or type a doctor/practice not yet in the directory"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
              />
            )}
            {providerId && (
              <p className="text-[11px] text-ink-400 mt-1">
                Linked to {providerName}.{' '}
                <button type="button" className="underline underline-offset-2 cursor-pointer" onClick={() => { setProviderId(''); setProviderName(''); }}>
                  Unlink
                </button>
              </p>
            )}
          </div>
          <div>
            <label className="field-label">Body part / reason</label>
            <input
              className="field"
              placeholder="e.g. Right knee, Annual bloods"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="field-label">Appointment date <span className="normal-case text-ink-300 font-normal">· optional, once booked</span></label>
          <input type="date" className="field" value={appointmentDate} onChange={(e) => setAppointmentDate(e.target.value)} />
        </div>

        <div>
          <label className="field-label">Notes</label>
          <textarea
            rows={2}
            className="field font-sans"
            placeholder="e.g. Fasting required before the blood draw"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {/* File attach */}
        <div>
          <label className="field-label">Photo or PDF</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <label className="btn-quiet flex-1 justify-center cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>{pendingLabel ? 'Choose a different file' : 'Choose a file'}</span>
              <input type="file" accept="image/*,application/pdf" onChange={handleFileChange} className="hidden" />
            </label>
            <button type="button" onClick={() => setScannerOpen(true)} className="btn-quiet flex-1 justify-center">
              <Camera className="w-3.5 h-3.5" />
              <span>Scan via camera</span>
            </button>
          </div>
          {pendingLabel && (
            <p className="text-[12px] text-ink-500 mt-1.5 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-ink-400" /> {pendingLabel}
            </p>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rosa-50 border border-rosa-100 text-[13px] text-rosa-700 flex items-start gap-2 leading-normal">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rosa-500" />
            <span>{error}</span>
          </div>
        )}

        {duplicateMatch && (
          <div className="p-3 rounded-xl bg-honey-50 border border-honey-200 text-[13px] text-honey-800 space-y-2">
            <p className="flex items-start gap-2 leading-normal">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                This file looks like it&apos;s already saved as &ldquo;{duplicateMatch.doc.reason || duplicateMatch.doc.kind}&rdquo;
                {duplicateMatch.doc.date ? ` (${duplicateMatch.doc.date})` : ''}.
              </span>
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={confirmDuplicate} disabled={uploading} className="btn-primary text-xs px-3 py-1.5 flex-1 justify-center disabled:opacity-50">
                {uploading ? 'Saving…' : 'Save anyway'}
              </button>
              <button type="button" onClick={() => { setDuplicateMatch(null); setPendingUpload(null); }} disabled={uploading} className="btn-quiet text-xs px-3 py-1.5 flex-1 justify-center disabled:opacity-50">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1 border-t border-cream-200">
          <button type="button" onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5">
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
          <button type="submit" disabled={uploading || !!duplicateMatch} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {uploading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      {scannerEverOpened && (
        <Suspense fallback={null}>
          <DocumentScannerModal
            open={scannerOpen}
            onClose={() => setScannerOpen(false)}
            onUse={handleScannerResult}
            title="Scan referral or result"
            scanType="document"
            filePrefix="referral"
          />
        </Suspense>
      )}
    </div>
  );
}

/* ---------------- Preview ---------------- */

function ReferralPreview({ record, memberName, onClose }: { record: ReferralRecord; memberName: string; onClose: () => void }) {
  // Parent (MemberReferrals, above) conditionally mounts this via
  // `{previewRecord && <ReferralPreview .../>}`, so the lock is unconditional
  // for this component's whole lifetime.
  useBodyScrollLock(true);

  const isPdf = record.fileType === 'application/pdf';
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div onClick={onClose} className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm" />
      <div className="relative w-full max-w-2xl card rounded-3xl overflow-hidden max-h-[90dvh] flex flex-col">
        <div className="p-4 border-b border-cream-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink-900 truncate">{record.reason || record.kind}</p>
            <p className="text-[12px] text-ink-400">{record.kind}{record.date ? ` · ${record.date}` : ''} · {memberName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-xl" title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto bg-cream-100 flex items-center justify-center p-4">
          {isPdf ? (
            <iframe src={record.downloadUrl} title={record.fileName} className="w-full h-[70dvh] border-0 rounded-xl bg-white" />
          ) : (
            <img src={record.downloadUrl} alt={record.fileName} className="max-w-full max-h-[70dvh] object-contain rounded-xl" referrerPolicy="no-referrer" />
          )}
        </div>
        <div className="p-4 border-t border-cream-200 flex items-center justify-between gap-3">
          {record.notes ? <p className="text-[12px] text-ink-500 italic truncate flex-1">{record.notes}</p> : <span />}
          <a href={record.downloadUrl} target="_blank" rel="noreferrer" className="btn-quiet shrink-0">
            <ExternalLink className="w-3.5 h-3.5" /> Open full size
          </a>
        </div>
      </div>
    </div>
  );
}
