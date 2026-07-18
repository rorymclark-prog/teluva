import {
  AlertTriangle, HeartPulse, Pill, GraduationCap, Phone, Mail, MapPin, Bell, Sparkles, IdCard,
} from 'lucide-react';
import type { ElementType } from 'react';
import { FamilyMember } from '../types';

function calcAge(birthdate?: string): string | null {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  if (age < 2) {
    const months = Math.max(0, Math.round((now.getTime() - b.getTime()) / (1000 * 60 * 60 * 24 * 30.4375)));
    return `${months} mo`;
  }
  return `${age} yrs`;
}

// Soonest-expiring passport, with a status so we can nudge a renewal.
function nearestExpiry(member: FamilyMember): { label: string; date: string; status: 'expired' | 'soon' | 'ok' } | null {
  const items: { label: string; date: string }[] = [];
  (member.passports || []).forEach((p) => { if (p.expiryDate) items.push({ label: `${p.country || ''} passport`.trim(), date: p.expiryDate }); });
  if (member.passport?.expiryDate) items.push({ label: 'Passport', date: member.passport.expiryDate });
  const dated = items.filter((i) => !isNaN(new Date(i.date).getTime()));
  if (!dated.length) return null;
  dated.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const soonest = dated[0];
  const months = (new Date(soonest.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30.4375);
  return { ...soonest, status: months < 0 ? 'expired' : months <= 9 ? 'soon' : 'ok' };
}

export default function MemberOverview({ member }: { member: FamilyMember }) {
  const first = member.name.split(/\s+/)[0] || member.name;
  const med = member.medical || {};
  const docCount = member.documents?.length || 0;
  const age = calcAge(member.birthdate);
  const expiry = nearestExpiry(member);

  const tiles: { label: string; value: string }[] = [];
  if (age) tiles.push({ label: 'Age', value: age });
  if (med.bloodGroup) tiles.push({ label: 'Blood', value: med.bloodGroup });
  if (member.nationality) tiles.push({ label: 'Nationality', value: member.nationality });
  if (docCount) tiles.push({ label: 'Documents', value: `${docCount}` });

  const rows: { icon: ElementType; label: string; value: string; warn?: boolean }[] = [];
  if (med.allergies) rows.push({ icon: AlertTriangle, label: 'Allergies', value: med.allergies, warn: true });
  if (med.conditions) rows.push({ icon: HeartPulse, label: 'Chronic conditions', value: med.conditions });
  if (med.emergencyMedication) rows.push({ icon: Pill, label: 'Emergency medication', value: med.emergencyMedication });
  if (member.role === 'Child' && member.education?.schoolName) rows.push({ icon: GraduationCap, label: 'School', value: member.education.schoolName });
  if (member.phone) rows.push({ icon: Phone, label: 'Phone', value: member.phone });
  if (member.email) rows.push({ icon: Mail, label: 'Email', value: member.email });
  if (member.address) rows.push({ icon: MapPin, label: 'Address', value: member.address });

  const isEmpty = tiles.length === 0 && rows.length === 0 && !expiry;

  if (isEmpty) {
    return (
      <div className="card p-8 sm:p-10 text-center">
        <div className="w-14 h-14 rounded-full bg-cream-100 flex items-center justify-center mx-auto mb-4">
          <IdCard className="w-6 h-6 text-ink-300" />
        </div>
        <p className="text-sm font-semibold text-ink-800">Nothing added for {first} yet</p>
        <p className="text-[13px] text-ink-400 mt-1.5 max-w-sm mx-auto leading-relaxed">
          Use the tabs above to add medical info, IDs &amp; passports, documents and sizes — or tap the
          <span className="inline-flex items-center gap-0.5 text-clay-500 font-semibold"> <Sparkles className="w-3.5 h-3.5" /> assistant</span> and photograph a document to fill it in automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {expiry && expiry.status !== 'ok' && (
        <div className={`p-4 rounded-2xl border flex items-start gap-3 ${expiry.status === 'expired' ? 'bg-rosa-50 border-rosa-100' : 'bg-honey-50 border-honey-100'}`}>
          <Bell className={`w-4 h-4 mt-0.5 shrink-0 ${expiry.status === 'expired' ? 'text-rosa-600' : 'text-honey-700'}`} />
          <p className={`text-[13px] font-medium ${expiry.status === 'expired' ? 'text-rosa-800' : 'text-honey-900'}`}>
            {first}&apos;s {expiry.label} {expiry.status === 'expired' ? 'has expired' : `expires ${expiry.date}`} — worth sorting the renewal.
          </p>
        </div>
      )}

      {tiles.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-2xl border border-cream-200 bg-white p-3.5">
              <p className="text-lg font-bold text-ink-900 truncate">{t.value}</p>
              <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wide">{t.label}</p>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="card divide-y divide-cream-200 overflow-hidden">
          {rows.map((r, i) => {
            const Icon = r.icon;
            return (
              <div key={i} className="flex items-start gap-3 p-3.5">
                <div className={`p-2 rounded-xl shrink-0 ${r.warn ? 'bg-honey-100 text-honey-700' : 'bg-cream-100 text-ink-500'}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wide">{r.label}</p>
                  <p className="text-[14px] text-ink-800 break-words">{r.value}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-center text-[12px] text-ink-400">Tap a tab above to view or edit the full details.</p>
    </div>
  );
}
