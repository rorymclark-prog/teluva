import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { EMBER_THREAD_ENABLED } from '../config/features';

export type ThemePreference = 'system' | 'light' | 'dark';
export type InterfacePreference = 'ember' | 'classic';

interface AppearanceValue {
  theme: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  interfacePreference: InterfacePreference;
  setTheme: (theme: ThemePreference) => void;
  setInterfacePreference: (preference: InterfacePreference) => void;
}

const THEME_KEY = 'teluva.theme';
const INTERFACE_KEY = 'teluva.interface';

function storedTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === 'system' || value === 'light' || value === 'dark') return value;
  } catch { /* private mode */ }
  return 'system';
}

function storedInterface(): InterfacePreference {
  const requested = new URLSearchParams(window.location.search).get('ui');
  if (requested === 'classic' || requested === 'ember') return requested;
  try {
    const value = localStorage.getItem(INTERFACE_KEY);
    if (value === 'classic' || value === 'ember') return value;
  } catch { /* private mode */ }
  return EMBER_THREAD_ENABLED ? 'ember' : 'classic';
}

function systemTheme(): 'light' | 'dark' {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const AppearanceContext = createContext<AppearanceValue | null>(null);

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(storedTheme);
  const [interfacePreference, setInterfaceState] = useState<InterfacePreference>(storedInterface);
  const [system, setSystem] = useState<'light' | 'dark'>(systemTheme);
  const resolvedTheme = theme === 'system' ? system : theme;

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystem(media.matches ? 'dark' : 'light');
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.interface = interfacePreference;
    document.documentElement.style.colorScheme = resolvedTheme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute('content', resolvedTheme === 'dark' ? '#0B0B0D' : '#E9433B');
  }, [resolvedTheme, interfacePreference]);

  const setTheme = (next: ThemePreference) => {
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
    setThemeState(next);
  };

  const setInterfacePreference = (next: InterfacePreference) => {
    try { localStorage.setItem(INTERFACE_KEY, next); } catch { /* private mode */ }
    // An explicit preview URL is useful until the reader makes a choice. Once
    // they do, remove only that override so their rollback preference survives
    // reloads while every unrelated query parameter stays intact.
    const url = new URL(window.location.href);
    if (url.searchParams.has('ui')) {
      url.searchParams.delete('ui');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
    setInterfaceState(next);
  };

  const value = useMemo<AppearanceValue>(() => ({
    theme,
    resolvedTheme,
    interfacePreference,
    setTheme,
    setInterfacePreference,
  }), [theme, resolvedTheme, interfacePreference]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useAppearance must be used inside AppearanceProvider');
  return value;
}
