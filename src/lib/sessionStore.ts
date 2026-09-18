// ── Session store ─────────────────────────────────────────────────────────────
// Persistence for the edit funnel (framework §11). `session.ts` owns the rules
// and stays pure; this owns the row, the version counter, `edit_history`,
// `decision_log`, and the load columns of §3.
//
// The contract §11 sets is "versioned and reversible", and that word *reversible*
// is the reason this file exists in the shape it does: `applySessionPatch`
// hands back an inverse patch, and unless something stores it, undo is a lie.
// So every applied patch writes its own inverse alongside its diff, and an undo
// is just that inverse pushed back through the same funnel — same validator,
// same version bump, same audit row.
//
// The other load-bearing export is `buildValidationContext`. The validator's
// niggle and concurrent-training rails are wired to a `factsOf` callback that
// defaults to returning nothing, which means they stay *silent* unless someone
// resolves what an item is made of. That someone is `itemFacts` below.

import { randomUUID } from 'crypto'
import { startOfDay, subDays } from 'date-fns'
import { prisma } from './db'
import {
  HARD_DAY_SRPE,
  estimateItemCost,
  loadFromTrimp,
  sessionCost,
  sessionLoad,
} from './load'
import { applySessionPatch } from './session'
import { getKeyLift, isHeavyLowerBody } from './keyLifts'
import { logMovementSet, movementItemTissues, tissuesForRegion, toBodyRegion } from './movementSession'
import { refreshWorkingLoadAnchor } from './strengthSession'
import { PLYOS_BY_ID } from './plyos'
import type { ItemFacts, QualityHistory, ValidationContext } from './session'
import type { DayLoadRecord, DayPlanLike, Modality, Niggle } from './allocator'
import type { LoadBudget } from './load'
import type { ReadinessBand } from '../types/readiness'
import type { MovementAttribute, MuscleGroup } from '../types/strength'
import type {
  ApplyResult,
  EditableSession,
  ParamsPatch,
  PatchOp,
  SessionDiff,
  SessionPatch,
  ValidationVerdict,
} from '../types/patch'
import type {
  BlockKind,
  EditActor,
  ItemKind,
  ItemParams,
  ItemStatus,
  SessionBlock,
  SessionBlocks,
  SessionItem,
  SessionStatus,
} from '../types/session'

// ── Constants ─────────────────────────────────────────────────────────────────

/** How far back `qualityHistory` looks for the 80/20 pattern (§21). */
export const QUALITY_WINDOW_DAYS = 28
/** A hard session finished under this share of its plan was dodged, not adjusted. */
export const DODGE_COMPLETION_SHARE = 0.7
/** Days of load history the budget and the back-to-back rule read (§3). */
export const LOAD_WINDOW_DAYS = 28

const BLOCK_ORDER: BlockKind[] = ['warmup', 'main', 'accessory', 'cooldown']

// ── What an item is made of (the `factsOf` the validator needs) ───────────────

/**
 * Muscle groups in the niggle tracker's tissue vocabulary.
 *
 * Deliberately generous: a hamstring curl is matched against a hamstring
 * complaint *and* a hip one, because the rails exist to be conservative. A
 * false positive costs one down-weighted accessory lift; a false negative costs
 * the §9 protection entirely.
 */
const MUSCLE_TISSUES: Record<MuscleGroup, string[]> = {
  hamstrings: ['hamstring', 'knee'],
  glutes: ['hip', 'glute_med'],
  quads: ['knee'],
  calves: ['ankle_foot', 'calf', 'achilles', 'shin'],
  adductors: ['hip'],
  abductors: ['hip', 'glute_med', 'it_band'],
  trunk: ['low_back'],
  back: ['low_back'],
  chest: [],
  shoulders: [],
}

/** Movement attributes that load a joint regardless of which muscles they use. */
const ATTRIBUTE_TISSUES: Partial<Record<MovementAttribute, string[]>> = {
  deep_knee_flexion: ['knee'],
  open_chain_knee_extension: ['knee'],
  deep_squat_load: ['knee', 'hip'],
  loaded_pivot: ['knee', 'hip'],
  high_impact: ['ankle_foot', 'shin', 'knee'],
}

/** Running loads everything below the waist — which is the point of the rule. */
export const RUN_TISSUES = [
  'ankle_foot',
  'achilles',
  'calf',
  'shin',
  'knee',
  'hip',
  'hamstring',
  'it_band',
  'glute_med',
]

/**
 * Resolve a Session item into the facts the safety rules read.
 *
 * `SessionItem` carries a library reference and nothing clinical, by design —
 * `session.ts` says so explicitly and asks the wiring layer to answer. This is
 * that answer: key-lifts.json for lifts, the plyo/prehab/stretch catalogs for
 * everything Phase 4 added, and a fixed tissue list for runs.
 */
export function itemFacts(item: SessionItem): ItemFacts {
  const kind = item.ref.kind

  if (kind === 'run') {
    return { tissues: RUN_TISSUES, heavyLowerBody: false, modality: 'run' }
  }

  if (kind === 'exercise') {
    const lift = getKeyLift(item.ref.id)
    if (!lift) return { tissues: [], heavyLowerBody: false, modality: 'strength' }
    const tissues = new Set<string>()
    for (const group of lift.primaryMuscleGroups) {
      for (const t of MUSCLE_TISSUES[group] ?? []) tissues.add(t)
    }
    for (const attribute of lift.attributes) {
      for (const t of ATTRIBUTE_TISSUES[attribute] ?? []) tissues.add(t)
    }
    return {
      tissues: Array.from(tissues),
      heavyLowerBody: isHeavyLowerBody(lift),
      modality: 'strength',
    }
  }

  const modality: Modality = kind === 'plyo' ? 'plyo' : kind === 'prehab' ? 'prehab' : 'stretch'
  return {
    tissues: movementItemTissues(item),
    // Plyos are hard on tendon, not on the squat rack — the concurrent-training
    // rule is about heavy bilateral lifting and nothing else (§8).
    heavyLowerBody: false,
    modality,
  }
}

