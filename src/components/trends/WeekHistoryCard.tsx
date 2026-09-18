'use client';

// ── Past weeks ────────────────────────────────────────────────────────────────
// Closed weeks only, newest first. The chart earns its place because planned
// against done is the one comparison a table makes you do in your head: a week
// where every session landed and a week where half of them did not can carry
// the same kilometres, and only the pair of bars says which was which.
//
// The current week is deliberately absent — `closedWeekStarts` refuses to roll
// a week still being lived, because a half-week cached under a whole week's
// name is the kind of number that quietly disagrees with itself later.
//
// Planned is drawn as an outline and done as a solid: the plan is pencil, the
// week you actually ran is ink.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { WeekRow } from '@/lib/records';
import LogSection from '@/components/ui/LogSection';
import {
  AXIS,
  AXIS_BARE,
  BAR_CURSOR,
  GRID,
  INK,
  PENCIL,
  TOOLTIP_CLASS,
} from '@/components/ui/chartTheme';
import { useLang } from '@/lib/i18n';

export default function WeekHistoryCard({ weeks }: { weeks: WeekRow[] }) {
  const { t } = useLang();

  if (weeks.length === 0) {
    return (
      <LogSection label={t('trends.history.weeksTitle')}>
        <p className="prose-log text-note text-pencil">{t('trends.history.weeksEmpty')}</p>
      </LogSection>
    );
  }

  // Oldest first for the chart, newest first for the table — each is the order
  // the reader wants for that job.
  const chart = [...weeks].reverse();

  return (
    <LogSection label={t('trends.history.weeksTitle')}>
      <ResponsiveContainer width="100%" height={124}>
        <BarChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="label" {...AXIS} minTickGap={8} />
          <YAxis {...AXIS_BARE} width={38} />
          <Tooltip
            cursor={BAR_CURSOR}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const w = payload[0].payload as WeekRow;
              return (
                <div className={TOOLTIP_CLASS}>
                  <p className="text-pencil">{w.label}</p>
                  <p className="measured">
                    {w.sessionsDone ?? 0} / {w.sessionsPlanned ?? 0} {t('trends.history.sessions')}
                  </p>
                  <p className="text-faint">
                    {w.runKm ?? 0} km · {t('trends.review.load')} {w.totalLoad ?? 0}
                  </p>
                </div>
              );
            }}
          />
          {/* Planned: hollow. Done: filled. Readable with no colour at all. */}
          <Bar
            dataKey="sessionsPlanned"
            fill="transparent"
            stroke={PENCIL}
            strokeWidth={1}
            strokeDasharray="2 2"
            radius={0}
            maxBarSize={11}
          />
          <Bar dataKey="sessionsDone" fill={INK} radius={0} maxBarSize={11} />
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-note figures">
          <thead>
            <tr className="font-serif italic text-faint border-b border-rule">
              <th className="text-left font-normal pb-1">{t('trends.history.week')}</th>
              <th className="text-right font-normal pb-1">km</th>
              <th className="text-right font-normal pb-1">{t('trends.review.load')}</th>
              <th className="text-right font-normal pb-1">{t('trends.history.sets')}</th>
              <th className="text-right font-normal pb-1">{t('trends.history.done')}</th>
              <th className="text-right font-normal pb-1">ACWR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {weeks.map((w) => (
              <tr key={w.weekStart}>
                <td className="text-left text-pencil py-1 not-italic">{w.label}</td>
                <td className="text-right text-ink py-1">{w.runKm ?? 0}</td>
                <td className="text-right text-pencil py-1">{w.totalLoad ?? 0}</td>
                <td className="text-right text-pencil py-1">{w.strengthSets ?? 0}</td>
                <td className="text-right text-pencil py-1">
                  {w.sessionsDone ?? 0}/{w.sessionsPlanned ?? 0}
                </td>
                {/* No ACWR is printed as no ACWR, never as a plausible 1.00. */}
                <td className={`text-right py-1 ${w.acwrEnd === null ? 'text-faint' : 'text-pencil'}`}>
                  {w.acwrEnd === null ? '—' : w.acwrEnd.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="marginalia mt-3">{t('trends.history.weeksNote')}</p>
    </LogSection>
  );
}
