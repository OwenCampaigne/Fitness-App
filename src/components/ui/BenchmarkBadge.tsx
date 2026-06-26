'use client';

import type { MetricBenchmark } from '@/lib/benchmarks';
import { useLang } from '@/lib/i18n';

interface Props {
  benchmark: MetricBenchmark;
  className?: string;
}

/**
 * Shows a user's metric position relative to their age/sex demographic.
 *
 * Displays:
 * - A coloured "Top X% · Label" badge
 * - A reference bar with p25 / p50 / p75 tick marks and a "you are here" dot
 * - The demographic reference line (e.g. "Hombres 35–44 años")
 */
export default function BenchmarkBadge({ benchmark, className }: Props) {
  const { t } = useLang();
  const {
    percentile,
    category,
    color,
    p25,
    p50,
    p75,
    unit,
    demographicLabel,
  } = benchmark;

  const pctLabel = percentile >= 50
    ? (percentile >= 90 ? 'Top 10%' : percentile >= 75 ? 'Top 25%' : percentile >= 60 ? 'Top 40%' : 'Top 50%')
    : t('benchmarks.percentile', { pct: percentile });
  const catLabel = t(`benchmarks.${category}`);

  // Clamp marker to leave a little room at both ends for the dot
  const markerPct = Math.min(94, Math.max(6, percentile));

  return (
    <div className={`mt-3 pt-3 border-t border-border ${className ?? ''}`}>

      {/* Header: demographic label + coloured badge */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-muted">vs. {demographicLabel}</span>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ color, backgroundColor: `${color}18` }}
        >
          {pctLabel} · {catLabel}
        </span>
      </div>

      {/* Reference bar */}
      <div className="relative h-4 flex items-center mb-1">
        {/* Track */}
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-border" />

        {/* Filled portion up to the user's percentile */}
        <div
          className="absolute left-0 h-1.5 rounded-full transition-all duration-700"
          style={{ width: `${percentile}%`, backgroundColor: `${color}55` }}
        />

        {/* p25 tick */}
        <div
          className="absolute w-px h-2.5 bg-muted/50"
          style={{ left: '25%' }}
        />
        {/* p50 tick — slightly taller */}
        <div
          className="absolute w-px h-3 bg-muted/70"
          style={{ left: '50%' }}
        />
        {/* p75 tick */}
        <div
          className="absolute w-px h-2.5 bg-muted/50"
          style={{ left: '75%' }}
        />

        {/* "You are here" dot */}
        <div
          className="absolute w-3.5 h-3.5 rounded-full border-2 border-bg shadow transition-all duration-700"
          style={{
            left: `${markerPct}%`,
            transform: 'translateX(-50%)',
            backgroundColor: color,
            boxShadow: `0 0 6px ${color}88`,
          }}
        />
      </div>

      {/* p25 / p50 / p75 value labels */}
      <div className="relative h-4">
        <span
          className="absolute text-[9px] text-muted"
          style={{ left: '25%', transform: 'translateX(-50%)' }}
        >
          {p25}{unit}
        </span>
        <span
          className="absolute text-[9px] text-muted"
          style={{ left: '50%', transform: 'translateX(-50%)' }}
        >
          {p50}{unit}
        </span>
        <span
          className="absolute text-[9px] text-muted"
          style={{ left: '75%', transform: 'translateX(-50%)' }}
        >
          {p75}{unit}
        </span>
      </div>

    </div>
  );
}
