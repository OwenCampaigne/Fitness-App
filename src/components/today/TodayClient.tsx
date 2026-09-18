'use client'

// ── The Today screen (framework §14) ──────────────────────────────────────────
// Not a dashboard. One screen, one answer, editable in place: the readiness
// band (rendered above this, on the server), the one-line why, the ordered card
// stack, the talk-to-coach bar, what changed vs the plan, the quick log, and
// undo.
//
// Charts and trends are deliberately absent. They live on `/trends`, for the
// weekly review — §14 is explicit that the daily screen is the one place they
// must never appear, because a number you can watch move is a number you will
// train to rather than train by.
//
// Everything that changes the session goes through one funnel (§11) and one
// review panel, and now through one *order* as well: preview, confirm, apply.
// A manual edit is previewed locally and posted on confirmation; the coach's
// sentence is previewed by `/api/coach`, which validates it and persists
// nothing, and the confirmation posts that same patch to `/api/session/patch`
// with `actor: 'coach'` — the identical route the tap uses, where it is judged
// again against the session as it is at that moment. The athlete's say is
// consent, not undo, whichever of them wrote the patch.
//
// Either way the verdict is shown whatever it says: a push-back that got
// swallowed would make the safety rails invisible, which is the same as not
// having them.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLang } from '@/lib/i18n'
import {
  needsDisclaimer,
  orderBlocks,
  plannedDurationMin,
  buildStatusOp,
} from '@/lib/todayView'
import type { LogValues } from '@/lib/todayView'
import type { PatchOp } from '@/types/patch'
import type { SessionItem } from '@/types/session'
import SessionItemCard from './SessionItemCard'
import CoachBar, { type CoachOutcome } from './CoachBar'
import ChangedVsPlan from './ChangedVsPlan'
import CompleteSession from './CompleteSession'
import EditSheet from './EditSheet'
import PatchReview, { type PendingPatch } from './PatchReview'
import type {
  Catalog,
  LogResponse,
  PatchResponse,
  TodayResponse,
  UndoResponse,
} from './types'

interface Props {
  catalog: Catalog
}

