/**
 * The two numbers the doorbell copy has to say out loud.
 *
 * They are DUPLICATED from server/willsRelease.mjs, which is the authority —
 * that file decides, this one only lets the screen say what it decided. The
 * duplication exists because the server module is .mjs and dependency-free by
 * design (it is `node --test`ed with no bundler), and importing it into the
 * Vite build would drag the boundary logic into the client bundle for no gain.
 *
 * releaseCopy.test.ts reads both files and fails when they disagree, so the
 * copy can never promise seven days while the server waits fourteen. If you
 * change a number, change it THERE first.
 */
export const RELEASE_WAIT_DAYS = 7;
export const QUIET_DAYS = 14;

/** "in 3 days" / "today" — for a clock the reader is watching tick down. */
export function waitLabel(days: number | null): string {
  if (days === null) return 'shortly';
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** Whole days left before silence opens a request. Mirrors daysUntilRelease. */
export function daysLeft(requestedAt: string, now: Date = new Date()): number | null {
  const at = Date.parse(requestedAt);
  if (!Number.isFinite(at)) return null;
  const left = Math.ceil((at + RELEASE_WAIT_DAYS * 86400000 - now.getTime()) / 86400000);
  return left > 0 ? left : 0;
}
