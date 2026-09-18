// ── Garmin structured-workout mapper tests ────────────────────────────────────
// Framework §7. The mapper is the half of the write-back that can be proven
// here, so it is tested to the letter: every step type, every end condition,
// the speed inversion, the repeat groups, and every case where the honest
// answer is to send nothing at all.
//
// The transport is tested only for its *refusals*, because there are no Garmin
// credentials in this environment and no call has ever been made. What the
// tests below lock down is that it never reports a success it did not observe.

import {
  END_CONDITION,
  PACE_WINDOW_SEC,
  SPORT_RUNNING,
  STEP_TYPE,
  TARGET_TYPE,
  heartRateTarget,
  paceTarget,
  paceToMetersPerSecond,
  pushWorkout,
  targetFor,
  toGarminWorkout,
} from '../garminWorkout'
import type { GarminExecutableStep, GarminRepeatStep } from '../garminWorkout'
import type { RunParams, SessionBlock, SessionItem } from '../../types/session'

const DATE = new Date('2026-09-16T00:00:00')

// ── Fixtures ──────────────────────────────────────────────────────────────────

function runItem(id: string, params: Partial<RunParams>, over: Partial<SessionItem> = {}): SessionItem {
  return {
    id,
    ref: { kind: 'run', id: params.runType ?? 'easy', name: 'Run' },
    params: { kind: 'run', runType: 'easy', ...params } as RunParams,
    status: 'prescribed',
    ...over,
  }
}

function squat(): SessionItem {
  return {
    id: 'squat-1',
    ref: { kind: 'exercise', id: 'back-squat', name: 'Back Squat' },
    params: { kind: 'strength', sets: 3, reps: 8, weightKg: 60, targetRir: 2 },
    status: 'prescribed',
  }
}

function block(kind: SessionBlock['kind'], items: SessionItem[]): SessionBlock {
  return { id: `b-${kind}`, kind, label: kind, items }
}

function steps(blocks: SessionBlock[]) {
  const mapped = toGarminWorkout(blocks, DATE)
  if (!mapped.workout) throw new Error(mapped.reason ?? 'no workout')
  return mapped.workout.workoutSegments[0].workoutSteps
}

// ── Speed and pace ────────────────────────────────────────────────────────────

describe('paceToMetersPerSecond', () => {
  it('converts seconds per km to metres per second', () => {
    // 5:00/km = 300 s/km = 3.333 m/s
    expect(paceToMetersPerSecond(300)).toBeCloseTo(3.3333, 3)
    // 4:00/km = 240 s/km = 4.167 m/s
    expect(paceToMetersPerSecond(240)).toBeCloseTo(4.1667, 3)
  })

  it('returns zero rather than Infinity for nonsense', () => {
    expect(paceToMetersPerSecond(0)).toBe(0)
    expect(paceToMetersPerSecond(-10)).toBe(0)
    expect(paceToMetersPerSecond(Number.NaN)).toBe(0)
  })
})

describe('paceTarget', () => {
  it('sends a window, not a single pace — a watch cannot hold you to a point', () => {
    const target = paceTarget(300)
    expect(target.targetValueOne).not.toBe(target.targetValueTwo)
  })

  it('puts the slower bound first, because slower is a lower speed', () => {
    const target = paceTarget(300)
    expect(target.targetValueOne!).toBeLessThan(target.targetValueTwo!)
    expect(target.targetValueOne).toBeCloseTo(paceToMetersPerSecond(300 + PACE_WINDOW_SEC), 4)
    expect(target.targetValueTwo).toBeCloseTo(paceToMetersPerSecond(300 - PACE_WINDOW_SEC), 4)
  })

  it('uses Garmin\'s pace.zone target type', () => {
    expect(paceTarget(300).targetType).toEqual(TARGET_TYPE.pace)
  })
})

describe('heartRateTarget', () => {
  it('orders the bounds low to high whichever way round they arrive', () => {
    expect(heartRateTarget(150, 120)).toMatchObject({ targetValueOne: 120, targetValueTwo: 150 })
  })

  it('rounds to whole beats', () => {
    expect(heartRateTarget(120.4, 145.6)).toMatchObject({ targetValueOne: 120, targetValueTwo: 146 })
  })
})

