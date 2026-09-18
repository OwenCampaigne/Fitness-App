// ── Intake anchors ────────────────────────────────────────────────────────────
// Framework §5a asks the intake to capture recent working sets and a recent race
// or easy pace; §21's Contrarian warns that the cold start is where the whole
// thing dies — over-estimate on day 0 and the first week is brutal, the athlete
// bails, and the system never gets the data that would have corrected it.
//
// So this module turns intake answers into anchors in exactly the shapes the
// calibration loop already writes (`WorkingLoadAnchor` into `keyLiftLoadsJson`,
// a pace anchor into `trainingPacesJson`), with two rules that are not
// negotiable:
//
//   1. Everything from the intake is `source: 'estimate'`. Nothing the app has
//      not watched happen is ever `observed`. `resolveTarget` in runEngine
//      already refuses to hand out a pace target from an `estimate` anchor, so
//      labelling honestly is also what keeps the posture conservative.
//   2. Loads start under what was reported. A number recalled from memory runs
//      optimistic, and being 10% light for one session costs nothing while being
//      10% heavy costs a week.
//
// Real logged sessions overwrite all of it through `refreshWorkingLoadAnchor`
// and `refreshPaceAnchors` — this is the starting belief, not the answer.

import { estimateE1RM, floorTo } from './strengthEngine'
import { KEY_LIFTS_BY_ID } from './keyLifts'
import type { AnchorSource, KeyLift, WorkingLoadAnchor } from '../types/strength'

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * The lifts the intake asks about: one hinge, one squat, one unilateral squat,
 * one calf. The four patterns `buildStrengthSession` reaches for first, so an
 * answer here is an answer about the session the athlete actually gets.
 */
export const INTAKE_LIFT_IDS = [
  'romanian-deadlift',
  'goblet-squat',
  'split-squat',
  'standing-calf-raise',
] as const

/** Start at 90% of the recalled load. See rule 2 above. */
export const INTAKE_LOAD_HAIRCUT = 0.9

/** Riegel's endurance exponent for race-time equivalency (§5a). */
export const RIEGEL_EXPONENT = 1.06

/**
 * Easy pace as a multiple of 10 km race pace. Daniels puts easy running at
 * roughly 59–74% of vVO2max; 1.3× a 10 km pace lands near the slow end of that,
 * which is the side to be on when the input is a half-remembered race.
 */
export const EASY_PACE_FACTOR_FROM_10K = 1.3

/** Sanity rails, not training advice — they only reject nonsense input. */
export const MIN_PACE_SEC_PER_KM = 120
export const MAX_PACE_SEC_PER_KM = 1200
export const MAX_REPS = 50
export const MAX_RIR = 10
export const MAX_WEIGHT_KG = 500

// ── Time and pace parsing ─────────────────────────────────────────────────────

/**
 * `mm:ss` or `h:mm:ss` into seconds. Deliberately strict: a bare number is
 * ambiguous between minutes and seconds, and guessing wrong by 60× is exactly
 * the sort of silent mis-anchor §21 is about.
 */
export function parseDurationToSeconds(input: string | null | undefined): number | null {
  if (typeof input !== 'string') return null
  const s = input.trim()
  if (!/^\d{1,2}(:\d{1,2}){1,2}$/.test(s)) return null

  const parts = s.split(':').map((p) => Number(p))
  if (parts.some((n) => !Number.isFinite(n))) return null

  let h = 0
  let m = 0
  let sec = 0
  if (parts.length === 2) [m, sec] = parts
  else [h, m, sec] = parts

  if (m > 59 || sec > 59) return null
  const total = h * 3600 + m * 60 + sec
  return total > 0 ? total : null
}

/** `mm:ss` per kilometre into seconds per kilometre. */
export function parsePaceToSecPerKm(input: string | null | undefined): number | null {
  const sec = parseDurationToSeconds(input)
  if (sec === null) return null
  if (sec < MIN_PACE_SEC_PER_KM || sec > MAX_PACE_SEC_PER_KM) return null
  return sec
}

export function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── Race equivalency ──────────────────────────────────────────────────────────

