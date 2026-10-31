import { ArrowRight, CalendarDays, CheckCircle2, ClipboardList, FileWarning, Plane, Ruler, Sparkles } from 'lucide-react';
import { CalendarEvent, FamilyAction, FamilyMember, HubStatus } from '../types';
import type { Trip } from '../utils/trip';
import type { ImportantItem } from '../utils/importantEvents';
import ImportantComingUp from './ImportantComingUp';
import { actionCounts, actionDaysUntil, actionOwnerName, sortActions, type ActionPerson } from '../utils/actions';

export interface PulseExpiryWarning {
  memberId: string;
  memberName: string;
  label: string;
  monthsLeft: number;
  status: 'expired' | 'critical';
}

interface FamilyPulseProps {
  members: FamilyMember[];
  events: CalendarEvent[];
  status?: HubStatus;
  familyPhotoUrl?: string;
  expiryWarnings: PulseExpiryWarning[];
  onOpenCalendar: () => void;
  onOpenMemberIds: (memberId: string) => void;
  onOpenPeople: () => void;
  actions?: FamilyAction[];
  actionsLoading?: boolean;
  actionOwners?: readonly ActionPerson[];
  actionDirectoryAvailable?: boolean;
  onOpenActions?: () => void;
  isBusinessSpace?: boolean;

  /** Trips happening now or close enough to prepare for. */
  trips?: Trip[];
  /**
   * The profile belonging to the signed-in account, when it can be resolved
   * (utils/me.ts). Personalisation ONLY — never an access decision.
   */
  me?: FamilyMember | null;
  onOpenTrip?: (tripId: string, memberId?: string) => void;
  /** Open the family photo full size. */
  onViewPhoto?: (url: string) => void;
  /** Important events of the next 30 days (utils/importantEvents.ts). Empty hides the card. */
  importantItems?: readonly ImportantItem[];
}

/**
 * The travel banner's copy, split out so it can be asserted without rendering.
 *
 * Two audiences, one component. If the person reading this is ON the trip, the
 * banner is theirs and speaks in the second person — that is the case where the
 * papers are needed at a desk and the tone should be "here they are". If they
 * are at home while somebody else travels, the same trip is a status update
 * about a person they are worried about, so it leads with the NAME. Same data,
 * opposite emphasis; getting this backwards would give a parent a "your papers"
 * button for a trip they are not on.
 */
export function tripBannerCopy(trip: Trip, me: FamilyMember | null | undefined, members: readonly FamilyMember[]) {
  const viewerIsTravelling = !!me && (trip.memberIds.length === 0 || trip.memberIds.includes(me.id));
  const firstNames = trip.memberIds
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is FamilyMember => !!member)
    .map((member) => member.name.split(' ')[0]);

  const who = viewerIsTravelling
    ? 'You'
    : firstNames.length === 0 ? 'The family'
      : firstNames.length === 1 ? firstNames[0]
        : firstNames.length === 2 ? `${firstNames[0]} and ${firstNames[1]}`
          : `${firstNames.slice(0, -1).join(', ')} and ${firstNames[firstNames.length - 1]}`;

  const plural = who === 'You' || firstNames.length > 1 || who === 'The family';

  let headline: string;
  if (trip.status === 'active') {
    // Already there: "in Lisbon".
    const place = trip.destination ? ` in ${trip.destination}` : ' away';
    const home = trip.daysUntilEnd === 0 ? 'home today'
      : trip.daysUntilEnd === 1 ? 'home tomorrow'
        : `home in ${trip.daysUntilEnd} days`;
    headline = `${who} ${plural ? 'are' : 'is'}${place} — ${home}.`;
  } else {
    // Not yet gone: "leave FOR Lisbon". Reusing "in" here produced "You leave
    // in Lisbon, Portugal tomorrow", which reads as though they are already
    // there. Caught by FamilyPulse.test.ts.
    const place = trip.destination ? ` for ${trip.destination}` : '';
    const leaves = trip.daysUntilStart === 0 ? 'today'
      : trip.daysUntilStart === 1 ? 'tomorrow'
        : `in ${trip.daysUntilStart} days`;
    headline = `${who} ${plural ? 'leave' : 'leaves'}${place} ${leaves}.`;
  }

  return {
    viewerIsTravelling,
    headline,
    action: viewerIsTravelling ? 'Your travel papers' : `Open the travel pack`,
  };
}

