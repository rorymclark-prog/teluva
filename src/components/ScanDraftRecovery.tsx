import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { appConfirm } from '../utils/appConfirm';
import { SCAN_DRAFT_EVENT, scanDraftStore, scanDraftBackup, downloadScanBackup, type ScanDraftSummary, type ScanScope } from '../utils/scanDrafts';
import type { ScannedFile } from './DocumentScannerModal';
const Scanner = React.lazy(() => import('./DocumentScannerModal'));

export default function ScanDraftRecovery({ onUse }: { onUse: (file: ScannedFile) => void | Promise<void> }) {
  const { uid, familyId, canWrite } = useFamilyCtx();
  if (!uid || !familyId || !canWrite) return null;
  return <RecoveryList key={JSON.stringify([uid, familyId])} scope={{ uid, spaceId: familyId }} onUse={onUse} />;
}

function RecoveryList({ scope, onUse }: { key?: string; scope: ScanScope; onUse: (file: ScannedFile) => void | Promise<void> }) {
  const [drafts, setDrafts] = useState<ScanDraftSummary[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [resume, setResume] = useState<string | null>(null);
  const [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => { void scanDraftStore.list(scope).then(rows => { if (active.current) { setDrafts(rows.filter(r => r.pages > 0 || !!r.fileName)); setError(''); } }).catch(() => { if (active.current) setError('Scan recovery storage is unavailable on this device. New scans will show a warning if they cannot be backed up.'); }); };
    const changed = () => { clearTimeout(timer); timer = setTimeout(refresh, 100); };
    refresh(); window.addEventListener(SCAN_DRAFT_EVENT, changed); window.addEventListener('focus', refresh);
    return () => { active.current = false; clearTimeout(timer); window.removeEventListener(SCAN_DRAFT_EVENT, changed); window.removeEventListener('focus', refresh); };
  }, [scope.uid, scope.spaceId]);
  if (!drafts.length && !error) return null;
  return <section className="card p-4 space-y-3" aria-label="Scan recovery">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="font-semibold text-sm">{drafts.length ? `${drafts.length} ${drafts.length === 1 ? 'scan' : 'scans'} saved on this device` : 'Scan recovery'}</h2><p className="text-xs text-ink-500">Recovery copies stay here through reloads and failed uploads. Filing a scan does not discard its local backup.</p></div>
      {!!drafts.length && <button type="button" className="btn-quiet text-xs" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? 'Hide saved scans' : 'Recover scans'}</button>}
    </div>
    {error && <p role="alert" className="text-xs text-rosa-600">{error}</p>}
    {expanded && <div className="space-y-3">{drafts.map(draft => <div key={draft.id} className="border-t border-cream-200 pt-3">
      <p className="font-semibold text-sm">{draft.fileName || draft.title}</p><p className="text-xs text-ink-500">{draft.ready ? 'Ready to file' : `${draft.pages} captured ${draft.pages === 1 ? 'page' : 'pages'}`} · {new Date(draft.updatedAt).toLocaleString()}</p>
      <div className="flex flex-wrap gap-2 mt-2">
        <button type="button" className="btn-primary text-xs" onClick={() => setResume(draft.id)}>Resume scan</button>
        <button type="button" className="btn-quiet text-xs" onClick={async () => { try { const snapshot = await scanDraftStore.read(scope, draft.id); if (!snapshot || !active.current) return; const blob = await scanDraftBackup(snapshot); if (active.current) downloadScanBackup(blob, 'teluva-scan-backup.zip'); } catch { if (active.current) setError('Could not download that backup. The saved scan has been kept.'); } }}>Download backup</button>
        <button type="button" className="btn-quiet text-xs" onClick={async () => { if (!(await appConfirm('Discard this recovery copy and its original captures? Only do this after checking the saved document or downloading a backup.', { danger: true, confirmLabel: 'Discard recovery copy' })) || !active.current) return; try { await scanDraftStore.discard(scope, draft.id); } catch { if (active.current) setError('Could not discard the recovery copy. It has been kept.'); } }}>Discard recovery copy</button>
      </div>
    </div>)}</div>}
    {resume && <Suspense fallback={<p role="status">Opening saved scan…</p>}><Scanner open draftId={resume} onClose={() => setResume(null)} onUse={onUse} title="Recovered scan" /></Suspense>}
  </section>;
}
