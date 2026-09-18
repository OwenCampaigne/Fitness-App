'use client';

// ── Lifting volume by muscle group ────────────────────────────────────────────
// Hard sets this week against the MEV/MAV/MRV landmarks in `strengthEngine`.
// Drawn by hand rather than with recharts because the landmarks are the story:
// what matters is where the bar sits relative to three fixed ticks, and a
// generic bar chart would draw the bar and lose the corridor.
//
// The lower-body ceilings are deliberately below general-population figures
// because running already spends that recovery budget (§8) — this chart
// inherits those numbers rather than inventing friendlier ones.
//
// Only `above_mrv` is coloured, because only `above_mrv` is a safety flag. The
// other three states are ink or graphite: a group sitting below MEV is not an
// alarm, it is just a group you have not trained yet.

import type { MuscleVolumePoint, MuscleVolumeStatus } from '@/lib/trends';
import LogSection from '@/components/ui/LogSection';
import { CAUTION, INK, PENCIL, STOP } from '@/components/ui/chartTheme';
import { useLang } from '@/lib/i18n';

const STATUS_COLOR: Record<MuscleVolumeStatus, string> = {
  below_mev: PENCIL,
  in_range: INK,
  above_mav: CAUTION,
  above_mrv: STOP,
};

export default function MuscleVolumeChart({ points }: { points: MuscleVolumePoint[] }) {
  const { t } = useLang();

  if (points.length === 0) {
    return (
      <LogSection label={t('trends.review.musclesTitle')}>
        <p className="prose-log text-note text-pencil">{t('trends.review.musclesEmpty')}</p>
      </LogSection>
    );
  }

  // One shared scale so the bars are comparable across groups.
  const scaleMax = Math.max(...points.map((p) => Math.max(p.sets, p.mrv))) * 1.1;

  return (
    <LogSection
      label={t('trends.review.musclesTitle')}
      figure={
        <span className="font-serif text-note italic text-faint">
          {t('trends.review.hardSets')}
        </span>
      }
    >
      <div className="flex flex-col gap-2.5">
        {points.map((p) => {
          const color = STATUS_COLOR[p.status];
          const delta = p.sets - p.previousSets;
          return (
            <div key={p.group}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-note text-pencil">{p.label}</span>
                <span className="measured text-note" style={{ color }}>
                  {p.sets}
                  {delta !== 0 && (
                    <span className="text-note font-normal text-faint ml-1.5">
                      {delta > 0 ? '+' : ''}
                      {delta} {t('trends.review.vsLastWeek')}
                    </span>
                  )}
                </span>
              </div>

              <div className="relative h-2 bg-wash border border-rule">
                <div
                  className="absolute left-0 top-0 h-full transition-all duration-700"
                  style={{ width: `${Math.min(100, (p.sets / scaleMax) * 100)}%`, backgroundColor: color }}
                />
                {/* MEV / MAV / MRV ticks — the corridor the bar is read against */}
                {([['mev', p.mev], ['mav', p.mav], ['mrv', p.mrv]] as const).map(([key, value]) => (
                  <div
                    key={key}
                    className="absolute -top-0.5 h-3 w-px bg-ink"
                    style={{ left: `${Math.min(100, (value / scaleMax) * 100)}%` }}
                    title={`${key.toUpperCase()} ${value}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p className="marginalia mt-3">{t('trends.review.musclesLegend')}</p>
    </LogSection>
  );
}
