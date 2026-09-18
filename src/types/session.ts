// ── The Session object ────────────────────────────────────────────────────────
// Canonical shape from RUNNING-ON-AI-Framework.md §3. Phase 2 writes only
// `exercise` items into `main` / `accessory` blocks; Phases 3–5 add run, plyo,
// prehab and stretch items to this same structure without restructuring it.

export type ItemKind = 'exercise' | 'plyo' | 'prehab' | 'stretch' | 'run'
export type ItemStatus = 'prescribed' | 'done' | 'skipped' | 'edited'
export type BlockKind = 'warmup' | 'main' | 'accessory' | 'cooldown'
export type SessionStatus = 'draft' | 'active' | 'completed'
export type EditActor = 'user' | 'coach' | 'engine'

export interface ItemRef {
  kind: ItemKind
  id: string // FK into the matching library table
  name: string // denormalized so a session renders without joins
}

/** Strength prescription (Phase 2). */
export interface StrengthParams {
  kind: 'strength'
  sets: number
  reps: number // target reps — top of the range
  repsMin?: number // bottom of the range → double progression
  weightKg: number | null // null = bodyweight, or not yet chosen
  targetRir: number
  restSec?: number
}

/** Run prescription (Phase 3 — declared now so types never move). */
export interface RunParams {
  kind: 'run'
  runType: string // easy | long | tempo | intervals | walk_run | …
  durationMin?: number | null
  distanceKm?: number | null
  targetPaceSecPerKm?: number | null
  targetHrLow?: number | null
  targetHrHigh?: number | null
  intervals?: Array<{ repeat: number; workSec: number; recoverSec: number; label?: string }>
}

/** Plyometric prescription — dosed in ground contacts (Phase 4). */
export interface ContactParams {
  kind: 'contacts'
  sets: number
  contactsPerSet: number
  restSec?: number
}

/** Prehab / stretch prescription — dosed in holds or reps (Phase 4). */
export interface HoldParams {
  kind: 'hold'
  sets: number
  reps?: number | null
  holdSec?: number | null
  perSide?: boolean
}

export type ItemParams = StrengthParams | RunParams | ContactParams | HoldParams

export interface SessionItem {
  id: string // uuid, unique within the session
  ref: ItemRef
  params: ItemParams
  why?: string // contextual, coach-generated (Phase 5+)
  status: ItemStatus
}

export interface SessionBlock {
  id: string
  kind: BlockKind
  label: string
  items: SessionItem[]
}

export interface SessionBlocks {
  blocks: SessionBlock[]
}

// ── Type guards ───────────────────────────────────────────────────────────────

export function isStrengthParams(p: ItemParams): p is StrengthParams {
  return p.kind === 'strength'
}

export function isRunParams(p: ItemParams): p is RunParams {
  return p.kind === 'run'
}

export function isContactParams(p: ItemParams): p is ContactParams {
  return p.kind === 'contacts'
}

export function isHoldParams(p: ItemParams): p is HoldParams {
  return p.kind === 'hold'
}
