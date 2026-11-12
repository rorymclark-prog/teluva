import exifr from 'exifr';
import { feature, iso1A2Code } from '@rapideditor/country-coder';
import type { TravelTimelineEntry } from '../types';
import type { FileOperationScope } from './fileOperationScope';

export const ATLAS_KINDS = { holiday: 'Holiday', home: 'Home', event: 'Special event', visit: 'Visit' } as const;
export const atlasKind = (entry: TravelTimelineEntry) => entry.kind && entry.kind in ATLAS_KINDS ? entry.kind : 'visit';
export const atlasTitle = (entry: TravelTimelineEntry) => entry.title?.trim() || entry.place?.trim() || entry.country?.trim() || 'Untitled place';
export const validAtlasPoint = (lat: unknown, lng: unknown): boolean => typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
export const hasAtlasPoint = (entry: TravelTimelineEntry) => validAtlasPoint(entry.lat, entry.lng);

export function atlasDate(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').slice(0, 10)
    : value instanceof Date && Number.isFinite(value.getTime()) ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw + 'T12:00:00Z')) && new Date(raw + 'T12:00:00Z').toISOString().slice(0, 10) === raw ? raw : null;
}
export function atlasDateLabel(entry: TravelTimelineEntry): string {
  const format = (value: string) => {
    if (!atlasDate(value)) return 'Date unknown';
    if (entry.datePrecision === 'year') return value.slice(0, 4);
    return new Date(value + 'T12:00:00Z').toLocaleDateString('en-GB', entry.datePrecision === 'month' ? { month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' });
  };
  return entry.date ? `${format(entry.date)}${entry.endDate ? ` – ${format(entry.endDate)}` : ''}` : 'Date unknown';
}
export function atlasDateInput(value: string | undefined, precision: TravelTimelineEntry['datePrecision']): string {
  return (value || '').slice(0, precision === 'year' ? 4 : precision === 'month' ? 7 : 10);
}
export function atlasDateFromInput(value: string, precision: TravelTimelineEntry['datePrecision']): string {
  if (!value) return '';
  return precision === 'year' && /^\d{4}$/.test(value) ? `${value}-01-01` : precision === 'month' && /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
}
export function changeAtlasPrecision(entry: TravelTimelineEntry, precision: NonNullable<TravelTimelineEntry['datePrecision']>): TravelTimelineEntry {
  const rank = { year: 0, month: 1, day: 2 };
  const needsMoreEvidence = rank[precision] > rank[entry.datePrecision || 'day'];
  return { ...entry, datePrecision: precision,
    date: needsMoreEvidence ? '' : atlasDateFromInput(atlasDateInput(entry.date, precision), precision),
    endDate: needsMoreEvidence ? undefined : atlasDateFromInput(atlasDateInput(entry.endDate, precision), precision) || undefined };
}
export function atlasCountry(lat: number, lng: number): { country: string; countryCode?: string } {
  if (!validAtlasPoint(lat, lng)) return { country: '' };
  try { const countryCode = iso1A2Code([lng, lat]) || undefined; return { country: countryCode ? feature([lng, lat])?.properties?.nameEn || countryCode : '', countryCode }; }
  catch { return { country: '' }; }
}

/** Read original metadata before any canvas conversion. Never replace a
 * missing capture date with upload time or the file's modification date. */
export async function readAtlasPhotoMetadata(file: File): Promise<Partial<TravelTimelineEntry>> {
  try {
    const metadata = await exifr.parse(await file.arrayBuffer(), { gps: true, exif: true, reviveValues: false });
    const result = atlasPhotoMetadata(metadata);
    return { ...result, photoMetadata: { ...result.photoMetadata!, originalName: file.name } };
  } catch { return { date: '', source: 'manual', photoMetadata: { status: 'read-error', originalName: file.name } }; }
}
export function atlasPhotoMetadata(metadata: Record<string, unknown> | null | undefined): Partial<TravelTimelineEntry> {
  const date = atlasDate(metadata?.DateTimeOriginal) || atlasDate(metadata?.CreateDate) || '';
  const lat = metadata?.latitude, lng = metadata?.longitude;
  const valid = validAtlasPoint(lat, lng);
  const hadGps = lat !== undefined || lng !== undefined || metadata?.GPSLatitude !== undefined || metadata?.GPSLongitude !== undefined;
  return { date, ...(valid ? { lat: lat as number, lng: lng as number, ...atlasCountry(lat as number, lng as number), source: 'exif' as const } : { source: 'manual' as const }),
    photoMetadata: { status: valid ? 'gps' : hadGps ? 'invalid-gps' : 'no-gps', ...(date ? { date, dateOrigin: 'embedded' } : {}) } };
}

export function atlasLocationStatus(entry: Partial<TravelTimelineEntry>): string {
  if (validAtlasPoint(entry.lat, entry.lng)) return entry.source === 'exif' ? 'Photo GPS' : 'Map location set';
  switch (entry.photoMetadata?.status) {
    case 'gps': return 'Photo GPS available — not applied to this memory';
    case 'no-gps': return 'No GPS in the chosen original';
    case 'read-error': return 'Photo metadata could not be read';
    case 'invalid-gps': return 'Photo GPS is invalid — choose a location';
    case 'provider-limited': return 'This photo source supplied no GPS';
    default: return entry.photoUrl || entry.sourceFileName ? 'Original photo metadata not checked' : 'Location not set';
  }
}

export interface AtlasPhotoDraft { entry: TravelTimelineEntry; selected: boolean; error?: string }
export async function prepareAtlasPhotoDrafts(files: File[], options: {
  scope: FileOperationScope;
  metadata?: typeof readAtlasPhotoMetadata;
  thumbnail: (file: File) => Promise<string>;
  onProgress?: (done: number, total: number) => void;
}): Promise<AtlasPhotoDraft[]> {
  if (files.length > 20) throw new Error('Choose up to 20 photos at a time.');
  const result: AtlasPhotoDraft[] = [];
  for (const file of files) {
    options.scope.check();
    const entry: TravelTimelineEntry = { id: crypto.randomUUID(), country: '', date: '', source: 'manual', kind: 'holiday', sourceFileName: file.name };
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Choose a photo smaller than 20 MB.');
      if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif|avif|tiff?)$/i.test(file.name)) throw new Error('Choose an image original or exported photo.');
      Object.assign(entry, await options.scope.step(() => (options.metadata || readAtlasPhotoMetadata)(file)));
      entry.photoUrl = await options.scope.step(() => options.thumbnail(file));
      // Several pictures from one place/day become one suggested memory.
      // Keep the best cover by deselecting alternatives; no file is uploaded here.
      const similar = result.some(other => other.selected && entry.date && entry.date === other.entry.date && hasAtlasPoint(entry) && hasAtlasPoint(other.entry)
        && Math.abs(entry.lat! - other.entry.lat!) < 0.01 && Math.abs(entry.lng! - other.entry.lng!) < 0.01);
      result.push({ entry, selected: !similar });
    } catch (error) {
      if (!options.scope.isCurrent()) throw error;
      result.push({ entry, selected: false, error: error instanceof Error ? error.message : 'Could not read this photo.' });
    }
    options.onProgress?.(result.length, files.length);
  }
  return result;
}

