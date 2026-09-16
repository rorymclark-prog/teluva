import type { CalendarEvent } from '../types';
import { isMedicalFlaggedEvent } from './eventKeywordFlags';

/** Old Google imports labelled every event Appointment, including shopping.
 * Treat that legacy label as unconfirmed; keep the original calendar record.
 * Native appointments retain the category the user explicitly chose.
 */
export function isMedicalCalendarEvent(event: Pick<CalendarEvent, 'id' | 'category' | 'title' | 'description' | 'categoryConfirmed'>): boolean {
  if (event.category !== 'Appointment') return false;
  if (event.categoryConfirmed || !event.id.startsWith('gcal-')) return true;
  return hasMedicalCalendarContext(event);
}

export function calendarCategoryForEdit(event: CalendarEvent): CalendarEvent['category'] {
  return event.category === 'Appointment' && !isMedicalCalendarEvent(event) ? 'Other' : event.category;
}

export function hasMedicalCalendarContext(event: { title?: string; description?: string }): boolean {
  return isMedicalFlaggedEvent(event) || /\bDr\.?\s+\p{Lu}[\p{L}-]+/u.test(event.title || '');
}
