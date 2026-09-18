// ── Load-triggered deload ─────────────────────────────────────────────────────
// Framework §17: "Load-triggered deload only — no calendar cadence. Fires when
// ACWR passes ~1.3–1.5, HRV trends down across days, or monotony/accumulated
// fatigue crosses a line — and says why."
//
// `strengthEngine.shouldDeload` already implements the lifting half of that
// (volume landmarks, ACWR, RIR drift) and is tested and green; this does not
// re-implement it, it *wraps* it and adds the two signals it cannot see: the
// readiness trend, and an ACWR that is not merely high but dangerous. The
// result is project-wide — it trims the run and the plyos too, because the
// budget is shared (§2) and deloading only the lifting half of a shared budget
// is not a deload.
//
// The second half of the module is the part that matters most for §11: a
// deload does not write blocks. It builds a **patch**, hands it to
// `applySessionPatch` through `applyPatchToSession`, and takes the same verdict
// as a human tap. So an automatic change is visible in the diff, recorded in
// `edit_history` with an inverse, and undoable — which is §10's "bounded
// autonomy: every auto-change visible and reversible", made structural.

import { startOfDay, subDays } from 'date-fns'
import { prisma } from './db'
import { HARD_DAY_SRPE, computeAcwr, scaleItem } from './load'
import { shouldDeload, weeklySetsByMuscle } from './strengthEngine'
import { KEY_LIFTS_BY_ID } from './keyLifts'
import { loadExerciseHistories } from './strengthSession'
import {
  applyPatchToSession,
  itemCost,
  loadDayContext,
  loadEditHistory,
  readEditableSession,
} from './sessionStore'
import type { ValidationContext } from './session'
import type { EditableSession, PatchOp, SessionPatch } from '../types/patch'
import type { SessionBlock } from '../types/session'
import type { ReadinessBand } from '../types/readiness'
import type { MuscleGroup } from '../types/strength'

// ── Thresholds ────────────────────────────────────────────────────────────────

/** §6's red rule: HRV down across this many days is a trend, not a bad night. */
export const HRV_DOWN_DAYS = 3
/** Consecutive non-green days that say the trend, not the day, is the problem. */
export const AMBER_RUN_DAYS = 3
/** Above this ACWR is not "caution" any more (§3, §17). */
export const ACWR_DANGER_LEVEL = 1.5
/** One trigger trims; two or more is a real deload week. */
export const DELOAD_TRIM_FACTOR = 0.75
export const DELOAD_DEEP_FACTOR = 0.55
/** How an applied deload identifies itself in `edit_history`, so it fires once. */
export const DELOAD_REASON_PREFIX = 'Deload:'

export type DeloadTriggerCode =
  | 'strength_landmarks'
  | 'acwr_sustained'
  | 'rir_drift'
  | 'acwr_danger'
  | 'hrv_downtrend'
  | 'readiness_trend'

export interface DeloadTrigger {
  code: DeloadTriggerCode
  message: string
}

export type DeloadSeverity = 'none' | 'trim' | 'deload'

export interface DeloadVerdictDetail {
  triggered: boolean
  severity: DeloadSeverity
  triggers: DeloadTrigger[]
  /** The messages, for anywhere that just wants the sentences. */
  reasons: string[]
  /** What a hard item gets multiplied by. 1 when nothing fired. */
  factor: number
}

export interface DeloadSignals {
  /** Recent daily ACWR, oldest first. */
  recentAcwr: number[]
  /** Mean RIR minus target per recent session, oldest first. */
  recentRirDeficit: number[]
  weeklySetsThisWeek: Partial<Record<MuscleGroup, number>>
  weeklySetsLastWeek: Partial<Record<MuscleGroup, number>>
  trainingAge?: 'beginner' | 'intermediate' | 'advanced'
  /** Nightly HRV, oldest last — the newest value is today's. */
  recentHrv: number[]
  /** Readiness bands, oldest last. */
  recentBands: ReadinessBand[]
}

/** How many days in a row HRV has fallen. The §6 signal, made countable. */
export function hrvDownDays(recentHrv: number[]): number {
  const usable = recentHrv.filter((v) => Number.isFinite(v) && v > 0)
  let run = 0
  for (let i = usable.length - 1; i > 0; i--) {
    if (usable[i] < usable[i - 1]) run++
    else break
  }
  return run
}

/**
 * Does the load warrant a deload, and how deep.
 *
 * Pure: every input is a number handed in, so a whole scenario is a literal.
 * The strength half delegates to `shouldDeload` rather than restating its rules,
 * which keeps one definition of "above MRV two weeks running" in the codebase.
 */
