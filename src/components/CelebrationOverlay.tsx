import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { FamilyMember, FamilyInfoDoc, HubSettings, BusinessMilestonesDoc } from '../types';
import { loadSpaceInfo, isHintSeen, markHintSeen, loadSettings, loadBusinessMilestones } from '../utils/db';
import { nextAnniversary, nextMilestoneAnniversary, toISODate } from '../utils/businessMilestone';

// CelebrationOverlay — a once-a-day, in-app confetti moment for the family
// member birthdays that fall TODAY, and, in a business space, the founding
// anniversary, each employee's own work anniversary (member.startDate), and
// owner-defined business milestone anniversaries. Pure client delight:
// localStorage-only, no Firestore writes, no AI. Suppressible per-person
// (FamilyMember.noCelebrations — "no fuss, please") and per-space
// (HubSettings.celebrationsEnabled).
//
// ─────────────────────────────────────────────────────────────────────────
// SAFETY — why this can never fire for someone who has died:
// The ONLY per-person inputs are FamilyMember[] (their `birthdate`/`startDate`,
// real YYYY-MM-DD fields) plus the business space's founding date and its
// BusinessMilestonesDoc (dates the OWNER logged about the company, not a
// person). Deceased relatives are the SEPARATE `DepartedRelative` type, whose
// born/died are FREE TEXT, never dates, and are never read here. So there is
// structurally no code path by which a memorial entry could trigger confetti.
// Do not add one — keep the inputs strictly FamilyMember[] + spaceInfo +
// BusinessMilestonesDoc. (Mirrors the same guarantee in the AI pipelines, see
// the DepartedRelative note in types.ts.)
// ─────────────────────────────────────────────────────────────────────────

const DAY = 1000 * 60 * 60 * 24;

// Day-of-year (0-based, local) — used to pick a one-liner by a STABLE index so
// the message doesn't reshuffle on every re-render, but does rotate day to day.
function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / DAY);
}

// Whole years the member turns today. Safe because this is only called for a
// member whose birthday IS today (month+day already matched), so the simple
// year subtraction is exact — no month/day correction needed.
function ageToday(birthdate: string, today: Date): number {
  const bd = new Date(birthdate);
  return today.getFullYear() - bd.getFullYear();
}

// Kind, faintly silly one-liners. Chosen by a stable index (dayOfYear), never
// random-per-render. {name}/{age} are filled in. Nothing here should land badly
// for any age — no "over the hill", no mortality jokes.
const SINGLE_LINES = [
  '{name} turns {age} today — {age} whole laps around the sun 🎉',
  'Happy birthday, {name} — {age} years of being excellent 🎂',
  "It's {name}'s birthday! {age} today, and only getting better 🥳",
  '{age} candles for {name} today — someone fetch the cake 🎂',
  'Big day for {name} — {age} years young and counting 🎈',
];

// For a newborn's very first birthday-on-file (age 0), the "laps around the
// sun" framing is wrong — give it its own warm line.
const NEWBORN_LINES = [
  "Welcome to the world, {name} — the family's newest arrival 🍼",
  "{name} is here! The whole family's a little bigger today 🎉",
];

function pickLine(lines: string[], seed: number): string {
  return lines[seed % lines.length];
}

function fill(tpl: string, name: string, age: number): string {
  return tpl.replace(/\{name\}/g, name).replace(/\{age\}/g, String(age));
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  size: number; color: string; rot: number; vrot: number;
}

// Canvas fillStyle literals — deliberately NOT Tailwind tokens, so the confetti
// colours can never silently compile to nothing (the token trap). Warm palette
// that matches the app's clay/honey/sage/rosa feel without importing it.
const CONFETTI_COLORS = ['#e8896a', '#f2b705', '#7fa87f', '#e58a9a', '#f4d06f', '#c9633f'];

