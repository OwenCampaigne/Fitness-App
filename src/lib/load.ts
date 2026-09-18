// ── Load currency ─────────────────────────────────────────────────────────────
// The one unit the whole app spends: session load = duration(min) × sRPE(0–10)
// (framework §3). Everything else — runs, lifts, plyos, prehab — is priced into
// it so the allocator can compare a tempo run against a heavy squat day without
// inventing a second currency. Cross-checked against Garmin TRIMP for runs and
// ground contacts for plyos, because a self-rating and a heart-rate integral
// disagreeing is a signal, not noise.
//
// Pure throughout: arrays in, numbers out, no DB. The wiring agent supplies the
// rows.

import { differenceInCalendarDays } from 'date-fns'
import { RUN_TYPES } from './runEngine'
import type { ReadinessBand } from '../types/readiness'
import type { ItemParams, SessionBlock, SessionItem } from '../types/session'

// ── Constants ─────────────────────────────────────────────────────────────────

/** The ACWR band the whole system trains inside (§3, §6). */
export const ACWR_LOWER = 0.8
export const ACWR_UPPER = 1.3
/** Past this, §17's load-triggered deload fires. */
export const ACWR_DANGER = 1.5
/** While the anchors are still guesses the band is narrower (§5b). */
export const CALIBRATION_ACWR_CAP = 1.1

/** sRPE at or above this is a "hard day" for the back-to-back rule (§10). */
export const HARD_DAY_SRPE = 7

/**
 * TRIMP → load-scale factor.
 *
 * Bannister TRIMP and sRPE load measure the same thing in different units. A
 * 60-min easy run is ~115 TRIMP and ~240 sRPE load; a 40-min threshold run is
 * ~175 TRIMP and ~280. The ratio sits near 2 across the range, so that is the
 * conversion — a calibration constant, not a law, which is exactly why the
 * cross-check reports confidence rather than pretending to precision.
 */
export const TRIMP_TO_LOAD = 2.0

/**
 * Load per ground contact. A plyo session is short and cheap on the clock but
 * expensive on tendon and CNS, so §9 doses it in contacts. 120 contacts ≈ 108
 * load ≈ a 27-min easy run, which is about right for how it eats into a week.
 */
export const LOAD_PER_CONTACT = 0.9

/** Weekly volume ramp (§5a) — and half of it while calibrating (§5b). */
export const WEEKLY_RAMP_CAP = 0.10
export const CALIBRATION_RAMP_CAP = 0.05

/** Anything under this is "near-free" — routine prehab and mobility (§9). */
export const NEAR_FREE_LOAD = 40

/**
 * How much near-free work one day may take without paying for it.
 *
 * §9 says routine prehab is "near-free in load terms — **fit a small dose**".
 * The per-item line above is the "near-free" half; this is the "small dose"
 * half, and without it the exemption has no ceiling: a real day on the dev DB
 * offered fourteen sub-40 items totalling 210 load against a 98 ceiling, and
 * every one of them rode free.
 *
 * 60 is one and a half items at the per-item line, or — at the ~15 load those
 * fourteen items actually averaged — three or four routine drills. That is a
 * small dose: enough that calf raises, single-leg balance and a glute-med drill
 * are still affordable on a red day when the ceiling itself is nearly nothing,
 * and little enough that the fifteenth mobility hold has to compete for the
 * budget like the work it is.
 */
export const NEAR_FREE_ALLOWANCE = 60

/** A single day may not be more than this multiple of the chronic daily load. */
export const MAX_DAY_MULTIPLE = 2.5

/** With no history at all, what a first session is still allowed to cost. */
export const COLD_START_CEILING = 200
export const COLD_START_WEEKLY = 900

/** Foster's monotony is bounded so a perfectly flat week cannot divide by zero. */
export const MAX_MONOTONY = 10

// ── The currency ──────────────────────────────────────────────────────────────

export function clampSrpe(srpe: number): number {
  if (!Number.isFinite(srpe)) return 0
  return Math.min(10, Math.max(0, srpe))
}

