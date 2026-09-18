import {
  roundTo,
  effectiveIncrement,
  estimateE1RM,
  completedSets,
  meanRir,
  topWeight,
  suggestProgression,
  applyReadinessAdjustment,
  scaledLandmark,
  weeklySetsByMuscle,
  shouldDeload,
  checkConcurrentConflict,
  filterContraindicated,
  deriveWorkingLoadAnchor,
} from '../strengthEngine'
import { latestByExercise } from '../strengthSession'
import type {
  ExerciseSessionHistory,
  KeyLift,
  LoggedSet,
  RecoveryContext,
} from '../../types/strength'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const RDL: KeyLift = {
  id: 'romanian-deadlift',
  exerciseLibraryId: 'romanian-deadlift',
  name: 'Romanian Deadlift',
  pattern: 'hinge',
  primaryMuscleGroups: ['hamstrings', 'glutes'],
  attributes: ['posterior_chain'],
  incrementKg: 5,
  defaultSets: 3,
  defaultReps: 8,
  defaultRepsMin: 6,
  defaultTargetRir: 2,
  bodyweight: false,
  runnerRationale: 'Posterior chain strength for stride power.',
}

const CALF_RAISE: KeyLift = {
  ...RDL,
  id: 'single-leg-calf-raise',
  name: 'Single-Leg Calf Raise',
  pattern: 'calf',
  primaryMuscleGroups: ['calves'],
  attributes: ['unilateral'],
  incrementKg: 2.5,
  bodyweight: true,
  defaultReps: 12,
  defaultRepsMin: 8,
}

const LEG_EXTENSION: KeyLift = {
  ...RDL,
  id: 'leg-extension',
  name: 'Leg Extension',
  pattern: 'squat',
  primaryMuscleGroups: ['quads'],
  attributes: ['open_chain_knee_extension'],
}

const DEEP_SQUAT: KeyLift = {
  ...RDL,
  id: 'back-squat',
  name: 'Back Squat',
  pattern: 'squat',
  primaryMuscleGroups: ['quads', 'glutes'],
  attributes: ['deep_knee_flexion', 'deep_squat_load'],
}

function set(
  setNumber: number,
  weightKg: number | null,
  reps: number | null,
  rir: number | null,
): LoggedSet {
  return { sessionId: 1, exerciseId: RDL.id, setNumber, weightKg, reps, rir }
}

function history(
  date: string,
  sets: LoggedSet[],
  exerciseId = RDL.id,
): ExerciseSessionHistory {
  return { sessionId: 1, date: new Date(date), exerciseId, sets }
}

// ── roundTo / effectiveIncrement ─────────────────────────────────────────────

describe('roundTo', () => {
  test('rounds to the nearest step', () => {
    expect(roundTo(61.3, 2.5)).toBe(62.5)
    expect(roundTo(60.9, 2.5)).toBe(60)
    expect(roundTo(63.8, 2.5)).toBe(65)
  })
  test('returns the value unchanged for a non-positive step', () => {
    expect(roundTo(61.3, 0)).toBe(61.3)
  })
})

describe('effectiveIncrement', () => {
  test('uses the nominal step when it is already inside the 5% cap', () => {
    expect(effectiveIncrement(RDL, 100)).toBe(5)
  })
  test('falls back to the largest loadable step under 5%', () => {
    // 5% of 60 kg is 3 kg; the smallest plate pair is 2.5 kg.
    expect(effectiveIncrement(RDL, 60)).toBe(2.5)
  })
  test('accepts the smallest plate step when it is still a tolerable jump', () => {
    // 5% of 40 kg is 2 kg, but 2.5 kg is only 6.25% — close enough.
    expect(effectiveIncrement(RDL, 40)).toBe(2.5)
  })
  test('returns null when no loadable step is a sensible jump', () => {
    // 2.5 kg on a 20 kg lift is 12.5% — progress by reps instead.
    expect(effectiveIncrement(RDL, 20)).toBeNull()
  })
  test('returns null for bodyweight movements', () => {
    expect(effectiveIncrement(CALF_RAISE, 0)).toBeNull()
  })
  test('microplates allow finer steps on light lifts', () => {
    expect(effectiveIncrement({ ...RDL, microStepKg: 0.5 }, 20)).toBe(1)
  })
})

// ── estimateE1RM ─────────────────────────────────────────────────────────────

