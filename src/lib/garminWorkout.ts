// ── Garmin structured-workout write-back ──────────────────────────────────────
// Framework §7: "emit the session as a structured workout and push via
// python-garminconnect so the watch beeps you through it", and §4, which names
// that library specifically because the JS `garmin-connect` package this app
// reads with does **not** implement workout push.
//
// That split is why this file is in two clearly-separated halves:
//
//   1. **The mapper** — `toGarminWorkout`. Pure, total, and fully tested. A
//      `Session` in, Garmin's `workout-service` JSON out. This is the part that
//      has to be provably correct, because it is the part that encodes what you
//      will actually be asked to run.
//   2. **The transport** — `pushWorkout` / `pushSessionToGarmin`. Unverifiable
//      here: there are no Garmin credentials in this environment, so no call
//      has ever been made and none of it is proven. It is behind an explicit
//      opt-in flag, it records every attempt in `garmin_push_log`, and with no
//      credentials it logs `unavailable` and says so. It does **not** pretend a
//      push succeeded — a fabricated success would be worse than no feature,
//      because you would go to the watch expecting a workout that is not there.
//
// Only run items map. A lift, a plyo drill or a calf raise has no honest
// representation as a running workout step, and inventing one would put a
// silent lie on your wrist. They are skipped, by name, in the result.

import { startOfDay } from 'date-fns'
import { prisma } from './db'
import type { RunParams, SessionBlock, SessionItem } from '../types/session'

// ── Garmin's enums ────────────────────────────────────────────────────────────
// These are the `workout-service` vocabulary ids used by Garmin Connect and by
// `python-garminconnect`'s workout helpers. They are pinned in one table so the
// mapper never sprinkles magic numbers, and so a future correction against a
// live account is a one-line change here rather than an archaeology exercise.
//
// UNVERIFIED AGAINST A LIVE ACCOUNT — see the module header. The structure and
// the pairing of key↔id are what the tests lock down.

export const SPORT_RUNNING = { sportTypeId: 1, sportTypeKey: 'running' } as const

export const STEP_TYPE = {
  warmup: { stepTypeId: 1, stepTypeKey: 'warmup' },
  cooldown: { stepTypeId: 2, stepTypeKey: 'cooldown' },
  interval: { stepTypeId: 3, stepTypeKey: 'interval' },
  recovery: { stepTypeId: 4, stepTypeKey: 'recovery' },
  rest: { stepTypeId: 5, stepTypeKey: 'rest' },
  repeat: { stepTypeId: 6, stepTypeKey: 'repeat' },
  other: { stepTypeId: 7, stepTypeKey: 'other' },
} as const

export const END_CONDITION = {
  lapButton: { conditionTypeId: 1, conditionTypeKey: 'lap.button' },
  time: { conditionTypeId: 2, conditionTypeKey: 'time' },
  distance: { conditionTypeId: 3, conditionTypeKey: 'distance' },
  iterations: { conditionTypeId: 7, conditionTypeKey: 'iterations' },
} as const

