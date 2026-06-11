import React, { useState, useEffect } from 'react';
import { CalendarEvent, FamilyMember } from '../types';
import { 
  Calendar, Clock, Plus, Trash2, Edit2, 
  Users, Check, Bell, ChevronLeft, ChevronRight, AlertCircle, X, Info,
  Cloud, RefreshCcw, Loader2, LogIn, Send, Download
} from 'lucide-react';
import { initAuth, googleSignIn, logout, getAccessToken } from '../utils/firebase';

interface FamilyCalendarProps {
  members: FamilyMember[];
  events: CalendarEvent[];
  onSaveEvents: (events: CalendarEvent[]) => void;
}

export default function FamilyCalendar({ members, events, onSaveEvents }: FamilyCalendarProps) {
  const today = new Date('2026-05-22'); // Aligning with current local time sequence
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth()); // 0-indexed
  const [selectedDateStr, setSelectedDateStr] = useState(today.toISOString().split('T')[0]);
  
  // Google Calendar Connection States
  const [needsAuth, setNeedsAuth] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isGoogleCalendarSyncing, setIsGoogleCalendarSyncing] = useState(false);
  const [calendarSyncError, setCalendarSyncError] = useState<string | null>(null);

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

  // Auto-sync when token is available
  useEffect(() => {
    if (token && events.length >= 0 && !isGoogleCalendarSyncing) {
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
          timeZone: 'UTC'
        },
        end: {
          dateTime: endDateTime,
          timeZone: 'UTC'
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
          start: { dateTime: startDateTime, timeZone: 'UTC' },
          end: { dateTime: endDateTime, timeZone: 'UTC' }
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
        const exists = events.some(e => e.title.toLowerCase() === (gEv.summary || '').toLowerCase());
        if (exists) return;

        const startVal = gEv.start?.dateTime || gEv.start?.date || '';
        if (!startVal) return;

        const datePart = startVal.substring(0, 10); // YYYY-MM-DD
        let timePart = '12:00';
        if (gEv.start?.dateTime) {
          timePart = startVal.substring(11, 16); // HH:MM
        }

        importedEvents.push({
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
  const [eventDate, setEventDate] = useState(today.toISOString().split('T')[0]);
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

  // Format date correctly YYYY-MM-DD
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

  // Quick reminder feed (Events in the next 10 days)
  const todayTime = new Date(selectedDateStr).getTime();
  const upcomingReminders = events.filter(e => {
    const evTime = new Date(e.date).getTime();
    const diffDays = (evTime - todayTime) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= 12; // Next 12 days
  }).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-6">
      {/* Notifications/Ref */}
      {reminderNote && (
        <div className="p-4 rounded-xl bg-gray-900 text-white text-xs flex items-center gap-2.5 animate-bounce shadow-md">
          <Bell className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{reminderNote}</span>
        </div>
      )}

      {/* Intro info bar */}
      <section className="border-b border-gray-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2 uppercase tracking-wider">
            <span className="w-1.5 h-3.5 bg-gray-900 rounded-full inline-block"></span>
            Family Hub Events &amp; Calendar
          </h3>
          <p className="text-xs text-gray-500 mt-1">Shared planning schedule. Coordinate flights, medical appointments, milestones, and school schedules seamlessly.</p>
        </div>

        <button
          onClick={handleOpenAddForm}
          className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-gray-950 hover:bg-black rounded-xl transition-all shadow-sm cursor-pointer ml-auto sm:ml-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Schedule New Event</span>
        </button>
      </section>

      {/* Google Calendar Synchronization Panel */}
      <div className="bg-white border border-gray-150 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-2xs">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 shrink-0">
            <Cloud className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-800 uppercase tracking-widest flex items-center gap-1.5">
              Google Calendar Synchronization
              {needsAuth ? (
                <span className="text-[9px] bg-slate-50 text-slate-500 border border-slate-200 px-2 py-0.5 rounded font-bold uppercase tracking-wider font-mono">
                  Offline
                </span>
              ) : (
                <span className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded font-bold uppercase tracking-wider font-mono flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></span>
                  Connected
                </span>
              )}
            </h4>
            <p className="text-xs text-gray-400 font-light mt-0.5">
              {needsAuth 
                ? "Link your Google account or workspace to enable active event import and exports."
                : `Active connection established with ${user?.email || 'Google account'}.`
              }
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {calendarSyncError && (
            <span className="text-[10px] text-red-650 font-medium mr-2 max-w-[200px] truncate leading-tight">
              ⚠️ {calendarSyncError}
            </span>
          )}

          {needsAuth ? (
            <button
              onClick={handleLoginGoogle}
              disabled={isLoggingIn}
              className="w-full sm:w-auto px-4 py-1.5 bg-gray-950 border border-gray-950 text-white rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer hover:bg-black flex items-center justify-center gap-1.5 shadow-2xs select-none"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Authorizing...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Connect Google Calendar</span>
                </>
              )}
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
              <button
                onClick={handleImportFromGoogle}
                disabled={isGoogleCalendarSyncing}
                className="flex-1 sm:flex-none px-3 py-1.5 bg-white border border-gray-250 text-gray-700 hover:text-gray-950 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isGoogleCalendarSyncing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-450" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-gray-500" />
                )}
                <span>Import Schedule</span>
              </button>

              <button
                onClick={handleExportAllToGoogle}
                disabled={isGoogleCalendarSyncing}
                className="flex-1 sm:flex-none px-3 py-1.5 bg-gray-950 hover:bg-black text-white font-bold uppercase tracking-wider rounded-xl text-[10px] flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isGoogleCalendarSyncing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>Export All Events</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Layout: Calendar Grid (LEFT) + Daily Activities (RIGHT) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* MONTH CALENDAR CONTAINER: Col 12 on mobile, Col 7 on desktop */}
        <div className="lg:col-span-7 bg-white border border-gray-150 rounded-2xl p-5 shadow-xs space-y-4">
          
          {/* Calendar Header with Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-900" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-900">
                {monthNames[currentMonth]} {currentYear}
              </h4>
            </div>

            <div className="flex items-center space-x-1">
              <button
                onClick={handlePrevMonth}
                className="p-1 px-1.5 hover:bg-gray-55 rounded-lg border border-gray-200 text-gray-600 transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleNextMonth}
                className="p-1 px-1.5 hover:bg-gray-55 rounded-lg border border-gray-200 text-gray-600 transition-colors cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Weekday Labels */}
          <div className="grid grid-cols-7 gap-1 text-center font-semibold text-[10px] text-gray-400 uppercase tracking-widest pb-1">
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
                return <div key={`empty-${index}`} className="aspect-square bg-gray-50/40 rounded-lg" />;
              }

              const dateStr = formatDateString(cellDate);
              const isSelected = selectedDateStr === dateStr;
              const isCurrentDay = today.toISOString().split('T')[0] === dateStr;
              
              // Count scheduled events for this day
              const dayEvents = events.filter(e => e.date === dateStr);
              const hasEvents = dayEvents.length > 0;

              return (
                <button
                  key={`day-${cellDate.getDate()}`}
                  onClick={() => handleDaySelect(cellDate)}
                  className={`aspect-square relative rounded-xl transition-all flex flex-col items-center justify-center cursor-pointer border text-xs ${
                    isSelected
                      ? 'bg-gray-950 border-gray-950 text-white font-bold shadow-xs scale-102 z-10'
                      : isCurrentDay
                        ? 'bg-gray-100 border-gray-300 text-gray-900 font-bold'
                        : 'bg-white border-gray-100 text-gray-700 hover:border-gray-250 hover:bg-gray-50/50'
                  }`}
                >
                  <span className="text-xs leading-none">{cellDate.getDate()}</span>
                  
                  {/* Event Marker Dots */}
                  {hasEvents && (
                    <div className="absolute bottom-1.5 flex space-x-0.5 justify-center">
                      {dayEvents.slice(0, 3).map((e, dotIndex) => (
                        <span 
                          key={e.id} 
                          className={`w-1 h-1 rounded-full ${
                            isSelected 
                              ? 'bg-white' 
                              : e.category === 'School' ? 'bg-indigo-500' :
                                e.category === 'Travel' ? 'bg-amber-500' :
                                e.category === 'Appointment' ? 'bg-emerald-500' :
                                'bg-gray-400'
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
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-3.5 border-t border-gray-100 text-[10px] text-gray-505 font-mono">
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block"></span>
              <span>School</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block"></span>
              <span>Travel</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
              <span>Appointment</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block"></span>
              <span>Other</span>
            </div>
          </div>
        </div>

        {/* RIGHT AREA: Day specific events & Upcoming feed */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* EVENTS LISTED ON SELECTED DAY */}
          <section className="bg-white border border-gray-150 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <h4 className="text-[10px] font-bold text-gray-950 uppercase tracking-widest">
                Agenda: {selectedDateStr}
              </h4>
              <span className="text-[10px] font-semibold text-gray-450 font-mono">
                {selectedDayEvents.length} list items
              </span>
            </div>

            {selectedDayEvents.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-xs italic">
                No events scheduled. Choose a date and click &ldquo;Schedule New Event&rdquo; to start.
              </div>
            ) : (
              <div className="space-y-3">
                {selectedDayEvents.map(ev => {
                  // Find involved family members
                  const assignedMembers = members.filter(m => ev.memberIds?.includes(m.id));

                  return (
                    <div 
                      key={ev.id} 
                      className={`p-4 rounded-xl border flex flex-col gap-2.5 transition-all text-xs ${
                        ev.category === 'School' ? 'bg-indigo-50/40 border-indigo-100/50 text-indigo-950' :
                        ev.category === 'Travel' ? 'bg-amber-50/40 border-amber-100/50 text-amber-950' :
                        ev.category === 'Appointment' ? 'bg-emerald-50/40 border-emerald-100/50 text-emerald-950' :
                        'bg-gray-50/60 border-gray-150 text-gray-950'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <h5 className="font-bold text-gray-900 leading-snug">{ev.title}</h5>
                          {ev.time && (
                            <p className="flex items-center gap-1 text-[10.5px] font-semibold text-gray-500 font-mono">
                              <Clock className="w-3 h-3" />
                              {ev.time}
                            </p>
                          )}
                        </div>

                        {/* Event Category Tag */}
                        <span className="text-[9px] font-bold tracking-widest px-1.5 py-0.2 rounded uppercase bg-white border border-gray-200">
                          {ev.category}
                        </span>
                      </div>

                      {ev.description && (
                        <p className="text-[11px] text-gray-700 leading-snug font-light italic">
                          &ldquo;{ev.description}&rdquo;
                        </p>
                      )}

                      {/* Tagged members + Remind Indicator */}
                      <div className="flex items-center justify-between pt-2 border-t border-gray-200/50">
                        {/* Avatar tag bubbles */}
                        <div className="flex items-center space-x-1.5">
                          <Users className="w-3 h-3 text-gray-400 mr-0.5" />
                          {assignedMembers.length === 0 ? (
                            <span className="text-[10px] text-gray-400">All Family</span>
                          ) : (
                            <div className="flex -space-x-1">
                              {assignedMembers.map(m => (
                                m.avatarUrl ? (
                                  <span 
                                    key={m.id} 
                                    className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center border border-white shrink-0"
                                    title={m.name}
                                  >
                                    <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover" />
                                  </span>
                                ) : (
                                  <span 
                                    key={m.id} 
                                    className={`w-4 h-4 rounded-full ${m.avatarColor} text-[8px] font-bold text-white flex items-center justify-center border border-white shrink-0`}
                                    title={m.name}
                                  >
                                    {m.name.charAt(0)}
                                  </span>
                                )
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Reminder bell indicator */}
                        <div className="flex items-center space-x-1.5 shrink-0">
                          {ev.remindMe && (
                            <span className="text-[9px] uppercase tracking-wide font-bold bg-gray-900 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Bell className="w-2.5 h-2.5" />
                              Alert Active
                            </span>
                          )}
                          {!needsAuth && (
                            <button
                              onClick={() => pushEventToGoogle(ev)}
                              className="p-1 hover:bg-white rounded text-emerald-600"
                              title="Sync to Google Calendar"
                            >
                              <Cloud className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleOpenEditForm(ev)}
                            className="p-1 hover:bg-white rounded text-gray-500"
                            title="Edit Event"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleDeleteEvent(ev.id)}
                            className="p-1 hover:bg-white rounded text-red-650"
                            title="Delete Event"
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

          {/* SHARED FAMILY NOTIFICATIONS SIDEBAR */}
          <section className="bg-white border border-gray-150 rounded-2xl p-5 shadow-xs space-y-4">
            <h4 className="text-[10px] font-bold text-gray-950 uppercase tracking-widest flex items-center gap-1.5pb-2 border-b border-gray-100">
              <Bell className="w-4 h-4 text-gray-500" />
              Upcoming Shared Reminders
            </h4>

            {upcomingReminders.length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-xs italic font-sans">
                No scheduled reminders inside the next 12 days.
              </div>
            ) : (
              <div className="space-y-3 text-xs leading-normal max-h-56 overflow-y-auto pr-1">
                {upcomingReminders.slice(0, 5).map(rem => (
                  <div key={rem.id} className="flex gap-2.5 items-start bg-gray-50 border border-gray-150 p-2.5 rounded-xl hover:bg-gray-100/50 transition-colors">
                    <Info className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-gray-900 truncate pr-0.5">{rem.title}</p>
                      <p className="font-mono text-[9px] text-gray-400 mt-0.5">{rem.date} {rem.time ? `• ${rem.time}` : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      </div>

      {/* MODAL LIGHT FORM FOR CREATING / DOCUMENTATION UPDATES */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs" onClick={() => setIsFormOpen(false)} />
          
          <div className="relative bg-white border border-gray-150 rounded-2xl p-6 shadow-xl w-full max-w-md space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">
                {editingEventId ? 'Edit Scheduled Event' : 'Create New Event'}
              </h3>
              <button onClick={() => setIsFormOpen(false)} className="p-1 hover:bg-gray-55 rounded text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCommitEvent} className="space-y-4 text-xs">
              <div>
                <label className="block text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                  Event Title
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Leo's Dental Clinic Visit"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-950 font-sans"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                    Scheduled Date
                  </label>
                  <input
                    type="date"
                    required
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-250 rounded-xl focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                    Scheduled Time
                  </label>
                  <input
                    type="time"
                    value={eventTime}
                    onChange={(e) => setEventTime(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-250 rounded-xl focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                    Category Type
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full px-3 py-2 bg-white border border-gray-250 rounded-xl focus:outline-none"
                  >
                    <option value="School">School / Homework</option>
                    <option value="Appointment">Medical Appointment</option>
                    <option value="Travel">Family Travel / Flights</option>
                    <option value="Milestone">Family Milestone</option>
                    <option value="Other">Other Events</option>
                  </select>
                </div>
                <div className="flex items-center space-x-2 pt-5">
                  <input
                    type="checkbox"
                    id="remindBox"
                    checked={remindMe}
                    onChange={(e) => setRemindMe(e.target.checked)}
                    className="w-4 h-4 border-gray-250 text-gray-900 bg-white rounded focus:ring-gray-900 focus:ring-0 accent-gray-950"
                  />
                  <label htmlFor="remindBox" className="text-[10px] font-bold text-gray-700 tracking-wide select-none cursor-pointer">
                    Enable Reminder Bells
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                  Tag Family Members (Enables Shared Calendar Access)
                </label>
                <div className="flex flex-wrap gap-2.5 pt-1">
                  {members.map(m => {
                    const isTagged = taggedMemberIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleToggleMemberTag(m.id)}
                        className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-lg border transition-all flex items-center gap-1 cursor-pointer ${
                          isTagged 
                            ? 'bg-gray-900 text-white border-gray-950' 
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
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
                <label className="block text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                  Event Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Details for flights, doctor addresses or specific preparations..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-950"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 bg-white border border-gray-200 text-gray-500 rounded-xl text-xs font-semibold hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-gray-950 hover:bg-black text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
                >
                  {editingEventId ? 'Save Edits' : 'Schedule Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
