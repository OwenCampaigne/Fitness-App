'use client';

// ── Weekly review ─────────────────────────────────────────────────────────────
// The anchor arc first, the weekly numbers underneath it. That order is the
// argument: §21's Expansionist says the differentiator is a coach that can show
// you its own estimates getting sharper, so the page opens with what the system
// believes about you and how sure it is, and only then shows the week that
// produced those beliefs.
//
// No judgement is made in this file. Every threshold, verdict and sentence
// comes from `lib/trends.ts`, which is pure and unit-tested; this is assembly.

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { WeeklyReview } from '@/lib/trends';
import AcwrChart from './AcwrChart';
import AnchorArcCard from './AnchorArcCard';
import IntensitySplit from './IntensitySplit';
import MuscleVolumeChart from './MuscleVolumeChart';
import ReadinessTrendChart from './ReadinessTrendChart';
import WeeklyVolumeChart from './WeeklyVolumeChart';
import { useLang } from '@/lib/i18n';

export default function WeeklyReviewClient() {
  const { t } = useLang();
  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/trends?view=review', { cache: 'no-store' });
      const json = (await res.json()) as WeeklyReview & { error?: string };
      if (!res.ok) throw new Error(json.error ?? t('trends.review.error'));
      setReview(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('trends.review.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <p className="flex items-center justify-center gap-2 py-12 font-serif text-note italic text-pencil">
        <Loader2 size={13} className="animate-spin" />
        {t('trends.review.loading')}
      </p>
    );
  }

  if (error || !review) {
    return (
      <div className="border-l-2 border-stop pl-3 py-2 flex flex-col gap-2">
        <p className="text-entry text-stop leading-snug">{error ?? t('trends.review.error')}</p>
        <button
          onClick={() => void load()}
          className="self-start flex items-center gap-1.5 font-serif text-note italic text-pencil hover:text-ink transition-colors"
        >
          <RefreshCw size={12} />
          {t('trends.review.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">

      {/* ── How much of this the system has actually earned ─────────────── */}
      <header>
        <h2 className="font-serif text-head text-ink mb-1">{t('trends.review.anchorsTitle')}</h2>
        <p className="prose-log text-entry text-pencil">{t('trends.review.anchorsSubtitle')}</p>
        <p className="marginalia mt-2">{review.calibration.note}</p>
      </header>

      {/* ── The arc, one entry per anchor ────────────────────────────────── */}
      <div className="flex flex-col">
        {review.anchors.map((arc) => (
          <AnchorArcCard key={arc.id} arc={arc} />
        ))}
      </div>

      {/* ── The week that produced them ──────────────────────────────────── */}
      <WeeklyVolumeChart points={review.volume} />
      <AcwrChart points={review.acwr} />
      <IntensitySplit intensity={review.intensity} />
      <ReadinessTrendChart points={review.readiness} />
      <MuscleVolumeChart points={review.muscles} />

      <p className="font-serif text-note italic text-faint text-center leading-snug pt-2">
        {t('trends.review.footer', { date: review.generatedFor })}
      </p>
    </div>
  );
}
