// ── Post-run analysis ─────────────────────────────────────────────────────────
// The running half of the calibration loop (framework §5b). Logged RIR upgrades
// working-load anchors in the strength engine; completed runs upgrade pace and
// LTHR anchors here. Pure and DB-free.

import type {
  DecouplingResult,
  DecouplingTrend,
  EasyDayAudit,
  LthrEstimate,
  PaceAtFixedHr,
  RunActivityRow,
  RunAnalysis,
} from '../types/run'
import type { AnchorSource } from '../types/strength'
import { type DecouplingOptions, computeDecoupling, parseStoredSplits } from './splits'

// ── Reading rows out of the database ──────────────────────────────────────────

/** The subset of an `activities` row this module needs. Structural, not Prisma. */
export interface StoredActivityRow {
  date: Date | string
  type: string
  durationMin: number | null
  distanceKm: number | null
  avgHr: number | null
  maxHr: number | null
  splits?: string | null
}

/**
 * Turn one `activities` row into the shape the analysis reads.
 *
 * Exists so the splits column is parsed in exactly one place. Every caller that
 * hand-rolled this mapping silently lost decoupling the moment splits landed,
 * because an omitted optional field is not a type error — routing it through
 * here makes forgetting impossible rather than merely discouraged.
 */
export function toRunActivityRow(row: StoredActivityRow): RunActivityRow {
  return {
    date: row.date instanceof Date ? row.date : new Date(row.date),
    type: row.type,
    durationMin: row.durationMin,
    distanceKm: row.distanceKm,
    avgHr: row.avgHr,
    maxHr: row.maxHr,
    splits: parseStoredSplits(row.splits ?? null),
  }
}

/** Seconds per kilometre, or null when the activity lacks distance or time. */
export function paceSecPerKm(activity: RunActivityRow): number | null {
  if (!activity.durationMin || !activity.distanceKm || activity.distanceKm <= 0) return null
  return Math.round((activity.durationMin * 60) / activity.distanceKm)
}

export function formatPace(secPerKm: number | null): string {
  if (secPerKm === null) return '—'
  const min = Math.floor(secPerKm / 60)
  const sec = Math.round(secPerKm % 60)
  return `${min}:${String(sec).padStart(2, '0')}/km`
}

// ── Easy-day honesty ──────────────────────────────────────────────────────────

/**
 * How often "easy" runs were actually moderate.
 *
 * Blunt by design. Easy days drive most of the adaptation, and letting the pace
 * creep is the single most common way runners undermine their own training.
 *
 * Caveat worth being honest about: `activities` stores an average heart rate,
 * not a time-in-zone breakdown, so this compares averages against the ceiling
 * rather than computing the true percentage of time above it. An average over
 * the ceiling is unambiguous; an average just under it can still hide a lot of
 * time above. The audit says so rather than overclaiming.
 */
export function easyDayAudit(
  activities: RunActivityRow[],
  z2Ceiling: number | null,
): EasyDayAudit {
  const withHr = activities.filter((a) => a.avgHr !== null && a.avgHr > 0)

  if (!z2Ceiling || withHr.length === 0) {
    return {
      runsAudited: 0,
      runsOverCeiling: 0,
      overCeilingRate: 0,
      worstOffenders: [],
      verdict: !z2Ceiling
        ? 'No Zone 2 ceiling established yet, so there is nothing to audit easy days against.'
        : 'No runs with heart-rate data in this window.',
    }
  }

  const over = withHr.filter((a) => (a.avgHr as number) > z2Ceiling)
  const rate = over.length / withHr.length

  const worstOffenders = [...over]
    .sort((a, b) => (b.avgHr as number) - (a.avgHr as number))
    .slice(0, 3)
    .map((a) => ({ date: a.date, avgHr: a.avgHr as number, ceiling: z2Ceiling }))

  let verdict: string
  if (over.length === 0) {
    verdict = `All ${withHr.length} runs averaged under ${z2Ceiling} bpm. Easy is actually easy.`
  } else if (rate <= 0.2) {
    verdict = `${over.length} of ${withHr.length} runs averaged above ${z2Ceiling} bpm. Close enough — watch the ones that drift.`
  } else if (rate <= 0.5) {
    verdict = `${over.length} of ${withHr.length} runs averaged above ${z2Ceiling} bpm. The easy pace is creeping.`
  } else {
    verdict = `${over.length} of ${withHr.length} runs averaged above ${z2Ceiling} bpm. Most of the easy running is not easy — that is junk volume, costing recovery without buying adaptation.`
  }

  return {
    runsAudited: withHr.length,
    runsOverCeiling: over.length,
    overCeilingRate: Math.round(rate * 100) / 100,
    worstOffenders,
    verdict: `${verdict} Based on average heart rate per run — the schema does not store time-in-zone yet, so a run averaging just under the ceiling can still hide time above it.`,
  }
}

