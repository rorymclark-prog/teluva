import { ArrowRight, CalendarDays, CheckCircle2, FileWarning, Ruler, Sparkles } from 'lucide-react';
import { CalendarEvent, FamilyMember, HubStatus } from '../types';

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

function positiveMoment(members: FamilyMember[]): { title: string; note: string; growth: boolean } | null {
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

export default function FamilyPulse({ members, events, status, familyPhotoUrl, expiryWarnings, onOpenCalendar, onOpenMemberIds, onOpenPeople }: FamilyPulseProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = events
    .map((event) => ({ event, date: localDate(event.date) }))
    .filter((entry): entry is { event: CalendarEvent; date: Date } => !!entry.date && entry.date.getTime() >= today.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const decisions = rankPulseDecisions([
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
  const moment = positiveMoment(members);
  const nextEvent = upcoming[0]?.event;
  const nextDate = nextEvent ? localDate(nextEvent.date) : null;

  return (
    <div className="family-pulse">
      <section className="pulse-hero">
        <div className="pulse-hero-copy">
          <span className="pulse-eyebrow">This week with us</span>
          <h1>{countWords[decisions.length]}.<br /><em>Everything else can wait.</em></h1>
          <p>{status?.text || (nextEvent ? `${nextEvent.title} is the next thing on the family calendar.` : 'Your family space is calm and ready when you need it.')}</p>
          {status && <small>Updated by {status.by}</small>}
        </div>
        <div className={`pulse-family-scene ${familyPhotoUrl ? 'has-photo' : ''}`} aria-label="Your family scene">
          {familyPhotoUrl ? (
            <img src={familyPhotoUrl} alt="Your family together" />
          ) : (
            <>
              <span className="pulse-scene-label">Our family</span>
              <div className="pulse-scene-portraits">
                {members.slice(0, 4).map((member) => member.avatarUrl ? (
                  <img key={member.id} src={member.avatarUrl} alt={member.name} title={member.name} />
                ) : (
                  <span key={member.id} title={member.name} style={{ background: member.avatarColor ? undefined : 'var(--ember-oxblood)' }}>
                    {member.name.charAt(0).toUpperCase()}
                  </span>
                ))}
              </div>
              <p>{members.length ? members.slice(0, 4).map((member) => member.name.split(' ')[0]).join(' · ') : 'Your people belong here'}</p>
            </>
          )}
          {nextDate && (
            <button type="button" onClick={onOpenCalendar} className="pulse-date-orb" aria-label={`Open calendar for ${nextEvent?.title}`}>
              <b>{nextDate.getDate()}</b><span>{new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(nextDate)}</span>
            </button>
          )}
        </div>
      </section>

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
          <span className="pulse-eyebrow">A reason to return</span>
          <div className="pulse-memory-icon">{moment?.growth ? <Ruler /> : <Sparkles />}</div>
          <h2>{moment?.title || 'Start your family story.'}</h2>
          <p>{moment?.note || 'Add your first person'} <ArrowRight className="h-4 w-4" /></p>
        </button>
      </div>

      <section className="pulse-people" aria-label="Family members">
        <div>
          {members.slice(0, 6).map((member) => member.avatarUrl
            ? <img key={member.id} src={member.avatarUrl} alt={member.name} />
            : <span key={member.id} aria-label={member.name}>{member.name.charAt(0).toUpperCase()}</span>)}
        </div>
        <button type="button" onClick={onOpenPeople}>See everyone <ArrowRight className="h-4 w-4" /></button>
      </section>
    </div>
  );
}
