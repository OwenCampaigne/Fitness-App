// ── Splits parsing and aerobic decoupling ─────────────────────────────────────
// Every fixture in ./fixtures is a recorded-shape Garmin lap payload. No live
// credentials exist in this environment, so the fixtures are the contract: if
// Garmin's real response matches these shapes, the parser is proven.

import {
  DECOUPLING_DEFAULTS,
  SPLITS_SCHEMA_VERSION,
  computeDecoupling,
  parseGarminSplits,
  parseStoredSplits,
  serializeSplits,
  splitsTotals,
} from '../splits'
import type { ActivitySplits, RunSplit } from '../splits'
import { buildMockSplits, mockRunSplits, mockWalkRunSplits } from '../mockData'

import bareArray from './fixtures/garmin-splits-bare-array.json'
import decoupledLongRun from './fixtures/garmin-splits-decoupled-long-run.json'
import intervalSession from './fixtures/garmin-splits-interval-session.json'
import noHeartRate from './fixtures/garmin-splits-no-heart-rate.json'
import progressionRun from './fixtures/garmin-splits-progression-run.json'
import shortShakeout from './fixtures/garmin-splits-short-shakeout.json'
import steadyLongRun from './fixtures/garmin-splits-steady-long-run.json'
import typedSplits from './fixtures/garmin-typedsplits-envelope.json'

const NOW = new Date('2026-08-20T06:00:00.000Z')
const parse = (raw: unknown) => parseGarminSplits(raw, { now: NOW })

/** Build a synthetic split list for the cases no fixture covers cleanly. */
function synth(
  rows: Array<{ km?: number; sec: number; hr: number | null }>,
  source: ActivitySplits['source'] = 'mock',
): ActivitySplits {
  return {
    version: SPLITS_SCHEMA_VERSION,
    source,
    activityId: 'synthetic',
    fetchedAt: NOW.toISOString(),
    splits: rows.map((r, i): RunSplit => {
      const km = r.km ?? 1
      return {
        index: i + 1,
        distanceKm: km,
        durationSec: r.sec,
        avgHr: r.hr,
        maxHr: r.hr === null ? null : r.hr + 8,
        paceSecPerKm: km > 0 ? Math.round(r.sec / km) : null,
        elevationGainM: 3,
        elevationLossM: 3,
        avgCadenceSpm: 168,
        startTimeGmt: null,
      }
    }),
  }
}

// ── parseGarminSplits ────────────────────────────────────────────────────────