/** Riegel: T2 = T1 × (D2 / D1)^1.06. */
export function riegelEquivalentSec(
  knownDistanceKm: number,
  knownTimeSec: number,
  targetDistanceKm: number,
): number | null {
  if (!(knownDistanceKm > 0) || !(knownTimeSec > 0) || !(targetDistanceKm > 0)) return null
  return knownTimeSec * Math.pow(targetDistanceKm / knownDistanceKm, RIEGEL_EXPONENT)
}

// ── Pace anchor ───────────────────────────────────────────────────────────────

export interface IntakePaceAnchor {
  value: number | null
  source: AnchorSource
  confidence: number
  /** Plain-language provenance, shown on screen so the guess is visible. */
  basis: string
}

/**
 * Easy pace from a recent race. Riegel out to 10 km first, then the easy-pace
 * factor — going through a common distance keeps a 5 km and a half marathon
 * from producing wildly different easy paces for the same runner.
 */
export function deriveEasyPaceFromRace(input: {
  distanceKm: number
  timeSec: number
}): IntakePaceAnchor | null {
  const { distanceKm, timeSec } = input
  if (!(distanceKm > 0) || !(timeSec > 0)) return null

  const equiv10kSec = riegelEquivalentSec(distanceKm, timeSec, 10)
  if (equiv10kSec === null) return null

  const value = Math.round((equiv10kSec / 10) * EASY_PACE_FACTOR_FROM_10K)
  if (value < MIN_PACE_SEC_PER_KM || value > MAX_PACE_SEC_PER_KM) return null

  return {
    value,
    source: 'estimate',
    confidence: 0.35,
    basis: `Estimated from the ${distanceKm} km you entered, via a race-equivalency model. I have not watched you run yet.`,
  }
}

/** Easy pace straight from a self-reported recent easy run. */
export function deriveEasyPaceFromSelfReport(secPerKm: number | null): IntakePaceAnchor | null {
  if (secPerKm === null || secPerKm < MIN_PACE_SEC_PER_KM || secPerKm > MAX_PACE_SEC_PER_KM) {
    return null
  }
  return {
    value: secPerKm,
    source: 'estimate',
    confidence: 0.25,
    basis: 'Your own estimate of a recent easy run. I have not watched you run yet.',
  }
}

// ── Strength anchors ──────────────────────────────────────────────────────────

export interface IntakeSetEntry {
  liftId: string
  /** Null for bodyweight movements, which progress by reps. */
  weightKg?: number | string | null
  reps?: number | string | null
  rir?: number | string | null
}

export interface IntakeWorkingLoadAnchor extends WorkingLoadAnchor {
  source: 'estimate'
  /** What the athlete actually said, kept verbatim next to what we start at. */
  reportedKg: number | null
  reportedReps: number
  reportedRir: number
  e1rmKg: number | null
  basis: string
}

export type IntakeSetErrorCode = 'reps_required' | 'reps_range' | 'rir_range' | 'weight_range'

