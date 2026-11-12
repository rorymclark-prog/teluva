import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { PREFERENCE_EVENT, PREFERENCE_OVERRIDE_KEY } from '../utils/reviewedPreferences';

export type ThemePreference = 'system' | 'light' | 'dark';

interface AppearanceValue {
  theme: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemePreference) => void;
}

const THEME_KEY = 'teluva.theme';

function storedTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === 'system' || value === 'light' || value === 'dark') return value;
  } catch { /* private mode */ }
  return 'system';
}

function systemTheme(): 'light' | 'dark' {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const AppearanceContext = createContext<AppearanceValue | null>(null);

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(storedTheme);
  const [system, setSystem] = useState<'light' | 'dark'>(systemTheme);
  const resolvedTheme = theme === 'system' ? system : theme;
  useEffect(() => {
    const reviewed = (event: Event) => { const next = (event as CustomEvent).detail?.theme;
      if (!['system', 'light', 'dark'].includes(next)) return;
      try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
      setThemeState(next);
    };
    window.addEventListener(PREFERENCE_EVENT, reviewed);
    return () => window.removeEventListener(PREFERENCE_EVENT, reviewed);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystem(media.matches ? 'dark' : 'light');
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.interface = 'ember';
    document.documentElement.style.colorScheme = resolvedTheme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute('content', resolvedTheme === 'dark' ? '#0B0B0D' : '#E9433B');
  }, [resolvedTheme]);

  const setTheme = (next: ThemePreference) => {
    try { localStorage.setItem(THEME_KEY, next); localStorage.setItem(PREFERENCE_OVERRIDE_KEY, String(Date.now())); } catch { /* private mode */ }
    setThemeState(next);
  };

  const value = useMemo<AppearanceValue>(() => ({
    theme,
    resolvedTheme,
    setTheme,
  }), [theme, resolvedTheme]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useAppearance must be used inside AppearanceProvider');
  return value;
}
