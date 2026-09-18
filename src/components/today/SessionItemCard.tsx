'use client'

// ── One entry, five kinds ─────────────────────────────────────────────────────
// Framework §12 and §14 step 3. Not a card — a ruled row in a training log. The
// rule between two entries is what separates them, so there is no panel, no
// tint and no radius.
//
// The ink/pencil split does the work a card border used to: **what you were
// asked to do is pencil, what you actually did is ink.** A prescription is the
// allocator's arithmetic and can be wrong; a logged set is something that
// happened. They must never look the same weight.
//
// One component rather than five because the differences are all data: what the
// prescription line says comes from `prescriptionLine`, which stepper the
// logger shows comes from `logFields`, and whether the §15 line has to sit
// under the entry comes from `itemNeedsDisclaimer`. An entry that knew it was a
// plyo would be an entry that could forget it was a prehab.

import { useState } from 'react'
import { ChevronDown, ExternalLink } from 'lucide-react'
import { useLang } from '@/lib/i18n'
import SetLogger from '@/components/strength/SetLogger'
import QuickLogger from './QuickLogger'
import {
  describeLoggedSet,
  isLoggable,
  itemNeedsDisclaimer,
  itemProgress,
  prescriptionDetails,
  prescriptionLine,
} from '@/lib/todayView'
import type { LogValues } from '@/lib/todayView'
import type { SessionItem, StrengthParams } from '@/types/session'
import { catalogKey, type Catalog, type LoggedSetRow } from './types'

interface Props {
  item: SessionItem
  catalog: Catalog
  loggedSets: LoggedSetRow[]
  /** §15 — the API's own wording, never this component's. */
  disclaimer: string
  readOnly: boolean
  /**
   * Whether the quick log is offered at all. The week view sets it false: a set
   * you have not done yet is not a set, and `readOnly` is the wrong knob for it
   * because a future day is still fully editable (§11). Defaults to true, so the
   * Today screen is unchanged.
   */
  canLog?: boolean
  onLog: (item: SessionItem, setNumber: number, values: LogValues) => Promise<void>
  onEdit: (item: SessionItem) => void
  onSkip: (item: SessionItem, skipped: boolean) => void
}