describe('estimateE1RM', () => {
  test('Epley adds RIR to reps', () => {
    // 100 kg × 5 reps at RIR 2 → effective 7 reps → 100 × (1 + 7/30)
    expect(estimateE1RM(100, 5, 2).value).toBeCloseTo(123.3, 1)
  })
  test('a set taken to failure has RIR 0', () => {
    expect(estimateE1RM(100, 5, 0).value).toBeCloseTo(116.7, 1)
  })
  test('Brzycki gives a similar answer at low reps', () => {
    const epley = estimateE1RM(100, 5, 2, 'epley').value
    const brzycki = estimateE1RM(100, 5, 2, 'brzycki').value
    expect(Math.abs(epley - brzycki)).toBeLessThan(6)
  })
  test('confidence degrades as effective reps climb', () => {
    expect(estimateE1RM(100, 4, 2).confidence).toBe('high')
    expect(estimateE1RM(100, 8, 2).confidence).toBe('moderate')
    expect(estimateE1RM(100, 12, 3).confidence).toBe('low')
  })
  test('Brzycki does not blow up near its asymptote', () => {
    const result = estimateE1RM(50, 30, 8, 'brzycki')
    expect(Number.isFinite(result.value)).toBe(true)
    expect(result.value).toBeGreaterThan(0)
  })
})

// ── Set helpers ──────────────────────────────────────────────────────────────

describe('set helpers', () => {
  const sets = [set(1, 60, 8, 2), set(2, 60, 8, 1), set(3, 62.5, null, null)]

  test('completedSets keeps only sets with reps', () => {
    expect(completedSets(sets)).toHaveLength(2)
  })
  test('meanRir averages recorded RIR', () => {
    expect(meanRir(completedSets(sets))).toBe(1.5)
  })
  test('meanRir returns null when no set recorded RIR', () => {
    expect(meanRir([set(1, 60, 8, null)])).toBeNull()
  })
  test('topWeight returns the heaviest working load', () => {
    expect(topWeight(completedSets(sets))).toBe(60)
  })
  test('topWeight returns null for bodyweight work', () => {
    expect(topWeight([set(1, null, 12, 2)])).toBeNull()
  })
})

// ── suggestProgression ───────────────────────────────────────────────────────

describe('suggestProgression', () => {
  test('returns no_history rather than inventing a load', () => {
    const result = suggestProgression(RDL, null)
    expect(result.action).toBe('no_history')
    expect(result.weightKg).toBeNull()
  })

  test('increases load when every set hits the top of the range at target RIR', () => {
    const last = history('2026-08-13', [set(1, 100, 8, 2), set(2, 100, 8, 2), set(3, 100, 8, 2)])
    const result = suggestProgression(RDL, last)
    expect(result.action).toBe('increase_load')
    expect(result.weightKg).toBe(105)
    expect(result.reps).toBe(6) // back to the bottom of the range
  })

  test('adds a rep instead when the smallest plate jump would be too big', () => {
    const last = history('2026-08-13', [set(1, 20, 8, 2), set(2, 20, 8, 2), set(3, 20, 8, 2)])
    const result = suggestProgression(RDL, last)
    expect(result.action).toBe('add_rep')
    expect(result.weightKg).toBe(20)
    expect(result.reps).toBe(9)
    expect(result.reason).toMatch(/too big a step/i)
  })

  test('adds a rep when inside the range at target RIR', () => {
    const last = history('2026-08-13', [set(1, 60, 6, 2), set(2, 60, 6, 3), set(3, 60, 7, 2)])
    const result = suggestProgression(RDL, last)
    expect(result.action).toBe('add_rep')
    expect(result.weightKg).toBe(60)
    expect(result.reps).toBe(7)
  })

  test('holds when the session came in harder than prescribed', () => {
    const last = history('2026-08-13', [set(1, 60, 8, 0), set(2, 60, 8, 1), set(3, 60, 7, 0)])
    const result = suggestProgression(RDL, last)
    expect(result.action).toBe('hold')
    expect(result.weightKg).toBe(60)
  })

  test('reduces load when a set falls under the bottom of the range', () => {
    const last = history('2026-08-13', [set(1, 60, 8, 2), set(2, 60, 5, 0), set(3, 60, 4, 0)])
    const result = suggestProgression(RDL, last)
    expect(result.action).toBe('reduce_load')
    expect(result.weightKg).toBe(55) // 60 × 0.925 = 55.5 → nearest 2.5
  })

  test('reduces load when mean RIR is two or more below target', () => {
    const last = history('2026-08-13', [set(1, 60, 8, 0), set(2, 60, 8, 0), set(3, 60, 8, 0)])
    const result = suggestProgression(RDL, last)
    expect(result.action).toBe('reduce_load')
  })

  test('holds rather than guessing when no RIR was logged', () => {
    const last = history('2026-08-13', [set(1, 60, 8, null), set(2, 60, 8, null)])
    const result = suggestProgression(RDL, last)
    expect(result.action).toBe('hold')
    expect(result.reason).toMatch(/no RIR/i)
  })

  test('bodyweight lifts progress by reps, never load', () => {
    const last = history(
      '2026-08-13',
      [set(1, null, 12, 3), set(2, null, 12, 2), set(3, null, 12, 2)],
      CALF_RAISE.id,
    )
    const result = suggestProgression(CALF_RAISE, last)
    expect(result.action).toBe('add_rep')
    expect(result.weightKg).toBeNull()
    expect(result.reps).toBe(13)
  })

  test('calibration window caps increases to one per week', () => {
    const last = history('2026-08-13', [set(1, 60, 8, 2), set(2, 60, 8, 2), set(3, 60, 8, 2)])
    const capped = suggestProgression(RDL, last, { provisional: true, daysSinceLastIncrease: 3 })
    expect(capped.action).toBe('hold')
    expect(capped.reason).toMatch(/calibrating/i)

    const allowed = suggestProgression(RDL, last, { provisional: true, daysSinceLastIncrease: 8 })
    expect(allowed.action).toBe('increase_load')
  })
})