/** Session load = duration(min) × sRPE(0–10). The whole currency (§3). */
export function sessionLoad(durationMin: number, srpe: number): number {
  if (!Number.isFinite(durationMin) || durationMin <= 0) return 0
  return durationMin * clampSrpe(srpe)
}

/** What one item or session costs, in the one currency. */
export interface LoadCost {
  durationMin: number
  srpe: number
  load: number
  /** Peak intensity, 0–10 — what decides "was this a hard day", not the total. */
  hardness: number
  /** Ground contacts, when the item has any (§9). */
  contacts?: number
}

export function isHardEffort(cost: LoadCost): boolean {
  return cost.hardness >= HARD_DAY_SRPE
}

// ── Cross-checks (§3) ─────────────────────────────────────────────────────────

export type LoadSource = 'srpe' | 'trimp' | 'contacts' | 'blended' | 'none'
export type LoadConfidence = 'high' | 'moderate' | 'low'

export interface LoadEstimate {
  load: number
  source: LoadSource
  confidence: LoadConfidence
  note: string
}

export function loadFromTrimp(trimp: number): number {
  if (!Number.isFinite(trimp) || trimp <= 0) return 0
  return trimp * TRIMP_TO_LOAD
}

/** Disagreement beyond this share means one of the two inputs is wrong. */
const DISAGREEMENT_THRESHOLD = 0.4

/**
 * Price a run against both the athlete's sRPE and Garmin's TRIMP.
 *
 * When they disagree badly the honest answer is not the average — it is the
 * larger of the two plus a note, because under-counting load is the failure
 * mode that hurts someone (§21's cold-start warning cuts the same way).
 */
export function crossCheckRunLoad(input: {
  durationMin: number
  srpe?: number | null
  trimp?: number | null
}): LoadEstimate {
  const srpeLoad = input.srpe != null ? sessionLoad(input.durationMin, input.srpe) : null
  const trimpLoad = input.trimp != null ? loadFromTrimp(input.trimp) : null

  if (srpeLoad === null && trimpLoad === null) {
    return {
      load: 0,
      source: 'none',
      confidence: 'low',
      note: 'No sRPE rating and no TRIMP — this session is unpriced.',
    }
  }
  if (trimpLoad === null) {
    return {
      load: srpeLoad as number,
      source: 'srpe',
      confidence: 'moderate',
      note: 'Priced from the sRPE rating alone — no TRIMP to check it against.',
    }
  }
  if (srpeLoad === null) {
    return {
      load: trimpLoad,
      source: 'trimp',
      confidence: 'moderate',
      note: 'Priced from Garmin TRIMP alone — the session was never rated.',
    }
  }

  const spread = Math.abs(srpeLoad - trimpLoad) / Math.max(srpeLoad, trimpLoad, 1)
  if (spread > DISAGREEMENT_THRESHOLD) {
    return {
      load: Math.max(srpeLoad, trimpLoad),
      source: 'blended',
      confidence: 'low',
      note:
        `sRPE (${Math.round(srpeLoad)}) and TRIMP (${Math.round(trimpLoad)}) disagree by ` +
        `${Math.round(spread * 100)}% — taking the higher of the two.`,
    }
  }

  return {
    load: (srpeLoad + trimpLoad) / 2,
    source: 'blended',
    confidence: 'high',
    note: 'sRPE and TRIMP agree — blended.',
  }
}

/**
 * Price a plyo session. The clock under-counts it, so contacts win whenever they
 * are counted (§9).
 */
export function crossCheckPlyoLoad(input: {
  durationMin: number
  srpe?: number | null
  contacts?: number | null
}): LoadEstimate {
  const clockLoad = input.srpe != null ? sessionLoad(input.durationMin, input.srpe) : 0
  const contactLoad = input.contacts != null ? input.contacts * LOAD_PER_CONTACT : 0

  if (contactLoad > 0 && contactLoad >= clockLoad) {
    return {
      load: contactLoad,
      source: 'contacts',
      confidence: 'high',
      note: `${input.contacts} ground contacts — the clock under-prices plyometrics.`,
    }
  }
  if (clockLoad > 0) {
    return {
      load: clockLoad,
      source: 'srpe',
      confidence: contactLoad > 0 ? 'high' : 'moderate',
      note: contactLoad > 0
        ? 'Duration × sRPE exceeds the contact count — using the clock.'
        : 'No contacts counted — priced off the clock.',
    }
  }
  return { load: 0, source: 'none', confidence: 'low', note: 'Nothing to price this against.' }
}

