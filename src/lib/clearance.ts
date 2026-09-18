// ── Post-surgical clearance ───────────────────────────────────────────────────
// Parsing and validation for the one thing in this app the app is not allowed to
// decide. `filterContraindicated` (strengthEngine) and `decideLadder` (runEngine)
// both read what this module writes, and both take their most conservative
// posture when it is absent — so the only failure mode worth engineering against
// is a half-answered form that reads as *permission*. Every rule below exists to
// make "I don't know" fall back to "not cleared" rather than to a default.
//
// Nothing here invents a value. A clearance that is not entered is not stored.

import type { RecoveryContext, SurgicalClearance } from '../types/strength'

// ── Shape ─────────────────────────────────────────────────────────────────────

/**
 * `SurgicalClearance` plus the provenance the engines do not need but the
 * athlete does: when the clinician said it, and who said it. Stored on the same
 * `recoveryContextJson.clearance` key the engines already read, so the extra
 * fields ride along without a parallel record.
 */
export interface ClearanceEntry extends SurgicalClearance {
  /** ISO `YYYY-MM-DD` — the date the clinician gave this clearance. */
  clearedOn: string
  /** Free text: the surgeon or PT who gave it. Optional, never required. */
  clearedBy: string | null
}

/** The recovery context as it is actually persisted, including ladder state. */
export interface StoredRecoveryContext extends RecoveryContext {
  clearance?: ClearanceEntry
  ladder?: unknown
  /**
   * Where the athlete is in rehab, and who said so. Typed loosely here so
   * `clearance.ts` does not depend on `rehabStage.ts` — the dependency runs the
   * other way. `readStageRecord` is the validating reader.
   */
  rehabStage?: unknown
  [key: string]: unknown
}

/**
 * Raw submission — everything optional and loosely typed because it crosses the
 * wire from a form where every field is skippable.
 */
export interface ClearanceSubmission {
  maxKneeFlexionDeg?: number | string | null
  /** An affirmative statement that the clinician placed no flexion limit. */
  noFlexionLimit?: boolean | null
  openChainCleared?: boolean | null
  impactCleared?: boolean | null
  pivotCleared?: boolean | null
  longestRunSegmentMin?: number | string | null
  /** `YYYY-MM` or `YYYY-MM-DD`. */
  surgeryDateApprox?: string | null
  /** `YYYY-MM-DD`. */
  clearedOn?: string | null
  clearedBy?: string | null
  notes?: string | null
}

export type ClearanceErrorCode =
  | 'flexion_required'
  | 'flexion_range'
  | 'open_chain_required'
  | 'impact_required'
  | 'pivot_required'
  | 'run_segment_required'
  | 'run_segment_range'
  | 'surgery_date_required'
  | 'surgery_date_invalid'
  | 'cleared_on_required'
  | 'cleared_on_invalid'
  | 'cleared_on_future'

export interface ClearanceParseResult {
  ok: boolean
  /** Stable codes, not prose — the UI maps them through `t(...)`. */
  errors: ClearanceErrorCode[]
  /** Null when the form came in empty: the conservative default must stand. */
  clearance: ClearanceEntry | null
  /** The ladder ceiling. Null means no rung is offered at all. */
  longestRunSegmentMin: number | null
  surgeryDateApprox: string | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Mirror of the threshold inside `filterContraindicated`: below this, deep-flexion
 * and deep-squat work stays hidden. Duplicated here only so the form can *explain*
 * the consequence before you save. The engine remains the authority.
 */
export const DEEP_FLEXION_THRESHOLD_DEG = 120

/** A knee does not flex past roughly this, and 0 is a legitimate answer. */
export const MIN_FLEXION_DEG = 0
export const MAX_FLEXION_DEG = 160

/** Longer than this is not a clearance ceiling any more, it is a marathon. */
export const MAX_RUN_SEGMENT_MIN = 180

/**
 * Past this age a clearance describes a knee that no longer exists. The card
 * warns at this point, and `rehabStage` uses the same line to decide when the
 * athlete's own report has become the better evidence (§15).
 */
export const STALE_CLEARANCE_MONTHS = 6

// ── Coercion helpers ──────────────────────────────────────────────────────────

function blank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

function toInt(v: number | string | null | undefined): number | null {
  if (blank(v)) return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (!Number.isFinite(n)) return null
  return Math.round(n)
}

function toBool(v: unknown): boolean | null {
  if (v === true || v === false) return v
  return null
}

function trimOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s === '' ? null : s
}

const YYYY_MM = /^\d{4}-(0[1-9]|1[0-2])$/
const YYYY_MM_DD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

function isRealDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

// ── Emptiness ─────────────────────────────────────────────────────────────────

/**
 * True when nothing was actually answered. An empty submission is not an error
 * and not a clearance — it clears the record and leaves the engines where they
 * already are.
 */