export interface IntakeSetResult {
  ok: boolean
  errors: IntakeSetErrorCode[]
  /** Null when the row was left blank — a skipped lift writes no anchor. */
  anchor: IntakeWorkingLoadAnchor | null
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' && v.trim() === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}

export function isEmptySetEntry(entry: IntakeSetEntry): boolean {
  return num(entry.weightKg) === null && num(entry.reps) === null && num(entry.rir) === null
}

/**
 * One reported working set into one anchor.
 *
 * The anchor's `value` is the *starting* load — the reported weight cut by
 * `INTAKE_LOAD_HAIRCUT` and floored to something actually loadable. The reported
 * number survives in `reportedKg`, so the intake's claim and the app's starting
 * point stay distinguishable forever rather than the app quietly adopting the
 * claim as fact.
 */
export function deriveIntakeWorkingLoadAnchor(
  entry: IntakeSetEntry,
  lift: KeyLift,
): IntakeSetResult {
  if (isEmptySetEntry(entry)) return { ok: true, errors: [], anchor: null }

  const errors: IntakeSetErrorCode[] = []
  const reps = num(entry.reps)
  const rir = num(entry.rir)
  const weight = num(entry.weightKg)

  if (reps === null) errors.push('reps_required')
  else if (reps < 1 || reps > MAX_REPS) errors.push('reps_range')

  // A blank RIR is read as 0 — "that set was basically everything I had" — which
  // is the conservative reading, because it makes the estimated 1RM smaller.
  const rirValue = rir ?? 0
  if (rirValue < 0 || rirValue > MAX_RIR) errors.push('rir_range')

  if (!lift.bodyweight && weight !== null && (weight <= 0 || weight > MAX_WEIGHT_KG)) {
    errors.push('weight_range')
  }

  if (errors.length > 0) return { ok: false, errors, anchor: null }

  const repsValue = reps as number
  const reportedKg = lift.bodyweight ? null : weight
  const microStep = lift.microStepKg ?? 2.5

  let value: number | null = null
  if (reportedKg !== null) {
    // Floor, not round: every rounding decision here goes down. When the haircut
    // falls below the smallest loadable step, hold at the reported weight rather
    // than rounding *up* past it — the starting load never exceeds the claim.
    const haircut = floorTo(reportedKg * INTAKE_LOAD_HAIRCUT, microStep)
    value = haircut > 0 ? haircut : Math.min(reportedKg, microStep)
  }

  const e1rm =
    reportedKg !== null ? estimateE1RM(reportedKg, repsValue, rirValue).value : null

  // Effective reps past ~12 is where Epley and Brzycki start disagreeing, and a
  // recalled set is already the weaker kind of input.
  const effectiveReps = repsValue + rirValue
  const confidence = effectiveReps <= 12 ? 0.3 : 0.2

  const basis = lift.bodyweight
    ? `You told me ${repsValue} reps at RIR ${rirValue}. Recalled, not observed.`
    : `You told me ${reportedKg} kg × ${repsValue} at RIR ${rirValue}. Starting at ${value} kg — under what you said, because I have not seen you lift.`

  return {
    ok: true,
    errors: [],
    anchor: {
      value,
      source: 'estimate',
      confidence,
      sessions: 0,
      reportedKg,
      reportedReps: repsValue,
      reportedRir: rirValue,
      e1rmKg: e1rm,
      basis,
    },
  }
}

export interface IntakeStrengthResult {
  ok: boolean
  /** Per-lift error codes, keyed by lift id. */
  errors: Record<string, IntakeSetErrorCode[]>
  anchors: Record<string, IntakeWorkingLoadAnchor>
}

/** Every reported set into the `keyLiftLoadsJson` map. Skipped lifts are absent. */
export function deriveIntakeStrengthAnchors(
  entries: IntakeSetEntry[],
  liftsById: Record<string, KeyLift> = KEY_LIFTS_BY_ID,
): IntakeStrengthResult {
  const errors: Record<string, IntakeSetErrorCode[]> = {}
  const anchors: Record<string, IntakeWorkingLoadAnchor> = {}

  for (const entry of entries) {
    const lift = liftsById[entry.liftId]
    if (!lift) continue // an unknown id is dropped, never guessed at

    const result = deriveIntakeWorkingLoadAnchor(entry, lift)
    if (!result.ok) errors[entry.liftId] = result.errors
    else if (result.anchor) anchors[entry.liftId] = result.anchor
  }

  return { ok: Object.keys(errors).length === 0, errors, anchors }
}

// ── Merging into the stored anchor blobs ──────────────────────────────────────

/**
 * Fold intake anchors into `keyLiftLoadsJson` without touching anything already
 * there. An `estimate` never overwrites an `observed` or `confirmed` anchor —
 * a memory does not get to outrank a logged session.
 */
export function mergeStrengthAnchors(
  existingJson: string | null | undefined,
  incoming: Record<string, IntakeWorkingLoadAnchor>,
): Record<string, WorkingLoadAnchor> {
  let existing: Record<string, WorkingLoadAnchor> = {}
  try {
    existing = existingJson ? (JSON.parse(existingJson) as Record<string, WorkingLoadAnchor>) : {}
  } catch {
    existing = {}
  }

  const out: Record<string, WorkingLoadAnchor> = { ...existing }
  for (const [liftId, anchor] of Object.entries(incoming)) {
    const prior = out[liftId]
    if (prior && prior.source !== 'estimate') continue
    out[liftId] = anchor
  }
  return out
}

export interface StoredTrainingPaces {
  easy?: { value: number | null; source: AnchorSource; confidence?: number; basis?: string }
  [key: string]: unknown
}

/** Same rule for the pace anchor: an estimate never displaces observed data. */
export function mergeEasyPaceAnchor(
  existingJson: string | null | undefined,
  anchor: IntakePaceAnchor | null,
): StoredTrainingPaces {
  let existing: StoredTrainingPaces = {}
  try {
    existing = existingJson ? (JSON.parse(existingJson) as StoredTrainingPaces) : {}
  } catch {
    existing = {}
  }

  if (!anchor) return existing
  if (existing.easy && existing.easy.source !== 'estimate' && existing.easy.value !== null) {
    return existing
  }
  return { ...existing, easy: anchor }
}

/** The per-anchor confidence map `calibration_state.anchorConfidenceJson` holds. */
export function buildAnchorConfidenceMap(
  strength: Record<string, IntakeWorkingLoadAnchor>,
  pace: IntakePaceAnchor | null,
): Record<string, { source: AnchorSource; confidence: number }> {
  const out: Record<string, { source: AnchorSource; confidence: number }> = {}
  for (const [liftId, a] of Object.entries(strength)) {
    out[`keyLift.${liftId}`] = { source: a.source, confidence: a.confidence }
  }
  if (pace) out['pace.easy'] = { source: pace.source, confidence: pace.confidence }
  return out
}

// ── Run-anchor submission ─────────────────────────────────────────────────────

export const RACE_DISTANCES_KM: Record<string, number> = {
  '5k': 5,
  '10k': 10,
  half: 21.0975,
  marathon: 42.195,
}

export interface RunAnchorSubmission {
  /** 'race' | 'easy' | 'skip'. Anything else is treated as a skip. */
  kind?: string | null
  raceDistance?: string | null
  /** `mm:ss` or `h:mm:ss`. */
  raceTime?: string | null
  /** `mm:ss` per km. */
  easyPace?: string | null
}

export type RunAnchorErrorCode =
  | 'race_distance_required'
  | 'race_time_required'
  | 'race_time_invalid'
  | 'easy_pace_required'
  | 'easy_pace_invalid'

export interface RunAnchorResult {
  ok: boolean
  errors: RunAnchorErrorCode[]
  /** Null when skipped — no pace anchor is written and the run stays HR-led. */
  anchor: IntakePaceAnchor | null
}

/**
 * Parse the run half of the intake. A skip is a valid answer and writes nothing:
 * with no easy-pace anchor `resolveTarget` falls back to a heart-rate ceiling,
 * which is the conservative state the app is already in.
 */
export function parseRunAnchorSubmission(
  sub: RunAnchorSubmission | null | undefined,
): RunAnchorResult {
  if (!sub || !sub.kind || sub.kind === 'skip') return { ok: true, errors: [], anchor: null }

  if (sub.kind === 'race') {
    const errors: RunAnchorErrorCode[] = []
    const distanceKm = sub.raceDistance ? RACE_DISTANCES_KM[sub.raceDistance] : undefined
    if (!distanceKm) errors.push('race_distance_required')

    const raw = typeof sub.raceTime === 'string' ? sub.raceTime.trim() : ''
    let timeSec: number | null = null
    if (raw === '') errors.push('race_time_required')
    else {
      timeSec = parseDurationToSeconds(raw)
      if (timeSec === null) errors.push('race_time_invalid')
    }

    if (errors.length > 0) return { ok: false, errors, anchor: null }

    const anchor = deriveEasyPaceFromRace({
      distanceKm: distanceKm as number,
      timeSec: timeSec as number,
    })
    if (!anchor) return { ok: false, errors: ['race_time_invalid'], anchor: null }
    return { ok: true, errors: [], anchor }
  }

  if (sub.kind === 'easy') {
    const raw = typeof sub.easyPace === 'string' ? sub.easyPace.trim() : ''
    if (raw === '') return { ok: false, errors: ['easy_pace_required'], anchor: null }

    const anchor = deriveEasyPaceFromSelfReport(parsePaceToSecPerKm(raw))
    if (!anchor) return { ok: false, errors: ['easy_pace_invalid'], anchor: null }
    return { ok: true, errors: [], anchor }
  }

  return { ok: true, errors: [], anchor: null }
}
