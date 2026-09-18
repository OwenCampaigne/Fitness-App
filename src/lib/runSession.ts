// ── Run session ───────────────────────────────────────────────────────────────
// The DB-facing half of the run engine: reads state, assembles today's run, and
// writes calibration back into the anchors.
//
// Where ladder state lives: `athlete_profile.recoveryContextJson`, under a
// `ladder` key. The ladder *is* the return-to-run context, and that column is
// already the JSON blob describing it — so no migration, and the state sits
// next to the `longestRunSegmentMin` ceiling that governs it.

import { addDays, startOfDay, subDays } from 'date-fns'
import { prisma } from './db'
import {
  LADDER_RUNGS,
  RUN_TYPES,
  applyRunReadiness,
  decideLadder,
  prescribeRun,
  resolveTarget,
  rungTotalRunMin,
  weekKey,
} from './runEngine'
import { analyzeRuns, toRunActivityRow } from './runAnalysis'
import { parseStoredContext } from './clearance'
import { applyRehabStage } from './rehabStage'
import type { ReadinessBand } from '../types/readiness'
import type { LadderState, RunAnalysis, RunPrescription, RunType } from '../types/run'
import type { HrZones, PaceAnchor } from './runEngine'
import type { AnchorSource, RecoveryContext } from '../types/strength'

// Zones and anchors are declared alongside the engine that consumes them.
export type { HrZones, PaceAnchor } from './runEngine'

export const DEFAULT_LADDER_STATE: LadderState = {
  rungIndex: 0,
  sessionsAtRung: 0,
  painFreeStreak: 0,
  lastVolumeIncreaseWeek: null,
  lastSegmentIncreaseWeek: null,
  graduated: false,
}

interface RecoveryContextWithLadder extends RecoveryContext {
  ladder?: LadderState
}

/**
 * Read the recovery context *as the engines should see it*: the stored clearance
 * with the current rehab stage folded in (§15, `rehabStage.ts`). With no stage
 * recorded this is byte-for-byte what is in the column, which is why nothing
 * about the pre-stage behaviour moved.
 *
 * Read-only. `writeLadderState` deliberately parses raw — writing a folded
 * context back would overwrite the clinician's words with a derived value.
 */
export function parseRecoveryContext(json: string | null): RecoveryContextWithLadder | null {
  if (!json) return null
  try {
    return applyRehabStage(JSON.parse(json) as RecoveryContextWithLadder)
  } catch {
    return null
  }
}

export function readLadderState(context: RecoveryContextWithLadder | null): LadderState {
  return { ...DEFAULT_LADDER_STATE, ...(context?.ladder ?? {}) }
}

export async function writeLadderState(state: LadderState): Promise<void> {
  const profile = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
  if (!profile) return

  // Raw, not folded: this value goes back into the column, and the column holds
  // what the clinician said, never what the stage machine derived from it.
  const context = parseStoredContext(profile.recoveryContextJson)
  context.ladder = state

  await prisma.athlete_profile.update({
    where: { id: profile.id },
    data: { recoveryContextJson: JSON.stringify(context) },
  })
}

// ── Zones and anchors ─────────────────────────────────────────────────────────

interface TrainingPaces {
  easy?: { value: number | null; source: AnchorSource; confidence?: number }
  threshold?: { value: number | null; source: AnchorSource; confidence?: number }
  interval?: { value: number | null; source: AnchorSource; confidence?: number }
}

export function parseTrainingPaces(json: string | null): TrainingPaces {
  if (!json) return {}
  try {
    return JSON.parse(json) as TrainingPaces
  } catch {
    return {}
  }
}

/**
 * Heart-rate zones. Prefers anything explicitly stored; otherwise falls back to
 * Tanaka (208 − 0.7 × age) for max HR and the usual fractions for the rest —
 * clearly an estimate, which is exactly why `resolveTarget` will not hand over
 * a pace derived from it.
 */
export function deriveZones(
  age: number | null,
  hrZonesJson: string | null,
  lthrObserved: number | null,
): HrZones {
  let stored: { z2Ceiling?: number; lthr?: number; maxHr?: number } = {}
  try {
    stored = hrZonesJson ? JSON.parse(hrZonesJson) : {}
  } catch {
    stored = {}
  }

  const maxHr = stored.maxHr ?? (age ? Math.round(208 - 0.7 * age) : null)
  const lthr = stored.lthr ?? lthrObserved ?? (maxHr ? Math.round(maxHr * 0.88) : null)
  const z2Ceiling = stored.z2Ceiling ?? (maxHr ? Math.round(maxHr * 0.78) : null)

  return { z2Ceiling, lthr, maxHr }
}

