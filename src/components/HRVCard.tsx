'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { HRVData } from '@/lib/types';
import type { MetricBenchmark } from '@/lib/benchmarks';
import TrendSparkline from './ui/TrendSparkline';
import BenchmarkBadge from './ui/BenchmarkBadge';
import LogSection from './ui/LogSection';
import { METRIC } from './ui/chartTheme';
import { useLang } from '@/lib/i18n';

interface Props {
  hrv: HRVData;
  /** Age/sex-adjusted benchmark; omit if no profile is set. */
  benchmark?: MetricBenchmark;
}

export default function HRVCard({ hrv, benchmark }: Props) {
  const { t } = useLang();

  const STATUS_LABEL: Record<string, string> = {
    balanced: t('hrv.states.balanced'),
    unbalanced: t('hrv.states.unbalanced'),
    poor: t('hrv.states.low'),
  };

  const trend7 = hrv.trend.length > 0 ? hrv.trend : [0];
  const positives = trend7.filter(v => v > 0);
  const min7 = positives.length > 0 ? Math.min(...positives) : 0;
  const max7 = Math.max(...trend7);
  const avg7 = hrv.weeklyAverage;

  return (
    <LogSection
      label={t('hrv.title')}
      figure={
        <span className="font-serif text-note italic text-pencil">
          {STATUS_LABEL[hrv.status] ?? STATUS_LABEL.balanced}
        </span>
      }
    >
      <div className="flex items-baseline gap-2">
        <span className="measured text-verdict" style={{ color: METRIC.hrv }}>
          {hrv.lastNight}
        </span>
        <span className="font-serif text-entry italic text-pencil">{t('hrv.msLastNight')}</span>
      </div>

      <p className="prose-log text-note text-pencil mt-1 mb-2">
        {t('hrv.avg7d')} <span className="measured">{avg7} ms</span>
        {' · '}
        {hrv.lastNight > avg7
          ? t('hrv.aboveBaseline')
          : hrv.lastNight < avg7
            ? t('hrv.belowBaseline')
            : t('hrv.atBaseline')}
      </p>

      <TrendSparkline data={trend7} color={METRIC.hrv} height={52} referenceValue={avg7} />

      <div className="flex justify-between mt-1 text-note text-pencil">
        <span>{t('hrv.min7d')} <span className="measured">{min7} ms</span></span>
        <span>{t('hrv.max7d')} <span className="measured">{max7} ms</span></span>
      </div>

      {benchmark && <BenchmarkBadge benchmark={benchmark} />}

      <Link
        href="/hrv"
        className="flex items-center gap-1 font-serif text-note italic text-pencil hover:text-ink transition-colors mt-3 pt-3 border-t border-rule"
      >
        {t('hrv.detailLink')}
        <ChevronRight size={11} className="ml-auto" />
      </Link>
    </LogSection>
  );
}
