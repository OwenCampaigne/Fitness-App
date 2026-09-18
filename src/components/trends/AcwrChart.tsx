'use client';

// ── Acute:chronic workload ────────────────────────────────────────────────────
// The 0.8–1.3 corridor is framework §6 and `readiness.ts` already enforces it
// on the daily call — this draws the same rule so the two can never disagree.
// The shaded band is the point of the chart: the number matters far less than
// whether it is inside the corridor and which way it is travelling.
//
// The corridor is the one place on this page where a verdict colour is earned,
// so it gets `ready` and the 1.5 line gets `stop`. The series itself stays ink:
// the reader's eye should land on where the line sits, not on the line.

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AcwrBand, AcwrPoint } from '@/lib/trends';
import { describeAcwr } from '@/lib/trends';
import LogSection from '@/components/ui/LogSection';
import {
  AXIS,
  AXIS_BARE,
  CAUTION,
  GRID,
  INK,
  LINE_CURSOR,
  PENCIL,
  READY,
  STOP,
  TOOLTIP_CLASS,
} from '@/components/ui/chartTheme';
import { useLang } from '@/lib/i18n';

/** Verdict only — an ACWR band *is* a verdict, which is why colour is allowed. */
const BAND_COLOR: Record<AcwrBand, string> = {
  no_data: PENCIL,
  detraining: CAUTION,
  optimal: READY,
  caution: CAUTION,
  danger: STOP,
};

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function AcwrChart({ points }: { points: AcwrPoint[] }) {
  const { t } = useLang();
  const latest = points[points.length - 1] ?? null;
  const color = BAND_COLOR[latest?.band ?? 'no_data'];

  const data = points.map((p) => ({ ...p, label: shortDate(p.date) }));

  return (
    <LogSection
      label={t('trends.review.acwrTitle')}
      figure={
        latest?.acwr != null ? (
          /* A real ratio is measured. `null` is refused upstream rather than
             rounded to a comfortable 1.00, so there is simply no figure. */
          <span className="measured text-head" style={{ color }}>
            {latest.acwr.toFixed(2)}
          </span>
        ) : (
          <span className="estimated text-note font-serif italic">—</span>
        )
      }
    >
      {data.length === 0 ? (
        <p className="prose-log text-note text-pencil">{describeAcwr(null)}</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={132}>
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
              <CartesianGrid {...GRID} />
              {/* The corridor the plan is supposed to live inside */}
              <ReferenceArea y1={0.8} y2={1.3} fill={READY} fillOpacity={0.12} />
              <ReferenceLine y={1.5} stroke={STOP} strokeDasharray="3 3" strokeOpacity={0.7} />
              <XAxis dataKey="label" {...AXIS} minTickGap={24} />
              <YAxis
                {...AXIS_BARE}
                width={40}
                domain={[0, (max: number) => Math.max(1.7, Math.ceil(max * 10) / 10)]}
              />
              <Tooltip
                cursor={LINE_CURSOR}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as AcwrPoint & { label: string };
                  return (
                    <div className={TOOLTIP_CLASS}>
                      <p className="text-pencil">{p.label}</p>
                      <p className="measured" style={{ color: BAND_COLOR[p.band] }}>
                        {p.acwr?.toFixed(2) ?? '—'}
                      </p>
                      <p className="text-faint">
                        {t('trends.review.acute')} {p.acute} · {t('trends.review.chronic')} {p.chronic}
                      </p>
                    </div>
                  );
                }}
              />
              {/* A flat wash, not a gradient. The band underneath is the colour
                  that carries meaning; the series is ink drawn over it. */}
              <Area
                type="monotone"
                dataKey="acwr"
                stroke={INK}
                strokeWidth={1.5}
                fill={INK}
                fillOpacity={0.06}
                dot={false}
                connectNulls={false}
                isAnimationActive
              />
            </AreaChart>
          </ResponsiveContainer>

          <p className="prose-log text-note text-pencil mt-2">{describeAcwr(latest)}</p>
        </>
      )}
    </LogSection>
  );
}
