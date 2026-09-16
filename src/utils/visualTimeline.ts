import type { FamilyTimelineItem } from './familyTimeline';

export type TimelineScale = 'year' | 'month';
export interface TimelineChapter { key: string; index: number; label: string; items: FamilyTimelineItem[] }
// Calendar buckets deliberately avoid pretending an unknown school start date is January 1.
export function timelineChapters(items: FamilyTimelineItem[], year: number, month: number, scale: TimelineScale): TimelineChapter[] {
  const grouped = new Map<number, FamilyTimelineItem[]>();
  for (const item of items) {
    if (item.date.length !== 10 || Number(item.date.slice(0, 4)) !== year) continue;
    const itemMonth = Number(item.date.slice(5, 7)) - 1;
    if (scale === 'month' && itemMonth !== month) continue;
    const index = scale === 'year' ? itemMonth : Number(item.date.slice(8, 10)) - 1;
    grouped.set(index, [...(grouped.get(index) || []), item]);
  }
  return [...grouped.entries()].sort(([a], [b]) => a - b).map(([index, records]) => ({
    key: `${year}-${scale === 'year' ? index : month}-${scale === 'year' ? '' : index}`,
    index,
    label: new Date(year, scale === 'year' ? index : month, scale === 'year' ? 1 : index + 1)
      .toLocaleDateString(undefined, scale === 'year' ? { month: 'long' } : { day: 'numeric', month: 'short' }),
    items: records.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
  }));
}
export function timelineYears(items: FamilyTimelineItem[]): number[] {
  return [...new Set(items.flatMap(item => [item.date, item.endDate || '']).filter(Boolean).map(date => Number(date.slice(0, 4))))].sort((a, b) => a - b);
}
export function preferredTimelineYear(items: FamilyTimelineItem[], now = new Date()): number {
  const years = timelineYears(items);
  return years.includes(now.getFullYear()) ? now.getFullYear() : years.filter(year => year <= now.getFullYear()).at(-1) ?? years[0] ?? now.getFullYear();
}
// UTC arithmetic keeps residence bands stable across daylight-saving changes.
export function timelineRange(item: FamilyTimelineItem, year: number, month: number, scale: TimelineScale): { start: number; end: number } | null {
  if (item.date.length !== 10 || !item.endDate || item.endDate <= item.date) return null;
  const start = Date.UTC(year, scale === 'year' ? 0 : month, 1);
  const end = Date.UTC(year, scale === 'year' ? 12 : month + 1, 1);
  const from = Date.parse(`${item.date}T00:00:00Z`), to = Date.parse(`${item.endDate}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= end || to < start) return null;
  return { start: Math.max(0, (from - start) / (end - start)), end: Math.min(1, (to - start) / (end - start)) };
}
