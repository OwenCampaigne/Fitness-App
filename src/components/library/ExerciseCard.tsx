'use client';

import { useState } from 'react';
import { Dumbbell, ChevronDown, ChevronUp, Lightbulb, Zap } from 'lucide-react';
import type { ExerciseEntry } from '@/types/library';

const IMAGE_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

const LEVEL_COLORS: Record<string, string> = {
  beginner: 'bg-recovery-green/20 text-recovery-green',
  intermediate: 'bg-stress/20 text-stress',
  expert: 'bg-recovery-red/20 text-recovery-red',
};

function resolveImageUrl(img: string): string {
  if (img.startsWith('http')) return img;
  return IMAGE_BASE + img;
}

interface Props {
  exercise: ExerciseEntry;
  className?: string;
}

export default function ExerciseCard({ exercise, className = '' }: Props) {
  const [open, setOpen] = useState(false);

  const imageUrl = exercise.images.length > 0 ? resolveImageUrl(exercise.images[0]) : null;
  const levelColor = exercise.level ? (LEVEL_COLORS[exercise.level.toLowerCase()] ?? 'bg-muted/30 text-secondary') : null;

  return (
    <div className={`card ${className}`}>
      {/* Header row: image + name/muscles/equipment */}
      <div className="flex gap-3 mb-3">
        {/* Thumbnail */}
        <div className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-muted/30 flex items-center justify-center">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={exercise.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <Dumbbell size={24} className="text-secondary" />
          )}
        </div>

        {/* Name + details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-primary leading-tight">{exercise.name}</h3>
            {levelColor && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${levelColor}`}>
                {exercise.level}
              </span>
            )}
          </div>

          {exercise.primaryMuscles.length > 0 && (
            <div className="flex items-center gap-1 mt-1">
              <Zap size={10} className="text-secondary flex-shrink-0" />
              <span className="text-xs text-secondary truncate">
                {exercise.primaryMuscles.join(', ')}
              </span>
            </div>
          )}

          {exercise.equipment.length > 0 && (
            <div className="flex items-center gap-1 mt-0.5">
              <Dumbbell size={10} className="text-secondary flex-shrink-0" />
              <span className="text-xs text-secondary truncate">
                {exercise.equipment.join(', ')}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Instructions collapsible */}
      {exercise.instructions.length > 0 && (
        <div className="border-t border-border pt-3">
          <button
            onClick={() => setOpen(prev => !prev)}
            className="flex items-center gap-1 w-full text-left text-xs font-semibold text-secondary uppercase tracking-widest hover:text-primary transition-colors"
          >
            How to do it
            {open ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
          </button>
          {open && (
            <ol className="mt-2 space-y-1 pl-4 list-decimal">
              {exercise.instructions.map((step, i) => (
                <li key={i} className="text-xs text-secondary leading-relaxed">
                  {step}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* Rationale chip */}
      {exercise.rationale && (
        <div className="mt-3 flex items-start gap-1.5 bg-muted/20 rounded-lg px-3 py-2">
          <Lightbulb size={12} className="text-stress flex-shrink-0 mt-0.5" />
          <p className="text-xs text-secondary leading-relaxed">{exercise.rationale}</p>
        </div>
      )}
    </div>
  );
}