/** Costing that prefers what an engine knows over what the estimator guesses. */
export function itemCost(item: SessionItem) {
  if (item.ref.kind === 'plyo') {
    const plyo = PLYOS_BY_ID[item.ref.id]
    // Tier is the intensity signal for a plyo; the clock is not.
    if (plyo) return estimateItemCost(item, { srpe: plyo.progressionTier >= 3 ? 8 : 6 })
  }
  return estimateItemCost(item)
}

// ── Rows ↔ EditableSession ────────────────────────────────────────────────────

/** The `session` row shape, Prisma-free so the mappers stay testable. */
export interface SessionRow {
  id: number
  date: Date | string
  status: string
  version: number
  blocksJson: string
  sourceOfLastEdit: string | null
  plannedDurationMin?: number | null
  plannedLoad?: number | null
  actualDurationMin?: number | null
  srpe?: number | null
  actualLoad?: number | null
  completedAt?: Date | string | null
}

export function parseBlocks(blocksJson: string): SessionBlock[] {
  try {
    const parsed = JSON.parse(blocksJson) as SessionBlocks | SessionBlock[]
    const blocks = Array.isArray(parsed) ? parsed : parsed.blocks
    if (!Array.isArray(blocks)) return []
    return blocks
      .filter((b) => b && Array.isArray(b.items))
      .sort((a, b) => BLOCK_ORDER.indexOf(a.kind) - BLOCK_ORDER.indexOf(b.kind))
  } catch {
    // A corrupt blob is a bad day, not a 500 — an empty session still renders
    // and the athlete can rebuild it.
    return []
  }
}

export function serializeBlocks(blocks: SessionBlock[]): string {
  return JSON.stringify({ blocks } satisfies SessionBlocks)
}

function toStatus(value: string | null | undefined): SessionStatus {
  return value === 'active' || value === 'completed' ? value : 'draft'
}

function toActor(value: string | null | undefined): EditActor | null {
  return value === 'user' || value === 'coach' || value === 'engine' ? value : null
}

export function toEditableSession(row: SessionRow): EditableSession {
  return {
    id: row.id,
    date: row.date instanceof Date ? row.date : new Date(row.date),
    status: toStatus(row.status),
    version: row.version,
    blocks: parseBlocks(row.blocksJson),
    sourceOfLastEdit: toActor(row.sourceOfLastEdit),
  }
}

// ── Validation context (§11) ──────────────────────────────────────────────────

export interface ValidationContextInput {
  budget: LoadBudget
  band: ReadinessBand
  calibrating: boolean
  niggles?: Niggle[]
  tomorrow?: DayPlanLike | null
  yesterdayHard?: boolean
  qualityHistory?: QualityHistory
}

/**
 * Build the context both the validator and a preview call read.
 *
 * The two callbacks are the whole point. Without `factsOf` the niggle rule and
 * the concurrent-training rule have nothing to test and stay quiet; without
 * `costOf` every plyo is priced off the clock, which under-counts it by design
 * (§3). Everything else in here is a number the DB already knows.
 */
export function buildValidationContext(input: ValidationContextInput): ValidationContext {
  return {
    budget: input.budget,
    band: input.band,
    calibrating: input.calibrating,
    niggles: input.niggles ?? [],
    tomorrow: input.tomorrow ?? null,
    yesterdayHard: input.yesterdayHard ?? false,
    qualityHistory: input.qualityHistory,
    factsOf: itemFacts,
    costOf: itemCost,
  }
}

// ── Daily load history ────────────────────────────────────────────────────────

export interface SessionLoadRow {
  date: Date
  plannedLoad: number | null
  actualLoad: number | null
  /** The athlete's own rating — the intensity half of the currency (§3). */
  srpe?: number | null
  status: string
}

export interface ActivityLoadRow {
  date: Date
  durationMin: number | null
  trimp: number | null
}

/**
 * One load number per day, ending on `endDate`.
 *
 * Sessions and Garmin activities overlap — a prescribed run that happened is
 * both a session item and an activity row — so the two are *maxed*, not summed.
 * Summing would double-count every run the athlete actually did, which inflates
 * the chronic load and quietly widens every ceiling derived from it.
 */
export function summarizeDailyLoads(
  sessions: SessionLoadRow[],
  activities: ActivityLoadRow[],
  endDate: Date,
  days = LOAD_WINDOW_DAYS,
): { dailyLoads: number[]; recentDays: DayLoadRecord[] } {
  const end = startOfDay(endDate).getTime()
  const fromSession = new Array(days).fill(0) as number[]
  const fromActivity = new Array(days).fill(0) as number[]
  const hard = new Array(days).fill(false) as boolean[]

  const indexOf = (date: Date): number => {
    const back = Math.floor((end - startOfDay(date).getTime()) / 86_400_000)
    const index = days - 1 - back
    return index >= 0 && index < days ? index : -1
  }

  for (const row of sessions) {
    const index = indexOf(row.date)
    if (index < 0) continue
    const load = row.actualLoad ?? (row.status === 'completed' ? 0 : (row.plannedLoad ?? 0))
    fromSession[index] += load
  }

  for (const row of activities) {
    const index = indexOf(row.date)
    if (index < 0) continue
    const load = row.trimp != null ? loadFromTrimp(row.trimp) : 0
    fromActivity[index] += load
  }

  const dailyLoads = fromSession.map((s, i) => Math.max(s, fromActivity[i]))

  // "Hard" is about intensity, not total: a long easy day is not what the
  // back-to-back rule is protecting against (§10). So it is load *per minute*
  // that decides, and the athlete's own sRPE wins over the derived one.
  for (const row of activities) {
    const index = indexOf(row.date)
    if (index < 0) continue
    const minutes = row.durationMin ?? 0
    if (minutes > 0 && loadFromTrimp(row.trimp ?? 0) / minutes >= HARD_DAY_SRPE) hard[index] = true
  }
  for (const row of sessions) {
    const index = indexOf(row.date)
    if (index < 0) continue
    if ((row.srpe ?? 0) >= HARD_DAY_SRPE) hard[index] = true
  }

  const recentDays: DayLoadRecord[] = dailyLoads.map((load, i) => ({
    date: new Date(end - (days - 1 - i) * 86_400_000),
    load,
    hard: hard[i],
  }))

  return { dailyLoads, recentDays }
}

