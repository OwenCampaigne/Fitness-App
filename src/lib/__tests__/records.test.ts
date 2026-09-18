import {
  CURRENCY_FLOOR,
  RECORD_HALF_LIFE_DAYS,
  STATED_CONFIDENCE_CEILING,
  closedWeekStarts,
  describeAge,
  detectLiftRecords,
  detectRunRecords,
  diffRecords,
  formatRecordValue,
  recordBand,
  recordCurrency,
  recordFamily,
  rollUpWeek,
  temperedTarget,
  weekStartOf,
} from '../records'
import type { DetectedRecord, StoredRecord, WeekRollupInput } from '../records'
import type { RunActivityRow } from '../../types/run'
import type { ExerciseSessionHistory, LoggedSet } from '../../types/strength'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TODAY = new Date(2026, 8, 14) // Monday 14 Sep 2026, local time

function daysAgo(n: number): Date {
  const d = new Date(TODAY)
  d.setDate(d.getDate() - n)
  return d
}

function sets(
  exerciseId: string,
  weightKg: number | null,
  reps: number,
  rir: number | null,
  count = 3,
): LoggedSet[] {
  return Array.from({ length: count }, (_, i) => ({
    sessionId: 1,
    exerciseId,
    setNumber: i + 1,
    weightKg,
    reps,
    rir,
  }))
}

function liftSession(
  dayOffset: number,
  weightKg: number | null,
  reps = 8,
  rir: number | null = 2,
  exerciseId = 'back-squat',
): ExerciseSessionHistory {
  return {
    sessionId: 1000 + dayOffset,
    date: daysAgo(dayOffset),
    exerciseId,
    sets: sets(exerciseId, weightKg, reps, rir),
  }
}

function run(dayOffset: number, opts: Partial<RunActivityRow> = {}): RunActivityRow {
  return {
    date: daysAgo(dayOffset),
    type: 'running',
    durationMin: 30,
    distanceKm: 5,
    avgHr: 140,
    maxHr: 160,
    ...opts,
  }
}

// ── Lift detection ────────────────────────────────────────────────────────────

