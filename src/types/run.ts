import type { ReadinessBand } from './readiness'
import type { AnchorSource } from './strength'
import type { ActivitySplits, DecouplingResult } from '../lib/splits'

export type { DecouplingResult }

// ── Session taxonomy ──────────────────────────────────────────────────────────

export type RunType =
  | 'rest'
  | 'walk'
  | 'walk_run'
  | 'recovery'
  | 'easy'
  | 'long'
  | 'steady'
  | 'tempo'
  | 'vo2'
  | 'strides'
  | 'hills'
  | 'progression'
  | 'fartlek'

/** What a run type needs to be true before it can be prescribed at all. */
export interface RunTypeRequirements {
  ladderGraduated?: boolean
  /** Minimum confidence of the LTHR anchor. */
  lthrAnchor?: AnchorSource
  /** Weeks of consistent easy volume already banked. */
  weeksOfBase?: number
  impactCleared?: boolean
}

export interface RunTypeDef {
  type: RunType
  label: string
  purpose: string
  /** sRPE-equivalent 0–10, so the Phase 5 allocator can price it. */
  intensityCost: number
  requires: RunTypeRequirements
}

/** What the engine knows about the athlete when choosing a type. */
export interface RunEligibilityContext {
  ladderGraduated: boolean
  lthrAnchorSource: AnchorSource
  weeksOfBase: number
  impactCleared: boolean
}

// ── Return-to-run ladder ──────────────────────────────────────────────────────

export interface LadderRung {
  index: number
  label: string
  runSec: number
  walkSec: number
  reps: number
  /** True once the rung is continuous running with no walk breaks. */
  continuous: boolean
}

export type LadderAction =
  | 'advance_segment'
  | 'advance_volume'
  | 'hold'
  | 'drop_back'
  | 'graduated'
  | 'capped_by_clearance'

export interface LadderState {
  /** Index into the rung list. */
  rungIndex: number
  /** Completed sessions at the current rung. */
  sessionsAtRung: number
  /** Consecutive pain-free sessions, used to unwind a drop-back. */
  painFreeStreak: number
  /** ISO week key of the last volume increase, so only one lands per week. */
  lastVolumeIncreaseWeek: string | null
  /** ISO week key of the last segment increase. */
  lastSegmentIncreaseWeek: string | null
  graduated: boolean
}

export interface LadderDecision {
  action: LadderAction
  rung: LadderRung
  reason: string
  /** Set when the ceiling, not the ladder, is what stopped the advance. */
  blockedByCeiling?: boolean
  /**
   * Set when no clearance has been entered at all, so no rung is available —
   * distinct from "cleared, but not for a longer segment yet". Nothing that
   * involves running may be prescribed in this state.
   */
  noRungAvailable?: boolean
}

// ── Prescription ──────────────────────────────────────────────────────────────

export type TargetKind = 'pace' | 'heart_rate' | 'effort'

export interface RunPrescription {
  type: RunType
  label: string
  /** Total session duration including walk breaks. */
  durationMin: number
  /** Time actually spent running. */
  runMin: number
  intervals?: Array<{ repeat: number; workSec: number; recoverSec: number; label?: string }>
  targetKind: TargetKind
  targetPaceSecPerKm?: number | null
  targetHrLow?: number | null
  targetHrHigh?: number | null
  /** Why this target kind and not a pace — surfaced on screen, never hidden. */
  targetNote: string
  why: string
  band: ReadinessBand
  /** What readiness changed versus what the plan wanted. */
  changed: string | null
}

// ── Post-run analysis ─────────────────────────────────────────────────────────

export interface EasyDayAudit {
  runsAudited: number
  runsOverCeiling: number
  /** Share of audited easy runs whose average HR exceeded the Z2 ceiling. */
  overCeilingRate: number
  worstOffenders: Array<{ date: Date; avgHr: number; ceiling: number }>
  verdict: string
}

export interface PaceAtFixedHr {
  /** The HR band the comparison was matched on. */
  hrBandLow: number
  hrBandHigh: number
  samples: number
  earlierSecPerKm: number | null
  recentSecPerKm: number | null
  /** Negative means faster at the same heart rate — fitness moved. */
  deltaSecPerKm: number | null
  verdict: string
}

export interface LthrEstimate {
  value: number | null
  source: AnchorSource
  confidence: number
  basis: string
}

/**
 * How aerobic decoupling has moved across the whole window.
 *
 * One run's drift is a data point; four runs' worth is the durability trend the
 * framework actually coaches off (§7). Kept separate from `decoupling` so the
 * single-run number stays the headline and the trend stays supporting evidence.
 */
export interface DecouplingTrend {
  /** Runs in the window that had splits stored at all. */
  runsWithSplits: number
  /** Runs whose splits passed the steady-state gate. */
  runsQualifying: number
  /** Qualifying runs, oldest first. */
  history: Array<{ date: Date; driftPct: number; durationMin: number }>
  /** Mean drift across qualifying runs, or null when there are none. */
  meanDriftPct: number | null
  /** Change from the earlier half of the qualifying runs to the recent half. */
  deltaPct: number | null
  verdict: string
}

export interface RunAnalysis {
  easyDayAudit: EasyDayAudit
  paceAtFixedHr: PaceAtFixedHr
  lthr: LthrEstimate
  /**
   * The most recent run in the window whose splits satisfied the Pa:HR gate,
   * or an explicit refusal naming what was missing. Never inferred from
   * averages — see `src/lib/splits.ts`.
   */
  decoupling: DecouplingResult
  decouplingTrend: DecouplingTrend
}

// ── Rows the analysis reads (kept free of Prisma types for testability) ──────

export interface RunActivityRow {
  date: Date
  type: string
  durationMin: number | null
  distanceKm: number | null
  avgHr: number | null
  maxHr: number | null
  /**
   * Per-split data, already parsed out of `activities.splits`. Optional because
   * every row written before the splits sync landed has none, and a run the
   * watch recorded without laps never will — both cases must degrade to an
   * honest "not available", not to a guess.
   */
  splits?: ActivitySplits | null
}
