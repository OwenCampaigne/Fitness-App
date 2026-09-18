import {
  acwrBand,
  acwrSeries,
  agoPhrase,
  buildAnchorArc,
  buildLiftAnchorArc,
  buildLthrAnchorArc,
  buildPaceAnchorArc,
  buildPlyoTierArc,
  dailyLoadSeries,
  describeAcwr,
  formatAnchorDelta,
  formatAnchorValue,
  intensityDistribution,
  readinessTrend,
  setsByMuscleGroup,
  summariseCalibration,
  weeklyVolume,
} from '../trends'
import type { AnchorArc, DailyLoadPoint, ReadinessDayRow } from '../trends'
import type { RunActivityRow } from '../../types/run'
import type { ExerciseSessionHistory, KeyLift, LoggedSet } from '../../types/strength'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TODAY = new Date(2026, 8, 14) // Monday 14 Sep 2026, local time

function daysAgo(n: number): Date {
  const d = new Date(TODAY)
  d.setDate(d.getDate() - n)
  return d
}

const SQUAT: Pick<KeyLift, 'id' | 'name' | 'defaultTargetRir'> = {
  id: 'back-squat',
  name: 'Back Squat',
  defaultTargetRir: 2,
}

function sets(weightKg: number, reps: number, rir: number, count = 3): LoggedSet[] {
  return Array.from({ length: count }, (_, i) => ({
    sessionId: 1,
    exerciseId: SQUAT.id,
    setNumber: i + 1,
    weightKg,
    reps,
    rir,
  }))
}

function session(dayOffset: number, weightKg: number, reps = 8, rir = 2): ExerciseSessionHistory {
  return {
    sessionId: 1000 + dayOffset,
    date: daysAgo(dayOffset),
    exerciseId: SQUAT.id,
    sets: sets(weightKg, reps, rir),
  }
}

function run(dayOffset: number, opts: Partial<RunActivityRow> = {}): RunActivityRow {
  return {
    date: daysAgo(dayOffset),
    type: 'running',
    durationMin: 40,
    distanceKm: 8,
    avgHr: 140,
    maxHr: 160,
    ...opts,
  }
}

// ── Formatting and phrasing ───────────────────────────────────────────────────

describe('formatAnchorValue', () => {
  test('formats each anchor unit in the unit the athlete thinks in', () => {
    expect(formatAnchorValue('kg', 62.5)).toBe('62.5 kg')
    expect(formatAnchorValue('bpm', 168.4)).toBe('168 bpm')
    expect(formatAnchorValue('sec_per_km', 330)).toBe('5:30/km')
    expect(formatAnchorValue('tier', 2)).toBe('Tier 2')
  })

  test('renders a missing value as a dash rather than a zero', () => {
    expect(formatAnchorValue('kg', null)).toBe('—')
  })
})

describe('formatAnchorDelta', () => {
  test('states weight and heart-rate deltas as higher or lower', () => {
    expect(formatAnchorDelta('kg', 10)).toBe('10 kg higher')
    expect(formatAnchorDelta('kg', -5)).toBe('5 kg lower')
    expect(formatAnchorDelta('bpm', 4)).toBe('4 bpm higher')
  })

  test('states pace deltas in the direction the athlete cares about', () => {
    // Fewer seconds per kilometre is faster, not "lower".
    expect(formatAnchorDelta('sec_per_km', -12)).toBe('12 s/km faster')
    expect(formatAnchorDelta('sec_per_km', 12)).toBe('12 s/km slower')
  })

  test('pluralises tiers and handles no change', () => {
    expect(formatAnchorDelta('tier', 1)).toBe('1 tier higher')
    expect(formatAnchorDelta('tier', 2)).toBe('2 tiers higher')
    expect(formatAnchorDelta('kg', 0)).toBe('unchanged')
    expect(formatAnchorDelta('kg', null)).toBe('unchanged')
  })
})

describe('agoPhrase', () => {
  test('uses words for the spans a coach would say out loud', () => {
    expect(agoPhrase(0)).toBe('Today')
    expect(agoPhrase(1)).toBe('Yesterday')
    expect(agoPhrase(4)).toBe('4 days ago')
    expect(agoPhrase(7)).toBe('A week ago')
    expect(agoPhrase(21)).toBe('Three weeks ago')
  })

  test('falls back to numerals beyond ten weeks', () => {
    expect(agoPhrase(7 * 12)).toBe('12 weeks ago')
  })
})

