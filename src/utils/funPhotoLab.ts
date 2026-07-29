import { useSyncExternalStore } from 'react';
import { auth } from '../lib/firebase';
import type { FamilyMember } from '../types';

// Ready-made "fun photo" presets — group/scene ideas ("everyone pulling
// faces", "gangster crew"), deliberately kept separate from
// AvatarRestyleModal's STYLES grid (single-subject art-style filters).
// Deliberately SHORT (a long list is a decision, a short list is an
// invitation) and deliberately fixed — there is no free-text option here,
// unlike the "describe your own" box elsewhere in the modal. See the safety
// note on FUN_PHOTO_STYLES in server.js for why.
// Keys MUST match FUN_PHOTO_STYLES in server.js.
export const FUN_PRESETS: { key: string; label: string; emoji: string }[] = [
  { key: 'silly-faces', label: 'Silly faces', emoji: '🤪' },
  { key: 'gangster', label: 'Gangster crew', emoji: '🎩' },
  { key: 'superhero-squad', label: 'Superhero squad', emoji: '🦸' },
  { key: 'red-carpet', label: 'Red carpet', emoji: '🌟' },
  { key: 'secret-agents', label: 'Secret agents', emoji: '🕶️' },
];

export type FunPhotoJob = {
  memberId: string;
  memberName: string;
  presetKey: string;
  presetLabel: string;
  status: 'running' | 'done' | 'error';
  resultDataUrl?: string;
  error?: string;
  startedAt: number;
};

// ---------------------------------------------------------------------------
// Module-level job store — deliberately OUTSIDE React state. This follows
// the same pattern already used elsewhere in this app for work that must
// outlive one component instance: db.ts's `sessionAttachmentBlobs` cache and
// AIChatbot.tsx's module-level FAMILY_ID are both plain values living at
// module scope rather than in a component. Here that matters because
// AvatarRestyleModal — the sheet that starts a job — is exactly the thing
// the user is told they can close while it runs; if the fetch lived in that
// component's state, closing the sheet would unmount it mid-request and the
// result would be silently lost. Keeping the Map here means the fetch keeps
// running and its result is kept, in memory, until the user next opens the
// modal for that member (or reloads the page — this is not persisted across
// a reload, see the trade-off note on `announce` below).
// ---------------------------------------------------------------------------
const jobs = new Map<string, FunPhotoJob>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Live-updating read of the current fun-photo job for one member, if any. */
export function useFunPhotoJob(memberId: string): FunPhotoJob | undefined {
  return useSyncExternalStore(subscribe, () => jobs.get(memberId));
}

export function getFunPhotoJob(memberId: string): FunPhotoJob | undefined {
  return jobs.get(memberId);
}

/** Dismiss a finished/errored job so the preset grid becomes usable again. */
export function clearFunPhotoJob(memberId: string): void {
  jobs.delete(memberId);
  notify();
}

function parseDataUrl(src: string): { mimeType: string; data: string } | null {
  const m = src.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

/**
 * Fire off a fun-photo generation in the background. Deliberately fire-and-
 * forget — the whole point is that the caller (a button's onClick) does not
 * await this; the request runs against this module's own Map, not against
 * whichever component happened to trigger it. Cost/spam guard: only one
 * in-flight job per member (a second click while one is already running is a
 * no-op) — on top of the server's own per-minute rate limit and monthly AI
 * usage cap, which this endpoint enforces exactly like every other AI route.
 */
export function startFunPhotoJob(member: FamilyMember, sourceUrl: string, presetKey: string): void {
  const existing = jobs.get(member.id);
  if (existing?.status === 'running') return;

  const preset = FUN_PRESETS.find((p) => p.key === presetKey);
  const parsed = parseDataUrl(sourceUrl);
  if (!preset || !parsed) return;

  const memberName = member.nickname || member.name;
  const job: FunPhotoJob = {
    memberId: member.id,
    memberName,
    presetKey,
    presetLabel: preset.label,
    status: 'running',
    startedAt: Date.now(),
  };
  jobs.set(member.id, job);
  notify();

  (async () => {
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Please sign in again.');
      const token = await user.getIdToken();
      const res = await fetch('/api/fun-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image: parsed, preset: presetKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.image) throw new Error(data.error || 'Could not create the photo.');
      jobs.set(member.id, { ...job, status: 'done', resultDataUrl: data.image });
      notify();
      announce(`🎉 ${memberName}'s "${preset.label}" photo is ready — open their profile to see it.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong.';
      jobs.set(member.id, { ...job, status: 'error', error: message });
      notify();
      announce(`Couldn't create ${memberName}'s "${preset.label}" photo — please try again.`, true);
    }
  })();
}

// ---------------------------------------------------------------------------
// A tiny, self-mounting "it's ready" toast — plain DOM, not a React
// component wired into the app tree. Dashboard.tsx already has an identical-
// looking bottom toast (`showToast`), which would be the natural thing to
// call into, but Dashboard.tsx is another agent's file this round and is
// off-limits here. AvatarRestyleModal — the only component this feature
// currently lives in — unmounts the instant the sheet that started the job
// is closed (that's the point of "you can close this"), so nothing in the
// normal component tree is guaranteed to still be mounted when a result
// lands. Appending directly to document.body sidesteps that without
// touching any other file. Styled to match Dashboard's toast (same
// position, same "card" utility class). If Dashboard's toast is ever made
// callable from outside, this can be swapped for a one-line call into it.
// ---------------------------------------------------------------------------
function announce(message: string, isError = false): void {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.textContent = message;
  el.className = [
    'fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] card px-5 py-3 max-w-[90vw]',
    'text-[13px] font-semibold transition-opacity duration-500',
    isError ? 'text-rosa-700' : 'text-ink-800',
  ].join(' ');
  el.style.opacity = '0';
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 500);
  }, 6000);
}