describe('parseGarminSplits', () => {
  test('reads the lapDTOs envelope the splits endpoint returns', () => {
    const parsed = parse(steadyLongRun)
    expect(parsed).not.toBeNull()
    expect(parsed?.source).toBe('garmin_laps')
    expect(parsed?.activityId).toBe('18234567890')
    expect(parsed?.version).toBe(SPLITS_SCHEMA_VERSION)
    expect(parsed?.splits).toHaveLength(13)
  })

  test('reads the typedsplits envelope and labels where it came from', () => {
    const parsed = parse(typedSplits)
    expect(parsed?.source).toBe('garmin_typed_splits')
    expect(parsed?.splits).toHaveLength(3)
  })

  test('accepts a bare array, which some responses are', () => {
    const parsed = parse(bareArray)
    expect(parsed?.splits).toHaveLength(2)
    expect(parsed?.activityId).toBeNull()
  })

  test('converts metres to kilometres and derives pace per split', () => {
    const first = parse(steadyLongRun)?.splits[0]
    expect(first?.distanceKm).toBe(1)
    expect(first?.durationSec).toBe(330)
    expect(first?.paceSecPerKm).toBe(330)
    expect(first?.avgHr).toBe(142)
  })

  test('keeps elevation and cadence, preferring the unambiguous steps-per-minute field', () => {
    const first = parse(steadyLongRun)?.splits[0]
    // The fixture carries averageRunCadence 84 (one leg) alongside 168 (both).
    expect(first?.avgCadenceSpm).toBe(168)
    expect(first?.elevationGainM).toBe(4)
    expect(first?.elevationLossM).toBe(3)
  })

  test('keeps the partial closing lap rather than silently dropping it', () => {
    const parsed = parse(steadyLongRun)
    const last = parsed?.splits[parsed.splits.length - 1]
    expect(last?.distanceKm).toBe(0.34)
  })

  test('keeps splits with no heart rate, so the gap is visible downstream', () => {
    const parsed = parse(noHeartRate)
    expect(parsed?.splits).toHaveLength(10)
    expect(parsed?.splits.every((s) => s.avgHr === null)).toBe(true)
  })

  test('prefers moving duration over elapsed when the two differ', () => {
    const parsed = parse([
      { lapIndex: 1, distance: 1000, duration: 400, movingDuration: 330, averageHR: 140 },
    ])
    expect(parsed?.splits[0].durationSec).toBe(330)
  })

  test('falls back to average speed when a lap reports no distance', () => {
    const parsed = parse([
      { lapIndex: 1, distance: 0, duration: 300, averageSpeed: 2.5, averageHR: 140 },
    ])
    expect(parsed?.splits[0].paceSecPerKm).toBe(400)
  })

  test('drops laps with no elapsed time — a recording artefact, not a split', () => {
    const parsed = parse([
      { lapIndex: 1, distance: 1000, duration: 330, averageHR: 140 },
      { lapIndex: 2, distance: 0, duration: 0, averageHR: 0 },
    ])
    expect(parsed?.splits).toHaveLength(1)
  })

  test('returns null rather than an empty blob when there is nothing to store', () => {
    expect(parse(null)).toBeNull()
    expect(parse({})).toBeNull()
    expect(parse([])).toBeNull()
    expect(parse({ lapDTOs: [] })).toBeNull()
    expect(parse('')).toBeNull()
  })

  test('an explicit activity id overrides whatever the payload carried', () => {
    expect(parseGarminSplits(steadyLongRun, { now: NOW, activityId: 'forced' })?.activityId).toBe(
      'forced',
    )
  })
})

// ── Round-tripping through the database column ───────────────────────────────

describe('serializeSplits / parseStoredSplits', () => {
  test('round-trips without losing a split', () => {
    const parsed = parse(steadyLongRun) as ActivitySplits
    const back = parseStoredSplits(serializeSplits(parsed))
    expect(back?.splits).toHaveLength(parsed.splits.length)
    expect(back?.activityId).toBe(parsed.activityId)
    expect(back?.version).toBe(SPLITS_SCHEMA_VERSION)
  })

  test('malformed or empty stored JSON returns null instead of throwing', () => {
    expect(parseStoredSplits(null)).toBeNull()
    expect(parseStoredSplits('')).toBeNull()
    expect(parseStoredSplits('{ not json')).toBeNull()
    expect(parseStoredSplits('[]')).toBeNull()
    expect(parseStoredSplits('{"version":1,"splits":[]}')).toBeNull()
  })
})

describe('splitsTotals', () => {
  test('sums distance and moving time across every stored split', () => {
    const totals = splitsTotals(parse(steadyLongRun) as ActivitySplits)
    expect(totals.splits).toBe(13)
    expect(totals.distanceKm).toBeCloseTo(12.34, 2)
    expect(totals.durationMin).toBeCloseTo(67.9, 1)
  })
})

// ── computeDecoupling — what it refuses ──────────────────────────────────────

