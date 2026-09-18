'use client'

// ── Closing the day out (§14 step 6, §3) ──────────────────────────────────────
// sRPE is the load currency's other half, and it is the one number no sensor
// can supply: TRIMP prices the run and ground contacts price the plyos, but
// only the athlete can say what the whole thing felt like. So it is one tap on
// a scale that names each rung, not a free-text box.
//
// Duration defaults to what was planned rather than to zero — a completed
// session priced at zero would quietly deflate the chronic load the whole
// budget is divided by.

import { useState } from 'react'
import { useLang } from '@/lib/i18n'
import { Stepper } from '@/components/strength/SetLogger'
import { srpeAnchor } from '@/lib/todayView'
import type { CompleteResponse } from './types'

interface Props {
  plannedMin: number
  alreadyComplete: boolean
  disabled: boolean
  onCompleted: () => void
}

export default function CompleteSession({
  plannedMin,
  alreadyComplete,
  disabled,
  onCompleted,
}: Props) {
  const { t } = useLang()
  const [srpe, setSrpe] = useState(5)
  const [durationMin, setDurationMin] = useState(plannedMin)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<CompleteResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (alreadyComplete && !done) {
    return (
      <section className="border-t border-rule pt-2">
        <p className="font-serif text-note italic text-pencil">
          {t('today.complete.alreadyComplete')}
        </p>
      </section>
    )
  }

  if (done) {
    return (
      <section className="border-t border-rule pt-2">
        <p className="block-label">{t('today.complete.doneTitle')}</p>
        {/* It happened, and it is written down. Ink. */}
        <p className="measured text-entry">
          {t('today.complete.done', {
            load: Math.round(done.actualLoad),
            srpe: done.srpe,
            min: done.actualDurationMin,
          })}
        </p>
      </section>
    )
  }

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/session/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ srpe, actualDurationMin: durationMin > 0 ? durationMin : null }),
      })
      const json = (await res.json().catch(() => ({}))) as CompleteResponse
      if (!res.ok) throw new Error(json.error ?? t('today.complete.error'))
      setDone(json)
      onCompleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('today.complete.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="border-t border-rule pt-2">
      <p className="block-label">{t('today.complete.title')}</p>

      <label htmlFor="today-srpe" className="block font-serif text-note italic text-pencil">
        {t('today.complete.srpe')}
      </label>
      <input
        id="today-srpe"
        type="range"
        min={0}
        max={10}
        step={1}
        value={srpe}
        disabled={disabled || saving}
        onChange={(e) => setSrpe(Number(e.target.value))}
        className="w-full mt-1.5 accent-ink"
      />
      {/* Your own report of the effort — nothing estimated it for you. */}
      <div className="flex items-baseline gap-2">
        <span className="measured font-serif text-head">{srpe}</span>
        <span className="font-serif italic text-note text-pencil">
          {t(`today.complete.anchors.${srpeAnchor(srpe).replace(/ /g, '_')}`)}
        </span>
      </div>

      <div className="mt-3 w-1/2">
        <Stepper
          label={t('today.complete.duration')}
          value={durationMin}
          step={5}
          min={0}
          max={600}
          onChange={setDurationMin}
          disabled={disabled || saving}
        />
      </div>
      {/* Prefilled from the plan, so until you touch it it is still a guess. */}
      <p className="marginalia mt-1.5">{t('today.complete.durationNote')}</p>

      <button
        type="button"
        onClick={submit}
        disabled={disabled || saving}
        className="mt-3 w-full border border-ink text-ink text-entry font-medium py-2.5 rounded-sm disabled:opacity-40 hover:bg-ink hover:text-paper transition-colors"
      >
        {saving ? t('today.complete.saving') : t('today.complete.submit')}
      </button>

      {error && <p className="mt-2 text-note text-stop">{error}</p>}
    </section>
  )
}