export default function TodayClient({ catalog }: Props) {
  const { t } = useLang()

  const [data, setData] = useState<TodayResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [editing, setEditing] = useState<SessionItem | null>(null)
  const [pending, setPending] = useState<PendingPatch | null>(null)
  const [patchResult, setPatchResult] = useState<PatchResponse | null>(null)
  const [applying, setApplying] = useState(false)
  const [patchError, setPatchError] = useState<string | null>(null)
  const [undoNote, setUndoNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/session/today', { cache: 'no-store' })
      const json = (await res.json().catch(() => ({}))) as TodayResponse
      if (!res.ok) throw new Error(json.error ?? t('today.error'))
      setData(json)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('today.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  // ── Logging ────────────────────────────────────────────────────────────────

  const handleLog = useCallback(
    async (item: SessionItem, setNumber: number, values: LogValues) => {
      const res = await fetch('/api/session/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          itemKind: item.ref.kind,
          setNumber,
          ...values,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as LogResponse
      if (!res.ok) throw new Error(json.error ?? t('today.item.logError'))

      // Written straight into the loaded session rather than a state of its own,
      // so the set you just logged and the same set after a reload are read from
      // one field by one code path (§14 step 6).
      setData((prev) =>
        prev && Array.isArray(json.sets)
          ? { ...prev, loggedSets: { ...prev.loggedSets, [item.id]: json.sets } }
          : prev,
      )
    },
    [t],
  )

  // ── The one edit funnel (§11) ──────────────────────────────────────────────

  const propose = useCallback((next: PendingPatch) => {
    setPatchResult(null)
    setPatchError(null)
    setUndoNote(null)
    setPending(next)
  }, [])

  const proposeUserOps = useCallback(
    (ops: PatchOp[], reason: string) => {
      setEditing(null)
      propose({ ops, actor: 'user', reason })
    },
    [propose],
  )

  const confirm = useCallback(
    async (override: boolean) => {
      if (!pending) return
      setApplying(true)
      setPatchError(null)
      try {
        const res = await fetch('/api/session/patch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patch: { ops: pending.ops },
            actor: pending.actor,
            reason: pending.reason,
            ...(pending.source ? { source: pending.source } : {}),
            ...(override ? { override: true } : {}),
          }),
        })
        const json = (await res.json().catch(() => ({}))) as PatchResponse
        if (!res.ok) throw new Error(json.error ?? t('today.diff.error'))

        setPatchResult(json)
        if (json.applied) {
          // Show the new session behind the receipt immediately, then reconcile
          // with the server so the budget and the flags move with it.
          setData((prev) =>
            prev
              ? { ...prev, blocks: json.blocks, session: { ...prev.session, version: json.version } }
              : prev,
          )
          void load()
        }
      } catch (err) {
        setPatchError(err instanceof Error ? err.message : t('today.diff.error'))
      } finally {
        setApplying(false)
      }
    },
    [pending, load, t],
  )

  /**
   * The coach's answer — a proposal, not a receipt.
   *
   * `/api/coach` previews: it has validated the patch and persisted nothing, so
   * what lands here is exactly what a manual edit produces, plus a verdict the
   * server could reach and the screen could not. It goes into `pending` and
   * waits for the athlete, and `confirm` posts it to the same patch route the
   * tap uses. Nothing here sets `patchResult` — that is the receipt, and there
   * is not one yet (§11).
   */
  const handleCoachOutcome = useCallback(
    (outcome: CoachOutcome) => {
      const r = outcome.response
      if (!r.verdict) return

      // The coach may have fired a deload before answering, so the blocks it
      // returned are the current session and the local diff is rendered against
      // them rather than against whatever was on screen a moment ago.
      if (r.blocks) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                blocks: r.blocks as NonNullable<typeof r.blocks>,
                session: { ...prev.session, version: r.version ?? prev.session.version },
              }
            : prev,
        )
      }

      propose({
        ops: r.patch?.ops ?? [],
        actor: 'coach',
        reason: outcome.sentence,
        source: outcome.sentence,
        message: r.reply ?? null,
        byCoach: true,
        previewVerdict: r.verdict,
      })

      // The budget and the flags move with a deload too.
      void load()
    },
    [load, propose],
  )

  /**
   * Take the validator's safer version — as a fresh proposal, confirmed like
   * any other. It can come from either verdict: the one the preview forewarned
   * about, or the one the apply came back with.
   */
  const takeCounterProposal = useCallback(() => {
    const counter =
      patchResult?.verdict.counterProposal ?? pending?.previewVerdict?.counterProposal
    if (!counter || counter.ops.length === 0) return
    propose({
      ops: counter.ops,
      actor: counter.actor === 'coach' ? 'coach' : 'user',
      reason: counter.ops[0]?.reason ?? t('today.verdict.counterReason'),
      source: pending?.source,
    })
  }, [patchResult, pending, propose, t])

  const undo = useCallback(async () => {
    setApplying(true)
    setPatchError(null)
    try {
      const res = await fetch('/api/session/undo', { method: 'POST' })
      const json = (await res.json().catch(() => ({}))) as UndoResponse
      if (!res.ok) throw new Error(json.error ?? t('today.undo.error'))

      setPending(null)
      setPatchResult(null)
      setUndoNote(
        json.applied
          ? t('today.undo.done', { version: json.version })
          : json.verdict?.message || t('today.undo.none'),
      )
      if (json.applied) {
        setData((prev) =>
          prev
            ? { ...prev, blocks: json.blocks, session: { ...prev.session, version: json.version } }
            : prev,
        )
      }
      void load()
    } catch (err) {
      setPatchError(err instanceof Error ? err.message : t('today.undo.error'))
    } finally {
      setApplying(false)
    }
  }, [load, t])

  const skip = useCallback(
    (item: SessionItem, skipped: boolean) => {
      const reason = skipped ? t('today.item.skipReason') : t('today.item.unskipReason')
      const op = buildStatusOp(item, skipped ? 'skipped' : 'prescribed', reason)
      if (op) proposeUserOps([op], reason)
    },
    [proposeUserOps, t],
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  const blocks = useMemo(() => orderBlocks(data?.blocks ?? []), [data?.blocks])
  const hasWork = blocks.length > 0
  const readOnly = data?.session.status === 'completed'
  const scenarios = data?.scenarioMode ? Object.entries(data.scenarioMode) : []

  if (loading) {
    return <p className="font-serif italic text-note text-pencil py-8">{t('today.loading')}</p>
  }

  if (loadError || !data) {
    return (
      <div className="border-l-2 border-stop pl-3 py-1">
        <p className="text-entry text-stop leading-relaxed">{loadError ?? t('today.error')}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true)
            void load()
          }}
          className="mt-2 text-note text-stop underline underline-offset-4"
        >
          {t('today.retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* §14 step 2 — the one-line why for today's shape, in the coach's voice */}
      <section>
        <p className="block-label">{t('today.whyLabel')}</p>
        <p className="prose-log">{data.why}</p>
        {/* The ceiling is the allocator's arithmetic; the ratio is measured off
            loads that were actually logged. They do not get the same weight. */}
        <p className="mt-1.5 flex flex-wrap gap-x-6 gap-y-0.5 text-note">
          <span className="estimated">
            {t('today.ceiling')} {Math.round(data.budget.ceiling)}
          </span>
          <span className="measured">
            {t('today.acwr')} {data.budget.acwr.toFixed(2)}
          </span>
        </p>
        {scenarios.length > 0 && (
          <p className="mt-1 text-note text-faint">
            {scenarios.map(([key, value]) => `${key}: ${value}`).join(' · ')}
          </p>
        )}
      </section>

      {/* A safety flag, and one of the two places colour is allowed. Shown in
          the margin rather than swallowed (§10 step 6). */}
      {data.verdictFlags.length > 0 && (
        <section className="border-l-2 border-caution pl-3">
          <p className="font-serif text-note italic text-caution mb-1">{t('today.flagsLabel')}</p>
          <ul className="space-y-1">
            {data.verdictFlags.map((flag) => (
              <li
                key={`${flag.source}-${flag.code}`}
                className="text-entry text-caution leading-relaxed"
              >
                {flag.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* §14 step 3 — the day as ordered diary sections, entries ruled apart */}
      {blocks.map((block) => (
        <section key={block.id} className="border-t border-rule pt-2">
          <h2 className="block-label">
            {block.label?.trim() ? block.label : t(`today.blocks.${block.kind}`)}
          </h2>
          {block.items.map((item) => (
            <SessionItemCard
              key={item.id}
              item={item}
              catalog={catalog}
              loggedSets={data.loggedSets?.[item.id] ?? []}
              disclaimer={data.disclaimer}
              readOnly={readOnly ?? false}
              onLog={handleLog}
              onEdit={setEditing}
              onSkip={skip}
            />
          ))}
        </section>
      ))}

      {!hasWork && (
        <section className="border-t border-rule pt-3">
          <p className="prose-log">{t('today.empty')}</p>
        </section>
      )}

      {/* §14 step 4 — the talk-to-coach bar */}
      <CoachBar disabled={readOnly ?? false} onOutcome={handleCoachOutcome} />

      {/* §11 — every edit is reversible, and you have to be able to see that */}
      <div className="flex items-baseline gap-3 border-t border-rule pt-2">
        <span className="text-note text-faint figures">
          {t('today.version', { version: data.session.version })} ·{' '}
          {t(`today.editedBy.${data.session.sourceOfLastEdit ?? 'engine'}`)}
        </span>
        <button
          type="button"
          onClick={() => void undo()}
          disabled={applying || (readOnly ?? false)}
          className="ml-auto text-note text-pencil hover:text-ink underline underline-offset-4 decoration-rule hover:decoration-ink disabled:opacity-40 disabled:no-underline transition-colors"
        >
          {applying ? t('today.undo.working') : t('today.undo.button')}
        </button>
      </div>
      {undoNote && <p className="marginalia">{undoNote}</p>}
      {patchError && !pending && (
        <p className="border-l-2 border-stop pl-3 text-entry text-stop">{patchError}</p>
      )}

      {/* §14 step 5 */}
      <ChangedVsPlan changed={data.changedVsPlan} />

      {/* §14 step 6 */}
      {hasWork && (
        <CompleteSession
          plannedMin={plannedDurationMin(data.blocks)}
          alreadyComplete={data.session.status === 'completed'}
          disabled={false}
          onCompleted={() => void load()}
        />
      )}

      {/* §15 — the line travels with the content it belongs to */}
      {needsDisclaimer(data.blocks) && <p className="marginalia">{data.disclaimer}</p>}

      {editing && (
        <EditSheet
          item={editing}
          catalog={catalog}
          onClose={() => setEditing(null)}
          onPropose={proposeUserOps}
        />
      )}

      {pending && (
        <PatchReview
          pending={pending}
          blocks={data.blocks}
          result={patchResult}
          applying={applying}
          error={patchError}
          onConfirm={confirm}
          onTakeCounterProposal={takeCounterProposal}
          onUndo={() => void undo()}
          onClose={() => {
            setPending(null)
            setPatchResult(null)
            setPatchError(null)
          }}
        />
      )}
    </div>
  )
}