/** Did yesterday end up hard? The back-to-back rule's only input (§10). */
export function wasYesterdayHard(recentDays: DayLoadRecord[], today: Date): boolean {
  const yesterday = startOfDay(today).getTime() - 86_400_000
  return recentDays.some((d) => startOfDay(d.date).getTime() === yesterday && d.hard)
}

// ── Quality history (§21) ─────────────────────────────────────────────────────

export interface QualityDayRow {
  date: Date
  /** Peak hardness the engine prescribed that day. */
  prescribedHardness: number
  /** actualLoad ÷ plannedLoad once complete; null while it is not. */
  completedShare: number | null
  /** From `decision_log.wasFollowed`. */
  wasFollowed: boolean | null
}

/**
 * How often the hard day actually happened.
 *
 * §21's Contrarian: an editor where "make today easier" is one tap away erodes
 * the 20 of an 80/20 week unless something counts. A day counts as dodged when
 * the decision log says it was not followed, or when the session was completed
 * at a fraction of what was prescribed — a skipped session and a session cut in
 * half are the same signal.
 */
export function computeQualityHistory(
  rows: QualityDayRow[],
  today: Date,
  windowDays = QUALITY_WINDOW_DAYS,
): QualityHistory {
  const cutoff = subDays(startOfDay(today), windowDays).getTime()
  const inWindow = rows.filter(
    (r) => startOfDay(r.date).getTime() >= cutoff && r.prescribedHardness >= HARD_DAY_SRPE,
  )

  const dodged = inWindow.filter(
    (r) =>
      r.wasFollowed === false ||
      (r.completedShare !== null && r.completedShare < DODGE_COMPLETION_SHARE),
  ).length

  return { prescribed: inWindow.length, dodged, windowDays }
}

// ── Edit history ──────────────────────────────────────────────────────────────

/** What a row of `edit_history.diffJson` holds. */
export interface EditRecord {
  diff: SessionDiff | null
  /** The undo patch for this edit — what makes §11's "reversible" true. */
  inverse: SessionPatch | null
  /** Serialized `verdict.findings`, so a flagged edit stays explicable later. */
  findings: ValidationVerdict['findings']
  verdictKind: ValidationVerdict['kind'] | null
  /** Set when this row *is* an undo, naming the edit it reversed. */
  undoOf: number | null
  source?: string | null
}

export interface EditHistoryRow {
  id: number
  sessionId: number
  version: number
  actor: string
  diffJson: string
  reason: string | null
  /** Set when this row is one half of an edit that spans two days (§11). */
  groupId?: string | null
  timestamp: Date | string
}

export interface ParsedEdit extends EditRecord {
  id: number
  /** Which day's row this is — a group's members sit on different sessions. */
  sessionId: number
  version: number
  actor: EditActor
  reason: string | null
  groupId: string | null
  timestamp: Date
}

export function parseEditRecord(diffJson: string): EditRecord {
  try {
    const parsed = JSON.parse(diffJson) as Partial<EditRecord>
    return {
      diff: parsed.diff ?? null,
      inverse: parsed.inverse ?? null,
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      verdictKind: parsed.verdictKind ?? null,
      undoOf: typeof parsed.undoOf === 'number' ? parsed.undoOf : null,
      source: parsed.source ?? null,
    }
  } catch {
    return { diff: null, inverse: null, findings: [], verdictKind: null, undoOf: null }
  }
}

export function parseEditHistory(rows: EditHistoryRow[]): ParsedEdit[] {
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.sessionId,
    version: row.version,
    actor: toActor(row.actor) ?? 'engine',
    reason: row.reason,
    groupId: row.groupId ?? null,
    timestamp: row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp),
    ...parseEditRecord(row.diffJson),
  }))
}

/**
 * The edit an undo should reverse, given the history newest-first.
 *
 * An undo is itself an edit, so undoing twice has to reach *past* the undo to
 * the edit before it. Rather than a mutable "undone" column the schema does not
 * have, each undo names what it reversed and this walks backwards cancelling
 * pairs — which also means the audit trail stays append-only, and every undo is
 * as visible in `edit_history` as the edit that provoked it (§11).
 */
export function selectUndoTarget(newestFirst: ParsedEdit[]): ParsedEdit | null {
  const cancelled = new Set<number>()
  for (const entry of newestFirst) {
    if (entry.undoOf !== null) {
      cancelled.add(entry.undoOf)
      continue
    }
    if (cancelled.has(entry.id)) continue
    if (entry.inverse && entry.inverse.ops.length > 0) return entry
  }
  return null
}

// ── DB: reading and writing today's session ───────────────────────────────────

export async function findSessionRow(date: Date) {
  return prisma.session.findUnique({ where: { date: startOfDay(date) } })
}

export async function readEditableSession(date: Date): Promise<EditableSession | null> {
  const row = await findSessionRow(date)
  return row ? toEditableSession(row as SessionRow) : null
}

/** What a set of blocks costs, in the one currency (§3). */
export function plannedTotals(blocks: SessionBlock[]): {
  plannedLoad: number
  plannedDurationMin: number
} {
  const cost = sessionCost(blocks, itemCost)
  return {
    plannedLoad: Math.round(cost.load * 10) / 10,
    plannedDurationMin: Math.round(cost.durationMin * 10) / 10,
  }
}

export interface CreateSessionInput {
  date: Date
  blocks: SessionBlock[]
  plannedLoad?: number
  plannedDurationMin?: number
}

/** Write a freshly allocated session. The engine is always the first author. */
export async function createSessionRow(input: CreateSessionInput) {
  const totals = plannedTotals(input.blocks)
  return prisma.session.create({
    data: {
      date: startOfDay(input.date),
      status: 'draft',
      version: 1,
      blocksJson: serializeBlocks(input.blocks),
      sourceOfLastEdit: 'engine',
      plannedLoad: input.plannedLoad ?? totals.plannedLoad,
      plannedDurationMin: input.plannedDurationMin ?? totals.plannedDurationMin,
    },
  })
}

