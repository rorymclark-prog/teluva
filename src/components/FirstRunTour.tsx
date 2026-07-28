import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X, ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import { getTourSeen, markTourSeen } from '../utils/tour';

// ---------------------------------------------------------------------------
// Step catalogue
// ---------------------------------------------------------------------------
//
// Deliberately SHORT — six real stops plus a welcome/closing bookend. Every
// stop earns its place by showing a payoff ("your emergency number is one
// tap away"), never furniture ("this is the header"). See the report for the
// full reasoning on what got cut and why.
//
// Each step's `selector` is re-queried live (not captured once) so a step
// that doesn't apply right now — a family-only quick action in a business
// space, the AI bubble when AI is off, an empty-state button that only
// exists before the first member is added — simply isn't found and the step
// is dropped. Nothing here hardcodes isBusinessSpace/canUseAI branching into
// "show vs hide"; that already falls out of which elements exist in the DOM.

export interface TourCtx {
  isBusinessSpace: boolean;
  membersCount: number;
  canUseAI: boolean;
  hubName: string;
}

interface TourStepDef {
  id: string;
  /** CSS selector for the element to spot-light. Omit for a centered, unanchored slide. */
  selector?: string;
  /** If the selector doesn't resolve, show this step centered instead of dropping it (used for the one step whose copy still makes sense without a live anchor — e.g. the AI bubble when AI is off). Default: drop the step entirely when the selector is missing. */
  anchorOptional?: boolean;
  title: (ctx: TourCtx) => string;
  body: (ctx: TourCtx) => string;
}

const STEPS: TourStepDef[] = [
  {
    id: 'welcome',
    title: (ctx) => `Welcome to ${ctx.hubName}`,
    body: () =>
      "There's more packed in here than fits on one screen, and some of it is genuinely surprising. " +
      'A handful of quick stops, about a minute — skip any time, and we will never make you sit through this twice.',
  },
  {
    id: 'family',
    selector: '[data-tour="family-list"], [data-tour="add-first-member"]',
    title: (ctx) =>
      ctx.membersCount === 0
        ? ctx.isBusinessSpace
          ? 'Start with your team'
          : 'Start with your people'
        : ctx.isBusinessSpace
          ? 'Your team, all in one place'
          : 'Your family, all in one place',
    body: (ctx) =>
      ctx.membersCount === 0
        ? 'Add whoever this is for — Teluva builds out their whole profile as you go: sizes, documents, medical, the lot. Nothing needs to be perfect on day one.'
        : 'Tap anyone here to see everything about them. Drag the little handle if you want them in a different order.',
  },
  {
    id: 'emergency',
    selector: '[data-tour="quick-emergency"]',
    title: () => 'For when it actually matters',
    body: () =>
      "Tap this and your country's real emergency number is one thumb-tap away — no scrolling through contacts while your hands are shaking.",
  },
  {
    id: 'smart-filing',
    selector: '[data-tour="ai-assistant"]',
    anchorOptional: true,
    title: (ctx) => (ctx.canUseAI ? 'It reads photos for you' : 'Point a camera at it'),
    body: (ctx) =>
      ctx.canUseAI
        ? "See the sparkle bubble? Tell it what happened — “add a dentist visit for Mia on the 12th” — or drop in a photo of a form, and it drafts the change. You always get the final tap before anything saves."
        : 'In Documents, Sizes and Growth, the camera icon reads what you point it at — a passport, a shoe size, a height chart — and fills the form in for you. Nothing saves until you confirm. (There is a chattier AI assistant too, off by default — turn it on in Settings if you want it.)',
  },
  {
    id: 'everywhere-else',
    selector: '[data-tour="section-menu"]',
    title: () => 'Everything else lives here',
    body: () =>
      'Documents, Household, Money, Wills & Estate, Vehicles, and the rest of it — one button, no hunting around.',
  },
  {
    id: 'data-controls',
    selector: '[data-tour="data-controls"]',
    title: () => "It's genuinely yours",
    body: () => 'Download a full backup whenever you like, or leave whenever you like — nothing here holds your data hostage.',
  },
  {
    id: 'closing',
    title: () => "That's the tour",
    body: () =>
      "There's more waiting to be found — a family quiz, a growing-up video, a recipe book, a travel timeline, the things people said that you never want to forget. You'll bump into them. Find this tour again any time from Hub settings.",
  },
];

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

const CARD_WIDTH = 340;
const VIEWPORT_PAD = 16;
const TARGET_GAP = 14;

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), Math.max(min, max));
}

