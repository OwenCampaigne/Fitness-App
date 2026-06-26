'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'weight_log';

export interface WeightEntry {
  date: string;   // 'YYYY-MM-DD'
  weight: number; // kg
}

export function useWeightLog() {
  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setEntries(JSON.parse(raw));
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  const persist = (list: WeightEntry[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch { /* ignore */ }
    setEntries(list);
  };

  const addEntry = (date: string, weight: number) => {
    const filtered = entries.filter(e => e.date !== date);
    const next = [...filtered, { date, weight }].sort((a, b) => a.date.localeCompare(b.date));
    persist(next);
  };

  const removeEntry = (date: string) => {
    persist(entries.filter(e => e.date !== date));
  };

  return { entries, addEntry, removeEntry, loaded };
}
