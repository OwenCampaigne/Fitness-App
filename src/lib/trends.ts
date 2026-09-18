// ── Trends ────────────────────────────────────────────────────────────────────
// The weekly review, and the anchor arc that sits above it.
//
// Framework §14 puts every chart on this page and none of them on the daily
// screen: the daily screen answers "what do I do today", the weekly review
// answers "is this working". Framework §21 (the Expansionist) names the anchor
// arc as the differentiator — a coach that can show its own estimates getting
// sharper — so it goes first and everything else is context for it.
//
// The arc is *reconstructed*, not read out of a history table. `athlete_profile`
// keeps only each anchor's current value, but the observations that produced it
// are all still there (`set_logs`, `activities`). So the honest way to draw the
// arc is to replay the same derivation the calibration loop ran (§5b), one
// observation at a time, over the data that fed it. Replaying the production
// rule means this page cannot drift from what the engine actually believed on
// any given day — and it means an anchor nothing has ever observed produces no
// points at all, which is exactly what we want it to say.
//
// Everything here is pure and free of Prisma, so it is unit-testable and safe
// to type-import from a client component.

import { format, startOfWeek, subDays } from 'date-fns'
import {
  VOLUME_LANDMARKS,
  completedSets,
  deriveWorkingLoadAnchor,
  meanRir,
  topWeight,
  weeklySetsByMuscle,
} from './strengthEngine'
import { estimateLthr, formatPace, paceAtFixedHr, paceSecPerKm } from './runAnalysis'
import type { RunActivityRow } from '../types/run'
import type {
  AnchorSource,
  ExerciseSessionHistory,
  KeyLift,
  MuscleGroup,
} from '../types/strength'

// ── Small shared helpers ──────────────────────────────────────────────────────

const DAY_MS = 86_400_000