describe('targetFor', () => {
  it('prefers heart rate, which is what an easy run is actually for (§7)', () => {
    const target = targetFor({
      kind: 'run',
      runType: 'easy',
      targetHrLow: 120,
      targetHrHigh: 145,
      targetPaceSecPerKm: 300,
    })
    expect(target.targetType).toEqual(TARGET_TYPE.heartRate)
  })

  it('falls back to pace when there is no HR range', () => {
    expect(
      targetFor({ kind: 'run', runType: 'tempo', targetPaceSecPerKm: 260 }).targetType,
    ).toEqual(TARGET_TYPE.pace)
  })

  it('sends no target rather than inventing one', () => {
    const target = targetFor({ kind: 'run', runType: 'easy' })
    expect(target.targetType).toEqual(TARGET_TYPE.none)
    expect(target.targetValueOne).toBeNull()
    expect(target.targetValueTwo).toBeNull()
  })
})

// ── The mapper ────────────────────────────────────────────────────────────────

describe('toGarminWorkout — the envelope', () => {
  it('declares running and one ordered segment', () => {
    const mapped = toGarminWorkout([block('main', [runItem('r', { durationMin: 45 })])], DATE)
    expect(mapped.workout!.sportType).toEqual(SPORT_RUNNING)
    expect(mapped.workout!.workoutSegments).toHaveLength(1)
    expect(mapped.workout!.workoutSegments[0]).toMatchObject({
      segmentOrder: 1,
      sportType: SPORT_RUNNING,
    })
  })

  it('names the workout after the date by default', () => {
    const mapped = toGarminWorkout([block('main', [runItem('r', { durationMin: 45 })])], DATE)
    expect(mapped.workout!.workoutName).toBe('Running on AI — 2026-09-16')
  })

  it('takes a name and the coach\'s why when given them', () => {
    const mapped = toGarminWorkout([block('main', [runItem('r', { durationMin: 45 })])], DATE, {
      name: 'Thursday tempo',
      description: 'Holding threshold for 20 minutes.',
    })
    expect(mapped.workout!.workoutName).toBe('Thursday tempo')
    expect(mapped.workout!.description).toBe('Holding threshold for 20 minutes.')
  })

  it('numbers steps from one, in order', () => {
    const out = steps([
      block('warmup', [runItem('w', { durationMin: 10 })]),
      block('main', [runItem('m', { durationMin: 30 })]),
      block('cooldown', [runItem('c', { durationMin: 5 })]),
    ])
    expect(out.map((s) => s.stepId)).toEqual([1, 2, 3])
    expect(out.map((s) => s.stepOrder)).toEqual([1, 2, 3])
  })
})

describe('toGarminWorkout — step types by block', () => {
  it('maps warmup, main and cooldown blocks to their Garmin step types', () => {
    const out = steps([
      block('warmup', [runItem('w', { durationMin: 10 })]),
      block('main', [runItem('m', { durationMin: 30 })]),
      block('cooldown', [runItem('c', { durationMin: 5 })]),
    ])
    expect(out[0].stepType).toEqual(STEP_TYPE.warmup)
    expect(out[1].stepType).toEqual(STEP_TYPE.interval)
    expect(out[2].stepType).toEqual(STEP_TYPE.cooldown)
  })
})

describe('toGarminWorkout — end conditions', () => {
  it('uses time in seconds when the item names a duration', () => {
    const step = steps([block('main', [runItem('r', { durationMin: 45 })])])[0] as GarminExecutableStep
    expect(step.endCondition).toEqual(END_CONDITION.time)
    expect(step.endConditionValue).toBe(2700)
  })

  it('uses distance in metres when it names only a distance', () => {
    const step = steps([
      block('main', [runItem('r', { durationMin: null, distanceKm: 12.5 })]),
    ])[0] as GarminExecutableStep
    expect(step.endCondition).toEqual(END_CONDITION.distance)
    expect(step.endConditionValue).toBe(12500)
  })

  it('falls back to the lap button rather than guessing a length', () => {
    const step = steps([block('main', [runItem('r', {})])])[0] as GarminExecutableStep
    expect(step.endCondition).toEqual(END_CONDITION.lapButton)
    expect(step.endConditionValue).toBeNull()
  })
})