// ── Today's run ───────────────────────────────────────────────────────────────

export interface TodayRunInput {
  band: ReadinessBand
  provisional: boolean
  painLevel: 'none' | 'sometimes' | 'yes'
  context: RecoveryContextWithLadder | null
  zones: HrZones
  easyPaceAnchor: PaceAnchor | null
  today: Date
  /** What the plan wants, once there is a plan. */
  plannedType?: RunType
  plannedDurationMin?: number
}

export interface TodayRunResult {
  prescription: RunPrescription
  ladder: ReturnType<typeof decideLadder>
  ladderState: LadderState
  /** The state to persist if this session is completed as prescribed. */
  nextLadderState: LadderState
  weeklyRunMin: number
  ceilingMin: number | null
}

export function buildTodayRun(input: TodayRunInput): TodayRunResult {
  const {
    band,
    provisional,
    painLevel,
    context,
    zones,
    easyPaceAnchor,
    today,
    plannedType,
    plannedDurationMin,
  } = input

  const ladderState = readLadderState(context)
  const ceilingMin = context?.longestRunSegmentMin ?? null

  const ladder = decideLadder({
    state: ladderState,
    today,
    band,
    painLevel,
    longestRunSegmentMin: ceilingMin,
    provisional,
  })

  const graduated = ladder.action === 'graduated'
  const baseType: RunType = graduated ? (plannedType ?? 'easy') : 'walk_run'

  const adjustment = applyRunReadiness(baseType, band, painLevel === 'yes')
  const target = resolveTarget(adjustment.type, easyPaceAnchor, zones, graduated)

  const prescription = prescribeRun({ ladder, adjustment, target, plannedDurationMin })

  return {
    prescription,
    ladder,
    ladderState,
    nextLadderState: advanceLadderState(ladderState, ladder, today),
    weeklyRunMin: rungTotalRunMin(ladder.rung),
    ceilingMin,
  }
}

/** The state to persist once today's session is marked complete. */
export function advanceLadderState(
  state: LadderState,
  decision: ReturnType<typeof decideLadder>,
  today: Date,
): LadderState {
  const week = weekKey(today)

  switch (decision.action) {
    case 'advance_segment':
      return {
        ...state,
        rungIndex: decision.rung.index,
        sessionsAtRung: 1,
        painFreeStreak: 0,
        lastSegmentIncreaseWeek: week,
      }
    case 'advance_volume':
      return {
        ...state,
        sessionsAtRung: state.sessionsAtRung + 1,
        lastVolumeIncreaseWeek: week,
      }
    case 'drop_back':
      return {
        ...state,
        rungIndex: decision.rung.index,
        sessionsAtRung: 0,
        painFreeStreak: 1,
      }
    case 'graduated':
      return { ...state, graduated: true, rungIndex: LADDER_RUNGS.length - 1 }
    case 'capped_by_clearance':
      // A completed session still counts toward the rung; it just cannot climb.
      return { ...state, sessionsAtRung: state.sessionsAtRung + 1 }
    case 'hold':
    default:
      return {
        ...state,
        sessionsAtRung: state.sessionsAtRung + 1,
        painFreeStreak: state.painFreeStreak > 0 ? state.painFreeStreak + 1 : 0,
      }
  }
}

// ── DB entry points ───────────────────────────────────────────────────────────

export async function getTodayRun(
  band: ReadinessBand,
  provisional: boolean,
): Promise<TodayRunResult & { analysis: RunAnalysis }> {
  const profile = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
  const context = parseRecoveryContext(profile?.recoveryContextJson ?? null)
  const paces = parseTrainingPaces(profile?.trainingPacesJson ?? null)

  const activities = await prisma.activities.findMany({
    where: { date: { gte: subDays(new Date(), 42) } },
    orderBy: { date: 'asc' },
  })

  // toRunActivityRow parses the splits column, so decoupling has halves to
  // compare (framework §7). Mapping by hand here is how it went missing before.
  const rows = activities.map(toRunActivityRow)

  const provisionalZones = deriveZones(profile?.age ?? null, profile?.hrZonesJson ?? null, null)
  const analysis = analyzeRuns(rows, {
    z2Ceiling: provisionalZones.z2Ceiling,
    maxHr: provisionalZones.maxHr,
  })

  // Feed the observed LTHR back in so zones sharpen as data arrives.
  const zones = deriveZones(
    profile?.age ?? null,
    profile?.hrZonesJson ?? null,
    analysis.lthr.source === 'observed' ? analysis.lthr.value : null,
  )

  const plannedToday = await prisma.planned_session.findFirst({
    where: { date: startOfDay(new Date()), modality: 'run' },
  })

  let plannedType: RunType | undefined
  let plannedDurationMin: number | undefined
  if (plannedToday?.targetSpecJson) {
    try {
      const spec = JSON.parse(plannedToday.targetSpecJson) as {
        runType?: RunType
        durationMin?: number
      }
      plannedType = spec.runType
      plannedDurationMin = spec.durationMin
    } catch {
      /* a malformed plan row should not take the day down */
    }
  }

  const result = buildTodayRun({
    band,
    provisional,
    painLevel: (profile?.currentPainLevel ?? 'none') as 'none' | 'sometimes' | 'yes',
    context,
    zones,
    easyPaceAnchor: paces.easy
      ? { value: paces.easy.value, source: paces.easy.source, confidence: paces.easy.confidence }
      : null,
    today: new Date(),
    plannedType,
    plannedDurationMin,
  })

  return { ...result, analysis }
}

