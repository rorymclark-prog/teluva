/**
 * Text size — the reader's own preference, per device.
 *
 * Deliberately NOT synced to the family document. Text size is a property of
 * the screen you are holding and the eyes reading it, not of the household: the
 * same person wants one size on a phone at arm's length and another on a
 * laptop. So it lives in localStorage, and each device keeps its own answer.
 *
 * The value is written to the root element as `--type-user`, which src/index.css
 * multiplies into `--type-scale` alongside the built-in phone bump. Every text
 * size in the app is expressed against that variable, so this is a single
 * assignment rather than a re-render.
 */

/** Multipliers, smallest first. `DEFAULT_INDEX` is the app's shipped size. */
export const TEXT_SCALES = [0.9, 1, 1.1, 1.2, 1.35] as const;
export const TEXT_SCALE_LABELS = ['Smaller', 'Default', 'Larger', 'Largest', 'Biggest'] as const;
export const DEFAULT_INDEX = 1;

const KEY = 'teluva.textScale';

/** The stored step, clamped — a hand-edited or stale value can't break layout. */
export function getTextScaleIndex(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_INDEX;
  // Read the string first and reject a missing key explicitly. Going straight
  // to Number() would turn `null` into 0 — a valid index — and silently hand
  // every reader who had never touched the setting the SMALLEST size.
  const stored = localStorage.getItem(KEY);
  if (stored === null) return DEFAULT_INDEX;
  const raw = Number(stored);
  if (!Number.isInteger(raw) || raw < 0 || raw >= TEXT_SCALES.length) return DEFAULT_INDEX;
  return raw;
}

/**
 * Push a step to the document. Separate from persistence so the settings
 * slider can preview a value live while it is being dragged.
 *
 * Two knobs, because the app sizes things two different ways:
 *
 *  · The ROOT FONT SIZE. Tailwind expresses widths, heights, padding, gaps and
 *    radii in rem, so an icon at `w-4` is 1rem and grows with this. That is
 *    what makes the setting scale the interface rather than only the words.
 *    Breakpoints stay in px and are untouched, so the layout does not jump to
 *    a different arrangement just because the text got bigger.
 *
 *  · `--type-user`, for the ~1,350 hardcoded `text-[Npx]` sizes, which are
 *    immune to a rem change and have to be scaled explicitly (see index.css).
 *
 * CSS `zoom` would have done both in one line, and was measured and rejected:
 * it leaves `100vh` unscaled, so every full-height screen and modal backdrop
 * in the app ends up taller than the window it is in.
 */
const ROOT_FONT_PX = 16;

export function applyTextScale(index: number): void {
  const scale = TEXT_SCALES[index] ?? TEXT_SCALES[DEFAULT_INDEX];
  document.documentElement.style.fontSize = `${ROOT_FONT_PX * scale}px`;
  document.documentElement.style.setProperty('--type-user', String(scale));
}

/** Persist and apply. */
export function setTextScaleIndex(index: number): void {
  const clamped = Math.min(Math.max(index, 0), TEXT_SCALES.length - 1);
  try {
    localStorage.setItem(KEY, String(clamped));
  } catch {
    /* private mode / quota — the size still applies for this session */
  }
  applyTextScale(clamped);
}
