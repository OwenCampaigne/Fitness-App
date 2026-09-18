// ── Strength session ──────────────────────────────────────────────────────────
// The DB-facing layer: turns engine output into a real `session` row whose
// blocksJson already uses the Phase 5 Session shape. Phase 5 adds run, plyo and
// prehab items to this same structure rather than replacing it.

import { randomUUID } from 'crypto'
import { startOfDay, subDays } from 'date-fns'
import { prisma } from './db'
import {
  applyReadinessAdjustment,
  checkConcurrentConflict,
  deriveWorkingLoadAnchor,
  filterContraindicated,
  suggestProgression,
  shouldDeload,
  weeklySetsByMuscle,
} from './strengthEngine'
import { KEY_LIFTS, KEY_LIFTS_BY_ID, getKeyLift, isHeavyLowerBody } from './keyLifts'
import type { ReadinessBand } from '../types/readiness'
import type {
  ExerciseSessionHistory,
  KeyLift,
  LoggedSet,
  MovementPattern,
  ReadinessAdjustment,
  RecoveryContext,
  WorkingLoadAnchor,
} from '../types/strength'
import type { SessionBlock, SessionBlocks, SessionItem, StrengthParams } from '../types/session'

// ── Session template ──────────────────────────────────────────────────────────
// A deterministic lookup table, deliberately. Framework §19: "start dumb (a
// lookup-table allocator) and earn the intelligence." Phase 5's allocator
// replaces this function; nothing else has to change.

const MAIN_PATTERN_PRIORITY: MovementPattern[] = ['hinge', 'squat', 'unilateral_squat']
const ACCESSORY_PATTERN_PRIORITY: MovementPattern[] = ['calf', 'hamstring', 'hip_abduction', 'trunk']

function pickFirstAllowed(
  patterns: MovementPattern[],
  allowed: KeyLift[],
  used: Set<string>,
  limit: number,
): KeyLift[] {
  const picked: KeyLift[] = []
  for (const pattern of patterns) {
    if (picked.length >= limit) break
    const candidate = allowed.find((l) => l.pattern === pattern && !used.has(l.id))
    if (candidate) {
      picked.push(candidate)
      used.add(candidate.id)
    }
  }
  return picked
}

export interface BuildSessionInput {
  band: ReadinessBand
  provisional: boolean
  painLevel: 'none' | 'sometimes' | 'yes'
  recoveryContext: RecoveryContext | null
  /** Most recent completed session per exercise id. */
  lastSessionByExercise: Record<string, ExerciseSessionHistory>
  /** Days since the last load increase per exercise id. */
  daysSinceIncreaseByExercise: Record<string, number | null>
}

export interface BuiltSession {
  blocks: SessionBlock[]
  adjustment: ReadinessAdjustment
  blockedLifts: Array<{ name: string; reason: string }>
  usingConservativeDefault: boolean
}

