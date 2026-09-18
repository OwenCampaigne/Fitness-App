'use client';

// ── HR zones ──────────────────────────────────────────────────────────────────
// Karvonen off a max HR that is usually an age estimate, so the boundaries are
// pencil until a real max HR has been seen. The five zones take the muted
// series ramp — they are five categories, not five verdicts — and each row is
// a ruled line rather than a rounded chip.

import { calculateTrainingZones } from '@/lib/scoring';
import LogSection from './ui/LogSection';
import { SERIES } from './ui/chartTheme';
import { useLang } from '@/lib/i18n';

interface Props {
  restingHR: number;
  age: number;
  observedMaxHR?: number;
  /** If provided, marks the zone the user was in today */
  lastActivityAvgHR?: number;
}

export default function TrainingZonesCard({ restingHR, age, observedMaxHR, lastActivityAvgHR }: Props) {
  const { t } = useLang();
  if (!restingHR || restingHR < 20) return null;

  const zones = calculateTrainingZones(restingHR, age, observedMaxHR);
  const maxHRObserved = Boolean(observedMaxHR && observedMaxHR > 100);
  const figureClass = maxHRObserved ? 'measured' : 'estimated';

  const activeZone = lastActivityAvgHR
    ? zones.find(z => lastActivityAvgHR >= z.hrLow && lastActivityAvgHR <= z.hrHigh)?.zone
    : null;

  return (
    <LogSection
      label={t('trainingZones.title')}
      figure={
        <span className="font-serif text-note italic text-faint">{t('trainingZones.model')}</span>
      }
    >
      <ul>
        {[...zones].reverse().map(zone => {
          const isActive = activeZone === zone.zone;
          const color = SERIES[(zone.zone - 1) % SERIES.length];
          return (
            <li
              key={zone.zone}
              className={`entry flex items-baseline gap-3 py-2 ${
                isActive ? 'border-l-2 border-ink pl-2 -ml-2' : ''
              }`}
            >
              <span
                className="w-4 h-4 shrink-0 self-center flex items-center justify-center text-note figures text-paper"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              >
                {zone.zone}
              </span>

              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-entry text-ink truncate">{t(zone.name)}</span>
                  <span className={`${figureClass} text-note shrink-0`}>
                    {zone.hrLow}–{zone.hrHigh}
                    <span className="text-faint font-normal ml-1">bpm</span>
                  </span>
                </div>
                <p className="text-note text-pencil">{t(zone.description)}</p>
              </div>

              {isActive && (
                <span className="font-serif text-note italic text-ink shrink-0">
                  {t('trainingZones.today')}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <p className="marginalia mt-3">
        {t('trainingZones.fcInfo', {
          maxHR: maxHRObserved
            ? t('trainingZones.fcMaxObserved', { hr: observedMaxHR! })
            : t('trainingZones.fcMaxEstimated', { hr: Math.round(208 - 0.7 * age) }),
          restHR: restingHR,
        })}
      </p>
    </LogSection>
  );
}