/**
 * Replace an engine-authored session in place.
 *
 * Only ever called on a session nobody has touched — an athlete's edit is not
 * something a regenerate gets to discard (§11's "your override is preserved").
 */
export async function replaceEngineSession(id: number, blocks: SessionBlock[]) {
  const totals = plannedTotals(blocks)
  return prisma.session.update({
    where: { id },
    data: {
      blocksJson: serializeBlocks(blocks),
      sourceOfLastEdit: 'engine',
      plannedLoad: totals.plannedLoad,
      plannedDurationMin: totals.plannedDurationMin,
    },
  })
}

/** True when the engine wrote this session and nobody has changed it since. */
export function isUntouched(row: Pick<SessionRow, 'version' | 'sourceOfLastEdit'>): boolean {
  return row.version === 1 && row.sourceOfLastEdit === 'engine'
}

// ── DB: the patch path ────────────────────────────────────────────────────────

export interface PatchOutcome {
  applied: boolean
  verdict: ValidationVerdict
  session: EditableSession
  diff: SessionDiff
  version: number
  /** The `edit_history` row this wrote, when it applied. */
  editId: number | null
}

/**
 * Put a patch through the funnel and persist whatever comes out.
 *
 * Nothing is written on a push-back — the caller gets the verdict and the
 * counter-proposal and the session is exactly as it was. When it does apply,
 * the row, its version, its load columns and the audit entry all move together.
 */
export async function applyPatchToSession(
  session: EditableSession,
  patch: SessionPatch,
  context: ValidationContext,
  opts: { reason?: string | null; undoOf?: number | null; groupId?: string | null } = {},
): Promise<PatchOutcome> {
  const result: ApplyResult = applySessionPatch(session, patch, context)

  if (!result.applied || session.id === undefined) {
    return {
      applied: false,
      verdict: result.verdict,
      session: result.session,
      diff: result.diff,
      version: session.version,
      editId: null,
    }
  }

  const totals = plannedTotals(result.session.blocks)

  await prisma.session.update({
    where: { id: session.id },
    data: {
      blocksJson: serializeBlocks(result.session.blocks),
      version: result.session.version,
      sourceOfLastEdit: result.session.sourceOfLastEdit ?? patch.actor,
      plannedLoad: totals.plannedLoad,
      plannedDurationMin: totals.plannedDurationMin,
    },
  })

  const record: EditRecord = {
    diff: result.diff,
    inverse: result.inverse,
    findings: result.verdict.findings,
    verdictKind: result.verdict.kind,
    undoOf: opts.undoOf ?? null,
    source: patch.source ?? null,
  }

  const edit = await prisma.edit_history.create({
    data: {
      sessionId: session.id,
      version: result.session.version,
      actor: patch.actor,
      diffJson: JSON.stringify(record),
      reason: opts.reason ?? result.diff.entries[0]?.reason ?? null,
      // Two rows on two days that are one intent — see `undoLastEdit`.
      groupId: opts.groupId ?? null,
    },
  })

  return {
    applied: true,
    verdict: result.verdict,
    session: result.session,
    diff: result.diff,
    version: result.session.version,
    editId: edit.id,
  }
}

/** Every edit to a session, newest first. */
export async function loadEditHistory(sessionId: number): Promise<ParsedEdit[]> {
  const rows = await prisma.edit_history.findMany({
    where: { sessionId },
    orderBy: { id: 'desc' },
  })
  return parseEditHistory(rows as EditHistoryRow[])
}

export interface UndoneDay {
  date: Date
  version: number
  editId: number | null
}

export interface UndoOutcome extends PatchOutcome {
  /** Null when there was nothing left to undo. */
  undoneEditId: number | null
  /** Other days this undo also reversed — a move is one intent on two days. */
  alsoUndone: UndoneDay[]
}

function nothingToUndo(session: EditableSession, message: string): UndoOutcome {
  return {
    applied: false,
    verdict: { kind: 'ok', message, findings: [] },
    session,
    diff: { entries: [], loadBefore: 0, loadAfter: 0, summary: 'nothing to action' },
    version: session.version,
    editId: null,
    undoneEditId: null,
    alsoUndone: [],
  }
}

/**
 * Everything one undo has to reverse: an edit alone, or the whole group it is
 * half of.
 *
 * Ordered by id ascending, which is the order the halves were *applied* and —
 * for a move specifically — the order their inverses have to be applied in. The
 * destination's `add` went first, so its inverse is the `remove`, and doing the
 * removal before the re-add means the item is never sitting on two days at once.
 * The other order would transiently duplicate it, and a duplicate is the one
 * state that double-counts against the §3 load currency.
 */
async function undoGroup(target: ParsedEdit): Promise<ParsedEdit[]> {
  if (!target.groupId) return [target]
  const rows = await prisma.edit_history.findMany({
    where: { groupId: target.groupId },
    orderBy: { id: 'asc' },
  })
  const members = parseEditHistory(rows as EditHistoryRow[]).filter(
    (m) => m.inverse && m.inverse.ops.length > 0,
  )
  return members.length > 0 ? members : [target]
}

/**
 * Undo the last edit by replaying its stored inverse — across every day it
 * touched.
 *
 * Deliberately not a "restore the previous blob" — each inverse goes through the
 * identical validator against *its own* day as that day stands now, so an undo
 * that would itself break a rule is pushed back like any other patch rather than
 * smuggling an unsafe session in through the back door (§11: identical validator
 * for both actors, and for time travel).
 *
 * A move is one intent written as two rows (an `add` on the destination, a
 * `remove` on the source), so reversing one alone leaves the session on both
 * days or on neither. The pair shares a `groupId` and is reversed together, and
 * **all-or-nothing**: every half is validated first and nothing is written
 * unless every half would apply. The alternative — commit as you go and
 * compensate a refusal — needs a third patch that the validator can refuse in
 * its turn, which is how you end up with the corruption this exists to prevent.
 * Judging every half up front is free because `applySessionPatch` is pure.
 */
