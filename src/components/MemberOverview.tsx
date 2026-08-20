import {
  AlertTriangle, GraduationCap, Phone, Mail, MapPin, Bell, Sparkles, IdCard, Lock, Stethoscope, Dices, RefreshCw,
} from 'lucide-react';
import { useState, useEffect, type ElementType, useMemo } from 'react';
import { FamilyMember, FamilyDocument, SurnameMeaning } from '../types';
import { soonestCare, careDueLabel } from '../utils/care';
import { sunSign, elementTint } from '../utils/astrology';
import { computeBirthChart } from '../utils/birthChart';
import { isHintSeen, markHintSeen, loadSpaceInfo, loadFamilyInfo } from '../utils/db';
import { formatNameDay } from '../utils/nameDay';
import { resolveCelebrations, suggestLocal, daysUntilCelebration } from '../utils/nameCelebrations';
import { meaningsFor, roleLabel, confidenceLabel } from '../utils/nameMeanings';
import MemberBelongings from './MemberBelongings';
import ShowCardModal, { type ShowCardField } from './ShowCardModal';

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
  canEdit = false,
  showAstrology = false,
  onShuffleAstrology,
  astrologyBlurb,
  astrologyCappedToday = false,
  onSetNameDay,
}: {
  member: FamilyMember;
  canEdit?: boolean;
  showAstrology?: boolean;
  /** Present only when the viewer is allowed to (re-)generate an AI blurb — omitted hides the shuffle button. */
  onShuffleAstrology?: () => void;
  astrologyBlurb?: { text: string; loading: boolean; error: string | null };
  /** True once today's insight has already been generated for these inputs — one per member per local day. */
  astrologyCappedToday?: boolean;
  /** Store a Namenstag ('MM-DD' + the feast it belongs to). Omitted = read-only viewer, so no "add" offer is drawn. */
  onSetNameDay?: (date: string, feast?: string) => void;
}) {
  // First-time discovery nudge for the dice icon — dismissed for good the
  // first time it's actually clicked, per device/space (isHintSeen/db.ts).
  const [diceHintSeen, setDiceHintSeen] = useState(() => isHintSeen('astrology_dice'));
  // The one full-screen scan viewer used everywhere a saved document can be
  // opened from this app (see MemberIDs.tsx) — a thumbnail here opens it
  // rather than the older bare-image lightbox, for the same reason: one
  // viewer, richer than a plain photo, not three different click targets.
  const [showCard, setShowCard] = useState<{ title: string; subtitle?: string; fields: ShowCardField[]; scanSrc?: string } | null>(null);
  // families/{id}/info/info.suppressReligiousSuggestions — a family that
  // turned this off must not see the Austrian Namenskalender nudge here
  // either, not only in the editor. Loaded once per member shown, not on
  // every render. null = not yet known, and no suggestion is drawn until it
  // is: a false default would flash a tappable saint's-day offer at a family
  // that switched saint suggestions off, for as long as the read takes.
  const [suppressReligious, setSuppressReligious] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadSpaceInfo().then((info) => { if (!cancelled) setSuppressReligious(!!info?.suppressReligiousSuggestions); });
    return () => { cancelled = true; };
  }, [member.id]);
  // Family-name meanings live once per space, not on the member — so the card
  // below needs the shared document as well as the member. Same shape as the
  // space-info read above; db.ts serves it from the local cache, so this is not
  // a network round-trip per profile view.
  const [surnameMeanings, setSurnameMeanings] = useState<SurnameMeaning[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadFamilyInfo()
      .then((info) => { if (!cancelled) setSurnameMeanings(info?.surnameMeanings || []); })
      .catch(() => { /* offline: given names still show, the family name simply doesn't */ });
    return () => { cancelled = true; };
  }, [member.id]);
  const meanings = meaningsFor(member, surnameMeanings);
  const zodiac = showAstrology ? sunSign(member.birthdate) : null;
  // The real positions, plus what is and isn't knowable from what's on file.
  const chart = useMemo(() => computeBirthChart({
    birthdate: member.birthdate,
    birthTime: member.birthTime,
    birthTimeZone: member.birthTimeZone,
    birthLatitude: member.birthLatitude,
    birthLongitude: member.birthLongitude,
  }), [member.birthdate, member.birthTime, member.birthTimeZone, member.birthLatitude, member.birthLongitude]);
  const first = member.name.split(/\s+/)[0] || member.name;
  const med = member.medical || {};
  const docCount = member.documents?.length || 0;
  const age = calcAge(member.birthdate);
  const expiry = nearestExpiry(member);

  const care = soonestCare(member.careSchedule);
  const showCare = care && (care.due.status === 'overdue' || care.due.status === 'due-soon');

  // Name Days & Name Celebrations. resolveCelebrations merges the legacy
  // Namenstag pair with anything confirmed since, so a family that confirmed
  // a Name Celebration (Shyam, Ganga — outside the Austrian calendar) sees it
  // here too, not only in the calendar and the daily cron. suggestLocal is
  // the offer, never conflated with the confirmed primary, and already
  // returns null once anything is confirmed — see utils/nameCelebrations.ts.
  const celebrations = resolveCelebrations(member);
  const suggestion = suppressReligious === null
    ? null
    : suggestLocal(member, { suppressReligiousSuggestions: suppressReligious });

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
                {r.viewSrc && (
                  <button
                    onClick={() => setShowCard({
                      title: 'Proof of address',
                      subtitle: member.name,
                      fields: [{ label: r.label, value: r.value }],
                      scanSrc: r.viewSrc,
                    })}
                    className="shrink-0 w-8 h-8 rounded-lg overflow-hidden border border-cream-200 bg-cream-50"
                    title="View proof of address"
                  >
                    <img src={r.viewSrc} alt="" className="w-full h-full object-cover" />
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

      {/* Name Days & Name Celebrations. A confirmed primary (legacy Namenstag
          OR anything confirmed via the newer flow — Shyam's Nityananda
          Trayodashi is exactly as real here as Josef's 19 March) reads as a
          fact; an unconfirmed local match reads as an offer with the source
          named so it can be checked. A member with neither draws nothing here
          — see utils/nameCelebrations.ts. Full editing (additional
          celebrations, notify, remove) lives in Edit, not this glance card. */}
      {celebrations.primary && (
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-sage-50 flex items-center justify-center text-xl shrink-0" aria-hidden="true">
            {celebrations.primary.kind === 'name_day' ? '💐' : '🎊'}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wider">
                {celebrations.primary.kind === 'name_day' ? 'Name day' : 'Name celebration'}
              </p>
              {celebrations.additional.length > 0 && (
                <span className="text-[10.5px] font-semibold text-ink-300">+{celebrations.additional.length} more</span>
              )}
            </div>
            <p className="text-[14px] font-semibold text-ink-800">
              {celebrations.primary.title}
              {celebrations.primary.dateType === 'fixed' && (
                <span className="text-ink-400 font-normal"> · {formatNameDay(celebrations.primary.date)}</span>
              )}
            </p>
            {(() => {
              const { days } = daysUntilCelebration(celebrations.primary!);
              if (days === null) return null;
              return <p className="text-[12.5px] text-ink-500">{days === 0 ? 'Today 🎉' : days === 1 ? 'Tomorrow' : `In ${days} days`}</p>;
            })()}
          </div>
        </div>
      )}
      {/* What the names mean. Every row wears its confidence — the hedge is
          load-bearing, not decoration: a derivation shown flat is the app
          asserting folk etymology as fact about someone's own family. A member
          with nothing kept draws nothing, and there is no offer to research
          from here: that costs an AI call and belongs behind Edit, where the
          person deciding is the person who opened the editor. */}
      {meanings.length > 0 && (
        <div className="card p-4">
          <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wider">What the names mean</p>
          <div className="mt-2 space-y-2">
            {meanings.map((m) => (
              <div key={m.id}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-[14px] font-semibold text-ink-800">{m.token}</p>
                  <span className="text-[10.5px] font-semibold text-ink-300">{roleLabel(m.role)}</span>
                  {/* Only the two uncertain states are chipped. 'Well
                      established' would be a badge on almost every row, which
                      is how a hedge stops being read at all — the absence of a
                      chip is what says "no caveat here". */}
                  {m.confidence !== 'established' && (
                    <span className={`chip ${m.confidence === 'contested' ? 'bg-honey-100 text-honey-800' : 'bg-cream-200 text-ink-600'}`}>
                      {confidenceLabel(m.confidence)}
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-ink-600 leading-snug">
                  {m.meaning}{m.origin ? <span className="text-ink-400"> · {m.origin}</span> : null}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!celebrations.primary && suggestion && suggestion.matchType !== 'second_name' && onSetNameDay && (
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-cream-100 flex items-center justify-center text-xl shrink-0" aria-hidden="true">💐</div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wider">Name day</p>
            {/* The suggestion's own explanation, not a generic "<name> falls
                on <date>" line: for a variant match (an alias or nickname
                hit) the generic line hid WHICH token matched and that the
                connection is approximate — and an approximate match must be
                explained before it is confirmed, per the spec. */}
            <p className="text-[13px] text-ink-600 leading-snug">{suggestion.explanation}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                type="button"
                onClick={() => onSetNameDay(suggestion.date, suggestion.feast)}
                className="px-3 py-1.5 rounded-xl bg-clay-500 text-white text-[12.5px] font-semibold cursor-pointer hover:bg-clay-600"
              >
                Keep {formatNameDay(suggestion.date)}
              </button>
              {/* Several names genuinely have two days and which one a family
                  keeps is theirs to say, so the alternative is offered as an
                  equal choice rather than hidden behind an edit screen. */}
              {suggestion.alsoOn && (
                <button
                  type="button"
                  onClick={() => onSetNameDay(suggestion.alsoOn!.date, suggestion.alsoOn!.feast)}
                  className="px-3 py-1.5 rounded-xl bg-cream-200 text-ink-700 text-[12.5px] font-semibold cursor-pointer hover:bg-cream-300"
                >
                  Or {formatNameDay(suggestion.alsoOn.date)} ({suggestion.alsoOn.feast})
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* A second-name match (e.g. Rory -> his second name Michael, 29 Sept)
          is never offered as a one-tap "Keep" here: this card can only write
          the legacy nameDay/nameDayFeast pair, which has no field for WHICH
          name a day belongs to — a one-tap keep would silently present
          Michael's day as Rory's own, exactly what this feature exists to
          prevent. Confirming it correctly (attributed to the second name)
          happens in Edit, where the full NameCelebration record is built. */}
      {!celebrations.primary && suggestion && suggestion.matchType === 'second_name' && (
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-cream-100 flex items-center justify-center text-xl shrink-0" aria-hidden="true">💐</div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wider">Name day</p>
            <p className="text-[13px] text-ink-600 leading-snug">{suggestion.explanation}</p>
            <p className="text-[12px] text-ink-400 mt-1">Open Edit to confirm {suggestion.token}&rsquo;s day.</p>
          </div>
        </div>
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
                    if (astrologyCappedToday) return;
                    onShuffleAstrology();
                  }}
                  disabled={astrologyBlurb?.loading}
                  className="relative shrink-0 p-1 -m-1 text-clay-500 hover:text-clay-700 disabled:opacity-50 cursor-pointer"
                  title={astrologyCappedToday ? "That's today's insight — there'll be a new one tomorrow" : astrologyBlurb?.text ? 'Shuffle for a new one' : 'Get an AI-written version'}
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

            {/* Sun, Moon and Rising — computed from the actual positions rather
                than a date table, which is why each one can say "I don't know".
                See utils/birthChart.ts: the three need very different amounts
                of information, and the card shows which is missing instead of
                filling the gap with a guess. */}
            <div className="mt-2.5 pt-2.5 border-t border-cream-200 space-y-1">
              {([
                ['Sun', chart.sun],
                ['Moon', chart.moon],
                ['Rising', chart.rising],
              ] as const).map(([label, r]) => (
                <div key={label} className="flex items-baseline gap-2 text-[12px]">
                  <span className="w-12 shrink-0 font-semibold text-ink-400 uppercase tracking-wide text-[10.5px]">{label}</span>
                  {r.certainty === 'exact' && r.sign ? (
                    <span className="font-semibold text-ink-800">{r.sign}</span>
                  ) : r.certainty === 'between' ? (
                    <span className="text-ink-600">
                      <span className="font-semibold text-ink-800">{r.sign}</span> or{' '}
                      <span className="font-semibold text-ink-800">{r.alternative}</span>
                      <span className="text-ink-400"> · add {r.missing} to settle it</span>
                    </span>
                  ) : (
                    <span className="text-ink-400">needs {r.missing}</span>
                  )}
                </div>
              ))}
            </div>
            {astrologyBlurb?.error && <p className="text-[11px] text-rosa-600 mt-0.5">{astrologyBlurb.error}</p>}
            {onShuffleAstrology && astrologyCappedToday && (
              <p className="text-[11px] text-ink-400 mt-1">That's today's insight — there'll be a new one tomorrow.</p>
            )}
            {onShuffleAstrology && !astrologyCappedToday && !diceHintSeen && (
              <p className="text-[11px] text-clay-600 mt-1">Tap the dice for a fresh AI-written version →</p>
            )}
          </div>
        </div>
      )}

      <MemberBelongings memberName={member.name} canEdit={canEdit} />

      <p className="text-center text-[12px] text-ink-400">Tap a tab above to view or edit the full details.</p>

      <ShowCardModal
        open={!!showCard}
        onClose={() => setShowCard(null)}
        title={showCard?.title || ''}
        subtitle={showCard?.subtitle}
        fields={showCard?.fields}
        scanSrc={showCard?.scanSrc}
      />
    </div>
  );
}
