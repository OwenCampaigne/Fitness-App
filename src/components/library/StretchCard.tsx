'use client';

import { Lightbulb, Clock, RotateCcw } from 'lucide-react';
import type { StretchEntry } from '@/types/library';

const TYPE_STYLES: Record<string, string> = {
  dynamic: 'bg-battery/20 text-battery',
  static: 'bg-hrv/20 text-hrv',
};

const WHEN_STYLES: Record<string, string> = {
  pre: 'bg-recovery-green/20 text-recovery-green',
  post: 'bg-stress/20 text-stress',
  recovery: 'bg-sleep/20 text-sleep',
};

interface Props {
  stretch: StretchEntry;
  className?: string;
}

export default function StretchCard({ stretch, className = '' }: Props) {
  const typeStyle = TYPE_STYLES[stretch.type.toLowerCase()] ?? 'bg-muted/30 text-secondary';
  const whenStyle = WHEN_STYLES[stretch.whenToUse.toLowerCase()] ?? 'bg-muted/30 text-secondary';

  return (
    <div className={`card ${className}`}>
      {/* Header */}
      <div className="flex items-start gap-2 flex-wrap mb-3">
        <h3 className="text-sm font-semibold text-primary leading-tight flex-1 min-w-0">
          {stretch.name}
        </h3>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 capitalize ${typeStyle}`}>
          {stretch.type}
        </span>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 capitalize ${whenStyle}`}>
          {stretch.whenToUse}
        </span>
      </div>

      {/* Target */}
      {stretch.target && (
        <p className="text-xs text-secondary mb-2">{stretch.target}</p>
      )}

      {/* Muscle text */}
      {stretch.muscleText && (
        <p className="text-xs text-secondary mb-2">{stretch.muscleText}</p>
      )}

      {/* Duration / reps */}
      <div className="flex gap-4 mb-2">
        {stretch.durationSec != null && (
          <div className="flex items-center gap-1">
            <Clock size={11} className="text-secondary" />
            <span className="text-xs text-secondary">{stretch.durationSec}s</span>
          </div>
        )}
        {stretch.reps != null && (
          <div className="flex items-center gap-1">
            <RotateCcw size={11} className="text-secondary" />
            <span className="text-xs text-secondary">{stretch.reps} reps</span>
          </div>
        )}
      </div>

      {/* Rationale chip */}
      {stretch.rationale && (
        <div className="mt-1 flex items-start gap-1.5 bg-muted/20 rounded-lg px-3 py-2">
          <Lightbulb size={12} className="text-stress flex-shrink-0 mt-0.5" />
          <p className="text-xs text-secondary leading-relaxed">{stretch.rationale}</p>
        </div>
      )}
    </div>
  );
}