export default function SessionItemCard({
  item,
  catalog,
  loggedSets,
  disclaimer,
  readOnly,
  canLog = true,
  onLog,
  onEdit,
  onSkip,
}: Props) {
  const { t } = useLang()
  const [expanded, setExpanded] = useState(false)

  const kind = item.ref.kind
  const entry = catalog[catalogKey(kind, item.ref.id)] ?? {}
  const progress = itemProgress(item.params, loggedSets)
  const details = prescriptionDetails(item.params)
  const skipped = item.status === 'skipped'
  const loggable = canLog && isLoggable(kind) && !readOnly && !skipped

  const facts: Array<{ label: string; value: string }> = []
  if (entry.targetTissue) facts.push({ label: t('today.item.targetTissue'), value: entry.targetTissue })
  if (entry.target) facts.push({ label: t('today.item.target'), value: entry.target })
  if (entry.muscleText) facts.push({ label: t('today.item.muscles'), value: entry.muscleText })

  // "Done" and "skipped" are states of the day, not warnings. They stay in ink
  // and pencil; the colour budget belongs to the verdict and the safety flags.
  const state = progress.complete
    ? { text: t('today.item.done'), tone: 'text-ink' }
    : skipped
      ? { text: t('today.item.skipped'), tone: 'text-faint' }
      : item.status === 'edited'
        ? { text: t('today.item.edited'), tone: 'text-pencil' }
        : null

  return (
    <div className={`entry ${skipped ? 'opacity-60' : ''}`}>
      {/* The line itself — what it is, then what is being asked for. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={`text-entry text-ink font-medium ${skipped ? 'line-through' : ''}`}>
            {item.ref.name}
          </h3>
          {/* Pencil: this is the plan, not the record. */}
          <p className="estimated text-entry mt-0.5">{prescriptionLine(item.params)}</p>
          {details.map((line) => (
            <p key={line} className="estimated text-note">
              {line}
            </p>
          ))}
        </div>

        <div className="flex items-baseline gap-3 shrink-0">
          {state && (
            <span className={`font-serif italic text-note ${state.tone}`}>{state.text}</span>
          )}
          <button
            type="button"
            aria-label={t('today.item.why')}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="p-1 -mr-1 text-pencil hover:text-ink transition-colors"
          >
            <ChevronDown
              size={15}
              className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* The per-item "why" and the library facts behind it (§12). The coach
          speaks in the margin, not from inside a callout box. */}
      {expanded && (
        <div className="mt-2.5 space-y-2">
          {item.why && <p className="marginalia">{item.why}</p>}

          {facts.length > 0 && (
            <dl className="space-y-1">
              {facts.map((fact) => (
                <div key={fact.label} className="flex gap-2 text-note">
                  <dt className="font-serif italic text-pencil shrink-0">{fact.label}</dt>
                  <dd className="text-pencil">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {entry.note && <p className="font-serif text-note text-pencil leading-relaxed">{entry.note}</p>}

          {entry.videoUrl && (
            <a
              href={entry.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-note text-ink underline underline-offset-4 decoration-rule hover:decoration-ink"
            >
              <ExternalLink size={11} />
              {t('today.item.video')}
            </a>
          )}

          {/* §15 — a prehab entry never renders without the line under it. */}
          {itemNeedsDisclaimer(kind) && <p className="marginalia">{disclaimer}</p>}
        </div>
      )}

      {/* What has actually been logged against it. Ink: this happened. */}
      {loggedSets.length > 0 && (
        <div className="mt-2.5">
          <p className="block-label">{t('today.item.logged')}</p>
          <ul>
            {loggedSets.map((set) => (
              <li key={set.setNumber} className="flex gap-3 text-note">
                <span className="estimated w-12 shrink-0">
                  {t('today.item.setN', { n: set.setNumber })}
                </span>
                <span className="measured">{describeLoggedSet(item.params, set)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Quick log (§14 step 6) */}
      {loggable && !progress.complete && item.params.kind === 'strength' && (
        <SetLogger
          initialWeightKg={(item.params as StrengthParams).weightKg}
          initialReps={(item.params as StrengthParams).reps}
          initialRir={(item.params as StrengthParams).targetRir}
          bodyweight={(item.params as StrengthParams).weightKg === null}
          weightStepKg={entry.stepKg ?? 2.5}
          onLog={(values) =>
            onLog(item, progress.nextSetNumber, {
              ...(values.weightKg !== null ? { weightKg: values.weightKg } : {}),
              reps: values.reps,
              rir: values.rir,
            })
          }
        />
      )}

      {loggable && !progress.complete && item.params.kind !== 'strength' && (
        <QuickLogger
          params={item.params}
          setNumber={progress.nextSetNumber}
          labels={{
            weightKg: t('today.item.fields.weightKg'),
            reps: t('today.item.fields.reps'),
            rir: t('today.item.fields.rir'),
            contacts: t('today.item.fields.contacts'),
            holdSec: t('today.item.fields.holdSec'),
          }}
          logLabel={t('today.item.logSet')}
          savingLabel={t('today.item.saving')}
          onLog={(values) => onLog(item, progress.nextSetNumber, values)}
        />
      )}

      {kind === 'run' && !skipped && (
        <p className="marginalia mt-2.5">{t('today.item.runNotLogged')}</p>
      )}

      {/* Edit / swap, the manual half of the one funnel (§11-B) */}
      {!readOnly && (
        <div className="mt-2.5 flex items-center gap-4 text-note">
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="text-pencil hover:text-ink underline underline-offset-4 decoration-rule hover:decoration-ink transition-colors"
          >
            {t('today.item.edit')}
          </button>
          <button
            type="button"
            onClick={() => onSkip(item, !skipped)}
            className="ml-auto text-pencil hover:text-ink underline underline-offset-4 decoration-rule hover:decoration-ink transition-colors"
          >
            {skipped ? t('today.item.unskip') : t('today.item.skip')}
          </button>
        </div>
      )}
    </div>
  )
}