describe('computeDecoupling gate', () => {
  test('refuses with no splits at all', () => {
    const d = computeDecoupling(null)
    expect(d.available).toBe(false)
    expect(d.reason).toMatch(/no per-split data/i)
  })

  test('refuses when too few splits carry both distance and heart rate', () => {
    const d = computeDecoupling(parse(typedSplits))
    expect(d.available).toBe(false)
    expect(d.reason).toMatch(/are needed so each half has at least two/i)
  })

  test('a run recorded without heart rate cannot produce a ratio', () => {
    const d = computeDecoupling(parse(noHeartRate))
    expect(d.available).toBe(false)
    expect(d.reason).toMatch(/0 of 10 split/i)
  })

  test('refuses a run shorter than cardiac drift needs, and says how short', () => {
    const d = computeDecoupling(parse(shortShakeout))
    expect(d.available).toBe(false)
    expect(d.reason).toMatch(/22 min/)
    expect(d.reason).toMatch(/cardiac drift/i)
  })

  test('refuses an interval session and names the pace variation that gave it away', () => {
    const d = computeDecoupling(parse(intervalSession))
    expect(d.available).toBe(false)
    expect(d.reason).toMatch(/interval or walk\/run/i)
    expect(d.reason).toMatch(/30%/)
  })

  test('refuses a progression run — the effort changed, so the method does not apply', () => {
    const d = computeDecoupling(parse(progressionRun))
    expect(d.available).toBe(false)
    expect(d.reason).toMatch(/progression run/i)
  })

  test('refuses a ramped effort even when the pace looked even', () => {
    // Even 5:30/km throughout, but heart rate climbing 135 → 175: the athlete
    // was working progressively harder, so there is no held effort to measure.
    const hrs = [135, 141, 147, 153, 159, 165, 170, 175]
    const d = computeDecoupling(synth(hrs.map((hr) => ({ sec: 330, hr }))))
    expect(d.available).toBe(false)
    expect(d.reason).toMatch(/heart rate varied/i)
  })

  test('a slower second half is never a reason to refuse — that is the signal', () => {
    const d = computeDecoupling(
      synth([
        { sec: 330, hr: 140 },
        { sec: 332, hr: 143 },
        { sec: 334, hr: 146 },
        { sec: 336, hr: 148 },
        { sec: 344, hr: 150 },
        { sec: 348, hr: 152 },
      ]),
    )
    expect(d.available).toBe(true)
  })

  test('gate thresholds are overridable, so a caller can loosen them deliberately', () => {
    const short = parse(shortShakeout)
    expect(computeDecoupling(short).available).toBe(false)
    expect(computeDecoupling(short, { minDurationMin: 20 }).available).toBe(true)
  })
})

// ── computeDecoupling — what it reports ──────────────────────────────────────

