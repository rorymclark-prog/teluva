import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDocFromServer } from 'firebase/firestore';
import { Check, FileText, Loader2, LockKeyhole, ShieldCheck, X } from 'lucide-react';
import type { VaultDocument } from '../types';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { auth, db } from '../lib/firebase';
import { FAMILY_ID } from '../utils/db';
import { fileContentUrl, filePathFromReference, isFamilyFilePath } from '../utils/fileReferences';
import { createImportInboxClient, importErrorMessage, validatedConnectorRedirect, type ConnectorRequest } from '../utils/importInboxClient';
import { ServiceDocChips } from './ServiceDocs';

interface Props { requestId: string; onClose: () => void }
export default function ConnectorAuthorization(props: Props) {
  const { uid, familyId, role } = useFamilyCtx();
  return <div key={`${uid}:${familyId}:${role}:${props.requestId}`}><AuthorizationBody {...props} /></div>;
}
function AuthorizationBody({ requestId, onClose }: Props) {
  const ctx = useFamilyCtx(), latest = useRef(ctx); latest.current = ctx;
  const adultSpaces = ctx.spaces.map(space => space.id === ctx.familyId ? { ...space, role: ctx.role } : space).filter(space => space.role === 'admin' || space.role === 'member');
  const initialSpace = adultSpaces.find(space => space.id === ctx.familyId)?.id || adultSpaces[0]?.id || '';
  const [spaceId, setSpaceId] = useState(initialSpace), spaceRef = useRef(initialSpace);
  const mounted = useRef(true), generation = useRef(0), working = useRef(false);
  const identity = () => `${mounted.current}:${generation.current}:${latest.current.familyId}:${FAMILY_ID}:${latest.current.role}:${latest.current.loading}`;
  const api = useMemo(() => createImportInboxClient({ getUser: () => auth.currentUser, getSpace: () => spaceRef.current, getGeneration: identity }), []);
  const [request, setRequest] = useState<ConnectorRequest | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [scopes, setScopes] = useState<string[]>([]), [documentIds, setDocumentIds] = useState<string[]>([]), [docs, setDocs] = useState<VaultDocument[]>([]), [docState, setDocState] = useState<'loading' | 'ready' | 'failed'>('ready'), [docRetry, setDocRetry] = useState(0), [query, setQuery] = useState(''), [now, setNow] = useState(Date.now());
  const selected = adultSpaces.find(space => space.id === spaceId);
  const readAllowed = !!selected && (selected.type !== 'business' || selected.role === 'admin');
  const wantsRead = scopes.includes('documents:read');
  useEffect(() => { mounted.current = true; const timer = window.setInterval(() => setNow(Date.now()), 15000); return () => { mounted.current = false; generation.current++; window.clearInterval(timer); }; }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    api.authorization(requestId).then(value => {
      if (!active || !mounted.current) return;
      if (value.id !== requestId || !Array.isArray(value.scopes) || !Number.isFinite(value.expiresAt)) throw new Error('This authorization request could not be verified.');
      setRequest(value); setScopes(value.scopes.filter(scope => scope === 'inbox:write' || (scope === 'documents:read' && readAllowed)));
    }).catch(err => { if (active && mounted.current) setError(importErrorMessage(err)); }).finally(() => { if (active && mounted.current) setLoading(false); });
    return () => { active = false; };
  }, [requestId]);
  useEffect(() => {
    let active = true;
    setDocs([]); setDocState('ready');
    if (!spaceId || !wantsRead || !readAllowed || !ctx.uid || ctx.loading || auth.currentUser?.uid !== ctx.uid) return () => { active = false; };
    const uid = auth.currentUser?.uid, selectedId = spaceId, mine = generation.current;
    const current = () => active && mounted.current && auth.currentUser?.uid === uid && latest.current.uid === uid && spaceRef.current === selectedId && generation.current === mine;
    setDocState('loading');
    getDocFromServer(doc(db, 'families', selectedId, 'reference', 'documents')).then(snapshot => {
      if (!current()) return;
      const raw = snapshot.exists() ? snapshot.data().docs : [];
      const safe = Array.isArray(raw) ? raw.flatMap((value: VaultDocument) => {
        if (!value || typeof value.id !== 'string' || typeof value.name !== 'string') return [];
        const path = isFamilyFilePath(value.storagePath) ? value.storagePath : filePathFromReference(value.downloadUrl);
        return path?.startsWith(`families/${selectedId}/`) ? [{ ...value, downloadUrl: fileContentUrl(path) }] : [];
      }) : [];
      setDocs(safe); setDocState('ready');
    }).catch(() => { if (current()) setDocState('failed'); });
    return () => { active = false; };
  }, [spaceId, wantsRead, readAllowed, ctx.uid, ctx.loading, docRetry]);
  const chooseSpace = (value: string) => {
    if (working.current) return;
    generation.current++; spaceRef.current = value; setSpaceId(value); setDocumentIds([]); setDocs([]); setQuery(''); setError('');
    const next = adultSpaces.find(space => space.id === value);
    if (next?.type === 'business' && next.role !== 'admin') setScopes(old => old.filter(scope => scope !== 'documents:read'));
  };
  const toggleScope = (scope: string, enabled: boolean) => {
    if (working.current || (scope === 'documents:read' && !readAllowed)) return;
    setScopes(old => enabled ? [...new Set([...old, scope])] : old.filter(value => value !== scope));
    if (scope === 'documents:read') setDocumentIds([]);
  };
  const expired = !!request && request.expiresAt <= now;
  const decide = async (approve: boolean) => {
    if (working.current || !request || (approve && (ctx.loading || auth.currentUser?.uid !== ctx.uid || expired || !selected || !scopes.length || (wantsRead && (!readAllowed || docState !== 'ready' || !documentIds.length))))) return;
    working.current = true; setBusy(true); setError('');
    try {
      const response = await api.decide(requestId, approve ? { approve: true, spaceId, scopes, documentIds: wantsRead ? documentIds : [] } : { approve: false });
      const redirect = validatedConnectorRedirect(response.redirectUrl, request.redirectHost);
      if (mounted.current) window.location.assign(redirect);
    } catch (err) { if (mounted.current) { setError(importErrorMessage(err)); setBusy(false); } }
    finally { working.current = false; }
  };
  const candidates = docs.filter(document => !query.trim() || `${document.name} ${document.fileName || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="fixed inset-0 z-[100] overflow-y-auto bg-cream-100 px-3 py-6 sm:py-12" role="dialog" aria-modal="true" aria-labelledby="connector-consent-title">
    <section className="mx-auto max-w-xl overflow-hidden rounded-3xl border border-cream-300 bg-white shadow-xl">
      <header className="flex items-start gap-3 border-b border-cream-200 p-5"><span className="rounded-2xl bg-clay-50 p-3 text-clay-700"><LockKeyhole className="h-6 w-6" /></span><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-widest text-clay-600">Teluva connection</p><h1 id="connector-consent-title" className="mt-1 text-xl font-semibold text-ink-900">Choose what to share</h1></div><button type="button" className="min-h-[44px] min-w-[44px] text-ink-400 disabled:opacity-40" aria-label="Close connector authorization" disabled={busy} onClick={onClose}><X className="mx-auto h-5 w-5" /></button></header>
      <div className="space-y-5 p-5">
        {loading ? <p role="status" className="flex items-center gap-2 text-sm text-ink-500"><Loader2 className="h-4 w-4 animate-spin" />Loading connection request…</p> : request && <>
          <div><h2 className="break-words text-base font-semibold text-ink-900">{request.clientName || 'A custom connector'}</h2><p className="mt-1 text-xs leading-relaxed text-ink-500">This name is supplied by the connecting app. Check that you started this request in your chatbot.{request.redirectHost ? ` You will return to ${request.redirectHost}.` : ''}</p></div>
          {expired ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">This request expired. Return to your chatbot and start the connection again.</p> : <p className="text-[11px] text-ink-400">This request expires at {new Date(request.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>}
          <label className="block text-xs font-semibold text-ink-700">Share from one space<select value={spaceId} disabled={busy || expired || ctx.loading} onChange={event => chooseSpace(event.target.value)} className="field mt-2 w-full"><option value="">Choose a space</option>{adultSpaces.map(space => <option key={space.id} value={space.id}>{space.name || (space.type === 'business' ? 'Business space' : 'Family space')}{space.id === ctx.familyId ? ' (current)' : ''}</option>)}</select></label>
          {!adultSpaces.length && <p className="text-xs text-ink-500">An adult space membership is needed to authorize a connection.</p>}
          <fieldset disabled={busy || expired || !selected} className="space-y-3"><legend className="mb-2 text-xs font-semibold text-ink-700">Permissions requested</legend>{request.scopes.includes('documents:read') && <label className="flex min-h-[44px] items-start gap-3 rounded-xl border border-cream-200 p-3 text-xs leading-relaxed text-ink-600"><input type="checkbox" className="mt-0.5 accent-clay-600" checked={wantsRead} disabled={!readAllowed} onChange={event => toggleScope('documents:read', event.target.checked)} /><span><span className="block font-semibold text-ink-800">Read selected documents</span>The chatbot can search and read only the files you check below.{!readAllowed && selected?.type === 'business' ? ' Only a business administrator can grant document access.' : ''}</span></label>}{request.scopes.includes('inbox:write') && <label className="flex min-h-[44px] items-start gap-3 rounded-xl border border-cream-200 p-3 text-xs leading-relaxed text-ink-600"><input type="checkbox" className="mt-0.5 accent-clay-600" checked={scopes.includes('inbox:write')} onChange={event => toggleScope('inbox:write', event.target.checked)} /><span><span className="block font-semibold text-ink-800">Prepare import drafts</span>The chatbot can send proposed records to your import inbox. An administrator must review and add the records in Teluva.</span></label>}</fieldset>
          {wantsRead && readAllowed && <div className="space-y-3"><h3 className="text-xs font-semibold text-ink-700">Choose specific originals (up to 50)</h3><p className="text-[11px] leading-relaxed text-ink-400">Selected document contents leave Teluva when the chatbot reads them. Your other files and private profile details are not included.</p>{docState === 'loading' ? <p role="status" className="text-xs text-ink-400">Loading accessible documents…</p> : docState === 'failed' ? <div role="alert" className="text-xs text-rosa-700">Documents could not be verified. <button type="button" className="min-h-[44px] underline" onClick={() => setDocRetry(old => old + 1)}>Retry</button></div> : <><input type="search" className="field w-full text-xs" placeholder="Search documents" aria-label="Search documents for connector access" value={query} disabled={busy} onChange={event => setQuery(event.target.value)} /><div className="max-h-64 overflow-y-auto rounded-xl border border-cream-200">{candidates.length ? candidates.map(document => <label key={document.id} className="flex min-h-[48px] items-center gap-3 border-b border-cream-100 p-3 text-xs last:border-b-0"><input type="checkbox" className="shrink-0 accent-clay-600" checked={documentIds.includes(document.id)} disabled={busy || expired || (documentIds.length >= 50 && !documentIds.includes(document.id))} onChange={event => setDocumentIds(old => event.target.checked ? old.length < 50 ? [...new Set([...old, document.id])] : old : old.filter(id => id !== document.id))} /><FileText className="h-4 w-4 shrink-0 text-ink-300" /><span className="min-w-0 break-words text-ink-700">{document.name}</span></label>) : <p className="p-3 text-xs text-ink-400">No accessible documents match. You can approve inbox drafts alone, or add an original to the Vault first.</p>}</div><p className="text-xs text-ink-500">{documentIds.length} documents selected · new uploads will not be added automatically</p><ServiceDocChips ids={documentIds} docs={docs} ownerLabel={selected?.type === 'business' ? 'the team' : 'the family'} /></>}</div>}
          <div className="flex items-start gap-2 rounded-xl bg-sage-50 p-3 text-xs leading-relaxed text-sage-800"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><p>You can revoke this connection in Settings. Information already shared remains subject to the chatbot provider’s policies. No access to another space is granted.</p></div>
        </>}
        {error && <p role="alert" className="break-words text-xs text-rosa-700">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-cream-200 pt-4"><button type="button" className="btn-quiet min-h-[44px] text-xs disabled:opacity-40" disabled={busy} onClick={() => request ? void decide(false) : onClose()}>Deny</button><button type="button" className="btn-primary min-h-[44px] text-xs disabled:opacity-40" disabled={busy || loading || ctx.loading || expired || !request || !selected || !scopes.length || (wantsRead && (docState !== 'ready' || !documentIds.length))} onClick={() => void decide(true)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Approve selected access</button></div>
      </div>
    </section>
  </div>;
}
