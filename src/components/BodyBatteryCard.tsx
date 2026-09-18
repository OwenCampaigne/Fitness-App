'use client';

import type { BodyBatteryData } from '@/lib/types';
import { ResponsiveContainer, AreaChart, Area, Tooltip } from 'recharts';
import LogSection from './ui/LogSection';
import { LINE_CURSOR, METRIC, TOOLTIP_CLASS } from './ui/chartTheme';
import { useLang } from '@/lib/i18n';

interface Props {
  bodyBattery: BodyBatteryData;
}

export default function BodyBatteryCard({ bodyBattery }: Props) {
  const { t } = useLang();
  const color = METRIC.battery;

  // ── Device doesn't support Body Battery ────────────────────────────────────
  // Not a failure state with an icon and a colour: a blank line in the log and
  // the reason it is blank.
  if (!bodyBattery.isAvailable) {
    return (
      <LogSection label={t('bodyBattery.title')}>
        <div className="border-l-2 border-dashed border-rule pl-3 py-1">
          <p className="estimated text-entry">{t('bodyBattery.unavailable')}</p>
          <p className="prose-log text-note text-pencil mt-0.5">
            {t('bodyBattery.unavailableDesc')}
          </p>
        </div>
      </LogSection>
    );
  }

  return (
    <LogSection
      label={t('bodyBattery.title')}
      figure={
        <span className="measured text-head" style={{ color }}>
          {bodyBattery.current}
        </span>
      }
    >
      <div className="w-full h-2 bg-wash border border-rule mb-3">
        <div
          className="h-full transition-all duration-700"
          style={{ width: `${bodyBattery.current}%`, backgroundColor: color }}
        />
      </div>

      <div className="flex gap-5 mb-3 text-note">
        <span className="flex items-baseline gap-1.5">
          <span className="font-serif italic text-faint">{t('bodyBattery.charged')}</span>
          <span className="measured">+{bodyBattery.charged}</span>
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="font-serif italic text-faint">{t('bodyBattery.drained')}</span>
          <span className="measured">−{bodyBattery.drained}</span>
        </span>
      </div>

      {bodyBattery.data.length > 0 && (
        <ResponsiveContainer width="100%" height={72}>
          <AreaChart data={bodyBattery.data} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
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
              stroke={color}
              strokeWidth={1.5}
              fill={color}
              fillOpacity={0.1}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}

      <p className="marginalia mt-2">{t('bodyBattery.syncNote')}</p>
    </LogSection>
  );
}
