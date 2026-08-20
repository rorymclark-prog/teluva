import React from 'react';

/**
 * The black hero card: a tinted icon badge, a gradient eyebrow, a display
 * title and a paragraph, on ink-900 with an accent circle bleeding off the
 * top-right corner.
 *
 * Shared by the guided setup (FamilyInterview) and the first-run tour
 * (FirstRunTour) so the app's two "here is what this screen is" moments cannot
 * drift apart — they were built a day apart and would have.
 *
 * WHERE IT IS USED IN THE TOUR, AND WHY NOT EVERYWHERE. Five of the tour's
 * seven steps SPOTLIGHT a real control: the backdrop cuts a hole around it and
 * this card sits next to it saying "look at that". A heavy black card beside a
 * spotlit white button competes with the spotlight for the eye, which is the
 * one thing an anchored step must not do. So the tour uses this only on its two
 * unanchored slides — the opening and the closing, which have nothing to point
 * at and are statements rather than directions. The anchored steps stay quiet.
 */
export type HeroTone = 'clay' | 'sage' | 'dusk' | 'rosa' | 'honey';

// Per-step tone colour-coding, recoloured for a dark ground — the 300 steps,
// not the 500s used on white, and a tinted accent circle to match.
//
// The eyebrow deliberately does NOT carry the tone. Rory (2026-08-20, on the
// guided-setup resume card) wanted it bigger and painted with the same
// gradient as the progress bar at the top of that card; that ramp is shared
// across every step, so the badge and the accent circle carry the tone alone.
const TONE_CLASSES: Record<HeroTone, { badge: string; accent: string }> = {
  clay:  { badge: 'bg-clay-500/20 text-clay-300',   accent: 'bg-clay-500/20' },
  sage:  { badge: 'bg-sage-500/20 text-sage-300',   accent: 'bg-sage-500/20' },
  dusk:  { badge: 'bg-dusk-500/20 text-dusk-300',   accent: 'bg-dusk-500/20' },
  rosa:  { badge: 'bg-rosa-500/20 text-rosa-300',   accent: 'bg-rosa-500/20' },
  honey: { badge: 'bg-honey-500/20 text-honey-300', accent: 'bg-honey-500/20' },
};

export default function StepHero({ icon: Icon, tone, eyebrow, title, body, titleId, className = '' }: {
  icon: React.ComponentType<{ className?: string }>;
  tone: HeroTone;
  eyebrow: string;
  title: string;
  body: string;
  /** The id the surrounding dialog points its aria-labelledby at. */
  titleId?: string;
  className?: string;
}) {
  const t = TONE_CLASSES[tone];
  return (
    <div className={`rounded-2xl bg-ink-900 text-white p-4 sm:p-5 overflow-hidden relative ${className}`}>
      <div className={`absolute -right-5 -top-7 w-20 h-20 rounded-full ${t.accent}`} aria-hidden="true" />
      <div className="relative flex items-start gap-3">
        <div className={`w-10 h-10 shrink-0 rounded-2xl flex items-center justify-center ${t.badge}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 pt-0.5">
          {/* .step-eyebrow (index.css) paints itself with a gradient via
              background-clip. NEVER put a text-* utility on it — Tailwind's
              utilities layer sorts after @layer components, so a colour class
              here silently repaints the glyphs opaque and hides the gradient. */}
          <span className="step-eyebrow">{eyebrow}</span>
          {/* Rory (2026-08-20): "should the GUIDED SETUP part be bigger than
              the Welcome back?" — no. The eyebrow says which flow you are in;
              the title is the thing you are being told. Growing the eyebrow to
              13px put them close enough to compete (13/18 = 72%, where an
              eyebrow normally sits nearer 60%), so the fix went on this side:
              the headline of the card that IS the screen was only text-lg.
              text-balance because the wrap left the last word stranded on its
              own line ("…you're partway / through"). */}
          <h3 id={titleId} className="font-display text-xl font-semibold text-white leading-snug text-balance mt-1.5">
            {title}
          </h3>
        </div>
      </div>
      <p className="relative text-[13.5px] text-white/70 leading-relaxed mt-2.5">{body}</p>
    </div>
  );
}
