'use client';

import { Lightbulb, ExternalLink } from 'lucide-react';
import type { PrehabEntry } from '@/types/library';

interface Props {
  prehab: PrehabEntry;
  className?: string;
}

export default function PrehabCard({ prehab, className = '' }: Props) {
  return (
    <div className={`card ${className}`}>
      {/* Header */}
      <div className="flex items-start gap-2 flex-wrap mb-3">
        <h3 className="text-sm font-semibold text-primary leading-tight flex-1 min-w-0">
          {prehab.name}
        </h3>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 bg-hrv/20 text-hrv">
          {prehab.bodyRegion}
        </span>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 bg-battery/20 text-battery">
          {prehab.category}
        </span>
      </div>

      {/* Target tissue */}
      {prehab.targetTissue && (
        <div className="mb-2">
          <span className="text-[10px] text-muted uppercase tracking-widest">Target tissue: </span>
          <span className="text-xs text-secondary">{prehab.targetTissue}</span>
        </div>
      )}

      {/* Muscle text */}
      {prehab.muscleText && (
        <p className="text-xs text-secondary mb-2">{prehab.muscleText}</p>
      )}

      {/* Niggle tags */}
      {prehab.niggleTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {prehab.niggleTags.map(tag => (
            <span
              key={tag}
              className="text-[10px] px-2 py-0.5 rounded-full bg-muted/30 text-secondary"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Rationale chip */}
      {prehab.rationale && (
        <div className="mb-3 flex items-start gap-1.5 bg-muted/20 rounded-lg px-3 py-2">
          <Lightbulb size={12} className="text-stress flex-shrink-0 mt-0.5" />
          <p className="text-xs text-secondary leading-relaxed">{prehab.rationale}</p>
        </div>
      )}

      {/* Video link */}
      {prehab.videoUrl && (
        <a
          href={prehab.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-battery hover:text-battery/80 transition-colors"
        >
          <ExternalLink size={12} />
          Watch video
        </a>
      )}
    </div>
  );
}
