import type { FamilyTimelineItem } from './familyTimeline';

export type TimelineScale = 'life' | 'year' | 'month';
export interface TimelineChapter { key: string; index: number; label: string; items: FamilyTimelineItem[] }
export function lifeTimelineTicks(first: number, last: number, width: number, fitted: boolean): { year: number; position: number }[] {
  if (first === last) return [{ year: first, position: 0.5 }];
  const span = last - first + 1;
  const step = fitted ? ([1, 2, 5, 10, 20, 25, 50, 100].find(value => width / span * value >= 64) || 100) : 1;
  const ticks = [{ year: first, position: 0 }];
  for (let year = Math.ceil((first + 1) / step) * step; year < last; year += step) {
    const position = (year - first + 0.5) / span;
    if (position * width < 48 || (1 - position) * width < 48) continue;
    ticks.push({ year, position });
  }
  return [...ticks, { year: last, position: 1 }];
}
/** Group neighbouring calendar periods only when cards would overlap in Fit screen. */
export function fitTimelineChapters(chapters: TimelineChapter[], periodSlots: number, visibleSlots: number): TimelineChapter[] {
  if (visibleSlots >= periodSlots) return chapters;
  const grouped = new Map<number, TimelineChapter[]>();
  for (const chapter of chapters) {
    const index = Math.min(visibleSlots - 1, Math.floor(chapter.index * visibleSlots / periodSlots));
    grouped.set(index, [...(grouped.get(index) || []), chapter]);
  }
  return [...grouped.entries()].map(([index, group]) => ({
    key: `fit:${group[0].key}`, index,
    label: group.length === 1 ? group[0].label : `${group[0].label} – ${group.at(-1)!.label}`,
    items: group.flatMap(chapter => chapter.items),
  }));
}
// Calendar buckets deliberately avoid pretending an unknown school start date is January 1.
export function timelineChapters(items: FamilyTimelineItem[], year: number, month: number, scale: Exclude<TimelineScale, 'life'>): TimelineChapter[] {
  const grouped = new Map<number, FamilyTimelineItem[]>();
  for (const item of items) {
    if ((item.date.length !== 10 && !(scale === 'year' && item.date.length === 7)) || Number(item.date.slice(0, 4)) !== year) continue;
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
export function timelineRange(item: FamilyTimelineItem, year: number, month: number, scale: TimelineScale, lifeYears?: [number, number]): { start: number; end: number } | null {
  if (item.date.length !== 10 || !item.endDate || item.endDate <= item.date) return null;
  const start = scale === 'life' ? Date.UTC(lifeYears?.[0] ?? year, 0, 1) : Date.UTC(year, scale === 'year' ? 0 : month, 1);
  const end = scale === 'life' ? Date.UTC((lifeYears?.[1] ?? year) + 1, 0, 1) : Date.UTC(year, scale === 'year' ? 12 : month + 1, 1);
  const from = Date.parse(`${item.date}T00:00:00Z`), to = Date.parse(`${item.endDate}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= end || to < start) return null;
  return { start: Math.max(0, (from - start) / (end - start)), end: Math.min(1, (to - start) / (end - start)) };
}

// Life fits the complete recorded span on screen. Nearby years share a chapter
// when space is tight; every record remains available in that chapter's detail.
export function lifeTimelineChapters(items: FamilyTimelineItem[], slots: number, throughYear = new Date().getFullYear(), fromYear?: number): TimelineChapter[] {
  const years = timelineYears(items);
  if (!years.length) return [];
  slots = Math.max(1, Math.floor(slots));
  const first = Math.min(fromYear ?? years[0], years[0]), span = Math.max(throughYear, years.at(-1)!) - first + 1;
  const grouped = new Map<number, FamilyTimelineItem[]>();
  for (const item of items) {
    if (!item.date) continue;
    const index = Math.min(slots - 1, Math.floor((Number(item.date.slice(0, 4)) - first) * slots / span));
    grouped.set(index, [...(grouped.get(index) || []), item]);
  }
  return [...grouped.entries()].sort(([a], [b]) => a - b).map(([index, records]) => {
    records.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const from = records[0].date.slice(0, 4), to = records.at(-1)!.date.slice(0, 4);
    return { key: `life:${index}`, index, label: from === to ? from : `${from}–${to}`, items: records };
  });
}
