// Client-side EXIF-GPS extraction + fully offline reverse geocoding for the
// Travel Timeline feature. No network call, no API key.
//
// Verified before building this: `exifr@7.1.3` (zero deps) correctly reads
// GPS lat/lng out of a real GPS-tagged JPEG, and `@rapideditor/country-coder`
// (one dep: which-polygon) resolves coordinates to a country fully offline —
// iso1A2Code/feature() correctly turned Vienna into AT/Austria, Cape Town
// into ZA/South Africa, and Paris into FR/France with no network access.
//
// CRITICAL: this must run on the raw File, BEFORE utils/imageCompress.ts's
// compressImageToAvatar() touches it — that re-encodes via <canvas>.toDataURL,
// which strips ALL EXIF (GPS included). Parse first, compress after.
import exifr from 'exifr';
import { iso1A2Code, feature } from '@rapideditor/country-coder';

export interface TravelMeta {
  lat: number;
  lng: number;
  countryCode: string | null;
  countryName: string | null;
  /** YYYY-MM-DD, from the photo's capture date when present in EXIF. */
  date: string | null;
}

function toDateOnly(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Parse a raw photo File's embedded GPS EXIF tag and resolve it to a country
 * name/code, entirely client-side. Returns null when the photo has no GPS
 * EXIF data (or isn't a format exifr can read) — callers should fall back to
 * manual entry in that case, not treat it as an error.
 */
export async function extractTravelMeta(file: File): Promise<TravelMeta | null> {
  try {
    // Feed exifr an ArrayBuffer rather than the File object directly — avoids
    // exifr's FileReader-based blob reader path and works identically across
    // every environment that can produce a File (all target browsers support
    // File.prototype.arrayBuffer()).
    const buffer = await file.arrayBuffer();
    const output = await exifr.parse(buffer, { gps: true, exif: true });

    const lat = output?.latitude;
    const lng = output?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
      return null;
    }

    let countryCode: string | null = null;
    let countryName: string | null = null;
    try {
      countryCode = iso1A2Code([lng, lat]) || null;
      if (countryCode) {
        const feat = feature([lng, lat]);
        countryName = feat?.properties?.nameEn || countryCode;
      }
    } catch (e) {
      console.warn('country-coder offline lookup failed:', e);
    }

    const date = toDateOnly(output?.DateTimeOriginal) || toDateOnly(output?.CreateDate) || toDateOnly(output?.ModifyDate);

    return { lat, lng, countryCode, countryName, date };
  } catch (e) {
    console.warn('EXIF GPS parse failed — falling back to manual entry:', e);
    return null;
  }
}