const DAY = 86_400_000;

export function rankPulseDecisions<T extends { dueInDays: number }>(items: T[], limit = 3): T[] {
  return [...items].sort((a, b) => a.dueInDays - b.dueInDays).slice(0, limit);
}

function localDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateLabel(event: CalendarEvent): string {
  const date = localDate(event.date);
  if (!date) return event.date;
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(date)
    + (event.time ? ` · ${event.time}` : '');
}

export function positiveMoment(members: FamilyMember[], isBusinessSpace: boolean, teamPeople: readonly ActionPerson[] = members, directoryAvailable = true): { title: string; note: string; growth: boolean } | null {
  if (isBusinessSpace) {
    if (!directoryAvailable) return { title: 'One team, moving forward.', note: 'Open Team to keep the team record current', growth: false };
    return teamPeople.length > 0
      ? { title: `${teamPeople.length} ${teamPeople.length === 1 ? 'person' : 'people'}, one team.`, note: 'Open Team to keep the team record current', growth: false }
      : null;
  }
  for (const member of members) {
    const history = [...(member.growthHistory || [])]
      .filter((entry) => Number.isFinite(entry.heightCm) && !!localDate(entry.date))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (history.length >= 2) {
      const delta = Math.round((history[history.length - 1].heightCm - history[0].heightCm) * 10) / 10;
      if (delta > 0) return { title: `${member.name.split(' ')[0]} grew ${delta} cm.`, note: 'See the family growth story', growth: true };
    }
  }
  const saying = members
    .flatMap((member) => (member.sayings || []).map((entry) => ({ member, entry })))
    .sort((a, b) => b.entry.said.localeCompare(a.entry.said))[0];
  if (saying) return { title: `“${saying.entry.text}”`, note: `A moment saved from ${saying.member.name.split(' ')[0]}`, growth: false };
  return members.length > 0
    ? { title: `${members.length} ${members.length === 1 ? 'person' : 'people'}, one family story.`, note: 'Open People to add the moments worth keeping', growth: false }
    : null;
}

export function pulseSpaceCopy(isBusinessSpace: boolean) {
  return isBusinessSpace ? {
    eyebrow: 'This week at work',
    calm: 'Your business space is calm and ready when you need it.',
    calendar: 'shared calendar',
    sceneAria: 'Your team',
    sceneLabel: 'Our team',
    sceneAlt: 'Your team together',
    sceneEmpty: 'Your team belongs here',
    returnEyebrow: 'Keep the team moving',
    emptyTitle: 'Build your team.',
    emptyAction: 'Add your first team member',
    peopleAria: 'Team members',
    peopleAction: 'See the team',
  } : {
    eyebrow: 'This week with us',
    calm: 'Your family space is calm and ready when you need it.',
    calendar: 'family calendar',
    sceneAria: 'Your family scene',
    sceneLabel: 'Our family',
    sceneAlt: 'Your family together',
    sceneEmpty: 'Your people belong here',
    returnEyebrow: 'A reason to return',
    emptyTitle: 'Start your family story.',
    emptyAction: 'Add your first person',
    peopleAria: 'Family members',
    peopleAction: 'See everyone',
  };
}