export function evaluateDeload(signals: DeloadSignals): DeloadVerdictDetail {
  const triggers: DeloadTrigger[] = []

  const strength = shouldDeload({
    weeklySetsThisWeek: signals.weeklySetsThisWeek,
    weeklySetsLastWeek: signals.weeklySetsLastWeek,
    trainingAge: signals.trainingAge,
    recentAcwr: signals.recentAcwr,
    recentRirDeficit: signals.recentRirDeficit,
  })

  if (strength.shouldDeload && strength.reason) {
    // `shouldDeload` returns the first rule that fired; classify it so the
    // trigger list stays machine-readable rather than three shapes of prose.
    const code: DeloadTriggerCode = /Acute:chronic/i.test(strength.reason)
      ? 'acwr_sustained'
      : /RIR/i.test(strength.reason)
        ? 'rir_drift'
        : 'strength_landmarks'
    triggers.push({ code, message: strength.reason })
  }

  const latestAcwr = signals.recentAcwr.at(-1)
  if (latestAcwr !== undefined && latestAcwr > ACWR_DANGER_LEVEL) {
    triggers.push({
      code: 'acwr_danger',
      message: `Acute:chronic load is ${latestAcwr.toFixed(2)} — past ${ACWR_DANGER_LEVEL.toFixed(2)}, which is where injury risk stops being theoretical.`,
    })
  }

  const downDays = hrvDownDays(signals.recentHrv)
  if (downDays >= HRV_DOWN_DAYS) {
    triggers.push({
      code: 'hrv_downtrend',
      message: `HRV has fallen ${downDays} days running. That is the trend §6 treats as a red rule, not one bad night.`,
    })
  }

  const tail = signals.recentBands.slice(-AMBER_RUN_DAYS)
  if (tail.length === AMBER_RUN_DAYS && tail.every((b) => b !== 'green')) {
    triggers.push({
      code: 'readiness_trend',
      message: `Readiness has been ${tail.join(', ')} for ${AMBER_RUN_DAYS} days. Trimming one day at a time is not working.`,
    })
  }

  if (triggers.length === 0) {
    return { triggered: false, severity: 'none', triggers: [], reasons: [], factor: 1 }
  }

  const severity: DeloadSeverity = triggers.length >= 2 ? 'deload' : 'trim'
  return {
    triggered: true,
    severity,
    triggers,
    reasons: triggers.map((t) => t.message),
    factor: severity === 'deload' ? DELOAD_DEEP_FACTOR : DELOAD_TRIM_FACTOR,
  }
}

// ── The patch ─────────────────────────────────────────────────────────────────

/**
 * A deload as an edit, not as a rewrite.
 *
 * Only the hard work is touched. Prehab and stretching are near-free by design
 * (§9) and a deload that strips them removes the one thing that should survive
 * a heavy week. Anything that cannot be meaningfully scaled — `scaleItem`
 * returns null — is removed rather than left at full dose, because half a depth
 * jump is not a thing.
 */
export function buildDeloadPatch(
  blocks: SessionBlock[],
  verdict: DeloadVerdictDetail,
): SessionPatch {
  const ops: PatchOp[] = []
  const headline = verdict.reasons[0] ?? 'The load warrants a step back.'

  for (const block of blocks) {
    for (const item of block.items) {
      const cost = itemCost(item)
      if (cost.hardness < HARD_DAY_SRPE) continue

      const scaled = scaleItem(item, verdict.factor)
      if (scaled) {
        ops.push({
          op: 'modify',
          itemId: item.id,
          params: scaled.params,
          status: item.status,
          reason: `${DELOAD_REASON_PREFIX} ${item.ref.name} cut to ${Math.round(verdict.factor * 100)}%. ${headline}`,
        })
        continue
      }

      ops.push({
        op: 'remove',
        itemId: item.id,
        reason: `${DELOAD_REASON_PREFIX} ${item.ref.name} does not shrink usefully, so it comes out this week. ${headline}`,
      })
    }
  }

  return {
    actor: 'engine',
    ops,
    source: `deload:${verdict.severity}`,
  }
}

// ── The DB half ───────────────────────────────────────────────────────────────

/** ACWR at each of the last `days` days, so a sustained run is visible. */
export function acwrTail(dailyLoads: number[], days = 3): number[] {
  const out: number[] = []
  for (let back = days - 1; back >= 0; back--) {
    const slice = back === 0 ? dailyLoads : dailyLoads.slice(0, dailyLoads.length - back)
    if (slice.length === 0) continue
    out.push(computeAcwr(slice).acwr)
  }
  return out
}

