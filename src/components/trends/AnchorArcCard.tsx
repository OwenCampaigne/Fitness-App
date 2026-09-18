'use client';

// ── Anchor arc ────────────────────────────────────────────────────────────────
// One anchor, one entry: where it started, where it is now, when and why it
// moved, and how sure the system is. Framework §21 (the Expansionist) calls a
// coach that can show its own estimates sharpening the differentiator; §3 is
// what makes it possible, because every anchor already carries value + source
// + confidence.
//
// The honesty rule is enforced upstream in `lib/trends.ts`: an arc that never
// moved arrives with `hasMovement: false` and a reason, and this component has
// no line to draw — it shows the reason instead. That is deliberate. A flat
// line through a single guess looks exactly like a measurement, and the one
// thing this page must never do is dress an estimate up as data.
//
// So the drawing does the same work the copy does. An `estimate` is set in
// graphite and drawn as a broken line; an `observed` or `confirmed` anchor is
// inked and drawn solid. Nothing here distinguishes the two by colour alone —
// weight, stroke and dash carry it, because a chart read at 6am outdoors has
// to survive a bad screen.

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnchorArc } from '@/lib/trends';
import { formatAnchorDelta, formatAnchorValue } from '@/lib/trends';
import type { AnchorSource } from '@/types/strength';
import {
  AXIS,
  AXIS_BARE,
  INK,
  LINE_CURSOR,
  PENCIL,
  TOOLTIP_CLASS,
} from '@/components/ui/chartTheme';
import { useLang } from '@/lib/i18n';

/** Ink is measured, pencil is estimated. The whole component turns on this. */
const SOURCE_MARK: Record<
  AnchorSource,
  { stroke: string; dash?: string; width: number; measured: boolean }
> = {
  estimate: { stroke: PENCIL, dash: '4 3', width: 1.25, measured: false },
  observed: { stroke: INK, width: 1.5, measured: true },
  confirmed: { stroke: INK, width: 2, measured: true },
};

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function AnchorArcCard({ arc }: { arc: AnchorArc }) {
  const { t } = useLang();
  const source = arc.latest?.source ?? 'estimate';
  const mark = SOURCE_MARK[source];
  const valueClass = mark.measured ? 'measured' : 'estimated';
  const confidencePct = Math.round((arc.latest?.confidence ?? 0) * 100);

  const chartData = arc.points
    .filter((p) => p.value !== null)
    .map((p) => ({
      date: p.date,
      label: shortDate(p.date),
      value: p.value as number,
      source: p.source,
    }));

  return (
    <article className="entry">

      {/* What this anchor is, and how much the system trusts it */}
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-entry font-medium text-ink truncate">
          {arc.label}
        </h3>
        <span
          className={`font-serif text-note italic shrink-0 ${
            mark.measured ? 'text-ink' : 'text-pencil'
          }`}
        >
          {t(`trends.review.source.${source}`)}
        </span>
      </div>

      {/* The sentence this whole page exists to be able to say */}
      <p className="prose-log text-entry text-pencil mt-1">{arc.headline}</p>

      {arc.hasMovement ? (
        <>
          {/* Started → now */}
          <div className="flex items-baseline gap-2 mt-3 mb-1">
            <span className="font-serif text-note italic text-faint">
              {t('trends.review.started')}
            </span>
            <span className="estimated text-entry">
              {formatAnchorValue(arc.unit, arc.first?.value ?? null)}
            </span>
            <span className="text-faint" aria-hidden="true">→</span>
            <span className="font-serif text-note italic text-faint">
              {t('trends.review.now')}
            </span>
            <span className={`${valueClass} text-head`}>
              {formatAnchorValue(arc.unit, arc.latest?.value ?? null)}
            </span>
            {arc.deltaValue !== null && arc.deltaValue !== 0 && (
              <span className={`ml-auto ${valueClass} text-note`}>
                {formatAnchorDelta(arc.unit, arc.deltaValue)}
              </span>
            )}
          </div>

          <ResponsiveContainer width="100%" height={104}>
            <LineChart data={chartData} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
              <XAxis dataKey="label" {...AXIS} minTickGap={16} />
              <YAxis
                {...AXIS_BARE}
                width={46}
                domain={['dataMin - 2', 'dataMax + 2']}
                tickFormatter={(v: number) => formatAnchorValue(arc.unit, v)}
              />
              <Tooltip
                cursor={LINE_CURSOR}
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className={TOOLTIP_CLASS}>
                      <span className="text-pencil mr-1.5">{payload[0].payload.label}</span>
                      <span className={valueClass}>
                        {formatAnchorValue(arc.unit, payload[0].payload.value)}
                      </span>
                    </div>
                  ) : null
                }
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={mark.stroke}
                strokeWidth={mark.width}
                strokeDasharray={mark.dash}
                dot={{ r: 2, fill: mark.stroke, stroke: 'none' }}
                activeDot={{ r: 3.5, fill: mark.stroke, stroke: 'none' }}
                isAnimationActive
              />
            </LineChart>
          </ResponsiveContainer>

          {/* When and why it moved */}
          <p className="block-label mt-3 mb-1">{t('trends.review.whatMoved')}</p>
          <ul className="flex flex-col gap-1">
            {arc.moves.map((move, i) => (
              <li key={`${move.date}-${i}`} className="flex gap-2 text-note leading-snug">
                <span className="text-faint shrink-0 w-14 figures">{shortDate(move.date)}</span>
                <span className="text-pencil">{move.reason}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        /* No movement: say so, with the reason. Never a flat line, never ink. */
        <div className="mt-3 border-l-2 border-dashed border-rule pl-3">
          <div className="flex items-baseline gap-2">
            <span className="estimated text-head">
              {formatAnchorValue(arc.unit, arc.latest?.value ?? null)}
            </span>
            <span className="font-serif text-note italic text-faint">
              {t('trends.review.notMeasured')}
            </span>
          </div>
          <p className="prose-log text-note text-pencil mt-0.5">{arc.reason}</p>
        </div>
      )}

      {/* Confidence, stated as a number rather than implied by the chart */}
      <div className="mt-3 flex items-center gap-2">
        <span className="font-serif text-note italic text-faint">
          {t('trends.review.confidence')}
        </span>
        <div
          className="flex-1 h-0.5 bg-rule"
          role="img"
          aria-label={`${t('trends.review.confidence')} ${confidencePct}%`}
        >
          <div
            className="h-0.5 transition-all duration-700"
            style={{
              width: `${confidencePct}%`,
              backgroundColor: mark.measured ? INK : PENCIL,
            }}
          />
        </div>
        <span className={`${valueClass} text-note`}>{confidencePct}%</span>
      </div>
    </article>
  );
}
