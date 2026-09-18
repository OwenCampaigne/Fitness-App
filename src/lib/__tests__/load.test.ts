import {
  ACWR_LOWER,
  ACWR_UPPER,
  CALIBRATION_ACWR_CAP,
  HARD_DAY_SRPE,
  acwrVerdict,
  acwrZone,
  computeAcwr,
  computeDailyBudget,
  crossCheckPlyoLoad,
  crossCheckRunLoad,
  dailyLoadSeries,
  estimateItemCost,
  isHardEffort,
  loadFromTrimp,
  scaleItem,
  sessionCost,
  sessionLoad,
  trainingStrain,
  weeklyMonotony,
  weeklyRampCeiling,
} from '../load'
import type { SessionBlock, SessionItem } from '../../types/session'

// ── Fixtures ─────────────────────────────────────────────────────────────────

function strengthItem(over: Partial<SessionItem> = {}): SessionItem {
  return {
    id: 'i-squat',
    ref: { kind: 'exercise', id: 'back-squat', name: 'Back Squat' },
    params: { kind: 'strength', sets: 3, reps: 8, weightKg: 60, targetRir: 2, restSec: 150 },
    status: 'prescribed',
    ...over,
  }
}

function runItem(over: Partial<SessionItem> = {}): SessionItem {
  return {
    id: 'i-run',
    ref: { kind: 'run', id: 'easy', name: 'Easy run' },
    params: { kind: 'run', runType: 'easy', durationMin: 45 },
    status: 'prescribed',
    ...over,
  }
}

function plyoItem(over: Partial<SessionItem> = {}): SessionItem {
  return {
    id: 'i-pogo',
    ref: { kind: 'plyo', id: 'pogo-hops', name: 'Pogo hops' },
    params: { kind: 'contacts', sets: 3, contactsPerSet: 20, restSec: 60 },
    status: 'prescribed',
    ...over,
  }
}

function holdItem(over: Partial<SessionItem> = {}): SessionItem {
  return {
    id: 'i-calf',
    ref: { kind: 'prehab', id: 'heel-drop', name: 'Eccentric heel drop' },
    params: { kind: 'hold', sets: 3, reps: 15, holdSec: 3, perSide: true },
    status: 'prescribed',
    ...over,
  }
}

