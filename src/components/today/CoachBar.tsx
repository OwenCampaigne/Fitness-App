'use client'

// ── Path A — talk to the coach (§11, §14 step 4) ──────────────────────────────
// One sentence in: "make today easier", "only 30 min", "swap the squats for
// something gentler on my knee".
//
// `/api/coach` previews: it judges the model's patch against the same validator
// the tap-to-edit path uses and hands back the diff, the verdict and any
// counter-proposal with **nothing persisted**. So what arrives here is a
// proposal, not a receipt, and it goes to the same review panel a manual edit
// opens — preview, confirm, apply, in that order, for both actors (§11-A).
//
// This bar itself is deliberately dumb about outcomes. It hands whatever came
// back to the one review panel and lets that render it, because "what the
// validator said" should look identical whichever way the edit arrived. The
// only thing it decides is whether there is anything to review at all: a reply
// with no ops behind it is a sentence, and a sentence belongs inline rather
// than behind a confirmation dialog with nothing to confirm.

import { useState } from 'react'
import { useLang } from '@/lib/i18n'
import type { CoachResponse } from './types'

export interface CoachOutcome {
  sentence: string
  response: CoachResponse
}

interface Props {
  disabled: boolean
  /** Fired only when there is a verdict worth showing in the review panel. */
  onOutcome: (outcome: CoachOutcome) => void
}

export default function CoachBar({ disabled, onOutcome }: Props) {
  const { t } = useLang()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function send() {
    const sentence = text.trim()
    if (sentence.length === 0 || busy) return

    setBusy(true)
    setNote(null)

    try {
      const res = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sentence }),
      })

      // The route is not built on this deployment at all.
      if (res.status === 404 || res.status === 501) {
        setNote(t('today.coach.unavailable'))
        return
      }

      const json = (await res.json().catch(() => ({}))) as CoachResponse

      // Every non-2xx shape this route defines still carries a `reply` written
      // for a person — no key, no network, out of contract, a preference it
      // would have broken. Showing that is strictly better than a status code.
      if (json.reply && !json.verdict) {
        setNote(json.reply)
        setText('')
        return
      }

      if (!res.ok && !json.verdict) {
        setNote(json.error ?? t('today.coach.error'))
        return
      }

      if (!json.verdict) {
        setNote(json.reply ?? t('today.coach.noPatch'))
        return
      }

      // "No change today" is a legitimate answer (§10's CHANGED section), and
      // it has no diff to confirm. Say it, rather than opening an empty panel.
      if ((json.patch?.ops.length ?? 0) === 0) {
        setNote(json.reply ?? t('today.coach.noPatch'))
        setText('')
        return
      }

      onOutcome({ sentence, response: json })
      setText('')
    } catch {
      // A network failure and a missing route look the same from here, and the
      // useful thing to say is the same either way.
      setNote(t('today.coach.unavailable'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="border-t border-rule pt-2">
      <p className="block-label">{t('today.coach.label')}</p>

      {/* You write on the rule, the way you would in the book itself. */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={text}
          maxLength={500}
          disabled={disabled || busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send()
          }}
          placeholder={t('today.coach.placeholder')}
          aria-label={t('today.coach.label')}
          className="flex-1 min-w-0 bg-transparent border-0 border-b border-rule focus:border-ink py-2 text-entry text-ink placeholder:text-faint disabled:opacity-40 rounded-none"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={disabled || busy || text.trim().length === 0}
          className="shrink-0 border border-ink text-ink text-entry font-medium px-4 py-1.5 rounded-sm disabled:opacity-40 hover:bg-ink hover:text-paper transition-colors"
        >
          {t('today.coach.send')}
        </button>
      </div>

      {busy && <p className="marginalia mt-2">{t('today.coach.thinking')}</p>}
      {note && <p className="marginalia mt-2 whitespace-pre-line">{note}</p>}
    </section>
  )
}