describe('computeDecoupling result', () => {
  const steady = computeDecoupling(parse(steadyLongRun))
  const decoupled = computeDecoupling(parse(decoupledLongRun))

  test('a held effort with gentle heart-rate drift lands under five percent', () => {
    expect(steady.available).toBe(true)
    if (!steady.available) throw new Error('expected a number')
    expect(steady.driftPct).toBeCloseTo(2.9, 1)
    expect(steady.verdict).toMatch(/aerobic base that holds/i)
  })

  test('it trims the partial closing lap and says that it did', () => {
    if (!steady.available) throw new Error('expected a number')
    expect(steady.splitsUsed).toBe(12)
    expect(steady.reason).toMatch(/trimming 1 partial lap/i)
  })

  test('the two halves are balanced by elapsed time, not by split count', () => {
    if (!steady.available) throw new Error('expected a number')
    expect(steady.first.durationMin).toBeCloseTo(steady.second.durationMin, 0)
    expect(steady.first.splits + steady.second.splits).toBe(steady.splitsUsed)
  })

  test('heart rate per half is duration-weighted, not a flat mean of splits', () => {
    // The first half is two long 140 bpm laps and one short 152 bpm lap. A flat
    // mean of {140, 140, 152} is 144; weighting by the time actually spent gives
    // 142.4, which is what the heart was really doing.
    const d = computeDecoupling(
      synth([
        { km: 2, sec: 660, hr: 140 },
        { km: 2, sec: 660, hr: 140 },
        { km: 1, sec: 330, hr: 152 },
        { km: 2, sec: 660, hr: 150 },
        { km: 2, sec: 660, hr: 150 },
        { km: 1, sec: 330, hr: 150 },
      ]),
    )
    if (!d.available) throw new Error('expected a number')
    expect(d.first.splits).toBe(3)
    expect(d.first.avgHr).toBeCloseTo(142.4, 1)
    expect(d.first.avgHr).not.toBeCloseTo(144, 1)
  })

  test('a run that outlasted its engine is called out past ten percent', () => {
    expect(decoupled.available).toBe(true)
    if (!decoupled.available) throw new Error('expected a number')
    expect(decoupled.driftPct).toBeGreaterThan(10)
    expect(decoupled.verdict).toMatch(/outlasted the engine/i)
    expect(decoupled.second.avgHr).toBeGreaterThan(decoupled.first.avgHr)
  })

  test('the five-to-ten band reads as stretched rather than broken', () => {
    const d = computeDecoupling(
      synth([
        { sec: 330, hr: 140 },
        { sec: 330, hr: 141 },
        { sec: 330, hr: 142 },
        { sec: 330, hr: 143 },
        { sec: 335, hr: 148 },
        { sec: 336, hr: 149 },
        { sec: 337, hr: 150 },
        { sec: 338, hr: 151 },
      ]),
    )
    if (!d.available) throw new Error('expected a number')
    expect(d.driftPct).toBeGreaterThan(5)
    expect(d.driftPct).toBeLessThan(10)
    expect(d.verdict).toMatch(/being stretched/i)
  })

  test('an improving ratio is reported as no problem, not as a fitness gain', () => {
    const d = computeDecoupling(
      synth([
        { sec: 340, hr: 150 },
        { sec: 338, hr: 149 },
        { sec: 336, hr: 148 },
        { sec: 335, hr: 147 },
        { sec: 334, hr: 143 },
        { sec: 333, hr: 142 },
        { sec: 332, hr: 141 },
        { sec: 331, hr: 140 },
      ]),
    )
    if (!d.available) throw new Error('expected a number')
    expect(d.driftPct).toBeLessThan(0)
    expect(d.verdict).toMatch(/not as a gain/i)
  })

  test('the efficiency factor is speed over heart rate, so slower or hotter lowers it', () => {
    if (!decoupled.available) throw new Error('expected a number')
    expect(decoupled.second.efficiencyFactor).toBeLessThan(decoupled.first.efficiencyFactor)
    // Compared against the reported (rounded) pace, so a loose tolerance: the
    // factor itself is computed from the raw distance and time.
    const expected = 1000 / decoupled.first.paceSecPerKm / decoupled.first.avgHr
    expect(decoupled.first.efficiencyFactor).toBeCloseTo(expected, 4)
  })

  test('every refusal carries a reason, so nothing ever returns a bare false', () => {
    const refusals = [
      computeDecoupling(null),
      computeDecoupling(parse(shortShakeout)),
      computeDecoupling(parse(intervalSession)),
      computeDecoupling(parse(progressionRun)),
      computeDecoupling(parse(noHeartRate)),
    ]
    for (const r of refusals) {
      expect(r.available).toBe(false)
      expect(r.reason.length).toBeGreaterThan(20)
    }
  })

  test('mock splits run through the same parser, gate and maths as live data', () => {
    // Framework §16: every feature works in mock mode first. If the mock long
    // run cannot produce a figure, the whole durability path is untestable
    // without a watch and a month of waiting.
    const d = computeDecoupling(mockRunSplits)
    expect(mockRunSplits.source).toBe('mock')
    expect(d.available).toBe(true)
    if (!d.available) throw new Error('expected a number')
    expect(d.driftPct).toBeGreaterThan(0)
    expect(d.driftPct).toBeLessThan(5)
    expect(d.verdict).toMatch(/aerobic base that holds/i)
  })

  test('the mock walk/run is refused, so the negative path is mockable too', () => {
    const d = computeDecoupling(mockWalkRunSplits)
    expect(d.available).toBe(false)
    expect(d.reason).toMatch(/interval or walk\/run/i)
  })

  test('the mock generator is deterministic and drifts the way it was asked to', () => {
    const spec = {
      km: 12,
      startPaceSecPerKm: 340,
      endPaceSecPerKm: 340,
      startHr: 140,
      endHr: 168,
      startTime: NOW,
    }
    const a = buildMockSplits(spec)
    const b = buildMockSplits(spec)
    expect(a.splits).toEqual(b.splits)
    expect(a.splits[0].avgHr).toBe(140)
    expect(a.splits[a.splits.length - 1].avgHr).toBe(168)
    const d = computeDecoupling(a, { maxHrCv: 0.2 })
    if (!d.available) throw new Error('expected a number')
    expect(d.driftPct).toBeGreaterThan(5)
  })

  test('the published defaults are the ones the gate actually applies', () => {
    expect(DECOUPLING_DEFAULTS.minDurationMin).toBe(30)
    expect(DECOUPLING_DEFAULTS.minSplits).toBe(4)
    const d = computeDecoupling(parse(steadyLongRun), DECOUPLING_DEFAULTS)
    const same = computeDecoupling(parse(steadyLongRun))
    expect(d).toEqual(same)
  })
})
