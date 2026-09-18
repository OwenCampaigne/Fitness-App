// ── Personal records ──────────────────────────────────────────────────────────
// Dated bests, and how much today's prescription is allowed to believe them.
//
// The framework's §3 rule — every derived training number carries `value`,
// `source` and `confidence` — has a hole in it for records. An anchor is a
// belief about *now*, refreshed by the last few sessions. A record is a belief
// about *one day in the past*, and nothing refreshes it. Treated as current it
// flatters: a 5k from two winters ago is a memory, not evidence of this
// morning's fitness. So every record here carries `achievedOn`, and
// `recordCurrency` turns that date into a confidence that decays.
//
// Detection follows the same posture the rest of the codebase holds (§5b, §21
// Contrarian): a record is only claimed where the evidence for it actually
// exists. `splits.ts` refuses to compute decoupling off an interval session
// rather than returning a confident-looking number; this module refuses to
// mine a 5k out of a long run for the same reason. Every refusal is returned,
// not swallowed, so the page can say what it declined to count.
//
// Pure and Prisma-free — the DB reads and writes live in `recordsStore.ts`.

import { startOfWeek, subDays } from 'date-fns'
import { completedSets, estimateE1RM, meanRir, topWeight } from './strengthEngine'
import { formatPace, paceSecPerKm } from './runAnalysis'
import { computeAcwr } from './load'
import { weeklyVolume } from './trends'
import type { RunActivityRow } from '../types/run'
import type { ExerciseSessionHistory, LoggedSet } from '../types/strength'

const DAY_MS = 86_400_000

function round(value: number, places = 1): number {
  const f = 10 ** places
  return Math.round(value * f) / f
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS))
}

function isRun(row: { type: string }): boolean {
  return row.type.toLowerCase().includes('run')
}

// ── What a record is ──────────────────────────────────────────────────────────

/**
 * `kind` is the *metric*, not the modality, because that is the granularity
 * supersession works at: a new squat e1RM supersedes the old squat e1RM and
 * nothing else. `recordFamily` recovers lift-vs-run for the UI.
 */
export type RecordKind =
  | 'lift_heaviest'
  | 'lift_e1rm'
  | 'lift_volume'
  | 'run_distance'
  | 'run_longest'
  | 'run_pace_at_hr'

export type RecordFamily = 'lift' | 'run'

export type RecordUnit = 'kg' | 'kg_reps' | 'km' | 'sec_per_km'

/** Where the number came from. Only `logged` ever earns `verified`. */
export type RecordSource = 'logged' | 'stated'

export function recordFamily(kind: RecordKind): RecordFamily {
  return kind.startsWith('lift_') ? 'lift' : 'run'
}

export interface DetectedRecord {
  kind: RecordKind
  /** Which subject the record belongs to: an exerciseId, or a distance key. */
  subjectId: string
  label: string
  value: number
  unit: RecordUnit
  reps: number | null
  achievedOn: Date
  source: RecordSource
  sessionId: number | null
  /**
   * True only when a real logged set or a recorded activity produced it. A
   * number the athlete stated at onboarding is a claim, and the difference
   * between a claim and a measurement is the whole point of §5b.
   */
  verified: boolean
  /** One sentence naming the evidence. Stored in `personal_records.notes`. */
  notes: string
}

/** A best the data hinted at and this module declined to call a record. */
export interface RecordRefusal {
  kind: RecordKind
  subjectId: string
  reason: string
}

export interface RecordDetection {
  records: DetectedRecord[]
  refusals: RecordRefusal[]
}

export function formatRecordValue(unit: RecordUnit, value: number, reps: number | null): string {
  switch (unit) {
    case 'kg':
      return reps ? `${round(value, 1)} kg × ${reps}` : `${round(value, 1)} kg`
    case 'kg_reps':
      return `${Math.round(value)} kg·reps`
    case 'km':
      return `${round(value, 2)} km`
    case 'sec_per_km':
      return formatPace(Math.round(value))
  }
}

// ── Lift records ──────────────────────────────────────────────────────────────

