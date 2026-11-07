import { useEffect, useRef, useState } from 'react';
import { auth } from '../lib/firebase';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { FAMILY_ID } from '../utils/db';
import { readPlainTextPreview } from '../utils/documentPreview';

export default function TextDocumentPreview({ source, name, size, version }: { source: string; name: string; size: number; version?: string }) {
  const ctx = useFamilyCtx(), latest = useRef(ctx); latest.current = ctx;
  const [attempt, setAttempt] = useState(0);
  const key = `${ctx.uid}:${ctx.familyId}:${ctx.role}:${ctx.loading}:${source}:${version}:${size}:${attempt}`;
  const [state, setState] = useState<{ key: string; text?: string; error?: string }>({ key: '' });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState({ key });
    void readPlainTextPreview(source, {
      getUser: () => !latest.current.loading && latest.current.uid === auth.currentUser?.uid ? auth.currentUser : null,
      getSpace: () => latest.current.familyId === FAMILY_ID ? FAMILY_ID : null,
      knownSize: size, signal: controller.signal,
    }).then(text => { if (active) setState({ key, text }); })
      .catch(error => { if (active) setState({ key, error: error instanceof Error ? error.message : 'Could not open the text preview. Download the original to view it.' }); });
    return () => { active = false; controller.abort(); };
  }, [key]);
  const current = state.key === key;
  return <div className="h-full w-full min-w-0 overflow-auto p-4" aria-label={`${name}, plain text preview`}>
    {current && state.error ? <div className="space-y-3 text-sm text-ink-600" role="status"><p>{state.error}</p><button type="button" className="btn-quiet" onClick={() => setAttempt(value => value + 1)}>Try preview again</button></div>
      : current && state.text !== undefined ? <pre className="whitespace-pre-wrap [overflow-wrap:anywhere] text-xs leading-relaxed text-ink-800 font-mono">{state.text || 'This text file is empty.'}</pre>
        : <p className="text-sm text-ink-600" role="status">Loading text preview…</p>}
  </div>;
}