// ── Rolling series ────────────────────────────────────────────────────────────

export interface LoadEntry {
  date: Date
  load: number
}

/**
 * A dense array of daily loads ending on `endDate` (last index = that day).
 * Rest days are real zeros, not gaps — ACWR depends on them being counted.
 */
export function dailyLoadSeries(entries: LoadEntry[], endDate: Date, days: number): number[] {
  const series = new Array(Math.max(0, days)).fill(0) as number[]
  for (const entry of entries) {
    const back = differenceInCalendarDays(endDate, entry.date)
    const index = days - 1 - back
    if (index < 0 || index >= days) continue
    series[index] += entry.load
  }
  return series
}

export type AcwrZone = 'detraining' | 'optimal' | 'caution' | 'danger'

export interface AcwrResult {
  acute: number
  chronic: number
  acwr: number
  daysOfData: number
  confidence: LoadConfidence
  zone: AcwrZone
}

/** 7-day acute over 28-day chronic, both as daily averages (§3). */
export function computeAcwr(dailyLoads: number[]): AcwrResult {
  const days = dailyLoads.length
  if (days === 0) {
    return { acute: 0, chronic: 0, acwr: 1, daysOfData: 0, confidence: 'low', zone: 'optimal' }
  }

  const last7 = dailyLoads.slice(-7)
  const acute = last7.reduce((a, b) => a + b, 0) / last7.length
  const chronic = dailyLoads.reduce((a, b) => a + b, 0) / days
  const acwr = chronic > 0 ? acute / chronic : 1

  const confidence: LoadConfidence = days >= 28 ? 'high' : days >= 14 ? 'moderate' : 'low'

  return {
    acute: Math.round(acute * 10) / 10,
    chronic: Math.round(chronic * 10) / 10,
    acwr: Math.round(acwr * 100) / 100,
    daysOfData: days,
    confidence,
    zone: acwrZone(acwr),
  }
}

export function acwrZone(acwr: number): AcwrZone {
  if (acwr < ACWR_LOWER) return 'detraining'
  if (acwr <= ACWR_UPPER) return 'optimal'
  if (acwr <= ACWR_DANGER) return 'caution'
  return 'danger'
}

/**
 * The band reads in both directions. Under 0.8 is not "safe" — it is fitness
 * leaking away, which is the half of the rule §21's Contrarian says gets
 * ignored.
 */
export function acwrVerdict(
  acwr: number,
  opts: { calibrating?: boolean } = {},
): { zone: AcwrZone; inBand: boolean; cap: number; message: string } {
  const cap = opts.calibrating ? CALIBRATION_ACWR_CAP : ACWR_UPPER
  const zone = acwrZone(acwr)
  const inBand = acwr >= ACWR_LOWER && acwr <= cap
  const shown = acwr.toFixed(2)

  let message: string
  if (acwr < ACWR_LOWER) {
    message = `ACWR ${shown} — below ${ACWR_LOWER.toFixed(2)}. Training is drifting down, not holding.`
  } else if (inBand) {
    message = `ACWR ${shown} — inside the ${ACWR_LOWER.toFixed(2)}–${cap.toFixed(2)} band.`
  } else if (acwr <= ACWR_DANGER) {
    message = `ACWR ${shown} — over the ${cap.toFixed(2)} ceiling. Hold the volume here.`
  } else {
    message = `ACWR ${shown} — well past ${ACWR_DANGER.toFixed(2)}. This is a deload trigger (§17).`
  }

  return { zone, inBand, cap, message }
}

