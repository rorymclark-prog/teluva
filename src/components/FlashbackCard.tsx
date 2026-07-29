import { useMemo, useState, type ElementType } from 'react';
import { Dices, Quote, Ruler, PartyPopper, GraduationCap, Plane, Sparkles } from 'lucide-react';
import { FamilyMember, CalendarEvent } from '../types';

// A shuffle-on-demand companion to OnThisDay.tsx: that card only ever surfaces
// things within a few days of today's date (a daily digest), so most of a
// family's stored history is never seen again. This pulls a genuinely random
// memory from the FULL history — no date-proximity filter — each dice click.
// No AI call, no server round-trip, no new Firestore fields; pure client-side
// reuse of data shapes OnThisDay.tsx already parses.

interface Memory {
  key: string;
  icon: ElementType;
  text: string;
}

const EVENT_META: Record<string, { icon: ElementType; emoji: string }> = {
  Milestone: { icon: PartyPopper, emoji: '🎉' },
  School: { icon: GraduationCap, emoji: '🎓' },
  Travel: { icon: Plane, emoji: '✈️' },
  Other: { icon: Sparkles, emoji: '✨' },
};

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

function buildMemories(members: FamilyMember[], events: CalendarEvent[]): Memory[] {
  const memories: Memory[] = [];

  for (const m of members) {
    const first = firstName(m.name);

    for (const s of m.sayings || []) {
      if (!s.text) continue;
      const quote = s.text.length > 90 ? s.text.slice(0, 88).trimEnd() + '…' : s.text;
      const said = s.said ? ` (${new Date(s.said).getFullYear()})` : '';
      memories.push({ key: `saying-${m.id}-${s.id}`, icon: Quote, text: `💬 ${first} once said: “${quote}”${said}` });
    }

    const hist = (m.growthHistory || [])
      .map((g) => ({ heightCm: g.heightCm, date: g.date, t: new Date(g.date).getTime() }))
      .filter((g) => !isNaN(g.t))
      .sort((a, b) => a.t - b.t);
    if (hist.length >= 2) {
      const oldest = hist[0];
      const newest = hist[hist.length - 1];
      const delta = Math.round((newest.heightCm - oldest.heightCm) * 10) / 10;
      if (delta > 0) {
        memories.push({
          key: `growth-${m.id}`,
          icon: Ruler,
          text: `📏 ${first} has grown ${delta}cm since ${monthYear(oldest.date)}`,
        });
      }
    }
  }

  for (const ev of events) {
    if (ev.category === 'Appointment') continue; // routine, not memory — same exclusion OnThisDay.tsx uses
    const d = new Date(ev.date);
    if (isNaN(d.getTime())) continue;
    const yearsAgo = new Date().getFullYear() - d.getFullYear();
    if (yearsAgo < 1) continue; // not a throwback yet
    const meta = EVENT_META[ev.category] || EVENT_META.Other;
    const names = (ev.memberIds || [])
      .map((id) => members.find((m) => m.id === id))
      .filter((x): x is FamilyMember => !!x)
      .map((x) => firstName(x.name));
    const who = names.length ? `${names.join(' & ')}: ` : '';
    memories.push({
      key: `event-${ev.id}`,
      icon: meta.icon,
      text: `${meta.emoji} ${yearsAgo} year${yearsAgo === 1 ? '' : 's'} ago: ${who}${ev.title}`,
    });
  }

  return memories;
}

/** "2025-07-28" -> "July 2025". A raw ISO date read as prose is a machine
 *  talking; the exact day adds nothing to "how much they've grown since". */
function monthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function FlashbackCard({ members, events }: { members: FamilyMember[]; events: CalendarEvent[] }) {
  const memories = useMemo(() => buildMemories(members, events), [members, events]);
  /* Derived per render, not seeded once in a useState initialiser. That
     initialiser ran on the FIRST render, when `members` is still empty and
     `memories` therefore has length 0 — so it locked to 0 and, never running
     again, showed the same memory forever. Day-of-year gives a memory that
     changes on its own overnight; `bump` is the dice. Matches the approach
     FamilyWordOfDay already uses. */
  const [bump, setBump] = useState(0);
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const idx = memories.length ? (dayOfYear + bump) % memories.length : 0;

  if (memories.length === 0) return null;

  const current = memories[idx % memories.length];
  const Icon = current.icon;

  const shuffle = () => {
    if (memories.length <= 1) return;
    setBump((b) => b + 1);
  };

  return (
    <div className="card p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-2xl bg-clay-100 text-clay-600 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wider">Flashback</p>
        <p className="text-[13px] font-medium text-ink-800 leading-snug">{current.text}</p>
      </div>
      <button
        type="button"
        onClick={shuffle}
        disabled={memories.length <= 1}
        className="shrink-0 p-1.5 text-clay-500 hover:text-clay-700 rounded-lg hover:bg-clay-50 disabled:opacity-40 cursor-pointer"
        title="Shuffle for another memory"
      >
        <Dices className="w-4 h-4" />
      </button>
    </div>
  );
}
