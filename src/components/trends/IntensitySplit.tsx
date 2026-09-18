'use client';

// ── Intensity split (the 80/20 check) ─────────────────────────────────────────
// A stacked bar rather than a pie: the only comparison that matters is against
// the 80% line, and a bar can carry that marker where a pie cannot.
//
// §21's Contrarian asks the validator to push *up* as well as down, so the
// verdict from `lib/trends.ts` calls out a week with no hard running too — not
// just a week where the easy days drifted.
//
// The slices are the muted series ramp, never ready/stop: "80% easy" is a
// target, not a verdict, and colouring the easy slice green would make every
// hard session look like a mistake.

import type { IntensityDistribution } from '@/lib/trends';
import LogSection from '@/components/ui/LogSection';
import { INK, RULE, SERIES } from '@/components/ui/chartTheme';
import { useLang } from '@/lib/i18n';

const SLICE_COLOR: Record<string, string> = {
  easy: SERIES[0],
  hard: SERIES[3],
  unknown: RULE,
};

export default function IntensitySplit({ intensity }: { intensity: IntensityDistribution }) {
  const { t } = useLang();

  return (
    <LogSection
      label={t('trends.review.intensityTitle')}
      figure={
        intensity.available && intensity.easyShare !== null ? (
          <span className="measured text-head">
            {Math.round(intensity.easyShare * 100)}
            <span className="text-note font-normal text-faint ml-1">% easy</span>
          </span>
        ) : undefined
      }
    >
      {intensity.available ? (
        <>
          {/* Stacked minutes, with the 80% target ruled onto the bar itself */}
          <div className="relative h-4 flex bg-wash border border-rule">
            {intensity.slices.map((slice) => (
              <div
                key={slice.key}
                className="h-full transition-all duration-700"
                style={{
                  width: `${slice.share * 100}%`,
                  backgroundColor: SLICE_COLOR[slice.key],
                }}
                title={`${slice.label}: ${slice.minutes} min`}
              />
            ))}
            <div
              className="absolute top-0 h-full w-px"
              style={{
                left: `${intensity.targetEasyShare * 100}%`,
                backgroundColor: INK,
              }}
            />
          </div>
          <p className="font-serif text-note italic text-faint text-right mt-0.5 mb-3">
            {t('trends.review.target8020')}
          </p>

          {/* Legend with the raw minutes behind each slice. The swatch is a
              convenience; the label is what actually names the slice. */}
          <dl className="flex flex-wrap gap-x-5 gap-y-1 mb-3">
            {intensity.slices.map((slice) => (
              <div key={slice.key} className="flex items-baseline gap-1.5">
                <span
                  aria-hidden="true"
                  className="w-2.5 h-2.5 self-center shrink-0"
                  style={{ backgroundColor: SLICE_COLOR[slice.key] }}
                />
                <dt className="text-note text-pencil">{slice.label}</dt>
                <dd className="measured text-note">
                  {slice.minutes} {t('trends.review.minutes')}
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      <p className="prose-log text-note text-pencil">{intensity.verdict}</p>
      {intensity.available && intensity.reason && (
        <p className="marginalia mt-2">{intensity.reason}</p>
      )}
    </LogSection>
  );
}
