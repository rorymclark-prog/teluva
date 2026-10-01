import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlarmClock, Check, X } from 'lucide-react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { isAppleTouch } from '../utils/platform';
import DailyAlarms from './DailyAlarms';
import SheetGrabber from './SheetGrabber';
import {
  ALARM_LEADS, ALARM_SHORTCUT_NAME, alarmAvailability, alarmSetupDone, describeAlarmTime,
  rememberLead, rememberedLead, setAlarmSetupDone, shortcutUrl, testAlarmTime, type AlarmLead,
} from '../utils/appointmentAlarm';

interface Props {
  event: { title: string; date: string; time?: string };
  /** Local YYYY-MM-DD for "today"; events before it get no button at all. */
  today: string;
  className?: string;
}

/**
 * "Set alarm" — hands an appointment to the iPhone Clock app as a real alarm
 * (loud through silent mode, rings until Stop is tapped). All the reasoning,
 * including why it only reaches 24 hours ahead, is in utils/appointmentAlarm.ts.
 *
 * Shown only on iPhone/iPad: the mechanism is Apple's Shortcuts app, and a
 * button that does nothing on a desktop is worse than no button. It is also
 * shown to everyone who can SEE the appointment, read-only viewers included —
 * an alarm is a fact about one phone, not an edit to the family's calendar.
 */