// ── buildAnchorArc: the honesty rule ──────────────────────────────────────────

describe('buildAnchorArc', () => {
  test('an anchor with no observations is still an estimate, with the reason kept', () => {
    const arc = buildAnchorArc({
      id: 'x',
      kind: 'lift',
      label: 'Back Squat',
      unit: 'kg',
      points: [],
      estimateReason: 'Nothing logged yet.',
      today: TODAY,
    })

    expect(arc.hasMovement).toBe(false)
    expect(arc.stillEstimate).toBe(true)
    expect(arc.reason).toBe('Nothing logged yet.')
    expect(arc.points).toHaveLength(0)
    expect(arc.headline).toContain('still an estimate')
  })

  test('a single reading is a data point, not an arc', () => {
    const arc = buildAnchorArc({
      id: 'x',
      kind: 'lift',
      label: 'Back Squat',
      unit: 'kg',
      points: [{ date: '2026-09-01', value: 50, source: 'observed', confidence: 0.5, note: 'one session' }],
      estimateReason: 'Only one session logged.',
      today: TODAY,
    })

    expect(arc.hasMovement).toBe(false)
    expect(arc.reason).toBe('Only one session logged.')
  })

  test('two readings that agree are not an arc either', () => {
    const arc = buildAnchorArc({
      id: 'x',
      kind: 'lift',
      label: 'Back Squat',
      unit: 'kg',
      points: [
        { date: '2026-09-01', value: 50, source: 'observed', confidence: 0.5, note: 'a' },
        { date: '2026-09-05', value: 50, source: 'observed', confidence: 0.5, note: 'b' },
      ],
      estimateReason: 'Has not moved.',
      today: TODAY,
    })

    expect(arc.hasMovement).toBe(false)
  })

  test('tells the arc story once the belief has actually changed', () => {
    const arc = buildAnchorArc({
      id: 'x',
      kind: 'lift',
      label: 'working squat',
      unit: 'kg',
      points: [
        { date: '2026-08-24', value: 50, source: 'estimate', confidence: 0.2, note: 'first session' },
        { date: '2026-09-02', value: 55, source: 'observed', confidence: 0.5, note: 'RIR 2' },
        { date: '2026-09-12', value: 60, source: 'confirmed', confidence: 0.85, note: 'RIR 2 three times' },
      ],
      estimateReason: 'unused',
      today: TODAY,
    })

    expect(arc.hasMovement).toBe(true)
    expect(arc.stillEstimate).toBe(false)
    expect(arc.reason).toBeNull()
    expect(arc.deltaValue).toBe(10)
    expect(arc.spanDays).toBe(19)
    expect(arc.headline).toBe(
      'Three weeks ago I guessed your working squat at 50 kg; I have now confirmed it 10 kg higher.',
    )
  })

  test('records one move per real change, with the reason attached', () => {
    const arc = buildAnchorArc({
      id: 'x',
      kind: 'lift',
      label: 'Back Squat',
      unit: 'kg',
      points: [
        { date: '2026-09-01', value: 50, source: 'observed', confidence: 0.5, note: 'first' },
        { date: '2026-09-04', value: 50, source: 'observed', confidence: 0.5, note: 'repeat' },
        { date: '2026-09-08', value: 55, source: 'confirmed', confidence: 0.85, note: 'held RIR 2' },
      ],
      estimateReason: 'unused',
      today: TODAY,
    })

    expect(arc.moves).toHaveLength(2)
    expect(arc.moves[1].changed).toBe('both')
    expect(arc.moves[1].deltaValue).toBe(5)
    expect(arc.moves[1].reason).toContain('observed → confirmed')
    expect(arc.moves[1].reason).toContain('held RIR 2')
  })

  test('falls back to the stored anchor when the replay produced nothing', () => {
    const arc = buildAnchorArc({
      id: 'hr:lthr',
      kind: 'hr_zone',
      label: 'threshold heart rate',
      unit: 'bpm',
      points: [],
      current: { value: 165, source: 'estimate', confidence: 0.2 },
      estimateReason: 'Population estimate, not your number.',
      today: TODAY,
    })

    expect(arc.latest).toEqual({ value: 165, source: 'estimate', confidence: 0.2 })
    expect(arc.hasMovement).toBe(false)
    expect(arc.headline).toBe('threshold heart rate is still an estimate at 165 bpm.')
  })

  test('sorts points that arrive out of order', () => {
    const arc = buildAnchorArc({
      id: 'x',
      kind: 'lift',
      label: 'Back Squat',
      unit: 'kg',
      points: [
        { date: '2026-09-08', value: 60, source: 'confirmed', confidence: 0.85, note: 'later' },
        { date: '2026-09-01', value: 50, source: 'observed', confidence: 0.5, note: 'earlier' },
      ],
      estimateReason: 'unused',
      today: TODAY,
    })

    expect(arc.points.map((p) => p.date)).toEqual(['2026-09-01', '2026-09-08'])
    expect(arc.deltaValue).toBe(10)
  })
})

