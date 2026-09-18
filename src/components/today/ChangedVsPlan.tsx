'use client'

// ── "What changed vs plan" (§14 step 5) ───────────────────────────────────────
// Collapsed by default, because on most days the answer is "nothing to action"
// and a screen that shouts about every unchanged day trains you to stop reading
// it. When something did change, every line says what and why — the allocator
// already wrote those reasons, and §10's whole premise is that the decisions
// are the explanation.

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useLang } from '@/lib/i18n'
import { changedCount, changedHeadline } from '@/lib/todayView'
import type { TodayResponse } from './types'

interface Props {
  changed: TodayResponse['changedVsPlan']
}

export default function ChangedVsPlan({ changed }: Props) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)

  const count = changedCount(changed)
  const headline = count === 0 ? t('today.changed.none') : changedHeadline(changed)

  return (
    <section className="border-t border-rule pt-2">
      <button
        type="button"
        onClick={() => count > 0 && setOpen((v) => !v)}
        disabled={count === 0}
        aria-expanded={count > 0 ? open : undefined}
        className="w-full flex items-baseline gap-3 text-left"
      >
        <span className="block-label mb-0 shrink-0">{t('today.changed.title')}</span>
        <span className="estimated text-note ml-auto truncate">{headline}</span>
        {count > 0 && (
          <ChevronDown
            size={14}
            className={`text-pencil shrink-0 self-center transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        )}
      </button>

      {open && count > 0 && (
        <ul className="mt-1">
          {changed.entries.map((entry) => (
            <li key={`${entry.itemId}-${entry.code}`} className="entry py-2">
              <div className="flex items-baseline gap-3">
                <span className="text-entry text-ink truncate">{entry.name}</span>
                <span className="font-serif italic text-note text-pencil ml-auto shrink-0">
                  {t(`today.changed.outcome.${entry.outcome}`)}
                </span>
              </div>
              <p className="marginalia mt-1">{entry.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
