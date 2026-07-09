import {
  computeMedian,
  estimateSRPE,
  computeSignals,
  computeBand,
  getDecidingSignals,
  getPlainText,
  type DailyRow,
  type ActivityRow,
} from '../readiness'
import type { ReadinessSignals } from '../../types/readiness'

// ── Helpers ──
function makeRow(date: Date, hrv: number | null, rhr: number | null, sleepScore: number | null): DailyRow {
  return { date, hrv, rhr, sleepScore, sleepHours: null, bodyBattery: null, stress: null }
}

// ── computeMedian ────────────────────────────────────────────────────────────

describe('computeMedian', () => {
  test('returns middle value for odd-length array', () => {
    expect(computeMedian([1, 3, 5])).toBe(3)
  })
  test('returns average of two middles for even-length array', () => {
    expect(computeMedian([1, 2, 3, 4])).toBe(2.5)
  })
  test('handles single value', () => {
    expect(computeMedian([42])).toBe(42)
  })
  test('returns 0 for empty array', () => {
    expect(computeMedian([])).toBe(0)
  })
  test('sorts before computing median', () => {
    expect(computeMedian([5, 1, 3])).toBe(3)
  })
})

// ── estimateSRPE ─────────────────────────────────────────────────────────────

describe('estimateSRPE', () => {
  // age 30 → maxHR = 208 - 0.7*30 = 187 bpm
  test('returns 3 for easy effort (< 60% maxHR)', () => {
    expect(estimateSRPE(100, 30)).toBe(3) // 100/187 = 53%
  })
  test('returns 4 for light effort (60–70% maxHR)', () => {
    expect(estimateSRPE(118, 30)).toBe(4) // 118/187 = 63%
  })
  test('returns 5 for moderate effort (70–80% maxHR)', () => {
    expect(estimateSRPE(140, 30)).toBe(5) // 140/187 = 75%
  })
  test('returns 7 for hard effort (80–90% maxHR)', () => {
    expect(estimateSRPE(158, 30)).toBe(7) // 158/187 = 84%
  })
  test('returns 9 for maximal effort (> 90% maxHR)', () => {
    expect(estimateSRPE(178, 30)).toBe(9) // 178/187 = 95%
  })
})

// ── computeSignals ───────────────────────────────────────────────────────────

describe('computeSignals', () => {
  test('returns acwr 1.0 when no activity rows', () => {
    const today = new Date(2026, 0, 28, 12, 0, 0)
    const result = computeSignals([], [], today, 30)
    expect(result.acwr).toBe(1.0)
  })

  test('computes hrv ratio from 28-day median', () => {
    // 10 rows: hrv=50 for all days except today which has hrv=60
    const today = new Date(2026, 0, 28, 12, 0, 0)
    const rows: DailyRow[] = Array.from({ length: 10 }, (_, i) =>
      makeRow(
        new Date(2026, 0, 19 + i, 12, 0, 0), // Jan 19–28
        i === 9 ? 60 : 50,  // today (Jan 28, i=9) has hrv=60
        58,
        75,
      )
    )
    const result = computeSignals(rows, [], today, 30)
    // historical median (9 rows, excludes today): median([50...50]) = 50
    // today hrv = 60 → ratio = 60/50 = 1.2
    expect(result.hrvRatio).toBe(1.2)
  })

  test('returns hrv ratio 1.0 when no hrv data', () => {
    const today = new Date(2026, 0, 28, 12, 0, 0)
    const rows: DailyRow[] = [makeRow(today, null, 60, 75)]
    const result = computeSignals(rows, [], today, 30)
    expect(result.hrvRatio).toBe(1.0)
  })

  test('computes acwr > 1.5 when last 7 days are much heavier than prior 21', () => {
    const today = new Date(2026, 0, 28, 12, 0, 0)
    const dailyRows: DailyRow[] = Array.from({ length: 28 }, (_, i) =>
      makeRow(new Date(2026, 0, 1 + i, 12, 0, 0), null, null, null)
    )
    // First 21 days: 30 min easy (avgHr 100, age 30 → sRPE 3, load = 90/day)
    const easyActs: ActivityRow[] = Array.from({ length: 21 }, (_, i) => ({
      date: new Date(2026, 0, 1 + i, 12, 0, 0),
      durationMin: 30,
      avgHr: 100,
    }))
    // Last 7 days: 60 min hard (avgHr 158, age 30 → sRPE 7, load = 420/day)
    const hardActs: ActivityRow[] = Array.from({ length: 7 }, (_, i) => ({
      date: new Date(2026, 0, 22 + i, 12, 0, 0),
      durationMin: 60,
      avgHr: 158,
    }))
    // 7d avg = 420, 28d avg = (21*90 + 7*420)/28 = 172.5, acwr ≈ 2.43
    const result = computeSignals(dailyRows, [...easyActs, ...hardActs], today, 30)
    expect(result.acwr).toBeGreaterThan(1.5)
  })
})