/** Gather the signals §17 keys off, for a given day. */
export async function gatherDeloadSignals(today = new Date()): Promise<DeloadSignals> {
  const start = startOfDay(today)

  const [dayContext, readinessRows, histories, profile] = await Promise.all([
    loadDayContext(today),
    prisma.readiness_daily.findMany({
      where: { date: { gte: subDays(start, 10), lte: start } },
      orderBy: { date: 'asc' },
    }),
    loadExerciseHistories(14),
    prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } }),
  ])

  const weekAgo = subDays(start, 7)
  const thisWeek = histories.filter((h) => h.date >= weekAgo)
  const lastWeek = histories.filter((h) => h.date < weekAgo)

  const recentRirDeficit = histories.slice(-2).map((h) => {
    const lift = KEY_LIFTS_BY_ID[h.exerciseId]
    if (!lift) return 0
    const rirs = h.sets.map((s) => s.rir).filter((r): r is number => r !== null && r !== undefined)
    if (rirs.length === 0) return 0
    return rirs.reduce((a, b) => a + b, 0) / rirs.length - lift.defaultTargetRir
  })

  // The band is not stored, so it is reconstructed from the recovery score the
  // same way `readiness.computeBand` would band it — 67/34, framework §1a.
  const recentBands: ReadinessBand[] = readinessRows
    .map((r) => r.recoveryScore)
    .filter((s): s is number => s !== null)
    .map((s) => (s >= 67 ? 'green' : s >= 34 ? 'amber' : 'red'))

  return {
    recentAcwr: acwrTail(dayContext.dailyLoads, 3),
    recentRirDeficit,
    weeklySetsThisWeek: weeklySetsByMuscle(thisWeek, KEY_LIFTS_BY_ID),
    weeklySetsLastWeek: weeklySetsByMuscle(lastWeek, KEY_LIFTS_BY_ID),
    trainingAge: (profile?.fitnessLevel as DeloadSignals['trainingAge']) ?? undefined,
    recentHrv: readinessRows.map((r) => r.hrv).filter((v): v is number => v !== null),
    recentBands,
  }
}

export async function evaluateDeloadForDate(today = new Date()): Promise<DeloadVerdictDetail> {
  return evaluateDeload(await gatherDeloadSignals(today))
}

export interface DeloadApplication {
  verdict: DeloadVerdictDetail
  applied: boolean
  /** Why nothing happened, when nothing did. Never silent. */
  skipped: 'not_warranted' | 'already_applied' | 'no_session' | 'nothing_to_trim' | null
  session: EditableSession | null
  diffSummary: string | null
  /** The funnel's verdict, when a patch was actually put through it. */
  patchVerdict: string | null
}

/** True when today's history already carries a deload — it fires once a day. */
export async function alreadyDeloadedToday(sessionId: number): Promise<boolean> {
  const history = await loadEditHistory(sessionId)
  return history.some((edit) => (edit.reason ?? '').startsWith(DELOAD_REASON_PREFIX))
}

/**
 * Fire the deload, through the one funnel.
 *
 * Note what this does *not* do: it never writes `blocksJson` itself, never
 * skips the validator, and never assumes it will be applied. If trimming the
 * day somehow breaks a rule — a counter-proposal is still a possible answer —
 * the deload is pushed back like anything else and the caller is told.
 */
export async function applyDeloadIfWarranted(
  today: Date,
  context: ValidationContext,
): Promise<DeloadApplication> {
  const date = startOfDay(today)
  const verdict = await evaluateDeloadForDate(date)

  const base: DeloadApplication = {
    verdict,
    applied: false,
    skipped: null,
    session: null,
    diffSummary: null,
    patchVerdict: null,
  }

  if (!verdict.triggered) return { ...base, skipped: 'not_warranted' }

  const session = await readEditableSession(date)
  if (!session || session.id === undefined) return { ...base, skipped: 'no_session' }
  if (await alreadyDeloadedToday(session.id)) {
    return { ...base, session, skipped: 'already_applied' }
  }

  const patch = buildDeloadPatch(session.blocks, verdict)
  if (patch.ops.length === 0) {
    return { ...base, session, skipped: 'nothing_to_trim' }
  }

  const outcome = await applyPatchToSession(session, patch, context, {
    reason: `${DELOAD_REASON_PREFIX} ${verdict.reasons.join(' ')}`,
  })

  return {
    verdict,
    applied: outcome.applied,
    skipped: null,
    session: outcome.session,
    diffSummary: outcome.diff.summary,
    patchVerdict: outcome.verdict.kind,
  }
}