export const TARGET_TYPE = {
  none: { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' },
  heartRate: { workoutTargetTypeId: 4, workoutTargetTypeKey: 'heart.rate.zone' },
  pace: { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone' },
} as const

/**
 * How wide a pace target is, in seconds per km either side.
 *
 * A single pace is not a target a watch can hold you to — it alarms constantly.
 * Framework §7 wants the watch to beep you *through* the session, not nag, so
 * every pace becomes a window.
 */
export const PACE_WINDOW_SEC = 5

// ── The output shape ──────────────────────────────────────────────────────────

export interface GarminTarget {
  targetType: { workoutTargetTypeId: number; workoutTargetTypeKey: string }
  targetValueOne: number | null
  targetValueTwo: number | null
  zoneNumber: number | null
}

export interface GarminExecutableStep extends GarminTarget {
  type: 'ExecutableStepDTO'
  stepId: number
  stepOrder: number
  stepType: { stepTypeId: number; stepTypeKey: string }
  endCondition: { conditionTypeId: number; conditionTypeKey: string }
  endConditionValue: number | null
  description: string
}

export interface GarminRepeatStep {
  type: 'RepeatGroupDTO'
  stepId: number
  stepOrder: number
  stepType: { stepTypeId: number; stepTypeKey: string }
  numberOfIterations: number
  smartRepeat: false
  endCondition: { conditionTypeId: number; conditionTypeKey: string }
  endConditionValue: number
  workoutSteps: GarminExecutableStep[]
}

export type GarminStep = GarminExecutableStep | GarminRepeatStep

export interface GarminWorkout {
  workoutName: string
  description: string
  sportType: typeof SPORT_RUNNING
  workoutSegments: Array<{
    segmentOrder: number
    sportType: typeof SPORT_RUNNING
    workoutSteps: GarminStep[]
  }>
}

export interface MappedWorkout {
  workout: GarminWorkout | null
  /** Items that were deliberately not mapped, and why. Never silent. */
  skipped: Array<{ itemId: string; name: string; reason: string }>
  /** Populated when there is nothing to push. */
  reason: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Garmin stores speed, not pace: metres per second, rounded to the decimetre. */
export function paceToMetersPerSecond(secPerKm: number): number {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return 0
  return Math.round((1000 / secPerKm) * 10000) / 10000
}

/**
 * A pace target as the speed window Garmin wants.
 *
 * `targetValueOne` is the slower bound and `targetValueTwo` the faster one,
 * because a *slower* pace is a *lower* speed — the inversion is the easiest
 * thing in this file to get backwards, so it is asserted in the tests.
 */
export function paceTarget(secPerKm: number): GarminTarget {
  const slow = paceToMetersPerSecond(secPerKm + PACE_WINDOW_SEC)
  const fast = paceToMetersPerSecond(Math.max(1, secPerKm - PACE_WINDOW_SEC))
  return {
    targetType: TARGET_TYPE.pace,
    targetValueOne: slow,
    targetValueTwo: fast,
    zoneNumber: null,
  }
}

export function heartRateTarget(low: number, high: number): GarminTarget {
  return {
    targetType: TARGET_TYPE.heartRate,
    targetValueOne: Math.round(Math.min(low, high)),
    targetValueTwo: Math.round(Math.max(low, high)),
    zoneNumber: null,
  }
}

const NO_TARGET: GarminTarget = {
  targetType: TARGET_TYPE.none,
  targetValueOne: null,
  targetValueTwo: null,
  zoneNumber: null,
}

/**
 * Which target a run item gets.
 *
 * Heart rate wins over pace when both are present: an HR ceiling is the thing
 * an easy run is actually *for* (§7), and a pace target on a recovery day is
 * how easy days drift hot — the exact pattern §13 has to learn its way out of.
 */
export function targetFor(params: RunParams): GarminTarget {
  if (params.targetHrLow != null && params.targetHrHigh != null) {
    return heartRateTarget(params.targetHrLow, params.targetHrHigh)
  }
  if (params.targetPaceSecPerKm != null && params.targetPaceSecPerKm > 0) {
    return paceTarget(params.targetPaceSecPerKm)
  }
  return NO_TARGET
}

interface StepCounter {
  next: number
}

function executable(
  counter: StepCounter,
  stepType: (typeof STEP_TYPE)[keyof typeof STEP_TYPE],
  end: { condition: (typeof END_CONDITION)[keyof typeof END_CONDITION]; value: number | null },
  target: GarminTarget,
  description: string,
): GarminExecutableStep {
  const id = counter.next++
  return {
    type: 'ExecutableStepDTO',
    stepId: id,
    stepOrder: id,
    stepType,
    endCondition: end.condition,
    endConditionValue: end.value,
    ...target,
    description: description.slice(0, 512),
  }
}

/** Duration first, distance second, lap button when the item names neither. */
function endConditionFor(params: RunParams): {
  condition: (typeof END_CONDITION)[keyof typeof END_CONDITION]
  value: number | null
} {
  if (params.durationMin != null && params.durationMin > 0) {
    return { condition: END_CONDITION.time, value: Math.round(params.durationMin * 60) }
  }
  if (params.distanceKm != null && params.distanceKm > 0) {
    return { condition: END_CONDITION.distance, value: Math.round(params.distanceKm * 1000) }
  }
  return { condition: END_CONDITION.lapButton, value: null }
}

/**
 * The interval block of a run item, as a Garmin repeat group.
 *
 * A zero-second recovery is omitted rather than emitted as a zero-length step,
 * which some watch firmware skips and some stalls on. Continuous efforts with
 * no recovery are legitimate — a progression, a pyramid — so the group is
 * built to hold one or two children.
 */
function intervalSteps(
  counter: StepCounter,
  params: RunParams,
  target: GarminTarget,
): GarminRepeatStep[] {
  if (!params.intervals || params.intervals.length === 0) return []

  return params.intervals.map((interval) => {
    const groupId = counter.next++
    const children: GarminExecutableStep[] = [
      executable(
        counter,
        STEP_TYPE.interval,
        { condition: END_CONDITION.time, value: Math.round(interval.workSec) },
        target,
        interval.label ?? `${interval.repeat}×${interval.workSec}s`,
      ),
    ]
    if (interval.recoverSec > 0) {
      children.push(
        executable(
          counter,
          STEP_TYPE.recovery,
          { condition: END_CONDITION.time, value: Math.round(interval.recoverSec) },
          NO_TARGET,
          'Recovery — easy.',
        ),
      )
    }

    return {
      type: 'RepeatGroupDTO',
      stepId: groupId,
      stepOrder: groupId,
      stepType: STEP_TYPE.repeat,
      numberOfIterations: Math.round(interval.repeat),
      smartRepeat: false,
      endCondition: END_CONDITION.iterations,
      endConditionValue: Math.round(interval.repeat),
      workoutSteps: children,
    }
  })
}

/** Block placement → Garmin step type. Warmups warm up; mains are the work. */
function stepTypeForBlock(blockKind: string): (typeof STEP_TYPE)[keyof typeof STEP_TYPE] {
  if (blockKind === 'warmup') return STEP_TYPE.warmup
  if (blockKind === 'cooldown') return STEP_TYPE.cooldown
  return STEP_TYPE.interval
}

function isRunItem(item: SessionItem): item is SessionItem & { params: RunParams } {
  return item.params.kind === 'run'
}

// ── The mapper ────────────────────────────────────────────────────────────────

export interface MapOptions {
  /** What the workout is called on the watch. Defaults to the date. */
  name?: string
  /** The coach's one-line why, carried onto the watch (§12). */
  description?: string
}

/**
 * A Session's running work as a Garmin structured workout.
 *
 * Pure and total: no clock, no network, no randomness, and every input produces
 * either a workout or a stated reason there is none. That is what makes it the
 * provable half of §7's write-back.
 */
export function toGarminWorkout(
  blocks: SessionBlock[],
  date: Date,
  opts: MapOptions = {},
): MappedWorkout {
  const skipped: Array<{ itemId: string; name: string; reason: string }> = []
  const counter: StepCounter = { next: 1 }
  const steps: GarminStep[] = []

  for (const block of blocks) {
    for (const item of block.items) {
      if (!isRunItem(item)) {
        skipped.push({
          itemId: item.id,
          name: item.ref.name,
          reason: `A ${item.ref.kind} item has no honest representation as a running workout step, so it stays in the app.`,
        })
        continue
      }
      if (item.status === 'skipped') {
        skipped.push({
          itemId: item.id,
          name: item.ref.name,
          reason: 'Already marked skipped.',
        })
        continue
      }

      const params = item.params
      const target = targetFor(params)
      const intervals = intervalSteps(counter, params, target)

      if (intervals.length > 0) {
        // An interval item's `durationMin` is the whole session including the
        // reps, so emitting it as well would double-count the work.
        steps.push(...intervals)
        continue
      }

      steps.push(
        executable(
          counter,
          stepTypeForBlock(block.kind),
          endConditionFor(params),
          target,
          item.why ?? item.ref.name,
        ),
      )
    }
  }

  if (steps.length === 0) {
    return {
      workout: null,
      skipped,
      reason:
        'Nothing in today\'s session is a run, so there is no structured workout to send. The watch is not the right place for the rest of it.',
    }
  }

  const iso = startOfDay(date).toISOString().slice(0, 10)

  return {
    workout: {
      workoutName: (opts.name ?? `Running on AI — ${iso}`).slice(0, 80),
      description: (opts.description ?? '').slice(0, 1024),
      sportType: SPORT_RUNNING,
      workoutSegments: [{ segmentOrder: 1, sportType: SPORT_RUNNING, workoutSteps: steps }],
    },
    skipped,
    reason: null,
  }
}

// ── The transport — UNVERIFIED ────────────────────────────────────────────────
// Everything below this line has never run against Garmin. There are no
// credentials in this environment, framework §4 names `python-garminconnect`
// for exactly this operation because the JS client cannot do it, and the
// endpoint below is the one that library posts to.
//
// So it is gated three ways: an explicit opt-in env flag, a bearer token that
// has to exist, and a log row written before anything is claimed. The one thing
// it will never do is report a success it did not observe.

const WORKOUT_ENDPOINT = 'https://connect.garmin.com/workout-service/workout'

export type PushStatus = 'pushed' | 'failed' | 'unavailable' | 'nothing_to_push' | 'disabled'

export interface PushResult {
  status: PushStatus
  garminWorkoutId: string | null
  /** Plain language. Safe to show; never carries a token or a raw exception. */
  message: string
  workout: GarminWorkout | null
  skipped: Array<{ itemId: string; name: string; reason: string }>
}

export interface PushOptions {
  /** Injected in tests; the real one is `globalThis.fetch`. */
  fetchImpl?: (url: string, init: Record<string, unknown>) => Promise<{
    ok: boolean
    status: number
    text: () => Promise<string>
    json: () => Promise<unknown>
  }>
  /** Overrides `process.env.GARMIN_OAUTH2`. */
  token?: string | null
  /** Overrides `process.env.GARMIN_WORKOUT_PUSH`. */
  enabled?: boolean
}

function pushEnabled(opts: PushOptions): boolean {
  if (opts.enabled !== undefined) return opts.enabled
  return process.env.GARMIN_WORKOUT_PUSH === '1'
}

/**
 * POST a mapped workout to Garmin. **Never verified against a live account.**
 *
 * Returns `unavailable` rather than throwing when it cannot even try, so the
 * caller always has something honest to write to `garmin_push_log` and
 * something honest to show on screen.
 */
export async function pushWorkout(
  workout: GarminWorkout,
  opts: PushOptions = {},
): Promise<{ status: PushStatus; garminWorkoutId: string | null; message: string }> {
  if (!pushEnabled(opts)) {
    return {
      status: 'disabled',
      garminWorkoutId: null,
      message:
        'Watch write-back is off. Set GARMIN_WORKOUT_PUSH=1 once you have credentials — and treat the first push as a test, because this path has never run against a real account.',
    }
  }

  const token = opts.token !== undefined ? opts.token : process.env.GARMIN_OAUTH2
  if (!token) {
    return {
      status: 'unavailable',
      garminWorkoutId: null,
      message:
        'No Garmin OAuth token is configured, so nothing was sent. See GARMIN-SETUP.md — the token script is the same one the nightly sync uses.',
    }
  }

  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as NonNullable<PushOptions['fetchImpl']>)

  try {
    const response = await doFetch(WORKOUT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'NK': 'NT',
      },
      body: JSON.stringify(workout),
    })

    if (!response.ok) {
      // The body can echo credentials on an auth failure (§20), so it is logged
      // and never returned.
      const detail = await response.text().catch(() => '')
      console.error('[garminWorkout] push failed:', response.status, detail.slice(0, 500))
      return {
        status: 'failed',
        garminWorkoutId: null,
        message: `Garmin refused the workout (HTTP ${response.status}). Nothing is on the watch.`,
      }
    }

    const body = (await response.json().catch(() => null)) as { workoutId?: number | string } | null
    const id = body?.workoutId != null ? String(body.workoutId) : null
    return {
      status: 'pushed',
      garminWorkoutId: id,
      message: id
        ? `Sent to Garmin as workout ${id}. Check the watch before you rely on it — this path is newly wired.`
        : 'Garmin accepted the workout but did not return an id, so there is nothing to link it back to.',
    }
  } catch (err) {
    console.error('[garminWorkout] push error:', err instanceof Error ? err.message : String(err))
    return {
      status: 'failed',
      garminWorkoutId: null,
      message: 'Could not reach Garmin. Nothing is on the watch.',
    }
  }
}

