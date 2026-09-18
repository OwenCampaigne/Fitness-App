'use client';

// ── History ───────────────────────────────────────────────────────────────────
// Dated bests and closed weeks. Framework §14 keeps all of this off the daily
// screen: today's answer is one decision, and a personal-best table is the
// weekly review's job.
//
// The refusals block is the part that matters most. A records page that only
// shows what it found reads as complete; showing what it declined to count —
// and why — is what stops a fast kilometre inside a long run from quietly
// becoming a personal best (§21, the Contrarian). It is set in the margin, in
// the coach's voice, because it is commentary on the table rather than more
// table.

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { HistoryView } from '@/lib/records';
import RecordsTable from './RecordsTable';
import WeekHistoryCard from './WeekHistoryCard';
import LogSection from '@/components/ui/LogSection';
import { useLang } from '@/lib/i18n';

export default function HistoryTab() {
  const { t } = useLang();
  const [view, setView] = useState<HistoryView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/trends?view=history', { cache: 'no-store' });
      const json = (await res.json()) as HistoryView & { error?: string };
      if (!res.ok) throw new Error(json.error ?? t('trends.history.error'));
      setView(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('trends.history.error'));
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
        {t('trends.history.loading')}
      </p>
    );
  }

  if (error || !view) {
    return (
      <div className="border-l-2 border-stop pl-3 py-2 flex flex-col gap-2">
        <p className="text-entry text-stop leading-snug">{error ?? t('trends.history.error')}</p>
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
      <header>
        <h2 className="font-serif text-head text-ink mb-1">{t('trends.history.title')}</h2>
        <p className="prose-log text-entry text-pencil">{t('trends.history.subtitle')}</p>
      </header>

      <RecordsTable family="run" records={view.runs} />
      <RecordsTable family="lift" records={view.lifts} />

      {/* What the detector saw and would not call a record */}
      {view.refusals.length > 0 && (
        <LogSection label={t('trends.history.refusalsTitle')}>
          <p className="prose-log text-note text-pencil mb-2">
            {t('trends.history.refusalsSubtitle')}
          </p>
          <ul className="flex flex-col gap-1.5">
            {view.refusals.map((refusal, i) => (
              <li key={`${refusal.kind}:${refusal.subjectId}:${i}`} className="marginalia">
                {refusal.reason}
              </li>
            ))}
          </ul>
        </LogSection>
      )}

      <WeekHistoryCard weeks={view.weeks} />

      <p className="font-serif text-note italic text-faint text-center leading-snug pt-2">
        {t('trends.history.footer', { date: view.generatedFor })}
      </p>
    </div>
  );
}
