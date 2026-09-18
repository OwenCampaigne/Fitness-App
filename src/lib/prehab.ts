// ── Prehab catalog ────────────────────────────────────────────────────────────
// A typed view over src/data/prehab.json — the same JSON that seeds
// `prehab_library`. rehabhero's body_region × category structure is the model
// (§9); the niggle tracker matches against both axes.

import rawPrehab from '../data/prehab.json'
import type { BodyRegion, PrehabCategory, PrehabExercise } from '../types/movement'

export const PREHAB: PrehabExercise[] = rawPrehab as PrehabExercise[]

export const PREHAB_BY_ID: Record<string, PrehabExercise> = Object.fromEntries(
  PREHAB.map((p) => [p.id, p]),
)

export function getPrehab(id: string): PrehabExercise | null {
  return PREHAB_BY_ID[id] ?? null
}

export function prehabByRegion(region: BodyRegion): PrehabExercise[] {
  return PREHAB.filter((p) => p.bodyRegion === region)
}

export function prehabByCategory(category: PrehabCategory): PrehabExercise[] {
  return PREHAB.filter((p) => p.category === category)
}

export function prehabByTag(tag: string): PrehabExercise[] {
  return PREHAB.filter((p) => p.niggleTags.includes(tag))
}

/** The regions the catalog actually covers. Others fall back to tag matching. */
export const CATALOG_REGIONS: BodyRegion[] = Array.from(
  new Set(PREHAB.map((p) => p.bodyRegion)),
) as BodyRegion[]

/**
 * The tags a reported region implies when the athlete gave none.
 *
 * A niggle entry is "left Achilles, 3/10" — a region and a number. This is how
 * that becomes something the catalog can be searched with, without the app ever
 * naming a condition (§15).
 */
export const REGION_TAGS: Record<BodyRegion, string[]> = {
  ankle_foot: ['achilles', 'calf'],
  shin: ['shin_splints', 'anterior_compartment'],
  knee: ['knee', 'it_band'],
  hip: ['hip', 'glute_med', 'it_band'],
  hamstring: ['hip', 'glute_med'],
  low_back: ['low_back'],
  other: [],
}

/**
 * Routine prehab — near-free in load terms, so a small dose fits on almost any
 * day (§9). Deliberately a rotation rather than a fixed three, so no single
 * tissue gets the same stimulus seven days a week.
 */
export const ROUTINE_PREHAB_IDS: string[] = [
  'single-leg-calf-raises',
  'clamshells',
  'single-leg-glute-bridge',
  'lateral-band-walk',
  'dead-bug',
  'bird-dog',
]

/** Strengthening carries the adaptation; the rest support it. Used to rank ties. */
export const CATEGORY_RANK: Record<PrehabCategory, number> = {
  strengthen: 0,
  stability: 1,
  mobility: 2,
  stretch: 3,
}