export default function CelebrationOverlay({ members }: { members: FamilyMember[] }) {
  const [spaceInfo, setSpaceInfo] = useState<FamilyInfoDoc | null>(null);
  const [settings, setSettings] = useState<HubSettings | null>(null);
  const [milestones, setMilestones] = useState<BusinessMilestonesDoc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Load the space doc, hub settings (celebrationsEnabled kill switch) and
  // business milestones ourselves — Dashboard doesn't have any of these in
  // scope (only activeSpaceType from context), so we fetch them like
  // NeedsAttention does. Null-safe: demo/family spaces just yield null and the
  // business-only branches stay off.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadSpaceInfo().catch(() => null),
      loadSettings().catch(() => null),
      loadBusinessMilestones().catch(() => null),
    ]).then(([s, st, ms]) => {
      if (cancelled) return;
      setSpaceInfo(s);
      setSettings(st);
      setMilestones(ms);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Compute today's celebration messages + the space+date-scoped seen key.
  const { messages, hintKey } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const seed = dayOfYear(today);
    // Date-stamped, space-scoped seen flag (hintSeenKey embeds FAMILY_ID). One
    // burst per space per day — opening the app 5×/day won't replay it.
    const key = `celebration_${toISODate(today)}`;

    // Space-level kill switch — HubSettings.celebrationsEnabled, default ON.
    // A space that's turned this off gets NO confetti burst at all today,
    // for anyone or anything.
    if (settings?.celebrationsEnabled === false) return { messages: [], hintKey: key };

    // Family members whose birthday is TODAY (local month+day match), minus
    // anyone who opted out ("no fuss, please" — noCelebrations). This is the
    // ONLY place a person feeds the overlay — strictly FamilyMember.
    const birthdayPeople: { name: string; age: number }[] = [];
    for (const m of members) {
      if (!m.birthdate || m.noCelebrations) continue;
      const bd = new Date(m.birthdate);
      if (isNaN(bd.getTime())) continue;
      if (bd.getMonth() === today.getMonth() && bd.getDate() === today.getDate()) {
        const first = m.name.split(/\s+/)[0] || m.name;
        birthdayPeople.push({ name: first, age: ageToday(m.birthdate, today) });
      }
    }

    const msgs: string[] = [];
    if (birthdayPeople.length === 1) {
      const p = birthdayPeople[0];
      const lines = p.age <= 0 ? NEWBORN_LINES : SINGLE_LINES;
      msgs.push(fill(pickLine(lines, seed), p.name, p.age));
    } else if (birthdayPeople.length > 1) {
      // Multiple birthdays same day → ONE overlay that names them all.
      const names = birthdayPeople.map((p) => p.name);
      const list = names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      msgs.push(`Double celebration — it's ${list}'s birthday today! 🎂🎉`);
    }

    // Business anniversary — business spaces only, and only when the anniversary
    // is literally today (days === 0), reusing NeedsAttention's midnight math.
    if (spaceInfo && spaceInfo.type === 'business' && spaceInfo.foundingDate) {
      const next = nextAnniversary(spaceInfo.foundingDate);
      if (next) {
        const days = Math.round((next.date.getTime() - today.getTime()) / DAY);
        if (days === 0) {
          const name = spaceInfo.name || 'the business';
          msgs.push(`${next.years} ${next.years === 1 ? 'year' : 'years'} of ${name} — the hard part's statistically behind you 🎉`);
        }
      }
    }

    // Work anniversaries — per-employee equivalent of the founding anniversary
    // above, using member.startDate. Same "today only" rule, same noCelebrations
    // opt-out as the birthday loop, and skips a member's very first day
    // (years === 0 isn't an anniversary of anything yet).
    if (spaceInfo && spaceInfo.type === 'business') {
      for (const m of members) {
        if (m.noCelebrations || !m.startDate) continue;
        const next = nextAnniversary(m.startDate);
        if (!next || next.years < 1) continue;
        const days = Math.round((next.date.getTime() - today.getTime()) / DAY);
        if (days !== 0) continue;
        const first = m.name.split(/\s+/)[0] || m.name;
        msgs.push(`${next.years} ${next.years === 1 ? 'year' : 'years'} of ${first} — happy work anniversary! 🎉`);
      }
    }

    // Business milestone anniversary — owner-defined milestones (first
    // customer, new location, certification, revenue target …) resurface on
    // their annual anniversary, same "today only" rule.
    if (spaceInfo && spaceInfo.type === 'business' && milestones?.milestones?.length) {
      const next = nextMilestoneAnniversary(milestones.milestones);
      if (next) {
        const days = Math.round((next.date.getTime() - today.getTime()) / DAY);
        if (days === 0) {
          msgs.push(`${next.years} ${next.years === 1 ? 'year' : 'years'} since "${next.milestone.title}" — worth a moment 🎉`);
        }
      }
    }

    return { messages: msgs, hintKey: key };
  }, [members, spaceInfo, settings, milestones]);

  // Whether to actually show: something to celebrate, not already seen today,
  // not dismissed this session, and the space doc has finished loading (so a
  // slow load can't miss the anniversary).
  const shouldShow = loaded && !dismissed && messages.length > 0 && !isHintSeen(hintKey);

  const reducedMotion = useMemo(
    () => typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // Hand-rolled canvas confetti — ~120 particles, gravity, rotation. Skipped
  // entirely under prefers-reduced-motion (the overlay still shows the warm
  // message as a static banner). Cancelled on dismiss/unmount.
  useEffect(() => {
    if (!shouldShow || reducedMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const N = 120;
    const particles: Particle[] = [];
    for (let i = 0; i < N; i++) {
      particles.push({
        x: W / 2 + (Math.random() - 0.5) * W * 0.4,
        y: H * 0.35 + (Math.random() - 0.5) * 80,
        vx: (Math.random() - 0.5) * 9,
        vy: Math.random() * -11 - 3,
        size: 5 + Math.random() * 7,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.3,
      });
    }

    const GRAVITY = 0.22;
    const start = performance.now();
    const render = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      // Fade the whole burst out over its last second so it doesn't just vanish.
      const elapsed = t - start;
      const alpha = elapsed > 4000 ? Math.max(0, 1 - (elapsed - 4000) / 1000) : 1;
      ctx.globalAlpha = alpha;
      for (const p of particles) {
        p.vy += GRAVITY;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.99;
        p.rot += p.vrot;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (elapsed < 5000) {
        rafRef.current = requestAnimationFrame(render);
      }
    };
    rafRef.current = requestAnimationFrame(render);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [shouldShow, reducedMotion]);

  if (!shouldShow) return null;

  const dismiss = () => {
    // Persist the space+date-scoped seen flag so it never replays today, then
    // hide. Tapping anywhere (backdrop) or the close button both land here.
    markHintSeen(hintKey);
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setDismissed(true);
  };

  return (
    <div
      className="anim-fade fixed inset-0 z-[60] flex items-center justify-center p-6 bg-ink-900/40 backdrop-blur-sm cursor-pointer"
      onClick={dismiss}
      role="dialog"
      aria-label="Celebration"
    >
      {!reducedMotion && (
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 w-full h-full"
        />
      )}
      <div
        className="anim-pop relative card max-w-sm w-full text-center px-7 py-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute top-3 right-3 p-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-cream-100 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="text-5xl mb-3" aria-hidden="true">🎉</div>
        <div className="space-y-2">
          {messages.map((msg, i) => (
            <p key={i} className="font-display text-[17px] font-bold text-ink-900 leading-snug">
              {msg}
            </p>
          ))}
        </div>
        <button
          onClick={dismiss}
          className="mt-6 inline-flex items-center justify-center px-5 py-2 rounded-xl bg-clay-500 hover:bg-clay-600 text-white text-[13.5px] font-semibold transition-colors cursor-pointer"
        >
          🎂 Thanks!
        </button>
      </div>
    </div>
  );
}
