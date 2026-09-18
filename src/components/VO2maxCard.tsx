'use client';

// ── VO2max ────────────────────────────────────────────────────────────────────
// This number was never measured. It is inferred from resting HR and a max HR
// that is itself often the Tanaka age estimate — so the whole block is set in
// graphite, and the two inputs say which of them is observed and which is
// guessed. Framework §3: an anchor carries its source, and the source is
// load-bearing. Dressing a formula as a lab result is exactly the failure this
// design exists to prevent.

import { calculateVO2max, getVO2maxCategory } from '@/lib/scoring';
import type { Sex } from '@/lib/types';
import LogSection from './ui/LogSection';
import { useLang } from '@/lib/i18n';

const CATEGORY_PERCENTILE: Record<string, string> = {
  superior:  'Top 5%',
  excelente: 'Top 20%',
  bueno:     'Top 40%',
  promedio:  'Top 60%',
  bajo:      'Bottom 40%',
};

interface Props {
  restingHR: number;
  age: number;
  sex: Sex;
  observedMaxHR?: number;
}

export default function VO2maxCard({ restingHR, age, sex, observedMaxHR }: Props) {
  const { t } = useLang();
  if (!restingHR || restingHR < 20) return null;

  const vo2max = calculateVO2max(restingHR, age, observedMaxHR);
  const norm = getVO2maxCategory(vo2max, age, sex);
  const maxHRObserved = Boolean(observedMaxHR && observedMaxHR > 100);
  const maxHR = maxHRObserved ? observedMaxHR! : Math.round(208 - 0.7 * age);

  // 20–70 mapped onto the width of the scale.
  const barPct = Math.min(100, Math.max(0, ((vo2max - 20) / 50) * 100));

  const CATEGORY_LABEL: Record<string, string> = {
    superior:  t('vo2max.categories.superior'),
    excelente: t('vo2max.categories.excellent'),
    bueno:     t('vo2max.categories.good'),
    promedio:  t('vo2max.categories.average'),
    bajo:      t('vo2max.categories.low'),
  };

  const segments = [
    { label: t('vo2max.chartLabels.low'), pct: 0 },
    { label: t('vo2max.chartLabels.avg'), pct: 20 },
    { label: t('vo2max.chartLabels.good'), pct: 40 },
    { label: t('vo2max.chartLabels.excellent'), pct: 60 },
    { label: t('vo2max.chartLabels.superior'), pct: 80 },
  ];

  return (
    <LogSection
      label={t('vo2max.title')}
      figure={
        <span className="font-serif text-note italic text-pencil">
          {CATEGORY_LABEL[norm.label]}
        </span>
      }
    >
      <div className="flex items-baseline gap-3 mb-3">
        {/* Graphite, because nobody measured this. */}
        <span className="estimated text-verdict">{vo2max}</span>
        <div>
          <p className="font-serif text-entry italic text-pencil leading-tight">
            {t('vo2max.unit')}
          </p>
          <p className="text-note text-faint">{CATEGORY_PERCENTILE[norm.label]}</p>
        </div>
      </div>

      {/* A ruled scale with category ticks — no gradient. */}
      <div className="relative h-2 bg-wash border border-rule mb-1">
        {segments.slice(1).map(s => (
          <div
            key={s.label}
            className="absolute top-0 h-full w-px bg-rule"
            style={{ left: `${s.pct}%` }}
          />
        ))}
        <div
          className="absolute top-1/2 w-2.5 h-2.5 bg-pencil"
          style={{ left: `${barPct}%`, transform: 'translate(-50%, -50%) rotate(45deg)' }}
        />
      </div>
      <div className="flex justify-between font-serif text-note italic text-faint mb-3">
        {segments.map(s => <span key={s.label}>{s.label}</span>)}
      </div>

      {/* What the estimate was built from, and how solid each input is */}
      <dl className="flex gap-5 border-t border-rule pt-2">
        <div>
          <dt className="font-serif text-note italic text-faint">{t('vo2max.inputs.restingHR')}</dt>
          <dd className="measured text-entry">{restingHR}</dd>
        </div>
        <div>
          <dt className="font-serif text-note italic text-faint">
            {maxHRObserved ? t('vo2max.inputs.maxHRReal') : t('vo2max.inputs.maxHREstimated')}
          </dt>
          <dd className={`${maxHRObserved ? 'measured' : 'estimated'} text-entry`}>{maxHR}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-serif text-note italic text-faint">{t('vo2max.formula')}</dt>
          <dd className="text-note text-pencil truncate">{t('vo2max.formulaDetail')}</dd>
        </div>
      </dl>

      <p className="marginalia mt-3">{t('vo2max.note')}</p>
    </LogSection>
  );
}