/**
 * Three bests per lift, because they answer different questions and can sit on
 * different days: the heaviest load actually moved, the best estimated 1RM
 * (which a lighter set taken closer to failure can win), and the best
 * volume-load in one session.
 *
 * A stated number never gets `verified`. Neither does an e1RM extrapolated
 * from a set so far from failure that the formula is guessing — `estimateE1RM`
 * already grades itself, and `low` confidence is passed through rather than
 * rounded away.
 */
export interface StatedLiftRecord {
  exerciseId: string
  label: string
  weightKg: number
  /** When the athlete said it — onboarding day, not an achievement date. */
  statedOn: Date
  reps?: number | null
}

export interface LiftRecordOptions {
  /** Display names, usually KEY_LIFTS_BY_ID. Falls back to the raw id. */
  labelOf?: (exerciseId: string) => string
  /** Working loads the athlete typed at intake (§5a), never measured. */
  stated?: StatedLiftRecord[]
}

function setsWithLoad(sets: LoggedSet[]): LoggedSet[] {
  return completedSets(sets).filter((s) => s.weightKg !== null && (s.weightKg as number) > 0)
}

export function detectLiftRecords(
  histories: ExerciseSessionHistory[],
  opts: LiftRecordOptions = {},
): RecordDetection {
  const labelOf = opts.labelOf ?? ((id: string) => id)
  const records: DetectedRecord[] = []
  const refusals: RecordRefusal[] = []

  const byExercise = new Map<string, ExerciseSessionHistory[]>()
  for (const history of histories) {
    const list = byExercise.get(history.exerciseId) ?? []
    list.push(history)
    byExercise.set(history.exerciseId, list)
  }

  for (const [exerciseId, sessions] of Array.from(byExercise.entries())) {
    const label = labelOf(exerciseId)
    const ordered = [...sessions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    )

    let heaviest: DetectedRecord | null = null
    let bestE1rm: DetectedRecord | null = null
    let bestVolume: DetectedRecord | null = null
    let bodyweightSessions = 0

    for (const session of ordered) {
      const loaded = setsWithLoad(session.sets)
      if (loaded.length === 0) {
        if (completedSets(session.sets).length > 0) bodyweightSessions += 1
        continue
      }
      const date = new Date(session.date)

      // ── Heaviest load moved, and the reps it was moved for ──────────────────
      const top = topWeight(loaded) as number
      const topSet = loaded.find((s) => s.weightKg === top) as LoggedSet
      const topReps = topSet.reps as number
      // Rows are oldest first, so `>=` lets a later session win an exact tie —
      // the same best, more recently, is a more current record.
      if (!heaviest || top > heaviest.value || (top === heaviest.value && topReps >= (heaviest.reps ?? 0))) {
        heaviest = {
          kind: 'lift_heaviest',
          subjectId: exerciseId,
          label,
          value: top,
          unit: 'kg',
          reps: topReps,
          achievedOn: date,
          source: 'logged',
          sessionId: session.sessionId,
          verified: true,
          notes: `${top} kg × ${topReps} reps, logged set${
            topSet.rir === null || topSet.rir === undefined ? ' (RIR not recorded)' : ` at RIR ${topSet.rir}`
          }.`,
        }
      }

      // ── Estimated 1RM, from submaximal work only (§5a — no max testing) ─────
      for (const set of loaded) {
        const rir = set.rir ?? 0
        const estimate = estimateE1RM(set.weightKg as number, set.reps as number, rir)
        if (bestE1rm && estimate.value < bestE1rm.value) continue
        const thin = estimate.confidence === 'low'
        bestE1rm = {
          kind: 'lift_e1rm',
          subjectId: exerciseId,
          label,
          value: estimate.value,
          unit: 'kg',
          reps: null,
          achievedOn: date,
          source: 'logged',
          sessionId: session.sessionId,
          // An Epley extrapolation from 15+ effective reps is arithmetic, not a
          // measurement. It still gets recorded; it does not get called proven.
          verified: !thin,
          notes: `Epley from ${set.weightKg} kg × ${set.reps} at RIR ${rir} (${estimate.effectiveReps} effective reps, ${estimate.confidence} confidence)${
            set.rir === null || set.rir === undefined ? '. RIR was not logged, so 0 was assumed — this under-states rather than flatters.' : '.'
          }`,
        }
      }

      // ── Best volume-load in one session ─────────────────────────────────────
      const volume = loaded.reduce((sum, s) => sum + (s.weightKg as number) * (s.reps as number), 0)
      if (!bestVolume || volume >= bestVolume.value) {
        const rir = meanRir(loaded)
        bestVolume = {
          kind: 'lift_volume',
          subjectId: exerciseId,
          label,
          value: Math.round(volume),
          unit: 'kg_reps',
          reps: null,
          achievedOn: date,
          source: 'logged',
          sessionId: session.sessionId,
          verified: true,
          notes: `${loaded.length} working sets totalling ${Math.round(volume)} kg·reps${
            rir === null ? '' : `, mean RIR ${round(rir, 1)}`
          }.`,
        }
      }
    }

    // One refusal per lift, after the winner is settled — an intermediate set
    // that lost is not worth a sentence on the page.
    if (bestE1rm && !bestE1rm.verified) {
      refusals.push({
        kind: 'lift_e1rm',
        subjectId: exerciseId,
        reason: `The best ${label} 1RM estimate comes from a set more than about 12 effective reps from failure, where Epley and Brzycki both drift. It is shown as an estimate, not a verified record.`,
      })
    }

    if (!heaviest && bodyweightSessions > 0) {
      refusals.push({
        kind: 'lift_heaviest',
        subjectId: exerciseId,
        reason: `${label} has ${bodyweightSessions} logged session(s) but no external load, so there is no weight record to hold. Bodyweight work progresses by reps (§8).`,
      })
    }

    for (const record of [heaviest, bestE1rm, bestVolume]) {
      if (record) records.push(record)
    }
  }

  // ── Stated intake numbers ───────────────────────────────────────────────────
  // Recorded so the page can show them side by side with measurements and
  // label which is which. A stated number that a logged set has already beaten
  // is noise, so it is dropped rather than shown as a competing record.
  for (const stated of opts.stated ?? []) {
    const logged = records.find(
      (r) => r.kind === 'lift_heaviest' && r.subjectId === stated.exerciseId,
    )
    if (logged && logged.value >= stated.weightKg) {
      refusals.push({
        kind: 'lift_heaviest',
        subjectId: stated.exerciseId,
        reason: `The ${stated.label} working load stated at intake (${stated.weightKg} kg) has been met or beaten by a logged set, so the logged set is the record.`,
      })
      continue
    }
    records.push({
      kind: 'lift_heaviest',
      subjectId: stated.exerciseId,
      label: stated.label,
      value: stated.weightKg,
      unit: 'kg',
      reps: stated.reps ?? null,
      achievedOn: stated.statedOn,
      source: 'stated',
      sessionId: null,
      verified: false,
      notes:
        'Stated at onboarding, never logged. Treated as a claim, not a measurement — one logged set replaces it (§5a).',
    })
  }

  return { records, refusals }
}

