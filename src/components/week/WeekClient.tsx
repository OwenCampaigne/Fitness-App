'use client'

// ── The week ahead (framework §10 step 5, §18 step 9) ─────────────────────────
// Seven days at a glance, so Thursday being packed is something you find out on
// Monday and move around, rather than at six on Thursday morning when the only
// remaining option is to skip it.
//
// Read as a spread: the week's totals sit at the head of the page, then seven
// ruled entries with the date hanging in the left margin the way a diary is
// written. Today is *marked* — a rule down the margin and the word in italic —
// not boxed, because boxing it would make it a different kind of thing from the
// six days around it when it is the same thing, one day closer.
//
// Everything on this page is planned rather than done, so it is set in pencil.
// A day whose session is already completed is the one thing here the app
// watched happen, so it — and only it — is inked. That is the whole system:
// what you did is ink, what is proposed is graphite.
//
// This is a *planning* screen, which is the one place §14's ban on charts does
// not apply — the ACWR band is a weekly property (§3) and a week of numbers with
// no shape to them is not legible. What it shows is still deliberately thin: a
// seven-column load profile sketched in the margin and the trajectory's two
// endpoints in a sentence. Charts proper live on /trends (§14).
//
// Nothing here is a second edit path. A day expands into the same
// `SessionItemCard`s the Today screen renders, tapping Edit opens the same
// `EditSheet`, and every change — by hand, or a move to another day — goes
// through the same `PatchReview` preview → confirm → diff → undo and the same
// validator on the server. A future day is not a softer day: moving the long run
// onto Saturday re-checks Sunday, and says so if it does not like the answer.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, Pencil, Undo2 } from 'lucide-react'
import { useLang } from '@/lib/i18n'
import { orderBlocks, buildStatusOp } from '@/lib/todayView'
import type { PatchOp } from '@/types/patch'
import type { SessionItem } from '@/types/session'
import SessionItemCard from '@/components/today/SessionItemCard'
import EditSheet from '@/components/today/EditSheet'
import PatchReview, { type PendingPatch } from '@/components/today/PatchReview'
import type { Catalog, PatchResponse, UndoResponse } from '@/components/today/types'
import type { MoveResponse, WeekDayResponse, WeekResponse } from './types'

/** A pending patch, plus the day it is against — and the move it came from. */
type WeekPending = PendingPatch & {
  date: string
  move?: { itemId: string; from: string; to: string }
}

/**
 * Priority, carried by weight rather than by colour.
 *
 * The old version tinted A green, which spent the page's one colour budget on
 * something that is not a verdict and not a safety flag. An A day is the day
 * the week is built around, so it is simply darker: ink, graphite, faint.
 */
const PRIORITY_INK: Record<string, string> = {
  A: 'text-ink',
  B: 'text-pencil',
  C: 'text-faint',
}

interface Props {
  catalog: Catalog
}

