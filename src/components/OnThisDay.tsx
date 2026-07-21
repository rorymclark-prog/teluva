import type { ElementType } from 'react';
import { Calendar, Sparkles, Cake, Ruler, GraduationCap, PartyPopper, Plane, BookOpen, Quote } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { FamilyMember, CalendarEvent, ContactEntry } from '../types';

// "On this day" — the emotional daily hook on the home screen. Pure/presentational:
// everything here is derived from members + events + the current date, no network,
// no persisted state. Re-rendering on a different day naturally surfaces different
// insights, and when there's more to say than fits we rotate the long tail by
// day-of-year so the same 2-4 items don't camp here forever.

type Tone = 'honey' | 'sage' | 'clay' | 'cream';

interface Insight {
  key: string;
  icon: ElementType;
  text: string;
  tone: Tone;
  score: number; // higher = more relevant right now; >=900 is "always shown" territory
}

const DAY = 1000 * 60 * 60 * 24;
const URGENT_SCORE = 900;

const TONE_STYLE: Record<Tone, { wrap: string; icon: string; text: string }> = {
  honey: { wrap: 'bg-honey-50 border-honey-100', icon: 'text-honey-700', text: 'text-honey-900' },
  sage: { wrap: 'bg-sage-50 border-sage-100', icon: 'text-sage-700', text: 'text-sage-700' },
  clay: { wrap: 'bg-clay-50 border-clay-200', icon: 'text-clay-600', text: 'text-clay-700' },
  cream: { wrap: 'bg-cream-100 border-cream-200', icon: 'text-ink-500', text: 'text-ink-700' },
};

const EVENT_META: Record<string, { icon: ElementType; emoji: string }> = {
  Milestone: { icon: PartyPopper, emoji: '🎉' },
  School: { icon: GraduationCap, emoji: '🎓' },
  Travel: { icon: Plane, emoji: '✈️' },
  Other: { icon: Sparkles, emoji: '✨' },
};

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function dayOfYear(d: Date): number {
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / DAY);
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// Builds a same-year occurrence of (month, day). Feb 29 has no representation
// in non-leap years, and the plain Date constructor silently rolls it over to
// Mar 1 — that quietly shifts birthday/anniversary math by a day, so we pin
// the convention explicitly: collapse to Feb 28 in non-leap years.
function occurrenceInYear(year: number, month: number, day: number): Date {
  if (month === 1 && day === 29 && !isLeapYear(year)) {
    return new Date(year, 1, 28);
  }
  return new Date(year, month, day);
}

const SEASONS = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];

function seasonLabel(then: Date, today: Date): string {
  const thenSeason = SEASONS[then.getMonth()];
  if (then.getFullYear() === today.getFullYear()) {
    return thenSeason === SEASONS[today.getMonth()] ? 'a few months ago' : `last ${thenSeason}`;
  }
  return `${thenSeason} ${then.getFullYear()}`;
}

// Birthday today, or coming up within ~10 days. Takes a narrow {id, name,
// birthdate} shape (not the full FamilyMember) so the same date-math serves
// both family members and non-member contacts (e.g. a grandparent) — both
// types already satisfy this shape structurally, no adapting needed at either
// call site.
function birthdayInsight(m: { id: string; name: string; birthdate?: string }, today: Date): Insight | null {
  if (!m.birthdate) return null;
  const bd = new Date(m.birthdate);
  if (isNaN(bd.getTime())) return null;

  const t0 = startOfDay(today);
  let next = occurrenceInYear(t0.getFullYear(), bd.getMonth(), bd.getDate());
  if (next.getTime() < t0.getTime()) next = occurrenceInYear(t0.getFullYear() + 1, bd.getMonth(), bd.getDate());
  const days = Math.round((next.getTime() - t0.getTime()) / DAY);
  if (days > 10) return null;

  const turningAge = next.getFullYear() - bd.getFullYear();
  const first = firstName(m.name);
  const when = days === 0 ? 'today!' : days === 1 ? 'tomorrow' : `in ${days} days`;

  return {
    key: `bday-${m.id}`,
    icon: Cake,
    text: `🎂 ${first} turns ${turningAge} ${when}`,
    tone: 'honey',
    score: 1000 - days * 10,
  };
}