// ── Run records ───────────────────────────────────────────────────────────────

export interface RunDistanceTarget {
  key: string
  label: string
  km: number
}

export const RUN_DISTANCES: RunDistanceTarget[] = [
  { key: '1k', label: '1 km', km: 1 },
  { key: '5k', label: '5 km', km: 5 },
  { key: '10k', label: '10 km', km: 10 },
]

export interface RunRecordOptions {
  /**
   * How much longer than the target the activity may be and still count as an
   * effort *at* that distance. 2% of a 5k is 100 m — a start-line overshoot,
   * not a different session.
   */
  distanceTolerance?: number
  /** Reference HR for the pace-at-matched-HR record; usually the Z2 ceiling. */
  matchHr?: number | null
  /** Half-width of the matched HR band, in bpm. Mirrors `paceAtFixedHr`. */
  hrBandWidth?: number
  /** Below this a run is a shakeout, not evidence about aerobic fitness. */
  minMatchedDurationMin?: number
}

/**
 * Bests from `activities`, gated on what a training run can actually prove.
 *
 * The temptation is to scan every long run for its fastest contiguous 5 km and
 * call that a 5k PR. It is not one: a 5k *effort* is a run held at 5k effort to
 * the line, and the fastest window inside a steady 20 km is a pace the athlete
 * chose not to hold. Same family of error `computeDecoupling` refuses to make.
 * So a distance record needs a run that *was* that distance, and everything the
 * scan would have found is returned as a refusal instead.
 */
