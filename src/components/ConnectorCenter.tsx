import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Link2, Loader2, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { auth } from '../lib/firebase';
import { FAMILY_ID } from '../utils/db';
import { createImportInboxClient, importErrorMessage, MCP_URL, type ConnectorGrant } from '../utils/importInboxClient';

export const connectorSetup = {
  chatgpt: `Add Teluva as a custom MCP server in ChatGPT. Open Plugins, choose Add custom MCP server, name it Teluva, and use ${MCP_URL}. Use OAuth authentication. Sign in to Teluva, select a space and permissions, then approve. Enable the resulting plugin in your conversation. Account and workspace policies may control custom server availability.`,
  claude: `Add Teluva as a custom connector in Claude. Open Customize / Settings → Connectors → Add custom connector. Name it Teluva and use ${MCP_URL}. Use OAuth authentication with automatic client registration. Connect, sign in to Teluva, select a space and permissions, then approve. Organization owners may need to add the connector first.`,
};
export default function ConnectorCenter() {
  const { uid, familyId, role } = useFamilyCtx();
  return <div key={`${uid}:${familyId}:${role}`}><ConnectorCenterBody /></div>;
}
function ConnectorCenterBody() {
  const ctx = useFamilyCtx(), latest = useRef(ctx); latest.current = ctx;
  const mounted = useRef(true), busyRef = useRef<string | null>(null);
  const current = () => mounted.current && auth.currentUser?.uid === latest.current.uid && FAMILY_ID === latest.current.familyId;
  const api = useMemo(() => createImportInboxClient({ getUser: () => auth.currentUser, getSpace: () => current() ? latest.current.familyId : null, getGeneration: () => `${mounted.current}:${latest.current.role}` }), []);
  const [connections, setConnections] = useState<ConnectorGrant[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState(''), [copied, setCopied] = useState('');
  const allowed = !ctx.loading && !!ctx.uid && !!ctx.familyId && (ctx.role === 'admin' || ctx.role === 'member');
  const business = ctx.spaces.find(space => space.id === ctx.familyId)?.type === 'business';
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const reload = async () => {
    if (!allowed || !current()) return;
    setLoading(true); setError('');
    try { const data = await api.connections(); if (current()) setConnections(data.connectors); }
    catch (err) { if (current()) setError(importErrorMessage(err)); }
    finally { if (current()) setLoading(false); }
  };
  useEffect(() => { if (allowed) void reload(); else setLoading(false); }, [allowed]);
  const copy = async (value: string, label: string) => { try { await navigator.clipboard.writeText(value); if (mounted.current) setCopied(label); } catch { if (mounted.current) setError('Copy is unavailable. Select and copy the server URL below.'); } };
  const revoke = async (id: string) => {
    if (!allowed || !current() || busyRef.current) return;
    busyRef.current = id; setBusy(id); setError('');
    try { await api.revoke(id); if (current()) setConnections(old => old.filter(connection => connection.id !== id)); }
    catch (err) { if (current()) setError(importErrorMessage(err)); }
    finally { busyRef.current = null; if (current()) setBusy(null); }
  };
  return <section className="space-y-5" aria-label="ChatGPT and Claude connections">
    <div className="flex items-start gap-3"><span className="rounded-xl bg-clay-50 p-2.5 text-clay-700"><Link2 className="h-5 w-5" /></span><div><h2 className="text-base font-semibold text-ink-900">Connect your AI assistant</h2><p className="mt-1 text-[13px] leading-relaxed text-ink-500">Let ChatGPT or Claude read selected originals and prepare drafts in your {business ? 'business' : 'family'} import inbox.</p></div></div>
    <div className="rounded-2xl border border-cream-300 bg-cream-50 p-4 space-y-3"><label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-400">Teluva MCP server<input type="url" readOnly value={MCP_URL} aria-label="Teluva MCP server URL" className="field mt-2 w-full min-w-0 bg-white text-xs" onFocus={event => event.target.select()} /></label><button type="button" className="btn-quiet min-h-[44px] text-xs" onClick={() => void copy(MCP_URL, 'Server URL copied')}>{copied === 'Server URL copied' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}Copy server URL</button></div>
    <div className="grid gap-3 sm:grid-cols-2">{(['chatgpt', 'claude'] as const).map(provider => <details key={provider} className="rounded-2xl border border-cream-300 bg-white"><summary className="cursor-pointer p-4 text-sm font-semibold text-ink-900">Set up {provider === 'chatgpt' ? 'ChatGPT' : 'Claude'}</summary><div className="space-y-3 border-t border-cream-200 p-4"><p className="text-xs leading-relaxed text-ink-600">{connectorSetup[provider]}</p><button type="button" className="btn-quiet min-h-[44px] text-xs" onClick={() => void copy(connectorSetup[provider], `${provider} instructions copied`)}><Copy className="h-3.5 w-3.5" />Copy instructions</button><a className="flex min-h-[44px] items-center gap-1.5 text-xs text-clay-700 underline" target="_blank" rel="noopener noreferrer" href={provider === 'chatgpt' ? 'https://developers.openai.com/apps-sdk/deploy/connect-chatgpt' : 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp'}>Official setup guide<ExternalLink className="h-3 w-3" /></a></div></details>)}</div>
    <div className="flex items-start gap-2 rounded-xl bg-sage-50 p-3 text-xs leading-relaxed text-sage-800"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><p>Sign in through Teluva to choose one space, permissions and specific documents. No API key or pasted token is needed. Drafts require review in Teluva before an administrator adds a record. Provider account and workspace policies apply to custom connectors.</p></div>
    {business && !ctx.isAdmin && <p className="text-xs text-ink-500">Employees can prepare inbox drafts. Only a business administrator can authorize a connector to read business documents.</p>}
    <div className="border-t border-cream-200 pt-4"><div className="mb-3 flex items-center gap-2"><h3 className="mr-auto text-sm font-semibold text-ink-900">Your connections in this space</h3><button type="button" disabled={loading || !allowed} className="btn-quiet min-h-[44px] text-xs disabled:opacity-40" onClick={() => void reload()}><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button></div>
      {error && <p role="alert" className="mb-3 text-xs text-rosa-700">{error}</p>}{copied && <p role="status" className="mb-3 text-xs text-sage-700">{copied.includes('instructions') ? 'Setup instructions copied.' : copied}</p>}
      {!allowed ? <p className="text-xs text-ink-400">Sign in with an adult account to manage your connections.</p> : loading && !connections.length ? <p role="status" className="text-xs text-ink-400">Loading connections…</p> : !connections.length ? <p className="text-xs text-ink-400">No active connections in this space. Start in your chatbot using the setup steps above.</p> : <ul className="space-y-2">{connections.map(connection => <li key={connection.id} className="rounded-xl border border-cream-200 p-3"><div className="flex flex-wrap items-start gap-2"><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold text-ink-800">{connection.clientName || 'Custom connector'}</p><p className="mt-1 text-[11px] leading-relaxed text-ink-400">Name supplied by the connecting app · {connection.documentIds?.length || 0} selected documents</p></div><button type="button" disabled={!!busy} onClick={() => void revoke(connection.id)} className="btn-quiet min-h-[44px] text-xs disabled:opacity-40">{busy === connection.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}Revoke</button></div><p className="mt-2 text-xs text-ink-500">{connection.scopes?.map(scope => scope === 'documents:read' ? 'Read selected documents' : scope === 'inbox:write' ? 'Prepare inbox drafts' : 'Additional permission').join(' · ')}</p></li>)}</ul>}
      <p className="mt-3 text-[11px] leading-relaxed text-ink-400">Revoking stops future access through that connection. Information already shared with a chatbot stays subject to that provider’s controls.</p>
    </div>
  </section>;
}