// ── Lift anchor arc ───────────────────────────────────────────────────────────

describe('buildLiftAnchorArc', () => {
  test('no logged sets renders as an estimate with a reason, not a flat line', () => {
    const arc = buildLiftAnchorArc(SQUAT, [], { today: TODAY })

    expect(arc.points).toHaveLength(0)
    expect(arc.hasMovement).toBe(false)
    expect(arc.reason).toContain('No sets logged for Back Squat')
    expect(arc.reason).toContain('onboarding estimated')
  })

  test('ignores sessions where no set was actually completed', () => {
    const empty: ExerciseSessionHistory = {
      sessionId: 1,
      date: daysAgo(5),
      exerciseId: SQUAT.id,
      sets: [{ sessionId: 1, exerciseId: SQUAT.id, setNumber: 1, weightKg: 60, reps: null, rir: null }],
    }
    const arc = buildLiftAnchorArc(SQUAT, [empty], { today: TODAY })
    expect(arc.points).toHaveLength(0)
  })

  test('replays the engine: estimate to observed to confirmed as sessions land', () => {
    const arc = buildLiftAnchorArc(
      SQUAT,
      [session(21, 50), session(14, 55), session(7, 60), session(1, 60)],
      { today: TODAY },
    )

    expect(arc.points.map((p) => p.source)).toEqual(['observed', 'observed', 'confirmed', 'confirmed'])
    expect(arc.points.map((p) => p.value)).toEqual([50, 55, 60, 60])
    expect(arc.hasMovement).toBe(true)
    expect(arc.deltaValue).toBe(10)
    expect(arc.latest).toEqual({ value: 60, source: 'confirmed', confidence: 0.85 })
  })

  test('the headline is the anchor-arc sentence the framework asks for', () => {
    const arc = buildLiftAnchorArc(
      SQUAT,
      [session(21, 50), session(14, 55), session(7, 60), session(1, 60)],
      { today: TODAY },
    )

    expect(arc.headline).toBe(
      'Three weeks ago I first measured your Back Squat at 50 kg; I have now confirmed it 10 kg higher.',
    )
  })

  test('each point notes the sets, load and RIR that produced it', () => {
    const arc = buildLiftAnchorArc(SQUAT, [session(10, 60, 8, 2), session(3, 65, 8, 2)], { today: TODAY })

    expect(arc.points[1].note).toBe('3 sets at 65 kg × 8, mean RIR 2 against a target of 2.')
  })

  test('says so when RIR was not logged instead of assuming it was on target', () => {
    const noRir: ExerciseSessionHistory = {
      sessionId: 9,
      date: daysAgo(4),
      exerciseId: SQUAT.id,
      sets: [{ sessionId: 9, exerciseId: SQUAT.id, setNumber: 1, weightKg: 60, reps: 8, rir: null }],
    }
    const arc = buildLiftAnchorArc(SQUAT, [noRir], { today: TODAY })
    expect(arc.points[0].note).toContain('RIR not logged')
  })

  test('two sessions at the same load and RIR do not manufacture an arc', () => {
    const arc = buildLiftAnchorArc(SQUAT, [session(10, 60), session(3, 60)], { today: TODAY })

    expect(arc.hasMovement).toBe(false)
    expect(arc.reason).toContain('2 logged sessions')
    expect(arc.reason).toContain('three sessions at the target RIR')
  })

  test('sorts unordered history before replaying it', () => {
    const arc = buildLiftAnchorArc(SQUAT, [session(7, 60), session(21, 50), session(14, 55)], {
      today: TODAY,
    })
    expect(arc.points.map((p) => p.value)).toEqual([50, 55, 60])
  })
})

