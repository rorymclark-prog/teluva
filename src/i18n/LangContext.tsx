import React, { createContext, useContext, useState, useEffect } from 'react';
import { Strings, LangCode, LOCALES, getStoredLang, setStoredLang } from './locales';

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

  function setLang(l: LangCode) {
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