describe('detectLiftRecords', () => {
  test('records the heaviest logged load with the reps it was moved for', () => {
    const { records } = detectLiftRecords([
      liftSession(21, 80, 5),
      liftSession(7, 95, 3),
      liftSession(2, 90, 8),
    ])

    const heaviest = records.find((r) => r.kind === 'lift_heaviest')
    expect(heaviest).toBeDefined()
    expect(heaviest!.value).toBe(95)
    expect(heaviest!.reps).toBe(3)
    expect(heaviest!.achievedOn.getTime()).toBe(daysAgo(7).getTime())
    expect(heaviest!.verified).toBe(true)
  })

  test('the best e1RM can sit on a different day than the heaviest load', () => {
    // 100 x 8 @ RIR 2 (10 effective reps) estimates higher than the heavier but
    // very short 110 x 1 @ RIR 5 — which is exactly why both are recorded.
    const { records } = detectLiftRecords([
      liftSession(14, 100, 8, 2),
      liftSession(3, 110, 1, 5),
    ])

    const heaviest = records.find((r) => r.kind === 'lift_heaviest')!
    const e1rm = records.find((r) => r.kind === 'lift_e1rm')!
    expect(heaviest.achievedOn.getTime()).toBe(daysAgo(3).getTime())
    expect(e1rm.achievedOn.getTime()).toBe(daysAgo(14).getTime())
    expect(e1rm.value).toBeGreaterThan(heaviest.value)
  })

  test('an e1RM extrapolated from far off failure is recorded but not verified', () => {
    const { records, refusals } = detectLiftRecords([liftSession(5, 60, 12, 6)])

    const e1rm = records.find((r) => r.kind === 'lift_e1rm')!
    expect(e1rm.verified).toBe(false)
    expect(refusals.some((r) => r.kind === 'lift_e1rm')).toBe(true)
  })

  test('best volume-load is the heaviest total in one session, not the heaviest set', () => {
    const { records } = detectLiftRecords([
      { ...liftSession(10, 100, 3), sets: sets('back-squat', 100, 3, 1, 2) }, // 600
      { ...liftSession(4, 70, 10), sets: sets('back-squat', 70, 10, 2, 4) }, // 2800
    ])

    const volume = records.find((r) => r.kind === 'lift_volume')!
    expect(volume.value).toBe(2800)
    expect(volume.achievedOn.getTime()).toBe(daysAgo(4).getTime())
  })

  test('bodyweight work produces no weight record and says why', () => {
    const { records, refusals } = detectLiftRecords([
      liftSession(6, null, 12, 2, 'nordic-curl'),
    ])

    expect(records.filter((r) => r.subjectId === 'nordic-curl')).toHaveLength(0)
    expect(refusals[0].reason).toMatch(/no external load/i)
  })

  test('a stated intake load is recorded unverified', () => {
    const { records } = detectLiftRecords([], {
      stated: [
        { exerciseId: 'box-squat', label: 'Box Squat', weightKg: 60, statedOn: daysAgo(40) },
      ],
    })

    expect(records).toHaveLength(1)
    expect(records[0].source).toBe('stated')
    expect(records[0].verified).toBe(false)
  })

  test('a logged set that meets the stated load drops the stated claim', () => {
    const { records, refusals } = detectLiftRecords([liftSession(3, 60, 8)], {
      stated: [
        { exerciseId: 'back-squat', label: 'Back Squat', weightKg: 60, statedOn: daysAgo(40) },
      ],
    })

    expect(records.filter((r) => r.source === 'stated')).toHaveLength(0)
    expect(refusals.some((r) => /stated at intake/i.test(r.reason))).toBe(true)
  })

  test('matching a best more recently refreshes its date', () => {
    const { records } = detectLiftRecords([liftSession(40, 90, 5), liftSession(4, 90, 5)])

    const heaviest = records.find((r) => r.kind === 'lift_heaviest')!
    expect(heaviest.achievedOn.getTime()).toBe(daysAgo(4).getTime())
  })

  test('lifts are kept apart from each other', () => {
    const { records } = detectLiftRecords([
      liftSession(5, 100, 5, 2, 'back-squat'),
      liftSession(5, 40, 5, 2, 'standing-calf-raise'),
    ])

    const heaviest = records.filter((r) => r.kind === 'lift_heaviest')
    expect(heaviest.map((r) => r.subjectId).sort()).toEqual(['back-squat', 'standing-calf-raise'])
  })
})

// ── Run detection ─────────────────────────────────────────────────────────────

