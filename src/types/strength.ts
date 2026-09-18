import type { ReadinessBand } from './readiness'

// ── Movement attributes used by the post-surgical contraindication filter ─────
// These describe the movement, not a diagnosis. See framework §15.
export type MovementAttribute =
  | 'deep_knee_flexion'
  | 'open_chain_knee_extension'
  | 'high_impact'
  | 'loaded_pivot'
  | 'deep_squat_load'
  | 'unilateral'
  | 'posterior_chain'
  | 'trunk'

export type MovementPattern =
  | 'hinge'
  | 'squat'
  | 'unilateral_squat'
  | 'calf'
  | 'hip_abduction'
  | 'hamstring'
  | 'trunk'
  | 'push'
  | 'pull'

export type MuscleGroup =
  | 'hamstrings'
  | 'glutes'
  | 'quads'
  | 'calves'
  | 'adductors'
  | 'abductors'
  | 'trunk'
  | 'back'
  | 'chest'
  | 'shoulders'

/** A curated, progressable lift. Seeded from src/data/key-lifts.json. */
export interface KeyLift {
  id: string // matches exercise_library.id where possible
  exerciseLibraryId: string | null
  name: string
  pattern: MovementPattern
  primaryMuscleGroups: MuscleGroup[]
  attributes: MovementAttribute[]
  /** Nominal load step in kg for double progression. */
  incrementKg: number
  /**
   * Smallest change actually loadable on the equipment — 2.5 kg for a barbell
   * with 1.25 kg plates, less with microplates or a dumbbell rack. When 5% of
   * the working load is smaller than this, the engine adds a rep instead of
   * forcing an oversized jump.
   */
  microStepKg?: number
  defaultSets: number
  defaultReps: number
  defaultRepsMin: number
  defaultTargetRir: number
  /** Bodyweight movements progress by reps, not load. */
  bodyweight: boolean
  runnerRationale: string
}

// ── Logging ───────────────────────────────────────────────────────────────────

export interface LoggedSet {
  id?: number
  sessionId: number
  exerciseId: string
  setNumber: number
  weightKg: number | null
  reps: number | null
  rir: number | null
  rpe?: number | null
  notes?: string | null
  date?: Date
}

/** All sets for one exercise within one session, ordered. */
export interface ExerciseSessionHistory {
  sessionId: number
  date: Date
  exerciseId: string
  sets: LoggedSet[]
}

// ── Engine outputs ────────────────────────────────────────────────────────────

export type AnchorSource = 'estimate' | 'observed' | 'confirmed'

export interface WorkingLoadAnchor {
  value: number | null
  source: AnchorSource
  confidence: number
  /** How many logged sessions back this anchor. */
  sessions: number
}

export type E1RMConfidence = 'high' | 'moderate' | 'low'

export interface E1RMEstimate {
  value: number
  confidence: E1RMConfidence
  formula: 'epley' | 'brzycki'
  /** Effective reps = reps + RIR. Above ~12 the formulas drift. */
  effectiveReps: number
}

export type ProgressionAction =
  | 'increase_load'
  | 'add_rep'
  | 'hold'
  | 'reduce_load'
  | 'no_history'

export interface ProgressionSuggestion {
  action: ProgressionAction
  weightKg: number | null
  reps: number
  targetRir: number
  reason: string
}

export interface ReadinessAdjustment {
  band: ReadinessBand
  /** Sets removed from each main lift. */
  setsDropped: number
  /** Multiplier applied to accessory volume. */
  accessoryVolumeFactor: number
  /** True when today's load must not exceed last session's. */
  capLoadAtLastSession: boolean
  /** True when main lifts are removed entirely. */
  mainLiftsRemoved: boolean
  summary: string
}

export interface DeloadVerdict {
  shouldDeload: boolean
  reason: string | null
}

export interface ConcurrentConflict {
  conflict: boolean
  reason: string
}

// ── Post-surgical clearance ───────────────────────────────────────────────────
// The app never invents these. They are entered by the user, sourced from their
// surgeon or physical therapist.
export interface SurgicalClearance {
  maxKneeFlexionDeg: number | null
  openChainCleared: boolean
  impactCleared: boolean
  pivotCleared: boolean
  notes?: string | null
  setBy: 'user'
  updatedAt?: string
}

export interface RecoveryContext {
  surgicalLeg?: 'left' | 'right'
  surgeryDateApprox?: string
  weeklyRunMinutes?: number
  longestRunSegmentMin?: number
  clearance?: SurgicalClearance
}

export interface ContraindicationResult {
  allowed: KeyLift[]
  blocked: Array<{ lift: KeyLift; attribute: MovementAttribute; reason: string }>
  /** True when no clearance has been entered and the conservative default applies. */
  usingConservativeDefault: boolean
}