export async function undoLastEdit(
  session: EditableSession,
  context: ValidationContext,
  /** A day's rails, for the *other* day a move touched. `editContextFor`. */
  contextFor: (date: Date) => Promise<ValidationContext>,
): Promise<UndoOutcome> {
  const sessionId = session.id
  if (sessionId === undefined) return nothingToUndo(session, 'Nothing to undo.')

  const history = await loadEditHistory(sessionId)
  const target = selectUndoTarget(history)

  if (!target || !target.inverse) {
    return nothingToUndo(session, 'Nothing to undo — this session is as the engine wrote it.')
  }

  const members = await undoGroup(target)
  const reason = `Undo of "${target.reason ?? 'the last edit'}"`

  // The day we were handed is the freshest copy of itself; the rest are read.
  const others = members.map((m) => m.sessionId).filter((id) => id !== sessionId)
  const rows =
    others.length > 0
      ? await prisma.session.findMany({ where: { id: { in: Array.from(new Set(others)) } } })
      : []
  const byId = new Map<number, EditableSession>(
    rows.map((r) => [r.id, toEditableSession(r as SessionRow)]),
  )
  byId.set(sessionId, session)

  // Dry run every half before writing any of it. An undo is the athlete's own
  // decision, so it carries an override: the rule that made the original edit
  // worth flagging should not block its reversal. Only a hard floor (§15) or a
  // day that has genuinely moved on underneath it can refuse.
  const plan: Array<{
    member: ParsedEdit
    day: EditableSession
    date: Date
    ctx: ValidationContext
  }> = []
  for (const member of members) {
    const day = byId.get(member.sessionId)
    if (!day || !day.date || !member.inverse) {
      return nothingToUndo(session, 'That edit spans a day this session cannot read.')
    }
    const date = day.date
    const ctx = member.sessionId === sessionId ? context : await contextFor(date)
    const dry = applySessionPatch(day, { ...member.inverse, override: true }, ctx)
    if (!dry.applied) {
      return {
        applied: false,
        verdict: dry.verdict,
        session,
        diff: dry.diff,
        version: session.version,
        editId: null,
        undoneEditId: null,
        alsoUndone: [],
      }
    }
    plan.push({ member, day, date, ctx })
  }

  // Every half agreed, so write them — linked again, so the audit trail still
  // reads as one act rather than two coincidences on two days.
  const groupId = plan.length > 1 ? randomUUID() : null
  let primary: PatchOutcome | null = null
  const alsoUndone: UndoneDay[] = []

  for (const { member, day, date, ctx } of plan) {
    const outcome = await applyPatchToSession(
      day,
      { ...member.inverse!, override: true },
      ctx,
      { reason, undoOf: member.id, groupId },
    )
    if (member.sessionId === sessionId) primary = outcome
    else alsoUndone.push({ date, version: outcome.version, editId: outcome.editId })
  }

  if (!primary) return nothingToUndo(session, 'Nothing to undo.')
  return { ...primary, undoneEditId: primary.applied ? target.id : null, alsoUndone }
}

// ── DB: decision log (§10, §13) ───────────────────────────────────────────────

export interface LogDecisionInput {
  date: Date
  blocks: SessionBlock[]
  rationale: string
  readinessBand: ReadinessBand
  /** Anything worth keeping alongside the blocks — budget, flags, decisions. */
  context?: unknown
}

/**
 * Record what the engine proposed and why.
 *
 * This is the agent's memory (§3) and Phase 6's training set (§13): the pair
 * "what was recommended" / "what actually happened" is the only way an inferred
 * preference can ever be more than a guess.
 */
export async function logDecision(input: LogDecisionInput) {
  const date = startOfDay(input.date)
  const existing = await prisma.decision_log.findFirst({ where: { date } })

  const data = {
    date,
    recommendedSessionJson: JSON.stringify({ blocks: input.blocks, context: input.context ?? null }),
    rationale: input.rationale,
    readinessAtDecision: input.readinessBand,
  }

  return existing
    ? prisma.decision_log.update({ where: { id: existing.id }, data })
    : prisma.decision_log.create({ data })
}

/** Close the loop: what the athlete did with what was proposed (§13). */
export async function recordDecisionOutcome(
  date: Date,
  outcome: { wasFollowed: boolean; athleteOverride?: string | null },
) {
  const row = await prisma.decision_log.findFirst({ where: { date: startOfDay(date) } })
  if (!row) return null
  return prisma.decision_log.update({
    where: { id: row.id },
    data: {
      wasFollowed: outcome.wasFollowed,
      athleteOverride: outcome.athleteOverride ?? null,
    },
  })
}

// ── DB: completion (§3 load currency) ─────────────────────────────────────────

export interface CompleteSessionInput {
  sessionId: number
  srpe: number
  actualDurationMin?: number | null
}

export interface CompletionResult {
  ok: boolean
  actualLoad: number
  actualDurationMin: number
  srpe: number
}

/**
 * Close a session out.
 *
 * sRPE is the load currency's other half (§3) and nothing else can supply it —
 * TRIMP prices the run, contacts price the plyos, and only the athlete can say
 * what the whole thing felt like. Falls back to the planned duration when none
 * is given, because a completed session with no duration would price at zero
 * and quietly deflate the chronic load.
 */
export async function completeSession(input: CompleteSessionInput): Promise<CompletionResult> {
  const row = await prisma.session.findUnique({ where: { id: input.sessionId } })
  if (!row) throw new Error('Session not found')

  const durationMin =
    input.actualDurationMin != null && input.actualDurationMin > 0
      ? input.actualDurationMin
      : (row.plannedDurationMin ?? 0)

  const actualLoad = Math.round(sessionLoad(durationMin, input.srpe) * 10) / 10

  await prisma.session.update({
    where: { id: row.id },
    data: {
      status: 'completed',
      srpe: input.srpe,
      actualDurationMin: durationMin,
      actualLoad,
      completedAt: new Date(),
    },
  })

  // Followed means the engine's proposal survived to completion. An edited
  // session is not a failure, but it is the signal §13 learns from.
  await recordDecisionOutcome(new Date(row.date), {
    wasFollowed: row.sourceOfLastEdit === 'engine',
    athleteOverride:
      row.sourceOfLastEdit && row.sourceOfLastEdit !== 'engine'
        ? `Edited by ${row.sourceOfLastEdit} before completion (v${row.version}).`
        : null,
  })

  return { ok: true, actualLoad, actualDurationMin: durationMin, srpe: input.srpe }
}

