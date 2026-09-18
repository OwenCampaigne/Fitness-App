import {
  analyzeRuns,
  decouplingTrend,
  easyDayAudit,
  estimateLthr,
  formatPace,
  latestDecoupling,
  paceAtFixedHr,
  paceSecPerKm,
} from '../runAnalysis'
import { SPLITS_SCHEMA_VERSION, parseGarminSplits } from '../splits'
import type { ActivitySplits } from '../splits'
import type { RunActivityRow } from '../../types/run'

import decoupledLongRun from './fixtures/garmin-splits-decoupled-long-run.json'
import intervalSession from './fixtures/garmin-splits-interval-session.json'
import steadyLongRun from './fixtures/garmin-splits-steady-long-run.json'

function run(
  daysAgo: number,
  durationMin: number | null,
  distanceKm: number | null,
  avgHr: number | null,
  type = 'running',
): RunActivityRow {
  return {
    date: new Date(2026, 7, 20 - daysAgo),
    type,
    durationMin,
    distanceKm,
    avgHr,
    maxHr: avgHr === null ? null : avgHr + 15,
  }
}

// ── Pace helpers ─────────────────────────────────────────────────────────────

describe('paceSecPerKm', () => {
  test('converts duration and distance to seconds per kilometre', () => {
    expect(paceSecPerKm(run(1, 50, 10, 140))).toBe(300) // 5:00/km
  })
  test('returns null without distance', () => {
    expect(paceSecPerKm(run(1, 50, null, 140))).toBeNull()
  })
  test('returns null on zero distance rather than dividing by it', () => {
    expect(paceSecPerKm(run(1, 50, 0, 140))).toBeNull()
  })
})

describe('formatPace', () => {
  test('formats as mm:ss/km', () => {
    expect(formatPace(300)).toBe('5:00/km')
    expect(formatPace(365)).toBe('6:05/km')
  })
  test('renders an em dash for nothing', () => {
    expect(formatPace(null)).toBe('—')
  })
})

// ── easyDayAudit ─────────────────────────────────────────────────────────────

describe('easyDayAudit', () => {
  test('says nothing can be audited without a Zone 2 ceiling', () => {
    const audit = easyDayAudit([run(1, 30, 5, 150)], null)
    expect(audit.runsAudited).toBe(0)
    expect(audit.verdict).toMatch(/no zone 2 ceiling/i)
  })

  test('clean easy running gets a clean verdict', () => {
    const audit = easyDayAudit([run(3, 30, 5, 138), run(2, 30, 5, 142), run(1, 30, 5, 140)], 148)
    expect(audit.runsOverCeiling).toBe(0)
    expect(audit.verdict).toMatch(/easy is actually easy/i)
  })

  test('is blunt when most easy running is not easy', () => {
    const audit = easyDayAudit([run(3, 30, 5, 158), run(2, 30, 5, 162), run(1, 30, 5, 141)], 148)
    expect(audit.runsOverCeiling).toBe(2)
    expect(audit.overCeilingRate).toBeCloseTo(0.67, 1)
    expect(audit.verdict).toMatch(/junk volume/i)
  })

  test('names the worst offenders, hardest first', () => {
    const audit = easyDayAudit([run(3, 30, 5, 158), run(2, 30, 5, 168), run(1, 30, 5, 152)], 148)
    expect(audit.worstOffenders).toHaveLength(3)
    expect(audit.worstOffenders[0].avgHr).toBe(168)
  })

  test('always discloses that it is reading averages, not time in zone', () => {
    const audit = easyDayAudit([run(1, 30, 5, 140)], 148)
    expect(audit.verdict).toMatch(/average heart rate/i)
  })

  test('ignores runs with no heart rate', () => {
    const audit = easyDayAudit([run(2, 30, 5, null), run(1, 30, 5, 140)], 148)
    expect(audit.runsAudited).toBe(1)
  })
})

// ── paceAtFixedHr ────────────────────────────────────────────────────────────

describe('paceAtFixedHr', () => {
  test('needs an anchor to match against', () => {
    expect(paceAtFixedHr([run(1, 30, 5, 145)], null).verdict).toMatch(/no heart-rate anchor/i)
  })

  test('declines to judge on too few samples', () => {
    const result = paceAtFixedHr([run(2, 30, 5, 145), run(1, 30, 5, 146)], 145)
    expect(result.deltaSecPerKm).toBeNull()
    expect(result.verdict).toMatch(/before this comparison means anything/i)
  })

  test('reports faster at the same heart rate as fitness moving', () => {
    const result = paceAtFixedHr(
      [
        run(28, 60, 10, 145), // 6:00/km
        run(24, 60, 10, 146),
        run(6, 55, 10, 145), // 5:30/km
        run(2, 55, 10, 144),
      ],
      145,
    )
    expect(result.deltaSecPerKm).toBe(-30)
    expect(result.verdict).toMatch(/fitness moved/i)
  })

  test('reads slower at the same heart rate as fatigue, not decline', () => {
    const result = paceAtFixedHr(
      [
        run(28, 55, 10, 145),
        run(24, 55, 10, 145),
        run(6, 60, 10, 145),
        run(2, 60, 10, 145),
      ],
      145,
    )
    expect(result.deltaSecPerKm).toBe(30)
    expect(result.verdict).toMatch(/accumulated fatigue/i)
  })

  test('calls a small change flat rather than reading noise as signal', () => {
    const result = paceAtFixedHr(
      [
        run(28, 60, 10, 145),
        run(24, 60, 10, 145),
        run(6, 59, 10, 145),
        run(2, 60, 10, 145),
      ],
      145,
    )
    expect(result.verdict).toMatch(/flat/i)
  })

  test('excludes runs outside the matched heart-rate band', () => {
    const result = paceAtFixedHr(
      [run(4, 30, 5, 175), run(3, 30, 5, 120), run(2, 30, 5, 145), run(1, 30, 5, 146)],
      145,
    )
    expect(result.samples).toBe(2)
  })
})

