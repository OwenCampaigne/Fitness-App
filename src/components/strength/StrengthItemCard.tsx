'use client'

// ── One lift, as a ruled entry (framework §8, §12) ────────────────────────────
// The ink/pencil split does real work here and it runs the way you would not
// expect from a fitness app: **what you lifted last time is inked, what is
// prescribed today is in pencil.** The prescription is the engine's proposal
// and it might be wrong about you; last Tuesday's 3×8 at 60 kg is something
// that happened. Setting the proposal darker than the fact would be exactly the
// lie this design exists to refuse — and it happens to put the weight on the
// single most useful line on the screen.

import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useLang } from '@/lib/i18n'
import SetLogger from './SetLogger'
import type { SessionItem, StrengthParams } from '@/types/session'
import type { LoggedSet } from '@/types/strength'

interface Props {
  item: SessionItem
  params: StrengthParams
  bodyweight: boolean
  weightStepKg: number
  runnerRationale?: string
  loggedSets: LoggedSet[]
  lastSessionSummary: string | null
  disabled?: boolean
  onLog: (values: {
    exerciseId: string
    setNumber: number
    weightKg: number | null
    reps: number
    rir: number
  }) => Promise<void>
}

export default function StrengthItemCard({
  item,
  params,
  bodyweight,
  weightStepKg,
  runnerRationale,
  loggedSets,
  lastSessionSummary,
  disabled = false,
  onLog,
}: Props) {
  const { t } = useLang()
  const [expanded, setExpanded] = useState(false)

  const done = loggedSets.length
  const complete = done >= params.sets
  const nextSetNumber = done + 1

  // With no history there is no honest load to show, so the card asks rather
  // than printing a placeholder that looks like a prescription.
  const needsLoad = !bodyweight && (params.weightKg === null || params.weightKg === undefined)
  const prescription = bodyweight
    ? `${params.sets} × ${params.reps} · RIR ${params.targetRir}`
    : needsLoad
      ? `${params.sets} × ${params.reps} · RIR ${params.targetRir} · ${t('strength.pickLoad')}`
      : `${params.sets} × ${params.reps} @ ${params.weightKg} kg · RIR ${params.targetRir}`

  return (
    <div className="entry">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-entry font-medium text-ink">{item.ref.name}</h3>
          {/* Today's proposal: graphite, because nobody has lifted it yet. */}
          <p className="text-entry estimated mt-0.5">{prescription}</p>
          {lastSessionSummary && (
            <p className="text-note mt-1">
              <span className="font-serif italic text-pencil">{t('strength.lastTime')} </span>
              <span className="measured">{lastSessionSummary}</span>
            </p>
          )}
        </div>

        <div className="flex items-start gap-1 flex-shrink-0">
          {complete && (
            <span className="inline-flex items-center gap-1 font-serif text-note italic text-ink pt-1">
              <Check size={13} aria-hidden /> {t('strength.done')}
            </span>
          )}
          <button
            type="button"
            aria-label={t('strength.whyAria')}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-pencil hover:text-ink transition-colors"
          >
            <ChevronDown
              size={16}
              aria-hidden
              className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-2.5 space-y-2">
          {item.why && (
            <div>
              <p className="block-label">{t('strength.whyToday')}</p>
              <p className="prose-log text-entry">{item.why}</p>
            </div>
          )}
          {runnerRationale && (
            <div>
              <p className="block-label">{t('strength.whyLift')}</p>
              <p className="prose-log text-entry">{runnerRationale}</p>
            </div>
          )}
        </div>
      )}

      {loggedSets.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {loggedSets.map((s) => (
            <li key={s.setNumber} className="flex items-baseline gap-2 text-note">
              <Check size={12} className="text-ink flex-shrink-0 self-center" aria-hidden />
              <span className="font-serif italic text-pencil">
                {t('strength.setN', { n: s.setNumber })}
              </span>
              <span className="measured text-entry">
                {s.weightKg !== null && s.weightKg !== undefined ? `${s.weightKg} × ` : ''}
                {s.reps}
              </span>
              <span className="estimated">RIR {s.rir}</span>
            </li>
          ))}
        </ul>
      )}

      {!complete && (
        <SetLogger
          initialWeightKg={params.weightKg}
          initialReps={params.reps}
          initialRir={params.targetRir}
          bodyweight={bodyweight}
          weightStepKg={weightStepKg}
          disabled={disabled}
          onLog={(values) =>
            onLog({ ...values, exerciseId: item.ref.id, setNumber: nextSetNumber })
          }
        />
      )}
    </div>
  )
}
