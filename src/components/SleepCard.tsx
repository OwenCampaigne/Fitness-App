'use client';

// ── Sleep ─────────────────────────────────────────────────────────────────────
// Stages are four categories, so they take four series tokens and a legend
// that names each one — the swatch is a convenience, the word is the label.
// The duration rule is the only thing here that can be a verdict, and only
// because "under six hours" is one.

import type { SleepData } from '@/lib/types';
import type { MetricBenchmark } from '@/lib/benchmarks';
import { formatDuration } from '@/lib/scoring';
import BenchmarkBadge from './ui/BenchmarkBadge';
import LogSection from './ui/LogSection';
import { CAUTION, SERIES, STOP } from './ui/chartTheme';
import { useLang } from '@/lib/i18n';

interface Props {
  sleep: SleepData;
  /** Age-adjusted sleep duration benchmark; omit if no profile is set. */
  benchmark?: MetricBenchmark;
  /** True when showing demo/mock data — score is estimated, not from Garmin. */
  isDemo?: boolean;
}

export default function SleepCard({ sleep, benchmark, isDemo }: Props) {
  const { t, locale } = useLang();
  const totalHours = sleep.totalSleepSeconds / 3600;
  const timeFmt = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === 'es' ? 'es-ES' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

  const STAGES = [
    { key: 'deepSleepSeconds' as const, label: t('sleep.deep'), color: SERIES[0] },
    { key: 'remSleepSeconds' as const, label: t('sleep.rem'), color: SERIES[1] },
    { key: 'lightSleepSeconds' as const, label: t('sleep.light'), color: SERIES[2] },
    { key: 'awakeSleepSeconds' as const, label: t('sleep.awake'), color: 'var(--rule)' },
  ];

  const extras: Array<[string, string]> = [];
  if (sleep.averageSpO2 > 0) extras.push([t('sleep.spo2'), `${sleep.averageSpO2.toFixed(1)}%`]);
  if (sleep.averageHRV > 0) extras.push([t('sleep.hrvNight'), `${sleep.averageHRV} ms`]);
  if (sleep.averageRespiration > 0) extras.push([t('sleep.resp'), sleep.averageRespiration.toFixed(1)]);

  return (
    <LogSection
      label={t('sleep.title')}
      figure={
        <span className="flex flex-col items-end">
          {/* A demo score is an estimate and is set in graphite, not ink. */}
          <span className={isDemo ? 'estimated text-entry' : 'measured text-entry'}>
            {sleep.sleepScore}
            <span className="text-note font-normal text-faint ml-0.5">/ 100</span>
          </span>
          <span className="font-serif text-note italic text-faint">
            {isDemo ? t('sleep.estimated') : t('sleep.garmin')}
          </span>
        </span>
      }
    >
      <div className="flex items-baseline gap-2 mb-2">
        <span className="measured text-verdict">{formatDuration(sleep.totalSleepSeconds)}</span>
        <span className="font-serif text-note italic text-pencil">
          {totalHours.toFixed(1)} {t('sleep.recommended')}
        </span>
      </div>

      {/* Duration against an 8h page width */}
      <div className="w-full h-1.5 bg-wash border border-rule mb-4">
        <div
          className="h-full transition-all duration-700"
          style={{
            width: `${Math.min(100, (totalHours / 8) * 100)}%`,
            backgroundColor: totalHours >= 7 ? SERIES[0] : totalHours >= 6 ? CAUTION : STOP,
          }}
        />
      </div>

      {/* Stages, stacked */}
      <div className="flex h-5 mb-2 border border-rule">
        {STAGES.map(s => {
          const pct = sleep.totalSleepSeconds ? (sleep[s.key] / sleep.totalSleepSeconds) * 100 : 0;
          return (
            <div
              key={s.key}
              style={{ width: `${pct}%`, backgroundColor: s.color }}
              className="transition-all duration-700"
              title={`${s.label}: ${formatDuration(sleep[s.key])}`}
            />
          );
        })}
      </div>

      <dl className="grid grid-cols-2 gap-x-5 gap-y-1">
        {STAGES.map(s => {
          const pct = sleep.totalSleepSeconds
            ? Math.round((sleep[s.key] / sleep.totalSleepSeconds) * 100)
            : 0;
          return (
            <div key={s.key} className="flex items-baseline gap-2">
              <span
                aria-hidden="true"
                className="w-2 h-2 shrink-0 self-center"
                style={{ backgroundColor: s.color }}
              />
              <dt className="text-note text-pencil truncate">{s.label}</dt>
              <dd className="measured text-note ml-auto">
                {formatDuration(sleep[s.key])}
                <span className="text-faint font-normal ml-1">{pct}%</span>
              </dd>
            </div>
          );
        })}
      </dl>

      {extras.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 mt-3 pt-3 border-t border-rule">
          {extras.map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-1.5">
              <span className="font-serif text-note italic text-faint">{label}</span>
              <span className="measured text-note">{value}</span>
            </div>
          ))}
          <span className="ml-auto text-note text-pencil figures">
            {timeFmt(sleep.startTime)} → {timeFmt(sleep.endTime)}
          </span>
        </div>
      )}

      {benchmark && sleep.totalSleepSeconds > 0 && <BenchmarkBadge benchmark={benchmark} />}
    </LogSection>
  );
}