// ── estimateLthr ─────────────────────────────────────────────────────────────

describe('estimateLthr', () => {
  test('cannot estimate without a max heart rate', () => {
    const est = estimateLthr([run(1, 30, 5, 170)], null)
    expect(est.value).toBeNull()
    expect(est.confidence).toBeLessThan(0.2)
  })

  test('falls back to a population estimate and labels it as one', () => {
    const est = estimateLthr([run(1, 30, 5, 130)], 190)
    expect(est.value).toBe(167) // 88% of 190
    expect(est.source).toBe('estimate')
    expect(est.basis).toMatch(/population estimate/i)
  })

  test('averages sustained hard efforts once there are enough', () => {
    const est = estimateLthr(
      [run(20, 30, 6, 168), run(13, 30, 6, 172), run(6, 30, 6, 170)],
      190,
    )
    expect(est.value).toBe(170)
    expect(est.source).toBe('observed')
  })

  test('one hard effort is not enough to call it observed', () => {
    const est = estimateLthr([run(6, 30, 6, 170)], 190)
    expect(est.source).toBe('estimate')
  })

  test('short hard efforts do not count as sustained', () => {
    const est = estimateLthr([run(6, 8, 2, 175), run(4, 6, 1.5, 178)], 190)
    expect(est.basis).toMatch(/no sustained hard efforts/i)
  })

  test('never claims confirmed without a field test', () => {
    const est = estimateLthr(
      Array.from({ length: 10 }, (_, i) => run(i, 40, 8, 170)),
      190,
    )
    expect(est.source).not.toBe('confirmed')
  })
})

// ── analyzeRuns ──────────────────────────────────────────────────────────────

describe('analyzeRuns', () => {
  const activities = [
    run(20, 60, 10, 145),
    run(14, 60, 10, 146),
    run(7, 55, 10, 145),
    run(2, 55, 10, 144),
    run(1, 45, 0, 0, 'strength_training'),
  ]

  test('considers only running activities', () => {
    const a = analyzeRuns(activities, { z2Ceiling: 148, maxHr: 190 })
    expect(a.easyDayAudit.runsAudited).toBe(4)
  })

  test('is honest that decoupling is not computable yet', () => {
    const a = analyzeRuns(activities, { z2Ceiling: 148, maxHr: 190 })
    expect(a.decoupling.available).toBe(false)
    expect(a.decoupling.reason).toMatch(/not being faked/i)
  })

  test('survives an empty history without throwing', () => {
    const a = analyzeRuns([], { z2Ceiling: null, maxHr: null })
    expect(a.easyDayAudit.runsAudited).toBe(0)
    expect(a.lthr.value).toBeNull()
  })
})

// ── Aerobic decoupling ───────────────────────────────────────────────────────
// The framework's hardest-leaned-on durability signal (§7). It now has real
// per-split data behind it — but the honest refusal is still the answer whenever
// the data does not support a number, which is most of what is tested here.

const NOW = new Date('2026-08-20T06:00:00.000Z')
const steadySplits = parseGarminSplits(steadyLongRun, { now: NOW }) as ActivitySplits
const decoupledSplits = parseGarminSplits(decoupledLongRun, { now: NOW }) as ActivitySplits
const intervalSplits = parseGarminSplits(intervalSession, { now: NOW }) as ActivitySplits

/** A held-effort long run with an arbitrary drift, for building a trend. */
function driftingRun(daysAgo: number, endHr: number): RunActivityRow {
  const splits: ActivitySplits = {
    version: SPLITS_SCHEMA_VERSION,
    source: 'mock',
    activityId: `drift-${daysAgo}`,
    fetchedAt: NOW.toISOString(),
    splits: Array.from({ length: 12 }, (_, i) => {
      const hr = Math.round(140 + ((endHr - 140) * i) / 11)
      return {
        index: i + 1,
        distanceKm: 1,
        durationSec: 330,
        avgHr: hr,
        maxHr: hr + 7,
        paceSecPerKm: 330,
        elevationGainM: 3,
        elevationLossM: 3,
        avgCadenceSpm: 168,
        startTimeGmt: null,
      }
    }),
  }
  return { ...run(daysAgo, 66, 12, 148), splits }
}

function withSplits(daysAgo: number, splits: ActivitySplits): RunActivityRow {
  return { ...run(daysAgo, 66, 12, 148), splits }
}