function isoDay(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function dayLabel(d: Date): string {
  return format(d, 'MMM d')
}

function mondayOf(d: Date): Date {
  return startOfWeek(d, { weekStartsOn: 1 })
}

function round(value: number, places = 1): number {
  const f = 10 ** places
  return Math.round(value * f) / f
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function isRun(row: { type: string }): boolean {
  return row.type.toLowerCase().includes('run')
}

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five',
  'six', 'seven', 'eight', 'nine', 'ten',
]

/**
 * "Three weeks ago" reads like a coach; "21 days ago" reads like a log file.
 * The arc headline is the one sentence the whole page exists to say, so it gets
 * words rather than numbers wherever words are still precise.
 */
export function agoPhrase(days: number): string {
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.round(days / 7)
  if (weeks === 1) return 'A week ago'
  if (weeks < NUMBER_WORDS.length) {
    const word = NUMBER_WORDS[weeks]
    return `${word[0].toUpperCase()}${word.slice(1)} weeks ago`
  }
  return `${weeks} weeks ago`
}

// ── Anchor arc ────────────────────────────────────────────────────────────────

export type AnchorKind = 'lift' | 'pace' | 'hr_zone' | 'plyo_tier'
export type AnchorUnit = 'kg' | 'bpm' | 'sec_per_km' | 'tier'

/** The shape §3 requires of every derived training number: value + source + confidence. */
export interface AnchorSnapshot {
  value: number | null
  source: AnchorSource
  confidence: number
}

export interface AnchorArcPoint extends AnchorSnapshot {
  /** The day of the observation that produced this reading. */
  date: string
  /** What the system actually saw, in one sentence. */
  note: string
}

export interface AnchorMove {
  date: string
  from: AnchorSnapshot
  to: AnchorSnapshot
  /** Signed change in the anchor's own unit. Null when either side has no value. */
  deltaValue: number | null
  changed: 'value' | 'source' | 'both'
  reason: string
}

export interface AnchorArc {
  id: string
  kind: AnchorKind
  label: string
  unit: AnchorUnit
  /** Every reading, oldest first. Empty when nothing has ever been observed. */
  points: AnchorArcPoint[]
  /** Only the readings where the belief actually changed — the "when and why". */
  moves: AnchorMove[]
  first: AnchorArcPoint | null
  latest: AnchorSnapshot | null
  deltaValue: number | null
  spanDays: number | null
  /**
   * False when the anchor has never moved. The page must render these as
   * "still an estimate" with the reason, never as a flat line dressed up as
   * measurement — an estimate is not data (§5b, §21 Contrarian).
   */
  hasMovement: boolean
  /** True while the anchor's source is still `estimate`. */
  stillEstimate: boolean
  /** Why there is nothing to show. Always set when `hasMovement` is false. */
  reason: string | null
  headline: string
}

export function formatAnchorValue(unit: AnchorUnit, value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—'
  switch (unit) {
    case 'kg':
      return `${round(value, 1)} kg`
    case 'bpm':
      return `${Math.round(value)} bpm`
    case 'sec_per_km':
      return formatPace(Math.round(value))
    case 'tier':
      return `Tier ${Math.round(value)}`
  }
}

/**
 * Deltas are stated in the direction the athlete cares about, not the direction
 * the number happens to move: a smaller seconds-per-kilometre is "faster".
 */
export function formatAnchorDelta(unit: AnchorUnit, delta: number | null): string {
  if (delta === null || Number.isNaN(delta)) return 'unchanged'
  if (delta === 0) return 'unchanged'
  const size = Math.abs(delta)
  switch (unit) {
    case 'kg':
      return `${round(size, 1)} kg ${delta > 0 ? 'higher' : 'lower'}`
    case 'bpm':
      return `${Math.round(size)} bpm ${delta > 0 ? 'higher' : 'lower'}`
    case 'sec_per_km':
      return `${Math.round(size)} s/km ${delta < 0 ? 'faster' : 'slower'}`
    case 'tier':
      return `${Math.round(size)} tier${size === 1 ? '' : 's'} ${delta > 0 ? 'higher' : 'lower'}`
  }
}

function snapshotOf(p: AnchorSnapshot): AnchorSnapshot {
  return { value: p.value, source: p.source, confidence: p.confidence }
}

function describeMove(
  unit: AnchorUnit,
  from: AnchorSnapshot,
  to: AnchorSnapshot,
  note: string,
): string {
  const bits: string[] = []
  if (to.source !== from.source) bits.push(`${from.source} → ${to.source}`)
  if (from.value === null && to.value !== null) {
    bits.push(`first reading at ${formatAnchorValue(unit, to.value)}`)
  } else if (from.value !== null && to.value !== null && from.value !== to.value) {
    bits.push(`${formatAnchorValue(unit, to.value)}, ${formatAnchorDelta(unit, to.value - from.value)}`)
  }
  if (bits.length === 0) bits.push(`confidence ${Math.round(to.confidence * 100)}%`)
  return `${bits.join(' · ')} — ${note}`
}

function movesFrom(unit: AnchorUnit, points: AnchorArcPoint[]): AnchorMove[] {
  const moves: AnchorMove[] = []
  let previous: AnchorSnapshot | null = null

  for (const point of points) {
    if (previous === null) {
      previous = snapshotOf(point)
      moves.push({
        date: point.date,
        from: { value: null, source: 'estimate', confidence: 0 },
        to: snapshotOf(point),
        deltaValue: null,
        changed: 'both',
        reason: describeMove(unit, { value: null, source: 'estimate', confidence: 0 }, point, point.note),
      })
      continue
    }

    const valueChanged = previous.value !== point.value
    const sourceChanged = previous.source !== point.source
    if (!valueChanged && !sourceChanged) continue

    moves.push({
      date: point.date,
      from: previous,
      to: snapshotOf(point),
      deltaValue:
        previous.value !== null && point.value !== null ? round(point.value - previous.value, 2) : null,
      changed: valueChanged && sourceChanged ? 'both' : valueChanged ? 'value' : 'source',
      reason: describeMove(unit, previous, point, point.note),
    })
    previous = snapshotOf(point)
  }

  return moves
}

export interface AnchorArcInput {
  id: string
  kind: AnchorKind
  label: string
  unit: AnchorUnit
  /** Readings produced by replaying the derivation, oldest first. */
  points: AnchorArcPoint[]
  /** What the profile holds right now, when it is known apart from the replay. */
  current?: AnchorSnapshot | null
  /** Why there is nothing to show. Surfaced verbatim when the arc never moved. */
  estimateReason: string
  today?: Date
}

/**
 * Turn a replayed series of readings into the arc the page renders.
 *
 * The honesty rule lives here rather than in the component: an anchor with one
 * reading, or none, gets `hasMovement: false` and a reason, and the component
 * has nothing to draw a line from.
 */
export function buildAnchorArc(input: AnchorArcInput): AnchorArc {
  const { id, kind, label, unit, estimateReason } = input
  const points = [...input.points].sort((a, b) => a.date.localeCompare(b.date))
  const today = input.today ?? new Date()

  const first = points[0] ?? null
  const last = points[points.length - 1] ?? null
  const latest: AnchorSnapshot | null = last
    ? snapshotOf(last)
    : (input.current ?? null)

  const moves = movesFrom(unit, points)
  // One reading is a data point, not an arc. Two readings that agree are not
  // an arc either — the belief has to have actually changed.
  const hasMovement = moves.length > 1
  const stillEstimate = latest === null || latest.source === 'estimate'

  const deltaValue =
    hasMovement && first && last && first.value !== null && last.value !== null
      ? round(last.value - first.value, 2)
      : null

  const spanDays =
    hasMovement && first && last
      ? Math.max(
          0,
          Math.round(
            (new Date(`${last.date}T00:00:00`).getTime() -
              new Date(`${first.date}T00:00:00`).getTime()) /
              DAY_MS,
          ),
        )
      : null

  const sinceFirstDays = first
    ? Math.max(0, Math.round((today.getTime() - new Date(`${first.date}T00:00:00`).getTime()) / DAY_MS))
    : null

  return {
    id,
    kind,
    label,
    unit,
    points,
    moves,
    first,
    latest,
    deltaValue,
    spanDays,
    hasMovement,
    stillEstimate,
    reason: hasMovement ? null : estimateReason,
    headline: buildHeadline({
      label,
      unit,
      hasMovement,
      first,
      latest,
      deltaValue,
      sinceFirstDays,
      estimateReason,
    }),
  }
}

function buildHeadline(args: {
  label: string
  unit: AnchorUnit
  hasMovement: boolean
  first: AnchorArcPoint | null
  latest: AnchorSnapshot | null
  deltaValue: number | null
  sinceFirstDays: number | null
  estimateReason: string
}): string {
  const { label, unit, hasMovement, first, latest, deltaValue, sinceFirstDays } = args

  if (!hasMovement || !first || !latest) {
    return latest && latest.value !== null
      ? `${label} is still an estimate at ${formatAnchorValue(unit, latest.value)}.`
      : `${label} is still an estimate — nothing has measured it yet.`
  }

  const when = agoPhrase(sinceFirstDays ?? 0)
  const startVerb =
    first.source === 'estimate' ? 'I guessed' : first.source === 'observed' ? 'I first measured' : 'I had'
  const opener = `${when} ${startVerb} your ${label} at ${formatAnchorValue(unit, first.value)}`

  if (latest.source === 'estimate') {
    return `${opener}; it is still an estimate, now ${formatAnchorValue(unit, latest.value)}.`
  }

  const verb = latest.source === 'confirmed' ? 'I have now confirmed it' : 'I have now observed it'
  if (deltaValue === null || deltaValue === 0) {
    return `${opener}; ${verb} unchanged at ${formatAnchorValue(unit, latest.value)}.`
  }
  return `${opener}; ${verb} ${formatAnchorDelta(unit, deltaValue)}.`
}

// ── Anchor arc — key-lift working loads ───────────────────────────────────────

/**
 * Replay `deriveWorkingLoadAnchor` over the logged sessions, prefix by prefix.
 *
 * This is the same call `refreshWorkingLoadAnchor` makes after every set is
 * logged, so each point is literally what the anchor was on that day — not a
 * smoothed reconstruction of it.
 */
export function buildLiftAnchorArc(
  lift: Pick<KeyLift, 'id' | 'name' | 'defaultTargetRir'>,
  sessions: ExerciseSessionHistory[],
  opts: { today?: Date } = {},
): AnchorArc {
  const withSets = sessions
    .filter((s) => completedSets(s.sets).length > 0)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const points: AnchorArcPoint[] = withSets.map((session, i) => {
    const anchor = deriveWorkingLoadAnchor(withSets.slice(0, i + 1), lift.defaultTargetRir)
    const sets = completedSets(session.sets)
    const top = topWeight(sets)
    const rir = meanRir(sets)
    const reps = sets.find((s) => s.weightKg === top)?.reps ?? null

    const loadPart = top === null ? 'bodyweight' : `${round(top, 1)} kg`
    const repPart = reps ? ` × ${reps}` : ''
    const rirPart =
      rir === null
        ? ', RIR not logged'
        : `, mean RIR ${round(rir, 1)} against a target of ${lift.defaultTargetRir}`

    return {
      date: isoDay(new Date(session.date)),
      value: anchor.value,
      source: anchor.source,
      confidence: anchor.confidence,
      note: `${sets.length} set${sets.length === 1 ? '' : 's'} at ${loadPart}${repPart}${rirPart}.`,
    }
  })

  return buildAnchorArc({
    id: `lift:${lift.id}`,
    kind: 'lift',
    label: lift.name,
    unit: 'kg',
    points,
    estimateReason:
      points.length === 0
        ? `No sets logged for ${lift.name} yet, so the working load is whatever onboarding estimated — the app has not measured it.`
        : `Only ${points.length} logged session${points.length === 1 ? '' : 's'} for ${lift.name}. The anchor has not moved yet, so there is no arc to draw — it takes three sessions at the target RIR before it can be confirmed (§5b).`,
    today: opts.today,
  })
}

// ── Anchor arc — easy pace at a matched heart rate ────────────────────────────

/**
 * Replay `paceAtFixedHr` the way `refreshPaceAnchors` uses it: a point only
 * lands on a day whose own run fell inside the matched HR band, and only once
 * there are enough matched runs for the comparison to mean anything. Below that
 * threshold the production code leaves the anchor alone, so this does too.
 */
export function buildPaceAnchorArc(
  activities: RunActivityRow[],
  z2Ceiling: number | null,
  opts: { today?: Date; minSamples?: number; bandWidth?: number } = {},
): AnchorArc {
  const minSamples = opts.minSamples ?? 4
  const bandWidth = opts.bandWidth ?? 8
  const runs = activities
    .filter(isRun)
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  if (!z2Ceiling) {
    return buildAnchorArc({
      id: 'pace:easy',
      kind: 'pace',
      label: 'easy pace',
      unit: 'sec_per_km',
      points: [],
      estimateReason:
        'No Zone 2 ceiling established yet, so there is no heart rate to match easy runs against. Pace stays an estimate until there is.',
      today: opts.today,
    })
  }

  const low = z2Ceiling - bandWidth
  const high = z2Ceiling + bandWidth
  const points: AnchorArcPoint[] = []

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]
    const hr = run.avgHr
    // Only a run inside the band can move this anchor — anything else would
    // repeat the previous value on an unrelated date and look like a reading.
    if (hr === null || hr < low || hr > high || paceSecPerKm(run) === null) continue

    const result = paceAtFixedHr(runs.slice(0, i + 1), z2Ceiling, { bandWidth })
    if (result.recentSecPerKm === null || result.samples < minSamples) continue

    const confirmed = result.samples >= 8
    points.push({
      date: isoDay(run.date),
      value: result.recentSecPerKm,
      source: confirmed ? 'confirmed' : 'observed',
      confidence: confirmed ? 0.8 : 0.55,
      note: `${result.samples} runs matched between ${result.hrBandLow} and ${result.hrBandHigh} bpm; the recent half averaged ${formatPace(result.recentSecPerKm)}.`,
    })
  }

  const overall = paceAtFixedHr(runs, z2Ceiling, { bandWidth })

  return buildAnchorArc({
    id: 'pace:easy',
    kind: 'pace',
    label: 'easy pace',
    unit: 'sec_per_km',
    points,
    estimateReason: points.length === 0 ? overall.verdict : `${overall.verdict} The anchor has not moved yet.`,
    today: opts.today,
  })
}

