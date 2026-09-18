// ── Plyo catalog ──────────────────────────────────────────────────────────────
// A typed view over src/data/plyos.json — the same JSON that seeds
// `plyo_library`. The engine reads this, not the DB, so every plyo rule stays
// unit-testable and works in mock mode first (§16).

import rawPlyos from '../data/plyos.json'
import type { Plyo, PlyoContactLoad, PlyoTier } from '../types/movement'

export const PLYOS: Plyo[] = rawPlyos as Plyo[]

export const PLYOS_BY_ID: Record<string, Plyo> = Object.fromEntries(PLYOS.map((p) => [p.id, p]))

export function getPlyo(id: string): Plyo | null {
  return PLYOS_BY_ID[id] ?? null
}

export function plyosByTier(tier: PlyoTier): Plyo[] {
  return PLYOS.filter((p) => p.progressionTier === tier)
}

/**
 * Every prerequisite of a plyo, transitively. Bounded by a visited set so a
 * mis-authored catalog cycle cannot hang the engine.
 */
export function prerequisiteChain(id: string, seen = new Set<string>()): string[] {
  const plyo = getPlyo(id)
  if (!plyo) return []
  const out: string[] = []
  for (const prereq of plyo.prerequisites) {
    if (seen.has(prereq)) continue
    seen.add(prereq)
    out.push(prereq, ...prerequisiteChain(prereq, seen))
  }
  return out
}

/**
 * Contacts per set, by tier. High-tier work is dosed in far fewer contacts
 * because the cost per contact is what rises, not the count (§9).
 */
export const CONTACTS_PER_SET: Record<PlyoTier, number> = { 1: 20, 2: 10, 3: 5 }

/** Whether a drill lands hard enough to need impact clearance (§15). */
export function needsImpactClearance(plyo: Plyo): boolean {
  return plyo.contactLoad === 'high' || plyo.intensity === 'high'
}

/** The body regions a drill loads, used to honour an escalated niggle (§15). */
export const PLYO_REGIONS: Record<string, string[]> = {
  'pogo-jumps': ['ankle_foot', 'shin'],
  ankling: ['ankle_foot', 'shin'],
  'a-skips': ['ankle_foot', 'hip'],
  'jump-rope-basic': ['ankle_foot', 'shin'],
  bounding: ['ankle_foot', 'hip', 'hamstring'],
  'split-squat-jumps': ['knee', 'hip'],
  'box-jumps': ['knee', 'hip', 'ankle_foot'],
  'broad-jumps': ['hip', 'hamstring', 'knee'],
  'depth-jumps': ['knee', 'ankle_foot'],
  'single-leg-reactive-hops': ['ankle_foot', 'knee'],
  'drop-jumps': ['knee', 'ankle_foot'],
  'hurdle-series': ['ankle_foot', 'knee', 'hip'],
}

export function plyoRegions(id: string): string[] {
  return PLYO_REGIONS[id] ?? []
}

/** Ordering used when several drills fit — cheapest contact load first. */
export const CONTACT_LOAD_RANK: Record<PlyoContactLoad, number> = { low: 0, medium: 1, high: 2 }