export default function WeekClient({ catalog }: Props) {
  const { t, locale } = useLang()
  const tag = locale === 'es' ? 'es-ES' : 'en-GB'

  const [data, setData] = useState<WeekResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [openDate, setOpenDate] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ item: SessionItem; date: string } | null>(null)
  const [pending, setPending] = useState<WeekPending | null>(null)
  const [result, setResult] = useState<PatchResponse | null>(null)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/session/week', { cache: 'no-store' })
      const json = (await res.json().catch(() => ({}))) as WeekResponse
      if (!res.ok) throw new Error(json.error ?? t('week.error'))
      setData(json)
      setLoadError(null)
      setOpenDate((prev) => prev ?? json.days.find((d) => d.isToday)?.date ?? null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('week.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  // ── The one funnel, aimed at a chosen day (§11) ────────────────────────────

  const propose = useCallback((next: WeekPending) => {
    setResult(null)
    setError(null)
    setNote(null)
    setPending(next)
  }, [])

  const confirm = useCallback(
    async (override: boolean) => {
      if (!pending) return
      setApplying(true)
      setError(null)
      try {
        const res = pending.move
          ? await fetch('/api/session/move', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...pending.move,
                actor: pending.actor,
                reason: pending.reason,
                ...(override ? { override: true } : {}),
              }),
            })
          : await fetch('/api/session/patch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                date: pending.date,
                patch: { ops: pending.ops },
                actor: pending.actor,
                reason: pending.reason,
                ...(override ? { override: true } : {}),
              }),
            })

        const json = (await res.json().catch(() => ({}))) as MoveResponse
        if (!res.ok) throw new Error(json.error ?? t('week.editError'))

        setResult(json)
        // A move that landed but could not be lifted off the source day would
        // leave the item on both — say so rather than letting it look clean.
        if (json.applied && json.movedFrom && !json.movedFrom.applied) {
          setNote(t('week.move.sourceStuck'))
        }
        if (json.applied) void load()
      } catch (err) {
        setError(err instanceof Error ? err.message : t('week.editError'))
      } finally {
        setApplying(false)
      }
    },
    [pending, load, t],
  )

  /**
   * Undo, from whichever day you are looking at.
   *
   * One POST, always — even for a move, which is one intent written as two rows
   * on two days. The server reverses the pair together, because reversing one
   * half is worse than not offering the button at all: undo the destination
   * alone and the session is on neither day; undo the source alone and it is on
   * both. Asking twice from here would undo the pair and then reach past it into
   * whatever that day was edited for before.
   *
   * The reload is what shows the other day moving, so the screen never has to
   * know how many days an edit touched.
   */
  const undo = useCallback(
    async (date: string) => {
      setApplying(true)
      setError(null)
      try {
        const res = await fetch('/api/session/undo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date }),
        })
        const json = (await res.json().catch(() => ({}))) as UndoResponse
        if (!res.ok) throw new Error(json.error ?? t('week.undoError'))

        setPending(null)
        setResult(null)
        setNote(
          json.applied
            ? t('week.undoDone', { version: json.version })
            : json.verdict?.message || t('week.undoNone'),
        )
        void load()
      } catch (err) {
        setError(err instanceof Error ? err.message : t('week.undoError'))
      } finally {
        setApplying(false)
      }
    },
    [load, t],
  )

  /** What "undo this" means for whatever is currently in the review panel. */
  const undoPending = useCallback(() => {
    if (!pending) return
    // A move's review panel is against the destination day; undoing from either
    // end of the move reverses both, so the day it is open on is the right one.
    void undo(pending.date)
  }, [pending, undo])

  const takeCounterProposal = useCallback(() => {
    const counter = result?.verdict.counterProposal ?? pending?.previewVerdict?.counterProposal
    if (!counter || counter.ops.length === 0 || !pending) return
    propose({
      ops: counter.ops,
      actor: counter.actor === 'coach' ? 'coach' : 'user',
      reason: counter.ops[0]?.reason ?? t('today.verdict.counterReason'),
      date: pending.date,
    })
  }, [result, pending, propose, t])

  // ── Render ─────────────────────────────────────────────────────────────────

  const dayLabel = useCallback(
    (iso: string) =>
      new Date(iso).toLocaleDateString(tag, { weekday: 'short', day: 'numeric', month: 'short' }),
    [tag],
  )

  const peakLoad = useMemo(
    () => Math.max(1, ...(data?.days ?? []).map((d) => d.summary.plannedLoad)),
    [data],
  )

  const pendingDay = data?.days.find((d) => d.date === pending?.date) ?? null

  if (loading) {
    return <p className="font-serif text-note italic text-pencil py-8 text-center">{t('week.loading')}</p>
  }

  if (loadError || !data) {
    return (
      <div className="border-l-2 border-stop pl-3 py-2">
        <p className="text-entry text-stop leading-relaxed">{loadError ?? t('week.error')}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true)
            void load()
          }}
          className="mt-2 min-h-[44px] px-3 border border-stop text-stop text-entry font-medium"
        >
          {t('week.retry')}
        </button>
      </div>
    )
  }

  const { totals } = data
  const acwrStart = totals.acwr[0] ?? 1

  return (
    <div>
      {/* ── The head of the spread ──────────────────────────────────────────
          What the week costs and where the band is heading (§3), written out
          rather than panelled. All of it is a plan, so all of it is pencil. */}
      <section className="border-b border-rule pb-4">
        <p className="block-label">{t('week.totalsLabel')}</p>

        <p className="text-prose estimated leading-snug">
          {t('week.totals', {
            load: totals.totalLoad,
            hours: (totals.totalDurationMin / 60).toFixed(1),
          })}
        </p>
        <p className="text-note estimated mt-1">
          {t('week.hardDays', { hard: totals.hardDays, rest: totals.restDays })}
        </p>
        <p className="text-note estimated mt-0.5">
          {t('week.acwr', {
            from: acwrStart.toFixed(2),
            to: totals.acwrEnd.toFixed(2),
            zone: t(`week.zone.${totals.zoneEnd}`),
          })}
        </p>

        <LoadProfile days={data.days} peakLoad={peakLoad} tag={tag} label={t('week.profileLabel')} />

        <p className="marginalia mt-3">{t('week.pencilNote')}</p>
      </section>

      {note && <p className="text-note text-pencil pt-3">{note}</p>}
      {error && !pending && <p className="text-note text-stop pt-3">{error}</p>}

      {/* ── Seven entries. Tap one open to get the actual cards. ───────────── */}
      <div className="pt-1">
        {data.days.map((day) => {
          const open = openDate === day.date
          const done = day.session.status === 'completed'
          const date = new Date(day.date)

          return (
            <section
              key={day.date}
              className={`entry ${day.isToday ? 'border-l-2 border-l-ink pl-2.5 -ml-2.5' : ''}`}
            >
              <button
                type="button"
                onClick={() => setOpenDate(open ? null : day.date)}
                aria-expanded={open}
                className="w-full flex items-start gap-3 text-left min-h-[44px]"
              >
                {/* The date, hanging in the margin. */}
                <div className="w-9 flex-shrink-0">
                  <p
                    className={`font-serif text-note italic leading-tight ${
                      day.isToday ? 'text-ink' : 'text-pencil'
                    }`}
                  >
                    {date.toLocaleDateString(tag, { weekday: 'short' })}
                  </p>
                  <p className={`figures text-entry leading-tight ${done ? 'measured' : 'estimated'}`}>
                    {date.getDate()}
                  </p>
                </div>

                <div className="min-w-0 flex-1">
                  <p className={`text-entry ${done ? 'measured' : 'estimated'} truncate`}>
                    {day.summary.itemCount === 0
                      ? t('week.rest')
                      : day.summary.headline.join(' · ') || t('week.session')}
                  </p>

                  <p className="text-note text-faint mt-0.5 truncate">
                    {[
                      ...day.summary.modalities.map((m) => t(`week.modality.${m}`)),
                    ].join(' · ')}
                  </p>

                  <p className="font-serif text-note italic mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {day.isToday && <span className="text-ink">{t('week.today')}</span>}
                    {done && <span className="text-pencil">{t('week.completed')}</span>}
                    <span className={PRIORITY_INK[day.priority]}>
                      {t(`week.priorityName.${day.priority}`)}
                    </span>
                    {day.edited && (
                      <span className="inline-flex items-center gap-1 text-pencil">
                        <Pencil size={10} aria-hidden />
                        {t('week.edited')}
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex-shrink-0 flex items-start gap-2 pt-0.5">
                  <div className="text-right">
                    <p className={`text-entry ${done ? 'measured' : 'estimated'}`}>
                      {day.summary.plannedLoad}
                    </p>
                    <p className="text-note text-faint figures">
                      {t('week.minutes', { min: day.summary.plannedDurationMin })}
                    </p>
                  </div>
                  <ChevronDown
                    size={15}
                    aria-hidden
                    className={`text-faint mt-1 transition-transform ${open ? 'rotate-180' : ''}`}
                  />
                </div>
              </button>

              {open && (
                <div className="pt-3 mt-3 border-t border-rule">
                  <p className="marginalia">{day.why}</p>

                  {day.verdictFlags.length > 0 && (
                    <ul className="mt-2.5 space-y-1.5">
                      {day.verdictFlags.map((flag) => (
                        <li
                          key={`${flag.source}-${flag.code}`}
                          className="flex gap-1.5 text-note text-caution leading-relaxed"
                        >
                          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" aria-hidden />
                          {flag.message}
                        </li>
                      ))}
                    </ul>
                  )}

                  {orderBlocks(day.blocks).map((block) => (
                    <div key={block.id} className="mt-3">
                      <h3 className="block-label">
                        {block.label?.trim() ? block.label : t(`today.blocks.${block.kind}`)}
                      </h3>
                      <div className="flex flex-col gap-2">
                        {block.items.map((item) => (
                          <div key={item.id} className="flex flex-col">
                            <SessionItemCard
                              item={item}
                              catalog={catalog}
                              loggedSets={[]}
                              disclaimer={data.disclaimer}
                              readOnly={day.session.status === 'completed'}
                              // A set you have not done is not a set. Editing it is
                              // still entirely allowed — that is the point of §11.
                              canLog={day.isToday}
                              onLog={async () => {}}
                              onEdit={(it) => setEditing({ item: it, date: day.date })}
                              onSkip={(it, skipped) => {
                                const reason = skipped
                                  ? t('week.skipReason')
                                  : t('today.item.unskipReason')
                                const op = buildStatusOp(it, skipped ? 'skipped' : 'prescribed', reason)
                                if (op) propose({ ops: [op], actor: 'user', reason, date: day.date })
                              }}
                            />
                            <MoveRow
                              days={data.days}
                              from={day.date}
                              label={t('week.move.label')}
                              confirmLabel={t('week.move.confirm')}
                              optionLabel={dayLabel}
                              onMove={(to) => {
                                const target = data.days.find((d) => d.date === to)
                                propose({
                                  // A preview, not the patch. The server builds the
                                  // real pair — an `add` on the destination and a
                                  // `remove` here — because only it can see whether
                                  // the id is already taken over there. This is what
                                  // lands, which is what the athlete is agreeing to.
                                  ops: [
                                    {
                                      op: 'add',
                                      blockKind: 'main',
                                      item,
                                      reason: t('week.move.reason', {
                                        name: item.ref.name,
                                        day: dayLabel(to),
                                      }),
                                    },
                                  ],
                                  actor: 'user',
                                  reason: t('week.move.reason', {
                                    name: item.ref.name,
                                    day: dayLabel(to),
                                  }),
                                  date: to,
                                  move: { itemId: item.id, from: day.date, to },
                                  message: t('week.move.note', {
                                    name: item.ref.name,
                                    day: dayLabel(to),
                                    load: target?.summary.plannedLoad ?? 0,
                                  }),
                                })
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {day.summary.itemCount === 0 && (
                    <p className="text-entry text-pencil leading-relaxed mt-2">{t('week.restNote')}</p>
                  )}

                  <div className="flex items-center gap-2 pt-3 mt-3 border-t border-rule">
                    <span className="text-note text-faint figures">
                      {t('today.version', { version: day.session.version })} ·{' '}
                      {t(`today.editedBy.${day.session.sourceOfLastEdit ?? 'engine'}`)}
                    </span>
                    {/* One day's button, but not necessarily one day's undo: an
                        edit that spanned two days is reversed from either end. */}
                    <button
                      type="button"
                      onClick={() => void undo(day.date)}
                      disabled={applying}
                      className="ml-auto inline-flex items-center gap-1.5 min-h-[44px] px-1 font-serif text-note italic text-pencil hover:text-ink disabled:opacity-40 transition-colors"
                    >
                      <Undo2 size={13} aria-hidden />
                      {t('today.undo.button')}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )
        })}
      </div>

      <p className="marginalia mt-4">{t('week.footnote')}</p>

      {editing && (
        <EditSheet
          item={editing.item}
          catalog={catalog}
          onClose={() => setEditing(null)}
          onPropose={(ops: PatchOp[], reason: string) => {
            const date = editing.date
            setEditing(null)
            propose({ ops, actor: 'user', reason, date })
          }}
        />
      )}

      {pending && pendingDay && (
        <PatchReview
          pending={pending}
          blocks={pendingDay.blocks}
          result={result}
          applying={applying}
          error={error}
          onConfirm={confirm}
          onTakeCounterProposal={takeCounterProposal}
          onUndo={undoPending}
          onClose={() => {
            setPending(null)
            setResult(null)
            setError(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * The week's shape, sketched in the margin.
 *
 * Seven columns, no axes, no grid, no tooltip — the point is only that you can
 * see Thursday is the tall one. Hard days are inked, working days are graphite,
 * a rest day is just the baseline rule left showing. Colour stays out of it:
 * this is not a verdict and it is not a safety flag.
 */
function LoadProfile({
  days,
  peakLoad,
  tag,
  label,
}: {
  days: WeekDayResponse[]
  peakLoad: number
  tag: string
  label: string
}) {
  return (
    <figure className="mt-3.5" aria-label={label}>
      <div className="flex items-end gap-1.5 h-9 border-b border-rule">
        {days.map((day) => (
          <div key={day.date} className="flex-1 flex flex-col justify-end h-full">
            <div
              className={
                day.summary.itemCount === 0
                  ? 'bg-transparent'
                  : day.summary.hard
                    ? 'bg-ink'
                    : 'bg-pencil/55'
              }
              style={{ height: `${Math.max(2, (day.summary.plannedLoad / peakLoad) * 100)}%` }}
              aria-hidden
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">
        {days.map((day) => (
          <span
            key={day.date}
            className={`flex-1 text-center font-serif text-note italic ${
              day.isToday ? 'text-ink' : 'text-faint'
            }`}
          >
            {new Date(day.date).toLocaleDateString(tag, { weekday: 'narrow' })}
          </span>
        ))}
      </div>
    </figure>
  )
}

/**
 * "Move it to…" — a native `<select>` and a button.
 *
 * Nothing is posted from here. It hands the intent up, the same way `EditSheet`
 * hands ops up, and the one funnel takes it from there: preview against the
 * destination day, confirm, validator, diff, undo (§11).
 */
function MoveRow({
  days,
  from,
  label,
  confirmLabel,
  optionLabel,
  onMove,
}: {
  days: WeekDayResponse[]
  from: string
  label: string
  confirmLabel: string
  optionLabel: (iso: string) => string
  onMove: (to: string) => void
}) {
  const options = days.filter((d) => d.date !== from && d.session.status !== 'completed')
  const [to, setTo] = useState(options[0]?.date ?? '')

  if (options.length === 0) return null

  return (
    <div className="flex items-center gap-2 pt-1 pb-0.5">
      <label className="font-serif text-note italic text-pencil flex-shrink-0">{label}</label>
      <select
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className="bg-paper border-b border-rule rounded-none text-entry text-pencil px-1 min-h-[44px] min-w-0 flex-1"
      >
        {options.map((d) => (
          <option key={d.date} value={d.date}>
            {optionLabel(d.date)} · {d.summary.plannedLoad}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => to && onMove(to)}
        className="min-h-[44px] px-2 font-serif text-note italic text-ink underline decoration-rule underline-offset-4 hover:decoration-ink transition-colors flex-shrink-0"
      >
        {confirmLabel}
      </button>
    </div>
  )
}