describe('detectRunRecords', () => {
  test('a 5k effort counts and the fastest of several wins', () => {
    const { records } = detectRunRecords([
      run(30, { distanceKm: 5.0, durationMin: 27 }),
      run(10, { distanceKm: 5.02, durationMin: 24 }),
    ])

    const fiveK = records.find((r) => r.kind === 'run_distance' && r.subjectId === '5k')!
    expect(fiveK.achievedOn.getTime()).toBe(daysAgo(10).getTime())
    expect(fiveK.verified).toBe(true)
    // Pace, not elapsed time.
    expect(fiveK.unit).toBe('sec_per_km')
    expect(fiveK.value).toBeCloseTo((24 * 60) / 5.02, 0)
  })

  test('a fast 5k inside a long run is refused, with the reason stated', () => {
    const { records, refusals } = detectRunRecords([
      run(5, { distanceKm: 20, durationMin: 110 }),
    ])

    expect(records.some((r) => r.kind === 'run_distance' && r.subjectId === '5k')).toBe(false)
    const refusal = refusals.find((r) => r.subjectId === '5k')!
    expect(refusal.reason).toMatch(/not held to the line|chosen not to be held/i)
  })

  test('a run barely over the distance still counts and the note says so', () => {
    const { records } = detectRunRecords([run(4, { distanceKm: 10.15, durationMin: 50 })])

    const tenK = records.find((r) => r.subjectId === '10k')!
    expect(tenK.notes).toMatch(/over the distance/i)
  })

  test('longest run is the longest recorded distance', () => {
    const { records } = detectRunRecords([
      run(20, { distanceKm: 12 }),
      run(6, { distanceKm: 18.4 }),
    ])

    const longest = records.find((r) => r.kind === 'run_longest')!
    expect(longest.value).toBe(18.4)
    expect(longest.achievedOn.getTime()).toBe(daysAgo(6).getTime())
  })

  test('an equalled longest run takes the more recent date', () => {
    const { records } = detectRunRecords([
      run(45, { distanceKm: 16, durationMin: 95 }),
      run(5, { distanceKm: 16, durationMin: 95 }),
    ])

    expect(records.find((r) => r.kind === 'run_longest')!.achievedOn.getTime()).toBe(
      daysAgo(5).getTime(),
    )
  })

  test('without a reference heart rate there is no pace-at-HR record', () => {
    const { records, refusals } = detectRunRecords([run(3)], { matchHr: null })

    expect(records.some((r) => r.kind === 'run_pace_at_hr')).toBe(false)
    expect(refusals.some((r) => r.kind === 'run_pace_at_hr')).toBe(true)
  })

  test('one matched run gives an unverified pace-at-HR record; three verify it', () => {
    const thin = detectRunRecords([run(3, { avgHr: 140, durationMin: 30, distanceKm: 6 })], {
      matchHr: 140,
    })
    expect(thin.records.find((r) => r.kind === 'run_pace_at_hr')!.verified).toBe(false)

    const solid = detectRunRecords(
      [
        run(20, { avgHr: 141, durationMin: 30, distanceKm: 5.5 }),
        run(12, { avgHr: 139, durationMin: 30, distanceKm: 5.8 }),
        run(3, { avgHr: 140, durationMin: 30, distanceKm: 6 }),
      ],
      { matchHr: 140 },
    )
    const best = solid.records.find((r) => r.kind === 'run_pace_at_hr')!
    expect(best.verified).toBe(true)
    expect(best.achievedOn.getTime()).toBe(daysAgo(3).getTime())
  })

  test('a short matched run is not evidence about aerobic fitness', () => {
    const { records } = detectRunRecords([run(3, { avgHr: 140, durationMin: 12, distanceKm: 2 })], {
      matchHr: 140,
    })
    expect(records.some((r) => r.kind === 'run_pace_at_hr')).toBe(false)
  })

  test('non-run activities are ignored', () => {
    const { records } = detectRunRecords([
      { ...run(3), type: 'cycling', distanceKm: 40, durationMin: 80 },
    ])
    expect(records).toHaveLength(0)
  })
})

// ── Supersession ──────────────────────────────────────────────────────────────

describe('diffRecords', () => {
  const detected: DetectedRecord = {
    kind: 'lift_heaviest',
    subjectId: 'back-squat',
    label: 'Back Squat',
    value: 100,
    unit: 'kg',
    reps: 5,
    achievedOn: daysAgo(3),
    source: 'logged',
    sessionId: 1,
    verified: true,
    notes: 'logged',
  }

  const stored = (over: Partial<StoredRecord> = {}): StoredRecord => ({
    id: 1,
    kind: 'lift_heaviest',
    subjectId: 'back-squat',
    value: 90,
    achievedOn: daysAgo(30),
    source: 'logged',
    supersededById: null,
    ...over,
  })

  test('a first detection inserts with nothing superseded', () => {
    const diff = diffRecords([detected], [])
    expect(diff.insert).toHaveLength(1)
    expect(diff.supersedes).toEqual([null])
  })

  test('a better record supersedes the stored one by id', () => {
    const diff = diffRecords([detected], [stored()])
    expect(diff.insert).toHaveLength(1)
    expect(diff.supersedes).toEqual([1])
  })

  test('re-running over unchanged data writes nothing', () => {
    const diff = diffRecords([detected], [stored({ value: 100, achievedOn: daysAgo(3) })])
    expect(diff.insert).toHaveLength(0)
    expect(diff.unchanged).toHaveLength(1)
  })

  test('an already-superseded row is not treated as current', () => {
    const diff = diffRecords(
      [detected],
      [stored({ id: 1, value: 100, achievedOn: daysAgo(3), supersededById: 2 })],
    )
    expect(diff.insert).toHaveLength(1)
    expect(diff.supersedes).toEqual([null])
  })

  test('a worse record does not supersede a better one', () => {
    const diff = diffRecords([{ ...detected, value: 80 }], [stored({ value: 90 })])
    expect(diff.insert).toHaveLength(0)
  })

  test('for pace, smaller wins', () => {
    const pace: DetectedRecord = {
      ...detected,
      kind: 'run_distance',
      subjectId: '5k',
      value: 260,
      unit: 'sec_per_km',
    }
    const faster = diffRecords([pace], [stored({ kind: 'run_distance', subjectId: '5k', value: 280 })])
    expect(faster.insert).toHaveLength(1)

    const slower = diffRecords([pace], [stored({ kind: 'run_distance', subjectId: '5k', value: 240 })])
    expect(slower.insert).toHaveLength(0)
  })

  test('a logged set replaces a stated claim even at the same number', () => {
    const diff = diffRecords([detected], [stored({ value: 100, source: 'stated' })])
    expect(diff.insert).toHaveLength(1)
    expect(diff.supersedes).toEqual([1])
  })
})