// ── Anchor arc — lactate-threshold heart rate ─────────────────────────────────

/**
 * LTHR is the anchor most likely to sit on a number that is not a measurement:
 * without a sustained hard effort in the window, `estimateLthr` falls back to
 * 88% of max HR. That has a value but it is a population figure, so it produces
 * no arc points and the card says why (§5a — a 30-minute time trial replaces it).
 */
export function buildLthrAnchorArc(
  activities: RunActivityRow[],
  maxHr: number | null,
  opts: { today?: Date; minDurationMin?: number; hardFraction?: number } = {},
): AnchorArc {
  const minDurationMin = opts.minDurationMin ?? 20
  const hardFraction = opts.hardFraction ?? 0.85
  const runs = activities
    .filter(isRun)
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  const overall = estimateLthr(runs, maxHr, { minDurationMin, hardFraction })

  if (!maxHr) {
    return buildAnchorArc({
      id: 'hr:lthr',
      kind: 'hr_zone',
      label: 'threshold heart rate',
      unit: 'bpm',
      points: [],
      current: { value: overall.value, source: overall.source, confidence: overall.confidence },
      estimateReason: overall.basis,
      today: opts.today,
    })
  }

  const threshold = maxHr * hardFraction
  const points: AnchorArcPoint[] = []

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]
    const qualifies =
      run.avgHr !== null &&
      run.avgHr >= threshold &&
      run.durationMin !== null &&
      run.durationMin >= minDurationMin
    if (!qualifies) continue

    const estimate = estimateLthr(runs.slice(0, i + 1), maxHr, { minDurationMin, hardFraction })
    points.push({
      date: isoDay(run.date),
      value: estimate.value,
      source: estimate.source,
      confidence: estimate.confidence,
      note: `${Math.round(run.durationMin as number)} min averaging ${Math.round(run.avgHr as number)} bpm, above the ${Math.round(threshold)} bpm hard-effort line.`,
    })
  }

  return buildAnchorArc({
    id: 'hr:lthr',
    kind: 'hr_zone',
    label: 'threshold heart rate',
    unit: 'bpm',
    points,
    current: { value: overall.value, source: overall.source, confidence: overall.confidence },
    estimateReason: overall.basis,
    today: opts.today,
  })
}

