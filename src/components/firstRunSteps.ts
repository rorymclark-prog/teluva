import type React from 'react';
import { Sparkles, Compass } from 'lucide-react';
import type { HeroTone } from './StepHero';

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
//
// WHAT a surviving step SAYS is a separate problem, and for five versions it
// was the wrong one. Dropping the emergency step in a business space worked
// exactly as designed — but the closing slide still promised a family quiz, a
// growing-up video, a recipe book and a travel timeline, all four of which
// HIDDEN_VIEWS_IN_BUSINESS hides; the section-menu step named Wills & Estate
// (hidden) and Household (called Locations there); and the AI step told a care
// company to try "add a dentist visit for Mia on the 12th". The selector
// mechanism cannot see any of that, because those steps have real anchors and
// are correctly shown. So the copy branches on ctx.isBusinessSpace explicitly,
// and firstRunTour.test.ts renders every step in both space types and fails on
// any business string naming something a business space does not have.

export interface TourCtx {
  isBusinessSpace: boolean;
  membersCount: number;
  canUseAI: boolean;
  hubName: string;
}

export interface TourStepDef {
  id: string;
  /** CSS selector for the element to spot-light. Omit for a centered, unanchored slide. */
  selector?: string;
  /** If the selector doesn't resolve, show this step centered instead of dropping it (used for the one step whose copy still makes sense without a live anchor — e.g. the AI bubble when AI is off). Default: drop the step entirely when the selector is missing. */
  anchorOptional?: boolean;
  title: (ctx: TourCtx) => string;
  body: (ctx: TourCtx) => string;
  /**
   * Present = render this step as the black hero card (StepHero, shared with
   * the guided setup) instead of quiet text on the white card.
   *
   * Only the two UNANCHORED steps set it. An anchored step already has the
   * eye's attention pinned by the spotlight cut into the backdrop; a heavy
   * black card next to it competes for that attention, which is precisely
   * what a "look at THIS control" step must not do. The opening and closing
   * slides have nothing to point at, so the card IS the thing to look at.
   */
  hero?: { icon: React.ComponentType<{ className?: string }>; tone: HeroTone; eyebrow: string };
}

export const STEPS: TourStepDef[] = [
  {
    id: 'welcome',
    hero: { icon: Sparkles, tone: 'clay', eyebrow: 'QUICK TOUR' },
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
        ? ctx.isBusinessSpace
          ? 'Add whoever this is for — Teluva builds out their whole record as you go: role, documents, certificates and the dates they run out. Nothing needs to be perfect on day one.'
          : 'Add whoever this is for — Teluva builds out their whole profile as you go: sizes, documents, medical, the lot. Nothing needs to be perfect on day one.'
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
        ? ctx.isBusinessSpace
          ? 'See the sparkle bubble? Tell it what happened — “the first-aid refresher was renewed on the 12th” — or drop in a photo of the certificate, and it drafts the change. You always get the final tap before anything saves.'
          : 'See the sparkle bubble? Tell it what happened — “add a dentist visit for Mia on the 12th” — or drop in a photo of a form, and it drafts the change. You always get the final tap before anything saves.'
        : ctx.isBusinessSpace
          ? 'In Documents and Compliance, the camera icon reads what you point it at — a certificate, an ID, an expiry date — and fills the form in for you. Nothing saves until you confirm. (There is a chattier AI assistant too, off by default — turn it on in Settings if you want it.)'
          : 'In Documents, Sizes and Growth, the camera icon reads what you point it at — a passport, a shoe size, a height chart — and fills the form in for you. Nothing saves until you confirm. (There is a chattier AI assistant too, off by default — turn it on in Settings if you want it.)',
  },
  {
    id: 'everywhere-else',
    selector: '[data-tour="section-menu"]',
    title: () => 'Everything else lives here',
    body: (ctx) =>
      (ctx.isBusinessSpace
        ? 'Documents, Locations, Finances, Compliance, Vehicles, and the rest of it'
        : 'Documents, Household, Money, Wills & Estate, Vehicles, and the rest of it') +
      " — one button, no hunting around. Calendar can sync straight to your phone's own calendar app, both ways, and Drive brings in files you already have without handing over your whole Google account.",
  },
  {
    id: 'data-controls',
    selector: '[data-tour="data-controls"]',
    title: () => "It's genuinely yours",
    body: (ctx) =>
      `Tap ${ctx.hubName} up here any time — a full backup, and leaving whenever you like, both live behind it. Nothing here holds your data hostage.`,
  },
  {
    id: 'closing',
    hero: { icon: Compass, tone: 'sage', eyebrow: 'TOUR DONE' },
    title: () => "That's the tour",
    body: (ctx) =>
      ctx.isBusinessSpace
        ? "There's more waiting to be found — certificates and renewal dates that surface on the home screen before they lapse, receipts with their return-by and warranty dates, vehicles with their service history, and a chat that keeps the team's decisions in one place. You'll bump into them. Find this tour again any time from Hub settings."
        : "There's more waiting to be found — a family quiz, a growing-up video, a recipe book, a travel timeline, the things people said that you never want to forget. You'll bump into them. Find this tour again any time from Hub settings.",
  },
];
