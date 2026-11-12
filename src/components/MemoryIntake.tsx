import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import type { FamilyMember } from '../types';
import { auth } from '../lib/firebase';
import { FAMILY_ID } from '../utils/db';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { createFileOperationScope, type FileOperationScope } from '../utils/fileOperationScope';
import { createImportInboxClient, type ImportInboxItem, type MemoryProposal } from '../utils/importInboxClient';
import { curateSourceWindows, memoryEvidenceContext, memoryFromRow, readMemoryExport } from '../utils/memoryCuration';

export default function MemoryIntake({ members, api, onItem }: { members: FamilyMember[]; api: ReturnType<typeof createImportInboxClient>; onItem: (item: ImportInboxItem) => void }) {
  const ctx = useFamilyCtx(), latest = useRef(ctx); latest.current = ctx;
  const [text, setText] = useState(''), [name, setName] = useState(''), [dateOrder, setDateOrder] = useState('dmy');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const mounted = useRef(true), generation = useRef(0), working = useRef(false), input = useRef<HTMLInputElement>(null), pending = useRef<FileOperationScope | null>(null);
  const queued = useRef<{ memory: MemoryProposal; sourceText: string; requestId: string; done: boolean }[]>([]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  const current = () => mounted.current && latest.current.uid === auth.currentUser?.uid && latest.current.familyId === FAMILY_ID && latest.current.canWrite && !latest.current.loading;
  const scope = () => createFileOperationScope(() => [mounted.current, generation.current, auth.currentUser?.uid, FAMILY_ID, latest.current.familyId, latest.current.uid, latest.current.role, latest.current.aiConsent, latest.current.canWrite, latest.current.loading]);
  const reset = () => { generation.current++; queued.current = []; setError(''); setStatus(''); };
  const read = async (file: File, selected: FileOperationScope) => {
    if (!current() || working.current || !selected.isCurrent()) return;
    working.current = true; setBusy(true);
    try { const value = await readMemoryExport(file, selected); selected.check(); setText(value); setName(file.name); setStatus('Chat text loaded on this device. Media stays in your export; choose a cover separately in Life Atlas.'); }
    catch (error) { if (selected.isCurrent()) setError(error instanceof Error ? error.message : 'Could not read this export.'); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const prepare = async () => {
    if (!current() || working.current || !latest.current.aiConsent || !name.trim() || !text.trim()) return;
    const selected = scope(); working.current = true; setBusy(true); setError('');
    try {
      const source = curateSourceWindows(text);
      if (!source.text.trim()) throw new Error('No likely highlights found in this long export. Paste a meaningful passage or choose a smaller section.');
      if (!queued.current.length) {
        setStatus(source.partial ? `Reading selected passages from ${source.sourceChars.toLocaleString()} characters; this is a partial review, not a full chat scan…` : 'Looking for up to five memories worth keeping…');
        const token = await selected.step(() => auth.currentUser!.getIdToken());
        const response = await selected.step(() => fetch(`/api/timeline/parse?spaceId=${encodeURIComponent(latest.current.familyId!)}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: source.text, members: members.map(member => ({ id: member.id, name: member.name })), memoryReview: true, document: true, dateOrder }), signal: AbortSignal.timeout(120_000) }));
        const data = await selected.step(() => response.json());
        if (!response.ok || data.spaceId !== latest.current.familyId) throw new Error(data.error || 'The memory response could not be verified for this family.');
        const known = new Set(members.map(member => member.id));
        const suggestions = (Array.isArray(data.rows) ? data.rows : []).map(memoryFromRow).filter((value): value is MemoryProposal => !!value && source.text.replace(/\s+/g, ' ').includes(value.evidenceQuote.replace(/\s+/g, ' '))).slice(0, 5);
        queued.current = suggestions.map(memory => ({ memory: { ...memory, memberIds: memory.memberIds?.filter(id => known.has(id)) }, sourceText: memoryEvidenceContext(source.text, memory.evidenceQuote), requestId: crypto.randomUUID(), done: false }));
      }
      for (const row of queued.current) {
        if (row.done) continue;
        const result = await selected.step(() => api.create({ requestId: row.requestId, sourceName: name.trim(), sourceText: row.sourceText, proposal: { kind: 'memory', memory: row.memory } }));
        row.done = true; onItem(result.item);
      }
      selected.check();
      setStatus(queued.current.length ? `${queued.current.length} memory ${queued.current.length === 1 ? 'suggestion is' : 'suggestions are'} in the inbox below. ${source.partial ? 'Only selected passages were reviewed; the rest of this export was not scanned. ' : ''}Review the words, date and people before adding them. No timeline or Atlas record was saved.` : 'No strong highlights found. Nothing was added; fewer, meaningful memories are better than filling a quota.');
    } catch (error) { if (selected.isCurrent()) setError(error instanceof Error ? error.message : 'Could not prepare these memories.'); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  return <details className="rounded-2xl border border-cream-200 p-4" aria-label="Curated memory import"><summary className="min-h-[44px] cursor-pointer font-semibold text-ink-800">Find memory highlights in a chat or email</summary><div className="mt-3 space-y-3"><p className="text-xs leading-relaxed text-ink-500">Keep milestones, firsts, holidays with a story, affectionate words and memorable experiences. Skip commutes, errands and routine stops. AI uses your existing allowance and prepares at most five suggestions for review.</p>
    <button type="button" disabled={busy} className="btn-quiet min-h-[44px] text-xs" onClick={() => { if (!current()) return; reset(); pending.current = scope(); input.current?.click(); }}>Choose WhatsApp ZIP or TXT export</button>
    <input className="hidden" ref={input} type="file" accept=".txt,.zip" onChange={(event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0], selected = pending.current; event.target.value = ''; pending.current = null; if (file && selected) void read(file, selected); }} />
    <label className="block text-xs text-ink-600">Source name<input className="field mt-1" value={name} maxLength={200} disabled={busy} onChange={event => { reset(); setName(event.target.value); }} placeholder="Maria WhatsApp export, or family email" /></label>
    <label className="block text-xs text-ink-600">Chat or email excerpt<textarea className="field mt-1" rows={6} disabled={busy} value={text} onChange={event => { reset(); setText(event.target.value); }} /></label>
    <label className="block text-xs text-ink-600">Dates in this export<select className="field mt-1" disabled={busy} value={dateOrder} onChange={event => { reset(); setDateOrder(event.target.value); }}><option value="dmy">Day / month / year</option><option value="mdy">Month / day / year</option></select></label>
    <button type="button" className="btn-primary min-h-[44px] text-xs" disabled={busy || !ctx.aiConsent || !name.trim() || !text.trim()} onClick={() => void prepare()}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{queued.current.some(row => !row.done) ? 'Retry remaining suggestions' : 'Prepare up to 5 memory suggestions'}</button>
    {!ctx.aiConsent && <p className="text-xs text-ink-500">Enable AI features in Settings to prepare suggestions.</p>}{status && <p role="status" className="text-xs text-ink-600">{status}</p>}{error && <p role="alert" className="text-xs text-rosa-700">{error} Any drafts already queued were kept.</p>}
    <p className="text-xs text-ink-500">Photos: open Life Atlas → Import photos or Connect Google Photos, choose one cover per memory, then tag who was there. Atlas stories already appear in the family timeline.</p>
  </div></details>;
}
