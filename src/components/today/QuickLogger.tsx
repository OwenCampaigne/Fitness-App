'use client'

// ── Logging anything that is not a lift ───────────────────────────────────────
// Framework §14 step 6. `SetLogger` already logs a lift in kilos, reps and RIR,
// and the Today screen uses that one unchanged — this is its sibling for the
// doses the other three modalities carry: ground contacts for a plyo, reps or
// seconds of hold for prehab and stretching (§9).
//
// The steppers come from `SetLogger` itself, so the control is literally the
// same one, and which steppers appear is decided by `logFields` rather than by
// the card: a rep-dosed stretch loses its hold stepper without this component
// knowing what a stretch is.

import { useState } from 'react'
import { Stepper } from '@/components/strength/SetLogger'
import { LOG_FIELD_BOUNDS, defaultLogValues, logFields } from '@/lib/todayView'
import type { LogField, LogValues } from '@/lib/todayView'
import type { ItemParams } from '@/types/session'

interface Props {
  params: ItemParams
  setNumber: number
  disabled?: boolean
  labels: Record<LogField, string>
  logLabel: string
  savingLabel: string
  onLog: (values: LogValues) => Promise<void>
}

export default function QuickLogger({
  params,
  setNumber,
  disabled = false,
  labels,
  logLabel,
  savingLabel,
  onLog,
}: Props) {
  const fields = logFields(params)
  const [values, setValues] = useState<LogValues>(() => defaultLogValues(params))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (fields.length === 0) return null

  async function handleLog() {
    setSaving(true)
    setError(null)
    try {
      await onLog(values)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3">
      <div className={`grid gap-2 ${fields.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {fields.map((field) => {
          const bounds = LOG_FIELD_BOUNDS[field]
          return (
            <Stepper
              key={field}
              label={labels[field]}
              value={values[field] ?? bounds.min}
              step={bounds.step}
              min={bounds.min}
              max={bounds.max}
              onChange={(v) => setValues((prev) => ({ ...prev, [field]: v }))}
              disabled={disabled || saving}
            />
          )
        })}
      </div>

      <button
        type="button"
        onClick={handleLog}
        disabled={disabled || saving}
        className="mt-2 w-full border border-ink text-ink text-entry font-medium py-2 rounded-sm disabled:opacity-40 hover:bg-ink hover:text-paper transition-colors"
      >
        {saving ? savingLabel : `${logLabel} ${setNumber}`}
      </button>

      {error && <p className="mt-1.5 text-note text-stop">{error}</p>}
    </div>
  )
}
