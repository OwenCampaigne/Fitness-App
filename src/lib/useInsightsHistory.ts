'use client';

import { useState, useEffect, useCallback } from 'react';
import { format, subDays, parseISO } from 'date-fns';

type InsightType = 'success' | 'warning' | 'danger' | 'info';

export interface InsightHistoryEntry {
  date: string;          // 'YYYY-MM-DD'
  worstType: InsightType;
  ids: string[];         // which insight ids fired
  recovery: number;
  sleepHours: number;
  hrv: number;
}

const KEY = 'insights_history';
const MAX_DAYS = 14;

const SEVERITY: Record<InsightType, number> = { danger: 0, warning: 1, success: 2, info: 3 };

function worstOf(types: InsightType[]): InsightType {
  return types.reduce((worst, t) =>
    SEVERITY[t] < SEVERITY[worst] ? t : worst
  , 'info' as InsightType);
}

function pruneOld(entries: InsightHistoryEntry[]): InsightHistoryEntry[] {
  const cutoff = format(subDays(new Date(), MAX_DAYS), 'yyyy-MM-dd');
  return entries.filter(e => e.date >= cutoff);
}

export function useInsightsHistory() {
  const [entries, setEntries] = useState<InsightHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed: InsightHistoryEntry[] = JSON.parse(raw);
        setEntries(pruneOld(parsed));
      }
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  const saveToday = useCallback((
    ids: string[],
    types: InsightType[],
    recovery: number,
    sleepHours: number,
    hrv: number,
  ) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    setEntries(prev => {
      const without = prev.filter(e => e.date !== today);
      const next = pruneOld([
        ...without,
        { date: today, worstType: worstOf(types), ids, recovery, sleepHours, hrv },
      ]).sort((a, b) => a.date.localeCompare(b.date));
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return { entries, saveToday, loaded };
}

// ── Pattern analysis helpers ───────────────────────────────────────────────────

export function analyzePatterns(entries: InsightHistoryEntry[]): string[] {
  if (entries.length < 3) return [];
  const patterns: string[] = [];

  const lowRecovery = entries.filter(e => e.recovery > 0 && e.recovery < 34).length;
  const modRecovery = entries.filter(e => e.recovery >= 34 && e.recovery < 67).length;
  const poorSleep   = entries.filter(e => e.sleepHours > 0 && e.sleepHours < 6.5).length;
  const dangerDays  = entries.filter(e => e.worstType === 'danger').length;

  if (lowRecovery >= 3)
    patterns.push(`${lowRecovery} días con recuperación baja esta semana — prioriza el descanso.`);
  else if (modRecovery >= 4)
    patterns.push(`${modRecovery} días con recuperación moderada — considera reducir la carga.`);

  if (poorSleep >= 3)
    patterns.push(`${poorSleep} noches con sueño insuficiente (<6.5h) — tu deuda de sueño aumenta.`);

  if (dangerDays >= 3)
    patterns.push(`${dangerDays} días en zona roja esta semana — tu cuerpo pide recuperación activa.`);

  // Positive patterns
  const goodDays = entries.filter(e => e.worstType === 'success').length;
  if (goodDays >= 4)
    patterns.push(`${goodDays} días con buenas señales de recuperación — ¡sigue así!`);

  return patterns;
}
