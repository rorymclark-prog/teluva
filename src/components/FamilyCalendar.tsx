import React, { useState, useEffect, useRef } from 'react';
import { CalendarEvent, FamilyMember } from '../types';
import {
  Calendar, Clock, Plus, Trash2, Edit2,
  Users, Check, Bell, ChevronLeft, ChevronRight, AlertCircle, X, Info,
  Cloud, RefreshCcw, Loader2, LogIn, Send, Download
} from 'lucide-react';
import { initAuth, googleSignIn, logout, getAccessToken } from '../utils/firebase';

// Bug fix #1: local-date helper avoids UTC-day-shift for Vienna (UTC+1/+2)
const todayLocal = () => new Date().toLocaleDateString('en-CA');

interface FamilyCalendarProps {
  members: FamilyMember[];
  events: CalendarEvent[];
  onSaveEvents: (events: CalendarEvent[]) => void;
}

export default function FamilyCalendar({ members, events, onSaveEvents }: FamilyCalendarProps) {
  // Bug fix #1: replaced hardcoded new Date('2026-05-22') with real today
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth()); // 0-indexed
  // Bug fix #6: use todayLocal() instead of toISOString().split('T')[0]
  const [selectedDateStr, setSelectedDateStr] = useState(todayLocal());

  // Google Calendar Connection States
  const [needsAuth, setNeedsAuth] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isGoogleCalendarSyncing, setIsGoogleCalendarSyncing] = useState(false);
  const [calendarSyncError, setCalendarSyncError] = useState<string | null>(null);

  // Bug fix #2: run-once ref prevents stale-closure duplicate imports
  const hasAutoImported = useRef(false);

  // Sync state observer
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, cachedToken) => {
        setUser(currentUser);
        setToken(cachedToken);
        setNeedsAuth(false);
      },
      () => {
        setNeedsAuth(true);
        setUser(null);
        setToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  // Bug fix #2: auto-sync fires only once per mount
  useEffect(() => {
    if (token && !hasAutoImported.current) {
      hasAutoImported.current = true;
      handleImportFromGoogle();
    }
  }, [token]);

  const handleLoginGoogle = async () => {
    setIsLoggingIn(true);
    setCalendarSyncError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setUser(result.user);
        setNeedsAuth(false);
        triggerReminderNotification('Successfully connected to Google Calendar!');
      }
    } catch (err: any) {
      console.error(err);
      setCalendarSyncError('Failed to authorize with Google Calendar.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const pushEventToGoogle = async (ev: CalendarEvent) => {
    if (!token) {
      triggerReminderNotification('Please connect Google Calendar first.');
      return;
    }

    setIsGoogleCalendarSyncing(true);
    setCalendarSyncError(null);
    try {
      const startDateTime = ev.time ? `${ev.date}T${ev.time}:00` : `${ev.date}T09:00:00`;
      let [h, m] = (ev.time || '09:00').split(':').map(Number);
      const endH = String((h + 1) % 24).padStart(2, '0');
      const endM = String(m).padStart(2, '0');
      const endDateTime = `${ev.date}T${endH}:${endM}:00`;

      const body = {
        summary: `[Family Hub] ${ev.title}`,
        description: `${ev.description || ''}\n\nSynced from Family Hub.\nCategory: ${ev.category}`,
        start: {
          dateTime: startDateTime,
          // Bug fix #4: was 'UTC', changed to Vienna local time
          timeZone: 'Europe/Vienna'
        },
        end: {
          dateTime: endDateTime,
          // Bug fix #4: was 'UTC', changed to Vienna local time
          timeZone: 'Europe/Vienna'
        }
      };

      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        if (response.status === 401) {
          setNeedsAuth(true);
          setToken(null);
          throw new Error('Authorization expired. Please re-authenticate.');
        }
        throw new Error(`Google API returned status ${response.status}`);
      }

      triggerReminderNotification(`Exported "${ev.title}" to Google Calendar!`);
    } catch (err: any) {
      console.error(err);
      setCalendarSyncError(err.message || 'Error exporting to Google Calendar.');
    } finally {
      setIsGoogleCalendarSyncing(false);
    }
  };

  const handleExportAllToGoogle = async () => {
    if (!token) return;
    const confirmPush = window.confirm(`Ready to push all ${events.length} Family Hub events to your Google Calendar?`);
    if (!confirmPush) return;

    setIsGoogleCalendarSyncing(true);
    setCalendarSyncError(null);
    let successCount = 0;
    for (const ev of events) {
      try {
        const startDateTime = ev.time ? `${ev.date}T${ev.time}:00` : `${ev.date}T09:00:00`;
        let [h, m] = (ev.time || '09:00').split(':').map(Number);
        const endH = String((h + 1) % 24).padStart(2, '0');
        const endM = String(m).padStart(2, '0');
        const endDateTime = `${ev.date}T${endH}:${endM}:00`;

        const body = {
          summary: `[Family Hub] ${ev.title}`,
          description: `${ev.description || ''}\nCategory: ${ev.category}`,
          // Bug fix #4: was 'UTC' in both, changed to Vienna local time
          start: { dateTime: startDateTime, timeZone: 'Europe/Vienna' },
          end: { dateTime: endDateTime, timeZone: 'Europe/Vienna' }
        };

        const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });
        if (response.ok) {
          successCount++;
        }
      } catch (e) {
        console.error('Batch sync failure for event id ' + ev.id, e);
      }
    }
    setIsGoogleCalendarSyncing(false);
    triggerReminderNotification(`Successfully exported ${successCount} events to Google Calendar!`);
  };

  const handleImportFromGoogle = async () => {
    if (!token) return;
    setIsGoogleCalendarSyncing(true);
    setCalendarSyncError(null);
    try {
      // Check token scopes first if possible
      try {
        const tokenInfoRes = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${token}`);
        if (tokenInfoRes.ok) {
          const tokenInfo = await tokenInfoRes.json();
          if (tokenInfo.scope && !tokenInfo.scope.includes('calendar') && !tokenInfo.scope.includes('calendar.events')) {
            setNeedsAuth(true);
            setToken(null);
            throw new Error('You did not grant Google Calendar permissions. You MUST check the box for Google Calendar on the sign-in screen.');
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('permissions')) throw e;
      }

      const startOfPeriod = new Date('2026-01-01T00:00:00Z').toISOString();
      const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${startOfPeriod}&maxResults=30&orderBy=startTime&singleEvents=true`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error(`Google Calendar API error: ${response.status}`);
      }

      const data = await response.json();
      const googleEvents = data.items || [];

      if (googleEvents.length === 0) {
        triggerReminderNotification('No events found in Google Calendar.');
        return;
      }

      const importedEvents: CalendarEvent[] = [];
      googleEvents.forEach((gEv: any) => {
        // Bug fix #5: skip events previously exported from Family Hub
        if ((gEv.summary || '').startsWith('[Family Hub]')) return;

        // Bug fix #5: dedupe by Google event id instead of case-insensitive title
        const exists = events.some(e => e.id === 'gcal-' + gEv.id);
        if (exists) return;

        const startVal = gEv.start?.dateTime || gEv.start?.date || '';
        if (!startVal) return;

        const datePart = startVal.substring(0, 10); // YYYY-MM-DD
        let timePart = '12:00';
        if (gEv.start?.dateTime) {
          timePart = startVal.substring(11, 16); // HH:MM
        }

        importedEvents.push({
          // Bug fix #5: id is now 'gcal-' + gEv.id so dedup works on next run
          id: 'gcal-' + gEv.id,
          title: gEv.summary || 'Google Appointment',
          date: datePart,
          time: timePart,
          description: gEv.description || 'Imported from Google Calendar',
          category: 'Appointment',
          remindMe: true,
          memberIds: []
        });
      });

      if (importedEvents.length === 0) {
        triggerReminderNotification('All events are already matched.');
      } else {
        onSaveEvents([...events, ...importedEvents]);
        triggerReminderNotification(`Imported ${importedEvents.length} new entries from Google Calendar!`);
      }
    } catch (err: any) {
      console.error(err);
      setCalendarSyncError(err.message || 'Failed to import from Google Calendar.');
    } finally {
      setIsGoogleCalendarSyncing(false);
    }
  };

  // Form states for Add/Edit
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  // Bug fix #6: use todayLocal() instead of toISOString().split('T')[0]
  const [eventDate, setEventDate] = useState(todayLocal());
  const [eventTime, setEventTime] = useState('12:00');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<'Milestone' | 'Appointment' | 'School' | 'Travel' | 'Other'>('Other');
  const [remindMe, setRemindMe] = useState(true);
  const [taggedMemberIds, setTaggedMemberIds] = useState<string[]>([]);
  const [reminderNote, setReminderNote] = useState<string | null>(null);

  // Month properties
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay(); // 0 is Sunday
  };

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDayIndex = getFirstDayOfMonth(currentYear, currentMonth);

  // Chevron Controls
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  // Build Calendar grid cells
  const calendarCells: (Date | null)[] = [];
  for (let i = 0; i < firstDayIndex; i++) {
    calendarCells.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    calendarCells.push(new Date(currentYear, currentMonth, d));
  }

  // Format date correctly YYYY-MM-DD (local, not UTC)
  const formatDateString = (dateObj: Date) => {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Handle Select Day
  const handleDaySelect = (dateObj: Date | null) => {
    if (dateObj) {
      const dateStr = formatDateString(dateObj);
      setSelectedDateStr(dateStr);
      setEventDate(dateStr);
    }
  };

  // Open Form to Add
  const handleOpenAddForm = () => {
    setEditingEventId(null);
    setTitle('');
    setEventDate(selectedDateStr);
    setEventTime('12:00');
    setDescription('');
    setCategory('Other');
    setRemindMe(true);
    setTaggedMemberIds([]);
    setIsFormOpen(true);
  };

  // Open Form to Edit
  const handleOpenEditForm = (ev: CalendarEvent) => {
    setEditingEventId(ev.id);
    setTitle(ev.title);
    setEventDate(ev.date);
    setEventTime(ev.time || '12:00');
    setDescription(ev.description || '');
    setCategory(ev.category);
    setRemindMe(ev.remindMe);
    setTaggedMemberIds(ev.memberIds || []);
    setIsFormOpen(true);
  };

  // Commit Event
  const handleCommitEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !eventDate) return;

    if (editingEventId) {
      // Edit mode
      const updatedList = events.map(ev => {
        if (ev.id === editingEventId) {
          return {
            ...ev,
            title: title.trim(),
            date: eventDate,
            time: eventTime || undefined,
            description: description.trim() || undefined,
            category,
            remindMe,
            memberIds: taggedMemberIds,
          };
        }
        return ev;
      });
      onSaveEvents(updatedList);
      triggerReminderNotification('Calendar event updated successfully!');
    } else {
      // Create mode
      const newEvent: CalendarEvent = {
        id: 'ev-' + Date.now(),
        title: title.trim(),
        date: eventDate,
        time: eventTime || undefined,
        description: description.trim() || undefined,
        category,
        remindMe,
        memberIds: taggedMemberIds,
      };
      onSaveEvents([...events, newEvent]);
      triggerReminderNotification(
        remindMe
          ? `Event listed. Digital reminders dispatched to all tagged family members!`
          : `Event listed on shared calendar!`
      );
    }

    setIsFormOpen(false);
  };

  // Delete Event
  const handleDeleteEvent = (eventId: string) => {
    const updated = events.filter(e => e.id !== eventId);
    onSaveEvents(updated);
    triggerReminderNotification('Shared calendar entry deleted.');
  };

  const handleToggleMemberTag = (memberId: string) => {
    if (taggedMemberIds.includes(memberId)) {
      setTaggedMemberIds(taggedMemberIds.filter(id => id !== memberId));
    } else {
      setTaggedMemberIds([...taggedMemberIds, memberId]);
    }
  };

  const triggerReminderNotification = (text: string) => {
    setReminderNote(text);
    setTimeout(() => setReminderNote(null), 3000);
  };

  // Find events on selected day
  const selectedDayEvents = events.filter(e => e.date === selectedDateStr)
    .sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));

  // Quick reminder feed (Events in the next 12 days from today)
  const todayTime = new Date(todayLocal()).getTime();
  const upcomingReminders = events.filter(e => {
    const evTime = new Date(e.date).getTime();
    const diffDays = (evTime - todayTime) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= 12;
  }).sort((a, b) => a.date.localeCompare(b.date));

  // Real today string for highlighting the calendar cell
  const realTodayStr = todayLocal();

  return (
    <div className="space-y-6">
      {/* Toast notification */}
      {reminderNote && (
        <div className="p-4 rounded-2xl bg-ink-900 text-white text-sm flex items-center gap-2.5 animate-bounce shadow-lift">
          <Bell className="w-4 h-4 text-sage-400 shrink-0" />
          <span>{reminderNote}</span>
        </div>
      )}

      {/* Header bar */}
      <section className="border-b border-cream-300 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-display font-semibold text-ink-900 flex items-center gap-2">
            <span className="w-1.5 h-4 bg-clay-400 rounded-full inline-block"></span>
            Family calendar
          </h3>
          <p className="text-[13px] text-ink-500 mt-1">Shared planning schedule. Coordinate flights, medical appointments, milestones, and school schedules seamlessly.</p>
        </div>

        <button
          onClick={handleOpenAddForm}
          className="btn-primary ml-auto sm:ml-0 text-sm"
        >
          <Plus className="w-4 h-4" />
          <span>Schedule new event</span>
        </button>
      </section>

      {/* Google Calendar Sync Panel */}
      <div className="card rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-sage-100 text-sage-600 border border-sage-200 shrink-0">
            <Cloud className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-[13px] font-semibold text-ink-800 flex items-center gap-2">
              Google Calendar sync
              {needsAuth ? (
                <span className="chip bg-cream-200 text-ink-500">Offline</span>
              ) : (
                <span className="chip bg-sage-100 text-sage-700 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-sage-500 animate-pulse"></span>
                  Connected
                </span>
              )}
            </h4>
            <p className="text-[13px] text-ink-400 mt-0.5">
              {needsAuth
                ? "Link your Google account to enable event import and export."
                : `Active connection with ${user?.email || 'Google account'}.`
              }
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {calendarSyncError && (
            <span className="text-[12px] text-rosa-700 font-medium mr-2 max-w-[200px] truncate leading-tight">
              ⚠️ {calendarSyncError}
            </span>
          )}

          {needsAuth ? (
            <button
              onClick={handleLoginGoogle}
              disabled={isLoggingIn}
              className="btn-primary w-full sm:w-auto"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Authorizing...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Connect Google Calendar</span>
                </>
              )}
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
              <button
                onClick={handleImportFromGoogle}
                disabled={isGoogleCalendarSyncing}
                className="btn-quiet flex-1 sm:flex-none disabled:opacity-50"
              >
                {isGoogleCalendarSyncing ? (
                  <Loader2 className="w-4 h-4 animate-spin text-ink-400" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>Import schedule</span>
              </button>

              <button
                onClick={handleExportAllToGoogle}
                disabled={isGoogleCalendarSyncing}
                className="btn-primary flex-1 sm:flex-none disabled:opacity-50"
              >
                {isGoogleCalendarSyncing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span>Export all events</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Layout: Calendar Grid (LEFT) + Daily Activities (RIGHT) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

        {/* MONTH CALENDAR CONTAINER */}
        <div className="lg:col-span-7 card rounded-2xl p-5 space-y-4">

          {/* Calendar Header with Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-ink-600" />
              <h4 className="text-[13px] font-semibold text-ink-800">
                {monthNames[currentMonth]} {currentYear}
              </h4>
            </div>

            <div className="flex items-center space-x-1">
              <button
                onClick={handlePrevMonth}
                className="p-1 px-1.5 hover:bg-cream-100 rounded-xl border border-cream-300 text-ink-500 transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleNextMonth}
                className="p-1 px-1.5 hover:bg-cream-100 rounded-xl border border-cream-300 text-ink-500 transition-colors cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Weekday Labels — small ink-400 semibold, normal case */}
          <div className="grid grid-cols-7 gap-1 text-center font-semibold text-[11px] text-ink-400 pb-1">
            <span>Sun</span>
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span>Sat</span>
          </div>

          {/* Day Cells */}
          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((cellDate, index) => {
              if (cellDate === null) {
                return <div key={`empty-${index}`} className="aspect-square bg-cream-100/60 rounded-xl" />;
              }

              const dateStr = formatDateString(cellDate);
              const isSelected = selectedDateStr === dateStr;
              // Bug fix #1: compare against real today string, not hardcoded date
              const isCurrentDay = realTodayStr === dateStr;

              const dayEvents = events.filter(e => e.date === dateStr);
              const hasEvents = dayEvents.length > 0;

              return (
                <button
                  // Bug fix #3: key now includes year+month to avoid cross-month collisions
                  key={`day-${cellDate.getFullYear()}-${cellDate.getMonth()}-${cellDate.getDate()}`}
                  onClick={() => handleDaySelect(cellDate)}
                  className={`aspect-square relative rounded-xl transition-all flex flex-col items-center justify-center cursor-pointer border text-xs ${
                    isSelected
                      ? 'bg-clay-500 border-clay-500 text-white font-bold shadow-soft scale-105 z-10'
                      : isCurrentDay
                        ? 'bg-clay-50 ring-1 ring-clay-300 border-clay-200 text-ink-900 font-bold'
                        : 'bg-white border-cream-200 text-ink-700 hover:border-cream-300 hover:bg-cream-50'
                  }`}
                >
                  <span className="text-xs leading-none">{cellDate.getDate()}</span>

                  {/* Event Marker Dots — category pastels */}
                  {hasEvents && (
                    <div className="absolute bottom-1.5 flex space-x-0.5 justify-center">
                      {dayEvents.slice(0, 3).map((e) => (
                        <span
                          key={e.id}
                          className={`w-1 h-1 rounded-full ${
                            isSelected
                              ? 'bg-white/80'
                              : e.category === 'School' ? 'bg-dusk-500' :
                                e.category === 'Travel' ? 'bg-honey-500' :
                                e.category === 'Appointment' ? 'bg-rosa-500' :
                                e.category === 'Milestone' ? 'bg-sage-500' :
                                'bg-ink-400'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Color Code Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-3.5 border-t border-cream-200 text-[12px] text-ink-500 font-semibold">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-dusk-500 inline-block"></span>
              <span>School</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-honey-500 inline-block"></span>
              <span>Travel</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rosa-500 inline-block"></span>
              <span>Appointment</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sage-500 inline-block"></span>
              <span>Milestone</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-ink-400 inline-block"></span>
              <span>Other</span>
            </div>
          </div>
        </div>

        {/* RIGHT AREA: Day events + Upcoming feed */}
        <div className="lg:col-span-5 space-y-6">

          {/* EVENTS ON SELECTED DAY */}
          <section className="card rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-cream-200">
              <h4 className="text-[13px] font-semibold text-ink-800">
                Agenda: {selectedDateStr}
              </h4>
              <span className="section-label">
                {selectedDayEvents.length} items
              </span>
            </div>

            {selectedDayEvents.length === 0 ? (
              <div className="text-center py-8 text-ink-400 text-[13px] italic">
                No events scheduled. Choose a date and click "Schedule new event" to start.
              </div>
            ) : (
              <div className="space-y-3">
                {selectedDayEvents.map(ev => {
                  const assignedMembers = members.filter(m => ev.memberIds?.includes(m.id));

                  return (
                    <div
                      key={ev.id}
                      className={`p-4 rounded-2xl border flex flex-col gap-2.5 transition-all text-xs ${
                        ev.category === 'School' ? 'bg-dusk-50 border-dusk-100 text-ink-900' :
                        ev.category === 'Travel' ? 'bg-honey-50 border-honey-100 text-ink-900' :
                        ev.category === 'Appointment' ? 'bg-rosa-50 border-rosa-100 text-ink-900' :
                        ev.category === 'Milestone' ? 'bg-sage-50 border-sage-100 text-ink-900' :
                        'bg-cream-100 border-cream-300 text-ink-900'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <h5 className="font-semibold text-ink-900 leading-snug text-[13px]">{ev.title}</h5>
                          {ev.time && (
                            <p className="flex items-center gap-1 text-[12px] font-semibold text-ink-500 font-mono">
                              <Clock className="w-3 h-3" />
                              {ev.time}
                            </p>
                          )}
                        </div>

                        {/* Category chip */}
                        <span className={`chip shrink-0 ${
                          ev.category === 'School' ? 'bg-dusk-100 text-dusk-700' :
                          ev.category === 'Travel' ? 'bg-honey-100 text-honey-700' :
                          ev.category === 'Appointment' ? 'bg-rosa-100 text-rosa-700' :
                          ev.category === 'Milestone' ? 'bg-sage-100 text-sage-700' :
                          'bg-cream-200 text-ink-600'
                        }`}>
                          {ev.category}
                        </span>
                      </div>

                      {ev.description && (
                        <p className="text-[12px] text-ink-600 leading-snug italic">
                          &ldquo;{ev.description}&rdquo;
                        </p>
                      )}

                      {/* Tagged members + actions */}
                      <div className="flex items-center justify-between pt-2 border-t border-cream-300/60">
                        <div className="flex items-center space-x-1.5">
                          <Users className="w-3 h-3 text-ink-400 mr-0.5" />
                          {assignedMembers.length === 0 ? (
                            <span className="text-[12px] text-ink-400">All family</span>
                          ) : (
                            <div className="flex -space-x-1">
                              {assignedMembers.map(m => (
                                m.avatarUrl ? (
                                  <span
                                    key={m.id}
                                    className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center border-2 border-white shrink-0"
                                    title={m.name}
                                  >
                                    <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover" />
                                  </span>
                                ) : (
                                  <span
                                    key={m.id}
                                    className={`w-5 h-5 rounded-full ${m.avatarColor} text-[10px] font-bold text-white flex items-center justify-center border-2 border-white shrink-0`}
                                    title={m.name}
                                  >
                                    {m.name.charAt(0)}
                                  </span>
                                )
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center space-x-1.5 shrink-0">
                          {ev.remindMe && (
                            <span className="chip bg-ink-900 text-white">
                              <Bell className="w-2.5 h-2.5" />
                              Alert on
                            </span>
                          )}
                          {!needsAuth && (
                            <button
                              onClick={() => pushEventToGoogle(ev)}
                              className="p-1 hover:bg-cream-100 rounded-lg text-sage-600 transition-colors"
                              title="Sync to Google Calendar"
                            >
                              <Cloud className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleOpenEditForm(ev)}
                            className="p-1 hover:bg-cream-100 rounded-lg text-ink-500 transition-colors"
                            title="Edit event"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleDeleteEvent(ev.id)}
                            className="p-1 hover:bg-rosa-50 rounded-lg text-rosa-600 transition-colors"
                            title="Delete event"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* UPCOMING REMINDERS SIDEBAR */}
          <section className="card rounded-2xl p-5 space-y-4">
            <h4 className="text-[13px] font-semibold text-ink-800 flex items-center gap-2 pb-2 border-b border-cream-200">
              <Bell className="w-4 h-4 text-ink-400" />
              Upcoming shared reminders
            </h4>

            {upcomingReminders.length === 0 ? (
              <div className="text-center py-6 text-ink-400 text-[13px] italic">
                No reminders in the next 12 days.
              </div>
            ) : (
              <div className="space-y-2.5 text-xs leading-normal max-h-56 overflow-y-auto pr-1">
                {upcomingReminders.slice(0, 5).map(rem => (
                  <div key={rem.id} className="flex gap-2.5 items-start bg-cream-100 border border-cream-200 p-2.5 rounded-xl hover:bg-cream-200/50 transition-colors">
                    <Info className="w-4 h-4 text-ink-400 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink-800 truncate pr-0.5 text-[13px]">{rem.title}</p>
                      <p className="font-mono text-[11px] text-ink-400 mt-0.5">{rem.date} {rem.time ? `• ${rem.time}` : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      </div>

      {/* ADD / EDIT EVENT MODAL */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-ink-900/60 backdrop-blur-sm" onClick={() => setIsFormOpen(false)} />

          <div className="relative bg-white border border-cream-300/70 rounded-3xl p-6 shadow-lift w-full max-w-md space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-cream-200">
              <h3 className="text-lg font-display font-semibold text-ink-900">
                {editingEventId ? 'Edit event' : 'New event'}
              </h3>
              <button onClick={() => setIsFormOpen(false)} className="p-1 hover:bg-cream-100 rounded-xl text-ink-400 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCommitEvent} className="space-y-4">
              <div>
                <label className="field-label">Event title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Leo's dental clinic visit"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="field"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Date</label>
                  <input
                    type="date"
                    required
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="field font-mono"
                  />
                </div>
                <div>
                  <label className="field-label">Time</label>
                  <input
                    type="time"
                    value={eventTime}
                    onChange={(e) => setEventTime(e.target.value)}
                    className="field font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="field"
                  >
                    <option value="School">School / Homework</option>
                    <option value="Appointment">Medical appointment</option>
                    <option value="Travel">Family travel / Flights</option>
                    <option value="Milestone">Family milestone</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="flex items-center space-x-2 pt-7">
                  <input
                    type="checkbox"
                    id="remindBox"
                    checked={remindMe}
                    onChange={(e) => setRemindMe(e.target.checked)}
                    className="w-4 h-4 border-cream-300 text-clay-500 bg-white rounded focus:ring-clay-300 accent-clay-500"
                  />
                  <label htmlFor="remindBox" className="text-[13px] font-semibold text-ink-700 select-none cursor-pointer">
                    Enable reminders
                  </label>
                </div>
              </div>

              <div>
                <label className="field-label">Tag family members</label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {members.map(m => {
                    const isTagged = taggedMemberIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleToggleMemberTag(m.id)}
                        className={`px-3 py-1.5 text-[12px] font-semibold rounded-xl border transition-all flex items-center gap-1.5 cursor-pointer ${
                          isTagged
                            ? 'bg-clay-500 text-white border-clay-500 shadow-soft'
                            : 'bg-white text-ink-600 border-cream-300 hover:bg-cream-100'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${m.avatarColor}`}></span>
                        <span>{m.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="field-label">Description</label>
                <textarea
                  rows={2}
                  placeholder="Details for flights, doctor addresses or specific preparations..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="field"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-cream-200">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="btn-quiet"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                >
                  {editingEventId ? 'Save edits' : 'Schedule event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
