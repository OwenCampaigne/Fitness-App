'use client'

// ── The run screen (framework §7) ─────────────────────────────────────────────
// Written as a page of the log rather than a dashboard panel. Two things earn
// their unusual treatment here:
//
// 1. **The target is the ink/pencil case the whole design was built for.**
//    `resolveTarget` refuses to issue a pace from an `estimate` anchor and
//    falls back to heart rate. The old screen just printed the heart-rate
//    number, which reads as "the coach wants heart rate today" when what
//    actually happened is "the coach declined to guess your pace". So the pace
//    line is always on the page: inked when it is a real target, and left in
//    graphite as *withheld*, with the reason, when it is not. An estimate is
//    never dressed as a fact.
//
// 2. **The ladder is a sequence, so it is numbered.** Numbered lists are
//    usually a tell; here the rungs genuinely are 1…13 in order, you are
//    standing on one of them, and the next one is the thing you are working
//    towards. The rungs above your cleared ceiling are drawn faint, because
//    the app climbing past a surgeon's clearance is the one thing it must
//    never look willing to do.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useLang } from '@/lib/i18n'
import { LADDER_RUNGS } from '@/lib/runEngine'
import type { ReadinessBand } from '@/types/readiness'
import type { LadderDecision, LadderState, RunAnalysis, RunPrescription } from '@/types/run'

interface TodayResponse {
  scenarioMode?: string
  scenarioLabel?: string
  prescription: RunPrescription
  ladder: LadderDecision
  ladderState: LadderState
  weeklyRunMin: number
  ceilingMin: number | null
  analysis: RunAnalysis | null
  readiness: { band: ReadinessBand; provisional: boolean }
  error?: string
}

/** The one place on this page colour is spent (§14 step 1). */
const BAND_INK: Record<ReadinessBand, string> = {
  green: 'text-ready',
  amber: 'text-caution',
  red: 'text-stop',
}

function formatPace(secPerKm: number | null | undefined): string {
  if (!secPerKm) return '—'
  const min = Math.floor(secPerKm / 60)
  const sec = Math.round(secPerKm % 60)
  return `${min}:${String(sec).padStart(2, '0')}/km`
}