// Dashboard.tsx wraps a couple of anchor targets in a `data-tour="…"
// className="contents"` div (so the wrapper doesn't disturb its parent's
// flex layout — see the section-menu and data-controls anchors). A
// `display: contents` element generates NO box of its own:
// getBoundingClientRect() on it returns an all-zero rect, which silently
// sends the spotlight/tooltip to the top-left corner instead of the real
// target. Detect that and union the children's boxes instead — as a bonus
// this spotlights the WHOLE cluster (e.g. all four header icon buttons)
// rather than just one of them.
function measureRect(el: Element): DOMRect | null {
  if (getComputedStyle(el).display !== 'contents') return el.getBoundingClientRect();
  const children = Array.from(el.children);
  if (children.length === 0) return null;
  const rects = children.map((c) => c.getBoundingClientRect());
  const top = Math.min(...rects.map((r) => r.top));
  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

interface Placement {
  top: number;
  left: number;
}

function placeCard(rect: DOMRect | null, cardHeight: number): Placement | null {
  if (!rect) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_WIDTH, vw - VIEWPORT_PAD * 2);

  const spaceBelow = vh - rect.bottom;
  const spaceAbove = rect.top;
  let top: number;
  if (spaceBelow >= cardHeight + TARGET_GAP + VIEWPORT_PAD || spaceBelow >= spaceAbove) {
    top = rect.bottom + TARGET_GAP;
  } else {
    top = rect.top - TARGET_GAP - cardHeight;
  }
  top = clamp(top, VIEWPORT_PAD, Math.max(VIEWPORT_PAD, vh - cardHeight - VIEWPORT_PAD));

  let left = rect.left + rect.width / 2 - width / 2;
  left = clamp(left, VIEWPORT_PAD, Math.max(VIEWPORT_PAD, vw - width - VIEWPORT_PAD));

  return { top, left };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ResolvedStep extends TourStepDef {
  /** Live selector to re-query on every frame while this step is showing (undefined = unanchored). */
  liveSelector?: string;
}

interface FirstRunTourProps {
  uid: string | null;
  demo: boolean;
  /** True once initial data has loaded AND no other auto-opening modal (the AI consent prompt) is in front — see Dashboard.tsx. */
  ready: boolean;
  hubName: string;
  isBusinessSpace: boolean;
  membersCount: number;
  canUseAI: boolean;
  /** Bump this number to force the tour to run again regardless of "seen" state (Hub settings → "Replay the welcome tour"). */
  forceKey?: number;
}

export default function FirstRunTour({
  uid,
  demo,
  ready,
  hubName,
  isBusinessSpace,
  membersCount,
  canUseAI,
  forceKey = 0,
}: FirstRunTourProps) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'active' | 'done'>('idle');
  const [resolvedSteps, setResolvedSteps] = useState<ResolvedStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const lastForceKey = useRef(forceKey);
  const checkedOnce = useRef(false);

  const ctx: TourCtx = useMemo(
    () => ({ isBusinessSpace, membersCount, canUseAI, hubName }),
    [isBusinessSpace, membersCount, canUseAI, hubName],
  );

  // Decide whether to run — either the normal "never seen it" path (once,
  // after the caller says it's safe to check) or an explicit replay.
  useEffect(() => {
    const forced = forceKey !== lastForceKey.current;
    lastForceKey.current = forceKey;

    if (forced) {
      activate();
      return;
    }
    if (!ready || checkedOnce.current || status !== 'idle') return;
    checkedOnce.current = true;
    setStatus('checking');
    getTourSeen(uid, demo).then((seen) => {
      if (!seen) activate();
      else setStatus('done');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, forceKey]);

  function activate() {
    const built: ResolvedStep[] = [];
    for (const def of STEPS) {
      if (!def.selector) {
        built.push(def);
        continue;
      }
      const el = document.querySelector(def.selector);
      if (el) built.push({ ...def, liveSelector: def.selector });
      else if (def.anchorOptional) built.push(def);
      // else: drop — nothing on screen for this stop right now.
    }
    setResolvedSteps(built);
    setStepIndex(0);
    setStatus('active');
  }

  const finish = () => {
    setStatus('done');
    void markTourSeen(uid, demo);
  };

  const step = resolvedSteps[stepIndex];
  const isLast = stepIndex >= resolvedSteps.length - 1;

  const goNext = () => (isLast ? finish() : setStepIndex((i) => i + 1));
  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));

  // Hide the card the instant a step changes (before paint) so it never
  // flashes at the PREVIOUS step's position/size for a frame while the real
  // measurement below catches up. Deliberately does not read `rect` at all —
  // that's what caused the stale-value race this replaced.
  useLayoutEffect(() => {
    setPlacement(null);
  }, [stepIndex]);

  // Track the current step's target AND compute the card's placement from it
  // TOGETHER, in one pass, using a local variable rather than the `rect`
  // React-state value. Splitting these into two separate effects (one
  // `setRect`, another reacting to the `rect` state to `setPlacement`) has a
  // real race: when the step changes, both effects re-run in the same
  // commit, and the placement effect closes over the OLD `rect` from before
  // this render — it ends up placing the card against last step's target
  // instead of this one, which briefly parked the tooltip on top of (rather
  // than next to) whatever it should have been pointing at. Computing both
  // from the same freshly-queried rect in one place removes the race
  // entirely — the DOM already reflects this step's new title/body by the
  // time this passive effect runs, so `cardRef` measures the right content.
  useEffect(() => {
    if (status !== 'active') return;
    if (!step?.liveSelector) {
      setRect(null);
      setPlacement(null);
      return;
    }
    const selector = step.liveSelector;

    const measure = () => {
      const el = document.querySelector(selector);
      const r = el ? measureRect(el) : null;
      setRect(r);
      const h = cardRef.current?.getBoundingClientRect().height ?? 160;
      setPlacement(r ? placeCard(r, h) : null);
    };

    const el = document.querySelector(selector);
    // Instant, not smooth: a smooth scroll's duration scales with distance
    // (this page can be long — several cards sit above the family list), and
    // there is no reliable cross-browser "scroll finished" signal to wait
    // for. Jumping straight there and letting the card/spotlight's own
    // entrance animation (anim-pop) carry the motion sidesteps that entirely
    // — and prefers-reduced-motion already neutralises anim-pop globally
    // (see index.css), so this needs no separate reduced-motion branch.
    el?.scrollIntoView({ block: 'center', behavior: 'auto' });
    measure();
    const raf = requestAnimationFrame(measure); // one more pass in case the scroll forced a late layout shift

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [status, stepIndex, step?.liveSelector]);

  // Escape skips; Tab is trapped inside the card (it's the only focusable
  // surface while the tour is up — the backdrop intentionally blocks
  // everything else).
  useEffect(() => {
    if (status !== 'active') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        finish();
        return;
      }
      if (e.key === 'Tab' && cardRef.current) {
        const focusables = cardRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, stepIndex]);

  // Move focus into the card on every step change so a keyboard/screen-reader
  // user always lands somewhere sane, never stuck on a now-hidden element.
  useEffect(() => {
    if (status === 'active') cardRef.current?.focus();
  }, [status, stepIndex]);

  if (status !== 'active' || !step) return null;

  const centered = !rect;
  const width = typeof window !== 'undefined' ? Math.min(CARD_WIDTH, window.innerWidth - VIEWPORT_PAD * 2) : CARD_WIDTH;
  const spotlightPad = 6;

  return (
    <div
      className="fixed inset-0 z-[200]"
      onWheel={(e) => e.preventDefault()}
      onTouchMove={(e) => e.preventDefault()}
    >
      {/* Backdrop. Anchored steps get a spotlight cutout (huge box-shadow
          trick — no SVG mask needed); unanchored slides get a plain dim. */}
      {rect ? (
        <div
          className="anim-pop"
          style={{
            position: 'fixed',
            top: rect.top - spotlightPad,
            left: rect.left - spotlightPad,
            width: rect.width + spotlightPad * 2,
            height: rect.height + spotlightPad * 2,
            borderRadius: 18,
            boxShadow: '0 0 0 9999px rgba(28, 25, 23, 0.6)',
            border: '2px solid var(--color-clay-400)',
            pointerEvents: 'none',
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-ink-900/55 backdrop-blur-sm anim-fade" />
      )}

      {/* Card */}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-step-title"
        tabIndex={-1}
        className="card p-5 anim-pop outline-none"
        style={
          centered
            ? {
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width,
                maxWidth: 'calc(100vw - 2rem)',
              }
            : {
                position: 'fixed',
                top: placement?.top ?? -9999,
                left: placement?.left ?? -9999,
                width,
                maxWidth: 'calc(100vw - 2rem)',
                opacity: placement ? 1 : 0,
              }
        }
      >
        <div className="flex items-start justify-between gap-3 mb-2.5">
          <div className="flex items-center gap-1.5">
            {resolvedSteps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === stepIndex ? 'w-4 bg-clay-500' : 'w-1.5 bg-cream-300'}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={finish}
            className="shrink-0 -m-1 p-1 text-ink-400 hover:text-ink-700 rounded-lg hover:bg-cream-100 transition-colors cursor-pointer"
            aria-label="Skip the tour"
            title="Skip"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {step.id === 'welcome' && (
          <div className="w-10 h-10 rounded-2xl bg-clay-50 text-clay-600 flex items-center justify-center mb-3">
            <Sparkles className="w-5 h-5" />
          </div>
        )}

        <h3 id="tour-step-title" className="font-display text-lg font-semibold text-ink-900 leading-snug">
          {step.title(ctx)}
        </h3>
        <p className="text-[13.5px] text-ink-600 leading-relaxed mt-1.5">{step.body(ctx)}</p>

        <div className="flex items-center justify-between gap-2 mt-4 pt-3.5 border-t border-cream-200">
          <button
            type="button"
            onClick={goBack}
            disabled={stepIndex === 0}
            className="btn-quiet px-3 py-2 text-[13px] disabled:opacity-0 disabled:pointer-events-none"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>
          <button type="button" onClick={goNext} className="btn-primary px-4 py-2 text-[13px]">
            <span>{isLast ? 'Got it' : 'Next'}</span>
            {!isLast && <ArrowRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
