import { PREFERENCE_LANGUAGES, type ReviewPreferences } from './importInboxClient';

export const PREFERENCE_EVENT = 'teluva-reviewed-preferences';
export const PREFERENCE_OVERRIDE_KEY = 'teluva.preference-manual-override';
/** A later manual choice wins over an older approved suggestion on reload. */
export function applyReviewedPreferences(value: ReviewPreferences, reviewedAt?: string): boolean {
  if (!reviewedAt || !Number.isFinite(Date.parse(reviewedAt))) return false;
  try { if (Number(localStorage.getItem(PREFERENCE_OVERRIDE_KEY) || 0) > Date.parse(reviewedAt)) return false; } catch { /* private browsing */ }
  const preferences: ReviewPreferences = {};
  if (value.language && PREFERENCE_LANGUAGES.includes(value.language)) preferences.language = value.language;
  if (value.theme && ['system', 'light', 'dark'].includes(value.theme)) preferences.theme = value.theme;
  if (!Object.keys(preferences).length) return false;
  window.dispatchEvent(new CustomEvent(PREFERENCE_EVENT, { detail: preferences }));
  return true;
}
