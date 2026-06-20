import React, { createContext, useContext, useState } from 'react';
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
