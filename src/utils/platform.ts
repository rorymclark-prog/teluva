// Which device is this, and what can its clipboard actually do?
//
// Only ever used to change WORDING and which hint is shown — never to gate a
// feature. Every path stays available on every device; the platform check just
// stops the app giving Ctrl+V advice to someone holding an iPad.

/**
 * iPhone or iPad (or an iPad pretending to be a desktop Mac).
 *
 * THE TRAP: since iPadOS 13, iPad Safari reports its user agent as
 * "Macintosh; Intel Mac OS X" by default — desktop-class browsing. So testing
 * the UA for "iPad" returns FALSE on every modern iPad, which is exactly the
 * device this check exists for. The touch-point count is what separates a real
 * Mac (0) from an iPad wearing a Mac's user agent (5).
 */
export function isAppleTouchDevice(ua: string, platform: string, maxTouchPoints: number): boolean {
  const agent = ua || '';
  if (/iPad|iPhone|iPod/.test(agent)) return true;
  // A user agent that names a non-Apple OS is taken at its word. navigator
  // .platform is NOT overridden by browser device-emulation while the user
  // agent is, so an emulated Android phone on a Mac still reports "MacIntel"
  // with 5 touch points and would otherwise match the iPad rule below. Caught
  // while verifying this very change in an emulated viewport.
  if (/Android|Windows|CrOS/.test(agent)) return false;
  return /Mac/.test(platform || '') && (maxTouchPoints || 0) > 1;
}

/** Reads the real browser. Safe to call anywhere; false during SSR. */
export function isAppleTouch(): boolean {
  if (typeof navigator === 'undefined') return false;
  return isAppleTouchDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
}

/**
 * What to say when the PASTE BUTTON came back with nothing we could use.
 *
 * Specific to the button, which reads `navigator.clipboard.read()`. WebKit
 * supports exactly four types there — text/plain, text/html, text/uri-list and
 * image/png — so a copied photo comes through and a copied PDF is simply not
 * offered, however correctly it was copied:
 * https://webkit.org/blog/10855/async-clipboard-api/
 *
 * The paste EVENT is a different API — WebKit's docs say files on the
 * pasteboard reach `DataTransfer.files`, "for example, when copying a PDF file
 * in Finder" (https://webkit.org/blog/8170/clipboard-api-improvements/). That
 * is a MACOS sentence, and reading it as a WebKit-wide one cost another
 * release: this string briefly told iPhone users to hold in the message box
 * and choose Paste. On a Mac that genuinely works — Rory confirmed a PDF
 * pasting there. On a phone the box now offers Paste (v260) and the clipboard
 * arrives EMPTY, because iOS puts a file promise on the pasteboard rather than
 * the bytes, and WebKit withholds it from web content.
 *
 * So on a phone there is no paste route for a document, and this must not
 * invent one. "Copy one first" stays wrong on iOS too: they just did.
 */
export function emptyClipboardAdvice(appleTouch: boolean): string {
  return appleTouch
    ? 'The Paste button can only take text and photos on an iPhone or iPad — a copied document never reaches a web app there. Tap the paperclip and pick it from Files instead.'
    : 'No image or PDF found on the clipboard — copy one first, then tap Paste.';
}

/**
 * What to say when a paste arrived carrying NOTHING — no file, no text, not
 * even a type. The paste happened; the browser handed over an empty
 * DataTransfer.
 *
 * On iPhone and iPad this is the ordinary outcome for a copied document, and
 * saying so is now supported rather than guessed: Rory pasted the same PDF
 * into the same app on a Mac and it attached. macOS "Copy" puts the file's
 * BYTES on the pasteboard; iOS puts a file promise / file:// reference, and
 * WebKit withholds file:// from web content. A native app can resolve that
 * promise, which is why the ChatGPT *app* on the same phone can take the file
 * and a web app cannot — never the like-for-like comparison it looked like.
 *
 * Note what this does NOT say: it does not name a mechanism, and it does not
 * promise another gesture will work. Twice now a confident cause in this copy
 * has been wrong (v257 "never reaches the page", v259 "an app's built-in
 * browser"). Describe what happened, contrast it with where it does work, and
 * hand over the route that always works.
 */
export function emptyPasteAdvice(appleTouch: boolean): string {
  return appleTouch
    ? 'Nothing came through — an iPhone or iPad doesn’t hand a copied document to a web app, which is why this same copy and paste works on a Mac.'
    : 'The paste came through empty — nothing was handed over to attach.';
}

/**
 * What to say when a paste arrived carrying no file at all — the clipboard had
 * only a name or a path where a document was expected. Distinct from the
 * button's message above: here the user made the gesture we recommend, so the
 * answer must not send them back to it.
 */
export function copiedNameOnlyAdvice(appleTouch: boolean): string {
  return appleTouch
    ? 'That copied the file’s name, not the file itself. Tap the paperclip and pick it from Files instead.'
    : 'Copying a file in Finder only copies where it is, not the file itself. Drag it onto the chat instead, or use Attach.';
}

/** The one-line hint under the composer. Ctrl+V means nothing on a tablet. */
export function composerHint(appleTouch: boolean): string {
  return appleTouch
    ? 'Tap the paperclip to add a photo or a file from Files · Nothing saves until you tap Apply.'
    : 'Paste a screenshot with Ctrl+V, or drag a file onto the chat · Nothing saves until you tap Apply.';
}