/** Build today's strength prescription. Pure — no DB, fully testable. */
export function buildStrengthSession(input: BuildSessionInput): BuiltSession {
  const { band, provisional, painLevel, recoveryContext } = input

  const adjustment = applyReadinessAdjustment(band, provisional, painLevel === 'yes')
  const filter = filterContraindicated(KEY_LIFTS, recoveryContext, painLevel)

  const used = new Set<string>()
  const mainLifts = adjustment.mainLiftsRemoved
    ? []
    : pickFirstAllowed(MAIN_PATTERN_PRIORITY, filter.allowed, used, 2)
  const accessoryLifts = pickFirstAllowed(ACCESSORY_PATTERN_PRIORITY, filter.allowed, used, 3)

  function toItem(lift: KeyLift, isAccessory: boolean): SessionItem {
    const last = input.lastSessionByExercise[lift.id] ?? null
    const suggestion = suggestProgression(lift, last, {
      provisional,
      daysSinceLastIncrease: input.daysSinceIncreaseByExercise[lift.id] ?? null,
    })

    let sets = lift.defaultSets
    if (isAccessory) {
      sets = Math.max(1, Math.round(sets * adjustment.accessoryVolumeFactor))
    } else {
      sets = Math.max(1, sets - adjustment.setsDropped)
    }

    // An amber day holds the load at last session's rather than progressing.
    let weightKg = suggestion.weightKg
    let why = suggestion.reason
    if (adjustment.capLoadAtLastSession && suggestion.action === 'increase_load' && last) {
      const lastTop = last.sets
        .map((s) => s.weightKg)
        .filter((w): w is number => w !== null && w !== undefined)
      if (lastTop.length > 0) {
        weightKg = Math.max(...lastTop)
        why = `Ready to add load, but ${adjustment.summary.toLowerCase()}`
      }
    }

    const params: StrengthParams = {
      kind: 'strength',
      sets,
      reps: suggestion.reps,
      repsMin: lift.defaultRepsMin,
      weightKg,
      targetRir: suggestion.targetRir,
      restSec: isAccessory ? 60 : 150,
    }

    return {
      id: randomUUID(),
      ref: { kind: 'exercise', id: lift.id, name: lift.name },
      params,
      why,
      status: 'prescribed',
    }
  }

  const blocks: SessionBlock[] = []

  if (mainLifts.length > 0) {
    blocks.push({
      id: randomUUID(),
      kind: 'main',
      label: 'Main',
      items: mainLifts.map((l) => toItem(l, false)),
    })
  }

  if (accessoryLifts.length > 0) {
    blocks.push({
      id: randomUUID(),
      kind: 'accessory',
      label: 'Accessory',
      items: accessoryLifts.map((l) => toItem(l, true)),
    })
  }

  return {
    blocks,
    adjustment,
    blockedLifts: filter.blocked.map((b) => ({ name: b.lift.name, reason: b.reason })),
    usingConservativeDefault: filter.usingConservativeDefault,
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/** Group raw set_logs rows into per-session, per-exercise histories. */
export function groupSetLogs(
  rows: Array<LoggedSet & { sessionId: number }>,
  sessionDates: Record<number, Date>,
): ExerciseSessionHistory[] {
  const bucket = new Map<string, ExerciseSessionHistory>()

  for (const row of rows) {
    const key = `${row.sessionId}::${row.exerciseId}`
    let entry = bucket.get(key)
    if (!entry) {
      entry = {
        sessionId: row.sessionId,
        date: sessionDates[row.sessionId] ?? new Date(),
        exerciseId: row.exerciseId,
        sets: [],
      }
      bucket.set(key, entry)
    }
    entry.sets.push(row)
  }

  for (const entry of Array.from(bucket.values())) {
    entry.sets.sort((a, b) => a.setNumber - b.setNumber)
  }

  return Array.from(bucket.values()).sort((a, b) => a.date.getTime() - b.date.getTime())
}

/** Every logged session for each exercise, most recent last. */
export async function loadExerciseHistories(sinceDays = 90): Promise<ExerciseSessionHistory[]> {
  const since = subDays(new Date(), sinceDays)
  const sessions = await prisma.session.findMany({
    where: { date: { gte: since } },
    orderBy: { date: 'asc' },
  })
  if (sessions.length === 0) return []

  const sessionDates: Record<number, Date> = {}
  for (const s of sessions) sessionDates[s.id] = new Date(s.date)

  const logs = await prisma.set_logs.findMany({
    where: { sessionId: { in: sessions.map((s) => s.id) } },
    orderBy: [{ sessionId: 'asc' }, { setNumber: 'asc' }],
  })

  return groupSetLogs(logs as Array<LoggedSet & { sessionId: number }>, sessionDates)
}

/**
 * The most recent session for each exercise.
 *
 * Pass `before` to exclude today's own in-progress session — otherwise the
 * first set logged today becomes "last time" on the very card being logged
 * into, and progression starts comparing today against itself.
 */
export function latestByExercise(
  histories: ExerciseSessionHistory[],
  opts: { before?: Date } = {},
): Record<string, ExerciseSessionHistory> {
  const cutoff = opts.before?.getTime()
  const out: Record<string, ExerciseSessionHistory> = {}

  for (const h of histories) {
    if (cutoff !== undefined && h.date.getTime() >= cutoff) continue
    const existing = out[h.exerciseId]
    if (!existing || h.date.getTime() > existing.date.getTime()) out[h.exerciseId] = h
  }
  return out
}

/** Days since the load last went up, per exercise — feeds the calibration cap. */
export function daysSinceLastIncrease(
  histories: ExerciseSessionHistory[],
  today = new Date(),
): Record<string, number | null> {
  const byExercise: Record<string, ExerciseSessionHistory[]> = {}
  for (const h of histories) {
    ;(byExercise[h.exerciseId] ??= []).push(h)
  }

  const out: Record<string, number | null> = {}
  for (const [exerciseId, list] of Object.entries(byExercise)) {
    const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime())
    let lastIncrease: Date | null = null
    for (let i = 1; i < sorted.length; i++) {
      const prev = Math.max(0, ...sorted[i - 1].sets.map((s) => s.weightKg ?? 0))
      const curr = Math.max(0, ...sorted[i].sets.map((s) => s.weightKg ?? 0))
      if (curr > prev) lastIncrease = sorted[i].date
    }
    out[exerciseId] = lastIncrease
      ? Math.floor((today.getTime() - lastIncrease.getTime()) / 86_400_000)
      : null
  }
  return out
}

/** Fetch or create today's session row, seeded from the template. */
export async function getOrCreateTodaySession(input: BuildSessionInput) {
  const today = startOfDay(new Date())

  const existing = await prisma.session.findUnique({ where: { date: today } })
  if (existing) {
    return {
      session: existing,
      blocks: (JSON.parse(existing.blocksJson) as SessionBlocks).blocks,
      created: false,
    }
  }

  const built = buildStrengthSession(input)
  const created = await prisma.session.create({
    data: {
      date: today,
      status: 'draft',
      version: 1,
      blocksJson: JSON.stringify({ blocks: built.blocks } satisfies SessionBlocks),
      sourceOfLastEdit: 'engine',
    },
  })

  return { session: created, blocks: built.blocks, created: true, built }
}

/** Persist a set and refresh the working-load anchor it informs. */
export async function logSet(params: {
  sessionId: number
  exerciseId: string
  setNumber: number
  weightKg: number | null
  reps: number | null
  rir: number | null
  notes?: string | null
}) {
  const existing = await prisma.set_logs.findFirst({
    where: {
      sessionId: params.sessionId,
      exerciseId: params.exerciseId,
      setNumber: params.setNumber,
    },
  })

  const row = existing
    ? await prisma.set_logs.update({ where: { id: existing.id }, data: params })
    : await prisma.set_logs.create({ data: params })

  await refreshWorkingLoadAnchor(params.exerciseId)
  return row
}

/**
 * Recompute one working-load anchor from logged history and write it back to
 * athlete_profile. This is the calibration loop of §5b, running on the same
 * machinery Phase 1 used for paces and zones.
 */
export async function refreshWorkingLoadAnchor(
  exerciseId: string,
): Promise<WorkingLoadAnchor | null> {
  const lift = getKeyLift(exerciseId)
  if (!lift) return null

  const histories = (await loadExerciseHistories()).filter((h) => h.exerciseId === exerciseId)
  const anchor = deriveWorkingLoadAnchor(histories, lift.defaultTargetRir)

  const profile = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
  if (!profile) return anchor

  let loads: Record<string, WorkingLoadAnchor> = {}
  try {
    loads = profile.keyLiftLoadsJson ? JSON.parse(profile.keyLiftLoadsJson) : {}
  } catch {
    loads = {}
  }
  loads[lift.id] = anchor

  await prisma.athlete_profile.update({
    where: { id: profile.id },
    data: { keyLiftLoadsJson: JSON.stringify(loads) },
  })

  return anchor
}

/** Record a change to a session so Phase 6 can learn from it (§13). */
export async function recordEdit(params: {
  sessionId: number
  version: number
  actor: 'user' | 'coach' | 'engine'
  diff: unknown
  reason?: string | null
}) {
  return prisma.edit_history.create({
    data: {
      sessionId: params.sessionId,
      version: params.version,
      actor: params.actor,
      diffJson: JSON.stringify(params.diff),
      reason: params.reason ?? null,
    },
  })
}

/** Deload check across the last two weeks of logged work. */
export async function checkDeload(recentAcwr: number[]) {
  const histories = await loadExerciseHistories(21)
  const now = new Date()
  const weekAgo = subDays(now, 7)
  const twoWeeksAgo = subDays(now, 14)

  const thisWeek = histories.filter((h) => h.date >= weekAgo)
  const lastWeek = histories.filter((h) => h.date >= twoWeeksAgo && h.date < weekAgo)

  const recentRirDeficit = histories
    .slice(-2)
    .map((h) => {
      const lift = KEY_LIFTS_BY_ID[h.exerciseId]
      if (!lift) return 0
      const rirs = h.sets.map((s) => s.rir).filter((r): r is number => r !== null && r !== undefined)
      if (rirs.length === 0) return 0
      const mean = rirs.reduce((a, b) => a + b, 0) / rirs.length
      return mean - lift.defaultTargetRir
    })

  return shouldDeload({
    weeklySetsThisWeek: weeklySetsByMuscle(thisWeek, KEY_LIFTS_BY_ID),
    weeklySetsLastWeek: weeklySetsByMuscle(lastWeek, KEY_LIFTS_BY_ID),
    recentAcwr,
    recentRirDeficit,
  })
}

/** Guard today's lift against the planned runs, once Phase 3 fills them in. */
export async function concurrentGuard(liftIds: string[]) {
  const heavy = liftIds.map((id) => getKeyLift(id)).some((l) => l !== null && isHeavyLowerBody(l))
  const plannedRuns = await prisma.planned_session.findMany({
    where: { date: { gte: startOfDay(new Date()) }, modality: 'run' },
    orderBy: { date: 'asc' },
    take: 7,
  })

  return checkConcurrentConflict(
    new Date(),
    heavy,
    plannedRuns.map((p) => ({
      date: new Date(p.date),
      runType: parseRunType(p.targetSpecJson),
      priority: (p.priority as 'A' | 'B' | 'C' | undefined) ?? undefined,
    })),
  )
}

/** planned_session stores its spec as JSON; Phase 3 defines the full shape. */
function parseRunType(targetSpecJson: string | null): string {
  if (!targetSpecJson) return 'easy'
  try {
    const spec = JSON.parse(targetSpecJson) as { runType?: string }
    return spec.runType ?? 'easy'
  } catch {
    return 'easy'
  }
}