// ── DB: assembling the context ────────────────────────────────────────────────

export interface LoadedDayContext {
  dailyLoads: number[]
  recentDays: DayLoadRecord[]
  yesterdayHard: boolean
  qualityHistory: QualityHistory
  lastWeekLoad: number
  thisWeekLoadSoFar: number
}

/**
 * Read the history every §3 number is derived from, in one pass.
 *
 * Excludes today deliberately: `computeDailyBudget` documents its input as the
 * days *before* today, and feeding today's own planned load back in would make
 * every regenerate shrink the budget it just spent.
 */
export async function loadDayContext(today = new Date()): Promise<LoadedDayContext> {
  const start = startOfDay(today)
  const since = subDays(start, LOAD_WINDOW_DAYS)

  const [sessions, activities, decisions] = await Promise.all([
    prisma.session.findMany({ where: { date: { gte: since, lt: start } }, orderBy: { date: 'asc' } }),
    prisma.activities.findMany({ where: { date: { gte: since, lt: start } }, orderBy: { date: 'asc' } }),
    prisma.decision_log.findMany({ where: { date: { gte: subDays(start, QUALITY_WINDOW_DAYS) } } }),
  ])

  const sessionRows: SessionLoadRow[] = sessions.map((s) => ({
    date: new Date(s.date),
    plannedLoad: s.plannedLoad,
    actualLoad: s.actualLoad,
    srpe: s.srpe,
    status: s.status,
  }))

  const activityRows: ActivityLoadRow[] = activities.map((a) => ({
    date: new Date(a.date),
    durationMin: a.durationMin,
    trimp: a.trimp,
  }))

  const { dailyLoads, recentDays } = summarizeDailyLoads(
    sessionRows,
    activityRows,
    subDays(start, 1),
    LOAD_WINDOW_DAYS,
  )

  const followedByDate = new Map<number, boolean | null>()
  for (const d of decisions) followedByDate.set(startOfDay(new Date(d.date)).getTime(), d.wasFollowed)

  const qualityRows: QualityDayRow[] = sessions.map((s) => {
    const cost = sessionCost(parseBlocks(s.blocksJson), itemCost)
    return {
      date: new Date(s.date),
      prescribedHardness: cost.hardness,
      completedShare:
        s.actualLoad != null && s.plannedLoad != null && s.plannedLoad > 0
          ? s.actualLoad / s.plannedLoad
          : null,
      wasFollowed: followedByDate.get(startOfDay(new Date(s.date)).getTime()) ?? null,
    }
  })

  const lastWeekLoad = dailyLoads.slice(-7).reduce((a, b) => a + b, 0)
  const thisWeekLoadSoFar = dailyLoads
    .slice(-(start.getDay() === 0 ? 7 : start.getDay()))
    .reduce((a, b) => a + b, 0)

  return {
    dailyLoads,
    recentDays,
    yesterdayHard: wasYesterdayHard(recentDays, today),
    qualityHistory: computeQualityHistory(qualityRows, today),
    lastWeekLoad,
    thisWeekLoadSoFar,
  }
}

/** Niggles in allocator form, from the region vocabulary the tracker writes. */
export function nigglesFromRegions(
  regions: Array<{ bodyRegion: string; severity: number; daysActive?: number }>,
): Niggle[] {
  return regions.map((r, i) => {
    const region = toBodyRegion(r.bodyRegion)
    return {
      id: `${region}-${i}`,
      bodyRegion: region,
      tissues: tissuesForRegion(region),
      severity: r.severity,
      daysActive: r.daysActive,
    }
  })
}

// ── Request validation ────────────────────────────────────────────────────────
// Both edit paths of §11 arrive here as JSON — the UI's tap and the coach's
// sentence — and neither is trusted. A patch that half-parses is worse than one
// that is refused outright: it would apply some ops and drop others, which is
// exactly the silent data loss the single funnel exists to prevent.

const ITEM_KINDS: ItemKind[] = ['exercise', 'plyo', 'prehab', 'stretch', 'run']
const ITEM_STATUSES: ItemStatus[] = ['prescribed', 'done', 'skipped', 'edited']
const PARAM_KINDS = ['strength', 'run', 'contacts', 'hold']

/** Ops in one patch. A hundred is a bug or an attack, not an edit. */
export const MAX_PATCH_OPS = 50
export const MAX_TEXT_LENGTH = 500

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < min || value > max) return null
  return value
}

function str(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > max) return null
  return trimmed
}

/** Text that may be absent, and is clipped rather than rejected when present. */
export function optionalText(value: unknown, max = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed.slice(0, max)
}

