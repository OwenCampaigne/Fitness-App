// ── The week ahead ────────────────────────────────────────────────────────────
// Framework §10 step 5 — "WEEK: updated skeleton" — and §18 step 9. The Today
// screen answers "what now". This answers "what does Thursday look like, and
// can the long run move to Saturday", days ahead, while moving it is still free
// rather than a conflict discovered at 6am.
//
// Deliberately **not** a second planner. Every day in the window is built by the
// same `gatherToday` the Today screen uses; the only thing this module adds is
// the *sequence*. Each day is persisted before the next one is planned, so the
// next day's `loadDayContext` already sees it — which means the ACWR ceiling
// (§3), the concurrent-training spacing (§8) and the never-two-hard-days rail
// (§10) all bite across the week without one new rule being written. The one
// thing the DB cannot carry is that a *planned* day was hard (there is no sRPE
// for a day that has not happened), so the loop hands that forward by name.
//
// The pure half is everything below the DB banner's line: what a day's blocks
// add up to, where the ACWR is heading, whether a stored day may be rebuilt,
// and what "move this to Saturday" is as ops. All of it takes literals.

import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns'
import { HARD_DAY_SRPE, computeAcwr, sessionCost } from './load'
import { ensureWeeklyPlan } from './runSession'
import {
  LOAD_WINDOW_DAYS,
  createSessionRow,
  findSessionRow,
  isUntouched,
  itemCost,
  loadDayContext,
  parseBlocks,
  plannedTotals,
  replaceEngineSession,
  toEditableSession,
} from './sessionStore'
import type { SessionRow } from './sessionStore'
import { ensureToday, gatherToday, todayValidationContext } from './todaySession'
import type { ChangedVsPlan, GatheredDay, VerdictFlag } from './todaySession'
import type { AcwrZone, LoadBudget } from './load'
import type { Modality, Priority } from './allocator'
import type { EditableSession } from '../types/patch'
import type { AddOp, RemoveOp } from '../types/patch'
import type { BlockKind, ItemKind, SessionBlock, SessionItem } from '../types/session'
import type { ReadinessBand } from '../types/readiness'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Seven days: today plus the six you can still rearrange your life around. */
export const WEEK_DAYS = 7

/**
 * The band a day past today is planned at.
 *
 * Not optimism — the division of labour in §7. The plan picks the intent; only
 * readiness picks the form, and there is no readiness for Thursday yet. Planning
 * Thursday off the back of a red Monday would hide the week you are actually
 * training for behind one bad night's sleep.
 */
export const FUTURE_BAND: ReadinessBand = 'green'

const MODALITY_OF: Record<ItemKind, Modality> = {
  exercise: 'strength',
  run: 'run',
  plyo: 'plyo',
  prehab: 'prehab',
  stretch: 'stretch',
}

/** Display order, so two days with the same mix read the same way. */
const MODALITY_ORDER: Modality[] = ['run', 'strength', 'plyo', 'prehab', 'stretch']

// ── Dates ─────────────────────────────────────────────────────────────────────

export function weekDates(start: Date, days = WEEK_DAYS): Date[] {
  const from = startOfDay(start)
  return Array.from({ length: days }, (_, i) => addDays(from, i))
}

/**
 * The only dates an edit may target: today and the six days the week view shows.
 *
 * A trust boundary, not a convenience. An arbitrary date off the wire would let
 * a client rewrite a completed session — history, not a plan — or spawn session
 * rows years out that nothing would ever regenerate or clean up.
 */
export function parseEditableDate(value: unknown, today = new Date()): Date | null {
  if (value === undefined || value === null || value === '') return startOfDay(today)
  if (typeof value !== 'string') return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  const date = startOfDay(parsed)
  const offset = differenceInCalendarDays(date, startOfDay(today))
  if (offset < 0 || offset >= WEEK_DAYS) return null
  return date
}

// ── Regeneration (§11) ────────────────────────────────────────────────────────

