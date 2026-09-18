'use client';

import { createContext, useContext, useState, useEffect, createElement } from 'react';
import type { ReactNode } from 'react';
import en from '@/locales/en';

// ── Types ─────────────────────────────────────────────────────────────────────
export type Locale = 'es' | 'en';

// ── Simple nested-key resolver with {var} interpolation ──────────────────────
function resolve(obj: Record<string, unknown>, key: string): string {
  const parts = key.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[p];
    else return key;
  }
  return typeof cur === 'string' ? cur : key;
}

export function interpolate(
  str: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return str;
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
    str,
  );
}

function resolveArr(obj: Record<string, unknown>, key: string): string[] {
  const parts = key.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[p];
    else return [];
  }
  return Array.isArray(cur) ? cur.map(String) : [];
}

// ── Context ───────────────────────────────────────────────────────────────────
interface LangContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  tArr: (key: string) => string[];
}

const LangContext = createContext<LangContextType>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => key,
  tArr: () => [],
});

// ── Provider ─────────────────────────────────────────────────────────────────
export function LangProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  // Seeded statically rather than left empty. `messages` used to start as {}
  // and fill in an effect, so the server render and the first paint showed raw
  // keys — a visible flash of "nav.home" and "today.loading" on every cold
  // load. A bundled default costs one locale's weight and removes it.
  const [messages, setMessages] = useState<Record<string, unknown>>(
    en as unknown as Record<string, unknown>,
  );

  // Load locale file + apply saved preference
  useEffect(() => {
    const saved = localStorage.getItem('garmin_lang') as Locale | null;
    const detected = navigator.language.startsWith('es') ? 'es' : 'en';
    const lang: Locale = saved === 'en' || saved === 'es' ? saved : detected;
    setLocaleState(lang);
  }, []);

  useEffect(() => {
    import(`@/locales/${locale}`)
      .then((mod) => setMessages(mod.default))
      .catch(() => {});
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('garmin_lang', l);
  };

  const t = (key: string, vars?: Record<string, string | number>) =>
    interpolate(resolve(messages, key) || key, vars);

  const tArr = (key: string): string[] => resolveArr(messages, key);

  return createElement(LangContext.Provider, { value: { locale, setLocale, t, tArr } }, children);
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useLang() {
  return useContext(LangContext);
}