export function isEmptyClearanceSubmission(sub: ClearanceSubmission | null | undefined): boolean {
  if (!sub) return true
  return (
    blank(sub.maxKneeFlexionDeg) &&
    sub.noFlexionLimit !== true &&
    toBool(sub.openChainCleared) === null &&
    toBool(sub.impactCleared) === null &&
    toBool(sub.pivotCleared) === null &&
    blank(sub.longestRunSegmentMin) &&
    blank(sub.surgeryDateApprox) &&
    blank(sub.clearedOn) &&
    blank(sub.clearedBy) &&
    blank(sub.notes)
  )
}

// ── Parse + validate ──────────────────────────────────────────────────────────

/**
 * Validate a clearance submission and normalise it into the exact shape the
 * engines read.
 *
 * The asymmetry is deliberate: an *empty* form is accepted and stores nothing,
 * but a *partial* form is rejected. Half a clearance is the dangerous case —
 * `filterContraindicated` stops applying its conservative default the moment a
 * `clearance` object exists, so a record missing the flexion limit would quietly
 * unblock deep-knee work that nobody cleared.
 *
 * `now` is injectable so the future-date rule is testable.
 */
export function parseClearanceSubmission(
  sub: ClearanceSubmission | null | undefined,
  now: Date = new Date(),
): ClearanceParseResult {
  if (isEmptyClearanceSubmission(sub)) {
    return { ok: true, errors: [], clearance: null, longestRunSegmentMin: null, surgeryDateApprox: null }
  }

  const s = sub as ClearanceSubmission
  const errors: ClearanceErrorCode[] = []

  // ── Knee flexion ────────────────────────────────────────────────────────────
  // `null` means "unrestricted" to the engine, so it may only be reached by an
  // explicit statement that the clinician set no limit — never by a blank field.
  let maxKneeFlexionDeg: number | null = null
  const noLimit = s.noFlexionLimit === true
  const flexRaw = toInt(s.maxKneeFlexionDeg)

  if (noLimit) {
    maxKneeFlexionDeg = null
  } else if (flexRaw === null) {
    errors.push('flexion_required')
  } else if (flexRaw < MIN_FLEXION_DEG || flexRaw > MAX_FLEXION_DEG) {
    errors.push('flexion_range')
  } else {
    maxKneeFlexionDeg = flexRaw
  }

  // ── The three movement clearances ───────────────────────────────────────────
  // Tri-state in the form, binary in storage. Anything other than an explicit
  // yes is stored as "not cleared", which is what the engine blocks on.
  const openChainCleared = toBool(s.openChainCleared)
  const impactCleared = toBool(s.impactCleared)
  const pivotCleared = toBool(s.pivotCleared)
  if (openChainCleared === null) errors.push('open_chain_required')
  if (impactCleared === null) errors.push('impact_required')
  if (pivotCleared === null) errors.push('pivot_required')

  // ── Longest cleared continuous run segment ──────────────────────────────────
  // 0 is a real, common answer: cleared for strength work, not yet for running.
  const segRaw = toInt(s.longestRunSegmentMin)
  let longestRunSegmentMin: number | null = null
  if (segRaw === null) {
    errors.push('run_segment_required')
  } else if (segRaw < 0 || segRaw > MAX_RUN_SEGMENT_MIN) {
    errors.push('run_segment_range')
  } else {
    longestRunSegmentMin = segRaw
  }

  // ── Surgery / injury date ───────────────────────────────────────────────────
  const surgeryRaw = trimOrNull(s.surgeryDateApprox)
  let surgeryDateApprox: string | null = null
  if (surgeryRaw === null) {
    errors.push('surgery_date_required')
  } else if (YYYY_MM.test(surgeryRaw)) {
    surgeryDateApprox = surgeryRaw
  } else if (YYYY_MM_DD.test(surgeryRaw) && isRealDate(surgeryRaw)) {
    surgeryDateApprox = surgeryRaw.slice(0, 7)
  } else {
    errors.push('surgery_date_invalid')
  }

  // ── The date the clearance was given ────────────────────────────────────────
  // This is what makes the record ageable: a clearance from eight months ago is
  // a different thing from one given yesterday, and the athlete can see which.
  const clearedRaw = trimOrNull(s.clearedOn)
  let clearedOn: string | null = null
  if (clearedRaw === null) {
    errors.push('cleared_on_required')
  } else if (!YYYY_MM_DD.test(clearedRaw) || !isRealDate(clearedRaw)) {
    errors.push('cleared_on_invalid')
  } else if (clearedRaw > toIsoDate(now)) {
    errors.push('cleared_on_future')
  } else {
    clearedOn = clearedRaw
  }

  if (errors.length > 0) {
    return { ok: false, errors, clearance: null, longestRunSegmentMin: null, surgeryDateApprox: null }
  }

  const clearance: ClearanceEntry = {
    maxKneeFlexionDeg,
    openChainCleared: openChainCleared as boolean,
    impactCleared: impactCleared as boolean,
    pivotCleared: pivotCleared as boolean,
    notes: trimOrNull(s.notes),
    setBy: 'user',
    updatedAt: now.toISOString(),
    clearedOn: clearedOn as string,
    clearedBy: trimOrNull(s.clearedBy),
  }

  return { ok: true, errors: [], clearance, longestRunSegmentMin, surgeryDateApprox }
}

