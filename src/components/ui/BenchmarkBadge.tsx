'use client';

import type { MetricBenchmark } from '@/lib/benchmarks';
import { useLang } from '@/lib/i18n';

/**
 * Where this number sits against the user's age/sex demographic.
 *
 * `lib/benchmarks.ts` hands over a bright category colour; this ignores it.
 * A percentile is a measurement, so it is set in ink, and the category is
 * named in words — colouring "below average" red would turn a reference line
 * into a verdict, which is not what a population percentile is.
 */
export default function BenchmarkBadge({
  benchmark,
  className,
}: {
  benchmark: MetricBenchmark;
  className?: string;
}) {
  const { t } = useLang();
  const { percentile, category, p25, p50, p75, unit, demographicLabel } = benchmark;

  const pctLabel = percentile >= 50
    ? (percentile >= 90 ? 'Top 10%' : percentile >= 75 ? 'Top 25%' : percentile >= 60 ? 'Top 40%' : 'Top 50%')
    : t('benchmarks.percentile', { pct: percentile });
  const catLabel = t(`benchmarks.${category}`);

  // Clamp the marker so it stays on the rule at both ends.
  const markerPct = Math.min(94, Math.max(6, percentile));

  return (
    <div className={`mt-3 pt-3 border-t border-rule ${className ?? ''}`}>

      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="font-serif text-note italic text-faint">vs. {demographicLabel}</span>
        <span className="measured text-note">
          {pctLabel}
          <span className="font-serif italic font-normal text-pencil ml-1.5">{catLabel}</span>
        </span>
      </div>

      {/* Reference rule with quartile ticks and a "you are here" mark */}
      <div className="relative h-4 flex items-center mb-1">
        <div className="absolute inset-x-0 h-px bg-rule" />
        <div
          className="absolute left-0 h-px bg-pencil transition-all duration-700"
          style={{ width: `${percentile}%` }}
        />

        {[25, 50, 75].map((q) => (
          <div
            key={q}
            className={`absolute w-px bg-rule ${q === 50 ? 'h-3' : 'h-2'}`}
            style={{ left: `${q}%` }}
          />
        ))}

        <div
          className="absolute w-2.5 h-2.5 bg-ink transition-all duration-700"
          style={{ left: `${markerPct}%`, transform: 'translateX(-50%) rotate(45deg)' }}
        />
      </div>

      <div className="relative h-4 figures">
        {([[25, p25], [50, p50], [75, p75]] as const).map(([q, v]) => (
          <span
            key={q}
            className="absolute text-note text-faint"
            style={{ left: `${q}%`, transform: 'translateX(-50%)' }}
          >
            {v}{unit}
          </span>
        ))}
      </div>

    </div>
  );
}