// ── Age-aware currency ────────────────────────────────────────────────────────

describe('recordCurrency', () => {
  const base = { kind: 'lift_heaviest' as const, verified: true, source: 'logged' as const }

  test('a record set today is fully current', () => {
    const currency = recordCurrency({ ...base, achievedOn: TODAY }, TODAY)
    expect(currency.ageDays).toBe(0)
    expect(currency.confidence).toBe(1)
    expect(currency.band).toBe('current')
  })

  test('confidence halves over exactly one half-life', () => {
    const halfLife = RECORD_HALF_LIFE_DAYS.lift_heaviest
    const currency = recordCurrency({ ...base, achievedOn: daysAgo(halfLife) }, TODAY)
    expect(currency.confidence).toBeCloseTo(0.5, 2)
    expect(currency.halfLifeDays).toBe(halfLife)
  })

  test('the curve is monotonic — older is never more confident', () => {
    const ages = [0, 7, 30, 90, 180, 365, 730]
    const confidences = ages.map(
      (age) => recordCurrency({ ...base, achievedOn: daysAgo(age) }, TODAY).confidence,
    )
    for (let i = 1; i < confidences.length; i++) {
      expect(confidences[i]).toBeLessThan(confidences[i - 1])
    }
  })

  test('a two-year-old record is historical, not current fitness', () => {
    const currency = recordCurrency({ ...base, achievedOn: daysAgo(730) }, TODAY)
    expect(currency.band).toBe('historical')
    expect(currency.confidence).toBeLessThan(CURRENCY_FLOOR)
    expect(currency.note).toMatch(/history, not current fitness/i)
  })

  test('pace at a matched HR decays faster than maximal strength', () => {
    const at60 = (kind: 'lift_heaviest' | 'run_pace_at_hr') =>
      recordCurrency({ ...base, kind, achievedOn: daysAgo(60) }, TODAY).confidence

    expect(at60('run_pace_at_hr')).toBeLessThan(at60('lift_heaviest'))
  })

  test('a stated number is capped however fresh it is', () => {
    const currency = recordCurrency(
      { ...base, source: 'stated', verified: false, achievedOn: TODAY },
      TODAY,
    )
    expect(currency.confidence).toBeLessThanOrEqual(STATED_CONFIDENCE_CEILING)
    expect(currency.note).toMatch(/never logged/i)
  })

  test('thin evidence is capped the same way', () => {
    const currency = recordCurrency({ ...base, verified: false, achievedOn: TODAY }, TODAY)
    expect(currency.confidence).toBeLessThanOrEqual(STATED_CONFIDENCE_CEILING)
    expect(currency.note).toMatch(/thin/i)
  })

  test('a future date does not manufacture extra confidence', () => {
    const tomorrow = new Date(TODAY)
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(recordCurrency({ ...base, achievedOn: tomorrow }, TODAY).confidence).toBe(1)
  })
})

