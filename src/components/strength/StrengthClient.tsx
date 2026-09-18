'use client'

// ── The lifting page (framework §8) ───────────────────────────────────────────
// A ruled list of lifts, not a stack of cards. The readiness verdict at the top
// is the only thing on the page allowed colour, with safety flags — a deload
// call and a clash with the run plan — as the second exception. Everything else
// is ink on paper, so the two things that can stop you are the two things that
// look different.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useLang } from '@/lib/i18n'
import StrengthItemCard from './StrengthItemCard'
import type { SessionBlock, StrengthParams } from '@/types/session'
import type { KeyLift, LoggedSet, ReadinessAdjustment } from '@/types/strength'
import type { ReadinessBand } from '@/types/readiness'

interface SessionResponse {
  sessionId: number | null
  version?: number
  scenarioMode?: string
  blocks: SessionBlock[]
  adjustment: ReadinessAdjustment
  blockedLifts: Array<{ name: string; reason: string }>
  usingConservativeDefault: boolean
  readiness: { band: ReadinessBand; provisional: boolean }
  deload: { shouldDeload: boolean; reason: string | null }
  concurrent: { conflict: boolean; reason: string }
  loggedSets: LoggedSet[]
  error?: string
}

/** The verdict is where this page spends its colour (§14 step 1). */
const BAND_INK: Record<ReadinessBand, string> = {
  green: 'text-ready',
  amber: 'text-caution',
  red: 'text-stop',
}

interface Props {
  liftsById: Record<string, KeyLift>
  lastSessionSummaries: Record<string, string | null>
}

export default function StrengthClient({ liftsById, lastSessionSummaries }: Props) {
  const { t } = useLang()
  const [data, setData] = useState<SessionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/strength/session', { cache: 'no-store' })
      const json = (await res.json()) as SessionResponse
      if (!res.ok) throw new Error(json.error ?? t('strength.error'))
      setData(json)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('strength.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const handleLog = useCallback(
    async (values: {
      exerciseId: string
      setNumber: number
      weightKg: number | null
      reps: number
      rir: number
    }) => {
      if (!data?.sessionId) throw new Error(t('strength.scenarioReadOnly'))

      const res = await fetch('/api/strength/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: data.sessionId, ...values }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? t('strength.setError'))

      await load()
    },
    [data?.sessionId, load, t],
  )

  if (loading) {
    return (
      <p className="font-serif text-note italic text-pencil py-8 text-center">
        {t('strength.loading')}
      </p>
    )
  }

  if (loadError || !data) {
    return (
      <div className="border-l-2 border-stop pl-3 py-2">
        <p className="text-entry text-stop leading-relaxed">{loadError ?? t('strength.error')}</p>
      </div>
    )
  }

  const setsByExercise = groupBy(data.loggedSets, (s) => s.exerciseId)
  const hasWork = data.blocks.some((b) => b.items.length > 0)

  return (
    <div>
      {/* What today's readiness did to the session */}
      <section className="entry">
        <p className="block-label">{t('strength.readinessLabel')}</p>
        <p className="text-entry flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={`font-medium ${BAND_INK[data.readiness.band]}`}>
            {t(`strength.band.${data.readiness.band}`)}
          </span>
          {data.readiness.provisional && (
            <span className="font-serif text-note italic text-pencil">
              {t('strength.provisional')}
            </span>
          )}
          {data.scenarioMode && (
            <span className="ml-auto figures text-note text-faint">{data.scenarioMode}</span>
          )}
        </p>
        <p className="prose-log text-entry mt-1.5">{data.adjustment.summary}</p>
      </section>

      {data.deload.shouldDeload && data.deload.reason && (
        <Flag title={t('strength.deload')}>{data.deload.reason}</Flag>
      )}

      {data.concurrent.conflict && (
        <Flag title={t('strength.clash')}>{data.concurrent.reason}</Flag>
      )}

      {data.blocks.map((block) => (
        <section key={block.id} className="pt-4">
          <h2 className="block-label">{block.label}</h2>
          {block.items.map((item) => {
            const lift = liftsById[item.ref.id]
            return (
              <StrengthItemCard
                key={item.id}
                item={item}
                params={item.params as StrengthParams}
                bodyweight={lift?.bodyweight ?? false}
                weightStepKg={lift?.microStepKg ?? 2.5}
                runnerRationale={lift?.runnerRationale}
                loggedSets={setsByExercise[item.ref.id] ?? []}
                lastSessionSummary={lastSessionSummaries[item.ref.id] ?? null}
                disabled={data.sessionId === null}
                onLog={handleLog}
              />
            )
          })}
        </section>
      ))}

      {!hasWork && (
        <p className="prose-log text-entry pt-4">
          {t('strength.nothingToday')} {data.adjustment.summary}
        </p>
      )}

      {data.blockedLifts.length > 0 && (
        <section className="entry mt-4">
          <p className="block-label">{t('strength.hiddenToday')}</p>
          <ul className="space-y-1">
            {data.blockedLifts.map((b) => (
              <li key={b.name} className="text-entry estimated leading-relaxed">
                {b.reason}
              </li>
            ))}
          </ul>
          {data.usingConservativeDefault && (
            <p className="marginalia mt-2">{t('strength.clearanceHint')}</p>
          )}
        </section>
      )}

      {/* Framework §15 — visible, not buried. */}
      <p className="marginalia mt-4">{t('strength.disclaimer')}</p>
    </div>
  )
}

/**
 * A safety flag — the second and last place this page spends colour.
 *
 * Not a tinted panel: a caution rule in the margin and the sentence next to it,
 * so it reads as something pressed into the page rather than a UI alert.
 */
function Flag({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-caution pl-3 py-2 mt-3">
      <p className="flex items-center gap-1.5 font-serif text-note italic text-caution">
        <AlertTriangle size={13} aria-hidden />
        {title}
      </p>
      <div className="text-entry text-caution leading-relaxed mt-1">{children}</div>
    </div>
  )
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const item of items) {
    ;(out[key(item)] ??= []).push(item)
  }
  return out
}