export function detectRunRecords(
  activities: RunActivityRow[],
  opts: RunRecordOptions = {},
): RecordDetection {
  const tolerance = opts.distanceTolerance ?? 0.02
  const bandWidth = opts.hrBandWidth ?? 8
  const minMatchedMin = opts.minMatchedDurationMin ?? 20

  const runs = activities
    .filter(isRun)
    .filter((r) => (r.distanceKm ?? 0) > 0 && (r.durationMin ?? 0) > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  const records: DetectedRecord[] = []
  const refusals: RecordRefusal[] = []

  // ── Fastest at a distance ───────────────────────────────────────────────────
  for (const target of RUN_DISTANCES) {
    const ceiling = target.km * (1 + tolerance)
    const efforts = runs.filter(
      (r) => (r.distanceKm as number) >= target.km && (r.distanceKm as number) <= ceiling,
    )
    const longer = runs.filter((r) => (r.distanceKm as number) > ceiling).length

    if (efforts.length === 0) {
      refusals.push({
        kind: 'run_distance',
        subjectId: target.key,
        reason:
          longer > 0
            ? `No run covered ${target.label} and stopped there. ${longer} run(s) went further, but the fastest ${target.label} inside a longer run is a pace that was chosen not to be held to the line — it is not a ${target.label} record.`
            : `No run has covered ${target.label} yet, so there is nothing to record.`,
      })
      continue
    }

    let best = efforts[0]
    let bestPace = paceSecPerKm(best) as number
    for (const run of efforts.slice(1)) {
      const pace = paceSecPerKm(run) as number
      if (pace <= bestPace) {
        best = run
        bestPace = pace
      }
    }

    const distance = best.distanceKm as number
    const minutes = best.durationMin as number
    const exact = distance <= target.km * 1.005
    records.push({
      kind: 'run_distance',
      subjectId: target.key,
      label: `Fastest ${target.label}`,
      // Pace, not elapsed time: a 5.08 km run's elapsed time is not a 5 km time,
      // and scaling it down to one would be inventing the last 80 metres.
      value: bestPace,
      unit: 'sec_per_km',
      reps: null,
      achievedOn: best.date,
      source: 'logged',
      sessionId: null,
      verified: true,
      notes: `${round(distance, 2)} km in ${Math.round(minutes)} min${
        exact ? '' : ` — ${Math.round((distance - target.km) * 1000)} m over the distance, so the record is the pace held, not an elapsed ${target.label} time`
      }.${efforts.length === 1 ? ' One qualifying effort so far, so this is a starting point rather than a ceiling.' : ` Best of ${efforts.length} qualifying efforts.`}`,
    })

    if (longer > 0) {
      refusals.push({
        kind: 'run_distance',
        subjectId: target.key,
        reason: `${longer} run(s) went past ${target.label}; their fastest internal splits were not counted, because a segment inside a longer run is not an effort at the distance.`,
      })
    }
  }

  // ── Longest run ─────────────────────────────────────────────────────────────
  if (runs.length > 0) {
    const longest = runs.reduce((a, b) => ((b.distanceKm as number) >= (a.distanceKm as number) ? b : a))
    records.push({
      kind: 'run_longest',
      subjectId: 'longest',
      label: 'Longest run',
      value: round(longest.distanceKm as number, 2),
      unit: 'km',
      reps: null,
      achievedOn: longest.date,
      source: 'logged',
      sessionId: null,
      verified: true,
      notes: `${round(longest.distanceKm as number, 2)} km in ${Math.round(longest.durationMin as number)} min${
        longest.avgHr ? ` at ${Math.round(longest.avgHr)} bpm average` : ', no heart rate recorded'
      }.`,
    })
  }

  // ── Best pace at a matched heart rate ───────────────────────────────────────
  // The one record that is about the engine rather than the day. It only means
  // something against a fixed heart rate, so without a reference HR there is no
  // record to hold — the same refusal `buildPaceAnchorArc` makes.
  const matchHr = opts.matchHr ?? null
  if (!matchHr) {
    refusals.push({
      kind: 'run_pace_at_hr',
      subjectId: 'z2',
      reason:
        'No Zone 2 ceiling established, so there is no heart rate to match runs against. Pace alone says nothing about fitness without the cost of it.',
    })
  } else {
    const low = matchHr - bandWidth
    const high = matchHr + bandWidth
    const matched = runs.filter(
      (r) =>
        r.avgHr !== null &&
        r.avgHr >= low &&
        r.avgHr <= high &&
        (r.durationMin as number) >= minMatchedMin,
    )

    if (matched.length === 0) {
      refusals.push({
        kind: 'run_pace_at_hr',
        subjectId: 'z2',
        reason: `No run of at least ${minMatchedMin} min averaged between ${low} and ${high} bpm, so there is no matched-effort pace to record.`,
      })
    } else {
      let best = matched[0]
      let bestPace = paceSecPerKm(best) as number
      for (const run of matched.slice(1)) {
        const pace = paceSecPerKm(run) as number
        if (pace <= bestPace) {
          best = run
          bestPace = pace
        }
      }
      records.push({
        kind: 'run_pace_at_hr',
        subjectId: 'z2',
        label: `Best pace at ${matchHr} bpm`,
        value: bestPace,
        unit: 'sec_per_km',
        reps: null,
        achievedOn: best.date,
        source: 'logged',
        sessionId: null,
        // One matched run is a data point. The record is real, but calling a
        // single run proof of aerobic fitness is the flattery this file exists
        // to avoid, so it is labelled unverified until there are three.
        verified: matched.length >= 3,
        notes: `${round(best.distanceKm as number, 2)} km at ${formatPace(bestPace)}, averaging ${Math.round(best.avgHr as number)} bpm. ${
          matched.length >= 3
            ? `Best of ${matched.length} matched runs.`
            : `Only ${matched.length} matched run(s) so far — not enough to separate a good day from a fitness change.`
        }`,
      })
    }
  }

  return { records, refusals }
}

// ── Age-aware currency ────────────────────────────────────────────────────────
// The requirement the whole file exists for. A record is evidence about the day
// it was set, and the further that day recedes the less it says about today.
// The engines must be able to discount rather than choose between "current" and
// "ignore", so this returns a continuous confidence.
//
// Exponential decay with a per-metric half-life, because the underlying
// qualities detrain at genuinely different rates: maximal strength holds for
// months, pace at a fixed heart rate moves within weeks. These are the
// calibration knobs — tune them against real data, do not bury them in a curve.

export const RECORD_HALF_LIFE_DAYS: Record<RecordKind, number> = {
  lift_heaviest: 120,
  lift_e1rm: 120,
  lift_volume: 90,
  run_distance: 180,
  run_longest: 120,
  // Aerobic economy is the most volatile of the lot and the most trainable in
  // both directions, so it is the fastest to stop being evidence.
  run_pace_at_hr: 60,
}

/** A number the athlete only ever claimed never gets full weight, however fresh. */
export const STATED_CONFIDENCE_CEILING = 0.5

export type RecordBand = 'current' | 'aging' | 'stale' | 'historical'

export interface RecordCurrency {
  ageDays: number
  /** 0–1. What share of this record the engines may treat as today's ability. */
  confidence: number
  band: RecordBand
  halfLifeDays: number
  /** Plain-language statement of how much this record still proves. */
  note: string
}

/**
 * Below this a record has decayed past the point of being an input at all.
 * `temperedTarget` hands back the conservative fallback untouched rather than
 * letting a two-year-old best nudge today's prescription by a token amount.
 */
export const CURRENCY_FLOOR = 0.3

export function recordBand(confidence: number): RecordBand {
  if (confidence >= 0.85) return 'current'
  if (confidence >= 0.6) return 'aging'
  if (confidence >= CURRENCY_FLOOR) return 'stale'
  return 'historical'
}

export function describeAge(ageDays: number): string {
  if (ageDays === 0) return 'today'
  if (ageDays === 1) return 'yesterday'
  if (ageDays < 14) return `${ageDays} days ago`
  if (ageDays < 70) return `${Math.round(ageDays / 7)} weeks ago`
  if (ageDays < 730) return `${Math.round(ageDays / 30)} months ago`
  return `${round(ageDays / 365, 1)} years ago`
}

export function recordCurrency(
  record: Pick<DetectedRecord, 'kind' | 'achievedOn' | 'verified' | 'source'>,
  today: Date = new Date(),
): RecordCurrency {
  const halfLifeDays = RECORD_HALF_LIFE_DAYS[record.kind]
  const ageDays = daysBetween(new Date(record.achievedOn), today)

  let confidence = 2 ** (-ageDays / halfLifeDays)
  if (record.source === 'stated' || !record.verified) {
    confidence = Math.min(confidence, STATED_CONFIDENCE_CEILING)
  }
  confidence = round(confidence, 3)

  const band = recordBand(confidence)
  const when = describeAge(ageDays)

  let note: string
  if (record.source === 'stated') {
    note = `Stated ${when} and never logged, so it is capped at ${Math.round(
      STATED_CONFIDENCE_CEILING * 100,
    )}% however recent it is. One logged set replaces it.`
  } else if (!record.verified) {
    note = `Set ${when}, but the evidence behind it is thin, so it is capped at ${Math.round(
      STATED_CONFIDENCE_CEILING * 100,
    )}%. It informs targets weakly.`
  } else {
    switch (band) {
      case 'current':
        note = `Set ${when}. Recent enough to prescribe from directly.`
        break
      case 'aging':
        note = `Set ${when}. Still informative, but the target is held back toward what recent training supports.`
        break
      case 'stale':
        note = `Set ${when}. Too old to prescribe from — it shapes the target slightly and nothing more.`
        break
      default:
        note = `Set ${when}. This is history, not current fitness. Nothing today is planned from it.`
    }
  }

  return { ageDays, confidence, band, halfLifeDays, note }
}

// ── The helper the engines consult ────────────────────────────────────────────

export interface TemperedTarget {
  /** What to actually prescribe from. */
  value: number
  /** How far toward the record the target was allowed to move, 0–1. */
  weight: number
  currency: RecordCurrency
  /** True when the record was too old to move the target at all. */
  usedFallbackOnly: boolean
  note: string
}

/**
 * Blend a dated record toward a conservative fallback by its own currency.
 *
 * `fallback` is whatever the engine would prescribe knowing only recent work —
 * the current working-load anchor for a lift, the observed easy pace for a run.
 * A record set yesterday pulls the target all the way onto itself; one from
 * last spring barely moves it; one past `CURRENCY_FLOOR` does not move it at
 * all. Linear interpolation works in both directions, so a pace record (lower
 * is better) needs no special case.
 *
 * Intentionally *not* wired into `strengthEngine` or `runEngine` here. Those
 * modules own the anchors that recent training already keeps honest; a record
 * is an additional, older input and giving it a vote is a coaching decision,
 * not a refactor. See the note in the build report.
 */
export function temperedTarget(
  record: Pick<DetectedRecord, 'kind' | 'value' | 'achievedOn' | 'verified' | 'source'>,
  fallback: number,
  today: Date = new Date(),
): TemperedTarget {
  const currency = recordCurrency(record, today)

  if (currency.confidence < CURRENCY_FLOOR) {
    return {
      value: fallback,
      weight: 0,
      currency,
      usedFallbackOnly: true,
      note: `${currency.note} Target left at what recent training supports.`,
    }
  }

  const weight = currency.confidence
  const value = round(fallback + (record.value - fallback) * weight, 2)

  return {
    value,
    weight,
    currency,
    usedFallbackOnly: false,
    note: `${currency.note} Target moved ${Math.round(weight * 100)}% of the way from recent work toward the record.`,
  }
}

// ── Supersession ──────────────────────────────────────────────────────────────

/**
 * A record that is beaten is not overwritten — it is superseded, and the old
 * row keeps its date. That is the difference between "your squat PR is 100 kg"
 * and "you went 90 in March, 95 in June, 100 last week", and the second is the
 * one that tells you whether anything is happening.
 */
export interface StoredRecord {
  id: number
  kind: RecordKind
  subjectId: string
  value: number
  achievedOn: Date
  source: RecordSource
  supersededById: number | null
}

export interface RecordDiff {
  /** New rows to write. */
  insert: DetectedRecord[]
  /** Existing row ids that the matching insert supersedes, in the same order. */
  supersedes: Array<number | null>
  /** Detected records that matched what is already stored. */
  unchanged: DetectedRecord[]
}

function betterThan(kind: RecordKind, candidate: number, current: number): boolean {
  // Pace is the only metric where smaller wins.
  return kind === 'run_distance' || kind === 'run_pace_at_hr'
    ? candidate < current
    : candidate > current
}

/**
 * What changed since the last detection run.
 *
 * Re-running detection over unchanged data must produce an empty `insert` —
 * otherwise every page load would stack a duplicate row and the supersession
 * chain would become a log of nothing happening.
 */
export function diffRecords(detected: DetectedRecord[], stored: StoredRecord[]): RecordDiff {
  const current = new Map<string, StoredRecord>()
  for (const row of stored) {
    if (row.supersededById !== null) continue
    current.set(`${row.kind}:${row.subjectId}`, row)
  }

  const insert: DetectedRecord[] = []
  const supersedes: Array<number | null> = []
  const unchanged: DetectedRecord[] = []

  for (const record of detected) {
    const key = `${record.kind}:${record.subjectId}`
    const existing = current.get(key)

    if (!existing) {
      insert.push(record)
      supersedes.push(null)
      continue
    }

    const sameDay = daysBetween(new Date(existing.achievedOn), new Date(record.achievedOn)) === 0
    if (existing.value === record.value && sameDay && existing.source === record.source) {
      unchanged.push(record)
      continue
    }

    // A logged set always replaces a stated claim, even when the number is no
    // higher — a measurement beats an assertion regardless of which is larger.
    const upgrade = existing.source === 'stated' && record.source === 'logged'
    if (!upgrade && !betterThan(record.kind, record.value, existing.value)) {
      unchanged.push(record)
      continue
    }

    insert.push(record)
    supersedes.push(existing.id)
  }

  return { insert, supersedes, unchanged }
}

// ── Weekly history ────────────────────────────────────────────────────────────
// A closed week rolled into one row. The row is a *cache*: every field is
// recomputed from `activities`, `session` and `set_logs` on every run, and the
// write is an upsert keyed on `weekStart`. Nothing is ever incremented, so
// running the rollup twice produces the same row — which is the only reason it
// is safe to trigger it from a page load.

export interface WeekSetRow {
  date: Date
  itemKind: string
  reps: number | null
  contacts: number | null
}

export interface WeekSessionRow {
  date: Date
  status: string
}

export interface WeekRollupInput {
  /** Monday of the week being rolled up. */
  weekStart: Date
  activities: RunActivityRow[]
  sessions: WeekSessionRow[]
  setLogs: WeekSetRow[]
  /**
   * 28 daily loads ending on the week's Sunday, from `summarizeDailyLoads`.
   * Passed in rather than recomputed so the week summary and the ACWR the
   * allocator runs on can never disagree.
   */
  dailyLoads: number[]
  srpe?: (avgHr: number) => number
}

export interface WeekSummaryRecord {
  weekStart: Date
  weekEnd: Date
  totalLoad: number
  runKm: number
  runMinutes: number
  runs: number
  strengthSets: number
  plyoContacts: number
  sessionsPlanned: number
  sessionsDone: number
  acwrEnd: number | null
  summaryJson: string
}

export function weekStartOf(date: Date): Date {
  return startOfDay(startOfWeek(date, { weekStartsOn: 1 }))
}

function inWeek(date: Date, start: Date, end: Date): boolean {
  const t = startOfDay(date).getTime()
  return t >= start.getTime() && t <= end.getTime()
}

/**
 * Roll one closed week up, deriving every number from the source rows.
 *
 * Volume comes from `weeklyVolume` in `trends.ts` rather than a second summing
 * loop, so the history page and the review page cannot drift apart: if the
 * review says 42 km, the stored week says 42 km, because it is the same
 * function.
 */
export function rollUpWeek(input: WeekRollupInput): WeekSummaryRecord {
  const weekStart = weekStartOf(input.weekStart)
  const weekEnd = startOfDay(new Date(weekStart.getTime() + 6 * DAY_MS))

  const volume = weeklyVolume(input.activities, {
    weeks: 1,
    today: weekEnd,
    srpe: input.srpe,
  })[0]

  const last7 = input.dailyLoads.slice(-7)
  const storedLoad = last7.reduce((a, b) => a + b, 0)

  // Two views of the same week's cost: `dailyLoads` is what the allocator
  // banked (stored session load, or TRIMP), `volume.load` is duration × sRPE
  // derived from the runs themselves. They overlap — a prescribed run that
  // happened is both — so they are *maxed*, never summed, exactly as
  // `summarizeDailyLoads` maxes sessions against activities. Maxing also stops
  // a week of runs that arrived without TRIMP from being filed as zero load
  // while the review page shows it as a full week (§3).
  const totalLoad = Math.round(Math.max(storedLoad, volume.load))

  const chronic = input.dailyLoads.reduce((a, b) => a + b, 0)
  // An ACWR off a chronic window of zero is 1.0 by construction — a number that
  // looks like "perfectly balanced" and means "no load history at all".
  const acwr = input.dailyLoads.length >= 28 && chronic > 0 ? computeAcwr(input.dailyLoads).acwr : null

  const weekSets = input.setLogs.filter((s) => inWeek(s.date, weekStart, weekEnd))
  const strengthSets = weekSets.filter(
    (s) => s.itemKind === 'exercise' && (s.reps ?? 0) > 0,
  ).length
  const plyoContacts = weekSets.reduce((sum, s) => sum + (s.contacts ?? 0), 0)

  const weekSessions = input.sessions.filter((s) => inWeek(s.date, weekStart, weekEnd))
  const sessionsDone = weekSessions.filter((s) => s.status === 'completed').length

  return {
    weekStart,
    weekEnd,
    totalLoad,
    runKm: volume.km,
    runMinutes: volume.minutes,
    runs: volume.runs,
    strengthSets,
    plyoContacts,
    sessionsPlanned: weekSessions.length,
    sessionsDone,
    acwrEnd: acwr,
    summaryJson: JSON.stringify({
      runs: volume.runs,
      dailyLoads: last7,
      // Stored so the history view can show the week's shape without holding
      // 28 days of raw rows in memory for every week on screen.
      acwrConfidence: input.dailyLoads.length >= 28 ? 'high' : 'low',
    }),
  }
}

/**
 * Every Monday that has a *finished* week behind it, oldest first.
 *
 * The current week is deliberately excluded. A summary of a week still being
 * lived is a half-week cached under a name that claims to be whole, and the
 * next read would silently disagree with it.
 */
export function closedWeekStarts(today: Date, weeks = 8): Date[] {
  const thisMonday = weekStartOf(today)
  const out: Date[] = []
  for (let i = weeks; i >= 1; i--) {
    out.push(weekStartOf(subDays(thisMonday, i * 7)))
  }
  return out
}

// ── The shape the page reads ──────────────────────────────────────────────────
// Kept here, beside the maths, so the client can type-import it without pulling
// Prisma into the bundle — the same arrangement `trends.ts` uses.

export interface RecordHistoryEntry {
  id: number
  value: number
  achievedOn: string
  source: RecordSource
  verified: boolean
  notes: string | null
}

export interface RecordRow {
  id: number
  kind: RecordKind
  family: RecordFamily
  subjectId: string
  label: string
  value: number
  display: string
  unit: RecordUnit
  reps: number | null
  achievedOn: string
  source: RecordSource
  verified: boolean
  notes: string | null
  currency: RecordCurrency
  /** Everything this record beat, newest first. Empty on a first-ever record. */
  history: RecordHistoryEntry[]
}

export interface WeekRow {
  weekStart: string
  label: string
  totalLoad: number | null
  runKm: number | null
  runMinutes: number | null
  strengthSets: number | null
  plyoContacts: number | null
  sessionsPlanned: number | null
  sessionsDone: number | null
  acwrEnd: number | null
}

export interface HistoryView {
  generatedFor: string
  lifts: RecordRow[]
  runs: RecordRow[]
  /** What the detector saw and declined to call a record, verbatim. */
  refusals: RecordRefusal[]
  weeks: WeekRow[]
}
