import React from 'react';
import { createRoot } from 'react-dom/client';
import FamilyCalendar from '../src/components/FamilyCalendar';
import type { CalendarEvent } from '../src/types';
import '../src/index.css';
const today = new Date().toLocaleDateString('en-CA');
const events: CalendarEvent[] = [
  { id: 'gcal-work-fixture', title: 'Karin', date: today, time: '08:00', category: 'Appointment', remindMe: false },
  { id: 'school-fixture', title: 'School holiday', date: today, category: 'School', remindMe: false },
  { id: 'medical-fixture', title: 'Dentist', date: today, time: '10:30', category: 'Appointment', remindMe: false },
];
createRoot(document.getElementById('root')!).render(<FamilyCalendar members={[]} events={events} onSaveEvents={() => {}} autoSyncEnabled={false} onToggleAutoSync={() => {}} calendarFeeds={[]} onSaveCalendarFeeds={() => {}} settings={{ calendarDivisions: { birthdays: false, extendedBirthdays: false, nameCelebrations: false, medicalChecks: false, anniversaries: false, school: false, vacations: false, petBirthdays: false, documentExpiries: false } } as any} />);
