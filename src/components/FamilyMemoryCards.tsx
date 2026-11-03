import { useEffect, useState } from 'react';
import type { CalendarEvent, ExtendedBirthday, FamilyMember, FamilyTimeline } from '../types';
import { subscribeReferenceDoc } from '../utils/db';
import { timelineMemoryEvents } from '../utils/lifeTimeline';
import FlashbackCard from './FlashbackCard';
import OnThisDay from './OnThisDay';

interface Props {
  scope: string;
  members: FamilyMember[];
  extendedBirthdays: ExtendedBirthday[];
  canReadTimeline: boolean;
  isBusinessSpace: boolean;
}

export default function FamilyMemoryCards({ scope, members, extendedBirthdays, canReadTimeline, isBusinessSpace }: Props) {
  const [feed, setFeed] = useState<{ scope: string; events: CalendarEvent[] }>();

  useEffect(() => {
    if (!canReadTimeline) return;
    return subscribeReferenceDoc<FamilyTimeline>('timeline', (timeline) => {
      setFeed({ scope, events: timelineMemoryEvents(timeline?.entries || []) });
    });
  }, [canReadTimeline, scope]);

  const events = canReadTimeline && feed?.scope === scope ? feed.events : [];
  return (
    <>
      <OnThisDay members={members} events={events} extendedBirthdays={extendedBirthdays} />
      {!isBusinessSpace && <FlashbackCard members={members} events={events} />}
    </>
  );
}