/** Foster's monotony: how same-y the week was. High monotony is its own risk (§17). */
export function weeklyMonotony(weekLoads: number[]): number {
  if (weekLoads.length === 0) return 0
  const mean = weekLoads.reduce((a, b) => a + b, 0) / weekLoads.length
  if (mean === 0) return 0
  const variance =
    weekLoads.reduce((acc, v) => acc + (v - mean) ** 2, 0) / weekLoads.length
  const sd = Math.sqrt(variance)
  if (sd === 0) return MAX_MONOTONY
  return Math.min(MAX_MONOTONY, mean / sd)
}

/** Foster's strain: the week's total, weighted by how unvaried it was. */
export function trainingStrain(weekLoads: number[]): number {
  return weekLoads.reduce((a, b) => a + b, 0) * weeklyMonotony(weekLoads)
}

/** ~10%/week, halved while the anchors are still guesses (§5a, §5b). */
export function weeklyRampCeiling(lastWeekLoad: number, calibrating: boolean): number {
  const cap = calibrating ? CALIBRATION_RAMP_CAP : WEEKLY_RAMP_CAP
  if (!Number.isFinite(lastWeekLoad) || lastWeekLoad <= 0) {
    return calibrating ? COLD_START_WEEKLY * 0.75 : COLD_START_WEEKLY
  }
  return lastWeekLoad * (1 + cap)
}

// ── The daily budget ──────────────────────────────────────────────────────────

export interface BudgetInput {
  /** Daily loads in chronological order, most recent last, **excluding today**. */
  dailyLoads: number[]
  band: ReadinessBand
  calibrating: boolean
  painFlagged?: boolean
  /** Last week's total, when the weekly ramp cap should also bind (§5a). */
  lastWeekLoad?: number
  thisWeekLoadSoFar?: number
}

export interface LoadBudget {
  /** Hard maximum for today's session load. */
  ceiling: number
  /** What the allocator aims to spend — deliberately under the ceiling. */
  target: number
  /** Below this, the week is decaying rather than training (§21). */
  floor: number
  acwr: number
  acwrCap: number
  chronicDailyLoad: number
  band: ReadinessBand
  calibrating: boolean
  /** Machine-readable, human-readable: every number here says where it came from. */
  reasons: string[]
}

/** How much of the raw ceiling each readiness band is allowed to spend (§7). */
const BAND_FACTOR: Record<ReadinessBand, number> = { green: 1, amber: 0.65, red: 0.25 }
const PAIN_FACTOR = 0.7
const TARGET_FRACTION = 0.85

/**
 * Today's spendable load.
 *
 * Derived, not chosen: the ACWR ceiling says the 7-day average may not exceed
 * `cap × chronic`, so today may cost at most `7 × cap × chronic` minus what the
 * previous six days already spent. Readiness then scales that down, and the
 * weekly ramp can bind before either of them does.
 */
