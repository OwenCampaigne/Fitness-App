'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { StressData } from '@/lib/types';
import { ResponsiveContainer, AreaChart, Area, Tooltip, ReferenceLine, XAxis } from 'recharts';
import LogSection from './ui/LogSection';
import { AXIS, LINE_CURSOR, METRIC, RULE, TOOLTIP_CLASS } from './ui/chartTheme';
import { useLang } from '@/lib/i18n';

interface Props {
  stress: StressData;
}

export default function StressCard({ stress }: Props) {
  const { t } = useLang();

  function stressLabel(avg: number) {
    if (avg <= 25) return t('stress.levels.low');
    if (avg <= 50) return t('stress.levels.moderate');
    return t('stress.levels.high');
  }

  return (
    <LogSection
      label={t('stress.title')}
      figure={
        <span className="flex items-baseline gap-2">
          <span className="font-serif text-note italic text-pencil">
            {stressLabel(stress.average)}
          </span>
          <span className="measured text-head" style={{ color: METRIC.stress }}>
            {stress.average}
          </span>
        </span>
      }
    >
      {/* All-day timeline. The 25 and 50 lines are the only structure it needs. */}
      {stress.data.length > 0 && (
        <div className="mb-3">
          <ResponsiveContainer width="100%" height={80}>
            <AreaChart data={stress.data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <XAxis dataKey="time" {...AXIS} axisLine={false} interval={3} />
              <ReferenceLine y={25} stroke={RULE} strokeDasharray="3 3" />
              <ReferenceLine y={50} stroke={RULE} strokeDasharray="3 3" />
              <Tooltip
                cursor={LINE_CURSOR}
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className={TOOLTIP_CLASS}>
                      <span className="text-pencil mr-1.5">{payload[0].payload.time}</span>
                      <span className="measured">{payload[0].value}</span>
                    </div>
                  ) : null
                }
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={METRIC.stress}
                strokeWidth={1.5}
                fill={METRIC.stress}
                fillOpacity={0.1}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <dl className="grid grid-cols-3 gap-4 border-t border-rule pt-2">
        {([
          [t('stress.levels.atRest'), `${stress.restingPercentage}%`],
          [t('stress.levels.highStress'), `${stress.highStressPercentage}%`],
          [t('stress.levels.avgLevel'), String(stress.average)],
        ] as const).map(([label, value]) => (
          <div key={label}>
            <dt className="font-serif text-note italic text-faint leading-tight">{label}</dt>
            <dd className="measured text-entry">{value}</dd>
          </div>
        ))}
      </dl>

      <Link
        href="/stress"
        className="flex items-center gap-1 font-serif text-note italic text-pencil hover:text-ink transition-colors mt-3 pt-3 border-t border-rule"
      >
        {t('stress.detailLink')}
        <ChevronRight size={11} className="ml-auto" />
      </Link>
    </LogSection>
  );
}