describe('toGarminWorkout — intervals', () => {
  const intervalRun = runItem('r-vo2', {
    runType: 'vo2',
    durationMin: 50,
    targetHrLow: 165,
    targetHrHigh: 178,
    intervals: [{ repeat: 5, workSec: 180, recoverSec: 120, label: '5×3 min' }],
  })

  it('becomes a repeat group with the iteration count on both fields', () => {
    const group = steps([block('main', [intervalRun])])[0] as GarminRepeatStep
    expect(group.type).toBe('RepeatGroupDTO')
    expect(group.stepType).toEqual(STEP_TYPE.repeat)
    expect(group.numberOfIterations).toBe(5)
    expect(group.endCondition).toEqual(END_CONDITION.iterations)
    expect(group.endConditionValue).toBe(5)
    expect(group.smartRepeat).toBe(false)
  })

  it('holds a work step and a recovery step, with the target on the work', () => {
    const group = steps([block('main', [intervalRun])])[0] as GarminRepeatStep
    expect(group.workoutSteps).toHaveLength(2)
    expect(group.workoutSteps[0]).toMatchObject({
      stepType: STEP_TYPE.interval,
      endConditionValue: 180,
      targetValueOne: 165,
      targetValueTwo: 178,
    })
    expect(group.workoutSteps[1]).toMatchObject({
      stepType: STEP_TYPE.recovery,
      endConditionValue: 120,
      targetType: TARGET_TYPE.none,
    })
  })

  it('carries the interval label as the step description', () => {
    const group = steps([block('main', [intervalRun])])[0] as GarminRepeatStep
    expect(group.workoutSteps[0].description).toBe('5×3 min')
  })

  it('omits a zero-length recovery rather than sending an empty step', () => {
    const continuous = runItem('r', {
      runType: 'progression',
      intervals: [{ repeat: 3, workSec: 600, recoverSec: 0 }],
    })
    const group = steps([block('main', [continuous])])[0] as GarminRepeatStep
    expect(group.workoutSteps).toHaveLength(1)
  })

  it('does not also emit the whole-session duration — that would double-count', () => {
    const out = steps([block('main', [intervalRun])])
    expect(out).toHaveLength(1)
  })

  it('emits one group per interval set', () => {
    const pyramid = runItem('r', {
      runType: 'fartlek',
      intervals: [
        { repeat: 2, workSec: 60, recoverSec: 60 },
        { repeat: 2, workSec: 120, recoverSec: 90 },
      ],
    })
    const out = steps([block('main', [pyramid])])
    expect(out).toHaveLength(2)
    expect((out[0] as GarminRepeatStep).workoutSteps[0].endConditionValue).toBe(60)
    expect((out[1] as GarminRepeatStep).workoutSteps[0].endConditionValue).toBe(120)
  })
})

describe('toGarminWorkout — what it refuses to send', () => {
  it('skips non-run items by name rather than inventing a step for them', () => {
    const mapped = toGarminWorkout(
      [block('main', [runItem('r', { durationMin: 45 }), squat()])],
      DATE,
    )
    expect(mapped.workout!.workoutSegments[0].workoutSteps).toHaveLength(1)
    expect(mapped.skipped).toEqual([
      { itemId: 'squat-1', name: 'Back Squat', reason: expect.stringContaining('exercise') },
    ])
  })

  it('skips an item already marked skipped', () => {
    const mapped = toGarminWorkout(
      [block('main', [runItem('r', { durationMin: 45 }, { status: 'skipped' })])],
      DATE,
    )
    expect(mapped.workout).toBeNull()
    expect(mapped.skipped[0].reason).toBe('Already marked skipped.')
  })

  it('sends nothing, with a reason, on a lifting-only day', () => {
    const mapped = toGarminWorkout([block('main', [squat()])], DATE)
    expect(mapped.workout).toBeNull()
    expect(mapped.reason).toContain('no structured workout to send')
  })

  it('sends nothing for an empty session', () => {
    const mapped = toGarminWorkout([], DATE)
    expect(mapped.workout).toBeNull()
    expect(mapped.reason).not.toBeNull()
  })
})