// ── applyReadinessAdjustment ─────────────────────────────────────────────────

describe('applyReadinessAdjustment', () => {
  test('green leaves the session alone', () => {
    const adj = applyReadinessAdjustment('green')
    expect(adj.mainLiftsRemoved).toBe(false)
    expect(adj.setsDropped).toBe(0)
    expect(adj.accessoryVolumeFactor).toBe(1)
  })

  test('amber drops the top set and caps load', () => {
    const adj = applyReadinessAdjustment('amber')
    expect(adj.setsDropped).toBe(1)
    expect(adj.capLoadAtLastSession).toBe(true)
    expect(adj.accessoryVolumeFactor).toBeCloseTo(0.8)
  })

  test('red removes the main lifts', () => {
    const adj = applyReadinessAdjustment('red')
    expect(adj.mainLiftsRemoved).toBe(true)
  })

  test('flagged pain removes main lifts even on a green day', () => {
    const adj = applyReadinessAdjustment('green', false, true)
    expect(adj.mainLiftsRemoved).toBe(true)
    expect(adj.summary).toMatch(/pain/i)
  })

  test('a provisional green day still caps load increases', () => {
    expect(applyReadinessAdjustment('green', true).capLoadAtLastSession).toBe(true)
  })
})

// ── Volume landmarks ─────────────────────────────────────────────────────────

describe('scaledLandmark', () => {
  test('beginners get lower ceilings than intermediates', () => {
    expect(scaledLandmark('hamstrings', 'beginner').mrv).toBeLessThan(
      scaledLandmark('hamstrings', 'intermediate').mrv,
    )
  })
  test('advanced lifters get higher ceilings', () => {
    expect(scaledLandmark('back', 'advanced').mrv).toBeGreaterThan(
      scaledLandmark('back', 'intermediate').mrv,
    )
  })
})

describe('weeklySetsByMuscle', () => {
  const liftsById = { [RDL.id]: RDL, [CALF_RAISE.id]: CALF_RAISE }

  test('counts hard sets against every primary muscle group', () => {
    const sessions = [
      history('2026-08-18', [set(1, 60, 8, 2), set(2, 60, 8, 2)]),
      history('2026-08-20', [set(1, 60, 8, 1)]),
    ]
    const counts = weeklySetsByMuscle(sessions, liftsById)
    expect(counts.hamstrings).toBe(3)
    expect(counts.glutes).toBe(3)
  })

  test('ignores junk volume taken far from failure', () => {
    const sessions = [history('2026-08-18', [set(1, 20, 8, 8), set(2, 20, 8, 7)])]
    expect(weeklySetsByMuscle(sessions, liftsById).hamstrings).toBeUndefined()
  })

  test('ignores exercises that are not curated key lifts', () => {
    const sessions = [history('2026-08-18', [set(1, 60, 8, 2)], 'some-random-exercise')]
    expect(Object.keys(weeklySetsByMuscle(sessions, liftsById))).toHaveLength(0)
  })
})

// ── shouldDeload ─────────────────────────────────────────────────────────────

