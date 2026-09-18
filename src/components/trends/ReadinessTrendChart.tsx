'use client';

// ── Readiness trend ───────────────────────────────────────────────────────────
// Weekly means, not daily values. The daily number belongs on the home screen
// (§14); what a weekly review can say that the home screen cannot is whether
// the baseline itself is drifting — and a single bad night is noise at this
// resolution, which is exactly why it is averaged out here.
//
// Two series on one frame, told apart by stroke as well as hue: recovery is
// solid, HRV is broken. Anyone reading this on a washed-out phone screen in
// daylight still gets both lines.

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReadinessWeekPoint } from '@/lib/trends';
import LogSection from '@/components/ui/LogSection';
import { AXIS, AXIS_BARE, GRID, LINE_CURSOR, METRIC, TOOLTIP_CLASS } from '@/components/ui/chartTheme';
import { useLang } from '@/lib/i18n';

const { recovery: RECOVERY, hrv: HRV, rhr: RHR, sleep: SLEEP } = METRIC;

export default function ReadinessTrendChart({ points }: { points: ReadinessWeekPoint[] }) {
  const { t } = useLang();
  const withData = points.filter((p) => p.days > 0);
  const latest = withData[withData.length - 1] ?? null;
  const previous = withData[withData.length - 2] ?? null;

  const stats: Array<{
    label: string;
    value: number | null;
    unit: string;
    prev: number | null;
    higherIsBetter: boolean;
  }> = [
    { label: t('trends.recovery'), value: latest?.recovery ?? null, unit: '%', prev: previous?.recovery ?? null, higherIsBetter: true },
    { label: t('trends.hrv'), value: latest?.hrv ?? null, unit: 'ms', prev: previous?.hrv ?? null, higherIsBetter: true },
    { label: t('trends.rhr'), value: latest?.rhr ?? null, unit: 'bpm', prev: previous?.rhr ?? null, higherIsBetter: false },
    { label: t('trends.sleep'), value: latest?.sleepHours ?? null, unit: 'h', prev: previous?.sleepHours ?? null, higherIsBetter: true },
  ];

  return (
    <LogSection label={t('trends.review.readinessTitle')}>
      {withData.length === 0 ? (
        <p className="prose-log text-note text-pencil">{t('trends.review.readinessEmpty')}</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={132}>
            <LineChart data={points} margin={{ top: 4, right: 6, bottom: 0, left: -22 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="label" {...AXIS} minTickGap={8} />
              <YAxis yAxisId="recovery" {...AXIS_BARE} width={40} domain={[0, 100]} />
              <YAxis yAxisId="hrv" orientation="right" hide />
              <Tooltip
                cursor={LINE_CURSOR}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as ReadinessWeekPoint;
                  if (p.days === 0) {
                    return (
                      <div className={TOOLTIP_CLASS}>
                        <p className="text-pencil">{p.label}</p>
                        <p className="text-faint">{t('trends.review.noDataWeek')}</p>
                      </div>
                    );
                  }
                  return (
                    <div className={TOOLTIP_CLASS}>
                      <p className="text-pencil">{p.label}</p>
                      <p className="measured">
                        {t('trends.recovery')} {p.recovery ?? '—'}%
                      </p>
                      <p className="measured">
                        {t('trends.hrv')} {p.hrv ?? '—'} ms
                      </p>
                    </div>
                  );
                }}
              />
              <Line
                yAxisId="recovery"
                type="monotone"
                dataKey="recovery"
                stroke={RECOVERY}
                strokeWidth={1.75}
                dot={{ r: 2, fill: RECOVERY, stroke: 'none' }}
                connectNulls
                isAnimationActive
              />
              <Line
                yAxisId="hrv"
                type="monotone"
                dataKey="hrv"
                stroke={HRV}
                strokeWidth={1.25}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
                isAnimationActive
              />
            </LineChart>
          </ResponsiveContainer>

          {/* Latest week against the one before it */}
          <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-rule">
            {stats.map((s, i) => {
              const delta = s.value !== null && s.prev !== null ? s.value - s.prev : null;
              const good = delta === null ? null : s.higherIsBetter ? delta > 0 : delta < 0;
              return (
                <div key={s.label}>
                  <p className="font-serif text-note italic text-faint truncate">{s.label}</p>
                  <p
                    className="measured text-entry"
                    style={{ color: [RECOVERY, HRV, RHR, SLEEP][i] }}
                  >
                    {s.value ?? '—'}
                    <span className="text-note font-normal text-faint ml-0.5">{s.unit}</span>
                  </p>
                  {delta !== null && Math.abs(delta) >= 0.1 && (
                    <p className={`text-note figures ${good ? 'text-ink' : 'text-pencil'}`}>
                      {delta > 0 ? '+' : ''}
                      {Math.round(delta * 10) / 10}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </LogSection>
  );
}
