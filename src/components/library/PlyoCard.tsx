'use client';

import { useLang } from '@/lib/i18n';
import type { PlyoEntry } from '@/types/library';

interface Props {
  plyo: PlyoEntry;
  className?: string;
}

export default function PlyoCard({ plyo, className = '' }: Props) {
  const { t } = useLang();

  // Tier is a progression rung, not a warning — it reads as text, like
  // everything else that is a fact rather than a verdict.
  const meta = [t('library.tier', { n: plyo.progressionTier }), plyo.intensity, plyo.target]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`entry ${className}`}>
      <h3 className="font-sans text-entry text-ink">{plyo.name}</h3>
      <p className="font-serif text-note italic text-pencil">{meta}</p>

      {plyo.muscleText && (
        <p className="mt-1 font-sans text-note text-pencil">{plyo.muscleText}</p>
      )}

      {plyo.contactLoad && (
        <p className="mt-1 font-sans text-note text-pencil">
          {t('library.contactLoad')}: <span className="figures text-ink">{plyo.contactLoad}</span>
        </p>
      )}

      {plyo.prerequisites.length > 0 && (
        <p className="mt-1 font-sans text-note text-pencil">
          {t('library.prerequisites')}: <span className="text-ink">{plyo.prerequisites.join(', ')}</span>
        </p>
      )}

      {plyo.rationale && <p className="marginalia mt-1.5">{plyo.rationale}</p>}
    </div>
  );
}
