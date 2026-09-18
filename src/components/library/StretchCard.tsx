'use client';

import { useLang } from '@/lib/i18n';
import type { StretchEntry } from '@/types/library';

interface Props {
  stretch: StretchEntry;
  className?: string;
}

export default function StretchCard({ stretch, className = '' }: Props) {
  const { t } = useLang();

  const meta = [stretch.type, stretch.whenToUse, stretch.target].filter(Boolean).join(' · ');
  const dose = [
    stretch.durationSec != null ? t('library.seconds', { count: stretch.durationSec }) : null,
    stretch.reps != null ? t('library.reps', { count: stretch.reps }) : null,
  ].filter(Boolean);

  return (
    <div className={`entry ${className}`}>
      <h3 className="font-sans text-entry text-ink">{stretch.name}</h3>
      <p className="font-serif text-note italic capitalize text-pencil">{meta}</p>

      {stretch.muscleText && (
        <p className="mt-1 font-sans text-note text-pencil">{stretch.muscleText}</p>
      )}

      {dose.length > 0 && (
        <p className="figures mt-1 font-sans text-note text-ink">{dose.join(' · ')}</p>
      )}

      {stretch.rationale && <p className="marginalia mt-1.5">{stretch.rationale}</p>}
    </div>
  );
}