/** Params, checked against the bounds each kind actually has. */
export function sanitizeParams(value: unknown, partial: boolean): ItemParams | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  if (typeof kind !== 'string' || !PARAM_KINDS.includes(kind)) return null
  const out: Record<string, unknown> = { kind }

  if (kind === 'strength') {
    if (value.sets !== undefined) {
      const sets = num(value.sets, 1, 20)
      if (sets === null) return null
      out.sets = Math.round(sets)
    }
    if (value.reps !== undefined) {
      const reps = num(value.reps, 1, 100)
      if (reps === null) return null
      out.reps = Math.round(reps)
    }
    if (value.repsMin !== undefined && value.repsMin !== null) {
      const repsMin = num(value.repsMin, 1, 100)
      if (repsMin === null) return null
      out.repsMin = Math.round(repsMin)
    }
    if (value.weightKg !== undefined) {
      if (value.weightKg === null) out.weightKg = null
      else {
        const weight = num(value.weightKg, 0, 500)
        if (weight === null) return null
        out.weightKg = weight
      }
    }
    if (value.targetRir !== undefined) {
      const rir = num(value.targetRir, 0, 10)
      if (rir === null) return null
      out.targetRir = rir
    }
    if (value.restSec !== undefined) {
      const rest = num(value.restSec, 0, 900)
      if (rest === null) return null
      out.restSec = Math.round(rest)
    }
    if (!partial && (out.sets === undefined || out.reps === undefined || out.targetRir === undefined)) {
      return null
    }
    return out as unknown as ItemParams
  }

  if (kind === 'run') {
    const runType = str(value.runType, 30)
    if (runType) out.runType = runType
    else if (!partial) return null
    for (const key of ['durationMin', 'distanceKm'] as const) {
      if (value[key] === undefined) continue
      if (value[key] === null) {
        out[key] = null
        continue
      }
      const parsed = num(value[key], 0, key === 'durationMin' ? 600 : 300)
      if (parsed === null) return null
      out[key] = parsed
    }
    for (const key of ['targetPaceSecPerKm', 'targetHrLow', 'targetHrHigh'] as const) {
      if (value[key] === undefined) continue
      if (value[key] === null) {
        out[key] = null
        continue
      }
      const parsed = num(value[key], 0, 1200)
      if (parsed === null) return null
      out[key] = parsed
    }
    if (value.intervals !== undefined) {
      if (!Array.isArray(value.intervals) || value.intervals.length > 40) return null
      const intervals: Array<{ repeat: number; workSec: number; recoverSec: number; label?: string }> = []
      for (const raw of value.intervals) {
        if (!isRecord(raw)) return null
        const repeat = num(raw.repeat, 1, 60)
        const workSec = num(raw.workSec, 1, 7200)
        const recoverSec = num(raw.recoverSec, 0, 7200)
        if (repeat === null || workSec === null || recoverSec === null) return null
        const label = optionalText(raw.label, 60)
        intervals.push({
          repeat: Math.round(repeat),
          workSec: Math.round(workSec),
          recoverSec: Math.round(recoverSec),
          ...(label ? { label } : {}),
        })
      }
      out.intervals = intervals
    }
    return out as unknown as ItemParams
  }

  if (kind === 'contacts') {
    if (value.sets !== undefined) {
      const sets = num(value.sets, 1, 20)
      if (sets === null) return null
      out.sets = Math.round(sets)
    }
    if (value.contactsPerSet !== undefined) {
      const per = num(value.contactsPerSet, 1, 200)
      if (per === null) return null
      out.contactsPerSet = Math.round(per)
    }
    if (value.restSec !== undefined) {
      const rest = num(value.restSec, 0, 900)
      if (rest === null) return null
      out.restSec = Math.round(rest)
    }
    if (!partial && (out.sets === undefined || out.contactsPerSet === undefined)) return null
    return out as unknown as ItemParams
  }

  if (value.sets !== undefined) {
    const sets = num(value.sets, 1, 20)
    if (sets === null) return null
    out.sets = Math.round(sets)
  }
  if (value.reps !== undefined) {
    if (value.reps === null) out.reps = null
    else {
      const reps = num(value.reps, 1, 200)
      if (reps === null) return null
      out.reps = Math.round(reps)
    }
  }
  if (value.holdSec !== undefined) {
    if (value.holdSec === null) out.holdSec = null
    else {
      const hold = num(value.holdSec, 1, 600)
      if (hold === null) return null
      out.holdSec = Math.round(hold)
    }
  }
  if (value.perSide !== undefined) {
    if (typeof value.perSide !== 'boolean') return null
    out.perSide = value.perSide
  }
  if (!partial && out.sets === undefined) return null
  return out as unknown as ItemParams
}

export function sanitizeItem(value: unknown): SessionItem | null {
  if (!isRecord(value)) return null
  const id = str(value.id, 120)
  if (!id) return null
  if (!isRecord(value.ref)) return null

  const kind = value.ref.kind
  if (typeof kind !== 'string' || !ITEM_KINDS.includes(kind as ItemKind)) return null
  const refId = str(value.ref.id, 120)
  const name = str(value.ref.name, 160)
  if (!refId || !name) return null

  const params = sanitizeParams(value.params, false)
  if (!params) return null

  const status = ITEM_STATUSES.includes(value.status as ItemStatus)
    ? (value.status as ItemStatus)
    : 'prescribed'

  const why = optionalText(value.why)

  return {
    id,
    ref: { kind: kind as ItemKind, id: refId, name },
    params,
    ...(why ? { why } : {}),
    status,
  }
}

export interface PatchParseResult {
  patch: SessionPatch | null
  error: string | null
}

/**
 * Parse a request body into a patch, or say why not.
 *
 * `engine` is deliberately not an accepted actor: the engine writes through the
 * allocator, never through HTTP, and letting a request claim to be the engine
 * would let an edit launder itself past the audit trail §11 depends on.
 */
