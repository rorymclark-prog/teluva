// appConfirm — the app's own confirm dialog, replacing window.confirm().
//
// WHY THIS EXISTS
// ---------------
// window.confirm() is not reliable in the places this app actually runs.
// Installed-PWA windows and webviews (iOS "Add to Home Screen", the installed
// Mac app, in-app browsers) are allowed to SUPPRESS native dialogs entirely:
// confirm() then returns false immediately with NO dialog shown, so every
// "Are you sure?" silently answers itself "no" and the button appears dead.
// (Documented bug class: reference_webview_native_dialogs / appConfirm in the
// ImbewuField app, where this bit for real.)
//
// This is an imperative, dependency-free replacement so call sites keep the
// simple `if (await appConfirm(...))` shape instead of each component growing
// its own open/close state. It builds plain DOM, styles itself from the theme's
// CSS custom properties (var(--color-*) — so check-colors stays happy and dark
// mode "just works" wherever the tokens are redefined), and resolves a Promise.
//
// Behaviour matches what people expect from a confirm:
//   - Escape or backdrop click  -> false
//   - Enter                    -> the focused button (confirm is focused first
//                                  only for non-danger asks; danger asks focus
//                                  Cancel so a reflex Enter never destroys data)
//   - Tab                      -> cycles between the two buttons
// Concurrent calls queue: one question on screen at a time, in order.

export interface AppConfirmOptions {
  /** Short heading above the message. Defaults to 'Are you sure?'. */
  title?: string;
  /** Label on the confirming button. Defaults to 'Confirm'. */
  confirmLabel?: string;
  /** Label on the cancel button. Defaults to 'Cancel'. */
  cancelLabel?: string;
  /**
   * Destructive ask: confirm button renders in the warning ramp and initial
   * focus goes to Cancel, so a stray Enter is always the safe answer.
   */
  danger?: boolean;
}

type QueueItem = {
  message: string;
  opts: AppConfirmOptions;
  resolve: (answer: boolean) => void;
};

const queue: QueueItem[] = [];
let showing = false;

const v = (token: string) => `var(--color-${token})`;

function show(item: QueueItem): void {
  showing = true;
  const { message, opts, resolve } = item;
  const danger = opts.danger === true;

  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'presentation');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '9999',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    background: 'rgba(17, 17, 20, 0.45)', // ink-900 at 45%
  } satisfies Partial<CSSStyleDeclaration>);

  const card = document.createElement('div');
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  Object.assign(card.style, {
    maxWidth: '360px',
    width: '100%',
    borderRadius: '20px',
    background: v('cream-50'),
    border: `1px solid ${v('cream-200')}`,
    boxShadow: '0 18px 50px rgba(17, 17, 20, 0.22)',
    padding: '20px',
    fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
    textAlign: 'left',
  } satisfies Partial<CSSStyleDeclaration>);

  const heading = document.createElement('h2');
  heading.textContent = opts.title ?? 'Are you sure?';
  Object.assign(heading.style, {
    margin: '0 0 8px',
    fontSize: '15px',
    fontWeight: '700',
    color: v('ink-800'),
  } satisfies Partial<CSSStyleDeclaration>);
  card.setAttribute('aria-label', heading.textContent ?? '');

  const body = document.createElement('p');
  body.textContent = message;
  Object.assign(body.style, {
    margin: '0 0 16px',
    fontSize: '13.5px',
    lineHeight: '1.55',
    color: v('ink-600'),
    whiteSpace: 'pre-line', // callers pass \n\n for paragraph breaks today
  } satisfies Partial<CSSStyleDeclaration>);

  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end',
  } satisfies Partial<CSSStyleDeclaration>);

  const baseButton = (el: HTMLButtonElement) => {
    Object.assign(el.style, {
      borderRadius: '9999px',
      padding: '9px 16px',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      border: '1px solid transparent',
      fontFamily: 'inherit',
    } satisfies Partial<CSSStyleDeclaration>);
  };

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = opts.cancelLabel ?? 'Cancel';
  baseButton(cancelBtn);
  Object.assign(cancelBtn.style, {
    background: 'transparent',
    border: `1px solid ${v('cream-300')}`,
    color: v('ink-600'),
  } satisfies Partial<CSSStyleDeclaration>);

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.textContent = opts.confirmLabel ?? 'Confirm';
  baseButton(confirmBtn);
  Object.assign(confirmBtn.style, {
    background: danger ? v('clay-600') : v('ink-800'),
    color: v('cream-50'),
  } satisfies Partial<CSSStyleDeclaration>);

  row.append(cancelBtn, confirmBtn);
  card.append(heading, body, row);
  overlay.append(card);

  let settled = false;
  const finish = (answer: boolean) => {
    if (settled) return;
    settled = true;
    document.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
    previouslyFocused?.focus?.();
    showing = false;
    resolve(answer);
    const next = queue.shift();
    if (next) show(next);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    } else if (e.key === 'Tab') {
      // Two-stop focus trap.
      e.preventDefault();
      (document.activeElement === confirmBtn ? cancelBtn : confirmBtn).focus();
    }
  };

  cancelBtn.addEventListener('click', () => finish(false));
  confirmBtn.addEventListener('click', () => finish(true));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) finish(false);
  });
  document.addEventListener('keydown', onKeyDown, true);

  document.body.append(overlay);
  (danger ? cancelBtn : confirmBtn).focus();
}

/**
 * Ask the person a yes/no question with the app's own dialog.
 * Drop-in for `window.confirm(message)` — `if (await appConfirm(msg)) { ... }`.
 */
export function appConfirm(message: string, opts: AppConfirmOptions = {}): Promise<boolean> {
  // Non-browser context (tests, SSR): never block, answer "no" loudly in dev.
  if (typeof document === 'undefined') return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const item: QueueItem = { message, opts, resolve };
    if (showing) queue.push(item);
    else show(item);
  });
}
