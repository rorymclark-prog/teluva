import type { ElementType } from 'react';
import { Bell, Cake, Ruler, FileText, HeartPulse, ChevronRight, Sparkles, Stethoscope, TrainFront, IdCard } from 'lucide-react';
import { FamilyMember } from '../types';
import { careNextDue } from '../utils/care';

const DAY = 1000 * 60 * 60 * 24;
const MONTH = DAY * 30.4375;

type Tone = 'urgent' | 'warn' | 'info';
interface Nudge {
  key: string;
  memberId: string;
  icon: ElementType;
  tone: Tone;
  text: string;
  tab: string;
}

// Deterministic, data-derived nudges — no AI, no cost, no new fields.
function computeNudges(members: FamilyMember[]): Nudge[] {
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: Nudge[] = [];

  for (const m of members) {
    const first = m.name.split(/\s+/)[0] || m.name;
    const passports = [
      ...(m.passports || []),
      ...(m.passport?.passportNumber
        ? [{ country: m.passport.issuingCountry || '', number: m.passport.passportNumber, expiryDate: m.passport.expiryDate }]
        : []),
    ];

    // Passport expiry
    for (const p of passports) {
      if (!p.expiryDate) continue;
      const t = new Date(p.expiryDate).getTime();
      if (isNaN(t)) continue;
      const months = (t - now) / MONTH;
      const label = `${p.country || ''} passport`.trim();
      if (months < 0) out.push({ key: `exp-${m.id}-${p.number}`, memberId: m.id, icon: Bell, tone: 'urgent', text: `${first}'s ${label} has expired`, tab: 'ids' });
      else if (months <= 9) out.push({ key: `exp-${m.id}-${p.number}`, memberId: m.id, icon: Bell, tone: 'warn', text: `${first}'s ${label} expires in ~${Math.max(1, Math.round(months))} months`, tab: 'ids' });
    }

    // Has a passport number but no scan filed
    const hasPassport = passports.some((p) => p.number);
    const hasScan = (m.documents || []).some((d) => d.category === 'ID' && /passport/i.test(d.name));
    if (hasPassport && !hasScan) out.push({ key: `scan-${m.id}`, memberId: m.id, icon: FileText, tone: 'info', text: `${first} has a passport but no scan saved`, tab: 'ids' });

    // Upcoming birthday (within 21 days) → wishlist
    if (m.birthdate) {
      const bd = new Date(m.birthdate);
      if (!isNaN(bd.getTime())) {
        const nb = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
        if (nb.getTime() < today.getTime()) nb.setFullYear(today.getFullYear() + 1);
        const days = Math.round((nb.getTime() - today.getTime()) / DAY);
        if (days <= 21) out.push({ key: `bday-${m.id}`, memberId: m.id, icon: Cake, tone: 'info', text: days === 0 ? `It's ${first}'s birthday today! 🎂` : `${first}'s birthday in ${days} day${days !== 1 ? 's' : ''}`, tab: 'favorites' });
      }
    }

    // Growth check for children (>6 months since last, or never)
    if (m.role === 'Child') {
      const times = (m.growthHistory || []).map((l) => new Date(l.date).getTime()).filter((t) => !isNaN(t));
      const last = times.length ? Math.max(...times) : 0;
      const monthsSince = last ? (now - last) / MONTH : Infinity;
      if (monthsSince > 6) out.push({ key: `grow-${m.id}`, memberId: m.id, icon: Ruler, tone: 'info', text: last ? `${first} was last measured ${Math.round(monthsSince)} months ago — measure again?` : `No growth checks for ${first} yet`, tab: 'growth' });
    }

    // Missing medical basics
    const med = m.medical || {};
    if (!med.bloodGroup && !med.allergies && !med.conditions) out.push({ key: `med-${m.id}`, memberId: m.id, icon: HeartPulse, tone: 'info', text: `No medical info for ${first} yet`, tab: 'medical' });

    // Care schedule (dentist, check-ups, vaccinations …) due or overdue
    for (const item of m.careSchedule || []) {
      const due = careNextDue(item, now);
      if (due.status === 'overdue') out.push({ key: `care-${m.id}-${item.id}`, memberId: m.id, icon: Stethoscope, tone: 'urgent', text: `${first}'s ${item.kind} is overdue`, tab: 'care' });
      else if (due.status === 'due-soon') out.push({ key: `care-${m.id}-${item.id}`, memberId: m.id, icon: Stethoscope, tone: 'warn', text: `${first}'s ${item.kind} is due soon`, tab: 'care' });
    }

    // Transit pass expiry (Jahreskarte, Klimaticket, rail passes …)
    for (const pass of m.travel?.transitPasses || []) {
      if (!pass.validUntil) continue;
      const t = new Date(pass.validUntil).getTime();
      if (isNaN(t)) continue;
      const months = (t - now) / MONTH;
      if (months < 0) out.push({ key: `pass-${m.id}-${pass.id}`, memberId: m.id, icon: TrainFront, tone: 'urgent', text: `${first}'s ${pass.name} has expired`, tab: 'travel' });
      else if (months <= 1.5) out.push({ key: `pass-${m.id}-${pass.id}`, memberId: m.id, icon: TrainFront, tone: 'warn', text: `${first}'s ${pass.name} expires soon`, tab: 'travel' });
    }

    // Residence permit & driver's licence expiry
    const idExpiries: Array<{ key: string; expiry?: string; label: string }> = [
      { key: 'permit', expiry: m.identity?.residencePermitExpiry, label: 'residence permit' },
      { key: 'license', expiry: m.identity?.driversLicenseExpiry, label: "driver's licence" },
    ];
    for (const { key, expiry, label } of idExpiries) {
      if (!expiry) continue;
      const t = new Date(expiry).getTime();
      if (isNaN(t)) continue;
      const months = (t - now) / MONTH;
      if (months < 0) out.push({ key: `id-${m.id}-${key}`, memberId: m.id, icon: IdCard, tone: 'urgent', text: `${first}'s ${label} has expired`, tab: 'ids' });
      else if (months <= 2) out.push({ key: `id-${m.id}-${key}`, memberId: m.id, icon: IdCard, tone: 'warn', text: `${first}'s ${label} expires soon`, tab: 'ids' });
    }

    // Visa expiry
    for (const visa of m.travel?.visas || []) {
      if (!visa.expiryDate) continue;
      const t = new Date(visa.expiryDate).getTime();
      if (isNaN(t)) continue;
      const months = (t - now) / MONTH;
      if (months < 0) out.push({ key: `visa-${m.id}-${visa.id}`, memberId: m.id, icon: Bell, tone: 'urgent', text: `${first}'s ${visa.country} visa has expired`, tab: 'travel' });
      else if (months <= 2) out.push({ key: `visa-${m.id}-${visa.id}`, memberId: m.id, icon: Bell, tone: 'warn', text: `${first}'s ${visa.country} visa expires soon`, tab: 'travel' });
    }
  }

  const order: Record<Tone, number> = { urgent: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

const TONE_STYLE: Record<Tone, string> = {
  urgent: 'bg-rosa-100 text-rosa-700',
  warn: 'bg-honey-100 text-honey-700',
  info: 'bg-cream-200 text-ink-500',
};

export default function NeedsAttention({ members, onGo }: { members: FamilyMember[]; onGo: (memberId: string, tab: string) => void }) {
  const all = computeNudges(members);
  if (all.length === 0) return null;
  const shown = all.slice(0, 6);
  const extra = all.length - shown.length;

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-cream-200 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-clay-500" />
        <h3 className="font-display text-[15px] font-bold text-ink-900">Needs attention</h3>
        <span className="chip bg-cream-200 text-ink-600 ml-auto">{all.length}</span>
      </div>
      <div className="divide-y divide-cream-100">
        {shown.map((n) => {
          const Icon = n.icon;
          return (
            <button
              key={n.key}
              onClick={() => onGo(n.memberId, n.tab)}
              className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-cream-50 transition-colors cursor-pointer group"
            >
              <div className={`p-1.5 rounded-lg shrink-0 ${TONE_STYLE[n.tone]}`}>
                <Icon className="w-4 h-4" />
              </div>
              <span className="flex-1 text-[13.5px] text-ink-800 font-medium">{n.text}</span>
              <ChevronRight className="w-4 h-4 text-ink-300 group-hover:text-ink-500 shrink-0" />
            </button>
          );
        })}
      </div>
      {extra > 0 && <p className="px-5 py-2 text-[12px] text-ink-400">+{extra} more</p>}
    </div>
  );
}