export function parsePatchBody(body: unknown): PatchParseResult {
  if (!isRecord(body)) return { patch: null, error: 'A JSON object body is required.' }

  const actor = body.actor
  if (actor !== 'user' && actor !== 'coach') {
    return { patch: null, error: "actor must be 'user' or 'coach'." }
  }

  const raw = body.patch
  const opsSource = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.ops)
      ? raw.ops
      : null
  if (!opsSource) return { patch: null, error: 'patch.ops must be an array of operations.' }
  if (opsSource.length === 0) {
    return { patch: null, error: 'patch.ops must contain at least one operation.' }
  }
  if (opsSource.length > MAX_PATCH_OPS) {
    return { patch: null, error: 'patch.ops holds more operations than one edit may carry.' }
  }

  const fallbackReason = optionalText(body.reason)
  const ops: PatchOp[] = []

  for (const candidate of opsSource) {
    if (!isRecord(candidate)) return { patch: null, error: 'Every operation must be an object.' }
    const reason = optionalText(candidate.reason) ?? fallbackReason
    if (!reason) {
      return { patch: null, error: 'Every operation needs a reason — it is what the diff shows.' }
    }

    if (candidate.op === 'remove') {
      const itemId = str(candidate.itemId, 120)
      if (!itemId) return { patch: null, error: 'remove needs an itemId.' }
      ops.push({ op: 'remove', itemId, reason })
      continue
    }

    if (candidate.op === 'replace') {
      const itemId = str(candidate.itemId, 120)
      const item = sanitizeItem(candidate.item)
      if (!itemId || !item) {
        return { patch: null, error: 'replace needs an itemId and a valid item.' }
      }
      ops.push({ op: 'replace', itemId, item, reason })
      continue
    }

    if (candidate.op === 'modify') {
      const itemId = str(candidate.itemId, 120)
      if (!itemId) return { patch: null, error: 'modify needs an itemId.' }
      let params: ParamsPatch | undefined
      if (candidate.params !== undefined) {
        const parsed = sanitizeParams(candidate.params, true)
        if (!parsed) return { patch: null, error: 'modify.params is not a valid params patch.' }
        params = parsed as ParamsPatch
      }
      const why = optionalText(candidate.why)
      const status = ITEM_STATUSES.includes(candidate.status as ItemStatus)
        ? (candidate.status as ItemStatus)
        : undefined
      ops.push({
        op: 'modify',
        itemId,
        ...(params ? { params } : {}),
        ...(why ? { why } : {}),
        ...(status ? { status } : {}),
        reason,
      })
      continue
    }

    if (candidate.op === 'reorder') {
      const blockKind = BLOCK_ORDER.includes(candidate.blockKind as BlockKind)
        ? (candidate.blockKind as BlockKind)
        : null
      if (!blockKind) return { patch: null, error: 'reorder needs a valid blockKind.' }
      if (!Array.isArray(candidate.itemIds) || candidate.itemIds.length === 0) {
        return { patch: null, error: 'reorder needs the block item ids in their new order.' }
      }
      const itemIds: string[] = []
      for (const id of candidate.itemIds) {
        const parsed = str(id, 120)
        if (!parsed) return { patch: null, error: 'reorder.itemIds must all be non-empty strings.' }
        itemIds.push(parsed)
      }
      ops.push({ op: 'reorder', blockKind, itemIds, reason })
      continue
    }

    if (candidate.op === 'add') {
      const blockKind = BLOCK_ORDER.includes(candidate.blockKind as BlockKind)
        ? (candidate.blockKind as BlockKind)
        : null
      const item = sanitizeItem(candidate.item)
      if (!blockKind || !item) {
        return { patch: null, error: 'add needs a valid blockKind and item.' }
      }
      const index = candidate.index === undefined ? null : num(candidate.index, 0, 100)
      if (candidate.index !== undefined && index === null) {
        return { patch: null, error: 'add.index must be a small non-negative number.' }
      }
      ops.push({
        op: 'add',
        blockKind,
        item,
        ...(index === null ? {} : { index: Math.round(index) }),
        reason,
      })
      continue
    }

    return { patch: null, error: 'Unknown operation.' }
  }

  const source = optionalText(body.source)

  return {
    patch: {
      actor,
      ops,
      ...(source ? { source } : {}),
      ...(body.override === true ? { override: true } : {}),
    },
    error: null,
  }
}

// ── Logging a set, whatever kind of item it is ────────────────────────────────
// One session holds lifts, runs, plyos, prehab and stretches (§3), so one table
// logs them: `set_logs` now carries `contacts` and `holdSec` alongside weight
// and reps, keyed by the Session item id. The dispatch below is the only place
// that knows which columns a given kind fills in.

export interface LogSetInput {
  sessionId: number
  /** The Session item id — what the card on screen is. */
  itemId: string
  setNumber: number
  weightKg?: number | null
  reps?: number | null
  rir?: number | null
  contacts?: number | null
  holdSec?: number | null
  notes?: string | null
}

export interface LoggedSetResult {
  row: unknown
  item: SessionItem
  sets: unknown[]
}

/** Find a Session item by id across every block. */
export function findSessionItem(blocks: SessionBlock[], itemId: string): SessionItem | null {
  for (const block of blocks) {
    const found = block.items.find((i) => i.id === itemId)
    if (found) return found
  }
  return null
}

/**
 * Persist one set and let the anchors it informs move.
 *
 * A lift refreshes its working-load anchor, a plyo refreshes the tier anchor —
 * the §5b calibration loop, running on the two different kinds of evidence the
 * two modalities produce. A run is not logged set by set; Garmin supplies it.
 */
export async function logSessionSet(
  sessionId: number,
  item: SessionItem,
  input: Omit<LogSetInput, 'sessionId' | 'itemId'>,
): Promise<{ row: unknown; sets: unknown[] }> {
  const kind = item.ref.kind

  if (kind === 'run') {
    throw new Error('Runs are logged by completing the session, not set by set.')
  }

  if (kind === 'plyo' || kind === 'prehab' || kind === 'stretch') {
    const row = await logMovementSet({
      sessionId,
      exerciseId: item.ref.id,
      itemId: item.id,
      itemKind: kind,
      setNumber: input.setNumber,
      contacts: input.contacts ?? null,
      holdSec: input.holdSec ?? null,
      reps: input.reps ?? null,
      notes: input.notes ?? null,
    })
    const sets = await prisma.set_logs.findMany({
      where: { sessionId, itemId: item.id },
      orderBy: { setNumber: 'asc' },
    })
    return { row, sets }
  }

  const existing = await prisma.set_logs.findFirst({
    where: { sessionId, itemId: item.id, setNumber: input.setNumber },
  })

  const data = {
    sessionId,
    exerciseId: item.ref.id,
    itemId: item.id,
    itemKind: 'exercise',
    setNumber: input.setNumber,
    weightKg: input.weightKg ?? null,
    reps: input.reps ?? null,
    rir: input.rir ?? null,
    notes: input.notes ?? null,
  }

  const row = existing
    ? await prisma.set_logs.update({ where: { id: existing.id }, data })
    : await prisma.set_logs.create({ data })

  await refreshWorkingLoadAnchor(item.ref.id)

  const sets = await prisma.set_logs.findMany({
    where: { sessionId, itemId: item.id },
    orderBy: { setNumber: 'asc' },
  })
  return { row, sets }
}

/** A logged set moves the session out of draft — it has started (§14 step 6). */
export async function markSessionActive(sessionId: number, status: string): Promise<void> {
  if (status !== 'draft') return
  await prisma.session.update({ where: { id: sessionId }, data: { status: 'active' } })
}
