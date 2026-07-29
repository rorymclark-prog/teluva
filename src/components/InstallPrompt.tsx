import { useEffect, useState } from 'react';
import { Share, Plus, X, Download, Bell } from 'lucide-react';
import {
  detectPlatform, shouldPrompt, recordDecline, recordInstalled,
  type InstallPlatform,
} from '../utils/installPrompt';

// A quiet, dismissible "put this on your Home Screen" card.
//
// It exists because of a hard platform fact: on iPhone, a web app only receives
// push notifications once it's been added to the Home Screen. A family that
// never installs it never gets a birthday reminder or a passport-expiry warning
// — so the install is not cosmetic, it's the difference between an app that
// speaks up and a filing cabinet you have to remember to open.
//
// All the "don't be annoying" rules live in utils/installPrompt.ts (asks only
// once there's something in the vault, backs off after each decline, gives up
// after three). This component is just the face of them.
export default function InstallPrompt({ hasContent }: { hasContent: boolean }) {
  // Chrome/Android hand us an event we can replay as a real one-tap install.
  // Safari never does, which is why the iOS path is instructions instead.
  const [deferred, setDeferred] = useState<any>(null);
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<InstallPlatform>('unsupported');

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // stop Chrome's own mini-infobar; we choose the moment
      setDeferred(e);
    };
    const onInstalled = () => { recordInstalled(); setVisible(false); };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    const p = detectPlatform(!!deferred);
    setPlatform(p);
    // Give the app a moment to settle before appearing — arriving in the same
    // frame as the dashboard reads as a popup, which is what people dismiss.
    const t = setTimeout(() => setVisible(shouldPrompt({ platform: p, hasContent })), 2500);
    return () => clearTimeout(t);
  }, [deferred, hasContent]);

  if (!visible) return null;

  const dismiss = () => { recordDecline(); setVisible(false); };

  const install = async () => {
    if (!deferred) return;
    try {
      deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice?.outcome === 'accepted') recordInstalled();
      else recordDecline();
    } catch {
      recordDecline();
    } finally {
      setDeferred(null);
      setVisible(false);
    }
  };

  return (
    /* Docked to the bottom rather than injected inline at the top. It appears
       2.5s after paint, by which time the page has settled and you are already
       reading — inserting ~280px above everything moved the whole screen under
       the reader's thumb. Fixed positioning means a late arrival shifts nothing.
       pb-safe keeps it clear of the iPhone home indicator. */
    <div
      className="fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
    <div className="card mx-auto max-w-2xl p-4 sm:p-5 border border-dusk-100 bg-dusk-50 shadow-lift">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-dusk-100 text-dusk-700 flex items-center justify-center shrink-0">
          <Bell className="w-5 h-5" />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-ink-900 text-[15px] leading-snug">
            Keep it on your Home Screen
          </h3>
          <p className="text-[13px] text-ink-500 mt-1 leading-relaxed">
            {platform === 'ios-safari'
              ? 'It opens like a normal app — and it’s the only way your phone can remind you before a passport expires or a birthday arrives.'
              : 'Opens like a normal app, and can remind you before a passport expires or a birthday arrives.'}
          </p>

          {platform === 'ios-safari' ? (
            // iOS gives no programmatic install, so walk them through it. The
            // icons match what they'll actually see in Safari's toolbar.
            <ol className="mt-3 space-y-1.5 text-[13px] text-ink-600">
              <li className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-white border border-cream-300 flex items-center justify-center shrink-0">
                  <Share className="w-3 h-3 text-dusk-700" />
                </span>
                Tap <span className="font-semibold">Share</span> at the bottom of Safari
              </li>
              <li className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-white border border-cream-300 flex items-center justify-center shrink-0">
                  <Plus className="w-3 h-3 text-dusk-700" />
                </span>
                Choose <span className="font-semibold">Add to Home Screen</span>
              </li>
            </ol>
          ) : null}

          <div className="mt-3.5 flex items-center gap-2">
            {platform === 'prompt-capable' && (
              <button onClick={install} className="btn-primary text-[13px] px-3.5 py-2">
                <Download className="w-3.5 h-3.5" /> Install
              </button>
            )}
            <button
              onClick={dismiss}
              className="text-[13px] font-semibold text-ink-400 hover:text-ink-600 transition-colors cursor-pointer px-2 py-2"
            >
              {platform === 'ios-safari' ? 'Got it' : 'Not now'}
            </button>
          </div>
        </div>

        <button
          onClick={dismiss}
          aria-label="Dismiss"
          title="Dismiss"
          className="p-2 -m-1 rounded-full text-ink-400 hover:text-ink-700 hover:bg-cream-100 transition-colors cursor-pointer shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
    </div>
  );
}