describe('latestDecoupling', () => {
  test('refuses, and says why, when no run carries splits', () => {
    const result = latestDecoupling([run(3, 60, 10, 145), run(1, 60, 10, 146)])
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/not being faked from averages/i)
    expect(result.reason).toMatch(/2 run/)
  })

  test('refuses on an empty window rather than returning a hollow zero', () => {
    const result = latestDecoupling([])
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/no runs in this window/i)
  })

  test('computes a real number once a run has steady splits', () => {
    const result = latestDecoupling([withSplits(4, steadySplits)])
    expect(result.available).toBe(true)
    if (!result.available) throw new Error('expected a number')
    expect(result.driftPct).toBeCloseTo(2.9, 1)
  })

  test('prefers the most recent qualifying run, not the first one stored', () => {
    const result = latestDecoupling([
      withSplits(20, decoupledSplits),
      withSplits(2, steadySplits),
    ])
    if (!result.available) throw new Error('expected a number')
    expect(result.driftPct).toBeCloseTo(2.9, 1)
  })

  test('skips runs that fail the gate and uses the next one that passes', () => {
    const result = latestDecoupling([
      withSplits(9, steadySplits),
      withSplits(1, intervalSplits),
    ])
    expect(result.available).toBe(true)
  })

  test('reports the newest refusal when nothing qualifies, plus how many were checked', () => {
    const result = latestDecoupling([
      withSplits(9, intervalSplits),
      withSplits(1, intervalSplits),
    ])
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/interval or walk\/run/i)
    expect(result.reason).toMatch(/other 1 run\(s\) with splits/i)
  })
})

describe('decouplingTrend', () => {
  test('says there is no trend when nothing has splits', () => {
    const trend = decouplingTrend([run(1, 60, 10, 145)])
    expect(trend.runsWithSplits).toBe(0)
    expect(trend.meanDriftPct).toBeNull()
    expect(trend.verdict).toMatch(/no durability trend to read yet/i)
  })

  test('counts runs that have splits but did not qualify, without averaging them in', () => {
    const trend = decouplingTrend([withSplits(2, intervalSplits)])
    expect(trend.runsWithSplits).toBe(1)
    expect(trend.runsQualifying).toBe(0)
    expect(trend.meanDriftPct).toBeNull()
    expect(trend.verdict).toMatch(/none were steady enough/i)
  })

  test('declines to call a direction on fewer than four qualifying runs', () => {
    const trend = decouplingTrend([driftingRun(14, 150), driftingRun(7, 152)])
    expect(trend.runsQualifying).toBe(2)
    expect(trend.meanDriftPct).not.toBeNull()
    expect(trend.deltaPct).toBeNull()
    expect(trend.verdict).toMatch(/before a direction means anything/i)
  })

  test('reads falling drift as durability improving', () => {
    const trend = decouplingTrend([
      driftingRun(28, 166),
      driftingRun(21, 164),
      driftingRun(14, 150),
      driftingRun(7, 148),
    ])
    expect(trend.deltaPct).toBeLessThan(-1)
    expect(trend.verdict).toMatch(/durability is improving/i)
  })

  test('reads rising drift as a load question, not a fitness verdict', () => {
    const trend = decouplingTrend([
      driftingRun(28, 148),
      driftingRun(21, 150),
      driftingRun(14, 164),
      driftingRun(7, 166),
    ])
    expect(trend.deltaPct).toBeGreaterThan(1)
    expect(trend.verdict).toMatch(/check the load trend/i)
  })

  test('history is oldest first, so a chart can plot it directly', () => {
    const trend = decouplingTrend([driftingRun(7, 150), driftingRun(28, 160)])
    expect(trend.history).toHaveLength(2)
    expect(trend.history[0].date.getTime()).toBeLessThan(trend.history[1].date.getTime())
  })
})

describe('analyzeRuns with splits', () => {
  test('surfaces both the latest figure and the trend', () => {
    const a = analyzeRuns(
      [driftingRun(21, 164), driftingRun(14, 152), driftingRun(7, 150), run(1, 45, 0, 0, 'strength_training')],
      { z2Ceiling: 148, maxHr: 190 },
    )
    expect(a.decoupling.available).toBe(true)
    expect(a.decouplingTrend.runsQualifying).toBe(3)
  })

  test('ignores splits on non-running activities', () => {
    const lift = { ...withSplits(1, steadySplits), type: 'strength_training' }
    const a = analyzeRuns([lift], { z2Ceiling: 148, maxHr: 190 })
    expect(a.decoupling.available).toBe(false)
    expect(a.decouplingTrend.runsWithSplits).toBe(0)
  })

  test('gate options reach the decoupling maths from the top-level call', () => {
    const short = { ...withSplits(1, steadySplits) }
    expect(analyzeRuns([short], { z2Ceiling: 148, maxHr: 190 }).decoupling.available).toBe(true)
    expect(
      analyzeRuns([short], { z2Ceiling: 148, maxHr: 190 }, { decoupling: { minDurationMin: 999 } })
        .decoupling.available,
    ).toBe(false)
  })
})