export default function RunClient() {
  const { t } = useLang()
  const [data, setData] = useState<TodayResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logging, setLogging] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/run/today', { cache: 'no-store' })
      const json = (await res.json()) as TodayResponse
      if (!res.ok) throw new Error(json.error ?? t('run.error'))
      setData(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('run.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const markDone = useCallback(
    async (painAfter: 'none' | 'sometimes' | 'yes') => {
      setLogging(true)
      try {
        const res = await fetch('/api/run/today', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ painAfter }),
        })
        const json = (await res.json()) as { error?: string }
        if (!res.ok) throw new Error(json.error ?? t('run.logError'))
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : t('run.logError'))
      } finally {
        setLogging(false)
      }
    },
    [load, t],
  )

  if (loading) {
    return <p className="font-serif text-note italic text-pencil py-8 text-center">{t('run.loading')}</p>
  }

  if (error || !data) {
    return (
      <div className="border-l-2 border-stop pl-3 py-2">
        <p className="text-entry text-stop leading-relaxed">{error ?? t('run.error')}</p>
      </div>
    )
  }

  const { prescription: rx, ladder } = data
  const isRest = rx.type === 'rest'
  const interval = rx.intervals?.[0]
  const paceIssued = rx.targetKind === 'pace'
  const onLadder = !data.ladderState.graduated

  return (
    <div>
      {/* ── Where today started ────────────────────────────────────────────── */}
      <section className="entry">
        <p className="block-label">{t('run.readinessLabel')}</p>
        <p className="text-entry flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={`font-medium ${BAND_INK[data.readiness.band]}`}>
            {t(`run.band.${data.readiness.band}`)}
          </span>
          {data.readiness.provisional && (
            <span className="font-serif text-note italic text-pencil">
              {t('run.provisional')}
            </span>
          )}
          {data.scenarioMode && (
            <span className="ml-auto figures text-note text-faint">{data.scenarioMode}</span>
          )}
        </p>
        {data.scenarioLabel && <p className="marginalia mt-1.5">{data.scenarioLabel}</p>}
      </section>

      {/* ── The session ────────────────────────────────────────────────────── */}
      <section className="entry">
        <p className="block-label">{t('run.todayLabel')}</p>
        <h2 className="font-serif text-head text-ink">{rx.label}</h2>

        {!isRest && (
          <p className="mt-1.5 text-entry estimated">
            {t('run.minTotal', { min: rx.durationMin })}
            {rx.runMin > 0 && ` · ${t('run.minRunning', { min: rx.runMin })}`}
          </p>
        )}

        {interval && (
          <p className="mt-2 text-entry estimated">
            <span className="font-serif italic text-pencil">{t('run.setLabel')} </span>
            {interval.recoverSec > 0
              ? t('run.set', {
                  repeat: interval.repeat,
                  run: Math.round(interval.workSec / 60),
                  walk: Math.round(interval.recoverSec / 60),
                })
              : t('run.setNoWalk', {
                  repeat: interval.repeat,
                  run: Math.round(interval.workSec / 60),
                })}
          </p>
        )}
      </section>

      {/* ── The target ─────────────────────────────────────────────────────
          Pace first, always, whether or not there is one to give. An estimate
          that cannot be issued is shown as withheld rather than replaced by a
          heart rate with no explanation. */}
      {!isRest && (
        <section className="entry">
          <p className="block-label">{t('run.target.label')}</p>

          <div className="flex items-baseline justify-between gap-3">
            <span className="font-serif text-entry italic text-pencil">
              {t('run.target.paceLabel')}
            </span>
            {paceIssued ? (
              <span className="measured text-head">{formatPace(rx.targetPaceSecPerKm)}</span>
            ) : (
              // Named at the point of refusal rather than in a footnote: the
              // reason a pace is missing is different on the ladder (pace is an
              // output, not a target) from after it (the anchor is a guess).
              <span className="estimated text-entry italic">
                {onLadder ? t('run.target.withheldLadder') : t('run.target.withheldEstimate')}
              </span>
            )}
          </div>

          {!paceIssued && (
            <div className="flex items-baseline justify-between gap-3 mt-2.5 pt-2.5 border-t border-rule">
              <span className="font-serif text-entry italic text-pencil">
                {rx.targetKind === 'heart_rate'
                  ? t('run.target.hrLabel')
                  : t('run.target.effortLabel')}
              </span>
              <span className="measured text-head">
                {rx.targetKind === 'heart_rate'
                  ? t('run.target.hr', { bpm: rx.targetHrHigh ?? 0 })
                  : t('run.target.effort')}
              </span>
            </div>
          )}

          {/* The engine's own words about why this target and not another. */}
          <p className="marginalia mt-3">{rx.targetNote}</p>
        </section>
      )}

      {/* ── Why, and what readiness changed ────────────────────────────────── */}
      <section className="entry">
        <p className="block-label">{t('run.whyLabel')}</p>
        <p className="prose-log text-entry">{rx.why}</p>
        {rx.changed && (
          <>
            <p className="block-label mt-3">{t('run.changedLabel')}</p>
            <p className="prose-log text-entry">{rx.changed}</p>
          </>
        )}
      </section>

      {/* A safety flag — the second and last place colour is allowed. */}
      {ladder.blockedByCeiling && (
        <section className="entry">
          <p className="flex items-start gap-1.5 text-entry text-caution leading-relaxed">
            <AlertTriangle size={14} className="flex-shrink-0 mt-1" aria-hidden />
            <span>
              <span className="font-medium">{t('run.ceilingLabel')} </span>
              {ladder.reason}
            </span>
          </p>
        </section>
      )}

      {onLadder && (
        <LadderRungs
          currentIndex={ladder.rung.index}
          sessionsAtRung={data.ladderState.sessionsAtRung}
          ceilingMin={data.ceilingMin}
          t={t}
        />
      )}

      {/* ── Log it ─────────────────────────────────────────────────────────── */}
      {!isRest && !data.scenarioMode && (
        <section className="entry">
          <p className="block-label">{t('run.log.label')}</p>
          <div className="grid grid-cols-3 gap-2 mt-1">
            {(['none', 'sometimes', 'yes'] as const).map((level) => (
              <button
                key={level}
                type="button"
                disabled={logging}
                onClick={() => markDone(level)}
                className="min-h-[52px] px-2 border border-rule text-entry text-ink hover:border-ink disabled:opacity-40 transition-colors"
              >
                {t(`run.log.${level}`)}
              </button>
            ))}
          </div>
          <p className="marginalia mt-3">{t('run.log.note')}</p>
        </section>
      )}

      {data.analysis && <AnalysisPanel analysis={data.analysis} t={t} />}

      <p className="marginalia mt-4">{t('run.disclaimer')}</p>
    </div>
  )
}