describe('shouldDeload', () => {
  const quiet = {
    weeklySetsThisWeek: { hamstrings: 6 },
    weeklySetsLastWeek: { hamstrings: 6 },
    recentAcwr: [0.9, 1.0, 1.05],
    recentRirDeficit: [0, -0.5],
  }

  test('does not fire on a normal week', () => {
    expect(shouldDeload(quiet).shouldDeload).toBe(false)
  })

  test('fires after two weeks above MRV', () => {
    const verdict = shouldDeload({
      ...quiet,
      weeklySetsThisWeek: { hamstrings: 18 },
      weeklySetsLastWeek: { hamstrings: 17 },
    })
    expect(verdict.shouldDeload).toBe(true)
    expect(verdict.reason).toMatch(/hamstrings/)
  })

  test('does not fire on a single week above MRV', () => {
    expect(
      shouldDeload({
        ...quiet,
        weeklySetsThisWeek: { hamstrings: 18 },
        weeklySetsLastWeek: { hamstrings: 6 },
      }).shouldDeload,
    ).toBe(false)
  })

  test('fires on three consecutive days of ACWR above 1.3', () => {
    const verdict = shouldDeload({ ...quiet, recentAcwr: [1.1, 1.35, 1.4, 1.45] })
    expect(verdict.shouldDeload).toBe(true)
    expect(verdict.reason).toMatch(/acute:chronic/i)
  })

  test('fires when the same load keeps coming in far harder than prescribed', () => {
    const verdict = shouldDeload({ ...quiet, recentRirDeficit: [-1.5, -2] })
    expect(verdict.shouldDeload).toBe(true)
    expect(verdict.reason).toMatch(/harder than prescribed/i)
  })

  test('always explains itself when it fires', () => {
    const verdict = shouldDeload({ ...quiet, recentAcwr: [1.4, 1.4, 1.4] })
    expect(verdict.reason).toBeTruthy()
  })
})

// ── checkConcurrentConflict ──────────────────────────────────────────────────

describe('checkConcurrentConflict', () => {
  const monday = new Date('2026-08-17T09:00:00Z')
  const tuesday = new Date('2026-08-18T09:00:00Z')

  test('reports no conflict when there is no run plan yet', () => {
    const result = checkConcurrentConflict(monday, true, [])
    expect(result.conflict).toBe(false)
    expect(result.reason).toMatch(/no run plan/i)
  })

  test('flags heavy legs the day before a long run', () => {
    const result = checkConcurrentConflict(monday, true, [{ date: tuesday, runType: 'long' }])
    expect(result.conflict).toBe(true)
    expect(result.reason).toMatch(/tomorrow/i)
  })

  test('flags sharing the day with the A-run', () => {
    const result = checkConcurrentConflict(monday, true, [
      { date: monday, runType: 'tempo', priority: 'A' },
    ])
    expect(result.conflict).toBe(true)
    expect(result.reason).toMatch(/A-run/i)
  })

  test('allows heavy legs the day before an easy run', () => {
    expect(
      checkConcurrentConflict(monday, true, [{ date: tuesday, runType: 'easy' }]).conflict,
    ).toBe(false)
  })

  test('upper-body work never conflicts', () => {
    expect(
      checkConcurrentConflict(monday, false, [{ date: tuesday, runType: 'long' }]).conflict,
    ).toBe(false)
  })
})

// ── filterContraindicated ────────────────────────────────────────────────────

describe('filterContraindicated', () => {
  const lifts = [RDL, LEG_EXTENSION, DEEP_SQUAT, CALF_RAISE]

  test('takes the conservative posture when no clearance has been entered', () => {
    const result = filterContraindicated(lifts, null)
    expect(result.usingConservativeDefault).toBe(true)
    expect(result.allowed.map((l) => l.id)).toEqual([RDL.id, CALF_RAISE.id])
    expect(result.blocked).toHaveLength(2)
  })

  test('says the clearance has to come from a person, not the app', () => {
    const result = filterContraindicated(lifts, null)
    expect(result.blocked[0].reason).toMatch(/no surgical clearance entered/i)
  })

  test('respects entered clearance', () => {
    const context: RecoveryContext = {
      surgicalLeg: 'left',
      clearance: {
        maxKneeFlexionDeg: 135,
        openChainCleared: true,
        impactCleared: true,
        pivotCleared: true,
        setBy: 'user',
      },
    }
    const result = filterContraindicated(lifts, context)
    expect(result.usingConservativeDefault).toBe(false)
    expect(result.allowed).toHaveLength(4)
  })

  test('limited knee flexion still blocks deep-loaded positions', () => {
    const context: RecoveryContext = {
      clearance: {
        maxKneeFlexionDeg: 100,
        openChainCleared: true,
        impactCleared: true,
        pivotCleared: true,
        setBy: 'user',
      },
    }
    const result = filterContraindicated(lifts, context)
    expect(result.allowed.map((l) => l.id)).not.toContain(DEEP_SQUAT.id)
  })

  test('flagged pain narrows the menu even with full clearance', () => {
    const context: RecoveryContext = {
      clearance: {
        maxKneeFlexionDeg: 135,
        openChainCleared: true,
        impactCleared: true,
        pivotCleared: true,
        setBy: 'user',
      },
    }
    const result = filterContraindicated(lifts, context, 'yes')
    expect(result.allowed.map((l) => l.id)).not.toContain(DEEP_SQUAT.id)
    expect(result.blocked.some((b) => b.reason.match(/pain/i))).toBe(true)
  })
})

