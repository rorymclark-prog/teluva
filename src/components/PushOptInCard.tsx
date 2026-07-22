import React, { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2, Check } from 'lucide-react';
import { isPushEligible, isSubscribed, enablePush, disablePush } from '../utils/pushClient';

// Self-contained "birthday reminders on this phone" opt-in card. Kept in its
// own file (rather than inlined into FamilySettings) so the push feature adds
// exactly one import + one mount to the shared settings component and can't
// disturb anything else there.
//
// Push on iOS ONLY works when the app is installed to the Home Screen, so when
// the device isn't eligible we show a short helper line instead of a button the
// user could tap to no effect.
export default function PushOptInCard() {
  const [eligible] = useState<boolean>(() => isPushEligible());
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    isSubscribed()
      .then((v) => { if (alive) setSubscribed(v); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, []);

  async function handleEnable() {
    setBusy(true);
    setError(null);
    try {
      await enablePush();
      setSubscribed(true);
    } catch (e: any) {
      setError(e?.message || 'Could not turn on reminders.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    setError(null);
    try {
      await disablePush();
      setSubscribed(false);
    } catch (e: any) {
      setError(e?.message || 'Could not turn off reminders.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 space-y-3">
      <h3 className="section-label flex items-center gap-2">
        <Bell size={14} />
        Birthday reminders
      </h3>

      {!eligible ? (
        <p className="text-[13px] text-ink-500 leading-relaxed">
          To get a gentle nudge on family birthdays and anniversaries, add Tresa to your
          Home Screen first (Share → Add to Home Screen), then open it from there and come
          back here.
        </p>
      ) : (
        <>
          <p className="text-[13px] text-ink-500 leading-relaxed">
            Get a notification on this phone when it's a family birthday or a business
            anniversary. Nothing else is sent — and it only ever mentions people who are
            here with you.
          </p>

          {error && (
            <p className="text-xs text-rosa-700 bg-rosa-50 rounded-xl px-3 py-2">{error}</p>
          )}

          {checking ? (
            <div className="flex items-center gap-2 text-ink-400 text-[13px] py-1">
              <Loader2 size={15} className="animate-spin" />
              Checking…
            </div>
          ) : subscribed ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sage-700 text-[13px] font-medium">
                <Check size={15} className="text-sage-500" />
                Reminders are on for this phone.
              </div>
              <button
                onClick={handleDisable}
                disabled={busy}
                className="btn-quiet w-full justify-center gap-2 disabled:opacity-40"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <BellOff size={15} />}
                Turn off on this phone
              </button>
            </div>
          ) : (
            <button
              onClick={handleEnable}
              disabled={busy}
              className="btn-primary w-full justify-center gap-2 disabled:opacity-40"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Bell size={15} />}
              Get birthday reminders on this phone
            </button>
          )}
        </>
      )}
    </div>
  );
}
