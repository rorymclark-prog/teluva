export type CalendarView = 'day' | 'week' | 'month';
export function calendarDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function calendarViewDates(selected: string, view: CalendarView): string[] {
  const [y, m, d] = selected.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12);
  if (view === 'week') date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return Array.from({ length: view === 'week' ? 7 : 1 }, (_, i) => {
    const day = new Date(date); day.setDate(day.getDate() + i); return calendarDateKey(day);
  });
}
export function navigateCalendarDate(selected: string, view: CalendarView, direction: number): string {
  const [y, m, d] = selected.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12);
  if (view === 'month') { date.setDate(1); date.setMonth(date.getMonth() + direction); }
  else date.setDate(date.getDate() + direction * (view === 'week' ? 7 : 1));
  return calendarDateKey(date);
}
