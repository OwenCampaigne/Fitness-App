// ── Key lifts ─────────────────────────────────────────────────────────────────
// The exercise library holds 873 movements. The strength engine only *progresses*
// this curated set: runner-relevant patterns with the emphasis framework §8 calls
// for — posterior chain, unilateral, calf–Achilles, hips, trunk. Everything else
// in the library stays browsable and swappable, it just isn't auto-progressed.

import rawKeyLifts from '../data/key-lifts.json'
import type { KeyLift, MovementPattern, MuscleGroup } from '../types/strength'

export const KEY_LIFTS: KeyLift[] = rawKeyLifts as KeyLift[]

export const KEY_LIFTS_BY_ID: Record<string, KeyLift> = Object.fromEntries(
  KEY_LIFTS.map((l) => [l.id, l]),
)

/** Key lifts are also addressable by the exercise_library row they point at. */
export const KEY_LIFTS_BY_LIBRARY_ID: Record<string, KeyLift> = Object.fromEntries(
  KEY_LIFTS.filter((l) => l.exerciseLibraryId).map((l) => [l.exerciseLibraryId as string, l]),
)

export function getKeyLift(id: string): KeyLift | null {
  return KEY_LIFTS_BY_ID[id] ?? KEY_LIFTS_BY_LIBRARY_ID[id] ?? null
}

export function liftsByPattern(pattern: MovementPattern): KeyLift[] {
  return KEY_LIFTS.filter((l) => l.pattern === pattern)
}

const LOWER_BODY_GROUPS: MuscleGroup[] = ['hamstrings', 'glutes', 'quads', 'calves', 'adductors']

/**
 * Whether a lift competes with running for the same recovery. Used by the
 * concurrent-training guard (§8) — bodyweight and trunk work does not count.
 */
export function isHeavyLowerBody(lift: KeyLift): boolean {
  if (lift.bodyweight) return false
  if (lift.pattern === 'calf') return false
  return lift.primaryMuscleGroups.some((g) => LOWER_BODY_GROUPS.includes(g))
}
