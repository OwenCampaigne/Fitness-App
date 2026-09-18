'use client';

// ── Weekly volume ─────────────────────────────────────────────────────────────
// Distance per ISO week, with the week-on-week change called out against the
// ~10%/week ramp the framework holds the plan to (§5a). Empty weeks are drawn
// as empty weeks: a week off is information, and compacting it away would make
// a two-week gap look like a steady block.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { WeeklyVolumePoint } from '@/lib/trends';
import LogSection from '@/components/ui/LogSection';
import { AXIS, AXIS_BARE, BAR_CURSOR, GRID, SERIES, TOOLTIP_CLASS } from '@/components/ui/chartTheme';
import { useLang } from '@/lib/i18n';

const COLOR = SERIES[0];

export default function WeeklyVolumeChart({ points }: { points: WeeklyVolumePoint[] }) {
  const { t } = useLang();

  const current = points[points.length - 1];
  const previous = points[points.length - 2];
  const rampPct =
    current && previous && previous.km > 0
      ? Math.round(((current.km - previous.km) / previous.km) * 100)
      : null;

  const note =
    rampPct === null
      ? t('trends.review.volumeNoRamp')
      : rampPct > 10
        ? t('trends.review.volumeRampFast', { pct: rampPct })
        : rampPct < -10
          ? t('trends.review.volumeRampDown', { pct: Math.abs(rampPct) })
          : t('trends.review.volumeRampOk', { pct: rampPct });

  return (
    <LogSection
      label={t('trends.review.volumeTitle')}
      figure={
        current && (
          <span className="measured text-head">
            {current.km}
            <span className="text-note font-normal text-faint ml-1">km</span>
          </span>
        )
      }
    >
      <ResponsiveContainer width="100%" height={132}>
        <BarChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="label" {...AXIS} minTickGap={8} />
          <YAxis {...AXIS_BARE} width={40} />
          <Tooltip
            cursor={BAR_CURSOR}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as WeeklyVolumePoint;
              return (
                <div className={TOOLTIP_CLASS}>
                  <p className="text-pencil">{p.label}</p>
                  <p className="measured">
                    {p.km} km · {p.minutes} min
                  </p>
                  <p className="text-faint">
                    {p.runs} {t('trends.review.runs')} · {t('trends.review.load')} {p.load}
                  </p>
                </div>
              );
            }}
          />
          {/* Square bars. Paper does not round a pencil stroke. */}
          <Bar dataKey="km" fill={COLOR} radius={0} maxBarSize={22} isAnimationActive />
        </BarChart>
      </ResponsiveContainer>

      <p className="prose-log text-note text-pencil mt-2">{note}</p>
    </LogSection>
  );
}
