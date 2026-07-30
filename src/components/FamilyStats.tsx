import { useEffect, useMemo, useState } from 'react';
import type { ElementType } from 'react';
import {
  X, Sparkles, Printer, Users, Cake, Ruler, Footprints, Globe2, FileStack,
  CalendarHeart, TrendingUp, Baby, Award, PartyPopper,
} from 'lucide-react';
import { motion } from 'motion/react';
import { FamilyMember, CalendarEvent } from '../types';
import { warmAvatarColor } from '../utils/avatarPalette';
import EmptyState from './EmptyState';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

// ── Small, dependency-free helpers (this file owns all its own math) ───────

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

function ageYearsFloat(birthdate?: string): number | null {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (isNaN(b.getTime())) return null;
  const diffMs = Date.now() - b.getTime();
  if (diffMs < 0) return null;
  return diffMs / (1000 * 60 * 60 * 24 * 365.2425);
}

function ageLabel(birthdate?: string): string | null {
  const yrs = ageYearsFloat(birthdate);
  if (yrs === null) return null;
  if (yrs < 2) {
    const months = Math.max(0, Math.round(yrs * 12));
    // yrs < 2 caps months at 24 (round(<24) never exceeds 24), so hitting the
    // cap always means "2 yrs" — never derive this from Math.floor(yrs), which
    // would wrongly read back as "1 yrs" for yrs just under 2.
    if (months >= 24) return '2 yrs';
    return `${months} mo`;
  }
  return `${Math.floor(yrs)} yrs`;
}

function daysUntilNextBirthday(birthdate?: string): { days: number; dateLabel: string } | null {
  if (!birthdate) return null;
  // Parse the date-only YYYY-MM-DD string by its calendar components rather than
  // letting `new Date(string)` interpret it as a UTC instant — that would then get
  // read back with local getMonth()/getDate(), shifting the day in western timezones.
  const [by, bm, bd] = birthdate.split('-').map(Number);
  if (!by || !bm || !bd) return null;
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), bm - 1, bd);
  if (next < todayMid) next = new Date(now.getFullYear() + 1, bm - 1, bd);
  const days = Math.round((next.getTime() - todayMid.getTime()) / (1000 * 60 * 60 * 24));
  const dateLabel = next.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { days, dateLabel };
}