/**
 * Write the observed easy pace back into `trainingPacesJson`.
 *
 * The running counterpart to `refreshWorkingLoadAnchor` — same anchor
 * machinery, different signal. Pace at a matched heart rate is the input,
 * because it is the one measure that separates fitness from how you feel.
 */
export async function refreshPaceAnchors(): Promise<void> {
  const profile = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
  if (!profile) return

  const activities = await prisma.activities.findMany({
    where: { date: { gte: subDays(new Date(), 42) } },
    orderBy: { date: 'asc' },
  })

  // toRunActivityRow parses the splits column, so decoupling has halves to
  // compare (framework §7). Mapping by hand here is how it went missing before.
  const rows = activities.map(toRunActivityRow)

  const zones = deriveZones(profile.age, profile.hrZonesJson, null)
  const analysis = analyzeRuns(rows, { z2Ceiling: zones.z2Ceiling, maxHr: zones.maxHr })

  const paces = parseTrainingPaces(profile.trainingPacesJson)
  const { samples, recentSecPerKm } = analysis.paceAtFixedHr

  if (recentSecPerKm !== null && samples >= 4) {
    paces.easy = {
      value: recentSecPerKm,
      source: samples >= 8 ? 'confirmed' : 'observed',
      confidence: samples >= 8 ? 0.8 : 0.55,
    }
  }

  const hrZones = {
    ...(profile.hrZonesJson ? JSON.parse(profile.hrZonesJson) : {}),
    ...(analysis.lthr.source === 'observed' && analysis.lthr.value
      ? { lthr: analysis.lthr.value }
      : {}),
  }

  await prisma.athlete_profile.update({
    where: { id: profile.id },
    data: {
      trainingPacesJson: JSON.stringify(paces),
      hrZonesJson: JSON.stringify(hrZones),
    },
  })
}

/**
 * Lay down a week of planned run sessions.
 *
 * This is what finally switches on `checkConcurrentConflict` in the strength
 * engine, which has been reporting "no run plan yet" since Phase 2 — no change
 * to its code, it just starts finding rows.
 *
 * Deliberately dumb for now: a fixed weekly shape. Framework §19 — "start dumb
 * (a lookup-table allocator) and earn the intelligence." Phase 5 replaces it.
 */
export async function ensureWeeklyPlan(startDate = new Date()): Promise<number> {
  const profile = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
  const context = parseRecoveryContext(profile?.recoveryContextJson ?? null)
  const ladder = readLadderState(context)

  // Return-to-run: four sessions a week, never back to back.
  // Graduated: an easy-heavy week with one quality day and one long run.
  const shape: Array<RunType | null> = ladder.graduated
    ? ['rest', 'easy', 'tempo', 'easy', 'rest', 'long', 'recovery']
    : ['rest', 'walk_run', 'walk', 'walk_run', 'rest', 'walk_run', 'walk_run']

  const start = startOfDay(startDate)
  let created = 0

  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i)
    const type = shape[date.getDay()]
    if (!type || type === 'rest') continue

    const existing = await prisma.planned_session.findFirst({
      where: { date, modality: 'run' },
    })
    if (existing) continue

    await prisma.planned_session.create({
      data: {
        date,
        modality: 'run',
        targetSpecJson: JSON.stringify({
          runType: type,
          durationMin: type === 'long' ? 60 : type === 'tempo' ? 40 : 35,
          purpose: RUN_TYPES[type].purpose,
        }),
        // The long run and the quality day are what the week is built around.
        priority: type === 'long' || type === 'tempo' ? 'A' : 'B',
      },
    })
    created++
  }

  return created
}
