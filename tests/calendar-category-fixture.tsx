import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import FamilyCalendar from '../src/components/FamilyCalendar';
import { FamilyContext, useFamilyCtx } from '../src/contexts/FamilyContext';
import type { CalendarEvent, HubSettings } from '../src/types';
import { isMedicalCalendarEvent } from '../src/utils/medicalCalendarEvent';
import '../src/index.css';
// Local UI-only context. Saves update this component's memory, never the database.
function Fixture() {
 const base = useFamilyCtx();
 const [events, setEvents] = useState<CalendarEvent[]>([{id:'gcal-fixture',title:'Annual visit',date:new Date().toLocaleDateString('en-CA'),category:'Appointment',remindMe:false}]);
 return <FamilyContext.Provider value={{...base,canWrite:true}}><output aria-label="Saved classification">{JSON.stringify(events.map(e=>({category:e.category,confirmed:e.categoryConfirmed,medical:isMedicalCalendarEvent(e)})))}</output><FamilyCalendar members={[]} events={events} onSaveEvents={setEvents} autoSyncEnabled={false} onToggleAutoSync={()=>{}} calendarFeeds={[]} onSaveCalendarFeeds={()=>{}} settings={{} as HubSettings}/></FamilyContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
