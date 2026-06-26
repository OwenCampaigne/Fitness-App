'use client';

import { Lightbulb, Zap } from 'lucide-react';
import type { PlyoEntry } from '@/types/library';

const TIER_STYLES: Record<number, string> = {
  1: 'bg-recovery-green/20 text-recovery-green',
  2: 'bg-stress/20 text-stress',
  3: 'bg-recovery-red/20 text-recovery-red',
};

interface Props {
  plyo: PlyoEntry;
  className?: string;
}

export default function PlyoCard({ plyo, className = '' }: Props) {
  const tierColor = TIER_STYLES[plyo.progressionTier] ?? 'bg-muted/30 text-secondary';

  return (
    <div className={`card ${className}`}>
      {/* Header */}
      <div className="flex items-start gap-2 flex-wrap mb-3">
        <h3 className="text-sm font-semibold text-primary leading-tight flex-1 min-w-0">
          {plyo.name}
        </h3>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${tierColor}`}>
          Tier {plyo.progressionTier}
        </span>
        {plyo.intensity && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 bg-battery/20 text-battery">
            {plyo.intensity}
          </span>
        )}
      </div>

      {/* Target */}
      {plyo.target && (
        <div className="flex items-center gap-1 mb-2">
          <Zap size={10} className="text-secondary flex-shrink-0" />
          <span className="text-xs text-secondary">{plyo.target}</span>
        </div>
      )}

      {/* Muscle text */}
      {plyo.muscleText && (
        <p className="text-xs text-secondary mb-2">{plyo.muscleText}</p>
      )}

      {/* Contact load */}
      {plyo.contactLoad && (
        <div className="text-xs text-secondary mb-2">
          <span className="text-muted uppercase tracking-widest text-[10px]">Contact load: </span>
          {plyo.contactLoad}
        </div>
      )}

      {/* Prerequisites */}
      {plyo.prerequisites.length > 0 && (
        <div className="mb-2">
          <span className="text-[10px] text-muted uppercase tracking-widest">Prerequisites: </span>
          <span className="text-xs text-secondary">{plyo.prerequisites.join(', ')}</span>
        </div>
      )}

      {/* Rationale chip */}
      {plyo.rationale && (
        <div className="mt-2 flex items-start gap-1.5 bg-muted/20 rounded-lg px-3 py-2">
          <Lightbulb size={12} className="text-stress flex-shrink-0 mt-0.5" />
          <p className="text-xs text-secondary leading-relaxed">{plyo.rationale}</p>
        </div>
      )}
    </div>
  );
}
