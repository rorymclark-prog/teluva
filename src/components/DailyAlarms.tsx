import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlarmClock, Check, Copy, RefreshCw, X } from 'lucide-react';
import { auth } from '../lib/firebase';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { appConfirm } from '../utils/appConfirm';
import SheetGrabber from './SheetGrabber';
import {
  AUTOMATION_STEPS, AUTOMATION_TIME, DAILY_LEADS, DAILY_SCOPES, DAILY_SHORTCUT_NAME, DEFAULT_DAILY_LEAD,
  SHORTCUT_STEPS, alarmFeedUrl, describeLastRun, leadLabel, runDailyShortcutUrl, runHealth,
  type AlarmLink, type DailyScope,
} from '../utils/dailyAlarms';

async function api(path: string, init?: RequestInit) {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in again.');
  const idToken = await user.getIdToken();
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}`, ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'That did not work. Please try again.');
  return data;
}

/**
 * "Every morning, automatically" — the set-up-once version of the Alarm button.
 * Server half and the reasoning: server/alarmFeed.mjs and utils/dailyAlarms.ts.
 *
 * This screen is deliberately blunt about what it cannot promise: it is a
 * morning batch, so an appointment moved after the run leaves its old alarm in
 * Clock, and a phone that was off at the run time skips that morning. The
 * "Last ran" line exists so a stopped automation is visible, not trusted.
 */
export default function DailyAlarms({ onClose }: { onClose: () => void }) {
  const [links, setLinks] = useState<AlarmLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lead, setLead] = useState<number>(DEFAULT_DAILY_LEAD);
  const [scope, setScope] = useState<DailyScope>('important');
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useBodyScrollLock(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api('/api/alarm-feed/list');
      setLinks(data.links || []);
      setNow(new Date());
    } catch (e: any) {
      setLinks([]);
      setError(e?.message || 'Could not load your alarm link.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const link = links && links.length > 0 ? links[0] : null;
  const url = link ? alarmFeedUrl(window.location.origin, link.path) : '';
  const health = link ? runHealth(link.lastFetchedAt, now) : 'never';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Could not copy — press and hold the link, then choose Copy.');
    }
  };

  // Replacing a link keeps the choices already made on it; only the very first
  // creation reads the pickers.
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api('/api/alarm-feed/create', {
        method: 'POST',
        body: JSON.stringify({ leadMinutes: link?.leadMinutes ?? lead, scope: link?.scope ?? scope }),
      });
      await load();
      try { await navigator.clipboard.writeText(alarmFeedUrl(window.location.origin, data.path)); setCopied(true); } catch { /* shown below to copy by hand */ }
    } catch (e: any) {
      setError(e?.message || 'Could not create the link.');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (!link) return;
    if (!(await appConfirm('Turn off automatic alarms? The morning Shortcut will show an error until you delete it, and alarms already in Clock stay there.', { danger: true, confirmLabel: 'Turn off' }))) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/alarm-feed/revoke', { method: 'POST', body: JSON.stringify({ token: link.token }) });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not turn it off.');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="anim-fade fixed inset-0 bg-ink-900/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-label="Automatic daily alarms"
        className="anim-pop relative w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-cream-300/70 bg-white p-6 shadow-lift space-y-4"
      >
        <SheetGrabber onClose={onClose} />
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-cream-200">
          <div className="min-w-0">
            <h3 className="text-lg font-display font-semibold text-ink-900">Alarms, every morning</h3>
            <p className="text-[13px] text-ink-500">Set up once. Your iPhone does the rest.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 hover:bg-cream-100 rounded-xl text-ink-400 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {links === null && <p className="text-[13px] text-ink-500">Loading…</p>}

        {links !== null && !link && (
          <div className="space-y-4">
            <p className="text-[13px] text-ink-700 leading-relaxed">
              Each morning your iPhone asks Teluva what is coming in the next 24 hours and sets a real Clock alarm for
              each appointment &mdash; loud through silent mode, ringing until you tap Stop. Nothing to remember to press.
            </p>
            <fieldset className="space-y-1.5">
              <legend className="text-[12px] font-semibold text-ink-500 uppercase tracking-wide mb-1">Ring for</legend>
              {DAILY_SCOPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={scope === s.id}
                  onClick={() => setScope(s.id)}
                  className={`w-full text-left rounded-xl border px-3.5 py-2.5 transition-colors cursor-pointer ${
                    scope === s.id ? 'border-ink-900 bg-ink-900 text-white' : 'border-cream-300 bg-white text-ink-800 hover:bg-cream-50'
                  }`}
                >
                  <span className="block text-[13.5px] font-semibold">{s.label}</span>
                  <span className={`block text-[12px] ${scope === s.id ? 'text-white/70' : 'text-ink-500'}`}>{s.hint}</span>
                </button>
              ))}
            </fieldset>
            <fieldset>
              <legend className="text-[12px] font-semibold text-ink-500 uppercase tracking-wide mb-1">How early</legend>
              <div className="flex flex-wrap gap-1.5">
                {DAILY_LEADS.map((l) => (
                  <button
                    key={l.minutes}
                    type="button"
                    role="radio"
                    aria-checked={lead === l.minutes}
                    onClick={() => setLead(l.minutes)}
                    className={`rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors cursor-pointer ${
                      lead === l.minutes ? 'border-ink-900 bg-ink-900 text-white' : 'border-cream-300 bg-white text-ink-700 hover:bg-cream-50'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <button type="button" onClick={create} disabled={busy} className="btn-primary w-full justify-center">
              <AlarmClock className="w-4 h-4" />
              {busy ? 'Creating…' : 'Create my alarm link'}
            </button>
          </div>
        )}

        {link && (
          <div className="space-y-4">
            <div className={`rounded-xl px-3.5 py-3 text-[13px] leading-snug ${
              health === 'ok' ? 'bg-sage-50 text-sage-700' : health === 'overdue' ? 'bg-clay-50 text-clay-700' : 'bg-cream-100 text-ink-700'
            }`}>
              <p className="font-semibold">
                {health === 'ok' ? 'Running' : health === 'overdue' ? 'Not running — check the automation' : 'Not running yet'}
              </p>
              <p>{describeLastRun(link.lastFetchedAt, link.lastAlarmCount, now)}</p>
              {health === 'overdue' && (
                <p className="mt-1">It has missed at least one morning. Was the phone off at {AUTOMATION_TIME}, or has the Shortcut been deleted? Until it runs, nothing is being set.</p>
              )}
              <p className="mt-1 text-[12px] opacity-80">
                {link.scope === 'all' ? 'Every appointment with a time' : 'Important appointments'} · {leadLabel(link.leadMinutes)}
              </p>
              <button type="button" onClick={() => void load()} className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold underline underline-offset-2 cursor-pointer">
                <RefreshCw className="w-3 h-3" /> Check again
              </button>
            </div>

            <div className="space-y-2">
              <button type="button" onClick={copy} className="btn-quiet w-full justify-center">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Link copied' : 'Copy my alarm link'}
              </button>
              <p className="text-[11.5px] text-ink-400 leading-snug break-all">{url}</p>
              <p className="text-[11.5px] text-ink-500 leading-snug">
                Keep this link private &mdash; anyone with it can see the times of your appointments (never their names).
                Turn it off below if it ever gets shared.
              </p>
            </div>

            <section className="space-y-1.5">
              <h4 className="text-[13px] font-semibold text-ink-900">1. Make the Shortcut (about 3 minutes, once)</h4>
              <ol className="list-decimal pl-5 space-y-1.5 text-[13px] text-ink-700 leading-snug">
                {SHORTCUT_STEPS.map((s) => <li key={s}>{s}</li>)}
              </ol>
            </section>

            <section className="space-y-1.5">
              <h4 className="text-[13px] font-semibold text-ink-900">2. Make it run itself</h4>
              <ol className="list-decimal pl-5 space-y-1.5 text-[13px] text-ink-700 leading-snug">
                {AUTOMATION_STEPS.map((s) => <li key={s}>{s}</li>)}
              </ol>
            </section>

            <section className="space-y-2">
              <h4 className="text-[13px] font-semibold text-ink-900">3. Test it once</h4>
              <a href={runDailyShortcutUrl()} className="btn-quiet w-full justify-center">
                <AlarmClock className="w-4 h-4" />
                Run {DAILY_SHORTCUT_NAME} now
              </a>
              <p className="text-[12.5px] text-ink-600 leading-snug">
                Then come back and tap <b>Check again</b>: it should say it ran just now. If you have an appointment in the
                next 24 hours, open the <b>Clock</b> app &rarr; <b>Alarm</b> to see its alarm.
              </p>
            </section>

            <div className="rounded-xl bg-cream-100 px-3.5 py-3 text-[12.5px] text-ink-700 leading-snug space-y-1">
              <p className="font-semibold">Good to know</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>It runs once, at {AUTOMATION_TIME}. If the phone is off then, that morning is skipped.</li>
                <li>Move or cancel an appointment after the morning run and its alarm stays in Clock &mdash; delete it there.</li>
                <li>Running it again the same day sets each alarm twice.</li>
                <li>Alarms show &ldquo;{`Teluva appointment`}&rdquo;, not the name &mdash; open Teluva to see which one.</li>
                <li>Used alarms stay in the Clock list, switched off. Swipe to delete them now and then.</li>
              </ul>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <button type="button" onClick={create} disabled={busy} className="text-[12px] underline underline-offset-2 text-ink-500 hover:text-ink-700 cursor-pointer">
                Make a new link (turns this one off)
              </button>
              <button type="button" onClick={turnOff} disabled={busy} className="text-[12px] underline underline-offset-2 text-clay-700 hover:text-clay-800 cursor-pointer">
                Turn off
              </button>
            </div>
          </div>
        )}

        {error && <p role="alert" className="text-[12.5px] text-clay-700 leading-snug">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
