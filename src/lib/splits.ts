// ── Per-split run data ────────────────────────────────────────────────────────
// Framework §3 already gives `activities` a `splits` JSON column, and §7 leans
// harder on aerobic decoupling than on any other durability signal. An average
// heart rate cannot produce a first-half-versus-second-half number, so until
// splits are stored the honest answer is "not available" — which is what
// `runAnalysis.ts` said. This module is the shape, the parser, and the maths
// that let it say something better.
//
// Everything here is pure: no Prisma, no network, no clock. The Garmin fetch
// lives in `garmin.ts`, the persistence in `syncGarmin.ts`.

// ── The stored shape ──────────────────────────────────────────────────────────

/**
 * Bump when the shape changes incompatibly. Stored rows carry their version so
 * a later reader can tell a v1 blob from a v2 one instead of guessing.
 */
export const SPLITS_SCHEMA_VERSION = 1

/** Where a stored blob came from, so a bad parse can be traced to an endpoint. */
export type SplitsSource = 'garmin_laps' | 'garmin_typed_splits' | 'mock' | 'seed'

/**
 * One lap as Garmin recorded it, normalised to SI-ish units the rest of the app
 * already speaks (km, seconds, bpm, metres, spm).
 *
 * Deliberately faithful: partial final laps, warmup laps and walk breaks are all
 * kept. Deciding which splits are usable is an analysis question that depends on
 * what is being asked, not a storage question — throwing them away at parse time
 * would make that decision once, invisibly, forever.
 */
export interface RunSplit {
  /** 1-based, in the order Garmin recorded them. */
  index: number
  distanceKm: number
  durationSec: number
  avgHr: number | null
  maxHr: number | null
  /** Derived from distance and duration, or from Garmin's own average speed. */
  paceSecPerKm: number | null
  elevationGainM: number | null
  elevationLossM: number | null
  /** Steps per minute, as reported — never doubled or halved to "fix" it. */
  avgCadenceSpm: number | null
  /** ISO-ish timestamp from Garmin, kept verbatim for ordering and debugging. */
  startTimeGmt: string | null
}

export interface ActivitySplits {
  version: number
  source: SplitsSource
  /** Garmin's activity id, when the payload carried one. */
  activityId: string | null
  /** When this blob was built, so staleness is visible without a join. */
  fetchedAt: string
  splits: RunSplit[]
}

// ── Parsing Garmin's payloads ─────────────────────────────────────────────────

type Raw = Record<string, unknown>

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** First finite number among the given keys, else null. */
function pick(raw: Raw, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = num(raw[k])
    if (v !== null) return v
  }
  return null
}

function pickStr(raw: Raw, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = raw[k]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return null
}

/**
 * Pull the lap array out of whichever envelope Garmin used.
 *
 * `activity/{id}/splits` returns `{ lapDTOs: [...] }`; `typedsplits` returns
 * `{ splits: [...] }`; some proxies hand back a bare array. Rather than guess
 * from the URL we look at what actually arrived, because the URL has been wrong
 * before and the body never is.
 */
function extractLaps(raw: unknown): { laps: Raw[]; source: SplitsSource } | null {
  if (Array.isArray(raw)) return { laps: raw as Raw[], source: 'garmin_laps' }
  if (!raw || typeof raw !== 'object') return null

  const obj = raw as Raw
  if (Array.isArray(obj.lapDTOs)) return { laps: obj.lapDTOs as Raw[], source: 'garmin_laps' }
  if (Array.isArray(obj.splits)) return { laps: obj.splits as Raw[], source: 'garmin_typed_splits' }
  if (Array.isArray(obj.typedSplits)) {
    return { laps: obj.typedSplits as Raw[], source: 'garmin_typed_splits' }
  }
  return null
}

export interface ParseSplitsOptions {
  /** Overrides the id found in the payload, e.g. when only the caller knows it. */
  activityId?: string | null
  /** Injectable so tests and fixtures produce stable output. */
  now?: Date
  /** Overrides the source label, for mock and seed data. */
  source?: SplitsSource
}

/**
 * Normalise a Garmin splits payload, or return null when there is nothing usable.
 *
 * Null rather than an empty blob on purpose: "we fetched and Garmin had no laps"
 * and "we never fetched" should not look identical in the database.
 */
