'use client';

import { useState, useEffect, useCallback } from 'react';
import { Sparkles, RefreshCw, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
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
      <div className="card">
        <div className="card-header mb-4">
          <Sparkles size={14} className="text-purple-400" />
          <span className="text-purple-400">{t('weeklySummary.title')}</span>
          <span className="ml-auto text-[10px] text-muted">{t('weeklySummary.badge')}</span>
        </div>
        <div className="flex flex-col gap-2">
          {[100, 90, 75].map((w, i) => (
            <div
              key={i}
              className="h-3 rounded animate-pulse bg-border"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
        <p className="text-[10px] text-muted mt-3 text-center animate-pulse">
          {t('weeklySummary.generating')}
        </p>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="card border-dashed">
        <div className="flex items-center gap-3">
          <AlertCircle size={16} className="text-muted flex-shrink-0" />
          <div className="flex-1">
            <p className="text-xs text-secondary font-medium">{t('weeklySummary.errorTitle')}</p>
            <p className="text-[10px] text-muted mt-0.5">{t('weeklySummary.errorDesc')}</p>
          </div>
          <button
            onClick={() => generate(true)}
            className="text-[10px] text-secondary hover:text-primary transition-colors underline"
          >
            {t('weeklySummary.retry')}
          </button>
        </div>
      </div>
    );
  }

  // ── Idle (not generated yet — shouldn't show, but just in case) ──────────────
  if (status === 'idle') return null;

  // ── Done ─────────────────────────────────────────────────────────────────────
  return (
    <div className="card">
      {/* Header */}
      <div className="card-header mb-3">
        <Sparkles size={14} className="text-purple-400" />
        <span className="text-purple-400">{t('weeklySummary.title')}</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-muted">{t('weeklySummary.badge')}</span>
          <button
            onClick={() => generate(true)}
            title={t('weeklySummary.regenerate')}
            className="p-1 rounded-lg hover:bg-surface text-muted hover:text-secondary transition-colors"
          >
            <RefreshCw size={11} />
          </button>
        </span>
      </div>

      {/* Summary text — collapsible */}
      <div className="relative">
        <p
          className="text-sm text-secondary leading-relaxed whitespace-pre-line transition-all duration-300"
          style={expanded ? undefined : {
            display: '-webkit-box',
            WebkitLineClamp: 5,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {stripMarkdown(summary)}
        </p>

        {/* Fade overlay when collapsed */}
        {!expanded && (
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[#111111] to-transparent pointer-events-none" />
        )}
      </div>

      {/* Expand / Collapse button */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="mt-2 flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300 transition-colors"
      >
        {expanded ? (
          <><ChevronUp size={11} />{t('weeklySummary.readLess')}</>
        ) : (
          <><ChevronDown size={11} />{t('weeklySummary.readMore')}</>
        )}
      </button>

      <p className="text-[9px] text-muted mt-2 text-right">
        {t('weeklySummary.footer')}
      </p>
    </div>
  );
}