// Growth throwback: newest measurement vs an older one (prefers ~4+ months back so
// the delta is meaningful), for members with at least two logged entries.
function growthInsight(m: FamilyMember, today: Date): Insight | null {
  const hist = (m.growthHistory || [])
    .map((g) => ({ heightCm: g.heightCm, t: new Date(g.date).getTime() }))
    .filter((g) => !isNaN(g.t))
    .sort((a, b) => a.t - b.t);
  if (hist.length < 2) return null;

  const newest = hist[hist.length - 1];
  const minGap = DAY * 120;
  // hist is sorted ascending, so hist[0] is the only candidate that can ever
  // maximize the gap to `newest` — if even that doesn't clear minGap, nothing will.
  const older = hist[0];
  if (older.t === newest.t || newest.t - older.t < minGap) return null;

  const delta = Math.round((newest.heightCm - older.heightCm) * 10) / 10;
  if (delta <= 0) return null;

  const first = firstName(m.name);
  return {
    key: `grow-${m.id}`,
    icon: Ruler,
    text: `📏 ${first} has grown ${delta}cm since ${seasonLabel(new Date(older.t), today)}`,
    tone: 'sage',
    score: 250,
  };
}

// "X years ago today/this week" — a past event landing on, or within a few days
// of, today's month/day. Appointments are deliberately excluded (routine, not memory).
function anniversaryInsight(ev: CalendarEvent, memberById: Map<string, FamilyMember>, today: Date): Insight | null {
  if (ev.category === 'Appointment') return null;
  const d = new Date(ev.date);
  if (isNaN(d.getTime())) return null;

  const t0 = startOfDay(today);
  const occurrence = occurrenceInYear(t0.getFullYear(), d.getMonth(), d.getDate());
  let diff = Math.round((occurrence.getTime() - t0.getTime()) / DAY);
  // occYear tracks which calendar year the *actual* nearest occurrence fell in —
  // keep it in lockstep with diff's own wraparound so yearsAgo stays consistent
  // (e.g. viewing a Dec 30 event on Jan 2 must count from last year, not this one).
  let occYear = t0.getFullYear();
  if (diff > 182) { diff -= 365; occYear -= 1; }
  if (diff < -182) { diff += 365; occYear += 1; }
  if (diff > 0 || diff < -3) return null; // only "today" through "a few days ago"

  const yearsAgo = occYear - d.getFullYear();
  if (yearsAgo < 1) return null;

  const meta = EVENT_META[ev.category] || EVENT_META.Other;
  const names = (ev.memberIds || [])
    .map((id) => memberById.get(id))
    .filter((x): x is FamilyMember => !!x)
    .map((x) => firstName(x.name));
  const who = names.length ? `${names.join(' & ')}: ` : '';
  const when = diff === 0 ? 'today' : `${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} ago`;

  return {
    key: `anniv-${ev.id}`,
    icon: meta.icon,
    text: `${meta.emoji} ${yearsAgo} year${yearsAgo === 1 ? '' : 's'} ago ${when}: ${who}${ev.title}`,
    tone: 'clay',
    score: URGENT_SCORE - Math.abs(diff) * 20,
  };
}

// A saying resurfaced on its anniversary — "N years ago today, X said …". The
// single most delightful thing this card can show, so it scores high. One per
// member (their nearest-to-today, oldest-on-tie match) to avoid flooding.
function sayingInsight(m: FamilyMember, today: Date): Insight | null {
  const sayings = m.sayings || [];
  if (sayings.length === 0) return null;
  const t0 = startOfDay(today);
  const first = firstName(m.name);

  let best: { diff: number; yearsAgo: number; text: string } | null = null;
  for (const s of sayings) {
    if (!s.text || !s.said) continue;
    const d = new Date(s.said);
    if (isNaN(d.getTime())) continue;

    const occurrence = occurrenceInYear(t0.getFullYear(), d.getMonth(), d.getDate());
    let diff = Math.round((occurrence.getTime() - t0.getTime()) / DAY);
    let occYear = t0.getFullYear();
    if (diff > 182) { diff -= 365; occYear -= 1; }
    if (diff < -182) { diff += 365; occYear += 1; }
    if (diff > 0 || diff < -3) continue; // only "today" through a few days ago

    const yearsAgo = occYear - d.getFullYear();
    if (yearsAgo < 1) continue; // a quote from this year isn't a throwback yet

    // pick the closest-to-today; on a tie prefer the oldest (most years ago)
    if (!best || Math.abs(diff) < Math.abs(best.diff) || (diff === best.diff && yearsAgo > best.yearsAgo)) {
      const quote = s.text.length > 90 ? s.text.slice(0, 88).trimEnd() + '…' : s.text;
      const when = diff === 0 ? 'today' : 'this week';
      best = { diff, yearsAgo, text: `💬 ${yearsAgo} year${yearsAgo === 1 ? '' : 's'} ago ${when}, ${first} said: “${quote}”` };
    }
  }
  if (!best) return null;

  return {
    key: `saying-${m.id}`,
    icon: Quote,
    text: best.text,
    tone: 'clay',
    score: URGENT_SCORE + 20 - Math.abs(best.diff) * 20, // today = 920 (always-shown tier)
  };
}