export function computeDailyBudget(input: BudgetInput): LoadBudget {
  const loads = input.dailyLoads ?? []
  const reasons: string[] = []

  const chronic = loads.length > 0 ? loads.reduce((a, b) => a + b, 0) / loads.length : 0
  const lastSix = loads.slice(-6).reduce((a, b) => a + b, 0)
  const acwrCap = input.calibrating ? CALIBRATION_ACWR_CAP : ACWR_UPPER
  const acwr = computeAcwr(loads).acwr

  let ceiling: number
  if (chronic <= 0) {
    ceiling = input.calibrating ? COLD_START_CEILING * 0.75 : COLD_START_CEILING
    reasons.push('No history yet — cold start, deliberately small (§5b).')
  } else {
    const acwrHeadroom = 7 * acwrCap * chronic - lastSix
    const dayCap = chronic * MAX_DAY_MULTIPLE
    ceiling = Math.max(0, Math.min(acwrHeadroom, dayCap))
    reasons.push(
      `ACWR cap ${acwrCap.toFixed(2)} on a ${Math.round(chronic)}/day chronic load leaves ` +
        `${Math.round(Math.max(0, acwrHeadroom))} after the last six days.`,
    )
    if (dayCap < acwrHeadroom) {
      reasons.push(`Held to ${MAX_DAY_MULTIPLE}× the chronic day — no single session runs away with the week.`)
    }
  }

  if (input.calibrating) {
    reasons.push('Still calibrating — the tighter ACWR cap and ramp apply (§5b).')
  }

  const bandFactor = BAND_FACTOR[input.band]
  if (bandFactor < 1) {
    ceiling *= bandFactor
    reasons.push(`Readiness is ${input.band} — ${Math.round((1 - bandFactor) * 100)}% off the ceiling (§7).`)
  }

  if (input.painFlagged) {
    ceiling *= PAIN_FACTOR
    reasons.push('A niggle is logged — load capped on top of the readiness cut (§9).')
  }

  if (input.lastWeekLoad !== undefined) {
    const weekCeiling = weeklyRampCeiling(input.lastWeekLoad, input.calibrating)
    const remaining = Math.max(0, weekCeiling - (input.thisWeekLoadSoFar ?? 0))
    if (remaining < ceiling) {
      ceiling = remaining
      reasons.push(
        `The weekly ramp cap binds first — ${Math.round(remaining)} left of this week's ` +
          `${Math.round(weekCeiling)} (§5a).`,
      )
    }
  }

  // The floor is what keeps ACWR from sagging under 0.8, capped at one average
  // day so it stays a nudge rather than a demand.
  let floor = 0
  if (input.band !== 'red' && chronic > 0) {
    floor = Math.max(0, Math.min(7 * ACWR_LOWER * chronic - lastSix, chronic))
    if (floor > 0) {
      reasons.push(`At least ${Math.round(floor)} today keeps ACWR off the detraining side of the band.`)
    }
  }
  floor = Math.min(floor, ceiling)

  return {
    ceiling: Math.round(ceiling * 10) / 10,
    target: Math.round(ceiling * TARGET_FRACTION * 10) / 10,
    floor: Math.round(floor * 10) / 10,
    acwr,
    acwrCap,
    chronicDailyLoad: Math.round(chronic * 10) / 10,
    band: input.band,
    calibrating: input.calibrating,
    reasons,
  }
}

// ── Costing a Session item ────────────────────────────────────────────────────
// The engines know what their own work costs and should say so. This is the
// fallback that lets the allocator and the edit validator price any item they
// are handed, including one a human typed in by hand.

/** Seconds a working rep takes, concentric plus eccentric plus the turnaround. */
const SEC_PER_REP = 3
const DEFAULT_REST_SEC = 90
const SEC_PER_CONTACT = 2
const HOLD_REST_SEC = 30

/** RIR maps onto effort: RIR 2 is a 7, RIR 0 is a 9 (§8 autoregulation). */
function srpeFromRir(targetRir: number): number {
  return Math.min(9, Math.max(3, 9 - targetRir))
}

function runDurationMin(params: Extract<ItemParams, { kind: 'run' }>): number {
  if (params.durationMin != null && params.durationMin > 0) return params.durationMin
  if (params.intervals && params.intervals.length > 0) {
    const sec = params.intervals.reduce(
      (acc, i) => acc + i.repeat * (i.workSec + i.recoverSec),
      0,
    )
    return sec / 60
  }
  if (params.distanceKm != null && params.targetPaceSecPerKm != null) {
    return (params.distanceKm * params.targetPaceSecPerKm) / 60
  }
  return 0
}

export interface CostOptions {
  /** An engine-supplied sRPE, which always beats the estimate. */
  srpe?: number
}

