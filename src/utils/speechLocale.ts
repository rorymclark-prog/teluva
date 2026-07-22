// Maps the app's UI language (LangCode, see i18n/locales.ts) to a BCP-47
// speech-recognition locale for the Web Speech API. Pure — takes no `navigator`
// so it stays unit-testable; the caller passes the browser default as fallback.
//
// de → de-AT deliberately: the primary user is in Vienna, so Austrian German is
// the better recogniser hint than de-DE. Unknown codes return the fallback.

const SPEECH_LOCALES: Record<string, string> = {
  en: 'en-US',
  de: 'de-AT',
  es: 'es-ES',
  fr: 'fr-FR',
  pt: 'pt-PT',
  it: 'it-IT',
  nl: 'nl-NL',
  pl: 'pl-PL',
  af: 'af-ZA',
};

export function speechLocaleFor(lang: string, fallback = 'en-US'): string {
  return SPEECH_LOCALES[lang] ?? fallback;
}
