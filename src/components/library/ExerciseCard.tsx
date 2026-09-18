'use client';

// ── A library row ────────────────────────────────────────────────────────────
// 873 exercises is the one place in this app where a dense list beats a ruled
// entry per screenful, so this is a row, not a card: thumbnail, name, one line
// of structured facts, and the steps folded away behind a native <details> so
// the list stays scannable and the disclosure costs no JavaScript.

import { Dumbbell } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import type { ExerciseEntry } from '@/types/library';

const IMAGE_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

function resolveImageUrl(img: string): string {
  if (img.startsWith('http')) return img;
  return IMAGE_BASE + img;
}

interface Props {
  exercise: ExerciseEntry;
  className?: string;
}

export default function ExerciseCard({ exercise, className = '' }: Props) {
  const { t } = useLang();
  const imageUrl = exercise.images.length > 0 ? resolveImageUrl(exercise.images[0]) : null;

  // Level is a fact about the movement, not a verdict, so it is text in the
  // meta line rather than a coloured pill.
  const meta = [
    exercise.primaryMuscles.join(', '),
    exercise.equipment.join(', '),
    exercise.level,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`entry flex gap-3 ${className}`}>
      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-sm border border-rule bg-wash">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <Dumbbell size={16} className="text-faint" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="font-sans text-entry text-ink">{exercise.name}</h3>
        {meta && <p className="font-serif text-note italic text-pencil">{meta}</p>}

        {exercise.instructions.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer font-sans text-note text-pencil hover:text-ink">
              {t('library.howTo')}
            </summary>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              {exercise.instructions.map((step, i) => (
                <li key={i} className="font-sans text-note leading-relaxed text-ink">
                  {step}
                </li>
              ))}
            </ol>
          </details>
        )}

        {exercise.rationale && <p className="marginalia mt-1.5">{exercise.rationale}</p>}
      </div>
    </div>
  );
}