/**
 * May the planner rebuild this day?
 *
 * The invariant the whole feature rests on. An untouched engine-authored day is
 * the planner's own draft and it may replace it with a better one; a day the
 * athlete or the coach has edited is theirs, and rebuilding it would discard the
 * override §11 exists to preserve. A Saturday long run moved by hand survives
 * every planning pass after it, for exactly this reason.
 */
export function shouldRegenerate(
  row: Pick<SessionRow, 'version' | 'sourceOfLastEdit'> | null | undefined,
): boolean {
  if (!row) return true
  return isUntouched(row)
}

// ── What a day adds up to ─────────────────────────────────────────────────────

export interface WeekDaySummary {
  modalities: Modality[]
  itemCount: number
  plannedLoad: number
  plannedDurationMin: number
  /** Hard by the same §10 threshold the back-to-back rail uses. */
  hard: boolean
  /** The main block's movements, in order — the shape of the day at a glance. */
  headline: string[]
  runType: string | null
}

/**
 * One day's blocks, priced and described. Pure: the week view's row model.
 *
 * `costOf` defaults to the same `itemCost` the session store writes `plannedLoad`
 * with, so the number on the week row is the number the budget was spent
 * against rather than a second opinion about it.
 */
export function summarizeBlocks(
  blocks: SessionBlock[],
  costOf = itemCost,
): WeekDaySummary {
  const cost = sessionCost(blocks, costOf)
  const present = new Set<Modality>()
  let itemCount = 0
  let runType: string | null = null

  for (const block of blocks) {
    for (const item of block.items) {
      itemCount++
      present.add(MODALITY_OF[item.ref.kind] ?? 'strength')
      if (item.params.kind === 'run') runType = item.params.runType
    }
  }

  const main = blocks.find((b) => b.kind === 'main')
  const headline = (main?.items ?? blocks.flatMap((b) => b.items).slice(0, 2)).map(
    (i) => i.ref.name,
  )

  return {
    modalities: MODALITY_ORDER.filter((m) => present.has(m)),
    itemCount,
    plannedLoad: Math.round(cost.load),
    plannedDurationMin: Math.round(cost.durationMin),
    hard: cost.hardness >= HARD_DAY_SRPE,
    headline,
    runType,
  }
}

// ── Where the week is heading (§3) ────────────────────────────────────────────

/**
 * ACWR after each planned day, rolled forward.
 *
 * §3's band is a *weekly* property, which is why it only becomes legible here:
 * one day's number says nothing about whether the week is a ramp or a cliff. The
 * series is the 28 days behind the window with each planned day appended in
 * turn, so day 7's figure is what you will actually be standing on come Sunday
 * if you train the week as it reads.
 */
export function acwrTrajectory(history: number[], plannedLoads: number[]): number[] {
  const series = [...history]
  return plannedLoads.map((load) => {
    series.push(load)
    return computeAcwr(series.slice(-LOAD_WINDOW_DAYS)).acwr
  })
}

export interface WeekTotals {
  totalLoad: number
  totalDurationMin: number
  hardDays: number
  restDays: number
  acwr: number[]
  acwrEnd: number
  zoneEnd: AcwrZone
}

export function weekTotals(summaries: WeekDaySummary[], history: number[]): WeekTotals {
  const loads = summaries.map((s) => s.plannedLoad)
  const acwr = acwrTrajectory(history, loads)
  const acwrEnd = acwr.length > 0 ? acwr[acwr.length - 1] : 1

  return {
    totalLoad: Math.round(loads.reduce((a, b) => a + b, 0)),
    totalDurationMin: Math.round(summaries.reduce((a, s) => a + s.plannedDurationMin, 0)),
    hardDays: summaries.filter((s) => s.hard).length,
    restDays: summaries.filter((s) => s.itemCount === 0).length,
    acwr,
    acwrEnd,
    zoneEnd: computeAcwr([...history, ...loads].slice(-LOAD_WINDOW_DAYS)).zone,
  }
}

// ── Moving a session to another day (§11) ─────────────────────────────────────