/** Local-calendar ISO date, so "today" means the athlete's today. */
export function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ── Persistence shape ─────────────────────────────────────────────────────────

export function parseStoredContext(json: string | null | undefined): StoredRecoveryContext {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as StoredRecoveryContext) : {}
  } catch {
    return {}
  }
}

/**
 * Fold a validated submission into the existing recovery context.
 *
 * `longestRunSegmentMin` stays where `runSession` already reads it — top level,
 * beside the ladder state — rather than being duplicated inside `clearance`.
 * One number, one home, no chance of the two drifting apart.
 *
 * An empty submission removes both the clearance and the ceiling, which returns
 * the engines to the exact posture they hold before anything is ever entered.
 */
export function mergeClearanceIntoContext(
  existing: StoredRecoveryContext,
  parsed: ClearanceParseResult,
): StoredRecoveryContext {
  const next: StoredRecoveryContext = { ...existing }

  if (parsed.clearance === null) {
    delete next.clearance
    delete next.longestRunSegmentMin
    return next
  }

  next.clearance = parsed.clearance
  next.longestRunSegmentMin = parsed.longestRunSegmentMin ?? undefined
  if (parsed.surgeryDateApprox) next.surgeryDateApprox = parsed.surgeryDateApprox
  return next
}

// ── Read-back for the form ────────────────────────────────────────────────────

/**
 * Turn a stored context back into form values. Fields with no stored answer come
 * back empty or `null` — the form never pre-selects a plausible-looking default,
 * because a default that looks answered is indistinguishable from a clearance.
 */
export function clearanceToSubmission(context: StoredRecoveryContext): ClearanceSubmission {
  const c = context.clearance
  return {
    maxKneeFlexionDeg: c && c.maxKneeFlexionDeg !== null ? c.maxKneeFlexionDeg : '',
    noFlexionLimit: c ? c.maxKneeFlexionDeg === null : false,
    openChainCleared: c ? c.openChainCleared : null,
    impactCleared: c ? c.impactCleared : null,
    pivotCleared: c ? c.pivotCleared : null,
    longestRunSegmentMin:
      typeof context.longestRunSegmentMin === 'number' ? context.longestRunSegmentMin : '',
    surgeryDateApprox: context.surgeryDateApprox ?? '',
    clearedOn: c?.clearedOn ?? '',
    clearedBy: c?.clearedBy ?? '',
    notes: c?.notes ?? '',
  }
}

/**
 * What a saved clearance currently permits, in the engines' own terms. Used to
 * show the consequence of the numbers on screen instead of making the athlete
 * infer it.
 */
export interface ClearanceConsequences {
  deepFlexionAllowed: boolean
  openChainAllowed: boolean
  impactAllowed: boolean
  pivotAllowed: boolean
  /** Null means no ladder rung is offered — running is not prescribed at all. */
  runSegmentMin: number | null
}

export function clearanceConsequences(context: StoredRecoveryContext): ClearanceConsequences {
  const c = context.clearance ?? null
  const seg = typeof context.longestRunSegmentMin === 'number' ? context.longestRunSegmentMin : null

  if (!c) {
    return {
      deepFlexionAllowed: false,
      openChainAllowed: false,
      impactAllowed: false,
      pivotAllowed: false,
      runSegmentMin: seg && seg > 0 ? seg : null,
    }
  }

  return {
    deepFlexionAllowed: c.maxKneeFlexionDeg === null || c.maxKneeFlexionDeg >= DEEP_FLEXION_THRESHOLD_DEG,
    openChainAllowed: c.openChainCleared,
    impactAllowed: c.impactCleared,
    pivotAllowed: c.pivotCleared,
    runSegmentMin: seg && seg > 0 ? seg : null,
  }
}

/** Whole months since the clearance was given — surfaced when it gets stale. */
export function clearanceAgeMonths(entry: ClearanceEntry, now: Date = new Date()): number | null {
  if (!YYYY_MM_DD.test(entry.clearedOn)) return null
  const then = new Date(`${entry.clearedOn}T00:00:00Z`)
  if (Number.isNaN(then.getTime())) return null
  const months =
    (now.getUTCFullYear() - then.getUTCFullYear()) * 12 + (now.getUTCMonth() - then.getUTCMonth())
  return Math.max(0, now.getUTCDate() < then.getUTCDate() ? months - 1 : months)
}