export function parseGarminSplits(
  raw: unknown,
  opts: ParseSplitsOptions = {},
): ActivitySplits | null {
  const extracted = extractLaps(raw)
  if (!extracted || extracted.laps.length === 0) return null

  const envelope = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Raw
  const payloadId = pick(envelope, 'activityId')

  const splits: RunSplit[] = []
  for (const lap of extracted.laps) {
    if (!lap || typeof lap !== 'object') continue

    const distanceM = pick(lap, 'distance', 'distanceInMeters', 'totalDistance') ?? 0
    const durationSec =
      pick(lap, 'movingDuration', 'duration', 'elapsedDuration', 'durationInSeconds') ?? 0

    // A lap with no time on it is a recording artefact, not a split.
    if (durationSec <= 0) continue

    const distanceKm = Math.round((distanceM / 1000) * 1000) / 1000
    const speedMs = pick(lap, 'averageSpeed', 'avgSpeed', 'averageMovingSpeed')

    let paceSecPerKm: number | null = null
    if (distanceKm > 0) {
      paceSecPerKm = Math.round(durationSec / distanceKm)
    } else if (speedMs !== null && speedMs > 0) {
      paceSecPerKm = Math.round(1000 / speedMs)
    }

    splits.push({
      index: pick(lap, 'lapIndex', 'splitIndex', 'index') ?? splits.length + 1,
      distanceKm,
      durationSec: Math.round(durationSec * 10) / 10,
      avgHr: pick(lap, 'averageHR', 'averageHeartRate', 'avgHr', 'averageHRInBeatsPerMinute'),
      maxHr: pick(lap, 'maxHR', 'maxHeartRate', 'maxHr', 'maxHRInBeatsPerMinute'),
      paceSecPerKm,
      elevationGainM: pick(lap, 'elevationGain', 'totalAscent'),
      elevationLossM: pick(lap, 'elevationLoss', 'totalDescent'),
      // Prefer the field that is unambiguously both legs. Garmin's
      // `averageRunCadence` is one-leg on some firmware and two-leg on others;
      // we record whichever we were given and never "correct" it by doubling.
      avgCadenceSpm: pick(
        lap,
        'averageRunningCadenceInStepsPerMinute',
        'averageDoubleCadence',
        'averageRunCadence',
        'averageCadence',
      ),
      startTimeGmt: pickStr(lap, 'startTimeGMT', 'startTimeGmt', 'startTimeLocal'),
    })
  }

  if (splits.length === 0) return null

  return {
    version: SPLITS_SCHEMA_VERSION,
    source: opts.source ?? extracted.source,
    activityId: opts.activityId ?? (payloadId !== null ? String(payloadId) : null),
    fetchedAt: (opts.now ?? new Date()).toISOString(),
    splits,
  }
}

// ── Storage helpers ───────────────────────────────────────────────────────────

export function serializeSplits(splits: ActivitySplits): string {
  return JSON.stringify(splits)
}

/**
 * Read a stored blob back. A row written by an older build, or corrupted by a
 * half-finished migration, must not take the run page down — so this returns
 * null rather than throwing, everywhere.
 */
export function parseStoredSplits(json: string | null | undefined): ActivitySplits | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as Raw
    if (!Array.isArray(obj.splits) || obj.splits.length === 0) return null
    return {
      version: num(obj.version) ?? 0,
      source: (typeof obj.source === 'string' ? obj.source : 'garmin_laps') as SplitsSource,
      activityId: typeof obj.activityId === 'string' ? obj.activityId : null,
      fetchedAt: typeof obj.fetchedAt === 'string' ? obj.fetchedAt : '',
      splits: obj.splits as RunSplit[],
    }
  } catch {
    return null
  }
}

/** Total distance and moving time across every stored split. */
export function splitsTotals(splits: ActivitySplits): {
  distanceKm: number
  durationMin: number
  splits: number
} {
  const distanceKm = splits.splits.reduce((s, x) => s + x.distanceKm, 0)
  const durationSec = splits.splits.reduce((s, x) => s + x.durationSec, 0)
  return {
    distanceKm: Math.round(distanceKm * 100) / 100,
    durationMin: Math.round((durationSec / 60) * 10) / 10,
    splits: splits.splits.length,
  }
}

// ── Aerobic decoupling (Pa:HR) ────────────────────────────────────────────────

export interface DecouplingHalf {
  splits: number
  distanceKm: number
  durationMin: number
  paceSecPerKm: number
  avgHr: number
  /** Friel's efficiency factor: speed in m/s divided by heart rate. */
  efficiencyFactor: number
}

export interface DecouplingUnavailable {
  available: false
  /** Plain-language statement of exactly what was missing. Never a shrug. */
  reason: string
}

