// ── Strength engine ───────────────────────────────────────────────────────────
// Deterministic math and safety rails for the strength subsystem
// (RUNNING-ON-AI-Framework.md §8). Every function here is pure and DB-free so it
// is fully unit-testable. Judgment and explanation belong to the Claude layer;
// numbers and safety belong here (§10).

import type { ReadinessBand } from '../types/readiness'
import type {
  ConcurrentConflict,
  ContraindicationResult,
  DeloadVerdict,
  E1RMEstimate,
  ExerciseSessionHistory,
  KeyLift,
  LoggedSet,
  MovementAttribute,
  MuscleGroup,
  ProgressionSuggestion,
  ReadinessAdjustment,
  RecoveryContext,
  WorkingLoadAnchor,
} from '../types/strength'

// ── Rounding helpers ──────────────────────────────────────────────────────────

/** Round to the nearest `step` (e.g. 2.5 kg plates). */
export function roundTo(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/** Round down to the nearest `step` — you cannot load half a plate. */
export function floorTo(value: number, step: number): number {
  if (step <= 0) return value
  return Math.floor(value / step) * step
}

/**
 * The load step to actually use, in kg.
 *
 * Two constraints fight here. Relative progression says a jump should stay near
 * 5% of the working load, so a 20 kg lift does not climb as fast as a 100 kg
 * one. Physical reality says you cannot add less than the smallest plate pair
 * you own. When those cannot both be satisfied — the smallest loadable step
 * would be an oversized jump — this returns `null` and the caller adds a rep
 * instead, which is the correct training answer rather than a rounding hack.
 */
export function effectiveIncrement(lift: KeyLift, currentWeightKg: number): number | null {
  if (lift.bodyweight) return null

  const micro = lift.microStepKg ?? 2.5
  const cap = currentWeightKg * 0.05

  // The nominal step is already inside the relative cap.
  if (lift.incrementKg <= cap) return roundTo(lift.incrementKg, micro) || micro

  // Largest loadable step that still fits under 5%.
  const candidate = floorTo(cap, micro)
  if (candidate >= micro) return candidate

  // Nothing loadable fits under 5%. Accept the smallest step if it is still a
  // tolerable jump; otherwise tell the caller to progress by reps.
  if (micro <= currentWeightKg * 0.075) return micro
  return null
}

// ── Estimated 1RM ─────────────────────────────────────────────────────────────

/**
 * Estimate 1RM from a submaximal set. RIR is added to reps because
 * reps-in-reserve is exactly the count of reps not performed.
 *
 * No max testing, ever (§5a) — this only ever runs on submaximal work.
 */
export function estimateE1RM(
  weightKg: number,
  reps: number,
  rir: number,
  formula: 'epley' | 'brzycki' = 'epley',
): E1RMEstimate {
  const effectiveReps = reps + rir

  let value: number
  if (formula === 'brzycki') {
    // Brzycki breaks down as effectiveReps approaches 37.
    const denom = 37 - effectiveReps
    value = denom <= 1 ? weightKg * 36 : (weightKg * 36) / denom
  } else {
    value = weightKg * (1 + effectiveReps / 30)
  }

  const confidence: E1RMEstimate['confidence'] =
    effectiveReps <= 6 ? 'high' : effectiveReps <= 12 ? 'moderate' : 'low'

  return {
    value: Math.round(value * 10) / 10,
    confidence,
    formula,
    effectiveReps,
  }
}

// ── Set-history helpers ───────────────────────────────────────────────────────

/** Sets that were actually performed (reps recorded). */
export function completedSets(sets: LoggedSet[]): LoggedSet[] {
  return sets.filter((s) => s.reps !== null && s.reps !== undefined && s.reps > 0)
}

/** Mean RIR across sets that recorded one. Null when none did. */
export function meanRir(sets: LoggedSet[]): number | null {
  const withRir = sets.filter((s) => s.rir !== null && s.rir !== undefined)
  if (withRir.length === 0) return null
  const sum = withRir.reduce((acc, s) => acc + (s.rir as number), 0)
  return Math.round((sum / withRir.length) * 100) / 100
}

/** The heaviest load used across working sets. Null for bodyweight work. */
export function topWeight(sets: LoggedSet[]): number | null {
  const weights = sets
    .map((s) => s.weightKg)
    .filter((w): w is number => w !== null && w !== undefined && w > 0)
  if (weights.length === 0) return null
  return Math.max(...weights)
}

// ── Double progression ────────────────────────────────────────────────────────

export interface ProgressionOptions {
  /** Inside the calibration window the engine caps increases (§5b). */
  provisional?: boolean
  /** Used with `provisional` to allow at most one increase per week per lift. */
  daysSinceLastIncrease?: number | null
}

/**
 * Decide the next prescription for a lift from its last completed session.
 *
 * Returns `action: 'no_history'` when there is nothing to go on — the UI asks
 * the user rather than the system inventing a number it has not earned (§5a).
 */
export function suggestProgression(
  lift: KeyLift,
  lastSession: ExerciseSessionHistory | null,
  opts: ProgressionOptions = {},
): ProgressionSuggestion {
  const top = lift.defaultReps
  const bottom = lift.defaultRepsMin
  const targetRir = lift.defaultTargetRir

  const sets = lastSession ? completedSets(lastSession.sets) : []

  if (sets.length === 0) {
    return {
      action: 'no_history',
      weightKg: null,
      reps: top,
      targetRir,
      reason: lift.bodyweight
        ? `No logged history for this lift yet — start at a rep count you could stop ${targetRir} short of.`
        : `No logged history for this lift yet — pick a load you could stop ${targetRir} reps short of.`,
    }
  }

  const rir = meanRir(sets)
  const lastWeight = topWeight(sets)
  const repCounts = sets.map((s) => s.reps as number)
  const anySetBelowMin = repCounts.some((r) => r < bottom)
  const allHitTop = repCounts.every((r) => r >= top)
  const allAtLeastMin = repCounts.every((r) => r >= bottom)

  // No RIR recorded at all — hold rather than guess in either direction.
  if (rir === null) {
    return {
      action: 'hold',
      weightKg: lastWeight,
      reps: top,
      targetRir,
      reason: 'Last session had no RIR logged, so holding the load. Log RIR and it will progress.',
    }
  }

  // Bodyweight movements progress by reps only.
  if (lift.bodyweight) {
    if (anySetBelowMin || rir < targetRir - 2) {
      return {
        action: 'reduce_load',
        weightKg: null,
        reps: Math.max(1, bottom - 1),
        targetRir,
        reason: `Last session came in at RIR ${rir}, harder than the RIR ${targetRir} target — backing the reps off.`,
      }
    }
    if (allHitTop && rir >= targetRir) {
      return {
        action: 'add_rep',
        weightKg: null,
        reps: top + 1,
        targetRir,
        reason: `Hit ${top} on every set at RIR ${rir} — adding a rep.`,
      }
    }
    return {
      action: 'hold',
      weightKg: null,
      reps: top,
      targetRir,
      reason: `Holding at ${top} reps until every set lands at RIR ${targetRir} or easier.`,
    }
  }

  // ── Loaded movements ────────────────────────────────────────────────────────

  if (anySetBelowMin || rir <= targetRir - 2) {
    const reduced = lastWeight !== null ? roundTo(lastWeight * 0.925, 2.5) : null
    const why = anySetBelowMin
      ? `A set came in under ${bottom} reps`
      : `Mean RIR was ${rir} against a target of ${targetRir}`
    return {
      action: 'reduce_load',
      weightKg: reduced,
      reps: top,
      targetRir,
      reason: `${why} — dropping about 7.5% to get back inside the range.`,
    }
  }

  if (rir < targetRir - 1) {
    return {
      action: 'hold',
      weightKg: lastWeight,
      reps: top,
      targetRir,
      reason: `Mean RIR ${rir} was below the ${targetRir} target — same load again before adding.`,
    }
  }

  if (allHitTop && rir >= targetRir) {
    if (lastWeight === null) {
      return {
        action: 'add_rep',
        weightKg: null,
        reps: top + 1,
        targetRir,
        reason: `Hit ${top} on every set with no load recorded — adding a rep.`,
      }
    }

    // Calibration window: at most one increase per week per lift (§5b).
    const days = opts.daysSinceLastIncrease
    if (opts.provisional && days !== null && days !== undefined && days < 7) {
      return {
        action: 'hold',
        weightKg: lastWeight,
        reps: top,
        targetRir,
        reason: `Ready to add load, but still calibrating — one increase per week per lift. ${7 - days} day(s) to go.`,
      }
    }

    const inc = effectiveIncrement(lift, lastWeight)

    // No loadable step small enough to be a sensible jump — progress by reps.
    if (inc === null) {
      return {
        action: 'add_rep',
        weightKg: lastWeight,
        reps: top + 1,
        targetRir,
        reason: `Hit ${top} on every set at RIR ${rir}, but the smallest plate jump would be too big a step at ${lastWeight} kg — adding a rep instead.`,
      }
    }

    return {
      action: 'increase_load',
      weightKg: roundTo(lastWeight + inc, 0.5),
      reps: bottom,
      targetRir,
      reason: `Hit ${top} on every set at RIR ${rir} — up ${inc} kg, back to ${bottom} reps.`,
    }
  }

  if (allAtLeastMin && rir >= targetRir) {
    const lowest = Math.min(...repCounts)
    return {
      action: 'add_rep',
      weightKg: lastWeight,
      reps: Math.min(top, lowest + 1),
      targetRir,
      reason: `Inside the ${bottom}–${top} range at RIR ${rir} — same load, one more rep.`,
    }
  }

  return {
    action: 'hold',
    weightKg: lastWeight,
    reps: top,
    targetRir,
    reason: 'Holding — repeat the session as prescribed.',
  }
}

// ── Readiness gating ──────────────────────────────────────────────────────────

/**
 * How today's readiness band reshapes the strength prescription (§8).
 * The band is a veto, not a suggestion.
 */
export function applyReadinessAdjustment(
  band: ReadinessBand,
  provisional = false,
  painFlagged = false,
): ReadinessAdjustment {
  if (painFlagged) {
    return {
      band,
      setsDropped: 0,
      accessoryVolumeFactor: 1,
      capLoadAtLastSession: true,
      mainLiftsRemoved: true,
      summary: 'Pain flagged — accessory and prehab only, no main lifts today.',
    }
  }

  if (band === 'red') {
    return {
      band,
      setsDropped: 0,
      accessoryVolumeFactor: 0.5,
      capLoadAtLastSession: true,
      mainLiftsRemoved: true,
      summary: 'Red day — main lifts removed. Technique work and prehab only.',
    }
  }

  if (band === 'amber') {
    return {
      band,
      setsDropped: 1,
      accessoryVolumeFactor: 0.8,
      capLoadAtLastSession: true,
      mainLiftsRemoved: false,
      summary: 'Amber day — top set dropped, load held at last session, accessories trimmed 20%.',
    }
  }

  return {
    band,
    setsDropped: 0,
    accessoryVolumeFactor: 1,
    capLoadAtLastSession: provisional,
    mainLiftsRemoved: false,
    summary: provisional
      ? 'Green day — session stands, with calibration caps still on load increases.'
      : 'Green day — session stands as prescribed.',
  }
}

// ── Volume landmarks ──────────────────────────────────────────────────────────

export interface VolumeLandmark {
  mev: number // minimum effective volume, weekly hard sets
  mav: number // maximum adaptive volume
  mrv: number // maximum recoverable volume
}

/**
 * Weekly hard-set landmarks per muscle group. Lower-body ceilings are held
 * deliberately below general-population figures because running already
 * spends most of that recovery budget (§8, concurrent training).
 */
export const VOLUME_LANDMARKS: Record<MuscleGroup, VolumeLandmark> = {
  hamstrings: { mev: 4, mav: 9, mrv: 14 },
  glutes: { mev: 2, mav: 8, mrv: 12 },
  quads: { mev: 4, mav: 9, mrv: 14 },
  calves: { mev: 6, mav: 12, mrv: 18 },
  adductors: { mev: 0, mav: 5, mrv: 9 },
  abductors: { mev: 4, mav: 9, mrv: 14 },
  trunk: { mev: 4, mav: 10, mrv: 16 },
  back: { mev: 6, mav: 14, mrv: 20 },
  chest: { mev: 4, mav: 10, mrv: 16 },
  shoulders: { mev: 4, mav: 10, mrv: 16 },
}

/** Training age scales the ceilings; beginners recover from less. */
export function scaledLandmark(
  group: MuscleGroup,
  trainingAge: 'beginner' | 'intermediate' | 'advanced' = 'intermediate',
): VolumeLandmark {
  const base = VOLUME_LANDMARKS[group]
  const factor = trainingAge === 'beginner' ? 0.7 : trainingAge === 'advanced' ? 1.15 : 1
  return {
    mev: Math.round(base.mev * factor),
    mav: Math.round(base.mav * factor),
    mrv: Math.round(base.mrv * factor),
  }
}

/**
 * Count hard sets per muscle group over a window. A set counts as "hard" when
 * it was taken to RIR 4 or closer to failure — junk volume does not drive
 * adaptation and should not eat the recovery budget either.
 */
export function weeklySetsByMuscle(
  sessions: ExerciseSessionHistory[],
  liftsById: Record<string, KeyLift>,
): Partial<Record<MuscleGroup, number>> {
  const counts: Partial<Record<MuscleGroup, number>> = {}

  for (const session of sessions) {
    const lift = liftsById[session.exerciseId]
    if (!lift) continue
    const hardSets = completedSets(session.sets).filter(
      (s) => s.rir === null || s.rir === undefined || s.rir <= 4,
    )
    if (hardSets.length === 0) continue
    for (const group of lift.primaryMuscleGroups) {
      counts[group] = (counts[group] ?? 0) + hardSets.length
    }
  }

  return counts
}

// ── Deload — load-triggered only (§17) ────────────────────────────────────────

export interface DeloadInputs {
  /** Hard sets per muscle group, this week and last. */
  weeklySetsThisWeek: Partial<Record<MuscleGroup, number>>
  weeklySetsLastWeek: Partial<Record<MuscleGroup, number>>
  trainingAge?: 'beginner' | 'intermediate' | 'advanced'
  /** Most recent ACWR values, oldest first. */
  recentAcwr: number[]
  /** Mean RIR minus target, most recent sessions oldest first. */
  recentRirDeficit: number[]
}

/**
 * Deload fires because the load warrants it, never because the calendar says so.
 * Always returns the reason so the change can be explained on screen.
 */
export function shouldDeload(inputs: DeloadInputs): DeloadVerdict {
  const { weeklySetsThisWeek, weeklySetsLastWeek, trainingAge, recentAcwr, recentRirDeficit } =
    inputs

  // 1. Above MRV two weeks running for any muscle group.
  for (const key of Object.keys(weeklySetsThisWeek) as MuscleGroup[]) {
    const landmark = scaledLandmark(key, trainingAge)
    const thisWeek = weeklySetsThisWeek[key] ?? 0
    const lastWeek = weeklySetsLastWeek[key] ?? 0
    if (thisWeek > landmark.mrv && lastWeek > landmark.mrv) {
      return {
        shouldDeload: true,
        reason: `${key} has been above its recoverable ceiling (${landmark.mrv} hard sets) two weeks running — ${lastWeek} then ${thisWeek}.`,
      }
    }
  }

  // 2. ACWR above 1.3 for three consecutive days.
  if (recentAcwr.length >= 3) {
    const lastThree = recentAcwr.slice(-3)
    if (lastThree.every((v) => v > 1.3)) {
      return {
        shouldDeload: true,
        reason: `Acute:chronic load has sat above 1.3 for three days running (${lastThree.map((v) => v.toFixed(2)).join(', ')}).`,
      }
    }
  }

  // 3. RIR falling well below target at unchanged load, two sessions running.
  if (recentRirDeficit.length >= 2) {
    const lastTwo = recentRirDeficit.slice(-2)
    if (lastTwo.every((d) => d <= -1.5)) {
      return {
        shouldDeload: true,
        reason: `The same loads have been ${Math.abs(lastTwo[1]).toFixed(1)} RIR harder than prescribed for two sessions — fatigue is accumulating faster than it clears.`,
      }
    }
  }

  return { shouldDeload: false, reason: null }
}

// ── Concurrent training (§8) ──────────────────────────────────────────────────

export interface PlannedRunLike {
  date: Date
  runType: string
  priority?: 'A' | 'B' | 'C'
}

const QUALITY_RUN_TYPES = new Set(['long', 'vo2', 'intervals', 'tempo', 'threshold', 'race'])

/**
 * Guard the run against the lift. Phase 2 has no run plan yet, so with no
 * planned sessions this reports no conflict; Phase 3 populates `planned_session`
 * and this starts biting with no change to its callers.
 */
export function checkConcurrentConflict(
  liftDate: Date,
  liftIsHeavyLowerBody: boolean,
  plannedRuns: PlannedRunLike[],
): ConcurrentConflict {
  if (plannedRuns.length === 0) {
    return { conflict: false, reason: 'No run plan yet — nothing to deconflict against.' }
  }
  if (!liftIsHeavyLowerBody) {
    return { conflict: false, reason: 'Upper-body and light work does not compete with the run.' }
  }

  const dayMs = 24 * 60 * 60 * 1000
  const liftDay = new Date(liftDate).setHours(0, 0, 0, 0)

  for (const run of plannedRuns) {
    const runDay = new Date(run.date).setHours(0, 0, 0, 0)
    const isQuality = QUALITY_RUN_TYPES.has(run.runType)
    if (!isQuality) continue

    if (runDay === liftDay + dayMs) {
      return {
        conflict: true,
        reason: `A ${run.runType} run is scheduled tomorrow — heavy legs today would land on tired ones.`,
      }
    }
    if (runDay === liftDay && run.priority === 'A') {
      return {
        conflict: true,
        reason: `This is the week's A-run day — keep the heaviest lift away from it.`,
      }
    }
    if (runDay === liftDay) {
      return {
        conflict: true,
        reason: `Sharing the day with a ${run.runType} run — run first, or separate the two by at least 6 hours.`,
      }
    }
  }

  return { conflict: false, reason: 'No conflict with the planned runs this week.' }
}

// ── Post-surgical contraindication filter (§15) ───────────────────────────────

const CONSERVATIVE_BLOCKED: MovementAttribute[] = [
  'deep_knee_flexion',
  'open_chain_knee_extension',
  'loaded_pivot',
  'high_impact',
]

const ATTRIBUTE_REASONS: Record<string, string> = {
  deep_knee_flexion: 'loads the knee through deep flexion',
  open_chain_knee_extension: 'is open-chain knee extension',
  loaded_pivot: 'asks the knee to pivot under load',
  high_impact: 'is high impact',
  deep_squat_load: 'loads a deep squat position',
}

/**
 * Filter the lift menu against entered surgical clearance.
 *
 * This describes movements, it does not diagnose. The app never invents
 * clearance values: with none entered it takes the most conservative posture and
 * says on screen that the clearance has to come from a surgeon or PT (§15).
 */
export function filterContraindicated(
  lifts: KeyLift[],
  context: RecoveryContext | null,
  painLevel: 'none' | 'sometimes' | 'yes' = 'none',
): ContraindicationResult {
  const clearance = context?.clearance ?? null
  const usingConservativeDefault = clearance === null

  const blockedAttributes = new Set<MovementAttribute>()

  if (usingConservativeDefault) {
    for (const a of CONSERVATIVE_BLOCKED) blockedAttributes.add(a)
  } else {
    if (!clearance!.openChainCleared) blockedAttributes.add('open_chain_knee_extension')
    if (!clearance!.impactCleared) blockedAttributes.add('high_impact')
    if (!clearance!.pivotCleared) blockedAttributes.add('loaded_pivot')
    const maxFlex = clearance!.maxKneeFlexionDeg
    if (maxFlex !== null && maxFlex < 120) {
      blockedAttributes.add('deep_knee_flexion')
      blockedAttributes.add('deep_squat_load')
    }
  }

  // Active pain narrows things further regardless of clearance.
  if (painLevel === 'yes') {
    blockedAttributes.add('high_impact')
    blockedAttributes.add('deep_knee_flexion')
    blockedAttributes.add('deep_squat_load')
    blockedAttributes.add('loaded_pivot')
  }

  const allowed: KeyLift[] = []
  const blocked: ContraindicationResult['blocked'] = []

  for (const lift of lifts) {
    const hit = lift.attributes.find((a) => blockedAttributes.has(a))
    if (hit) {
      const detail = ATTRIBUTE_REASONS[hit] ?? 'is outside the current movement limits'
      const source = usingConservativeDefault
        ? 'no surgical clearance entered yet'
        : painLevel === 'yes'
          ? 'knee pain is currently flagged'
          : 'your entered clearance'
      blocked.push({
        lift,
        attribute: hit,
        reason: `${lift.name} ${detail} — hidden because ${source}.`,
      })
    } else {
      allowed.push(lift)
    }
  }

  return { allowed, blocked, usingConservativeDefault }
}

// ── Calibration write-back (§5b) ──────────────────────────────────────────────

/**
 * Turn logged history into a working-load anchor with an honest confidence.
 * This is the same machinery Phase 1 used for paces and zones.
 */
export function deriveWorkingLoadAnchor(
  sessions: ExerciseSessionHistory[],
  targetRir: number,
): WorkingLoadAnchor {
  const withSets = sessions
    .filter((s) => completedSets(s.sets).length > 0)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  if (withSets.length === 0) {
    return { value: null, source: 'estimate', confidence: 0.2, sessions: 0 }
  }

  const latest = withSets[withSets.length - 1]
  const value = topWeight(completedSets(latest.sets))

  if (withSets.length < 3) {
    return { value, source: 'observed', confidence: 0.5, sessions: withSets.length }
  }

  const lastThree = withSets.slice(-3)
  const rirOnTarget = lastThree.every((s) => {
    const r = meanRir(completedSets(s.sets))
    return r !== null && Math.abs(r - targetRir) <= 1
  })
  const weights = lastThree.map((s) => topWeight(completedSets(s.sets)) ?? 0)
  const loadStableOrRising = weights[0] <= weights[1] && weights[1] <= weights[2]

  if (rirOnTarget && loadStableOrRising) {
    return { value, source: 'confirmed', confidence: 0.85, sessions: withSets.length }
  }

  return { value, source: 'observed', confidence: 0.6, sessions: withSets.length }
}