// Fallback when there's nothing dated to celebrate: either a just-added record
// (recent document upload), or, failing that, how long this family's story has
// been kept here at all — computed from the earliest dated evidence we have.
function recordInsight(members: FamilyMember[], events: CalendarEvent[], today: Date): Insight | null {
  const t0 = startOfDay(today).getTime();

  let newestDoc: { t: number; name: string; first: string } | null = null;
  for (const m of members) {
    for (const doc of m.documents || []) {
      const t = new Date(doc.uploadedAt).getTime();
      if (isNaN(t) || t > t0) continue;
      if (!newestDoc || t > newestDoc.t) newestDoc = { t, name: doc.name, first: firstName(m.name) };
    }
  }
  if (newestDoc && t0 - newestDoc.t <= DAY * 5) {
    const days = Math.round((t0 - newestDoc.t) / DAY);
    const when = days <= 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
    return {
      key: 'record-new',
      icon: Sparkles,
      text: `🆕 ${newestDoc.first}'s "${newestDoc.name}" was added ${when}`,
      tone: 'cream',
      score: 100,
    };
  }

  const stamps: number[] = [];
  for (const m of members) {
    for (const doc of m.documents || []) {
      const t = new Date(doc.uploadedAt).getTime();
      if (!isNaN(t)) stamps.push(t);
    }
    for (const g of m.growthHistory || []) {
      const t = new Date(g.date).getTime();
      if (!isNaN(t)) stamps.push(t);
    }
  }
  for (const ev of events) {
    const t = new Date(ev.date).getTime();
    if (!isNaN(t)) stamps.push(t);
  }
  if (stamps.length === 0) return null;

  const earliest = Math.min(...stamps);
  if (earliest > t0) return null;
  const days = Math.round((t0 - earliest) / DAY);
  if (days < 1) return null;
  const years = Math.floor(days / 365);
  const label = years >= 1 ? `${years} year${years === 1 ? '' : 's'}` : `${days} day${days === 1 ? '' : 's'}`;

  return {
    key: 'record-age',
    icon: BookOpen,
    text: `📖 ${label} of family memories kept safe here`,
    tone: 'cream',
    score: 50,
  };
}

// Rank every candidate, always keep "today or very soon" items, and gently rotate
// the long tail by day-of-year so it isn't always the same 2-4 items.
function buildInsights(members: FamilyMember[], events: CalendarEvent[], contacts: ContactEntry[] = []): Insight[] {
  if (members.length === 0 && events.length === 0 && contacts.length === 0) return [];

  const today = new Date();
  const memberById = new Map(members.map((m) => [m.id, m]));

  const candidates: Insight[] = [];
  for (const m of members) {
    const b = birthdayInsight(m, today);
    if (b) candidates.push(b);
    const g = growthInsight(m, today);
    if (g) candidates.push(g);
    const s = sayingInsight(m, today);
    if (s) candidates.push(s);
  }
  for (const c of contacts) {
    const b = birthdayInsight(c, today);
    if (b) candidates.push(b);
  }
  for (const ev of events) {
    const a = anniversaryInsight(ev, memberById, today);
    if (a) candidates.push(a);
  }
  candidates.sort((x, y) => y.score - x.score);

  let picked: Insight[];
  if (candidates.length <= 4) {
    picked = candidates;
  } else {
    const urgent = candidates.filter((c) => c.score >= URGENT_SCORE).slice(0, 4);
    const rest = candidates.filter((c) => c.score < URGENT_SCORE);
    const slots = Math.max(0, 4 - urgent.length);
    const start = rest.length ? dayOfYear(today) % rest.length : 0;
    const rotated = [...rest.slice(start), ...rest.slice(0, start)].slice(0, slots);
    picked = [...urgent, ...rotated];
  }

  if (picked.length === 0) {
    const fallback = recordInsight(members, events, today);
    picked = fallback ? [fallback] : [];
  }

  return picked;
}

export default function OnThisDay({ members, events, contacts }: { members: FamilyMember[]; events: CalendarEvent[]; contacts?: ContactEntry[] }) {
  const items = buildInsights(members, events, contacts);
  if (items.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-cream-200 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-clay-500" />
        <h3 className="font-display text-[15px] font-bold text-ink-900">On this day</h3>
        <Sparkles className="w-3.5 h-3.5 text-honey-700 ml-auto" />
      </div>
      <div className="p-3.5 grid gap-2.5 sm:grid-cols-2">
        <AnimatePresence mode="popLayout">
          {items.map((it, i) => {
            const Icon = it.icon;
            const style = TONE_STYLE[it.tone];
            return (
              <motion.div
                key={it.key}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className={`p-3.5 rounded-2xl border flex items-start gap-3 ${style.wrap}`}
              >
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${style.icon}`} />
                <p className={`text-[13px] font-medium leading-snug ${style.text}`}>{it.text}</p>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
