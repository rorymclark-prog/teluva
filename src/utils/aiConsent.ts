import { AiConsent } from '../types';

// Bump this when the AI data-processing terms change materially — existing users
// then fall out of consent and are re-prompted before AI runs again.
export const AI_CONSENT_VERSION = 1;

// AI is OFF unless the user has an explicit, current grant.
export function hasValidAiConsent(c?: AiConsent | null): boolean {
  return !!c && c.granted === true && (c.version ?? 0) >= AI_CONSENT_VERSION;
}
