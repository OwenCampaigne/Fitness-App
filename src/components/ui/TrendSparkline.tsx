'use client';

// ── Sparkline ─────────────────────────────────────────────────────────────────
// A line in the margin, not a chart. No axes, no grid, no gradient wash — a
// thin stroke, a flat tint under it so the shape reads at 44px tall, and a
// broken rule where the median sits.

import { ResponsiveContainer, AreaChart, Area, Tooltip, ReferenceLine } from 'recharts';
import { FAINT, INK, LINE_CURSOR, RULE, TOOLTIP_CLASS } from './chartTheme';

interface TrendSparklineProps {
  data: number[];
  labels?: string[];
  /** A `--chart-*` token, or ink. Never a raw hex: dark mode has to follow. */
  color?: string;
  height?: number;
  showDots?: boolean;
  referenceValue?: number;
  referenceLabel?: string;
}

export default function TrendSparkline({
  data,
  labels = [],
  color = INK,
  height = 56,
  referenceValue,
  referenceLabel,
}: TrendSparklineProps) {
  const chartData = data.map((v, i) => ({ v, label: labels[i] ?? '' }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        {referenceValue !== undefined && (
          <ReferenceLine
            y={referenceValue}
            stroke={RULE}
            strokeDasharray="3 3"
            label={
              referenceLabel
                ? {
                    value: referenceLabel,
                    position: 'insideTopRight',
                    fill: FAINT,
                    fontSize: 9,
                  }
                : undefined
            }
          />
        )}
        <Tooltip
          cursor={LINE_CURSOR}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <div className={TOOLTIP_CLASS}>
                {payload[0].payload.label && (
                  <span className="text-pencil mr-1.5">{payload[0].payload.label}</span>
                )}
                <span className="measured">{payload[0].value}</span>
              </div>
            ) : null
          }
        />
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={color}
          fillOpacity={0.1}
          dot={false}
          isAnimationActive
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