function day(offsetDays: number, load: number) {
  const d = new Date('2026-03-15T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - offsetDays)
  return { date: d, load }
}

const STEADY_28 = new Array(28).fill(300)

// ── sessionLoad ──────────────────────────────────────────────────────────────

describe('sessionLoad', () => {
  test('is duration in minutes times sRPE (framework §3)', () => {
    expect(sessionLoad(60, 5)).toBe(300)
    expect(sessionLoad(45, 8)).toBe(360)
  })
  test('clamps sRPE into the 0–10 scale rather than trusting the caller', () => {
    expect(sessionLoad(60, 14)).toBe(600)
    expect(sessionLoad(60, -3)).toBe(0)
  })
  test('a negative or missing duration costs nothing', () => {
    expect(sessionLoad(-10, 5)).toBe(0)
    expect(sessionLoad(0, 9)).toBe(0)
  })
})

describe('isHardEffort', () => {
  test('sRPE at or above the hard-day threshold is a hard effort', () => {
    expect(isHardEffort({ durationMin: 40, srpe: HARD_DAY_SRPE, load: 280, hardness: 7 })).toBe(true)
    expect(isHardEffort({ durationMin: 60, srpe: 4, load: 240, hardness: 4 })).toBe(false)
  })
})

// ── Cross-checks ─────────────────────────────────────────────────────────────

describe('loadFromTrimp', () => {
  test('converts Bannister TRIMP onto the sRPE load scale', () => {
    // A 60-min easy run is ~115 TRIMP and ~240 sRPE load — roughly 2× (§3).
    expect(loadFromTrimp(115)).toBeCloseTo(230, 0)
  })
})

describe('crossCheckRunLoad', () => {
  test('uses sRPE alone when Garmin gave no TRIMP', () => {
    const r = crossCheckRunLoad({ durationMin: 60, srpe: 4 })
    expect(r.load).toBe(240)
    expect(r.source).toBe('srpe')
  })
  test('falls back to TRIMP when the athlete never rated the session', () => {
    const r = crossCheckRunLoad({ durationMin: 60, trimp: 115 })
    expect(r.source).toBe('trimp')
    expect(r.load).toBeCloseTo(230, 0)
  })
  test('blends the two when they agree, and says confidence is high', () => {
    const r = crossCheckRunLoad({ durationMin: 60, srpe: 4, trimp: 115 })
    expect(r.source).toBe('blended')
    expect(r.confidence).toBe('high')
    expect(r.load).toBeGreaterThan(230)
    expect(r.load).toBeLessThan(240)
  })
  test('flags a disagreement instead of silently averaging it away', () => {
    // 60 min rated sRPE 2 (=120) against 300 TRIMP (=600) — one of them is wrong.
    const r = crossCheckRunLoad({ durationMin: 60, srpe: 2, trimp: 300 })
    expect(r.confidence).toBe('low')
    expect(r.note).toMatch(/disagree/i)
  })
  test('returns a zero load with a note when it has nothing to go on', () => {
    const r = crossCheckRunLoad({ durationMin: 60 })
    expect(r.load).toBe(0)
    expect(r.confidence).toBe('low')
  })
})

describe('crossCheckPlyoLoad', () => {
  test('prices a short, contact-dense session off contacts, not the clock', () => {
    // 12 min × sRPE 6 = 72 by the clock; 120 contacts is the real cost.
    const r = crossCheckPlyoLoad({ durationMin: 12, srpe: 6, contacts: 120 })
    expect(r.source).toBe('contacts')
    expect(r.load).toBeGreaterThan(72)
  })
  test('uses the clock when no contacts were counted', () => {
    const r = crossCheckPlyoLoad({ durationMin: 20, srpe: 6 })
    expect(r.source).toBe('srpe')
    expect(r.load).toBe(120)
  })
})

// ── Rolling series and ACWR ──────────────────────────────────────────────────

describe('dailyLoadSeries', () => {
  test('buckets entries by day and zero-fills the rest days', () => {
    const series = dailyLoadSeries([day(0, 300), day(2, 400)], new Date('2026-03-15T00:00:00Z'), 4)
    expect(series).toHaveLength(4)
    expect(series[3]).toBe(300) // today
    expect(series[2]).toBe(0)
    expect(series[1]).toBe(400)
  })
  test('sums two sessions logged on the same day', () => {
    const series = dailyLoadSeries([day(1, 200), day(1, 150)], new Date('2026-03-15T00:00:00Z'), 3)
    expect(series[1]).toBe(350)
  })
  test('ignores entries outside the window', () => {
    const series = dailyLoadSeries([day(40, 900)], new Date('2026-03-15T00:00:00Z'), 7)
    expect(series.reduce((a, b) => a + b, 0)).toBe(0)
  })
})

describe('computeAcwr', () => {
  test('steady training sits at 1.0', () => {
    expect(computeAcwr(STEADY_28).acwr).toBeCloseTo(1.0, 2)
  })
  test('a spike week pushes ACWR above the upper band', () => {
    const spiked = [...new Array(21).fill(200), ...new Array(7).fill(500)]
    expect(computeAcwr(spiked).acwr).toBeGreaterThan(ACWR_UPPER)
  })
  test('a layoff pushes ACWR below the lower band', () => {
    const layoff = [...new Array(21).fill(400), ...new Array(7).fill(50)]
    expect(computeAcwr(layoff).acwr).toBeLessThan(ACWR_LOWER)
  })
  test('confidence degrades when there is not yet 28 days of history (§5b)', () => {
    expect(computeAcwr(new Array(28).fill(300)).confidence).toBe('high')
    expect(computeAcwr(new Array(20).fill(300)).confidence).toBe('moderate')
    expect(computeAcwr(new Array(6).fill(300)).confidence).toBe('low')
  })
  test('an empty history reports 1.0 rather than dividing by zero', () => {
    const r = computeAcwr([])
    expect(r.acwr).toBe(1)
    expect(r.confidence).toBe('low')
  })
})

describe('acwrZone / acwrVerdict', () => {
  test('bands the ratio the way framework §3 does', () => {
    expect(acwrZone(0.6)).toBe('detraining')
    expect(acwrZone(1.0)).toBe('optimal')
    expect(acwrZone(1.4)).toBe('caution')
    expect(acwrZone(1.8)).toBe('danger')
  })
  test('the verdict says whether the ratio is inside the band', () => {
    expect(acwrVerdict(1.0).inBand).toBe(true)
    expect(acwrVerdict(1.6).inBand).toBe(false)
    expect(acwrVerdict(1.6).message).toMatch(/\d/)
  })
  test('calibration narrows the band (§5b conservative posture)', () => {
    expect(acwrVerdict(1.2, { calibrating: true }).inBand).toBe(false)
    expect(acwrVerdict(1.2, { calibrating: false }).inBand).toBe(true)
  })
})

describe('weeklyMonotony / trainingStrain', () => {
  test('an identical load every day is maximally monotonous (§17)', () => {
    const flat = weeklyMonotony([300, 300, 300, 300, 300, 300, 300])
    const varied = weeklyMonotony([500, 100, 400, 0, 600, 150, 300])
    expect(flat).toBeGreaterThan(varied)
  })
  test('strain is the week total times monotony', () => {
    const week = [500, 100, 400, 0, 600, 150, 300]
    expect(trainingStrain(week)).toBeCloseTo(
      week.reduce((a, b) => a + b, 0) * weeklyMonotony(week),
      4,
    )
  })
  test('a week of nothing has no strain and does not divide by zero', () => {
    expect(Number.isFinite(trainingStrain([0, 0, 0, 0, 0, 0, 0]))).toBe(true)
    expect(trainingStrain([0, 0, 0, 0, 0, 0, 0])).toBe(0)
  })
})

describe('weeklyRampCeiling', () => {
  test('allows about 10% more than last week (§5a)', () => {
    expect(weeklyRampCeiling(1000, false)).toBeCloseTo(1100, 5)
  })
  test('halves the ramp while the anchors are still guesses (§5b)', () => {
    expect(weeklyRampCeiling(1000, true)).toBeCloseTo(1050, 5)
  })
  test('gives a cold start something to aim at rather than zero', () => {
    expect(weeklyRampCeiling(0, false)).toBeGreaterThan(0)
  })
})

// ── The daily budget ─────────────────────────────────────────────────────────

describe('computeDailyBudget', () => {
  const steadyGreen = {
    dailyLoads: STEADY_28,
    band: 'green' as const,
    calibrating: false,
  }

  test('a steady green day gets a real ceiling with the reason spelled out', () => {
    const b = computeDailyBudget(steadyGreen)
    expect(b.ceiling).toBeGreaterThan(0)
    expect(b.target).toBeLessThan(b.ceiling)
    expect(b.reasons.length).toBeGreaterThan(0)
    expect(b.acwrCap).toBe(ACWR_UPPER)
  })

  test('the ceiling never exceeds a long-run-sized multiple of the chronic day', () => {
    const b = computeDailyBudget({ ...steadyGreen, dailyLoads: [...new Array(22).fill(300), ...new Array(6).fill(0)] })
    expect(b.ceiling).toBeLessThanOrEqual(300 * 2.5 + 0.001)
  })

  test('amber cuts the ceiling and red cuts it further (§7 readiness veto)', () => {
    const green = computeDailyBudget(steadyGreen).ceiling
    const amber = computeDailyBudget({ ...steadyGreen, band: 'amber' }).ceiling
    const red = computeDailyBudget({ ...steadyGreen, band: 'red' }).ceiling
    expect(amber).toBeLessThan(green)
    expect(red).toBeLessThan(amber)
  })

  test('calibration uses the tighter ACWR cap', () => {
    const b = computeDailyBudget({ ...steadyGreen, calibrating: true })
    expect(b.acwrCap).toBe(CALIBRATION_ACWR_CAP)
    expect(b.ceiling).toBeLessThan(computeDailyBudget(steadyGreen).ceiling)
    expect(b.reasons.join(' ')).toMatch(/calibrat/i)
  })

  test('a logged niggle shrinks the budget further (§9)', () => {
    const plain = computeDailyBudget(steadyGreen).ceiling
    const sore = computeDailyBudget({ ...steadyGreen, painFlagged: true }).ceiling
    expect(sore).toBeLessThan(plain)
  })

  test('a cold start still permits a modest first session rather than nothing', () => {
    const b = computeDailyBudget({ dailyLoads: [], band: 'green', calibrating: true })
    expect(b.ceiling).toBeGreaterThan(0)
    expect(b.chronicDailyLoad).toBe(0)
    expect(b.reasons.join(' ')).toMatch(/no history|cold start/i)
  })

  test('an already-spiked week leaves almost nothing on the table', () => {
    const spiked = [...new Array(21).fill(200), ...new Array(7).fill(700)]
    const b = computeDailyBudget({ dailyLoads: spiked, band: 'green', calibrating: false })
    expect(b.ceiling).toBeLessThan(computeDailyBudget(steadyGreen).ceiling)
    expect(b.acwr).toBeGreaterThan(ACWR_UPPER)
  })

  test('after a layoff the floor asks for work back — the band cuts both ways (§21)', () => {
    const layoff = [...new Array(22).fill(300), ...new Array(6).fill(0)]
    const b = computeDailyBudget({ dailyLoads: layoff, band: 'green', calibrating: false })
    expect(b.floor).toBeGreaterThan(0)
    expect(b.floor).toBeLessThanOrEqual(b.ceiling)
  })

  test('a red day has no floor — rest is the right answer', () => {
    const layoff = [...new Array(22).fill(300), ...new Array(6).fill(0)]
    expect(computeDailyBudget({ dailyLoads: layoff, band: 'red', calibrating: false }).floor).toBe(0)
  })

  test('the weekly ramp cap can bind before the ACWR cap does (§5a)', () => {
    const b = computeDailyBudget({
      ...steadyGreen,
      lastWeekLoad: 2100,
      thisWeekLoadSoFar: 2400,
    })
    expect(b.ceiling).toBe(0)
    expect(b.reasons.join(' ')).toMatch(/week/i)
  })
})

// ── Costing an item ──────────────────────────────────────────────────────────

describe('estimateItemCost', () => {
  test('a strength item costs more as sets go up', () => {
    const three = estimateItemCost(strengthItem())
    const five = estimateItemCost(strengthItem({
      params: { kind: 'strength', sets: 5, reps: 8, weightKg: 60, targetRir: 2, restSec: 150 },
    }))
    expect(five.load).toBeGreaterThan(three.load)
    expect(three.durationMin).toBeGreaterThan(0)
  })

  test('lower RIR is a harder effort', () => {
    const rir4 = estimateItemCost(strengthItem({
      params: { kind: 'strength', sets: 3, reps: 8, weightKg: 60, targetRir: 4, restSec: 150 },
    }))
    const rir0 = estimateItemCost(strengthItem({
      params: { kind: 'strength', sets: 3, reps: 8, weightKg: 60, targetRir: 0, restSec: 150 },
    }))
    expect(rir0.srpe).toBeGreaterThan(rir4.srpe)
  })

  test('bodyweight accessory work is priced cheaper than loaded work', () => {
    const loaded = estimateItemCost(strengthItem())
    const bw = estimateItemCost(strengthItem({
      params: { kind: 'strength', sets: 3, reps: 8, weightKg: null, targetRir: 2, restSec: 150 },
    }))
    expect(bw.srpe).toBeLessThan(loaded.srpe)
  })

  test('a run is priced from the taxonomy intensity, not a flat rate (§7)', () => {
    const easy = estimateItemCost(runItem())
    const vo2 = estimateItemCost(runItem({
      params: { kind: 'run', runType: 'vo2', durationMin: 45 },
    }))
    expect(vo2.load).toBeGreaterThan(easy.load)
    expect(vo2.hardness).toBeGreaterThanOrEqual(HARD_DAY_SRPE)
  })

  test('a run with only intervals still gets a duration', () => {
    const c = estimateItemCost(runItem({
      params: {
        kind: 'run',
        runType: 'walk_run',
        intervals: [{ repeat: 6, workSec: 120, recoverSec: 60 }],
      },
    }))
    expect(c.durationMin).toBeCloseTo(18, 1)
  })

  test('plyos carry their contact count so the allocator can ramp it (§9)', () => {
    const c = estimateItemCost(plyoItem())
    expect(c.contacts).toBe(60)
    expect(c.load).toBeGreaterThan(0)
  })

  test('routine prehab is near-free in load terms (§9)', () => {
    const c = estimateItemCost(holdItem())
    expect(c.load).toBeLessThan(60)
    expect(c.srpe).toBeLessThanOrEqual(3)
  })

  test('an explicit sRPE from an engine wins over the estimate', () => {
    const c = estimateItemCost(strengthItem(), { srpe: 9 })
    expect(c.srpe).toBe(9)
  })
})

describe('sessionCost', () => {
  test('sums every item across every block', () => {
    const blocks: SessionBlock[] = [
      { id: 'b1', kind: 'warmup', label: 'Warmup', items: [holdItem()] },
      { id: 'b2', kind: 'main', label: 'Main', items: [runItem(), strengthItem()] },
    ]
    const total = sessionCost(blocks)
    const parts =
      estimateItemCost(holdItem()).load +
      estimateItemCost(runItem()).load +
      estimateItemCost(strengthItem()).load
    expect(total.load).toBeCloseTo(parts, 4)
    expect(total.hardness).toBe(
      Math.max(
        estimateItemCost(holdItem()).hardness,
        estimateItemCost(runItem()).hardness,
        estimateItemCost(strengthItem()).hardness,
      ),
    )
  })
  test('an empty session costs nothing', () => {
    expect(sessionCost([]).load).toBe(0)
  })
})

// ── Trimming ─────────────────────────────────────────────────────────────────

describe('scaleItem', () => {
  test('shortens a run rather than deleting it', () => {
    const trimmed = scaleItem(runItem(), 0.5)
    expect(trimmed).not.toBeNull()
    expect((trimmed!.params as { durationMin?: number | null }).durationMin).toBe(23)
  })
  test('drops sets off a lift', () => {
    const trimmed = scaleItem(strengthItem(), 0.6)
    expect((trimmed!.params as { sets: number }).sets).toBe(2)
  })
  test('never scales an item out of existence', () => {
    const trimmed = scaleItem(strengthItem(), 0.01)
    expect((trimmed!.params as { sets: number }).sets).toBe(1)
  })
  test('a factor at or above 1 leaves the item alone', () => {
    expect(scaleItem(runItem(), 1)).toBeNull()
  })
  test('trimming marks the item as edited so the diff shows it', () => {
    expect(scaleItem(runItem(), 0.5)!.status).toBe('edited')
  })
})