export default function AppointmentAlarm({ event, today, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [setupDone, setSetupDone] = useState(() => alarmSetupDone());
  const [lead, setLead] = useState<AlarmLead>(() => rememberedLead());
  const [sent, setSent] = useState(false);
  const [testSent, setTestSent] = useState(false);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    setSent(false);
    setTestSent(false);
    setSetupDone(alarmSetupDone());
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const rows = useMemo(
    () => ALARM_LEADS.map((l) => ({ lead: l, avail: alarmAvailability(event, l, now) })),
    [event, now],
  );

  // Keep the selection on something that can actually be set; fall back to the
  // first option that can, so the primary button is never armed on a dead row.
  const selected = rows.find((r) => r.lead.id === lead.id && r.avail.status === 'ok')
    ?? rows.find((r) => r.avail.status === 'ok');

  if (!isAppleTouch() || !event.date || event.date < today) return null;

  const test = testAlarmTime(now);

  // The manual button only helps for the appointment somebody remembered to
  // press it for; the one that gets overlooked needs this instead.
  const autoLink = (
    <button
      type="button"
      onClick={() => { setOpen(false); setAutoOpen(true); }}
      className="w-full rounded-xl border border-cream-300 px-3.5 py-2.5 text-left text-[13px] text-ink-800 hover:bg-cream-50 cursor-pointer"
    >
      <span className="block font-semibold">Set alarms automatically, every morning</span>
      <span className="block text-[12px] text-ink-500">Set up once — no button to remember to press.</span>
    </button>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-ink-600 hover:bg-cream-100 transition-colors cursor-pointer ${className}`}
        title="Set a loud iPhone alarm for this appointment"
      >
        <AlarmClock className="w-3.5 h-3.5" aria-hidden="true" />
        Alarm
      </button>

      {autoOpen && <DailyAlarms onClose={() => setAutoOpen(false)} />}

      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="anim-fade fixed inset-0 bg-ink-900/60 backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label={`Set an alarm for ${event.title}`}
            className="anim-pop relative w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-cream-300/70 bg-white p-6 shadow-lift space-y-4"
          >
            <SheetGrabber onClose={() => setOpen(false)} />
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-cream-200">
              <div className="min-w-0">
                <h3 className="text-lg font-display font-semibold text-ink-900">Set an alarm</h3>
                <p className="text-[13px] text-ink-500 truncate">
                  {event.title}{event.time ? ` · ${event.time}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="p-1 hover:bg-cream-100 rounded-xl text-ink-400 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            {!setupDone ? (
              <div className="space-y-3">
                <p className="text-[13px] text-ink-700 leading-relaxed">
                  This makes a real alarm in your iPhone&rsquo;s Clock app &mdash; it rings through silent mode and keeps
                  going until you tap Stop. It needs one small Shortcut, made once (about a minute):
                </p>
                <ol className="list-decimal pl-5 space-y-1.5 text-[13px] text-ink-700 leading-snug">
                  <li>Open the <b>Shortcuts</b> app, tap <b>+</b>, and name it exactly <b>{ALARM_SHORTCUT_NAME}</b>.</li>
                  <li>Add the action <b>Get Dates from Input</b> (search &ldquo;dates&rdquo;). Leave its input as <b>Shortcut Input</b>.</li>
                  <li>Add the action <b>Create Alarm</b>. Tap its time and choose <b>Dates</b>. Turn <b>Repeat</b> off.</li>
                  <li>Tap <b>Done</b>.</li>
                </ol>
                <a
                  href={shortcutUrl(test)}
                  onClick={() => setTestSent(true)}
                  className="btn-quiet w-full justify-center"
                >
                  <AlarmClock className="w-4 h-4" />
                  Send a test alarm for {describeAlarmTime(test, now)}
                </a>
                {testSent && (
                  <p className="text-[12.5px] text-ink-600 leading-snug">
                    If Shortcuts asked to allow something, tap <b>Allow</b>. Then open the <b>Clock</b> app &rarr; <b>Alarm</b>:
                    there should be one at {describeAlarmTime(test, now)}. Delete it once you&rsquo;ve seen it.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => { setAlarmSetupDone(true); setSetupDone(true); }}
                  className="btn-primary w-full justify-center"
                >
                  <Check className="w-4 h-4" />
                  It worked &mdash; I saw the alarm
                </button>
                {autoLink}
              </div>
            ) : (
              <div className="space-y-3">
                <div role="radiogroup" aria-label="When should it ring?" className="space-y-1.5">
                  {rows.map(({ lead: l, avail }) => {
                    const ok = avail.status === 'ok';
                    const on = selected?.lead.id === l.id;
                    return (
                      <button
                        key={l.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={!ok}
                        onClick={() => setLead(l)}
                        className={`w-full flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left text-[13.5px] transition-colors ${
                          on ? 'border-ink-900 bg-ink-900 text-white'
                            : ok ? 'border-cream-300 bg-white text-ink-800 hover:bg-cream-50 cursor-pointer'
                            : 'border-cream-200 bg-cream-50 text-ink-400 cursor-not-allowed'
                        }`}
                      >
                        <span className="font-semibold">{l.label}</span>
                        <span className="text-[12px] tabular-nums shrink-0">
                          {avail.status === 'ok' && describeAlarmTime(avail.at, now)}
                          {avail.status === 'past' && 'already passed'}
                          {avail.status === 'too-far' && `from ${describeAlarmTime(avail.opensAt, now)}`}
                          {avail.status === 'no-time' && 'needs a time'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {selected ? (
                  <a
                    href={shortcutUrl((selected.avail as { at: Date }).at)}
                    onClick={() => { rememberLead(selected.lead); setSent(true); }}
                    className="btn-primary w-full justify-center"
                  >
                    <AlarmClock className="w-4 h-4" />
                    Set alarm for {describeAlarmTime((selected.avail as { at: Date }).at, now)}
                  </a>
                ) : (
                  <p className="rounded-xl bg-cream-100 px-3.5 py-3 text-[13px] text-ink-700 leading-snug">
                    {rows.some((r) => r.avail.status === 'too-far')
                      ? 'An iPhone alarm can only be set up to 24 hours ahead, so this one isn’t available yet. Come back to this appointment then — the times above say when each option opens.'
                      : 'Every alarm time for this appointment has already passed.'}
                  </p>
                )}

                {sent && (
                  <p className="text-[12.5px] text-sage-700 leading-snug">
                    Sent to Clock. Open the <b>Clock</b> app &rarr; <b>Alarm</b> to check it is there. If it isn&rsquo;t,
                    the Shortcut may need setting up again.
                  </p>
                )}

                {autoLink}

                <p className="text-[11.5px] text-ink-400 leading-snug">
                  Alarms are per phone &mdash; nobody else&rsquo;s is affected.{' '}
                  <button
                    type="button"
                    onClick={() => { setAlarmSetupDone(false); setSetupDone(false); }}
                    className="underline underline-offset-2 hover:text-ink-700 cursor-pointer"
                  >
                    Set up the Shortcut again
                  </button>
                </p>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
