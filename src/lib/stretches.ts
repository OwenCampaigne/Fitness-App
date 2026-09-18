// ── Stretch catalog ───────────────────────────────────────────────────────────
// A typed view over src/data/stretches.json — the same JSON that seeds
// `stretch_library`. The `type` (dynamic/static) and `whenToUse` axes are what
// the placement rules in §9 turn on.

import rawStretches from '../data/stretches.json'
import type { BodyRegion, Stretch, StretchType, StretchWhen } from '../types/movement'

export const STRETCHES: Stretch[] = rawStretches as Stretch[]

export const STRETCHES_BY_ID: Record<string, Stretch> = Object.fromEntries(
  STRETCHES.map((s) => [s.id, s]),
)

export function getStretch(id: string): Stretch | null {
  return STRETCHES_BY_ID[id] ?? null
}

export function stretchesByType(type: StretchType): Stretch[] {
  return STRETCHES.filter((s) => s.type === type)
}

export function stretchesFor(when: StretchWhen): Stretch[] {
  return STRETCHES.filter((s) => s.whenToUse === when)
}

/** Default hold when a static entry has no duration authored. */
export const DEFAULT_STATIC_HOLD_SEC = 30
/** Default rep count when a dynamic entry has no reps authored. */
export const DEFAULT_DYNAMIC_REPS = 10

/**
 * The regions each stretch pulls through.
 *
 * The catalog carries prose targets, not a region enum — this index derives one
 * so an escalated niggle can close a region off without editing the JSON (§15).
 */
export const STRETCH_REGIONS: Record<string, BodyRegion[]> = {
  'leg-swings-forward': ['hip', 'hamstring'],
  'leg-swings-lateral': ['hip'],
  'hip-circles': ['hip'],
  'ankle-circles': ['ankle_foot'],
  'high-knees-dynamic': ['hip', 'ankle_foot'],
  'butt-kicks-dynamic': ['knee', 'hamstring'],
  'lateral-shuffles': ['hip', 'ankle_foot'],
  'worlds-greatest-stretch': ['hip', 'low_back', 'hamstring'],
  'standing-quad-stretch': ['knee', 'hip'],
  'standing-calf-stretch': ['ankle_foot'],
  'seated-hamstring-stretch': ['hamstring', 'low_back'],
  'pigeon-pose': ['hip'],
  'doorway-pec-stretch': [],
  'seated-figure-4': ['hip'],
  'lying-knee-to-chest': ['low_back', 'hip'],
  'chest-opener': [],
}

export function stretchRegions(id: string): BodyRegion[] {
  return STRETCH_REGIONS[id] ?? []
}

/** True when a stretch loads a region that has been closed off (§15). */
export function touchesBlockedRegion(id: string, blocked: BodyRegion[]): boolean {
  if (blocked.length === 0) return false
  return stretchRegions(id).some((r) => blocked.includes(r))
}
