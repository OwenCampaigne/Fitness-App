'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import type { WeeklyTrend } from '@/lib/types';
import type { UserProfile } from '@/lib/types';
import { useLang } from '@/lib/i18n';

/** Strip markdown headings, bold, italic so plain text renders cleanly */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')          // headings
    .replace(/\*\*(.*?)\*\*/g, '$1')       // bold
    .replace(/\*(.*?)\*/g, '$1')           // italic
    .replace(/`([^`]+)`/g, '$1')           // inline code
    .replace(/\n{3,}/g, '\n\n')            // collapse excess blank lines
    .trim();
}

interface Props {
  trend: WeeklyTrend;
  profile: UserProfile | null;
}

function todayKey(): string {
  return `garmin_ai_summary_${new Date().toISOString().slice(0, 10)}`;
}

function getCached(): string | null {
  try {
    return localStorage.getItem(todayKey());
  } catch { return null; }
}

function setCache(text: string): void {
  try {
    // Clear old keys
    Object.keys(localStorage)
      .filter(k => k.startsWith('garmin_ai_summary_') && k !== todayKey())
      .forEach(k => localStorage.removeItem(k));
    localStorage.setItem(todayKey(), text);
  } catch { /* ignore */ }
}

type Status = 'idle' | 'loading' | 'done' | 'error' | 'no_key';

export default function WeeklySummaryCard({ trend, profile }: Props) {
  const { t } = useLang();
  const [summary, setSummary] = useState<string>('');
  const [status, setStatus] = useState<Status>('idle');
  const [expanded, setExpanded] = useState(false);

  const generate = useCallback(async (force = false) => {
    if (!force) {
      const cached = getCached();
      if (cached) { setSummary(cached); setStatus('done'); return; }
    }

    setStatus('loading');
    setSummary('');

    try {
      const res = await fetch('/api/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recovery:   trend.recovery,
          hrv:        trend.hrv,
          sleepHours: trend.sleepHours,
          rhr:        trend.rhr,
          strain:     trend.strain,
          profile: profile ? {
            age:          profile.age,
            sex:          profile.sex,
            fitnessLevel: profile.fitnessLevel,
            goal:         profile.goal,
          } : undefined,
        }),
      });

      if (res.status === 503) {
        setStatus('no_key');
        return;
      }

      if (!res.ok) {
        setStatus('error');
        return;
      }

      const data = await res.json();
      const text: string = data.summary ?? '';
      setSummary(text);
      setCache(text);
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }, [trend, profile]);

  // Auto-generate on mount
  useEffect(() => {
    generate(false);
  }, [generate]);

  // ── No API key configured ────────────────────────────────────────────────────
  if (status === 'no_key') return null;

  // ── Loading skeleton ─────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <section className="border-t border-rule pt-3">
        <div className="flex items-baseline gap-3 mb-2">
          <h2 className="block-label mb-0">{t('weeklySummary.title')}</h2>
          <span className="ml-auto font-serif text-note italic text-faint">
            {t('weeklySummary.badge')}
          </span>
        </div>
        <div className="flex flex-col gap-2 pl-3 border-l border-rule">
          {[100, 90, 75].map((w, i) => (
            <div key={i} className="h-2.5 bg-rule animate-pulse" style={{ width: `${w}%` }} />
          ))}
        </div>
        <p className="marginalia mt-2 border-l-0 pl-0">{t('weeklySummary.generating')}</p>
      </section>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <section className="border-l-2 border-dashed border-rule pl-3 py-1">
        <p className="text-entry text-pencil">{t('weeklySummary.errorTitle')}</p>
        <p className="font-serif text-note italic text-faint mt-0.5">
          {t('weeklySummary.errorDesc')}
        </p>
        <button
          onClick={() => generate(true)}
          className="mt-1 font-serif text-note italic text-pencil hover:text-ink underline transition-colors"
        >
          {t('weeklySummary.retry')}
        </button>
      </section>
    );
  }

  // ── Idle (not generated yet — shouldn't show, but just in case) ──────────────
  if (status === 'idle') return null;

  // ── Done ─────────────────────────────────────────────────────────────────────
  // The coach speaks in the margin, in the serif, and is labelled as the coach.
  // Nothing here is a measurement, so nothing here is set in ink.
  return (
    <section className="border-t border-rule pt-3">
      <div className="flex items-baseline gap-3 mb-2">
        <h2 className="block-label mb-0">{t('weeklySummary.title')}</h2>
        <span className="ml-auto flex items-center gap-2">
          <span className="font-serif text-note italic text-faint">
            {t('weeklySummary.badge')}
          </span>
          <button
            onClick={() => generate(true)}
            title={t('weeklySummary.regenerate')}
            aria-label={t('weeklySummary.regenerate')}
            className="p-1 text-faint hover:text-ink transition-colors"
          >
            <RefreshCw size={11} />
          </button>
        </span>
      </div>

      <p
        className="prose-log text-entry text-pencil whitespace-pre-line pl-3 border-l border-rule"
        style={expanded ? undefined : {
          display: '-webkit-box',
          WebkitLineClamp: 5,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {stripMarkdown(summary)}
      </p>

      <button
        onClick={() => setExpanded(e => !e)}
        className="mt-1.5 flex items-center gap-1 font-serif text-note italic text-pencil hover:text-ink transition-colors"
      >
        {expanded ? (
          <><ChevronUp size={11} />{t('weeklySummary.readLess')}</>
        ) : (
          <><ChevronDown size={11} />{t('weeklySummary.readMore')}</>
        )}
      </button>

      <p className="font-serif text-note italic text-faint mt-1 text-right">
        {t('weeklySummary.footer')}
      </p>
    </section>
  );
}
