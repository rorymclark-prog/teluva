import { useEffect, useMemo, useState, type ElementType } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Luggage, Plane, Stamp, Globe, TrainFront, ShieldCheck, IdCard,
  CheckCircle2, AlertTriangle, Clock, Printer, Users,
} from 'lucide-react';
import { FamilyMember, CalendarEvent } from '../types';
import { warmAvatarColor } from '../utils/avatarPalette';

// A document is flagged "expires soon" inside this window — enough runway to
// actually get a renewal appointment before a trip sneaks up on you.
const MONTH_MS = 1000 * 60 * 60 * 24 * 30.4375;
const SOON_MONTHS = 9;

type DocStatus = 'expired' | 'soon' | 'ok' | 'onfile';

interface DocRow {
  key: string;
  icon: ElementType;
  kind: string;
  title: string;
  detail?: string;
  expiryDate?: string;
  status: DocStatus;
}

function statusFor(expiryDate?: string): DocStatus {
  if (!expiryDate) return 'onfile';
  const t = new Date(expiryDate).getTime();
  if (isNaN(t)) return 'onfile';
  const months = (t - Date.now()) / MONTH_MS;
  if (months < 0) return 'expired';
  if (months <= SOON_MONTHS) return 'soon';
  return 'ok';
}

function formatDate(d?: string): string {
  if (!d) return '';
  const t = new Date(d);
  if (isNaN(t.getTime())) return d;
  return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Every travel document we know how to track for a member, flattened into one
// checklist-friendly shape — passports (both the legacy single field and the
// modern multi-passport array), visas, transit passes, insurance, e-card.
function buildDocRows(member: FamilyMember): DocRow[] {
  const rows: DocRow[] = [];

  // MemberIDs.tsx's foldPassports() migrates the legacy single `member.passport`
  // into `member.passports[]` (as id `legacy-<number>`) on first load, but never
  // clears the original field — so once folded, both live on side by side.
  // Mirror foldPassports()'s own dedupe check (match by passport number) so we
  // don't double-render/double-count the same passport.
  const modernPassports = member.passports || [];
  const legacyAlreadyFolded = !!member.passport?.passportNumber
    && modernPassports.some((p) => p.number === member.passport?.passportNumber);

  const passports: { id: string; country?: string; number?: string; expiryDate?: string }[] = [
    ...modernPassports.map((p) => ({ id: p.id, country: p.country, number: p.number, expiryDate: p.expiryDate })),
    ...(member.passport?.passportNumber && !legacyAlreadyFolded
      ? [{ id: 'legacy', country: member.passport.issuingCountry, number: member.passport.passportNumber, expiryDate: member.passport.expiryDate }]
      : []),
  ];
  passports.forEach((p) => {
    rows.push({
      key: `passport-${p.id}`,
      icon: Stamp,
      kind: 'Passport',
      title: `${p.country ? `${p.country} ` : ''}passport`.trim(),
      detail: p.number,
      expiryDate: p.expiryDate,
      status: statusFor(p.expiryDate),
    });
  });

  (member.travel?.visas || []).forEach((v) => {
    rows.push({
      key: `visa-${v.id}`,
      icon: Globe,
      kind: 'Visa',
      title: `${v.country} visa`,
      detail: v.number,
      expiryDate: v.expiryDate,
      status: statusFor(v.expiryDate),
    });
  });

  (member.travel?.transitPasses || []).forEach((p) => {
    rows.push({
      key: `pass-${p.id}`,
      icon: TrainFront,
      kind: 'Transit pass',
      title: p.name,
      detail: p.operator,
      expiryDate: p.validUntil,
      status: statusFor(p.validUntil),
    });
  });

  if (member.travel?.travelInsuranceNumber) {
    rows.push({
      key: 'insurance',
      icon: ShieldCheck,
      kind: 'Travel insurance',
      title: 'Travel insurance',
      detail: member.travel.travelInsuranceNumber,
      status: 'onfile',
    });
  }

  if (member.identity?.eCardNumber) {
    rows.push({
      key: 'ecard',
      icon: IdCard,
      kind: 'e-Card',
      title: 'e-Card (health insurance)',
      detail: member.identity.eCardNumber,
      status: 'onfile',
    });
  }

  return rows;
}

function StatusBadge({ status }: { status: DocStatus }) {
  if (status === 'expired') return <span className="chip bg-rosa-100 text-rosa-700"><AlertTriangle className="w-3 h-3" /> Expired</span>;
  if (status === 'soon') return <span className="chip bg-honey-100 text-honey-700"><Clock className="w-3 h-3" /> Expires soon</span>;
  if (status === 'ok') return <span className="chip bg-sage-100 text-sage-700"><CheckCircle2 className="w-3 h-3" /> Valid</span>;
  return <span className="chip bg-cream-200 text-ink-600"><CheckCircle2 className="w-3 h-3" /> On file</span>;
}

function MemberAvatar({ member, size = 'w-8 h-8 text-[12px]' }: { member: FamilyMember; size?: string }) {
  if (member.avatarUrl) {
    return (
      <div className={`${size} rounded-full overflow-hidden border border-cream-300 shrink-0 bg-white`}>
        <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
      </div>
    );
  }
  return (
    <div className={`${size} rounded-full flex items-center justify-center font-bold text-white shrink-0 uppercase ${warmAvatarColor(member.avatarColor)}`}>
      {member.name.charAt(0).toUpperCase()}
    </div>
  );
}

export default function TravelPack({ members, onClose }: { members: FamilyMember[]; events: CalendarEvent[]; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const memberRows = useMemo(
    () => members.map((m) => ({ member: m, rows: buildDocRows(m) })),
    [members],
  );

  const allRows = useMemo(
    () => memberRows.flatMap(({ member, rows }) => rows.map((r) => ({ ...r, member }))),
    [memberRows],
  );

  const readyCount = allRows.filter((r) => r.status === 'ok' || r.status === 'onfile').length;
  const attentionRows = useMemo(
    () => allRows
      .filter((r) => r.status === 'expired' || r.status === 'soon')
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'expired' ? -1 : 1;
        return new Date(a.expiryDate || 0).getTime() - new Date(b.expiryDate || 0).getTime();
      }),
    [allRows],
  );
  const attentionCount = attentionRows.length;
  const anyExpired = attentionRows.some((r) => r.status === 'expired');

  const visibleMembers = selectedId ? memberRows.filter(({ member }) => member.id === selectedId) : memberRows;

  const bannerTone: 'rosa' | 'honey' | 'sage' = attentionCount === 0 ? 'sage' : anyExpired ? 'rosa' : 'honey';
  const bannerStyle = {
    rosa: 'bg-rosa-50 border-rosa-100 text-rosa-800',
    honey: 'bg-honey-50 border-honey-100 text-honey-900',
    sage: 'bg-sage-50 border-sage-100 text-sage-700',
  }[bannerTone];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[120] flex print:static print:block">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm print:hidden"
        />

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
          className="relative m-auto w-full h-full sm:h-auto sm:max-h-[90dvh] sm:max-w-2xl flex flex-col bg-cream-50 sm:rounded-[28px] border-0 sm:border sm:border-cream-300/60 shadow-2xl overflow-hidden print:static print:max-h-none print:max-w-none print:h-auto print:rounded-none print:border-0 print:shadow-none print:bg-white"
        >
          {/* Header */}
          <div className="flex items-start gap-3 p-5 sm:p-6 pb-4 border-b border-cream-200 shrink-0 print:border-ink-900/20">
            <div className="p-2.5 rounded-2xl bg-dusk-100 text-dusk-700 shrink-0 print:hidden">
              <Luggage className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-xl sm:text-2xl font-bold text-ink-900 leading-tight">Grab &amp; Go Travel Pack</h2>
              <p className="text-[13px] text-ink-500 font-medium mt-0.5">
                Every family member&apos;s travel documents, checked before you fly.
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 print:hidden">
              <button
                onClick={() => window.print()}
                className="btn-quiet text-xs px-3 py-1.5"
                title="Print checklist"
              >
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-full text-ink-400 hover:text-ink-700 hover:bg-cream-100 transition-colors cursor-pointer"
                title="Close"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5 print:overflow-visible print:p-0">
            {members.length === 0 ? (
              <div className="card p-8 sm:p-10 text-center">
                <div className="w-14 h-14 rounded-2xl bg-clay-50 flex items-center justify-center mx-auto mb-4">
                  <Luggage className="w-6 h-6 text-clay-600" />
                </div>
                <p className="text-sm font-semibold text-ink-800">No family members yet</p>
                <p className="text-[13px] text-ink-400 mt-1.5 max-w-sm mx-auto leading-relaxed">
                  Add family members and fill in their passports, visas and insurance details — the travel pack will build itself.
                </p>
              </div>
            ) : (
              <>
                {/* Summary banner */}
                <div className={`p-4 sm:p-5 rounded-2xl border flex items-center gap-3 ${bannerStyle}`}>
                  <div className={`p-2 rounded-xl shrink-0 ${bannerTone === 'sage' ? 'bg-sage-100' : bannerTone === 'honey' ? 'bg-honey-100' : 'bg-rosa-100'}`}>
                    <Plane className="w-4 h-4" />
                  </div>
                  <p className="text-[14px] sm:text-[15px] font-bold leading-snug">
                    {readyCount} document{readyCount === 1 ? '' : 's'} ready · {attentionCount} need{attentionCount === 1 ? 's' : ''} attention
                  </p>
                </div>

                {/* Red flags — fix these before you fly */}
                {attentionCount > 0 && (
                  <div className={`rounded-2xl border overflow-hidden ${anyExpired ? 'bg-rosa-50 border-rosa-100' : 'bg-honey-50 border-honey-100'}`}>
                    <div className={`px-4 sm:px-5 py-3 border-b flex items-center gap-2 ${anyExpired ? 'border-rosa-100' : 'border-honey-100'}`}>
                      <AlertTriangle className={`w-4 h-4 ${anyExpired ? 'text-rosa-600' : 'text-honey-700'}`} />
                      <h3 className={`text-[13px] font-bold ${anyExpired ? 'text-rosa-800' : 'text-honey-900'}`}>
                        Sort these before you fly
                      </h3>
                    </div>
                    <div className={`divide-y ${anyExpired ? 'divide-rosa-100/70' : 'divide-honey-100/70'}`}>
                      {attentionRows.map((r) => {
                        const first = r.member.name.split(/\s+/)[0] || r.member.name;
                        return (
                          <div key={`${r.member.id}-${r.key}`} className="flex items-center gap-3 px-4 sm:px-5 py-2.5">
                            <MemberAvatar member={r.member} size="w-7 h-7 text-[11px]" />
                            <p className={`flex-1 min-w-0 text-[13px] font-medium ${r.status === 'expired' ? 'text-rosa-800' : 'text-honey-900'}`}>
                              <span className="font-bold">{first}</span>&apos;s {r.title.toLowerCase()} {r.status === 'expired'
                                ? `expired ${formatDate(r.expiryDate)}`
                                : `expires ${formatDate(r.expiryDate)}`}
                            </p>
                            <StatusBadge status={r.status} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* People selector */}
                {members.length > 1 && (
                  <div className="flex flex-wrap gap-2 print:hidden">
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className={`shrink-0 flex items-center gap-1.5 pl-2.5 pr-3.5 py-1.5 rounded-full border transition-all cursor-pointer ${
                        selectedId === null ? 'bg-clay-500 border-clay-500 text-white shadow-soft' : 'bg-white border-cream-300 text-ink-700 hover:bg-cream-100'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span className="text-[13px] font-semibold">All</span>
                    </button>
                    {members.map((m) => {
                      const first = m.name.split(/\s+/)[0] || m.name;
                      const memberAttn = (memberRows.find((mr) => mr.member.id === m.id)?.rows || []).filter((r) => r.status === 'expired' || r.status === 'soon').length;
                      const active = selectedId === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setSelectedId((prev) => (prev === m.id ? null : m.id))}
                          className={`shrink-0 flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border transition-all cursor-pointer ${
                            active ? 'bg-clay-500 border-clay-500 text-white shadow-soft' : 'bg-white border-cream-300 text-ink-700 hover:bg-cream-100'
                          }`}
                        >
                          <MemberAvatar member={m} size="w-6 h-6 text-[10px]" />
                          <span className="text-[13px] font-semibold">{first}</span>
                          {memberAttn > 0 && (
                            <span className={`chip ${active ? 'bg-white/25 text-white' : 'bg-rosa-100 text-rosa-700'}`}>{memberAttn}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Per-member checklists */}
                <div className="space-y-4">
                  {visibleMembers.map(({ member, rows }) => {
                    const first = member.name.split(/\s+/)[0] || member.name;
                    const memberAttn = rows.filter((r) => r.status === 'expired' || r.status === 'soon').length;
                    return (
                      <div key={member.id} className="card p-4 sm:p-5 space-y-3 print:break-inside-avoid">
                        <div className="flex items-center gap-3 pb-3 border-b border-cream-200">
                          <MemberAvatar member={member} size="w-9 h-9 text-[13px]" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[15px] font-bold text-ink-900 leading-tight">{member.name}</p>
                            <span className="chip bg-cream-200 text-ink-600 mt-0.5">{member.role}</span>
                          </div>
                          {rows.length > 0 && (
                            memberAttn > 0
                              ? <span className="chip bg-honey-100 text-honey-700 shrink-0">{memberAttn} to review</span>
                              : <span className="chip bg-sage-100 text-sage-700 shrink-0"><CheckCircle2 className="w-3 h-3" /> All set</span>
                          )}
                        </div>

                        {rows.length === 0 ? (
                          <p className="text-[13px] text-ink-400 py-2">
                            Nothing on file for {first} yet — add a passport, visa or travel insurance in their Travel tab.
                          </p>
                        ) : (
                          <div className="divide-y divide-cream-200">
                            {rows.map((r) => {
                              const Icon = r.status === 'expired' ? AlertTriangle : r.status === 'soon' ? Clock : CheckCircle2;
                              const iconStyle = r.status === 'expired'
                                ? 'bg-rosa-100 text-rosa-600'
                                : r.status === 'soon'
                                  ? 'bg-honey-100 text-honey-700'
                                  : r.status === 'ok'
                                    ? 'bg-sage-100 text-sage-700'
                                    : 'bg-cream-200 text-ink-600';
                              return (
                                <div key={r.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                                  <div className={`p-1.5 rounded-lg shrink-0 ${iconStyle}`}>
                                    <Icon className="w-3.5 h-3.5" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="text-[14px] font-semibold text-ink-900">{r.title}</p>
                                      <StatusBadge status={r.status} />
                                    </div>
                                    {r.detail && (
                                      <p className="font-mono tabular-nums text-[12.5px] text-ink-600 break-all mt-0.5">{r.detail}</p>
                                    )}
                                    {r.expiryDate && (
                                      <p className="tabular-nums text-[12px] text-ink-500 mt-0.5">
                                        {r.status === 'expired' ? 'Expired' : 'Expires'} {formatDate(r.expiryDate)}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