export interface DecouplingAvailable {
  available: true
  /** What the number was computed from — the audit trail for the figure. */
  reason: string
  /**
   * Percentage drift in pace:HR from the first half to the second.
   * Positive means the second half cost more heartbeats per metre — the run
   * decoupled. Negative means it got cheaper, usually a conservative start.
   */
  driftPct: number
  first: DecouplingHalf
  second: DecouplingHalf
  splitsUsed: number
  durationMin: number
  /** The coaching read, in the framework's bands (§7). */
  verdict: string
}

export type DecouplingResult = DecouplingUnavailable | DecouplingAvailable

export interface DecouplingOptions {
  /** Splits needed after fragments are trimmed, so each half has at least two. */
  minSplits?: number
  /**
   * Cardiac drift needs time to appear. Below this the number is noise dressed
   * up as a durability signal.
   */
  minDurationMin?: number
  /** Coefficient of variation of split pace above which it is not steady state. */
  maxPaceCv?: number
  /** Same for heart rate — catches efforts that ramped even at even pace. */
  maxHrCv?: number
  /**
   * How much faster the second half may be before it reads as a deliberate
   * progression rather than a steady effort. Asymmetric on purpose: a *slower*
   * second half is the signal being measured, so it is never a reason to refuse.
   */
  maxNegativeSplit?: number
  /** Trailing/leading laps shorter than this share of the median are fragments. */
  fragmentRatio?: number
}