// ── Anchor arc — plyometric tier ──────────────────────────────────────────────

/**
 * The plyo tier has no observations behind it by design: nothing logs a plyo
 * session until the Phase 4 engine exists, so the tier is still the
 * one-below-claimed-competence start from §5a. Saying that is the whole point —
 * the alternative is a confident-looking chart of a guess.
 */
export function buildPlyoTierArc(
  profile: { plyoTier: number | null; plyoTierSource: string | null; plyoTierConfidence: string | null },
  opts: { today?: Date } = {},
): AnchorArc {
  const source = (
    ['estimate', 'observed', 'confirmed'].includes(profile.plyoTierSource ?? '')
      ? profile.plyoTierSource
      : 'estimate'
  ) as AnchorSource
  const parsed = Number(profile.plyoTierConfidence)
  const confidence = Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0.2

  return buildAnchorArc({
    id: 'plyo:tier',
    kind: 'plyo_tier',
    label: 'plyo tier',
    unit: 'tier',
    points: [],
    current: { value: profile.plyoTier, source, confidence },
    estimateReason:
      'Nothing logs plyometric contacts yet, so the tier has not moved from the conservative starting point onboarding set — one tier below claimed competence (§5a). It will start moving when the plyo engine lands.',
    today: opts.today,
  })
}

