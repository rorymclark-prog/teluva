import React, { useState, useRef, useEffect } from 'react';
import { Globe } from 'lucide-react';
import { useT } from '../i18n/LangContext';
import { LangCode, LANGUAGE_NAMES } from '../i18n/locales';

const FLAGS: Record<LangCode, string> = {
  en: '🇬🇧',
  de: '🇩🇪',
  es: '🇪🇸',
  fr: '🇫🇷',
  pt: '🇵🇹',
  it: '🇮🇹',
  nl: '🇳🇱',
  pl: '🇵🇱',
  af: '🇿🇦',
};

export default function LanguageSelector() {
  const { lang, t, setLang } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title={t.lbl_language}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-cream-200 bg-white hover:bg-cream-100 text-ink-600 text-xs font-medium transition-colors"
      >
        <Globe className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{FLAGS[lang]}</span>
        <span className="hidden sm:inline">{LANGUAGE_NAMES[lang]}</span>
        <span className="sm:hidden">{FLAGS[lang]}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-44 bg-white border border-cream-200 rounded-2xl shadow-xl z-50 overflow-hidden py-1">
          {(Object.keys(LANGUAGE_NAMES) as LangCode[]).map(code => (
            <button
              key={code}
              onClick={() => { setLang(code); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left hover:bg-cream-100 transition-colors ${
                code === lang ? 'text-clay-600 font-semibold bg-clay-50' : 'text-ink-700'
              }`}
            >
              <span className="text-base leading-none">{FLAGS[code]}</span>
              <span>{LANGUAGE_NAMES[code]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
