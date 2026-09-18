'use client';

// ── Recovery ──────────────────────────────────────────────────────────────────
// The one place on this page a verdict colour is earned: a recovery score *is*
// GREEN/AMBER/RED (§14), so the arc takes ready/caution/stop. Its three inputs
// underneath are not verdicts, so they are set in ink with their own series
// tokens — colouring them too would leave nothing emphasised.

import CircularGauge from './ui/CircularGauge';
import { CAUTION, METRIC, READY, STOP } from './ui/chartTheme';
import type { RecoveryData } from '@/lib/types';
import type { ProfileBenchmarks } from '@/lib/benchmarks';
import { getRecoveryCategory } from '@/lib/scoring';
import { formatPercentile } from '@/lib/benchmarks';
import { useLang } from '@/lib/i18n';

const VERDICT: Record<'green' | 'yellow' | 'red', string> = {
  green: READY,
  yellow: CAUTION,
  red: STOP,
};

interface Props {
  recovery: RecoveryData;
  /** Age/sex-adjusted benchmarks; omit or null if no profile is set. */
  benchmarks?: ProfileBenchmarks | null;
}

export default function RecoveryScore({ recovery, benchmarks }: Props) {
  const { t } = useLang();
  const color = VERDICT[getRecoveryCategory(recovery.score)];
  const LABELS: Record<string, string> = {
    green: t('common.recovered'),
    yellow: t('common.moderate'),
    red: t('common.fatigued'),
  };
  const label = LABELS[recovery.category];

  return (
    <div className="flex flex-col items-center py-2">
      <p className="block-label">{t('trends.recovery')}</p>

      <div className="relative" style={{ width: 220, height: 220 }}>
        <CircularGauge score={recovery.score} size={220} strokeWidth={10} color={color}>
          <div className="flex flex-col items-center select-none pointer-events-none">
            <span className="figures leading-none" style={{ fontSize: 56, color }}>
              {recovery.score}
            </span>
            <span className="font-serif text-entry italic mt-1" style={{ color }}>
              {label}
            </span>
          </div>
        </CircularGauge>
      </div>

      <div className="flex gap-7 mt-4">
        <MetricPill label="HRV" value={`${recovery.hrv} ms`} color={METRIC.hrv} benchmark={benchmarks?.hrv} />
        <MetricPill label={t('trends.rhr')} value={`${recovery.restingHR} bpm`} color={METRIC.rhr} benchmark={benchmarks?.rhr} />
        <MetricPill label={t('trends.sleep')} value={`${recovery.sleepScore}%`} color={METRIC.sleep} />
      </div>

      {benchmarks && (
        <p className="font-serif text-note italic text-faint mt-3">
          Percentiles vs. {benchmarks.hrv.demographicLabel}
        </p>
      )}
    </div>
  );
}

function MetricPill({
  label,
  value,
  color,
  benchmark,
}: {
  label: string;
  value: string;
  color: string;
  benchmark?: { percentile: number; color: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-serif text-note italic text-pencil">{label}</span>
      <span className="measured text-entry" style={{ color }}>{value}</span>
      {benchmark && (
        <span className="text-note text-faint figures" title={benchmark.label}>
          {formatPercentile(benchmark.percentile)}
        </span>
      )}
    </div>
  );
}