describe('recordBand', () => {
  test('bands run current → aging → stale → historical', () => {
    expect(recordBand(0.95)).toBe('current')
    expect(recordBand(0.7)).toBe('aging')
    expect(recordBand(0.4)).toBe('stale')
    expect(recordBand(0.1)).toBe('historical')
  })
})

describe('temperedTarget', () => {
  const base = {
    kind: 'lift_heaviest' as const,
    value: 100,
    verified: true,
    source: 'logged' as const,
  }

  test('a record set today pulls the target onto itself', () => {
    const out = temperedTarget({ ...base, achievedOn: TODAY }, 80, TODAY)
    expect(out.value).toBe(100)
    expect(out.weight).toBe(1)
  })

  test('a half-life-old record lands halfway between the fallback and the record', () => {
    const out = temperedTarget(
      { ...base, achievedOn: daysAgo(RECORD_HALF_LIFE_DAYS.lift_heaviest) },
      80,
      TODAY,
    )
    expect(out.value).toBeCloseTo(90, 0)
    expect(out.usedFallbackOnly).toBe(false)
  })

  test('past the floor the record does not move the target at all', () => {
    const out = temperedTarget({ ...base, achievedOn: daysAgo(730) }, 80, TODAY)
    expect(out.value).toBe(80)
    expect(out.weight).toBe(0)
    expect(out.usedFallbackOnly).toBe(true)
  })

  test('it interpolates downward too, so a pace record needs no special case', () => {
    const out = temperedTarget(
      { kind: 'run_distance', value: 240, verified: true, source: 'logged', achievedOn: TODAY },
      300,
      TODAY,
    )
    expect(out.value).toBe(240)
  })

  test('a stale record never over-reaches the fallback', () => {
    const out = temperedTarget({ ...base, achievedOn: daysAgo(200) }, 80, TODAY)
    expect(out.value).toBeGreaterThan(80)
    expect(out.value).toBeLessThan(100)
  })
})

// ── Weekly rollup ─────────────────────────────────────────────────────────────