/**
 * "Move the long run to Saturday", as the two patches it really is.
 *
 * There is no cross-day op and there should not be one: a move is an `add` on
 * the destination and a `remove` on the source, and each half goes through the
 * validator against *its own* day. That is the whole reason a move is safe —
 * landing the long run on Saturday re-checks Sunday's plan through the same
 * concurrent-training rail that would have checked it had the engine put it
 * there (§8). The add is applied first, so a destination that pushes back costs
 * nothing: the item is still sitting where it was.
 *
 * Item ids are unique *within* a session, not across them, so an id already
 * taken on the destination is suffixed rather than allowed to collide — two
 * items sharing an id would make every later patch ambiguous.
 */
export function moveItemOps(
  item: SessionItem,
  destination: SessionBlock[],
  blockKind: BlockKind,
  reason: string,
): { add: AddOp; remove: RemoveOp } {
  const taken = new Set(destination.flatMap((b) => b.items).map((i) => i.id))
  let id = item.id
  for (let n = 2; taken.has(id); n++) id = `${item.id}-${n}`

  return {
    add: {
      op: 'add',
      blockKind,
      item: { ...item, id, status: 'prescribed' },
      reason,
    },
    remove: { op: 'remove', itemId: item.id, reason },
  }
}

/** Which block a moved item belongs in — where it sat, when the day has one. */
export function destinationBlockKind(
  item: SessionItem,
  source: SessionBlock[],
): BlockKind {
  for (const block of source) {
    if (block.items.some((i) => i.id === item.id)) return block.kind
  }
  return 'main'
}

// ── The DB half ───────────────────────────────────────────────────────────────

export interface WeekDay {
  date: Date
  isToday: boolean
  /** True when the athlete or the coach wrote this day — never regenerated. */
  edited: boolean
  session: EditableSession
  blocks: SessionBlock[]
  summary: WeekDaySummary
  priority: Priority
  why: string
  budget: LoadBudget
  verdictFlags: VerdictFlag[]
  changedVsPlan: ChangedVsPlan
}

export interface WeekPlanResult {
  start: Date
  days: WeekDay[]
  totals: WeekTotals
  disclaimer: string
  band: ReadinessBand
  scenarioMode: Record<string, string> | null
}

/**
 * One future day's session row, created or regenerated.
 *
 * The same three-way `ensureToday` makes — keep, replace, create — with one
 * difference that matters: today is only rebuilt under a scenario, because the
 * athlete has been *looking* at it since breakfast and having it change under
 * them is worse than it being slightly stale. A day still four days out has no
 * such claim, so an untouched one is rebuilt on every pass and picks up
 * yesterday's actual load, a newly logged niggle, and whatever moved earlier in
 * the week.
 */
interface EnsuredDay {
  gathered: GatheredDay
  session: EditableSession
  blocks: SessionBlock[]
  edited: boolean
}

async function ensureFutureDay(date: Date, yesterdayHard: boolean): Promise<EnsuredDay> {
  const existing = await findSessionRow(date)
  const gathered = await gatherToday(date, { band: FUTURE_BAND, yesterdayHard })

  if (existing && !shouldRegenerate(existing)) {
    return {
      gathered,
      session: toEditableSession(existing as SessionRow),
      // The stored blocks win. This is the override being preserved (§11).
      blocks: parseBlocks(existing.blocksJson),
      edited: true,
    }
  }

  if (existing) {
    const refreshed = await replaceEngineSession(existing.id, gathered.blocks)
    return {
      gathered,
      session: toEditableSession(refreshed as SessionRow),
      blocks: gathered.blocks,
      edited: false,
    }
  }

  const totals = plannedTotals(gathered.blocks)
  const row = await createSessionRow({
    date,
    blocks: gathered.blocks,
    plannedLoad: gathered.allocation.plannedLoad || totals.plannedLoad,
    plannedDurationMin: gathered.allocation.plannedDurationMin || totals.plannedDurationMin,
  })

  return {
    gathered,
    session: toEditableSession(row as SessionRow),
    blocks: gathered.blocks,
    edited: false,
  }
}