export const DECOUPLING_DEFAULTS: Required<DecouplingOptions> = {
  minSplits: 4,
  minDurationMin: 30,
  maxPaceCv: 0.12,
  maxHrCv: 0.08,
  maxNegativeSplit: 0.05,
  fragmentRatio: 0.5,
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

/** Population coefficient of variation. Zero-mean inputs return 0, not NaN. */
function cv(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  if (m === 0) return 0
  const variance = mean(xs.map((x) => (x - m) ** 2))
  return Math.sqrt(variance) / Math.abs(m)
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function aggregate(splits: RunSplit[]): DecouplingHalf {
  const distanceKm = splits.reduce((s, x) => s + x.distanceKm, 0)
  const durationSec = splits.reduce((s, x) => s + x.durationSec, 0)
  // Duration-weighted, because a 90-second split and a 6-minute split are not
  // equal evidence about what the heart was doing.
  const hr =
    splits.reduce((s, x) => s + (x.avgHr as number) * x.durationSec, 0) / durationSec
  const speedMs = (distanceKm * 1000) / durationSec
  return {
    splits: splits.length,
    distanceKm: Math.round(distanceKm * 100) / 100,
    durationMin: Math.round((durationSec / 60) * 10) / 10,
    paceSecPerKm: Math.round(durationSec / distanceKm),
    avgHr: Math.round(hr * 10) / 10,
    efficiencyFactor: speedMs / hr,
  }
}

/**
 * Aerobic decoupling for one run, by the standard Pa:HR method.
 *
 * Split the steady portion in half by elapsed time, compute speed ÷ heart rate
 * for each half, and report how far the second half fell off the first. Under
 * ~5% is the classic marker of an aerobic base that holds; past ~10% the run
 * outlasted the engine driving it (framework §7).
 *
 * The gate matters more than the arithmetic. A number computed off an interval
 * session, a walk/run, a progression run or a twenty-minute shakeout is worse
 * than no number, because it looks equally authoritative. Every refusal below
 * names the measurement that failed and the threshold it failed against.
 */
export function computeDecoupling(
  splits: ActivitySplits | null,
  opts: DecouplingOptions = {},
): DecouplingResult {
  const o = { ...DECOUPLING_DEFAULTS, ...opts }

  if (!splits || splits.splits.length === 0) {
    return {
      available: false,
      reason: 'No per-split data stored for this run, so there are no halves to compare.',
    }
  }

  // Splits with no heart rate cannot contribute to a pace:HR ratio at all.
  const withData = splits.splits.filter(
    (s) => s.durationSec > 0 && s.distanceKm > 0 && s.avgHr !== null && s.avgHr > 0,
  )

  if (withData.length < o.minSplits) {
    return {
      available: false,
      reason: `Only ${withData.length} of ${splits.splits.length} split(s) carry both distance and heart rate; ${o.minSplits} are needed so each half has at least two.`,
    }
  }

  // ── Trim fragments at the ends ──────────────────────────────────────────────
  // Garmin closes an activity with whatever distance was left over, so the last
  // lap is routinely a 180 m sprint-to-the-driveway. Averaged in, it drags the
  // second half's pace around for reasons that have nothing to do with aerobic
  // durability.
  const med = median(withData.map((s) => s.distanceKm))
  const floor = med * o.fragmentRatio
  let start = 0
  let end = withData.length
  while (start < end && withData[start].distanceKm < floor) start++
  while (end > start && withData[end - 1].distanceKm < floor) end--
  const usable = withData.slice(start, end)
  const trimmed = withData.length - usable.length

  if (usable.length < o.minSplits) {
    return {
      available: false,
      reason: `Only ${usable.length} full-length split(s) remain after trimming ${trimmed} partial lap(s); ${o.minSplits} are needed.`,
    }
  }

  const totalSec = usable.reduce((s, x) => s + x.durationSec, 0)
  const durationMin = Math.round((totalSec / 60) * 10) / 10

  if (durationMin < o.minDurationMin) {
    return {
      available: false,
      reason: `The steady portion was ${durationMin} min. Cardiac drift needs about ${o.minDurationMin} min to develop, so anything shorter reads as noise rather than durability.`,
    }
  }

  // ── Steady-state gate ───────────────────────────────────────────────────────
  const paces = usable.map((s) => s.paceSecPerKm as number)
  const hrs = usable.map((s) => s.avgHr as number)
  const paceCv = cv(paces)
  const hrCv = cv(hrs)

  if (paceCv > o.maxPaceCv) {
    return {
      available: false,
      reason: `Split pace varied by ${Math.round(paceCv * 100)}% (ceiling ${Math.round(
        o.maxPaceCv * 100,
      )}%), so this was an interval or walk/run session, not a steady effort. Pa:HR drift only means something when the effort was held.`,
    }
  }

  if (hrCv > o.maxHrCv) {
    return {
      available: false,
      reason: `Split heart rate varied by ${Math.round(hrCv * 100)}% (ceiling ${Math.round(
        o.maxHrCv * 100,
      )}%), so the effort was not held steady even though the pace looked even.`,
    }
  }

  // ── Halve by elapsed time ───────────────────────────────────────────────────
  // By time, not by split count: laps are rarely equal, and the method is about
  // the first and second halves of the *run*, not of the lap list.
  const minPerHalf = Math.max(2, Math.floor(o.minSplits / 2))
  let cut = minPerHalf
  let best = Infinity
  let acc = 0
  const cumulative = usable.map((s) => (acc += s.durationSec))
  for (let i = minPerHalf; i <= usable.length - minPerHalf; i++) {
    const diff = Math.abs(cumulative[i - 1] - totalSec / 2)
    if (diff < best) {
      best = diff
      cut = i
    }
  }

  const first = aggregate(usable.slice(0, cut))
  const second = aggregate(usable.slice(cut))

  // A second half run materially faster than the first is a progression run —
  // a deliberate change of effort. Refusing it is not squeamishness: the method
  // assumes the effort was constant, and here it demonstrably was not.
  if (second.paceSecPerKm < first.paceSecPerKm * (1 - o.maxNegativeSplit)) {
    const faster = Math.round(
      ((first.paceSecPerKm - second.paceSecPerKm) / first.paceSecPerKm) * 100,
    )
    return {
      available: false,
      reason: `The second half was run ${faster}% faster than the first (ceiling ${Math.round(
        o.maxNegativeSplit * 100,
      )}%), which is a progression run rather than a held effort. Decoupling assumes the effort never changed.`,
    }
  }

  const driftPct =
    Math.round(((first.efficiencyFactor - second.efficiencyFactor) / first.efficiencyFactor) * 1000) /
    10

  let verdict: string
  if (driftPct < 0) {
    verdict = `Pace:HR improved by ${Math.abs(
      driftPct,
    )}% across the run. Usually a conservative or under-warmed first half rather than a fitness signal — read it as "no durability problem", not as a gain.`
  } else if (driftPct < 5) {
    verdict = `${driftPct}% drift. Under 5% is the marker of an aerobic base that holds — this distance is well within reach at this effort.`
  } else if (driftPct < 10) {
    verdict = `${driftPct}% drift. Past 5%, so the aerobic base is being stretched near the end. Hold the distance rather than extending it until this settles.`
  } else {
    verdict = `${driftPct}% drift. Past 10% the run outlasted the engine driving it — either the effort was too hard for the duration, or the durability for this distance is not there yet. More easy volume, not a longer long run.`
  }

  return {
    available: true,
    reason: `First ${first.durationMin} min versus last ${second.durationMin} min across ${usable.length} split(s)${
      trimmed > 0 ? `, after trimming ${trimmed} partial lap(s)` : ''
    }. Pace held within ${Math.round(paceCv * 100)}%, heart rate within ${Math.round(hrCv * 100)}%.`,
    driftPct,
    first,
    second,
    splitsUsed: usable.length,
    durationMin,
    verdict,
  }
}