describe('rollUpWeek', () => {
  const weekStart = weekStartOf(daysAgo(14)) // Monday, two weeks back
  const day = (offset: number) => new Date(weekStart.getTime() + offset * 86_400_000)

  const input = (): WeekRollupInput => ({
    weekStart,
    activities: [
      { date: day(1), type: 'running', durationMin: 40, distanceKm: 7, avgHr: 140, maxHr: 155 },
      { date: day(4), type: 'running', durationMin: 60, distanceKm: 11, avgHr: 145, maxHr: 160 },
      // Outside the week — must not be counted.
      { date: day(9), type: 'running', durationMin: 90, distanceKm: 16, avgHr: 142, maxHr: 158 },
    ],
    sessions: [
      { date: day(1), status: 'completed' },
      { date: day(3), status: 'draft' },
      { date: day(4), status: 'completed' },
      { date: day(9), status: 'completed' },
    ],
    setLogs: [
      { date: day(3), itemKind: 'exercise', reps: 8, contacts: null },
      { date: day(3), itemKind: 'exercise', reps: 8, contacts: null },
      { date: day(3), itemKind: 'exercise', reps: 0, contacts: null },
      { date: day(5), itemKind: 'plyo', reps: null, contacts: 40 },
      { date: day(9), itemKind: 'exercise', reps: 8, contacts: null },
    ],
    dailyLoads: Array.from({ length: 28 }, (_, i) => (i >= 21 ? 100 : 50)),
  })

  test('counts only the rows that fall inside the week', () => {
    const summary = rollUpWeek(input())
    expect(summary.runKm).toBe(18)
    expect(summary.runs).toBe(2)
    expect(summary.strengthSets).toBe(2)
    expect(summary.plyoContacts).toBe(40)
    expect(summary.sessionsPlanned).toBe(3)
    expect(summary.sessionsDone).toBe(2)
  })

  test('totalLoad is the last seven daily loads and acwrEnd closes the week', () => {
    const summary = rollUpWeek(input())
    expect(summary.totalLoad).toBe(700)
    expect(summary.acwrEnd).toBeCloseTo(100 / 62.5, 2)
  })

  test('re-running over the same rows produces an identical summary', () => {
    const first = rollUpWeek(input())
    const second = rollUpWeek(input())
    expect(second).toEqual(first)
  })

  test('running it twice does not double-count — the rollup is a pure recompute', () => {
    const once = rollUpWeek(input())
    const twice = rollUpWeek(input())
    expect(twice.runKm).toBe(once.runKm)
    expect(twice.strengthSets).toBe(once.strengthSets)
    expect(twice.plyoContacts).toBe(once.plyoContacts)
    expect(twice.totalLoad).toBe(once.totalLoad)
  })

  test('a week with nothing in it rolls up as a real zero, not as missing data', () => {
    const summary = rollUpWeek({
      weekStart,
      activities: [],
      sessions: [],
      setLogs: [],
      dailyLoads: new Array(28).fill(0),
    })
    expect(summary.runKm).toBe(0)
    expect(summary.totalLoad).toBe(0)
    expect(summary.sessionsPlanned).toBe(0)
  })

  test('runs without stored load still produce a load, not a zero', () => {
    // The seeded/real case: activities arrive with no TRIMP and the sessions
    // carry no load, so `dailyLoads` is all zeros while 18 km were actually run.
    const summary = rollUpWeek({ ...input(), dailyLoads: new Array(28).fill(0) })
    expect(summary.totalLoad).toBeGreaterThan(0)
  })

  test('stored load wins when it is the larger of the two views', () => {
    const summary = rollUpWeek(input())
    expect(summary.totalLoad).toBe(700)
  })

  test('a chronic window of nothing refuses to state an ACWR', () => {
    const summary = rollUpWeek({ ...input(), dailyLoads: new Array(28).fill(0) })
    expect(summary.acwrEnd).toBeNull()
  })

  test('fewer than 28 days of load refuses to state an ACWR', () => {
    const summary = rollUpWeek({ ...input(), dailyLoads: new Array(14).fill(60) })
    expect(summary.acwrEnd).toBeNull()
  })

  test('the week always spans Monday to Sunday whatever day is handed in', () => {
    const summary = rollUpWeek({ ...input(), weekStart: day(3) })
    expect(summary.weekStart.getTime()).toBe(weekStart.getTime())
    expect(summary.weekEnd.getDay()).toBe(0)
  })
})

describe('closedWeekStarts', () => {
  test('never includes the week currently being lived', () => {
    const starts = closedWeekStarts(TODAY, 4)
    expect(starts).toHaveLength(4)
    for (const start of starts) {
      expect(start.getTime()).toBeLessThan(weekStartOf(TODAY).getTime())
    }
  })

  test('is ordered oldest first and Monday-aligned', () => {
    const starts = closedWeekStarts(TODAY, 3)
    expect(starts[0].getTime()).toBeLessThan(starts[2].getTime())
    for (const start of starts) expect(start.getDay()).toBe(1)
  })
})

// ── Formatting ────────────────────────────────────────────────────────────────

describe('formatting helpers', () => {
  test('recordFamily splits lift from run', () => {
    expect(recordFamily('lift_e1rm')).toBe('lift')
    expect(recordFamily('run_longest')).toBe('run')
  })

  test('formatRecordValue speaks each unit', () => {
    expect(formatRecordValue('kg', 97.5, 5)).toBe('97.5 kg × 5')
    expect(formatRecordValue('kg', 97.5, null)).toBe('97.5 kg')
    expect(formatRecordValue('kg_reps', 2800, null)).toBe('2800 kg·reps')
    expect(formatRecordValue('km', 18.42, null)).toBe('18.42 km')
    expect(formatRecordValue('sec_per_km', 285, null)).toMatch(/4:45/)
  })

  test('describeAge scales its units with the age', () => {
    expect(describeAge(0)).toBe('today')
    expect(describeAge(1)).toBe('yesterday')
    expect(describeAge(5)).toBe('5 days ago')
    expect(describeAge(21)).toBe('3 weeks ago')
    expect(describeAge(180)).toBe('6 months ago')
    expect(describeAge(800)).toMatch(/years ago/)
  })
})
