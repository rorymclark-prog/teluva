import { canShare, srcToFile } from './share';
import { appConfirm } from './appConfirm';

/**
 * HAND THE FILE TO WHATEVER APP THE PHONE HAS.
 *
 * Rory: "if we open a lease or any legal doc we must have the choice to open
 * it in ChatGPT or whatever AI app we have downloaded on that device."
 *
 * The mechanism already existed — the Share button is the OS share sheet, and
 * ChatGPT and Claude both register as share targets — but nobody reads
 * "Share" as "ask an AI about this". A labelled action is the whole feature.
 *
 * WHY THIS IS THE RIGHT ANSWER RATHER THAN BUILDING AN INTERPRETER.
 * DocumentAskModal is deliberately recall-only: it quotes the user's own
 * document back and never authors a sentence, because reading a lease and
 * telling somebody what it means is regulated advice (Austria, GewO §137).
 * That constraint applies to Teluva. It does not apply to a person choosing
 * to send their own file to their own AI app. So the honest move is not to
 * interpret it here — it is to get out of the way and hand it over.
 *
 * BUT THE FILE LEAVES. That is the entire point and it must be said once, in
 * words, before it happens: the receiving app is not covered by anything
 * Teluva promises, and a will or a passport going to a chat service is a
 * different decision from a lease. Confirmed once per session rather than
 * every time — a dialog somebody dismisses on reflex protects nobody.
 *
 * appConfirm, never window.confirm: in a webview window.confirm returns false
 * with no dialog shown at all, so the action would silently never happen.
 */

let acknowledgedThisSession = false;

/** Reset between accounts — a warning one person accepted is not consent from the next. */
export function resetOpenElsewhereConsent(): void {
  acknowledgedThisSession = false;
}

export const canOpenElsewhere = canShare;

export async function openElsewhere(src: string, name: string): Promise<'shared' | 'declined' | 'unavailable'> {
  if (!canShare) return 'unavailable';

  if (!acknowledgedThisSession) {
    const ok = await appConfirm(
      `This sends a copy of “${name}” out of Teluva to whichever app you pick — ChatGPT, Claude, Mail, anything installed. `
      + 'What that app does with it is covered by their rules, not ours. Fine for a lease or a bill; think twice about a will, a passport or anything medical.',
      { confirmLabel: 'Choose an app' },
    );
    if (!ok) return 'declined';
    acknowledgedThisSession = true;
  }

  try {
    const file = await srcToFile(src, name);
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    }
    // No file support on this browser. Sharing the title alone would look
    // like it worked and send nothing, which is worse than saying so.
    return 'unavailable';
  } catch {
    // Cancelled at the OS sheet, or the file could not be fetched.
    return 'declined';
  }
}