// ── Pace anchor arc ───────────────────────────────────────────────────────────

describe('buildPaceAnchorArc', () => {
  test('without a Zone 2 ceiling there is nothing to match against', () => {
    const arc = buildPaceAnchorArc([run(3)], null, { today: TODAY })

    expect(arc.hasMovement).toBe(false)
    expect(arc.reason).toContain('No Zone 2 ceiling')
    expect(arc.points).toHaveLength(0)
  })

  test('stays an estimate until enough matched runs exist', () => {
    const runs = [run(20), run(15), run(10)] // 3 matched runs, gate is 4
    const arc = buildPaceAnchorArc(runs, 140, { today: TODAY })

    expect(arc.points).toHaveLength(0)
    expect(arc.hasMovement).toBe(false)
    expect(arc.reason).toBeTruthy()
  })

  test('only counts runs whose average HR is inside the matched band', () => {
    const runs = [
      run(30, { avgHr: 175 }), // hard run, outside the band
      run(25),
      run(20),
      run(15),
      run(10),
      run(5),
    ]
    const arc = buildPaceAnchorArc(runs, 140, { today: TODAY })

    // Points can only land on in-band days, so the hard run never produces one.
    expect(arc.points.every((p) => p.date !== '2026-08-15')).toBe(true)
    expect(arc.points.length).toBeGreaterThan(0)
  })

  test('shows pace improving at the same heart rate, and upgrades to confirmed', () => {
    const runs = [
      run(40, { distanceKm: 7.0 }),
      run(36, { distanceKm: 7.0 }),
      run(32, { distanceKm: 7.0 }),
      run(28, { distanceKm: 7.0 }),
      run(24, { distanceKm: 8.0 }),
      run(20, { distanceKm: 8.0 }),
      run(16, { distanceKm: 8.5 }),
      run(12, { distanceKm: 8.5 }),
      run(8, { distanceKm: 8.5 }),
      run(4, { distanceKm: 8.5 }),
    ]
    const arc = buildPaceAnchorArc(runs, 140, { today: TODAY })

    expect(arc.hasMovement).toBe(true)
    expect(arc.unit).toBe('sec_per_km')
    // Same 40 minutes covering more ground: seconds per kilometre must fall.
    expect(arc.deltaValue).toBeLessThan(0)
    expect(arc.latest?.source).toBe('confirmed')
    expect(arc.headline).toContain('faster')
  })
})

// ── LTHR anchor arc ───────────────────────────────────────────────────────────

describe('buildLthrAnchorArc', () => {
  test('with no max HR there is nothing to judge a hard effort against', () => {
    const arc = buildLthrAnchorArc([run(3)], null, { today: TODAY })

    expect(arc.points).toHaveLength(0)
    expect(arc.reason).toContain('No max heart rate known')
  })

  test('a population fallback keeps its number but never pretends to be measured', () => {
    const arc = buildLthrAnchorArc([run(3, { avgHr: 120 })], 190, { today: TODAY })

    expect(arc.points).toHaveLength(0)
    expect(arc.hasMovement).toBe(false)
    expect(arc.stillEstimate).toBe(true)
    expect(arc.latest?.value).toBe(Math.round(190 * 0.88))
    expect(arc.reason).toContain('population estimate')
  })

  test('sustained hard efforts move the anchor from estimate to observed', () => {
    const hard = (d: number, hr: number) => run(d, { avgHr: hr, durationMin: 35 })
    const arc = buildLthrAnchorArc([hard(20, 168), hard(13, 172), hard(6, 174)], 190, { today: TODAY })

    expect(arc.points).toHaveLength(3)
    expect(arc.points.map((p) => p.source)).toEqual(['estimate', 'estimate', 'observed'])
    expect(arc.hasMovement).toBe(true)
    expect(arc.latest?.source).toBe('observed')
  })

  test('short hard efforts do not qualify', () => {
    const arc = buildLthrAnchorArc([run(5, { avgHr: 175, durationMin: 10 })], 190, { today: TODAY })
    expect(arc.points).toHaveLength(0)
  })
})

// ── Plyo tier arc ─────────────────────────────────────────────────────────────