// ── Weekly volume ─────────────────────────────────────────────────────────────

export interface WeeklyVolumePoint {
  /** Monday of the week, as yyyy-MM-dd. */
  weekStart: string
  label: string
  runs: number
  km: number
  minutes: number
  /** Session load, framework §3: duration(min) × sRPE. */
  load: number
}

export interface VolumeOptions {
  weeks?: number
  today?: Date
  /** sRPE estimator, injected so the single definition in readiness.ts stays the only one. */
  srpe?: (avgHr: number) => number
}

/**
 * Volume by ISO week, Monday-started, with empty weeks kept.
 *
 * A zero week is real information — it is a week off, not missing data — so it
 * stays in the series rather than being compacted away.
 */
export function weeklyVolume(
  activities: RunActivityRow[],
  opts: VolumeOptions = {},
): WeeklyVolumePoint[] {
  const weeks = opts.weeks ?? 8
  const today = opts.today ?? new Date()
  const srpe = opts.srpe ?? (() => 5)

  const buckets = new Map<string, WeeklyVolumePoint>()
  const thisMonday = mondayOf(today)

  for (let i = weeks - 1; i >= 0; i--) {
    const start = subDays(thisMonday, i * 7)
    buckets.set(isoDay(start), {
      weekStart: isoDay(start),
      label: dayLabel(start),
      runs: 0,
      km: 0,
      minutes: 0,
      load: 0,
    })
  }

  for (const activity of activities) {
    const key = isoDay(mondayOf(activity.date))
    const bucket = buckets.get(key)
    if (!bucket) continue
    bucket.runs += 1
    bucket.km += activity.distanceKm ?? 0
    bucket.minutes += activity.durationMin ?? 0
    if (activity.durationMin && activity.avgHr) {
      bucket.load += activity.durationMin * srpe(activity.avgHr)
    }
  }

  return Array.from(buckets.values()).map((b) => ({
    ...b,
    km: round(b.km, 1),
    minutes: Math.round(b.minutes),
    load: Math.round(b.load),
  }))
}

// ── ACWR ──────────────────────────────────────────────────────────────────────

export interface DailyLoadPoint {
  date: string
  load: number
}

export type AcwrBand = 'no_data' | 'detraining' | 'optimal' | 'caution' | 'danger'

export interface AcwrPoint {
  date: string
  /** 7-day mean daily load. */
  acute: number
  /** 28-day mean daily load. */
  chronic: number
  acwr: number | null
  band: AcwrBand
}