// ── Pace at a matched heart rate ──────────────────────────────────────────────

export interface PaceAtFixedHrOptions {
  /** Width of the matched HR band, in bpm either side of the centre. */
  bandWidth?: number
  /** Minimum runs needed in each half before a verdict is offered. */
  minSamplesPerHalf?: number
}

/**
 * The cleanest fitness signal there is: are you faster at the same heart rate
 * than you were a month ago?
 *
 * Matches runs whose average HR falls inside a band around the Zone 2 ceiling,
 * splits them into an earlier and a recent half, and compares pace. Same
 * cardiac cost, less time per kilometre, means fitness moved — regardless of
 * how tired you happen to feel.
 */
export function paceAtFixedHr(
  activities: RunActivityRow[],
  centreHr: number | null,
  opts: PaceAtFixedHrOptions = {},
): PaceAtFixedHr {
  const bandWidth = opts.bandWidth ?? 8
  const minSamples = opts.minSamplesPerHalf ?? 2

  const empty = (verdict: string): PaceAtFixedHr => ({
    hrBandLow: centreHr ? centreHr - bandWidth : 0,
    hrBandHigh: centreHr ? centreHr + bandWidth : 0,
    samples: 0,
    earlierSecPerKm: null,
    recentSecPerKm: null,
    deltaSecPerKm: null,
    verdict,
  })

  if (!centreHr) {
    return empty('No heart-rate anchor to match runs against yet.')
  }

  const low = centreHr - bandWidth
  const high = centreHr + bandWidth

  const matched = activities
    .filter((a) => {
      const hr = a.avgHr
      const pace = paceSecPerKm(a)
      return hr !== null && hr >= low && hr <= high && pace !== null
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  if (matched.length < minSamples * 2) {
    return {
      ...empty(
        `Only ${matched.length} run(s) so far between ${low} and ${high} bpm — at least ${
          minSamples * 2
        } are needed before this comparison means anything.`,
      ),
      samples: matched.length,
    }
  }

  const mid = Math.floor(matched.length / 2)
  const earlier = matched.slice(0, mid)
  const recent = matched.slice(mid)

  const mean = (rows: RunActivityRow[]) =>
    Math.round(rows.reduce((sum, r) => sum + (paceSecPerKm(r) as number), 0) / rows.length)

  const earlierPace = mean(earlier)
  const recentPace = mean(recent)
  const delta = recentPace - earlierPace

  let verdict: string
  if (delta <= -10) {
    verdict = `${Math.abs(delta)} s/km faster at the same heart rate than earlier in this window. Fitness moved.`
  } else if (delta >= 10) {
    verdict = `${delta} s/km slower at the same heart rate. That usually means accumulated fatigue rather than lost fitness — check the load trend before reading it as a decline.`
  } else {
    verdict = `Pace at ${low}–${high} bpm is flat within ${Math.abs(delta)} s/km. Holding steady.`
  }

  return {
    hrBandLow: low,
    hrBandHigh: high,
    samples: matched.length,
    earlierSecPerKm: earlierPace,
    recentSecPerKm: recentPace,
    deltaSecPerKm: delta,
    verdict,
  }
}

// ── LTHR estimation ───────────────────────────────────────────────────────────

export interface LthrOptions {
  /** Minimum duration for an effort to count as sustained. */
  minDurationMin?: number
  /** Fraction of max HR above which an effort counts as hard. */
  hardFraction?: number
}

/**
 * Estimate lactate-threshold heart rate from sustained hard efforts.
 *
 * The gold standard is a 30-minute time trial — average HR over the last 20
 * minutes. Without per-split data the next-best proxy is the average HR of the
 * hardest sustained efforts in the window, which reads a little low and is
 * labelled accordingly. Confidence never reaches `confirmed` from this route;
 * that requires an actual field test, which is the point.
 */
export function estimateLthr(
  activities: RunActivityRow[],
  maxHr: number | null,
  opts: LthrOptions = {},
): LthrEstimate {
  const minDuration = opts.minDurationMin ?? 20
  const hardFraction = opts.hardFraction ?? 0.85

  if (!maxHr) {
    return {
      value: null,
      source: 'estimate',
      confidence: 0.1,
      basis: 'No max heart rate known, so there is nothing to judge a hard effort against.',
    }
  }

  const threshold = maxHr * hardFraction
  const sustained = activities.filter(
    (a) =>
      a.avgHr !== null &&
      a.avgHr >= threshold &&
      a.durationMin !== null &&
      a.durationMin >= minDuration,
  )

  if (sustained.length === 0) {
    // Fall back to the Tanaka-style population estimate, clearly labelled.
    return {
      value: Math.round(maxHr * 0.88),
      source: 'estimate',
      confidence: 0.2,
      basis: `No sustained hard efforts of ${minDuration}+ minutes yet, so this is a population estimate (88% of max HR), not your number. A 30-minute time trial would replace it.`,
    }
  }

  const mean =
    sustained.reduce((sum, a) => sum + (a.avgHr as number), 0) / sustained.length

  const source: AnchorSource = sustained.length >= 3 ? 'observed' : 'estimate'
  const confidence = sustained.length >= 3 ? 0.6 : 0.35

  return {
    value: Math.round(mean),
    source,
    confidence,
    basis: `Averaged across ${sustained.length} sustained effort(s) of ${minDuration}+ minutes above ${Math.round(threshold)} bpm. Reads slightly low without per-split data; a 30-minute time trial would confirm it.`,
  }
}

// ── Aerobic decoupling ────────────────────────────────────────────────────────

/** Newest first, so "the latest run that qualified" is the first hit. */
function newestFirst(runs: RunActivityRow[]): RunActivityRow[] {
  return [...runs].sort((a, b) => b.date.getTime() - a.date.getTime())
}

/**
 * The most recent run whose splits support a Pa:HR number.
 *
 * The framework leans on decoupling harder than on any other durability signal
 * (§7), which is exactly why it must not be manufactured. Averages cannot
 * produce it; only stored splits can, and only when the effort was actually
 * held. Everything that fails the gate comes back as a refusal that names the
 * missing measurement — the same honesty the averages-only path had, now with a
 * real number available whenever the data earns one.
 */
export function latestDecoupling(
  runs: RunActivityRow[],
  opts: DecouplingOptions = {},
): DecouplingResult {
  const ordered = newestFirst(runs)
  const withSplits = ordered.filter((r) => r.splits && r.splits.splits.length > 0)

  if (withSplits.length === 0) {
    return {
      available: false,
      reason:
        runs.length === 0
          ? 'No runs in this window, so there is nothing to measure decoupling on. It is not being faked from averages here.'
          : `None of the ${runs.length} run(s) in this window have per-split data stored, and an average heart rate cannot be divided into halves. A Garmin sync pulls the laps — until it has, it is not being faked from averages here.`,
    }
  }

  const results = withSplits.map((r) => computeDecoupling(r.splits ?? null, opts))
  const hit = results.find((r) => r.available)
  if (hit) return hit

  // Nothing qualified. Report the newest refusal rather than a generic one, so
  // the reason on screen describes the run the athlete actually just did.
  const newest = results[0]
  return {
    available: false,
    reason:
      withSplits.length === 1
        ? newest.reason
        : `${newest.reason} None of the other ${withSplits.length - 1} run(s) with splits qualified either.`,
  }
}

/**
 * Drift across every qualifying run in the window.
 *
 * One run says how a run went; the trend says whether durability is improving,
 * which is the thing periodization is actually steering. Reported separately so
 * a single bad long run never reads as a verdict on the base.
 */
export function decouplingTrend(
  runs: RunActivityRow[],
  opts: DecouplingOptions = {},
): DecouplingTrend {
  const ordered = [...runs].sort((a, b) => a.date.getTime() - b.date.getTime())
  const withSplits = ordered.filter((r) => r.splits && r.splits.splits.length > 0)

  const history: DecouplingTrend['history'] = []
  for (const row of withSplits) {
    const result = computeDecoupling(row.splits ?? null, opts)
    if (result.available) {
      history.push({ date: row.date, driftPct: result.driftPct, durationMin: result.durationMin })
    }
  }

  const base = {
    runsWithSplits: withSplits.length,
    runsQualifying: history.length,
    history,
  }

  if (history.length === 0) {
    return {
      ...base,
      meanDriftPct: null,
      deltaPct: null,
      verdict:
        withSplits.length === 0
          ? 'No runs with per-split data in this window, so there is no durability trend to read yet.'
          : `${withSplits.length} run(s) have splits, but none were steady enough or long enough to measure drift on. Decoupling needs a held effort of ${opts.minDurationMin ?? 30}+ minutes.`,
    }
  }

  const mean =
    Math.round((history.reduce((s, h) => s + h.driftPct, 0) / history.length) * 10) / 10

  if (history.length < 4) {
    return {
      ...base,
      meanDriftPct: mean,
      deltaPct: null,
      verdict: `${history.length} qualifying run(s), averaging ${mean}% drift. At least 4 are needed before a direction means anything.`,
    }
  }

  const mid = Math.floor(history.length / 2)
  const meanOf = (rows: typeof history) =>
    rows.reduce((s, h) => s + h.driftPct, 0) / rows.length
  const delta = Math.round((meanOf(history.slice(mid)) - meanOf(history.slice(0, mid))) * 10) / 10

  let verdict: string
  if (delta <= -1) {
    verdict = `Drift is down ${Math.abs(delta)} points across ${history.length} qualifying runs (now averaging ${mean}%). Durability is improving — the base is taking.`
  } else if (delta >= 1) {
    verdict = `Drift is up ${delta} points across ${history.length} qualifying runs (now averaging ${mean}%). Either the long runs got harder than they look, or fatigue is accumulating — check the load trend before adding distance.`
  } else {
    verdict = `Drift is flat within ${Math.abs(delta)} points across ${history.length} qualifying runs, averaging ${mean}%. Holding.`
  }

  return { ...base, meanDriftPct: mean, deltaPct: delta, verdict }
}

// ── Everything together ───────────────────────────────────────────────────────

export interface AnalyzeRunsOptions {
  /** Passed straight through to the Pa:HR gate — see `DECOUPLING_DEFAULTS`. */
  decoupling?: DecouplingOptions
}

export function analyzeRuns(
  activities: RunActivityRow[],
  zones: { z2Ceiling: number | null; maxHr: number | null },
  opts: AnalyzeRunsOptions = {},
): RunAnalysis {
  const runs = activities.filter((a) => a.type.toLowerCase().includes('run'))

  return {
    easyDayAudit: easyDayAudit(runs, zones.z2Ceiling),
    paceAtFixedHr: paceAtFixedHr(runs, zones.z2Ceiling),
    lthr: estimateLthr(runs, zones.maxHr),
    decoupling: latestDecoupling(runs, opts.decoupling),
    decouplingTrend: decouplingTrend(runs, opts.decoupling),
  }
}