export function filterAtlas(entries: TravelTimelineEntry[], filter: { query?: string; kind?: string; year?: string; memberId?: string; memberIds?: string[]; peopleOnly?: boolean; unmapped?: boolean }): TravelTimelineEntry[] {
  const query = filter.query?.trim().toLocaleLowerCase();
  return entries.filter(entry => (!filter.kind || atlasKind(entry) === filter.kind)
    && (!filter.year || entry.date?.slice(0, 4) === filter.year)
    && (!filter.memberId || entry.memberIds?.includes(filter.memberId))
    && (!filter.peopleOnly || !!filter.memberIds?.length && entry.memberIds?.some(id => filter.memberIds!.includes(id)))
    && (!filter.unmapped || !hasAtlasPoint(entry))
    && (!query || [entry.title, entry.place, entry.country, entry.notes].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id));
}

export function validateAtlasEntry(entry: TravelTimelineEntry): string | null {
  if (![entry.title, entry.place, entry.country].some(value => value?.trim())) return 'Add a title, place or country.';
  if (entry.date && !atlasDate(entry.date)) return 'Choose a valid start date, or leave it unknown.';
  if (entry.endDate && (!atlasDate(entry.endDate) || !entry.date || entry.endDate < entry.date)) return 'The end date must be on or after the start date.';
  if ((entry.lat !== undefined || entry.lng !== undefined) && !hasAtlasPoint(entry)) return 'Choose a valid map pin, or clear both coordinates.';
  return null;
}
