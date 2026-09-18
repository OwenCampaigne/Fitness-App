'use client';

// ── /trends ───────────────────────────────────────────────────────────────────
// The weekly review. Framework §14 is explicit that charts and trends live on
// this page and never on the daily screen, which answers one question and only
// one — so everything with an axis belongs here.
//
// Three tabs. **Review** is the anchor arc plus the week that produced it: what
// the coach believes about you, where each belief started, and how sure it is
// (§3, §5b, and the Expansionist's argument in §21 that a system showing its
// own estimates sharpening is the differentiator). **History** is the dated
// record of what actually happened — personal bests with the day they were set,
// and closed weeks rolled up. **Metrics** is the Phase 1 daily-signal view,
// kept whole.
//
// Visually this is the back of the log: the daily screen is one answer, this is
// the pages you flip back through. Ruled sections, no panels, and the tabs are
// index markers rather than buttons.

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import HistoryTab from '@/components/trends/HistoryTab';
import MetricsTab from '@/components/trends/MetricsTab';
import WeeklyReviewClient from '@/components/trends/WeeklyReviewClient';
import { useLang } from '@/lib/i18n';

type Tab = 'review' | 'history' | 'metrics';

export default function TrendsPage() {
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>('review');

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'review', label: t('trends.review.tabReview') },
    { key: 'history', label: t('trends.history.tab') },
    { key: 'metrics', label: t('trends.review.tabMetrics') },
  ];

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur border-b border-rule">
        <div className="max-w-md mx-auto px-4 pt-3 flex items-baseline gap-3">
          <Link
            href="/"
            aria-label={t('common.today')}
            className="-ml-1 p-1 text-pencil hover:text-ink transition-colors self-center"
          >
            <ArrowLeft size={16} />
          </Link>
          <h1 className="font-serif text-head text-ink">{t('trends.title')}</h1>
        </div>

        {/* Index markers, not pills. The active tab is underlined in ink. */}
        <nav className="max-w-md mx-auto px-4 flex gap-5" aria-label={t('trends.title')}>
          {tabs.map((option) => (
            <button
              key={option.key}
              onClick={() => setTab(option.key)}
              aria-current={tab === option.key ? 'page' : undefined}
              className={`py-2 -mb-px border-b-2 font-serif text-entry transition-colors ${
                tab === option.key
                  ? 'border-ink text-ink'
                  : 'border-transparent text-pencil hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-md mx-auto px-4 pb-28 pt-4">
        {tab === 'review' && <WeeklyReviewClient />}
        {tab === 'history' && <HistoryTab />}
        {tab === 'metrics' && <MetricsTab />}
      </main>

      <BottomNav />
    </div>
  );
}
