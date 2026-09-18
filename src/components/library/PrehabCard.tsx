'use client';

// ── A prehab row (framework §15) ─────────────────────────────────────────────
// The one catalog whose authored `rationale` copy can name a condition, so it
// leads with the structured fields instead — `targetTissue` and `muscleText`
// say what the movement is for without saying what you have. The rationale is
// only ever rendered here after the server has run it past
// `containsDiagnosisLanguage`; anything flagged arrives as null.

import { ExternalLink } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import type { PrehabEntry } from '@/types/library';

interface Props {
  prehab: PrehabEntry;
  className?: string;
}

export default function PrehabCard({ prehab, className = '' }: Props) {
  const { t } = useLang();
  const meta = [prehab.bodyRegion, prehab.category].filter(Boolean).join(' · ');

  return (
    <div className={`entry ${className}`}>
      <h3 className="font-sans text-entry text-ink">{prehab.name}</h3>
      <p className="font-serif text-note italic text-pencil">{meta}</p>

      {prehab.targetTissue && (
        <p className="mt-1 font-sans text-note text-pencil">
          {t('library.targetTissue')}: <span className="text-ink">{prehab.targetTissue}</span>
        </p>
      )}

      {prehab.muscleText && (
        <p className="mt-1 font-sans text-note text-pencil">{prehab.muscleText}</p>
      )}

      {prehab.niggleTags.length > 0 && (
        <p className="mt-1 font-serif text-note italic text-pencil">
          {prehab.niggleTags.join(' · ')}
        </p>
      )}

      {prehab.rationale && <p className="marginalia mt-1.5">{prehab.rationale}</p>}

      {prehab.videoUrl && (
        <a
          href={prehab.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1.5 font-sans text-note text-ink underline underline-offset-2"
        >
          <ExternalLink size={12} />
          {t('library.video')}
        </a>
      )}
    </div>
  );
}