/** One row per day over the window, zero-filled — the input ACWR needs. */
export function dailyLoadSeries(
  activities: RunActivityRow[],
  opts: { days?: number; today?: Date; srpe?: (avgHr: number) => number } = {},
): DailyLoadPoint[] {
  const days = opts.days ?? 56
  const today = opts.today ?? new Date()
  const srpe = opts.srpe ?? (() => 5)

  const buckets = new Map<string, number>()
  for (let i = days - 1; i >= 0; i--) buckets.set(isoDay(subDays(today, i)), 0)

  for (const activity of activities) {
    const key = isoDay(activity.date)
    if (!buckets.has(key)) continue
    if (!activity.durationMin || !activity.avgHr) continue
    buckets.set(key, (buckets.get(key) as number) + activity.durationMin * srpe(activity.avgHr))
  }

  return Array.from(buckets.entries()).map(([date, load]) => ({ date, load: Math.round(load) }))
}

/**
 * The 0.8–1.3 corridor is framework §6; `readiness.ts` treats anything above
 * 1.5 as an outright red. The band names here are the same rule, so the chart
 * and the daily readiness call can never disagree.
 */
export function acwrBand(acwr: number | null): AcwrBand {
  if (acwr === null) return 'no_data'
  if (acwr < 0.8) return 'detraining'
  if (acwr <= 1.3) return 'optimal'
  if (acwr <= 1.5) return 'caution'
  return 'danger'
}

/**
 * Rolling 7:28 ACWR. A point is only produced once 28 days of history exist
 * behind it — a ratio computed against a partial chronic window reads high for
 * no reason and would flag phantom danger in week one.
 */
export function acwrSeries(daily: DailyLoadPoint[], opts: { days?: number } = {}): AcwrPoint[] {
  const points: AcwrPoint[] = []

  for (let i = 27; i < daily.length; i++) {
    const acute = mean(daily.slice(i - 6, i + 1).map((d) => d.load)) ?? 0
    const chronic = mean(daily.slice(i - 27, i + 1).map((d) => d.load)) ?? 0
    const acwr = chronic > 0 ? round(acute / chronic, 2) : null
    points.push({
      date: daily[i].date,
      acute: Math.round(acute),
      chronic: Math.round(chronic),
      acwr,
      band: acwrBand(acwr),
    })
  }

  const days = opts.days
  return days && points.length > days ? points.slice(points.length - days) : points
}

export function describeAcwr(point: AcwrPoint | null | undefined): string {
  if (!point || point.acwr === null) {
    return 'Not enough load history yet — the ratio needs 28 days behind it before it means anything.'
  }
  switch (point.band) {
    case 'detraining':
      return `Acute:chronic ${point.acwr.toFixed(2)}. Below the 0.8 floor — this week is a good deal lighter than the last month. Fine as a taper, a problem as a habit.`
    case 'optimal':
      return `Acute:chronic ${point.acwr.toFixed(2)}. Inside the 0.8–1.3 corridor — the load is moving at a rate the body can absorb.`
    case 'caution':
      return `Acute:chronic ${point.acwr.toFixed(2)}. Above 1.3: this week is outrunning the last month. Hold the volume flat rather than adding.`
    default:
      return `Acute:chronic ${point.acwr.toFixed(2)}. Past 1.5, which is the readiness engine's outright red. Back off.`
  }
}

// ── Intensity distribution (the 80/20 check) ──────────────────────────────────

export interface IntensitySlice {
  key: 'easy' | 'hard' | 'unknown'
  label: string
  minutes: number
  runs: number
  /** Share of total run minutes, 0–1. */
  share: number
}

export interface IntensityDistribution {
  available: boolean
  reason: string | null
  totalMinutes: number
  slices: IntensitySlice[]
  /** Share of *classifiable* minutes spent at or under the Z2 ceiling, 0–1. */
  easyShare: number | null
  targetEasyShare: number
  verdict: string
}

/**
 * The 80/20 check, and the one place on this page most likely to flatter the
 * athlete if it is not careful. `activities` stores an average heart rate, not
 * time in zone, so a run averaging just under the ceiling can still hide time
 * above it — same caveat `easyDayAudit` carries, stated rather than buried.
 *
 * §21's Contrarian asks for the validator to push *up* as well as down: chronic
 * quality-dodging gets called out here too, not just overreaching.
 */
