import React, { useState } from 'react';
import { CalendarEvent, FamilyMember } from '../types';
import { memberAppointments, todayIsoLocal, relativeDayLabel } from '../utils/memberAppointments';
import { resolveEventMembers } from '../utils/eventMemberMatch';
import { buildReferralAppointments, type ReferralAppointment } from '../utils/referralAppointment';
import {
  untaggedMedicalAppointments, suggestAppointmentOwner, readDismissedUntagged, writeDismissedUntagged,
} from '../utils/untaggedAppointments';
import { CalendarClock, ChevronRight, ChevronDown, Clock, Sparkles, FileText } from 'lucide-react';
import { isImportantEvent } from '../utils/importantEvents';
import EmptyState from './EmptyState';
import ImportantChip from './ImportantChip';
import UntaggedAppointmentPrompt from './UntaggedAppointmentPrompt';

interface Props {
  memberId: string;
  memberName: string;
  events: readonly CalendarEvent[];
  /**
   * Everyone in the space. Needed because an appointment imported from Google
   * arrives tagged to nobody, and is matched to a person by name in its title
   * instead — see utils/eventMemberMatch.ts.
   */
  members?: readonly FamilyMember[];
  /** Jump to the shared calendar, where these can actually be edited. */
  onOpenCalendar?: () => void;
  /** 'full' for the Check-ups tab; 'compact' for the pointer block on Medical. */
  variant?: 'full' | 'compact';
  /**
   * Tag one calendar event to one person. When given, upcoming medical-looking
   * appointments tagged to NOBODY are listed here with a "whose is this?"
   * question — see utils/untaggedAppointments.ts. Omit (read-only viewers,
   * the demo) and the question never shows.
   */
  onTagEvent?: (eventId: string, memberId: string) => void;
  /** Signed-in person's member id — highlights their button. Cosmetic only (utils/me.ts). */
  meMemberId?: string;
  /** Active space id, for the per-device "Not now" list. */
  spaceId?: string;
  /** A business space: no automatic "Important" marks (utils/importantEvents.ts). */
  isBusinessSpace?: boolean;
}

// Midday, not midnight: the date is rendered from a YYYY-MM-DD string with no
// time in it, and parsing that as local midnight lands close enough to a DST
// boundary in some zones to display the day before.
const prettyDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });

/**
 * A booked referral appointment — the date lives on the referral (a scanned
 * letter, or the Referrals form), not on the calendar. Shown alongside the
 * calendar ones because "when is my appointment?" doesn't care which record
 * holds the date; buildReferralAppointments already drops any that a real
 * calendar entry covers, so nothing is listed twice.
 */
const ReferralRow: React.FC<{ a: ReferralAppointment; today: string; important?: boolean }> = ({ a, today, important }) => (
  <div className="p-3.5 rounded-2xl border border-cream-200 bg-white flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0 space-y-1">
      <p className="text-[14px] font-semibold text-ink-900">{a.title}</p>
      <p className="text-[12.5px] text-ink-600 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="tabular-nums">{prettyDate(a.date)}</span>
        {a.time && (
          <span className="inline-flex items-center gap-1 text-ink-500">
            <Clock className="w-3 h-3 shrink-0" />
            <span className="tabular-nums">{a.time}</span>
          </span>
        )}
      </p>
      <p className="text-[11.5px] text-ink-400 flex items-center gap-1">
        <FileText className="w-3 h-3 shrink-0" />
        Booked on a referral — change it under Referrals
      </p>
    </div>
    <span className="shrink-0 flex flex-wrap items-center justify-end gap-1.5">
      {important && <ImportantChip />}
      <span className="chip shrink-0 bg-dusk-100 text-dusk-700">{relativeDayLabel(a.date, today)}</span>
    </span>
  </div>
);

/** One appointment. Module-level so React sees a stable component type and doesn't remount every row on each render. */
const Row: React.FC<{ ev: CalendarEvent; today: string; dim?: boolean; byName?: boolean; important?: boolean }> = ({ ev, today, dim, byName, important }) => (
  <div className={`p-3.5 rounded-2xl border bg-white flex flex-wrap items-start justify-between gap-3 ${
    dim ? 'border-cream-200 opacity-70' : 'border-cream-200 hover:border-cream-300 hover:bg-cream-50 transition-colors'
  }`}>
    <div className="min-w-0 space-y-1">
      <p className="text-[14px] font-semibold text-ink-900">{ev.title}</p>
      <p className="text-[12.5px] text-ink-600 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="tabular-nums">{prettyDate(ev.date)}</span>
        {ev.time && (
          <span className="inline-flex items-center gap-1 text-ink-500">
            <Clock className="w-3 h-3 shrink-0" />
            <span className="tabular-nums">{ev.time}</span>
          </span>
        )}
      </p>
      {ev.description && <p className="text-[12px] text-ink-400">{ev.description}</p>}
      {byName && (
        // Say so. This one is here because the title names this person, not
        // because anybody tagged it — the user should be able to tell the
        // difference, and go and correct it on the calendar if it is wrong.
        <p className="text-[11.5px] text-ink-400 flex items-center gap-1">
          <Sparkles className="w-3 h-3 shrink-0" />
          Matched by name — nobody was tagged on the calendar
        </p>
      )}
    </div>
    <span className="shrink-0 flex flex-wrap items-center justify-end gap-1.5">
      {important && <ImportantChip />}
      <span className={`chip shrink-0 ${dim ? 'bg-cream-200 text-ink-500' : 'bg-dusk-100 text-dusk-700'}`}>
        {relativeDayLabel(ev.date, today)}
      </span>
    </span>
  </div>
);