/**
 * Map today's session, try to push it, and record the attempt either way.
 *
 * The log row is the point. `garmin_push_log` holds the payload that was built
 * and the status that came back, so "did the watch get it?" is answerable after
 * the fact rather than a matter of memory — and so a failed push is visible
 * instead of silently absent.
 */
export async function pushSessionToGarmin(
  sessionId: number,
  date: Date,
  blocks: SessionBlock[],
  opts: PushOptions & MapOptions = {},
): Promise<PushResult> {
  const mapped = toGarminWorkout(blocks, date, { name: opts.name, description: opts.description })

  if (!mapped.workout) {
    await prisma.garmin_push_log.create({
      data: {
        sessionId,
        date: startOfDay(date),
        status: 'nothing_to_push',
        payloadJson: null,
        error: mapped.reason,
      },
    })
    return {
      status: 'nothing_to_push',
      garminWorkoutId: null,
      message: mapped.reason ?? 'Nothing to send.',
      workout: null,
      skipped: mapped.skipped,
    }
  }

  const outcome = await pushWorkout(mapped.workout, opts)

  await prisma.garmin_push_log.create({
    data: {
      sessionId,
      date: startOfDay(date),
      status: outcome.status,
      garminWorkoutId: outcome.garminWorkoutId,
      payloadJson: JSON.stringify(mapped.workout),
      error: outcome.status === 'pushed' ? null : outcome.message,
    },
  })

  return {
    status: outcome.status,
    garminWorkoutId: outcome.garminWorkoutId,
    message: outcome.message,
    workout: mapped.workout,
    skipped: mapped.skipped,
  }
}