export function intensityDistribution(
  activities: RunActivityRow[],
  z2Ceiling: number | null,
): IntensityDistribution {
  const runs = activities.filter(isRun).filter((r) => (r.durationMin ?? 0) > 0)
  const totalMinutes = Math.round(runs.reduce((s, r) => s + (r.durationMin ?? 0), 0))

  const empty = (reason: string): IntensityDistribution => ({
    available: false,
    reason,
    totalMinutes,
    slices: [],
    easyShare: null,
    targetEasyShare: 0.8,
    verdict: reason,
  })

  if (!z2Ceiling) {
    return empty('No Zone 2 ceiling established yet, so runs cannot be split into easy and hard.')
  }
  if (runs.length === 0) return empty('No runs with a recorded duration in this window.')

  let easyMin = 0
  let hardMin = 0
  let unknownMin = 0
  let easyRuns = 0
  let hardRuns = 0
  let unknownRuns = 0

  for (const run of runs) {
    const minutes = run.durationMin as number
    if (run.avgHr === null || run.avgHr <= 0) {
      unknownMin += minutes
      unknownRuns += 1
    } else if (run.avgHr > z2Ceiling) {
      hardMin += minutes
      hardRuns += 1
    } else {
      easyMin += minutes
      easyRuns += 1
    }
  }

  const classified = easyMin + hardMin
  if (classified === 0) {
    return empty('No runs in this window recorded a heart rate, so nothing can be classified.')
  }

  const easyShare = easyMin / classified
  const slices: IntensitySlice[] = [
    { key: 'easy', label: 'Easy', minutes: Math.round(easyMin), runs: easyRuns, share: round(easyMin / totalMinutes, 3) },
    { key: 'hard', label: 'Hard', minutes: Math.round(hardMin), runs: hardRuns, share: round(hardMin / totalMinutes, 3) },
  ]
  if (unknownMin > 0) {
    slices.push({
      key: 'unknown',
      label: 'No HR',
      minutes: Math.round(unknownMin),
      runs: unknownRuns,
      share: round(unknownMin / totalMinutes, 3),
    })
  }

  const pct = Math.round(easyShare * 100)
  let verdict: string
  if (easyShare >= 0.95 && hardMin === 0) {
    verdict = `All ${Math.round(easyMin)} classified minutes were at or under ${z2Ceiling} bpm. Easy is genuinely easy — but nothing here is hard either, and the 20% is what buys the top end.`
  } else if (easyShare >= 0.8) {
    verdict = `${pct}% of classified minutes were at or under ${z2Ceiling} bpm. The 80/20 split is holding.`
  } else if (easyShare >= 0.7) {
    verdict = `${pct}% easy against a target of 80%. Slipping — the easy days are where the drift usually starts.`
  } else {
    verdict = `Only ${pct}% of classified minutes were easy. Most of the volume is moderate, which costs recovery without buying either the aerobic base or the top end.`
  }

  return {
    available: true,
    reason: unknownMin > 0 ? `${Math.round(unknownMin)} min of running had no heart rate and is excluded from the split.` : null,
    totalMinutes,
    slices,
    easyShare: round(easyShare, 3),
    targetEasyShare: 0.8,
    verdict: `${verdict} Based on each run's average heart rate — the schema stores no time-in-zone, so a run averaging just under the ceiling can still hide time above it.`,
  }
}

// ── Readiness trend ───────────────────────────────────────────────────────────

export interface ReadinessDayRow {
  date: Date
  recoveryScore: number | null
  hrv: number | null
  rhr: number | null
  sleepScore: number | null
  sleepHours: number | null
}

export interface ReadinessWeekPoint {
  weekStart: string
  label: string
  days: number
  recovery: number | null
  hrv: number | null
  rhr: number | null
  sleepHours: number | null
}

/**
 * Weekly means rather than daily values: a single bad night is noise, and §14
 * puts the daily read on the home screen anyway. This page is for the shape.
 */
export function readinessTrend(
  rows: ReadinessDayRow[],
  opts: { weeks?: number; today?: Date } = {},
): ReadinessWeekPoint[] {
  const weeks = opts.weeks ?? 8
  const today = opts.today ?? new Date()
  const thisMonday = mondayOf(today)

  const buckets = new Map<string, ReadinessDayRow[]>()
  for (let i = weeks - 1; i >= 0; i--) buckets.set(isoDay(subDays(thisMonday, i * 7)), [])

  for (const row of rows) {
    const key = isoDay(mondayOf(row.date))
    const bucket = buckets.get(key)
    if (bucket) bucket.push(row)
  }

  const pick = (list: ReadinessDayRow[], field: keyof ReadinessDayRow): number | null => {
    const values = list
      .map((r) => r[field])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
    const avg = mean(values)
    return avg === null ? null : round(avg, 1)
  }

  return Array.from(buckets.entries()).map(([weekStart, list]) => ({
    weekStart,
    label: dayLabel(new Date(`${weekStart}T00:00:00`)),
    days: list.length,
    recovery: pick(list, 'recoveryScore'),
    hrv: pick(list, 'hrv'),
    rhr: pick(list, 'rhr'),
    sleepHours: pick(list, 'sleepHours'),
  }))
}