describe('buildPlyoTierArc', () => {
  test('is always an estimate, and says why rather than drawing a line', () => {
    const arc = buildPlyoTierArc(
      { plyoTier: 1, plyoTierSource: 'estimate', plyoTierConfidence: 'estimate' },
      { today: TODAY },
    )

    expect(arc.hasMovement).toBe(false)
    expect(arc.stillEstimate).toBe(true)
    expect(arc.latest).toEqual({ value: 1, source: 'estimate', confidence: 0.2 })
    expect(arc.reason).toContain('Nothing logs plyometric contacts yet')
    expect(arc.headline).toBe('plyo tier is still an estimate at Tier 1.')
  })

  test('accepts a numeric confidence when one is stored', () => {
    const arc = buildPlyoTierArc(
      { plyoTier: 2, plyoTierSource: 'observed', plyoTierConfidence: '0.6' },
      { today: TODAY },
    )
    expect(arc.latest).toEqual({ value: 2, source: 'observed', confidence: 0.6 })
  })
})

// ── Weekly volume ─────────────────────────────────────────────────────────────

describe('weeklyVolume', () => {
  const srpe = () => 5

  test('buckets activities into Monday-started weeks', () => {
    const points = weeklyVolume([run(0), run(2), run(8)], { weeks: 3, today: TODAY, srpe })

    expect(points).toHaveLength(3)
    expect(points[points.length - 1].weekStart).toBe('2026-09-14')
    expect(points[points.length - 1].runs).toBe(1) // only today falls in this week
  })

  test('keeps empty weeks — a week off is data, not a gap', () => {
    const points = weeklyVolume([run(0)], { weeks: 4, today: TODAY, srpe })

    expect(points).toHaveLength(4)
    expect(points.slice(0, 3).every((p) => p.runs === 0 && p.km === 0)).toBe(true)
  })

  test('sums distance, minutes and session load', () => {
    const points = weeklyVolume(
      [run(0, { distanceKm: 10, durationMin: 50 }), run(0, { distanceKm: 5, durationMin: 25 })],
      { weeks: 1, today: TODAY, srpe },
    )

    expect(points[0].km).toBe(15)
    expect(points[0].minutes).toBe(75)
    expect(points[0].load).toBe(375) // 75 min × sRPE 5
  })

  test('drops activities older than the window', () => {
    const points = weeklyVolume([run(60)], { weeks: 4, today: TODAY, srpe })
    expect(points.every((p) => p.runs === 0)).toBe(true)
  })
})

// ── ACWR ──────────────────────────────────────────────────────────────────────

describe('acwrBand', () => {
  test('matches the corridor the readiness engine already enforces', () => {
    expect(acwrBand(null)).toBe('no_data')
    expect(acwrBand(0.6)).toBe('detraining')
    expect(acwrBand(0.8)).toBe('optimal')
    expect(acwrBand(1.3)).toBe('optimal')
    expect(acwrBand(1.4)).toBe('caution')
    expect(acwrBand(1.6)).toBe('danger')
  })
})

describe('dailyLoadSeries', () => {
  test('zero-fills every day in the window', () => {
    const series = dailyLoadSeries([run(2, { durationMin: 60, avgHr: 140 })], {
      days: 5,
      today: TODAY,
      srpe: () => 5,
    })

    expect(series).toHaveLength(5)
    expect(series.map((d) => d.load)).toEqual([0, 0, 300, 0, 0])
  })

  test('skips activities with no duration or no heart rate', () => {
    const series = dailyLoadSeries([run(1, { avgHr: null }), run(1, { durationMin: null })], {
      days: 3,
      today: TODAY,
      srpe: () => 5,
    })
    expect(series.every((d) => d.load === 0)).toBe(true)
  })
})