describe('toGarminWorkout — purity', () => {
  it('is deterministic: the same session maps to the same bytes', () => {
    const b = [
      block('warmup', [runItem('w', { durationMin: 10 })]),
      block('main', [
        runItem('m', {
          runType: 'vo2',
          intervals: [{ repeat: 4, workSec: 240, recoverSec: 120 }],
          targetPaceSecPerKm: 230,
        }),
      ]),
    ]
    expect(JSON.stringify(toGarminWorkout(b, DATE))).toBe(JSON.stringify(toGarminWorkout(b, DATE)))
  })

  it('does not mutate the session it was given', () => {
    const b = [block('main', [runItem('r', { durationMin: 45 })])]
    const snapshot = JSON.stringify(b)
    toGarminWorkout(b, DATE)
    expect(JSON.stringify(b)).toBe(snapshot)
  })
})

// ── The transport — only its refusals are provable here ───────────────────────

describe('pushWorkout (UNVERIFIED against a live account)', () => {
  const workout = toGarminWorkout([block('main', [runItem('r', { durationMin: 45 })])], DATE)
    .workout!

  it('is off unless explicitly turned on', async () => {
    const fetchImpl = jest.fn()
    const result = await pushWorkout(workout, {
      enabled: false,
      fetchImpl: fetchImpl as never,
    })
    expect(result.status).toBe('disabled')
    expect(result.garminWorkoutId).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports unavailable, not success, with no token', async () => {
    const fetchImpl = jest.fn()
    const result = await pushWorkout(workout, {
      enabled: true,
      token: null,
      fetchImpl: fetchImpl as never,
    })
    expect(result.status).toBe('unavailable')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.message).toContain('nothing was sent')
  })

  it('never reports a success Garmin did not give it', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const result = await pushWorkout(workout, {
      enabled: true,
      token: 'tok',
      fetchImpl: (async () => ({
        ok: false,
        status: 403,
        text: async () => 'Forbidden: token tok',
        json: async () => ({}),
      })) as never,
    })
    expect(result.status).toBe('failed')
    expect(result.message).toContain('Nothing is on the watch')
    // The body can echo the token (§20).
    expect(result.message).not.toContain('tok')
    spy.mockRestore()
  })

  it('turns a thrown fetch into a failure, not a crash', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const result = await pushWorkout(workout, {
      enabled: true,
      token: 'tok',
      fetchImpl: (async () => {
        throw new Error('ENOTFOUND connect.garmin.com')
      }) as never,
    })
    expect(result.status).toBe('failed')
    expect(result.message).not.toContain('ENOTFOUND')
    spy.mockRestore()
  })

  it('posts the mapped payload and returns the id Garmin gave back', async () => {
    const calls: Array<{ url: string; init: Record<string, unknown> }> = []
    const result = await pushWorkout(workout, {
      enabled: true,
      token: 'tok',
      fetchImpl: (async (url: string, init: Record<string, unknown>) => {
        calls.push({ url, init })
        return { ok: true, status: 200, text: async () => '', json: async () => ({ workoutId: 987 }) }
      }) as never,
    })
    expect(result.status).toBe('pushed')
    expect(result.garminWorkoutId).toBe('987')
    expect(calls[0].url).toContain('/workout-service/workout')
    expect(JSON.parse(calls[0].init.body as string).sportType).toEqual(SPORT_RUNNING)
  })

  it('does not claim a link it does not have when no id comes back', async () => {
    const result = await pushWorkout(workout, {
      enabled: true,
      token: 'tok',
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({}),
      })) as never,
    })
    expect(result.garminWorkoutId).toBeNull()
    expect(result.message).toContain('did not return an id')
  })
})