export default function FamilyPulse({ members, events, status, familyPhotoUrl, expiryWarnings, onOpenCalendar, onOpenMemberIds, onOpenPeople, actions = [], actionsLoading = false, actionOwners = members, actionDirectoryAvailable = true, onOpenActions, isBusinessSpace = false, trips = [], me = null, onOpenTrip, onViewPhoto, importantItems = [] }: FamilyPulseProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = events
    .map((event) => ({ event, date: localDate(event.date) }))
    .filter((entry): entry is { event: CalendarEvent; date: Date } => !!entry.date && entry.date.getTime() >= today.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const decisions = rankPulseDecisions([
    ...actions.filter(action => action.status === 'open' && actionDaysUntil(action.dueDate) !== null && actionDaysUntil(action.dueDate)! <= 7).map(action => ({
      key: `action-${action.id}`,
      title: action.title,
      note: `${(actionDaysUntil(action.dueDate) ?? 0) < 0 ? 'Overdue' : actionDaysUntil(action.dueDate) === 0 ? 'Due today' : 'Due this week'} · ${actionOwnerName(action, actionOwners, isBusinessSpace, actionDirectoryAvailable)}`,
      icon: ClipboardList,
      onClick: onOpenActions || onOpenPeople,
      dueInDays: actionDaysUntil(action.dueDate)!,
    })),
    ...expiryWarnings.map((warning) => ({
      key: `expiry-${warning.memberId}-${warning.label}`,
      title: `${warning.memberName}'s ${warning.label}`,
      note: warning.status === 'expired' ? 'Expired — review now' : warning.monthsLeft < 1 ? 'Due within a month' : `Due in ${Math.ceil(warning.monthsLeft)} months`,
      icon: FileWarning,
      onClick: () => onOpenMemberIds(warning.memberId),
      dueInDays: warning.status === 'expired' ? -1 : warning.monthsLeft * 30.44,
    })),
    ...upcoming
      .filter(({ date }) => (date.getTime() - today.getTime()) / DAY <= 30)
      .map(({ event, date }) => ({
        key: `event-${event.id}`,
        title: event.title,
        note: dateLabel(event),
        icon: CalendarDays,
        onClick: onOpenCalendar,
        dueInDays: (date.getTime() - today.getTime()) / DAY,
      })),
  ]);

  const countWords = ['Nothing urgent', 'One thing matters', 'Two things matter', 'Three things matter'];
  const copy = pulseSpaceCopy(isBusinessSpace);
  // Names are directory data. Photos come only from profiles this account
  // may already read; a directory entry never grants access to a staff photo.
  const scenePeople = isBusinessSpace && actionDirectoryAvailable ? actionOwners.map(person => {
    const readable = members.find(member => member.id === person.id);
    return { id: person.id, name: person.name, avatarUrl: readable?.avatarUrl, avatarColor: readable?.avatarColor };
  }) : members;
  const moment = positiveMoment(members, isBusinessSpace, actionOwners, actionDirectoryAvailable);
  const nextEvent = upcoming[0]?.event;
  const nextDate = nextEvent ? localDate(nextEvent.date) : null;
  const actionSummary = actionCounts(actions);
  const nextAction = sortActions(actions).find(action => action.status === 'open');

  // Pick ONE trip. A banner that stacks is a list, and a list is the thing this
  // is meant to replace. Preference order: a trip the viewer is on, then the
  // one happening soonest (buildTrips already sorts active-before-upcoming).
  const bannerTrip = trips.find((trip) => !!me && (trip.memberIds.length === 0 || trip.memberIds.includes(me.id))) || trips[0] || null;
  const tripBanner = bannerTrip
    ? { trip: bannerTrip, copy: tripBannerCopy(bannerTrip, me, members) }
    : null;

  return (
    <div className="family-pulse">
      <section className="pulse-hero">
        <div className="pulse-hero-copy">
          <span className="pulse-eyebrow">{copy.eyebrow}</span>
          <h1>{countWords[decisions.length]}.<br /><em>Everything else can wait.</em></h1>
          <p>{status?.text || (nextEvent ? `${nextEvent.title} is the next thing on the ${copy.calendar}.` : copy.calm)}</p>
          {status && <small>Updated by {status.by}</small>}
        </div>
        <div className={`pulse-family-scene ${familyPhotoUrl ? 'has-photo' : ''}`} aria-label={copy.sceneAria}>
          {familyPhotoUrl ? (
            /* The one photo on the home screen is the one people most want to
               look AT. A plain <img> here was the only family face in the app
               that could not be opened. */
            onViewPhoto ? (
              <button
                type="button"
                onClick={() => onViewPhoto(familyPhotoUrl)}
                className="pulse-scene-photo"
                aria-label={isBusinessSpace ? 'See the business photo full size' : 'See the family photo full size'}
              >
                <img src={familyPhotoUrl} alt={copy.sceneAlt} />
              </button>
            ) : (
              <img src={familyPhotoUrl} alt={copy.sceneAlt} />
            )
          ) : (
            <>
              <span className="pulse-scene-label">{copy.sceneLabel}</span>
              <div className="pulse-scene-portraits">
                {scenePeople.slice(0, 4).map((member) => member.avatarUrl ? (
                  <img key={member.id} src={member.avatarUrl} alt={member.name} title={member.name} />
                ) : (
                  <span key={member.id} title={member.name} style={{ background: member.avatarColor ? undefined : 'var(--ember-oxblood)' }}>
                    {member.name.charAt(0).toUpperCase()}
                  </span>
                ))}
              </div>
              <p>{scenePeople.length ? scenePeople.slice(0, 4).map((member) => member.name.split(' ')[0]).join(' · ') : copy.sceneEmpty}</p>
            </>
          )}
          {nextDate && (
            <button type="button" onClick={onOpenCalendar} className="pulse-date-orb" aria-label={`Open calendar for ${nextEvent?.title}`}>
              <b>{nextDate.getDate()}</b><span>{new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(nextDate)}</span>
            </button>
          )}
        </div>
      </section>

      {/* Travel sits directly under the hero — second thing on the screen, above
          the review — because the moment it matters you are not browsing. It is
          shown ONLY while a trip is current, so it costs nothing the rest of the
          year. A trip the viewer is on wins over one they are not: a traveller
          needing their own papers outranks a status update about someone else. */}
      {tripBanner && (
        <section className="pulse-trip" aria-label="Travel">
          <div className="pulse-trip-icon"><Plane className="h-5 w-5" /></div>
          <div className="pulse-trip-copy">
            <span className="pulse-eyebrow">{tripBanner.trip.title}</span>
            <h2>{tripBanner.copy.headline}</h2>
          </div>
          {onOpenTrip && (
            <button
              type="button"
              className="pulse-trip-action"
              onClick={() => onOpenTrip(tripBanner.trip.id, tripBanner.copy.viewerIsTravelling ? me?.id : undefined)}
            >
              {tripBanner.copy.action} <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </section>
      )}

      {/* Important — coming up. Above the review, because marking something
          important is asking for it to be seen first; absent when there is
          nothing in the next 30 days. */}
      <ImportantComingUp variant="ember" items={importantItems} members={members} onOpenCalendar={onOpenCalendar} />

      <div className="pulse-grid">
        <section className="pulse-decisions">
          <header>
            <div><span className="pulse-eyebrow">Your short review</span><h2>{decisions.length ? 'A clear way through.' : 'All clear for now.'}</h2></div>
            <span className="pulse-count">{decisions.length}</span>
          </header>
          {decisions.length ? decisions.map(({ key, title, note, icon: Icon, onClick }, index) => (
            <button key={key} type="button" onClick={onClick} className="pulse-decision-row">
              <span className="pulse-decision-number">{index + 1}</span><Icon className="h-4 w-4" />
              <span><b>{title}</b><small>{note}</small></span><ArrowRight className="h-4 w-4" />
            </button>
          )) : (
            <div className="pulse-empty"><CheckCircle2 className="h-5 w-5" /><span>No urgent records or near-term plans need a decision.</span></div>
          )}
        </section>

        <button type="button" onClick={onOpenPeople} className="pulse-memory">
          <span className="pulse-eyebrow">{copy.returnEyebrow}</span>
          <div className="pulse-memory-icon">{moment?.growth ? <Ruler /> : <Sparkles />}</div>
          <h2>{moment?.title || copy.emptyTitle}</h2>
          <p>{moment?.note || copy.emptyAction} <ArrowRight className="h-4 w-4" /></p>
        </button>
      </div>

      {onOpenActions && <button type="button" className="pulse-actions-link" onClick={onOpenActions}>
        <ClipboardList className="h-5 w-5" />
        <span><b>{actionsLoading ? 'Loading shared actions…' : actionSummary.open ? `${actionSummary.open} open ${actionSummary.open === 1 ? 'action' : 'actions'}${actionSummary.overdue ? ` · ${actionSummary.overdue} overdue` : ''}` : 'Give the next step a home'}</b><small>{nextAction ? nextAction.title : 'Assign an owner, choose a date, and follow through together.'}</small></span>
        <ArrowRight className="h-4 w-4" />
      </button>}

      <section className="pulse-people" aria-label={copy.peopleAria}>
        <div>
          {scenePeople.slice(0, 6).map((member) => member.avatarUrl
            ? <img key={member.id} src={member.avatarUrl} alt={member.name} />
            : <span key={member.id} aria-label={member.name}>{member.name.charAt(0).toUpperCase()}</span>)}
        </div>
        <button type="button" onClick={onOpenPeople}>{copy.peopleAction} <ArrowRight className="h-4 w-4" /></button>
      </section>
    </div>
  );
}
