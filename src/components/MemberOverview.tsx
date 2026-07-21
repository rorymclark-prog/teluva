import {
  AlertTriangle, GraduationCap, Phone, Mail, MapPin, Bell, Sparkles, IdCard, Eye, Lock, Stethoscope, Dices, RefreshCw,
} from 'lucide-react';
import { useState, type ElementType } from 'react';
import { FamilyMember, FamilyDocument } from '../types';
import { soonestCare, careDueLabel } from '../utils/care';
import { sunSign, elementTint } from '../utils/astrology';
import { isHintSeen, markHintSeen } from '../utils/db';
import MemberBelongings from './MemberBelongings';

// Proof of address: an ID-category scan named like a Meldezettel / registration
// certificate. Lets us show a "view" icon next to the address.
function findAddressScan(member: FamilyMember): FamilyDocument | undefined {
  return (member.documents || []).find(
    (d) => d.category === 'ID' && d.fileData && /meldezettel|proof of address|registration|anmeldung|residence certificate/i.test(d.name),
  );
}

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

export default function MemberOverview({
  member,
  onViewDocument,
  canEdit = false,
  showAstrology = false,
  onShuffleAstrology,
  astrologyBlurb,
}: {
  member: FamilyMember;
  onViewDocument?: (src: string) => void;
  canEdit?: boolean;
  showAstrology?: boolean;
  /** Present only when the viewer is allowed to (re-)generate an AI blurb — omitted hides the shuffle button. */
  onShuffleAstrology?: () => void;
  astrologyBlurb?: { text: string; loading: boolean; error: string | null };
}) {
  // First-time discovery nudge for the dice icon — dismissed for good the
  // first time it's actually clicked, per device/space (isHintSeen/db.ts).
  const [diceHintSeen, setDiceHintSeen] = useState(() => isHintSeen('astrology_dice'));
  const zodiac = showAstrology ? sunSign(member.birthdate) : null;
  const first = member.name.split(/\s+/)[0] || member.name;
  const med = member.medical || {};
  const docCount = member.documents?.length || 0;
  const age = calcAge(member.birthdate);
  const expiry = nearestExpiry(member);

  const care = soonestCare(member.careSchedule);
  const showCare = care && (care.due.status === 'overdue' || care.due.status === 'due-soon');

  const tiles: { label: string; value: string }[] = [];
  if (age) tiles.push({ label: 'Age', value: age });
  if (med.bloodGroup) tiles.push({ label: 'Blood', value: med.bloodGroup });
  if (member.nationality) tiles.push({ label: 'Nationality', value: member.nationality });
  if (docCount) tiles.push({ label: 'Documents', value: `${docCount}` });

  const rows: { icon: ElementType; label: string; value: string; warn?: boolean; viewSrc?: string }[] = [];
  // Allergies are a genuine safety flag (a babysitter/ER needs them at a glance).
  // Detailed/sensitive medical (chronic conditions, medications) is deliberately
  // NOT shown on this casual default landing — it lives behind the Medical tab.
  if (med.allergies) rows.push({ icon: AlertTriangle, label: 'Allergies', value: med.allergies, warn: true });
  const hasPrivateMedical = !!(med.conditions || med.emergencyMedication || med.medications || med.surgeries);
  if (member.role === 'Child' && member.education?.schoolName) rows.push({ icon: GraduationCap, label: 'School', value: member.education.schoolName });
  if (member.phone) rows.push({ icon: Phone, label: 'Phone', value: member.phone });
  if (member.email) rows.push({ icon: Mail, label: 'Email', value: member.email });
  if (member.address) rows.push({ icon: MapPin, label: 'Address', value: member.address, viewSrc: findAddressScan(member)?.fileData });

  const isEmpty = tiles.length === 0 && rows.length === 0 && !expiry && !hasPrivateMedical && !showCare;

  if (isEmpty) {
    return (
      <div className="card p-8 sm:p-10 text-center">
        <div className="w-14 h-14 rounded-2xl bg-clay-50 flex items-center justify-center mx-auto mb-4">
          <IdCard className="w-6 h-6 text-clay-600" />
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

      {showCare && (
        <div className={`p-4 rounded-2xl border flex items-start gap-3 ${care!.due.status === 'overdue' ? 'bg-rosa-50 border-rosa-100' : 'bg-honey-50 border-honey-100'}`}>
          <Stethoscope className={`w-4 h-4 mt-0.5 shrink-0 ${care!.due.status === 'overdue' ? 'text-rosa-600' : 'text-honey-700'}`} />
          <p className={`text-[13px] font-medium ${care!.due.status === 'overdue' ? 'text-rosa-800' : 'text-honey-900'}`}>
            {first}&apos;s {care!.item.kind} — {careDueLabel(care!.due)}
          </p>
        </div>
      )}

      {tiles.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-2xl border border-cream-200 bg-white p-3.5 hover:bg-cream-50 hover:border-cream-300 transition-colors">
              <p className="text-lg font-bold text-ink-900 truncate tabular-nums">{t.value}</p>
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
              <div key={i} className="flex items-start gap-3 p-3.5 hover:bg-cream-50 transition-colors">
                <div className={`p-2 rounded-xl shrink-0 ${r.warn ? 'bg-honey-100 text-honey-700' : 'bg-cream-100 text-ink-500'}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wide">{r.label}</p>
                  <p className="text-[14px] text-ink-800 break-words tabular-nums">{r.value}</p>
                </div>
                {r.viewSrc && onViewDocument && (
                  <button
                    onClick={() => onViewDocument(r.viewSrc!)}
                    className="shrink-0 flex items-center gap-1 text-[12px] font-semibold text-clay-600 hover:text-clay-700 hover:bg-clay-50 rounded-lg px-2 py-1 transition-colors cursor-pointer"
                    title="View proof of address"
                  >
                    <Eye className="w-3.5 h-3.5" /> Proof
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasPrivateMedical && (
        <p className="flex items-center justify-center gap-1.5 text-[12px] text-ink-400">
          <Lock className="w-3.5 h-3.5" /> Medical details on file — open the <b className="text-ink-500 font-semibold">Medical</b> tab to view.
        </p>
      )}

      {zodiac && (
        <div className="card p-4 flex items-center gap-4">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0 ${elementTint(zodiac.element)}`} aria-hidden="true">{zodiac.symbol}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wider">Star sign · just for fun</p>
              {onShuffleAstrology && (
                <button
                  type="button"
                  onClick={() => {
                    if (!diceHintSeen) { markHintSeen('astrology_dice'); setDiceHintSeen(true); }
                    onShuffleAstrology();
                  }}
                  disabled={astrologyBlurb?.loading}
                  className="relative shrink-0 p-1 -m-1 text-clay-500 hover:text-clay-700 disabled:opacity-50 cursor-pointer"
                  title={astrologyBlurb?.text ? 'Shuffle for a new one' : 'Get an AI-written version'}
                >
                  {astrologyBlurb?.loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Dices className="w-3.5 h-3.5" />}
                  {!diceHintSeen && !astrologyBlurb?.loading && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2" aria-hidden="true">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-clay-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-clay-500" />
                    </span>
                  )}
                </button>
              )}
            </div>
            <p className="text-[14px] font-semibold text-ink-800">{zodiac.sign} <span className="text-ink-400 font-normal">· {zodiac.element}</span></p>
            <p className="text-[12.5px] text-ink-500 leading-snug">
              {astrologyBlurb?.text || `${zodiac.blurb}${member.birthTime ? ` Born ${member.birthTime}${member.placeOfBirth ? ` in ${member.placeOfBirth}` : ''}.` : ''}`}
            </p>
            {astrologyBlurb?.error && <p className="text-[11px] text-rosa-600 mt-0.5">{astrologyBlurb.error}</p>}
            {onShuffleAstrology && !diceHintSeen && (
              <p className="text-[11px] text-clay-600 mt-1">Tap the dice for a fresh AI-written version →</p>
            )}
          </div>
        </div>
      )}

      <MemberBelongings memberName={member.name} canEdit={canEdit} />

      <p className="text-center text-[12px] text-ink-400">Tap a tab above to view or edit the full details.</p>
    </div>
  );
}