describe('acwrSeries', () => {
  function flat(days: number, load: number): DailyLoadPoint[] {
    return Array.from({ length: days }, (_, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, '0')}`,
      load,
    }))
  }

  test('produces nothing until 28 days of history exist behind a point', () => {
    expect(acwrSeries(flat(27, 50))).toHaveLength(0)
    expect(acwrSeries(flat(28, 50))).toHaveLength(1)
  })

  test('a steady load sits at 1.0, dead centre of the corridor', () => {
    const points = acwrSeries(flat(30, 50))
    expect(points[0].acwr).toBe(1)
    expect(points[0].band).toBe('optimal')
  })

  test('a spike week pushes the ratio into the danger band', () => {
    const daily = [...flat(28, 10)]
    for (let i = 21; i < 28; i++) daily[i] = { ...daily[i], load: 200 }
    const points = acwrSeries(daily)

    expect(points[0].acwr).toBeGreaterThan(1.5)
    expect(points[0].band).toBe('danger')
  })

  test('an all-zero window reports no data rather than a made-up ratio', () => {
    const points = acwrSeries(flat(28, 0))
    expect(points[0].acwr).toBeNull()
    expect(points[0].band).toBe('no_data')
  })

  test('trims to the requested tail length', () => {
    expect(acwrSeries(flat(40, 50), { days: 5 })).toHaveLength(5)
  })
})

describe('describeAcwr', () => {
  test('explains each band in words, not just a number', () => {
    expect(describeAcwr(null)).toContain('28 days')
    expect(describeAcwr({ date: 'd', acute: 1, chronic: 1, acwr: 0.5, band: 'detraining' })).toContain('0.8 floor')
    expect(describeAcwr({ date: 'd', acute: 1, chronic: 1, acwr: 1.0, band: 'optimal' })).toContain('0.8–1.3')
    expect(describeAcwr({ date: 'd', acute: 1, chronic: 1, acwr: 1.4, band: 'caution' })).toContain('Hold the volume')
    expect(describeAcwr({ date: 'd', acute: 1, chronic: 1, acwr: 1.7, band: 'danger' })).toContain('Back off')
  })
})

// ── Intensity distribution ────────────────────────────────────────────────────

describe('intensityDistribution', () => {
  test('needs a Zone 2 ceiling before anything can be classified', () => {
    const result = intensityDistribution([run(1)], null)
    expect(result.available).toBe(false)
    expect(result.reason).toContain('No Zone 2 ceiling')
  })

  test('splits minutes by average heart rate against the ceiling', () => {
    const result = intensityDistribution(
      [
        run(1, { durationMin: 80, avgHr: 130 }),
        run(3, { durationMin: 20, avgHr: 170 }),
      ],
      140,
    )

    expect(result.available).toBe(true)
    expect(result.easyShare).toBe(0.8)
    expect(result.slices.find((s) => s.key === 'easy')?.minutes).toBe(80)
    expect(result.slices.find((s) => s.key === 'hard')?.minutes).toBe(20)
    expect(result.verdict).toContain('80/20 split is holding')
  })

  test('calls out drift when the easy share falls away', () => {
    const result = intensityDistribution(
      [run(1, { durationMin: 50, avgHr: 130 }), run(2, { durationMin: 50, avgHr: 160 })],
      140,
    )
    expect(result.easyShare).toBe(0.5)
    expect(result.verdict).toContain('Most of the volume is moderate')
  })

  test('pushes up as well as down when nothing is ever hard', () => {
    const result = intensityDistribution([run(1, { durationMin: 60, avgHr: 120 })], 140)
    expect(result.verdict).toContain('the 20% is what buys the top end')
  })

  test('excludes runs with no heart rate and says how many minutes that was', () => {
    const result = intensityDistribution(
      [run(1, { durationMin: 60, avgHr: 130 }), run(2, { durationMin: 30, avgHr: null })],
      140,
    )

    expect(result.easyShare).toBe(1)
    expect(result.slices.find((s) => s.key === 'unknown')?.minutes).toBe(30)
    expect(result.reason).toContain('30 min')
  })

  test('never claims more precision than average heart rate supports', () => {
    const result = intensityDistribution([run(1, { durationMin: 60, avgHr: 130 })], 140)
    expect(result.verdict).toContain('time-in-zone')
  })

  test('reports unavailable when no run recorded a heart rate at all', () => {
    const result = intensityDistribution([run(1, { avgHr: null })], 140)
    expect(result.available).toBe(false)
    expect(result.reason).toContain('No runs in this window recorded a heart rate')
  })
})

// ── Readiness trend ───────────────────────────────────────────────────────────

describe('readinessTrend', () => {
  function day(offset: number, over: Partial<ReadinessDayRow> = {}): ReadinessDayRow {
    return {
      date: daysAgo(offset),
      recoveryScore: 70,
      hrv: 60,
      rhr: 50,
      sleepScore: 80,
      sleepHours: 7.5,
      ...over,
    }
  }

  test('returns one bucket per week, most recent last', () => {
    const points = readinessTrend([day(0)], { weeks: 4, today: TODAY })
    expect(points).toHaveLength(4)
    expect(points[3].weekStart).toBe('2026-09-14')
  })

  test('averages the days inside a week', () => {
    const points = readinessTrend([day(0, { recoveryScore: 60 }), day(0, { recoveryScore: 80 })], {
      weeks: 1,
      today: TODAY,
    })
    expect(points[0].recovery).toBe(70)
    expect(points[0].days).toBe(2)
  })

  test('a week with no rows reports null, not zero', () => {
    const points = readinessTrend([], { weeks: 2, today: TODAY })
    expect(points.every((p) => p.recovery === null && p.hrv === null)).toBe(true)
  })

  test('ignores missing and zero readings rather than averaging them in', () => {
    const points = readinessTrend([day(0, { hrv: null }), day(0, { hrv: 0 }), day(0, { hrv: 60 })], {
      weeks: 1,
      today: TODAY,
    })
    expect(points[0].hrv).toBe(60)
  })
})

// ── Sets by muscle group ──────────────────────────────────────────────────────

describe('setsByMuscleGroup', () => {
  const lift: KeyLift = {
    id: 'back-squat',
    exerciseLibraryId: null,
    name: 'Back Squat',
    pattern: 'squat',
    primaryMuscleGroups: ['quads', 'glutes'],
    attributes: [],
    incrementKg: 5,
    defaultSets: 3,
    defaultReps: 8,
    defaultRepsMin: 6,
    defaultTargetRir: 2,
    bodyweight: false,
    runnerRationale: '',
  }
  const liftsById = { 'back-squat': lift }

  test('counts this week against last week for each muscle the lift trains', () => {
    const points = setsByMuscleGroup([session(2, 60), session(10, 60)], liftsById, { today: TODAY })

    const quads = points.find((p) => p.group === 'quads')
    expect(quads?.sets).toBe(3)
    expect(quads?.previousSets).toBe(3)
    expect(points.map((p) => p.group).sort()).toEqual(['glutes', 'quads'])
  })

  test('carries the volume landmarks so the chart can show the corridor', () => {
    const points = setsByMuscleGroup([session(2, 60)], liftsById, { today: TODAY })
    const quads = points.find((p) => p.group === 'quads')

    expect(quads?.mev).toBe(4)
    expect(quads?.mav).toBe(9)
    expect(quads?.mrv).toBe(14)
    expect(quads?.status).toBe('below_mev') // 3 hard sets is under the 4-set floor
  })

  test('flags volume that has run past the recoverable ceiling', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...session(1, 60),
      sessionId: i,
    }))
    const points = setsByMuscleGroup(many, liftsById, { today: TODAY })
    expect(points.find((p) => p.group === 'quads')?.status).toBe('above_mrv') // 18 > 14
  })

  test('returns nothing when no key lift has been logged', () => {
    expect(setsByMuscleGroup([], liftsById, { today: TODAY })).toEqual([])
  })
})

// ── Calibration summary ───────────────────────────────────────────────────────

describe('summariseCalibration', () => {
  function arc(source: 'estimate' | 'observed' | 'confirmed'): AnchorArc {
    return buildAnchorArc({
      id: source,
      kind: 'lift',
      label: 'x',
      unit: 'kg',
      points: [],
      current: { value: 10, source, confidence: 0.5 },
      estimateReason: 'none',
      today: TODAY,
    })
  }

  test('says plainly when nothing has been measured yet', () => {
    const note = summariseCalibration([arc('estimate'), arc('estimate')], {
      graduated: false,
      recoveryBaselineReady: false,
    })
    expect(note.anchorsConfirmed).toBe(0)
    expect(note.note).toContain('Every anchor is still an estimate')
  })

  test('counts confirmed anchors and flags a provisional recovery baseline', () => {
    const note = summariseCalibration([arc('confirmed'), arc('observed'), arc('estimate')], {
      graduated: false,
      recoveryBaselineReady: false,
    })
    expect(note.anchorsConfirmed).toBe(1)
    expect(note.anchorsTotal).toBe(3)
    expect(note.note).toContain('readiness is provisional')
  })

  test('announces graduation only when no anchor is still a guess', () => {
    const note = summariseCalibration([arc('confirmed'), arc('confirmed')], {
      graduated: true,
      recoveryBaselineReady: true,
    })
    expect(note.note).toContain('Calibration is done')
  })

  test('handles having no anchors at all', () => {
    expect(summariseCalibration([], { graduated: false, recoveryBaselineReady: false }).note).toBe(
      'No anchors set up yet.',
    )
  })
})
