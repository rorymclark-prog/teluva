import { IdCard, HeartPulse, PhoneCall, Car } from 'lucide-react';
import { FamilyMember, Vehicle, SlipItem } from '../types';
import { Nudge, computeNudges, computeVehicleNudges, computeSlipNudges } from '../components/NeedsAttention';
import { vehicleLabel } from './vehicle';

// A deterministic, zero-cost "heads-up" index for the chat: what expires in the
// next ~90 days, and where the family's records have gaps. No AI call — this is
// pure code over the same data buildContext() already loads. It deliberately
// REUSES the expiry logic already living in NeedsAttention (computeNudges /
// computeVehicleNudges / computeSlipNudges) rather than re-deriving any dates —
// their nudge text is already the exact factual style we want ("Papa's Austria
// passport expires in ~5 months"). Only the GAPS below are derived fresh, since
// no existing nudge produces them.

// Key prefixes of the nudges that represent a dated EXPIRY / deadline — as
// opposed to birthdays, growth checks, missing-info prompts, care visits, etc.
// These are the only nudge kinds the heads-up surface treats as "expires soon".
const EXPIRY_PREFIXES = ['exp-', 'id-', 'pass-', 'visa-', 'cvqual-', 'veh-', 'slip-return-', 'slip-warranty-'];
const isExpiryNudge = (n: Nudge) => EXPIRY_PREFIXES.some((p) => n.key.startsWith(p));

export interface ChatInsights {
  expiries: Nudge[]; // dated deadlines within the horizon, soonest first (overdue included)
  gaps: Nudge[];     // records missing a key field
}

// `horizonDays` defaults to 90 — the "next 3 months" Rory asked for. The reused
// compute fns use their own (wider) windows; filtering to <= horizonDays here
// re-tightens them to the heads-up ask without touching their logic.
export function computeChatInsights(
  { members, vehicles, slips }: { members: FamilyMember[]; vehicles: Vehicle[]; slips: SlipItem[] },
  horizonDays = 90,
): ChatInsights {
  const expiries = [
    ...computeNudges(members),
    ...computeVehicleNudges(vehicles),
    ...computeSlipNudges(slips),
  ]
    .filter((n) => isExpiryNudge(n) && n.days != null && n.days <= horizonDays)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  const gaps: Nudge[] = [];
  for (const m of members) {
    const first = m.name.split(/\s+/)[0] || m.name;

    // Passport / ID with a number on file but no expiry date.
    const passports = [
      ...(m.passports || []),
      ...(m.passport?.passportNumber
        ? [{ country: m.passport.issuingCountry || '', number: m.passport.passportNumber, expiryDate: m.passport.expiryDate }]
        : []),
    ];
    for (const p of passports) {
      if (p.number && !p.expiryDate) {
        const label = `${p.country || ''} passport`.trim();
        gaps.push({ key: `gap-passexp-${m.id}-${p.number}`, memberId: m.id, icon: IdCard, tone: 'info', text: `${first}'s ${label} has no expiry date on file`, tab: 'ids' });
      }
    }
    if (m.identity?.residencePermitNumber && !m.identity?.residencePermitExpiry) {
      gaps.push({ key: `gap-permitexp-${m.id}`, memberId: m.id, icon: IdCard, tone: 'info', text: `${first}'s residence permit has no expiry date on file`, tab: 'ids' });
    }

    // No blood type recorded.
    if (!m.medical?.bloodGroup) {
      gaps.push({ key: `gap-blood-${m.id}`, memberId: m.id, icon: HeartPulse, tone: 'info', text: `No blood type recorded for ${first}`, tab: 'medical' });
    }

    // No emergency contact (neither name nor phone).
    if (!m.emergencyContactName && !m.emergencyContactPhone) {
      gaps.push({ key: `gap-emergency-${m.id}`, memberId: m.id, icon: PhoneCall, tone: 'info', text: `No emergency contact for ${first}`, tab: 'overview' });
    }
  }

  // Vehicle with no inspection (§57a / MOT) date on file.
  for (const v of vehicles) {
    if (!v.inspectionExpiry) {
      gaps.push({ key: `gap-veh-inspection-${v.id}`, memberId: '', icon: Car, tone: 'info', text: `${vehicleLabel(v)} has no inspection (§57a/MOT) date on file`, tab: 'vehicles', view: 'vehicles' });
    }
  }

  return { expiries, gaps };
}
