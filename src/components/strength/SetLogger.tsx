'use client'

import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { useLang } from '@/lib/i18n'

interface Props {
  initialWeightKg: number | null
  initialReps: number
  initialRir: number
  bodyweight: boolean
  /** Load step for the weight buttons — the lift's smallest loadable change. */
  weightStepKg: number
  disabled?: boolean
  onLog: (values: { weightKg: number | null; reps: number; rir: number }) => Promise<void>
}

/**
 * Steppers, not keyboards. Logging a set has to survive being done with one
 * sweaty thumb between sets — see the Phase 2 spec §5.
 *
 * This is the most-touched control in the app, so it is the one place the log's
 * restraint gives way to size: 48px targets, the running value set at heading
 * scale, and a filled ink button for the commit. Everything else on the page
 * can be quiet; this has to be hittable with cold hands and readable at arm's
 * length while you are still breathing hard.
 */
export default function SetLogger({
  initialWeightKg,
  initialReps,
  initialRir,
  bodyweight,
  weightStepKg,
  disabled = false,
  onLog,
}: Props) {
  const { t } = useLang()
  const [weightKg, setWeightKg] = useState<number>(initialWeightKg ?? 0)
  const [reps, setReps] = useState(initialReps)
  const [rir, setRir] = useState(initialRir)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLog() {
    setSaving(true)
    setError(null)
    try {
      await onLog({ weightKg: bodyweight ? null : weightKg, reps, rir })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('strength.setError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3">
      <div className={`grid gap-2 ${bodyweight ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {!bodyweight && (
          <Stepper
            label={t('strength.unit.kg')}
            value={weightKg}
            step={weightStepKg}
            min={0}
            max={500}
            onChange={setWeightKg}
            disabled={disabled || saving}
          />
        )}
        <Stepper
          label={t('strength.unit.reps')}
          value={reps}
          step={1}
          min={0}
          max={100}
          onChange={setReps}
          disabled={disabled || saving}
        />
        <Stepper
          label={t('strength.unit.rir')}
          value={rir}
          step={1}
          min={0}
          max={10}
          onChange={setRir}
          disabled={disabled || saving}
        />
      </div>

      <button
        type="button"
        onClick={handleLog}
        disabled={disabled || saving}
        className="mt-2 w-full min-h-[52px] bg-ink text-paper text-entry font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
      >
        {saving ? t('strength.saving') : t('strength.logSet')}
      </button>

      {error && <p className="mt-1.5 text-note text-stop">{error}</p>}
    </div>
  )
}

/**
 * Exported so the Today screen's contact and hold loggers are the same control
 * as this one. A plyo logged in ground contacts and a lift logged in kilos
 * should not feel like two different apps (§14).
 */
export function Stepper({
  label,
  value,
  step,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string
  value: number
  step: number
  min: number
  max: number
  onChange: (v: number) => void
  disabled: boolean
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 100) / 100))

  return (
    <div className="border border-rule">
      <p className="font-serif text-note italic text-pencil text-center pt-1">{label}</p>
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label={`decrease ${label}`}
          disabled={disabled || value <= min}
          onClick={() => onChange(clamp(value - step))}
          className="flex-1 h-12 flex items-center justify-center text-pencil hover:text-ink disabled:opacity-25 transition-colors"
        >
          <Minus size={18} aria-hidden />
        </button>
        <span className="measured text-head px-1 flex-shrink-0">{value}</span>
        <button
          type="button"
          aria-label={`increase ${label}`}
          disabled={disabled || value >= max}
          onClick={() => onChange(clamp(value + step))}
          className="flex-1 h-12 flex items-center justify-center text-pencil hover:text-ink disabled:opacity-25 transition-colors"
        >
          <Plus size={18} aria-hidden />
        </button>
      </div>
    </div>
  )
}