/**
 * The seven-day rolling window, planned and persisted.
 *
 * Strictly in order, and that is load-bearing rather than incidental: day N is
 * written before day N+1 is gathered, so N+1's budget, its ACWR headroom and its
 * back-to-back check are all reading a week that already contains N. Plan them
 * in parallel and every day would think it was the only one.
 *
 * `ensureWeeklyPlan` runs first because `deriveIntent` reads `planned_session`
 * for the day *and the day after* — without the skeleton laid down across the
 * whole window, Saturday would not know Sunday wanted a long run, and the rail
 * that keeps heavy lifting off the day before it would never fire.
 *
 * ponytail: seven sequential `gatherToday` passes, ~7× the engine work of the
 * Today screen. Fine for one athlete on local SQLite; if this ever gets slow,
 * the engines' per-day candidate lists are what to cache, not the allocation.
 */
export async function ensureWeek(today = new Date()): Promise<WeekPlanResult> {
  const start = startOfDay(today)
  await ensureWeeklyPlan(start)

  // The 28 days *behind* the window — `loadDayContext` excludes its own day, so
  // this is history only, and the trajectory appends the plan to it.
  const history = (await loadDayContext(start)).dailyLoads

  const days: WeekDay[] = []
  let yesterdayHard = false
  let disclaimer = ''
  let band: ReadinessBand = FUTURE_BAND
  let scenarioMode: Record<string, string> | null = null

  for (const date of weekDates(start)) {
    const isToday = days.length === 0

    // Today goes through `ensureToday` unchanged — same row, same decision log,
    // same regeneration policy. The week view is a second reader of today's
    // session, never a second author of it.
    let entry: EnsuredDay
    if (isToday) {
      const result = await ensureToday(date)
      entry = {
        gathered: result,
        session: result.session,
        blocks: result.blocks,
        edited: !isUntouched({
          version: result.session.version,
          sourceOfLastEdit: result.session.sourceOfLastEdit ?? null,
        }),
      }
    } else {
      entry = await ensureFutureDay(date, yesterdayHard)
    }
    const { gathered, session, blocks, edited } = entry

    const summary = summarizeBlocks(blocks)

    days.push({
      date,
      isToday,
      edited,
      session,
      blocks,
      summary,
      priority: gathered.intent.priority,
      why: gathered.why,
      budget: gathered.budget,
      verdictFlags: gathered.verdictFlags,
      changedVsPlan: gathered.changedVsPlan,
    })

    // Derived from the blocks that are actually stored, not from what the
    // allocator proposed — on an edited day those are two different sessions.
    yesterdayHard = summary.hard

    if (isToday) {
      band = gathered.readiness.band
      scenarioMode = gathered.scenarioMode
    }
    if (!disclaimer) disclaimer = gathered.disclaimer
  }

  return {
    start,
    days,
    totals: weekTotals(days.map((d) => d.summary), history),
    disclaimer,
    band,
    scenarioMode,
  }
}

// ── The rails a future edit is judged against (§11) ───────────────────────────

/** A stored day's own planned hardness, by the §10 threshold. */
export async function dayIsHard(date: Date): Promise<boolean> {
  const row = await findSessionRow(date)
  return row ? summarizeBlocks(parseBlocks(row.blocksJson)).hard : false
}

/**
 * The `ValidationContext` for an edit to any day in the window.
 *
 * One funnel means one context builder: this is `todayValidationContext`, with
 * the same two overrides the planner used, so an edit to Thursday is judged
 * against the Thursday the planner built rather than against today. Without the
 * band override a red Monday would refuse every edit to a day four days out;
 * without the hardness lookup, moving the long run onto the day after a hard one
 * would sail through a rail that exists precisely to stop it.
 */
export async function editContextFor(date: Date, today = new Date()) {
  const day = startOfDay(date)
  if (differenceInCalendarDays(day, startOfDay(today)) === 0) {
    return todayValidationContext(day)
  }
  return todayValidationContext(day, {
    band: FUTURE_BAND,
    yesterdayHard: await dayIsHard(addDays(day, -1)),
  })
}