// ── deriveWorkingLoadAnchor ──────────────────────────────────────────────────

describe('deriveWorkingLoadAnchor', () => {
  test('no history means an estimate with low confidence', () => {
    const anchor = deriveWorkingLoadAnchor([], 2)
    expect(anchor.source).toBe('estimate')
    expect(anchor.value).toBeNull()
  })

  test('one or two sessions upgrade it to observed', () => {
    const anchor = deriveWorkingLoadAnchor(
      [history('2026-08-13', [set(1, 60, 8, 2)])],
      2,
    )
    expect(anchor.source).toBe('observed')
    expect(anchor.value).toBe(60)
  })

  test('three clean sessions on target confirm the anchor', () => {
    const anchor = deriveWorkingLoadAnchor(
      [
        history('2026-08-06', [set(1, 55, 8, 2)]),
        history('2026-08-13', [set(1, 57.5, 8, 2)]),
        history('2026-08-20', [set(1, 60, 8, 2)]),
      ],
      2,
    )
    expect(anchor.source).toBe('confirmed')
    expect(anchor.value).toBe(60)
    expect(anchor.confidence).toBeGreaterThan(0.8)
  })

  test('erratic RIR keeps it at observed', () => {
    const anchor = deriveWorkingLoadAnchor(
      [
        history('2026-08-06', [set(1, 55, 8, 5)]),
        history('2026-08-13', [set(1, 57.5, 8, 0)]),
        history('2026-08-20', [set(1, 60, 8, 4)]),
      ],
      2,
    )
    expect(anchor.source).toBe('observed')
  })

  test('a falling load keeps it at observed', () => {
    const anchor = deriveWorkingLoadAnchor(
      [
        history('2026-08-06', [set(1, 65, 8, 2)]),
        history('2026-08-13', [set(1, 60, 8, 2)]),
        history('2026-08-20', [set(1, 57.5, 8, 2)]),
      ],
      2,
    )
    expect(anchor.source).toBe('observed')
  })

  test('sessions arriving out of order are still read chronologically', () => {
    const anchor = deriveWorkingLoadAnchor(
      [
        history('2026-08-20', [set(1, 60, 8, 2)]),
        history('2026-08-06', [set(1, 55, 8, 2)]),
        history('2026-08-13', [set(1, 57.5, 8, 2)]),
      ],
      2,
    )
    expect(anchor.value).toBe(60)
    expect(anchor.source).toBe('confirmed')
  })
})

// ── latestByExercise — today exclusion ───────────────────────────────────────

describe('latestByExercise', () => {
  const yesterday = history('2026-08-19', [set(1, 60, 8, 2)])
  const todaySession = history('2026-08-20', [set(1, 62.5, 6, 2)])

  test('returns the most recent session per exercise', () => {
    const out = latestByExercise([yesterday, todaySession])
    expect(out[RDL.id].date).toEqual(new Date('2026-08-20'))
  })

  test('excludes today when asked, so a session is not built against itself', () => {
    const out = latestByExercise([yesterday, todaySession], {
      before: new Date('2026-08-20T00:00:00.000Z'),
    })
    expect(out[RDL.id].date).toEqual(new Date('2026-08-19'))
  })

  test('returns nothing when every session is on or after the cutoff', () => {
    const out = latestByExercise([todaySession], {
      before: new Date('2026-08-20T00:00:00.000Z'),
    })
    expect(out[RDL.id]).toBeUndefined()
  })
})
