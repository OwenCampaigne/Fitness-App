'use client';

// ── Today's strain ────────────────────────────────────────────────────────────
// A 0–21 Bannister figure and the activities behind it. Strain is a quantity,
// not a verdict — nothing here decides whether the day was a good idea — so it
// takes the series token and the scale underneath is labelled in words.

import { Timer, Heart, Flame } from 'lucide-react';
import type { ActivityData } from '@/lib/types';
import { formatDuration } from '@/lib/scoring';
import LogSection from './ui/LogSection';
import { METRIC } from './ui/chartTheme';
import { useLang } from '@/lib/i18n';

const ACTIVITY_ICONS: Record<string, string> = {
  running: '🏃',
  cycling: '🚴',
  swimming: '🏊',
  walking: '🚶',
  strength_training: '🏋️',
  yoga: '🧘',
  other: '⚡',
};

interface Props {
  activities: ActivityData[];
  todayStrain: number;
  steps?: number;
  floorsAscended?: number;
  highlyActiveSeconds?: number;
  bodyBatteryDrained?: number;
}

export default function StrainCard({
  activities,
  todayStrain,
  steps = 0,
  floorsAscended = 0,
  highlyActiveSeconds = 0,
  bodyBatteryDrained = 0,
}: Props) {
  const { t } = useLang();
  const highlyActiveMin = Math.round(highlyActiveSeconds / 60);

  const chips: string[] = [];
  if (steps > 0) chips.push(t('strain.steps', { steps: steps.toLocaleString() }));
  if (highlyActiveMin > 5) chips.push(t('strain.activeMin', { min: highlyActiveMin }));
  if (floorsAscended > 3) chips.push(t('strain.floors', { floors: floorsAscended }));
  if (bodyBatteryDrained > 10) chips.push(t('strain.batteryDrained', { drained: bodyBatteryDrained }));

  return (
    <LogSection
      label={t('strain.titleToday')}
      figure={
        <span className="measured text-head" style={{ color: METRIC.strain }}>
          {todayStrain.toFixed(1)}
          <span className="text-note font-normal text-faint ml-1">/ 21</span>
        </span>
      }
    >
      {/* Whoop-style 0–21 scale, ruled */}
      <div className="w-full h-1.5 bg-wash border border-rule mb-1">
        <div
          className="h-full transition-all duration-700"
          style={{ width: `${(todayStrain / 21) * 100}%`, backgroundColor: METRIC.strain }}
        />
      </div>
      <div className="flex justify-between font-serif text-note italic text-faint mb-3">
        <span>{t('common.low')}</span>
        <span>{t('common.moderate')}</span>
        <span>{t('common.high')}</span>
        <span>{t('strain.extreme')}</span>
      </div>

      {chips.length > 0 && (
        <p className="text-note text-pencil figures mb-2">{chips.join(' · ')}</p>
      )}

      {activities.length === 0 ? (
        <p className="prose-log text-note text-pencil">{t('strain.noActivities')}</p>
      ) : (
        <ul>
          {activities.map((act, i) => (
            <li key={i} className="entry flex items-center gap-3 py-2">
              <span className="text-lg" aria-hidden="true">
                {ACTIVITY_ICONS[act.type] ?? ACTIVITY_ICONS.other}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-entry text-ink truncate">{act.name}</p>
                <div className="flex gap-3 mt-0.5 text-note text-pencil figures">
                  <span className="flex items-center gap-1">
                    <Timer size={10} aria-hidden="true" />
                    {formatDuration(act.duration)}
                  </span>
                  {act.averageHR > 0 && (
                    <span className="flex items-center gap-1">
                      <Heart size={10} aria-hidden="true" />
                      {act.averageHR} bpm
                    </span>
                  )}
                  {act.calories > 0 && (
                    <span className="flex items-center gap-1">
                      <Flame size={10} aria-hidden="true" />
                      {act.calories} kcal
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end shrink-0">
                <span className="measured text-entry" style={{ color: METRIC.strain }}>
                  {act.strain.toFixed(1)}
                </span>
                <span className="font-serif text-note italic text-faint">
                  {t('strain.strainLabel')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </LogSection>
  );
}
