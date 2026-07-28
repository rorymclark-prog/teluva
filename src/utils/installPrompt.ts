// "Add to Home Screen" — deciding WHEN to ask, and when to stop asking.
//
// Why this matters more than it looks: on iOS, a web app only gets push
// notifications once it has been added to the Home Screen. So a family that
// never installs it never gets a birthday reminder or an expiry warning — the
// two things that make this app feel alive rather than a filing cabinet you
// have to remember to open.
//
// The rules encoded here are all about NOT being a nuisance:
//   · never ask someone who has already installed it
//   · never ask before they've put something in — an install prompt for an
//     empty app is asking for commitment before showing value
//   · back off after each decline (3 days, then 2 weeks, then a month)
//   · stop asking entirely after the third decline. Someone who has said no
//     three times has decided.
//
// Pure and side-effect-light so it can be reasoned about and tested; the only
// state is a small localStorage record, which is correct — installing is a
// per-DEVICE act, not a per-account one. The same person on a phone and a
// laptop genuinely should be asked on the phone and not the laptop.

// NOTE: still 'tresa_' after the rename to Teluva — deliberately. This holds
// how many times someone has declined the install prompt; renaming it resets
// that to zero and starts pestering people who already said no three times.
const KEY = 'tresa_install_prompt_v1';

export interface InstallPromptState {
  /** How many times the user has actively dismissed the prompt. */
  declines: number;
  /** ISO timestamp of the last dismissal, or null if never dismissed. */
  lastDeclinedAt: string | null;
  /** Set once we've seen the app running installed — we then never ask again. */
  installed: boolean;
}

const EMPTY: InstallPromptState = { declines: 0, lastDeclinedAt: null, installed: false };

/** Days to wait after the Nth decline before asking again. Index = decline count. */
const BACKOFF_DAYS = [3, 14, 30];
/** After this many declines we stop asking for good. */
export const MAX_DECLINES = 3;

export function readState(): InstallPromptState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return {
      declines: typeof parsed.declines === 'number' ? parsed.declines : 0,
      lastDeclinedAt: typeof parsed.lastDeclinedAt === 'string' ? parsed.lastDeclinedAt : null,
      installed: parsed.installed === true,
    };
  } catch {
    return { ...EMPTY };
  }
}

function writeState(s: InstallPromptState): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode — just ask again next time */ }
}

export function recordDecline(now: Date = new Date()): void {
  const s = readState();
  writeState({ ...s, declines: s.declines + 1, lastDeclinedAt: now.toISOString() });
}

export function recordInstalled(): void {
  writeState({ ...readState(), installed: true });
}

/** True when the app is running from the Home Screen / as an installed app. */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const displayMode = typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches;
  // iOS Safari predates the display-mode media query and uses its own flag.
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return displayMode || iosStandalone;
}

export type InstallPlatform = 'ios-safari' | 'prompt-capable' | 'unsupported';

/**
 * Which install story applies on this device.
 *
 *  ios-safari      — must be talked through Share → Add to Home Screen; there
 *                    is no programmatic prompt on iOS, so we show instructions.
 *  prompt-capable  — Chrome/Edge/Android fired beforeinstallprompt, so we can
 *                    offer a real one-tap install.
 *  unsupported     — an in-app browser (Instagram, Facebook, WhatsApp) or a
 *                    desktop that can't install. Asking here produces a dead
 *                    end, so we say nothing. This matters: invite links get
 *                    opened inside WhatsApp constantly.
 */
export function detectPlatform(hasDeferredPrompt: boolean, ua: string = navigator.userAgent): InstallPlatform {
  if (hasDeferredPrompt) return 'prompt-capable';

  const isIOS = /iPad|iPhone|iPod/.test(ua)
    // iPadOS 13+ reports as a Mac; the touch-point count gives it away.
    || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
  if (!isIOS) return 'unsupported';

  // Inside an in-app browser there is no Share → Add to Home Screen, so the
  // instructions would send the user hunting for a button that isn't there.
  const inAppBrowser = /FBAN|FBAV|Instagram|Line|Twitter|WhatsApp|Snapchat/i.test(ua);
  if (inAppBrowser) return 'unsupported';

  // Chrome/Firefox on iOS can't add to Home Screen either — only Safari can.
  const isNonSafariIOS = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  if (isNonSafariIOS) return 'unsupported';

  return 'ios-safari';
}

/**
 * Should we show the prompt right now?
 *
 * `hasContent` is the caller's judgement that the family has actually put
 * something in — we deliberately don't ask an empty vault to be installed.
 */
export function shouldPrompt(opts: {
  platform: InstallPlatform;
  hasContent: boolean;
  state?: InstallPromptState;
  now?: Date;
}): boolean {
  const { platform, hasContent } = opts;
  const state = opts.state ?? readState();
  const now = opts.now ?? new Date();

  if (platform === 'unsupported') return false;
  if (isInstalled() || state.installed) return false;
  if (!hasContent) return false;
  if (state.declines >= MAX_DECLINES) return false;

  if (state.lastDeclinedAt) {
    const waitDays = BACKOFF_DAYS[Math.min(state.declines - 1, BACKOFF_DAYS.length - 1)] ?? 30;
    const since = (now.getTime() - new Date(state.lastDeclinedAt).getTime()) / 86400000;
    if (!Number.isFinite(since) || since < waitDays) return false;
  }

  return true;
}
