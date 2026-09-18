'use client';

import type { WeeklyTrend as WeeklyTrendType } from '@/lib/types';
import TrendSparkline from './ui/TrendSparkline';
import LogSection from './ui/LogSection';
import { METRIC } from './ui/chartTheme';
import { useLang } from '@/lib/i18n';

interface Props {
  trend: WeeklyTrendType;
}

export default function WeeklyTrend({ trend }: Props) {
  const { t } = useLang();
  const avg = (arr: number[]) =>
    arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0;

  const rows = [
    { label: t('weeklyTrend.recovery'), data: trend.recovery, color: METRIC.recovery, unit: '%' },
    { label: t('weeklyTrend.hrv'), data: trend.hrv, color: METRIC.hrv, unit: 'ms' },
    { label: t('weeklyTrend.sleep'), data: trend.sleep, color: METRIC.sleep, unit: '%' },
    { label: t('weeklyTrend.rhr'), data: trend.rhr, color: METRIC.rhr, unit: 'bpm' },
  ];

  return (
    <LogSection label={t('weeklyTrend.title')}>
      <div className="flex flex-col">
        {rows.map((row) => (
          <div key={row.label} className="entry">
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-entry text-ink">{row.label}</span>
              <span className="measured text-note" style={{ color: row.color }}>
                ∅ {avg(row.data)}
                <span className="text-faint font-normal ml-0.5">{row.unit}</span>
              </span>
            </div>
            <TrendSparkline
              data={row.data}
              labels={trend.dates}
              color={row.color}
              height={44}
              referenceValue={avg(row.data)}
            />
          </div>
        ))}
      </div>
    </LogSection>
  );
}