export function estimateItemCost(item: SessionItem, opts: CostOptions = {}): LoadCost {
  const p = item.params

  if (p.kind === 'strength') {
    const workSec = p.sets * p.reps * SEC_PER_REP
    const restSec = p.sets * (p.restSec ?? DEFAULT_REST_SEC)
    const durationMin = (workSec + restSec) / 60
    // Bodyweight accessory work is hard on the muscle and cheap on the system.
    const base = srpeFromRir(p.targetRir)
    const srpe = opts.srpe ?? (p.weightKg === null ? Math.min(base, 5) : base)
    return { durationMin, srpe, load: sessionLoad(durationMin, srpe), hardness: clampSrpe(srpe) }
  }

  if (p.kind === 'run') {
    const durationMin = runDurationMin(p)
    const def = (RUN_TYPES as Record<string, { intensityCost: number } | undefined>)[p.runType]
    const srpe = opts.srpe ?? def?.intensityCost ?? 5
    return { durationMin, srpe, load: sessionLoad(durationMin, srpe), hardness: clampSrpe(srpe) }
  }

  if (p.kind === 'contacts') {
    const contacts = p.sets * p.contactsPerSet
    const workSec = contacts * SEC_PER_CONTACT
    const restSec = p.sets * (p.restSec ?? 60)
    const durationMin = (workSec + restSec) / 60
    const srpe = opts.srpe ?? 6
    const priced = crossCheckPlyoLoad({ durationMin, srpe, contacts })
    return { durationMin, srpe, load: priced.load, hardness: clampSrpe(srpe), contacts }
  }

  // Holds: prehab and stretching. Near-free by design (§9) — the point is that
  // the allocator can always afford them.
  const perSide = p.perSide ? 2 : 1
  const reps = p.reps ?? 1
  const holdSec = p.holdSec ?? SEC_PER_REP
  const perSetSec = reps * (holdSec + 2) * perSide
  const durationMin = (p.sets * (perSetSec + HOLD_REST_SEC)) / 60
  const srpe = opts.srpe ?? 2
  return { durationMin, srpe, load: sessionLoad(durationMin, srpe), hardness: clampSrpe(srpe) }
}

/** What a whole session costs. Hardness is the peak, not the sum. */
export function sessionCost(blocks: SessionBlock[], costOf = estimateItemCost): LoadCost {
  let durationMin = 0
  let load = 0
  let hardness = 0
  let contacts = 0

  for (const block of blocks) {
    for (const item of block.items) {
      const cost = costOf(item)
      durationMin += cost.durationMin
      load += cost.load
      hardness = Math.max(hardness, cost.hardness)
      contacts += cost.contacts ?? 0
    }
  }

  return {
    durationMin,
    srpe: durationMin > 0 ? load / durationMin : 0,
    load,
    hardness,
    ...(contacts > 0 ? { contacts } : {}),
  }
}

// ── Trimming ──────────────────────────────────────────────────────────────────

/**
 * Shrink an item to fit a budget. Trimming beats deleting: a 25-minute easy run
 * still banks aerobic work, and the athlete still gets to do the thing they were
 * expecting. Returns null when there is nothing to trim.
 */
export function scaleItem(item: SessionItem, factor: number): SessionItem | null {
  if (!Number.isFinite(factor) || factor >= 1 || factor <= 0) return null
  const p = item.params

  let params: ItemParams
  if (p.kind === 'strength') {
    const sets = Math.max(1, Math.round(p.sets * factor))
    if (sets === p.sets) return null
    params = { ...p, sets }
  } else if (p.kind === 'run') {
    const durationMin =
      p.durationMin != null ? Math.max(1, Math.round(p.durationMin * factor)) : p.durationMin
    const intervals = p.intervals?.map((i) => ({
      ...i,
      repeat: Math.max(1, Math.round(i.repeat * factor)),
    }))
    const distanceKm =
      p.distanceKm != null ? Math.round(p.distanceKm * factor * 100) / 100 : p.distanceKm
    if (durationMin === p.durationMin && distanceKm === p.distanceKm && !intervals) return null
    params = { ...p, durationMin, distanceKm, ...(intervals ? { intervals } : {}) }
  } else if (p.kind === 'contacts') {
    const sets = Math.max(1, Math.round(p.sets * factor))
    if (sets === p.sets) return null
    params = { ...p, sets }
  } else {
    const sets = Math.max(1, Math.round(p.sets * factor))
    if (sets === p.sets) return null
    params = { ...p, sets }
  }

  return { ...item, params, status: 'edited' }
}
