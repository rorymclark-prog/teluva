import React, { createContext, useContext, useState, useEffect } from 'react';
import { Strings, LangCode, LOCALES, getStoredLang, setStoredLang } from './locales';
import { PREFERENCE_EVENT, PREFERENCE_OVERRIDE_KEY } from '../utils/reviewedPreferences';

interface LangCtxValue {
  lang: LangCode;
  t: Strings;
  setLang: (l: LangCode) => void;
}

const LangContext = createContext<LangCtxValue>({
  lang: 'en',
  t: LOCALES.en,
  setLang: () => {},
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(getStoredLang);

  // index.html ships lang="en" and nothing ever changed it, so a screen
  // reader announced German and Spanish in an English voice.
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    const reviewed = (event: Event) => { const next = (event as CustomEvent).detail?.language;
      if (typeof next !== 'string' || !(next in LOCALES)) return;
      setStoredLang(next as LangCode); setLangState(next as LangCode);
    };
    window.addEventListener(PREFERENCE_EVENT, reviewed);
    return () => window.removeEventListener(PREFERENCE_EVENT, reviewed);
  }, []);

  function setLang(l: LangCode) {
    try { localStorage.setItem(PREFERENCE_OVERRIDE_KEY, String(Date.now())); } catch { /* private mode */ }
    setStoredLang(l);
    setLangState(l);
  }

  return (
    <LangContext.Provider value={{ lang, t: LOCALES[lang], setLang }}>
      {children}
    </LangContext.Provider>
  );
}

export function useT() {
  return useContext(LangContext);
}