/**
 * The ladder, as numbered rungs.
 *
 * A window around where you are standing rather than all thirteen: the two
 * behind you are context, the two ahead are the thing you are climbing towards,
 * and thirteen rows of walk/run intervals is a wall of text nobody reads.
 *
 * A rung whose run segment is longer than your cleared ceiling is drawn faint
 * and labelled. The ladder never raises that ceiling — only your surgeon or
 * physical therapist does — so it must not look like a rung you can simply
 * reach.
 */
function LadderRungs({
  currentIndex,
  sessionsAtRung,
  ceilingMin,
  t,
}: {
  currentIndex: number
  sessionsAtRung: number
  ceilingMin: number | null
  t: (key: string, vars?: Record<string, string | number>) => string
}) {
  const total = LADDER_RUNGS.length
  const windowSize = 4
  const start = Math.max(0, Math.min(currentIndex - 1, total - windowSize))
  const shown = LADDER_RUNGS.slice(start, start + windowSize)

  return (
    <section className="entry">
      <p className="block-label">{t('run.ladder.label')}</p>
      <p className="text-entry measured">
        {t('run.ladder.position', { rung: currentIndex + 1, total })}
      </p>
      <p className="text-note estimated mt-0.5">
        {t('run.ladder.sessions', { count: sessionsAtRung })}
        {ceilingMin !== null && ` · ${t('run.ladder.cleared', { min: ceilingMin })}`}
      </p>

      <ol className="mt-3">
        {start > 0 && <li className="text-note text-faint pl-[1.9rem] leading-none pb-1.5">…</li>}
        {shown.map((rung) => {
          const current = rung.index === currentIndex
          const aboveCeiling = ceilingMin !== null && rung.runSec / 60 > ceilingMin

          return (
            <li
              key={rung.index}
              className={`flex items-baseline gap-2.5 py-1.5 ${
                current ? 'border-l-2 border-ink pl-2 -ml-2' : ''
              }`}
              aria-current={current ? 'step' : undefined}
            >
              <span
                className={`figures text-note w-5 text-right flex-shrink-0 ${
                  current ? 'measured' : 'text-faint'
                }`}
              >
                {rung.index + 1}
              </span>
              <span
                className={`text-entry ${
                  current ? 'measured' : aboveCeiling ? 'text-faint line-through' : 'estimated'
                }`}
              >
                {rung.label}
              </span>
              {aboveCeiling && !current && (
                <span className="font-serif text-note italic text-faint ml-auto flex-shrink-0">
                  {t('run.ladder.aboveCeiling')}
                </span>
              )}
            </li>
          )
        })}
        {start + windowSize < total && (
          <li className="text-note text-faint pl-[1.9rem] leading-none pt-0.5">…</li>
        )}
      </ol>
    </section>
  )
}

function AnalysisPanel({
  analysis,
  t,
}: {
  analysis: RunAnalysis
  t: (key: string, vars?: Record<string, string | number>) => string
}) {
  return (
    <section className="entry">
      <p className="block-label">{t('run.analysis.label')}</p>
      <div className="space-y-3">
        <Finding title={t('run.analysis.easy')} body={analysis.easyDayAudit.verdict} />
        <Finding title={t('run.analysis.pace')} body={analysis.paceAtFixedHr.verdict} />
        <Finding
          title={t('run.analysis.lthr')}
          body={
            analysis.lthr.value
              ? `${t('run.analysis.lthrValue', {
                  bpm: analysis.lthr.value,
                  source: analysis.lthr.source,
                })} ${analysis.lthr.basis}`
              : analysis.lthr.basis
          }
          /* An LTHR the app worked out is graphite until a test confirms it. */
          measured={analysis.lthr.source === 'confirmed'}
        />
      </div>
    </section>
  )
}

function Finding({
  title,
  body,
  measured = false,
}: {
  title: string
  body: string
  measured?: boolean
}) {
  return (
    <div>
      <p className="font-serif text-note italic text-pencil">{title}</p>
      <p className={`text-entry leading-relaxed mt-0.5 ${measured ? 'measured' : 'estimated'}`}>
        {body}
      </p>
    </div>
  )
}
