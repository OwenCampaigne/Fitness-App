import { subDays } from 'date-fns'
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

// ── computeMedian ────────────────────────────────────────────────────────────

describe('computeMedian', () => {
  it('returns middle value for odd-length array', () => {
    expect(computeMedian([1, 3, 5])).toBe(3)
  })
  it('returns average of two middles for even-length array', () => {
    expect(computeMedian([1, 2, 3, 4])).toBe(2.5)
  })
  it('handles single value', () => {
    expect(computeMedian([42])).toBe(42)
  })
  it('returns 0 for empty array', () => {
    expect(computeMedian([])).toBe(0)
  })
  it('sorts before computing median', () => {
    expect(computeMedian([5, 1, 3])).toBe(3)
  })
})

// ── estimateSRPE ─────────────────────────────────────────────────────────────

describe('estimateSRPE', () => {
  // age 30 → maxHR = 208 - 0.7*30 = 187 bpm
  it('returns 3 for easy effort (< 60% maxHR)', () => {
    expect(estimateSRPE(100, 30)).toBe(3) // 100/187 = 53%
  })
  it('returns 4 for light effort (60–70% maxHR)', () => {
    expect(estimateSRPE(118, 30)).toBe(4) // 118/187 = 63%
  })
  it('returns 5 for moderate effort (70–80% maxHR)', () => {
    expect(estimateSRPE(140, 30)).toBe(5) // 140/187 = 75%
  })
  it('returns 7 for hard effort (80–90% maxHR)', () => {
    expect(estimateSRPE(158, 30)).toBe(7) // 158/187 = 84%
  })
  it('returns 9 for maximal effort (> 90% maxHR)', () => {
    expect(estimateSRPE(178, 30)).toBe(9) // 178/187 = 95%
  })
})

// ── computeSignals ───────────────────────────────────────────────────────────

function makeRow(date: Date, hrv: number | null, rhr: number | null, sleepScore: number | null): DailyRow {
  return { date, hrv, rhr, sleepScore, sleepHours: null, bodyBattery: null, stress: null }
}

describe('computeSignals', () => {
  it('returns acwr 1.0 when no activity rows', () => {
    const today = new Date(2026, 0, 28, 12, 0, 0)
    const result = computeSignals([], [], today, 30)
    expect(result.acwr).toBe(1.0)
  })

  it('computes hrv ratio from 28-day median', () => {
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
    // median([50,50,50,50,50,50,50,50,50,60]) = (50+50)/2 = 50
    // today hrv = 60 → ratio = 60/50 = 1.2
    expect(result.hrvRatio).toBe(1.2)
  })

  it('returns hrv ratio 1.0 when no hrv data', () => {
    const today = new Date(2026, 0, 28, 12, 0, 0)
    const rows: DailyRow[] = [makeRow(today, null, 60, 75)]
    const result = computeSignals(rows, [], today, 30)
    expect(result.hrvRatio).toBe(1.0)
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
  it('returns green for healthy signals without pain', () => {
    expect(computeBand(goodSignals, false)).toBe('green')
  })
  it('returns red when HRV ratio below 0.80', () => {
    expect(computeBand({ ...goodSignals, hrvRatio: 0.79 }, false)).toBe('red')
  })
  it('returns red when RHR delta above 7', () => {
    expect(computeBand({ ...goodSignals, rhrDelta: 8 }, false)).toBe('red')
  })
  it('returns red when sleep score below 40', () => {
    expect(computeBand({ ...goodSignals, sleepScore: 39 }, false)).toBe('red')
  })
  it('returns red when ACWR above 1.5', () => {
    expect(computeBand({ ...goodSignals, acwr: 1.6 }, false)).toBe('red')
  })
  it('returns amber when pain flagged even with green signals', () => {
    expect(computeBand(goodSignals, true)).toBe('amber')
  })
  it('returns amber when HRV is borderline (0.90–0.95)', () => {
    expect(computeBand({ ...goodSignals, hrvRatio: 0.92 }, false)).toBe('amber')
  })
  it('returns green at acwr 1.2 with default cap 1.3', () => {
    expect(computeBand({ ...goodSignals, acwr: 1.2 }, false, 1.3)).toBe('green')
  })
  it('returns amber at acwr 1.2 with tighter cap 1.1 (calibration window)', () => {
    expect(computeBand({ ...goodSignals, acwr: 1.2 }, false, 1.1)).toBe('amber')
  })
})

// ── getDecidingSignals ────────────────────────────────────────────────────────

describe('getDecidingSignals', () => {
  it('puts knee pain first when pain is flagged', () => {
    const [first] = getDecidingSignals(goodSignals, 'amber', true)
    expect(first).toBe('Knee pain flagged')
  })
  it('picks the two highest-deviation signals', () => {
    // HRV very low (big deviation) + RHR very high (big deviation)
    const signals: ReadinessSignals = { hrvRatio: 0.70, rhrDelta: 10, sleepScore: 70, acwr: 1.0 }
    const [first, second] = getDecidingSignals(signals, 'red', false)
    expect(first).toMatch(/HRV 0\.70/)
    expect(second).toMatch(/RHR \+10/)
  })
})

// ── getPlainText ──────────────────────────────────────────────────────────────

describe('getPlainText', () => {
  it('returns correct text for each band', () => {
    expect(getPlainText('green')).toBe('Ready to train')
    expect(getPlainText('amber')).toBe('Take it easy today')
    expect(getPlainText('red')).toBe('Rest and recover')
  })
})