/**
 * A person's real, dated appointments — read from the shared calendar rather
 * than stored again here. See utils/memberAppointments.ts for why this is a
 * view and not a second copy.
 *
 * Read-only on purpose. Editing lives in one place, the calendar, and the
 * button below goes there. An edit form here would be a second write path to
 * the same records, which is exactly the shape of bug this is meant to end.
 */
export default function MemberAppointments({
  memberId, memberName, events, members = [], onOpenCalendar, variant = 'full',
  onTagEvent, meMemberId, spaceId = '', isBusinessSpace = false,
}: Props) {
  const today = todayIsoLocal();
  const { upcoming, past } = memberAppointments(events, memberId, today, members);
  const byName = (ev: CalendarEvent) => !resolveEventMembers(ev, members).explicit;
  // Past rows keep no marker: "important" is about what is still to come.
  const important = (ev: CalendarEvent) => isImportantEvent(ev, { business: isBusinessSpace });
  // A booked referral is a medical visit, so always important — except in a business space.
  const referralImportant = !isBusinessSpace;
  const [showPast, setShowPast] = useState(false);

  // Booked referral appointments for this person (not already on the calendar).
  const referralAppts = buildReferralAppointments(members as FamilyMember[], events, today)
    .filter((a) => a.memberId === memberId);

  // Untagged medical appointments — anyone's, since nobody knows whose yet.
  // This is the screen someone opens asking "why isn't my appointment here?",
  // so the answer ("it's on the calendar, tagged to nobody — tap your name")
  // belongs here as well as on the calendar.
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissedUntagged(spaceId));
  const untagged = onTagEvent ? untaggedMedicalAppointments(events, members, today, dismissed) : [];
  const suggestedOwnerId = suggestAppointmentOwner(members, meMemberId);
  const dismiss = (id: string) => {
    const next = new Set<string>(dismissed);
    next.add(id);
    setDismissed(next);
    writeDismissedUntagged(spaceId, next);
  };
  const untaggedBlock = untagged.length > 0 && onTagEvent ? (
    <div className="space-y-2">
      <p className="text-[12px] font-semibold text-ink-500">
        Untagged appointments — whose is this?
      </p>
      {untagged.slice(0, 5).map((ev) => (
        <UntaggedAppointmentPrompt
          key={ev.id}
          showTitle
          eventTitle={ev.title}
          eventDetail={[prettyDate(ev.date), ev.time].filter(Boolean).join(' · ')}
          members={members}
          suggestedMemberId={suggestedOwnerId}
          onTag={(mid) => onTagEvent(ev.id, mid)}
          onDismiss={() => dismiss(ev.id)}
        />
      ))}
      {untagged.length > 5 && (
        <p className="text-[12px] text-ink-400">and {untagged.length - 5} more on the calendar.</p>
      )}
    </div>
  ) : null;

  // The Medical tab's version: enough to answer "is there anything coming
  // up?", and a route to the rest. Silent when there is nothing, so it never
  // adds an empty box to a screen that is already long.
  if (variant === 'compact') {
    if (!upcoming.length && !referralAppts.length && !untaggedBlock) return null;
    return (
      <section className="card p-5 space-y-3">
        <div className="flex items-center justify-between pb-3 border-b border-cream-200">
          <h4 className="section-label flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5" /> Upcoming appointments
          </h4>
          {onOpenCalendar && (
            <button onClick={onOpenCalendar} className="btn-quiet text-xs px-2.5 py-1">
              Calendar <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {(upcoming.length > 0 || referralAppts.length > 0) && (
          <div className="space-y-2.5">
            {upcoming.slice(0, 3).map(ev => <Row key={ev.id} ev={ev} today={today} byName={byName(ev)} important={important(ev)} />)}
            {referralAppts.slice(0, 3).map(a => <ReferralRow key={a.referralId} a={a} today={today} important={referralImportant} />)}
          </div>
        )}
        {untaggedBlock}
        {upcoming.length > 3 && (
          <p className="text-[12px] text-ink-400">
            and {upcoming.length - 3} more &mdash; see Check-ups.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-cream-200">
        <h4 className="section-label flex items-center gap-1.5">
          <CalendarClock className="w-3.5 h-3.5" /> Booked appointments
        </h4>
        {onOpenCalendar && (
          <button onClick={onOpenCalendar} className="btn-quiet text-xs px-2.5 py-1">
            Calendar <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {upcoming.length === 0 && referralAppts.length === 0 ? (
        <EmptyState
          size="sm"
          title={`Nothing booked for ${memberName}. Appointments added on the calendar — or just told to the assistant — show up here.`}
        />
      ) : (
        <div className="space-y-2.5">
          {upcoming.map(ev => <Row key={ev.id} ev={ev} today={today} byName={byName(ev)} important={important(ev)} />)}
          {referralAppts.map(a => <ReferralRow key={a.referralId} a={a} today={today} important={referralImportant} />)}
        </div>
      )}

      {untaggedBlock}

      {past.length > 0 && (
        <div className="pt-1">
          <button
            onClick={() => setShowPast(v => !v)}
            className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-500 hover:text-ink-800 cursor-pointer"
            aria-expanded={showPast}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showPast ? 'rotate-180' : ''}`} />
            {showPast ? 'Hide' : 'Show'} {past.length} past appointment{past.length === 1 ? '' : 's'}
          </button>
          {showPast && (
            <div className="space-y-2.5 mt-3">
              {past.slice(0, 20).map(ev => <Row key={ev.id} ev={ev} today={today} dim byName={byName(ev)} />)}
              {past.length > 20 && (
                <p className="text-[12px] text-ink-400">
                  Showing the 20 most recent of {past.length}. The rest are on the calendar.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