// ── computeBand ──────────────────────────────────────────────────────────────

const goodSignals: ReadinessSignals = {
  hrvRatio: 1.0,
  rhrDelta: 0,
  sleepScore: 75,
  acwr: 1.0,
}

describe('computeBand', () => {
  test('returns green for healthy signals without pain', () => {
    expect(computeBand(goodSignals, false)).toBe('green')
  })
  test('returns red when HRV ratio below 0.80', () => {
    expect(computeBand({ ...goodSignals, hrvRatio: 0.79 }, false)).toBe('red')
  })
  test('returns red when RHR delta above 7', () => {
    expect(computeBand({ ...goodSignals, rhrDelta: 8 }, false)).toBe('red')
  })
  test('returns red when sleep score below 40', () => {
    expect(computeBand({ ...goodSignals, sleepScore: 39 }, false)).toBe('red')
  })
  test('returns red when ACWR above 1.5', () => {
    expect(computeBand({ ...goodSignals, acwr: 1.6 }, false)).toBe('red')
  })
  test('returns amber when pain flagged even with green signals', () => {
    expect(computeBand(goodSignals, true)).toBe('amber')
  })
  test('returns amber when HRV is borderline (0.90–0.95)', () => {
    expect(computeBand({ ...goodSignals, hrvRatio: 0.92 }, false)).toBe('amber')
  })
  test('returns green at acwr 1.2 with default cap 1.3', () => {
    expect(computeBand({ ...goodSignals, acwr: 1.2 }, false, 1.3)).toBe('green')
  })
  test('returns amber at acwr 1.2 with tighter cap 1.1 (calibration window)', () => {
    expect(computeBand({ ...goodSignals, acwr: 1.2 }, false, 1.1)).toBe('amber')
  })
})

// ── getDecidingSignals ────────────────────────────────────────────────────────

describe('getDecidingSignals', () => {
  test('puts knee pain first when pain is flagged', () => {
    const [first] = getDecidingSignals(goodSignals, 'amber', true)
    expect(first).toBe('Pain flagged')
  })
  test('picks the two highest-deviation signals', () => {
    // HRV very low (big deviation) + RHR very high (big deviation)
    const signals: ReadinessSignals = { hrvRatio: 0.70, rhrDelta: 10, sleepScore: 70, acwr: 1.0 }
    const [first, second] = getDecidingSignals(signals, 'red', false)
    expect(first).toMatch(/HRV 0\.70/)
    expect(second).toMatch(/RHR \+10/)
  })
})

// ── getPlainText ──────────────────────────────────────────────────────────────

describe('getPlainText', () => {
  test('returns correct text for each band', () => {
    expect(getPlainText('green')).toBe('Ready to train')
    expect(getPlainText('amber')).toBe('Take it easy today')
    expect(getPlainText('red')).toBe('Rest and recover')
  })
})