function parseLeadingNumber(s?: string): number | null {
  if (!s) return null;
  const m = s.match(/(\d+(\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return isNaN(n) ? null : n;
}

function splitList(s?: string): string[] {
  if (!s) return [];
  return s.split(/[,/&]|(?:\band\b)/i).map((x) => x.trim()).filter(Boolean);
}

function uniqueCaseInsensitive(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const k = it.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(it); }
  }
  return out;
}

function latestHeightCm(member: FamilyMember): number | null {
  const hist = member.growthHistory;
  if (hist && hist.length) {
    const sorted = [...hist].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const h = sorted[0]?.heightCm;
    if (typeof h === 'number' && !isNaN(h)) return h;
  }
  return parseLeadingNumber(member.clothingSizes?.heightCm);
}

const COUNTRY_FLAGS: Record<string, string> = {
  austria: '🇦🇹', 'south africa': '🇿🇦', sa: '🇿🇦',
  germany: '🇩🇪', deutschland: '🇩🇪',
  'united kingdom': '🇬🇧', uk: '🇬🇧', britain: '🇬🇧', england: '🇬🇧',
  'united states': '🇺🇸', usa: '🇺🇸', 'united states of america': '🇺🇸', america: '🇺🇸',
  france: '🇫🇷', italy: '🇮🇹', spain: '🇪🇸', portugal: '🇵🇹', switzerland: '🇨🇭',
  netherlands: '🇳🇱', holland: '🇳🇱', belgium: '🇧🇪', ireland: '🇮🇪', poland: '🇵🇱',
  'czech republic': '🇨🇿', czechia: '🇨🇿', hungary: '🇭🇺', slovakia: '🇸🇰', slovenia: '🇸🇮',
  croatia: '🇭🇷', greece: '🇬🇷', sweden: '🇸🇪', norway: '🇳🇴', denmark: '🇩🇰', finland: '🇫🇮',
  iceland: '🇮🇸', russia: '🇷🇺', ukraine: '🇺🇦', turkey: '🇹🇷',
  canada: '🇨🇦', mexico: '🇲🇽', brazil: '🇧🇷', argentina: '🇦🇷',
  china: '🇨🇳', japan: '🇯🇵', 'south korea': '🇰🇷', korea: '🇰🇷', india: '🇮🇳',
  australia: '🇦🇺', 'new zealand': '🇳🇿',
  egypt: '🇪🇬', nigeria: '🇳🇬', kenya: '🇰🇪', zimbabwe: '🇿🇼', namibia: '🇳🇦', botswana: '🇧🇼',
  mozambique: '🇲🇿', ghana: '🇬🇭', morocco: '🇲🇦',
  israel: '🇮🇱', 'united arab emirates': '🇦🇪', uae: '🇦🇪',
  'saudi arabia': '🇸🇦', thailand: '🇹🇭', vietnam: '🇻🇳', philippines: '🇵🇭', indonesia: '🇮🇩',
  singapore: '🇸🇬', malaysia: '🇲🇾',
};

function flagFor(country: string): string {
  return COUNTRY_FLAGS[country.trim().toLowerCase()] ?? '🏳️';
}

// Shoe sizes are freeform strings and sizing systems (EU/UK/US) aren't directly
// comparable as raw numbers. Detect a system tag when present; default to EU
// (the common convention for this Austria-based family) when the string is a
// bare, unqualified number so ambiguous entries don't silently corrupt the
// biggest/smallest comparison below.
type ShoeSystem = 'EU' | 'UK' | 'US';

function detectShoeSystem(raw: string): ShoeSystem {
  const s = raw.toLowerCase();
  if (/\buk\b/.test(s)) return 'UK';
  if (/\bus\b/.test(s)) return 'US';
  return 'EU';
}

// ── Presentational bits ─────────────────────────────────────────────────────

type Tone = 'clay' | 'sage' | 'honey' | 'dusk' | 'rosa' | 'ink';

const TONE: Record<Tone, { bg: string; text: string }> = {
  clay: { bg: 'bg-clay-50', text: 'text-clay-600' },
  sage: { bg: 'bg-sage-100', text: 'text-sage-700' },
  honey: { bg: 'bg-honey-50', text: 'text-honey-700' },
  dusk: { bg: 'bg-dusk-50', text: 'text-dusk-700' },
  rosa: { bg: 'bg-rosa-50', text: 'text-rosa-700' },
  ink: { bg: 'bg-cream-100', text: 'text-ink-600' },
};

interface Tile {
  icon: ElementType;
  label: string;
  value: string;
  sublabel?: string;
  tone: Tone;
  key?: number;   // tolerated so `<StatTile key={i} {...t} />` type-checks under the spread
}

function StatTile({ icon: Icon, label, value, sublabel, tone }: Tile) {
  const c = TONE[tone];
  return (
    <div className="rounded-2xl border border-cream-200 bg-white p-4 flex flex-col gap-2.5 hover:border-cream-300 hover:shadow-soft transition-all">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${c.bg} ${c.text}`}>
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-ink-900 leading-tight tabular-nums break-words">{value}</p>
        <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wide mt-0.5">{label}</p>
        {sublabel && <p className="text-[12px] text-ink-500 mt-0.5 leading-snug">{sublabel}</p>}
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function FamilyStats({ members, events, onClose }: {
  members: FamilyMember[];
  events: CalendarEvent[];
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>('all');

  // Parent only mounts this component while the modal should be visible
  // ({showFamilyStats && <FamilyStats .../>}), so it is "always open" while mounted.
  useBodyScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // If the selected member disappears from the family list (removed elsewhere),
  // fall back to "Everyone" instead of silently rendering a blank pane.
  useEffect(() => {
    if (selectedId !== 'all' && !members.some((m) => m.id === selectedId)) {
      setSelectedId('all');
    }
  }, [members, selectedId]);

  const stats = useMemo(() => {
    const withAge = members.filter((m) => ageYearsFloat(m.birthdate) !== null);
    const ages = withAge.map((m) => ageYearsFloat(m.birthdate)!);
    const combinedAges = Math.round(ages.reduce((a, b) => a + b, 0));
    const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;

    let youngest: FamilyMember | null = null;
    let oldest: FamilyMember | null = null;
    withAge.forEach((m) => {
      const t = new Date(m.birthdate!).getTime();
      if (!youngest || t > new Date(youngest.birthdate!).getTime()) youngest = m;
      if (!oldest || t < new Date(oldest.birthdate!).getTime()) oldest = m;
    });

    const childCount = members.filter((m) => m.role === 'Child').length;

    const languages = uniqueCaseInsensitive(members.flatMap((m) => splitList(m.languages)));

    const nationalities = uniqueCaseInsensitive(members.flatMap((m) => splitList(m.nationality)));

    const passportCountries = uniqueCaseInsensitive([
      ...members.flatMap((m) => (m.passports || []).map((p) => p.country)),
      ...members.filter((m) => m.passport?.issuingCountry).map((m) => m.passport!.issuingCountry),
    ]);

    let tallest: { member: FamilyMember; cm: number } | null = null;
    members.forEach((m) => {
      const h = latestHeightCm(m);
      if (h !== null && (!tallest || h > tallest.cm)) tallest = { member: m, cm: h };
    });

    // Only compare shoe sizes within a single detected sizing system (EU/UK/US) —
    // raw numbers across systems aren't on the same scale, so a member whose
    // string tags a different system than the one already established is
    // skipped from this comparison rather than silently mixed in.
    let shoeSystem: ShoeSystem | null = null;
    let biggestShoe: { member: FamilyMember; raw: string; n: number } | null = null;
    let smallestShoe: { member: FamilyMember; raw: string; n: number } | null = null;
    members.forEach((m) => {
      const raw = m.clothingSizes?.shoes;
      const n = parseLeadingNumber(raw);
      if (n === null || !raw) return;
      const sys = detectShoeSystem(raw);
      if (shoeSystem === null) shoeSystem = sys;
      if (sys !== shoeSystem) return;
      if (!biggestShoe || n > biggestShoe.n) biggestShoe = { member: m, raw, n };
      if (!smallestShoe || n < smallestShoe.n) smallestShoe = { member: m, raw, n };
    });

    const docCount = members.reduce((sum, m) => {
      return sum + (m.documents?.length || 0) + (m.passports?.length || 0) + (m.passport ? 1 : 0);
    }, 0);

    let nextBirthday: { member: FamilyMember; days: number; dateLabel: string } | null = null;
    members.forEach((m) => {
      const d = daysUntilNextBirthday(m.birthdate);
      if (d && (!nextBirthday || d.days < nextBirthday.days)) nextBirthday = { member: m, ...d };
    });

    // "On record since": the earliest date this family started leaving a paper trail
    // — first document upload, first growth entry, or first calendar event.
    const candidateDates: string[] = [];
    members.forEach((m) => {
      (m.documents || []).forEach((d) => d.uploadedAt && candidateDates.push(d.uploadedAt));
      (m.growthHistory || []).forEach((g) => g.date && candidateDates.push(g.date));
    });
    events.forEach((e) => e.date && candidateDates.push(e.date));
    let onRecordYears: number | null = null;
    let onRecordSinceLabel: string | null = null;
    const validDates = candidateDates
      .map((d) => new Date(d))
      .filter((d) => !isNaN(d.getTime()) && d.getTime() <= Date.now() && d.getFullYear() > 1990);
    if (validDates.length) {
      const earliest = new Date(Math.min(...validDates.map((d) => d.getTime())));
      onRecordYears = (Date.now() - earliest.getTime()) / (1000 * 60 * 60 * 24 * 365.2425);
      onRecordSinceLabel = earliest.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
    }

    return {
      count: members.length, combinedAges, avgAge, youngest, oldest, childCount,
      languages, nationalities, passportCountries, tallest, biggestShoe, smallestShoe,
      docCount, nextBirthday, onRecordYears, onRecordSinceLabel,
    };
  }, [members, events]);

  const familyTiles: Tile[] = useMemo(() => {
    const t: Tile[] = [];
    t.push({ icon: Users, label: 'Family members', value: `${stats.count}`, tone: 'clay' });
    if (stats.combinedAges > 0) {
      t.push({ icon: TrendingUp, label: 'Combined ages', value: `${stats.combinedAges}`, sublabel: 'years, all added up', tone: 'sage' });
    }
    if (stats.avgAge !== null) {
      t.push({ icon: Cake, label: 'Average age', value: stats.avgAge.toFixed(1), tone: 'honey' });
    }
    if (stats.youngest) {
      t.push({ icon: Baby, label: 'Youngest', value: firstName(stats.youngest.name), sublabel: ageLabel(stats.youngest.birthdate) || undefined, tone: 'dusk' });
    }
    if (stats.oldest && stats.oldest.id !== stats.youngest?.id) {
      t.push({ icon: Award, label: 'Oldest', value: firstName(stats.oldest.name), sublabel: ageLabel(stats.oldest.birthdate) || undefined, tone: 'ink' });
    }
    if (stats.childCount > 0) {
      t.push({ icon: PartyPopper, label: 'Children', value: `${stats.childCount}`, tone: 'rosa' });
    }
    if (stats.languages.length > 0) {
      t.push({ icon: Globe2, label: 'Languages spoken', value: `${stats.languages.length}`, sublabel: stats.languages.join(', '), tone: 'dusk' });
    }
    if (stats.passportCountries.length > 0) {
      t.push({
        icon: Globe2,
        label: 'Passport countries',
        value: stats.passportCountries.map((c) => flagFor(c)).join(' '),
        sublabel: stats.passportCountries.join(', '),
        tone: 'sage',
      });
    } else if (stats.nationalities.length > 0) {
      t.push({
        icon: Globe2,
        label: 'Nationalities in the family',
        value: stats.nationalities.map((c) => flagFor(c)).join(' '),
        sublabel: stats.nationalities.join(', '),
        tone: 'sage',
      });
    }
    if (stats.tallest) {
      t.push({ icon: Ruler, label: 'Tallest', value: `${stats.tallest.cm} cm`, sublabel: firstName(stats.tallest.member.name), tone: 'clay' });
    }
    if (stats.biggestShoe) {
      t.push({ icon: Footprints, label: 'Biggest shoe size', value: stats.biggestShoe.raw, sublabel: firstName(stats.biggestShoe.member.name), tone: 'honey' });
    }
    if (stats.smallestShoe && stats.smallestShoe.member.id !== stats.biggestShoe?.member.id) {
      t.push({ icon: Footprints, label: 'Smallest shoe size', value: stats.smallestShoe.raw, sublabel: firstName(stats.smallestShoe.member.name), tone: 'honey' });
    }
    if (stats.docCount > 0) {
      t.push({ icon: FileStack, label: 'Documents & passports', value: `${stats.docCount}`, sublabel: 'filed and ready', tone: 'dusk' });
    }
    if (stats.nextBirthday) {
      t.push({
        icon: CalendarHeart,
        label: 'Next birthday',
        value: stats.nextBirthday.days === 0 ? 'Today! 🎉' : `${stats.nextBirthday.days}d`,
        sublabel: `${firstName(stats.nextBirthday.member.name)} · ${stats.nextBirthday.dateLabel}`,
        tone: 'rosa',
      });
    }
    if (stats.onRecordYears !== null && stats.onRecordYears >= 0.1) {
      t.push({
        icon: Sparkles,
        label: 'On record since',
        value: stats.onRecordSinceLabel || '—',
        sublabel: `~${stats.onRecordYears.toFixed(1)} years of memories logged`,
        tone: 'clay',
      });
    }
    return t;
  }, [stats]);

  const oneLiners = useMemo(() => {
    const lines: string[] = [];
    if (stats.count > 0 && stats.combinedAges > 0) {
      lines.push(`Together, this family carries ${stats.combinedAges} years of combined life experience across ${stats.count} ${stats.count === 1 ? 'person' : 'people'} — and one shared fridge.`);
    }
    if (stats.passportCountries.length > 1) {
      lines.push(`This household holds passports from ${stats.passportCountries.length} different countries. Truly an international operation.`);
    } else if (stats.nationalities.length > 1) {
      lines.push(`${stats.nationalities.length} nationalities under one roof, and somehow only one Wi-Fi password.`);
    }
    if (stats.languages.length > 1) {
      lines.push(`${stats.languages.length} languages spoken at the dinner table — someone's always translating the jokes.`);
    }
    if (stats.tallest) {
      lines.push(`${firstName(stats.tallest.member.name)} currently holds the family height record at ${stats.tallest.cm} cm. Reigning champion, for now.`);
    }
    if (stats.nextBirthday) {
      lines.push(
        stats.nextBirthday.days === 0
          ? `It's ${firstName(stats.nextBirthday.member.name)}'s birthday today — cake is mandatory.`
          : `Mark the calendar: ${firstName(stats.nextBirthday.member.name)}'s birthday is only ${stats.nextBirthday.days} day${stats.nextBirthday.days === 1 ? '' : 's'} away.`,
      );
    }
    if (stats.onRecordYears !== null && stats.onRecordYears >= 0.1) {
      lines.push(`This family hub has quietly been keeping the receipts for about ${stats.onRecordYears.toFixed(1)} years now.`);
    }
    return lines;
  }, [stats]);

  const selectedMember = selectedId === 'all' ? null : members.find((m) => m.id === selectedId) || null;

  const personTiles: Tile[] = useMemo(() => {
    if (!selectedMember) return [];
    const t: Tile[] = [];
    const age = ageLabel(selectedMember.birthdate);
    if (age) t.push({ icon: Cake, label: 'Age', value: age, tone: 'honey' });
    const nats = splitList(selectedMember.nationality);
    if (nats.length) {
      t.push({ icon: Globe2, label: 'Nationality', value: nats.map((c) => flagFor(c)).join(' '), sublabel: nats.join(', '), tone: 'sage' });
    }
    const langs = splitList(selectedMember.languages);
    if (langs.length) t.push({ icon: Sparkles, label: 'Languages', value: `${langs.length}`, sublabel: langs.join(', '), tone: 'dusk' });
    const h = latestHeightCm(selectedMember);
    if (h !== null) {
      const isTallest = stats.tallest?.member.id === selectedMember.id;
      t.push({ icon: Ruler, label: 'Height', value: `${h} cm`, sublabel: isTallest ? 'Family record holder 🏆' : undefined, tone: 'clay' });
    }
    if (selectedMember.clothingSizes?.shoes) {
      t.push({ icon: Footprints, label: 'Shoe size', value: selectedMember.clothingSizes.shoes, tone: 'honey' });
    }
    if (selectedMember.medical?.bloodGroup) {
      t.push({ icon: Award, label: 'Blood type', value: selectedMember.medical.bloodGroup, tone: 'rosa' });
    }
    const docs = (selectedMember.documents?.length || 0) + (selectedMember.passports?.length || 0) + (selectedMember.passport ? 1 : 0);
    if (docs > 0) t.push({ icon: FileStack, label: 'Documents on file', value: `${docs}`, tone: 'dusk' });
    const bday = daysUntilNextBirthday(selectedMember.birthdate);
    if (bday) {
      t.push({
        icon: CalendarHeart,
        label: 'Next birthday',
        value: bday.days === 0 ? 'Today! 🎉' : `${bday.days}d`,
        sublabel: bday.dateLabel,
        tone: 'rosa',
      });
    }
    return t;
  }, [selectedMember, stats.tallest]);

  const personOneLiner = useMemo(() => {
    if (!selectedMember) return null;
    const first = firstName(selectedMember.name);
    const age = ageLabel(selectedMember.birthdate);
    const bday = daysUntilNextBirthday(selectedMember.birthdate);
    let line = `${first} is ${age ? `${age} old` : 'part of the family'}`;
    if (bday) {
      line += bday.days === 0 ? ' and it is their birthday today!' : ` — next birthday in ${bday.days} day${bday.days === 1 ? '' : 's'}.`;
    } else {
      line += '.';
    }
    return line;
  }, [selectedMember]);

  const isEmpty = members.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-ink-900/40 backdrop-blur-sm p-3 sm:p-6 print:bg-white print:p-0"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-5xl rounded-[28px] overflow-hidden my-2 sm:my-8 print:shadow-none print:border-0 print:rounded-none print:max-w-full"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 sm:p-7 pb-4 sm:pb-5 border-b border-cream-200 bg-gradient-to-br from-cream-50 to-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 text-white shadow-soft bg-gradient-to-br from-clay-500 to-clay-600">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-xl sm:text-2xl font-bold text-ink-900 leading-tight truncate">Family by the numbers</h2>
              <p className="text-[13px] font-medium text-ink-500 mt-0.5">A fun little census of your household</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 print:hidden">
            <button
              onClick={() => window.print()}
              className="p-2.5 rounded-full bg-ink-900/5 text-ink-500 hover:bg-ink-900/10 transition-colors cursor-pointer"
              title="Print"
            >
              <Printer className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              className="p-2.5 rounded-full bg-ink-900/5 text-ink-500 hover:bg-ink-900/10 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5 sm:p-7 max-h-[calc(100dvh-9rem)] sm:max-h-[calc(100dvh-11rem)] overflow-y-auto print:max-h-none print:overflow-visible">
          {isEmpty ? (
            <EmptyState
              icon={Sparkles}
              title="No family members yet"
              description="Add a few people to the hub and this screen fills up with fun facts and family records."
            />
          ) : (
            <>
              {/* People selector */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 print:hidden">
                <button
                  onClick={() => setSelectedId('all')}
                  className={`tab-pill ${selectedId === 'all' ? 'tab-pill-active' : 'bg-cream-100 hover:bg-cream-200'}`}
                >
                  <Users className="w-3.5 h-3.5" /> Everyone
                </button>
                {members.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className={`tab-pill ${selectedId === m.id ? 'tab-pill-active' : 'bg-cream-100 hover:bg-cream-200'}`}
                  >
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white uppercase shrink-0 ${warmAvatarColor(m.avatarColor)}`}>
                      {m.name.charAt(0).toUpperCase()}
                    </span>
                    {firstName(m.name)}
                  </button>
                ))}
              </div>

              {selectedId === 'all' ? (
                <div className="mt-5">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
                    {familyTiles.map((t, i) => <StatTile key={i} {...t} />)}
                  </div>

                  {oneLiners.length > 0 && (
                    <div className="mt-6 space-y-2.5">
                      {oneLiners.map((line, i) => (
                        <div key={i} className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-cream-50 border border-cream-200">
                          <span className="text-base leading-none shrink-0 mt-0.5">✨</span>
                          <p className="text-[13px] sm:text-sm text-ink-700 leading-relaxed">{line}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : selectedMember ? (
                <div className="mt-5">
                  <div className="flex items-center gap-3 mb-4">
                    {selectedMember.avatarUrl ? (
                      <div className="avatar-ring shrink-0">
                        <div className="w-12 h-12 rounded-full overflow-hidden">
                          <img src={selectedMember.avatarUrl} alt={selectedMember.name} className="w-full h-full object-cover" />
                        </div>
                      </div>
                    ) : (
                      <div className="avatar-ring shrink-0">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg text-white uppercase ${warmAvatarColor(selectedMember.avatarColor)}`}>
                          {selectedMember.name.charAt(0).toUpperCase()}
                        </div>
                      </div>
                    )}
                    <div>
                      <h3 className="font-display text-lg font-bold text-ink-900 leading-tight">{selectedMember.nickname || selectedMember.name}</h3>
                      <p className="text-[13px] text-ink-500">{selectedMember.role}</p>
                    </div>
                  </div>

                  {personTiles.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
                      {personTiles.map((t, i) => <StatTile key={i} {...t} />)}
                    </div>
                  ) : (
                    <EmptyState size="sm" title={`Nothing on file for ${firstName(selectedMember.name)} yet.`} />
                  )}

                  {personOneLiner && (
                    <div className="mt-5 flex items-start gap-2.5 p-3.5 rounded-2xl bg-cream-50 border border-cream-200">
                      <span className="text-base leading-none shrink-0 mt-0.5">✨</span>
                      <p className="text-[13px] sm:text-sm text-ink-700 leading-relaxed">{personOneLiner}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[13px] text-ink-400 text-center py-10">
                  This person is no longer in your family list.
                </p>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