// ── Lifting volume by muscle group ────────────────────────────────────────────

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  quads: 'Quads',
  calves: 'Calves',
  adductors: 'Adductors',
  abductors: 'Abductors',
  trunk: 'Trunk',
  back: 'Back',
  chest: 'Chest',
  shoulders: 'Shoulders',
}

export type MuscleVolumeStatus = 'below_mev' | 'in_range' | 'above_mav' | 'above_mrv'

export interface MuscleVolumePoint {
  group: MuscleGroup
  label: string
  sets: number
  previousSets: number
  mev: number
  mav: number
  mrv: number
  status: MuscleVolumeStatus
}

/**
 * Hard sets per muscle group this week against last week, read against the
 * volume landmarks in `strengthEngine`. Lower-body ceilings there are already
 * held below general-population figures because running spends that recovery
 * budget first (§8) — this chart inherits those numbers rather than inventing
 * its own.
 */
export function setsByMuscleGroup(
  histories: ExerciseSessionHistory[],
  liftsById: Record<string, KeyLift>,
  opts: { today?: Date } = {},
): MuscleVolumePoint[] {
  const today = opts.today ?? new Date()
  const weekAgo = subDays(today, 7)
  const twoWeeksAgo = subDays(today, 14)

  const thisWeek = weeklySetsByMuscle(
    histories.filter((h) => new Date(h.date) >= weekAgo),
    liftsById,
  )
  const lastWeek = weeklySetsByMuscle(
    histories.filter((h) => new Date(h.date) >= twoWeeksAgo && new Date(h.date) < weekAgo),
    liftsById,
  )

  const groups = new Set<MuscleGroup>([
    ...(Object.keys(thisWeek) as MuscleGroup[]),
    ...(Object.keys(lastWeek) as MuscleGroup[]),
  ])

  return Array.from(groups)
    .map((group) => {
      const sets = thisWeek[group] ?? 0
      const landmark = VOLUME_LANDMARKS[group]
      let status: MuscleVolumeStatus = 'in_range'
      if (sets > landmark.mrv) status = 'above_mrv'
      else if (sets > landmark.mav) status = 'above_mav'
      else if (sets < landmark.mev) status = 'below_mev'

      return {
        group,
        label: MUSCLE_LABELS[group],
        sets,
        previousSets: lastWeek[group] ?? 0,
        mev: landmark.mev,
        mav: landmark.mav,
        mrv: landmark.mrv,
        status,
      }
    })
    .sort((a, b) => b.sets - a.sets || a.label.localeCompare(b.label))
}

// ── The assembled payload ─────────────────────────────────────────────────────

export interface WeeklyReview {
  /** The day the review was generated for, yyyy-MM-dd. */
  generatedFor: string
  anchors: AnchorArc[]
  volume: WeeklyVolumePoint[]
  acwr: AcwrPoint[]
  intensity: IntensityDistribution
  readiness: ReadinessWeekPoint[]
  muscles: MuscleVolumePoint[]
  /** Confidence is a headline number in its own right (§5b graduation). */
  calibration: {
    graduated: boolean
    recoveryBaselineReady: boolean
    anchorsConfirmed: number
    anchorsTotal: number
    note: string
  }
}

/**
 * One line summarising how much of the system's model of the athlete is
 * actually earned. §5c: the coach says out loud how sure it is.
 */
export function summariseCalibration(
  anchors: AnchorArc[],
  state: { graduated: boolean; recoveryBaselineReady: boolean },
): WeeklyReview['calibration'] {
  const total = anchors.length
  const confirmed = anchors.filter((a) => a.latest?.source === 'confirmed').length
  const estimates = anchors.filter((a) => a.stillEstimate).length

  let note: string
  if (total === 0) {
    note = 'No anchors set up yet.'
  } else if (state.graduated && estimates === 0) {
    note = `Calibration is done — ${confirmed} of ${total} anchors confirmed, and the recovery baseline is ready. These are your numbers, not population defaults.`
  } else if (estimates === total) {
    note = `Every anchor is still an estimate. Nothing here is a measurement yet — log sets and finish runs and it will correct itself fast (§5b).`
  } else {
    note = `${confirmed} of ${total} anchors confirmed, ${estimates} still an estimate.${
      state.recoveryBaselineReady ? '' : ' Recovery baselines are still building, so readiness is provisional.'
    }`
  }

  return {
    graduated: state.graduated,
    recoveryBaselineReady: state.recoveryBaselineReady,
    anchorsConfirmed: confirmed,
    anchorsTotal: total,
    note,
  }
}
