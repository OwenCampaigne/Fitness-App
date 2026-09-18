'use client';

import { useLang } from '@/lib/i18n';

interface Props {
  steps: number;
  calories: number;
}

export default function StatsRow({ steps, calories }: Props) {
  const { t, locale } = useLang();
  if (!steps && !calories) return null;
  return (
    <dl className="flex gap-8 border-y border-rule py-2">
      {steps > 0 && (
        <div>
          <dt className="font-serif text-note italic text-faint">{t('statsRow.steps')}</dt>
          <dd className="measured text-head">{steps.toLocaleString(locale)}</dd>
        </div>
      )}
      {calories > 0 && (
        <div>
          <dt className="font-serif text-note italic text-faint">{t('statsRow.calories')}</dt>
          <dd className="measured text-head">{calories.toLocaleString(locale)}</dd>
        </div>
      )}
    </dl>
  );
}
