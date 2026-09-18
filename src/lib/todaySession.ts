// ── Today's session ───────────────────────────────────────────────────────────
// The orchestrator (framework §18). Five modalities each price their own work,
// the allocator decides what the day can afford, and the result is persisted as
// the one editable Session the whole product turns on (§11, §14).
//
// This is what finally retires the fixed lookup tables. `buildStrengthSession`
// and `ensureWeeklyPlan` both say so in their own comments — "start dumb (a
// lookup-table allocator) and earn the intelligence" (§19) — and they stay
// exactly where they are, tests and all. They are simply no longer the
// top-level path: `buildStrengthSession` is now one candidate source among
// five, and what it proposes has to survive the same budget everything else does.
//
// Split in two on purpose: `planTodaySession` is pure and takes every number as
// an argument, so a whole day can be asserted against literals; `ensureToday`
// is the only half that needs a database.

import { addDays, startOfDay, subDays } from 'date-fns'
import { prisma } from './db'
import { allocateSession } from './allocator'
import { computeDailyBudget, estimateItemCost } from './load'
import { computeReadiness } from './readiness'
import { getScenario } from './scenario'
import { getStrengthScenario } from './strengthScenario'
import { getRunScenario } from './runScenario'
import { getMovementScenario } from './movementScenario'
import { RUN_TYPES } from './runEngine'
import { getKeyLift, isHeavyLowerBody } from './keyLifts'
import {
  buildStrengthSession,
  daysSinceLastIncrease,
  latestByExercise,
  loadExerciseHistories,
} from './strengthSession'
import { buildTodayRun, deriveZones, parseRecoveryContext, parseTrainingPaces } from './runSession'
import { getMovementCandidates, getNiggleAssessments, toAllocatorNiggles } from './movementSession'
import { activePreferenceRules, parseStoredPreference } from './preferences'
import type { StoredPreference } from './preferences'
import {
  RUN_TISSUES,
  buildValidationContext,
  createSessionRow,
  readEditableSession,
  findSessionRow,
  isUntouched,
  itemCost,
  itemFacts,
  loadDayContext,
  logDecision,
  parseBlocks,
  plannedTotals,
  replaceEngineSession,
  toEditableSession,
} from './sessionStore'
import type {
  AllocatedSession,
  AllocationDecision,
  CandidateItem,
  DayIntent,
  DayPlanLike,
  Modality,
  Niggle,
  PreferenceRule,
  Priority,
} from './allocator'
import type { DayLoadRecord } from './allocator'
import type { LoadBudget } from './load'
import type { ReadinessBand, ReadinessResult } from '../types/readiness'
import type { AnchorSource, RecoveryContext } from '../types/strength'
import type { RunPrescription, RunType } from '../types/run'
import type { ValidationContext } from './session'
import type { EditableSession } from '../types/patch'
import type { RunParams, SessionBlock, SessionItem } from '../types/session'
import type { MovementCandidateInput, MovementCandidates } from './movementSession'
import type { BuiltSession } from './strengthSession'

// ── Flags ─────────────────────────────────────────────────────────────────────

/**
 * One line, only when something needs saying (§10 step 6).
 *
 * The allocator's flags and the engines' flags are merged into one list rather
 * than nested per modality, because the Today screen shows a flag strip and
 * does not care which subsystem noticed.
 */
export interface VerdictFlag {
  code: string
  message: string
  source: 'allocator' | 'run' | 'strength' | 'plyo' | 'prehab' | 'stretch'
}

/** §14 step 5 — "what changed vs plan", or "nothing to action". */
export interface ChangedEntry {
  itemId: string
  name: string
  modality: Modality
  outcome: AllocationDecision['outcome']
  code: AllocationDecision['code']
  reason: string
}

export interface ChangedVsPlan {
  changed: boolean
  summary: string
  entries: ChangedEntry[]
}

// ── Candidate production ──────────────────────────────────────────────────────

/** Run types that are not a session — nothing goes to the allocator for them. */
const NON_SESSION_RUN_TYPES = new Set<RunType>(['rest'])

/**
 * The run, as a candidate.
 *
 * The run engine already decided *what* run the ladder and readiness allow; the
 * allocator only decides whether the day can afford it and what it displaces.
 * Priority A because on a running plan the run is the point of the day (§7).
 */
export function runCandidate(
  prescription: RunPrescription,
  isPrimary: boolean,
): CandidateItem | null {
  if (NON_SESSION_RUN_TYPES.has(prescription.type)) return null
  if (prescription.durationMin <= 0) return null

  const params: RunParams = {
    kind: 'run',
    runType: prescription.type,
    durationMin: prescription.durationMin,
    targetPaceSecPerKm: prescription.targetPaceSecPerKm ?? null,
    targetHrLow: prescription.targetHrLow ?? null,
    targetHrHigh: prescription.targetHrHigh ?? null,
    ...(prescription.intervals ? { intervals: prescription.intervals } : {}),
  }

  const item: SessionItem = {
    // Deterministic so a regenerate produces the same session, not a new one.
    id: `run-${prescription.type}`,
    ref: { kind: 'run', id: prescription.type, name: prescription.label },
    params,
    why: prescription.why,
    status: 'prescribed',
  }

  return {
    item,
    cost: estimateItemCost(item, { srpe: RUN_TYPES[prescription.type].intensityCost }),
    priority: isPrimary ? 'A' : 'B',
    placement: 'main',
    modality: 'run',
    constraints: { tissues: RUN_TISSUES, trimmable: true },
  }
}

/**
 * The lifts, as candidates.
 *
 * `buildStrengthSession` still picks and progresses them — its lookup table is
 * a perfectly good *strength* template — but it no longer decides whether they
 * happen. The concurrent-training rails in the allocator get the final word.
 */
export function strengthCandidates(built: BuiltSession, isPrimary: boolean): CandidateItem[] {
  const out: CandidateItem[] = []

  for (const block of built.blocks) {
    for (const item of block.items) {
      const lift = getKeyLift(item.ref.id)
      const heavy = lift ? isHeavyLowerBody(lift) : false
      const facts = itemFacts(item)
      const priority: Priority =
        block.kind === 'main' ? (isPrimary ? 'A' : 'B') : 'C'

      out.push({
        item,
        cost: itemCost(item),
        priority,
        placement: block.kind === 'main' ? 'main' : 'accessory',
        modality: 'strength',
        constraints: {
          tissues: facts.tissues,
          heavyLowerBody: heavy,
          trimmable: true,
        },
      })
    }
  }

  return out
}

// ── Preferences (§13) ─────────────────────────────────────────────────────────

export interface PreferenceRow {
  id: number
  rule: string
  source: string
  confidence: number
  weight: number
  /** False once a later rule on the same subject retired it (§13). */
  active?: boolean | null
}

/**
 * Turn a stored preference into something the allocator can act on, date-blind.
 *
 * The fallback, not the main road. `preferences.parseStoredPreference` +
 * `activePreferenceRules` is what `gatherToday` uses, because that pair knows
 * what day it is and a rule that says "weekends" must not bind on a Tuesday.
 * This one still exists for a structured row this app's own writer did not
 * author — an item-id rule, say — and it is deliberately date-blind, which is
 * exactly why `bindingEffect` stores everything day-scoped as the inert
 * `suggest` that the `effect` check below drops. A row it cannot read stays
 * visible and inert rather than being approximated: a mis-parsed preference
 * silently deletes work the athlete wanted.
 */
export function toPreferenceRule(row: PreferenceRow): PreferenceRule | null {
  let parsed: {
    label?: string
    effect?: string
    match?: { modality?: string; itemIds?: string[] }
  }
  try {
    parsed = JSON.parse(row.rule)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  // A retired rule is history, not a constraint. Checked here as well as in the
  // query, because this is the date-blind path and it must be unable to
  // resurrect something a later statement superseded (§13).
  if (row.active === false) return null

  const effect = parsed.effect === 'exclude' ? 'exclude' : parsed.effect === 'deprioritize' ? 'deprioritize' : null
  if (!effect) return null

  const match: PreferenceRule['match'] = {}
  const modalities: Modality[] = ['run', 'strength', 'plyo', 'prehab', 'stretch']
  if (parsed.match?.modality && modalities.includes(parsed.match.modality as Modality)) {
    match.modality = parsed.match.modality as Modality
  }
  if (Array.isArray(parsed.match?.itemIds)) match.itemIds = parsed.match.itemIds
  if (match.modality === undefined && match.itemIds === undefined) return null

  return {
    id: String(row.id),
    label: parsed.label ?? row.rule,
    source: row.source === 'explicit' ? 'explicit' : 'inferred',
    confidence: row.confidence,
    effect,
    match,
  }
}

/**
 * The stored rules that bind *today*, in the allocator's shape.
 *
 * §13's explicit rules are mostly day-scoped — "no weights on weekends", "rest
 * Monday" — and a stored row has no idea what day it is, which is why they were
 * serialized inert. Resolving them needs a date, so this takes one and hands
 * the rows to `activePreferenceRules`, which drops anything the weekday does
 * not match and anything an unconfirmed inference produced (§13: an inference
 * is surfaced for confirmation, never applied).
 *
 * `toPreferenceRule` catches only what that parser refuses to read — a
 * structured row written outside `preferences.ts`. It is date-blind, and
 * `bindingEffect` is what keeps that safe: everything day-scoped or unconfirmed
 * is stored with the inert `suggest` effect, so the fallback cannot resurrect a
 * weekend rule on a Tuesday even if it wanted to.
 *
 * "long run Sunday" and "no doubles" have no `PreferenceRule` that can express
 * them, so they resolve to nothing here and stay visible-and-inert on the
 * preferences screen. Inventing a representation would be worse than saying so.
 */
export function preferenceRulesFor(rows: PreferenceRow[], date: Date): PreferenceRule[] {
  const structured: StoredPreference[] = []
  const unreadable: PreferenceRow[] = []

  for (const row of rows) {
    const parsed = parseStoredPreference(row)
    if (parsed) structured.push(parsed)
    else unreadable.push(row)
  }

  return [
    ...activePreferenceRules(structured, date),
    ...unreadable.map(toPreferenceRule).filter((p): p is PreferenceRule => p !== null),
  ]
}

// ── The plan's intent ─────────────────────────────────────────────────────────

export interface PlannedRow {
  date: Date
  modality: string
  targetSpecJson: string | null
  priority: string
}

export interface PlannedSpec {
  runType: RunType | null
  durationMin: number | null
  priority: Priority
}

export function parsePlannedSpec(row: PlannedRow | null | undefined): PlannedSpec {
  const priority: Priority =
    row?.priority === 'A' ? 'A' : row?.priority === 'C' ? 'C' : 'B'
  if (!row?.targetSpecJson) return { runType: null, durationMin: null, priority }
  try {
    const spec = JSON.parse(row.targetSpecJson) as { runType?: RunType; durationMin?: number }
    return {
      runType: spec.runType ?? null,
      durationMin: spec.durationMin ?? null,
      priority,
    }
  } catch {
    return { runType: null, durationMin: null, priority }
  }
}

/** Runs the day is built around — the ones a heavy lift has to stay clear of (§8). */
const QUALITY_RUN_TYPES = new Set<RunType>([
  'long', 'vo2', 'tempo', 'hills', 'progression', 'fartlek', 'strides',
])
const RECOVERY_RUN_TYPES = new Set<RunType>(['recovery', 'rest', 'walk'])

export function isQualityRunType(type: RunType | null): boolean {
  return type !== null && QUALITY_RUN_TYPES.has(type)
}

export function isRecoveryRunType(type: RunType | null): boolean {
  return type !== null && RECOVERY_RUN_TYPES.has(type)
}

/**
 * What the plan wants today, before readiness gets a say (§18 step 3).
 *
 * A red day still has an intent — the band cuts the budget, it does not rewrite
 * what the week was for. Keeping the two separate is what makes "changed vs
 * plan" a sentence the athlete can read rather than an unexplained smaller day.
 */
export function deriveIntent(
  planned: PlannedSpec,
  band: ReadinessBand,
): DayIntent {
  const runType = planned.runType
  const hasRun = runType !== null && runType !== 'rest'

  return {
    primaryModality: hasRun ? 'run' : 'strength',
    isQualityDay: isQualityRunType(runType) && band === 'green',
    plannedRunType: runType,
    priority: planned.priority,
  }
}

/** Calibration state → the weakest anchor the day depends on (§5). */
export function anchorConfidenceFor(readiness: ReadinessResult): AnchorSource {
  if (readiness.calibration === 'graduated') return 'confirmed'
  if (readiness.calibration === 'baseline_ready') return 'observed'
  return 'estimate'
}

// ── The pure orchestrator ─────────────────────────────────────────────────────

export interface TodaySessionInput {
  date: Date
  band: ReadinessBand
  calibrating: boolean
  anchorConfidence: AnchorSource
  intent: DayIntent
  budget: LoadBudget
  candidates: CandidateItem[]
  niggles: Niggle[]
  preferences: PreferenceRule[]
  recentDays: DayLoadRecord[]
  tomorrow: DayPlanLike | null
  /** Flags the engines raised before the allocator ever saw their work. */
  engineFlags: VerdictFlag[]
  disclaimer: string
}

export interface PlannedDay {
  allocation: AllocatedSession
  blocks: SessionBlock[]
  budget: LoadBudget
  verdictFlags: VerdictFlag[]
  /** One sentence for today's shape (§10 step 3, §14 step 2). */
  why: string
  changedVsPlan: ChangedVsPlan
  /** §15 — every response that can carry prehab carries this. */
  disclaimer: string
}

/** The one-liner. Deliberately short: the per-item "why" carries the detail (§12). */
export function summarizeDay(
  allocation: AllocatedSession,
  intent: DayIntent,
  band: ReadinessBand,
): string {
  if (allocation.blocks.length === 0) {
    return band === 'red'
      ? 'Nothing today — the numbers say recover, and that is the session.'
      : 'Nothing fits today once the rails are applied. Rest, and the budget comes back tomorrow.'
  }

  const modalities = new Set<Modality>()
  for (const decision of allocation.decisions) {
    if (decision.outcome !== 'rejected') modalities.add(decision.modality)
  }

  const shape = Array.from(modalities).join(' + ')
  const bandPhrase =
    band === 'green'
      ? 'Green day'
      : band === 'amber'
        ? 'Amber day — trimmed rather than skipped'
        : 'Red day — the smallest useful version'

  // The near-free prehab and mobility never came out of the budget (§9), so
  // reporting the total against the ceiling would read as an overspend that
  // never happened. The allocator says how much it actually exempted — re-
  // deriving it from the blocks would over-report, because past the allowance a
  // cheap item pays its own way like anything else.
  const exempt = allocation.nearFreeLoad
  const budgeted = Math.round(Math.max(0, allocation.plannedLoad - exempt))
  const ceiling = Math.round(allocation.budget.ceiling)

  let tail: string
  if (exempt > 0 && budgeted === 0) {
    tail = `all of it near-free prehab and mobility — nothing today draws on the ${ceiling} budget`
  } else if (exempt > 0) {
    tail =
      `${budgeted} of the ${ceiling} today allows, plus ${Math.round(exempt)} of near-free ` +
      `prehab and mobility`
  } else {
    tail = `${budgeted} load of the ${ceiling} today allows`
  }

  return `${bandPhrase}: ${shape}, ${tail}, built around ${intent.primaryModality}.`
}

/** What readiness and the rails changed versus what the plan wanted (§14 step 5). */
export function diffAgainstPlan(allocation: AllocatedSession): ChangedVsPlan {
  const entries: ChangedEntry[] = allocation.decisions
    .filter((d) => d.outcome !== 'selected')
    // A candidate the budget simply never reached is not a change to the plan;
    // a candidate a rule refused is.
    .filter((d) => d.outcome === 'trimmed' || d.code !== 'budget_exhausted')
    .map((d) => ({
      itemId: d.itemId,
      name: d.name,
      modality: d.modality,
      outcome: d.outcome,
      code: d.code,
      reason: d.reason,
    }))

  if (entries.length === 0) {
    return { changed: false, summary: 'nothing to action', entries: [] }
  }

  const trimmed = entries.filter((e) => e.outcome === 'trimmed').length
  const dropped = entries.length - trimmed
  const parts: string[] = []
  if (dropped > 0) parts.push(`${dropped} dropped`)
  if (trimmed > 0) parts.push(`${trimmed} trimmed`)

  return { changed: true, summary: parts.join(', '), entries }
}

/** Allocate the day. Pure: every input is an argument, nothing is read. */
export function planTodaySession(input: TodaySessionInput): PlannedDay {
  const allocation = allocateSession({
    date: input.date,
    band: input.band,
    calibrating: input.calibrating,
    anchorConfidence: input.anchorConfidence,
    intent: input.intent,
    budget: input.budget,
    candidates: input.candidates,
    niggles: input.niggles,
    preferences: input.preferences,
    recentDays: input.recentDays,
    tomorrow: input.tomorrow,
  })

  const verdictFlags: VerdictFlag[] = [
    ...allocation.flags.map((f) => ({ code: f.code, message: f.message, source: 'allocator' as const })),
    ...input.engineFlags,
  ]

  return {
    allocation,
    blocks: allocation.blocks,
    budget: allocation.budget,
    verdictFlags,
    why: summarizeDay(allocation, input.intent, input.band),
    changedVsPlan: diffAgainstPlan(allocation),
    disclaimer: input.disclaimer,
  }
}

// ── Planning a day that is not today ──────────────────────────────────────────

/**
 * The two things a *future* day needs and today never does (framework §7, §10).
 *
 * Readiness is a today-only signal — there is no HRV for Thursday yet — so a day
 * further out is planned at the shape the plan wants, and the veto is applied on
 * the morning itself, when there is something real to veto with. And a planned
 * day carries no sRPE, so `summarizeDailyLoads` cannot see that yesterday's
 * *plan* was hard; the week loop knows, and says so.
 *
 * Both default to the measured answer, so every existing caller is unchanged.
 */
export interface DayOverrides {
  band?: ReadinessBand
  yesterdayHard?: boolean
}

// ── The DB half ───────────────────────────────────────────────────────────────

function scenarioMode(): Record<string, string> | null {
  const active: Record<string, string> = {}
  if (getScenario()) active.readiness = process.env.SCENARIO as string
  if (getStrengthScenario()) active.strength = process.env.STRENGTH_SCENARIO as string
  if (getRunScenario()) active.run = process.env.RUN_SCENARIO as string
  if (getMovementScenario()) active.movement = process.env.MOVEMENT_SCENARIO as string
  return Object.keys(active).length > 0 ? active : null
}

export interface GatheredDay extends PlannedDay {
  readiness: ReadinessResult
  intent: DayIntent
  movement: MovementCandidates & { input: MovementCandidateInput }
  strength: BuiltSession
  run: RunPrescription | null
  scenarioMode: Record<string, string> | null
}

/**
 * Gather the whole day and allocate it — without touching the `session` row.
 *
 * Every modality is asked for candidates unconditionally. The rails, not the
 * gatherer, decide what survives: a plyo drill on a red day is offered and
 * rejected with a reason the athlete can read, which is strictly better than
 * never having been considered (§10 — the decisions are the explanation).
 */
export async function gatherToday(
  today = new Date(),
  overrides: DayOverrides = {},
): Promise<GatheredDay> {
  const date = startOfDay(today)
  const measured = getScenario() ?? (await computeReadiness())
  // A day further out has no readiness of its own yet, so the week planner asks
  // for the shape the plan wants and lets the morning apply the veto (§7).
  const readiness = overrides.band ? { ...measured, band: overrides.band } : measured

  const [profile, plannedToday, plannedTomorrow, preferenceRows, dayContext] = await Promise.all([
    prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } }),
    prisma.planned_session.findFirst({ where: { date, modality: 'run' } }),
    prisma.planned_session.findFirst({ where: { date: addDays(date, 1), modality: 'run' } }),
    // Live rules only. A superseded preference stays in the table as history
    // (§13) and must never reach the allocator, so it is filtered in the query
    // rather than downstream of it.
    prisma.preferences.findMany({ where: { active: true } }),
    loadDayContext(today),
  ])

  const plannedSpec = parsePlannedSpec(plannedToday as PlannedRow | null)
  const tomorrowSpec = parsePlannedSpec(plannedTomorrow as PlannedRow | null)
  const intent = deriveIntent(plannedSpec, readiness.band)

  const painLevel = (readiness.currentPainLevel ?? profile?.currentPainLevel ?? 'none') as
    | 'none'
    | 'sometimes'
    | 'yes'
  const painFlagged = readiness.painFlagged || painLevel === 'yes'

  const context = parseRecoveryContext(profile?.recoveryContextJson ?? null)
  const recoveryContext = (context ?? null) as RecoveryContext | null

  // ── The run ────────────────────────────────────────────────────────────────
  const runScenario = getRunScenario()
  const paces = parseTrainingPaces(profile?.trainingPacesJson ?? null)
  const zones = deriveZones(profile?.age ?? null, profile?.hrZonesJson ?? null, null)

  const runResult = buildTodayRun({
    band: readiness.band,
    provisional: readiness.provisional,
    painLevel: runScenario ? runScenario.painLevel : painLevel,
    context: runScenario ? { ...runScenario.recoveryContext, ladder: runScenario.ladder } : context,
    zones,
    easyPaceAnchor: runScenario
      ? runScenario.easyPaceAnchor
      : paces.easy
        ? { value: paces.easy.value, source: paces.easy.source, confidence: paces.easy.confidence }
        : null,
    today: date,
    plannedType: plannedSpec.runType ?? undefined,
    plannedDurationMin: plannedSpec.durationMin ?? undefined,
  })

  const todayRunType: RunType | null = runResult.prescription.type
  const tomorrowRunType: RunType | null = tomorrowSpec.runType

  // ── The lifts ──────────────────────────────────────────────────────────────
  const strengthScenario = getStrengthScenario()
  const histories = strengthScenario ? strengthScenario.histories : await loadExerciseHistories()

  const strength = buildStrengthSession({
    band: readiness.band,
    provisional: readiness.provisional,
    painLevel,
    recoveryContext,
    lastSessionByExercise: latestByExercise(histories, { before: date }),
    daysSinceIncreaseByExercise: daysSinceLastIncrease(histories, today),
  })

  // ── Plyo, prehab, stretch ──────────────────────────────────────────────────
  const movement = await getMovementCandidates({
    band: readiness.band,
    provisional: readiness.provisional,
    painFlagged,
    isQualityDay: intent.isQualityDay,
    isRecoveryDay: isRecoveryRunType(todayRunType),
    todayRunType,
    tomorrowRunType,
    impactCleared: recoveryContext?.clearance?.impactCleared ?? false,
    today,
  })

  // ── The budget ─────────────────────────────────────────────────────────────
  const budget = computeDailyBudget({
    dailyLoads: dayContext.dailyLoads,
    band: readiness.band,
    calibrating: readiness.provisional,
    painFlagged,
    lastWeekLoad: dayContext.lastWeekLoad,
    thisWeekLoadSoFar: dayContext.thisWeekLoadSoFar,
  })

  const run = runCandidate(runResult.prescription, intent.primaryModality === 'run')
  const candidates: CandidateItem[] = [
    ...(run ? [run] : []),
    ...strengthCandidates(strength, intent.primaryModality === 'strength'),
    ...movement.candidates,
  ]

  const engineFlags: VerdictFlag[] = []
  if (movement.plyo.flag) {
    engineFlags.push({ code: 'plyo_flag', message: movement.plyo.flag, source: 'plyo' })
  }
  if (movement.prehab.flag) {
    engineFlags.push({ code: 'prehab_flag', message: movement.prehab.flag, source: 'prehab' })
  }
  if (movement.stretch.flag) {
    engineFlags.push({ code: 'stretch_flag', message: movement.stretch.flag, source: 'stretch' })
  }
  if (runResult.prescription.changed) {
    engineFlags.push({
      code: 'run_adjusted',
      message: runResult.prescription.changed,
      source: 'run',
    })
  }
  if (strength.usingConservativeDefault) {
    engineFlags.push({
      code: 'no_clearance',
      message:
        'No post-surgical clearance has been entered, so the lift selection is at its most ' +
        'conservative. Those numbers come from a surgeon or PT, not from this app.',
      source: 'strength',
    })
  }

  const planned = planTodaySession({
    date,
    band: readiness.band,
    calibrating: readiness.provisional,
    anchorConfidence: anchorConfidenceFor(readiness),
    intent,
    budget,
    candidates,
    niggles: toAllocatorNiggles(movement.input.assessments),
    // Day-scoped rules resolve here, where there is a date to resolve them
    // against — "no weights on weekends" binds on Saturday and does nothing on
    // Tuesday (§13).
    preferences: preferenceRulesFor(preferenceRows as PreferenceRow[], date),
    // `summarizeDailyLoads` can only call a day hard from the athlete's own
    // sRPE, which a day that has not happened yet does not have. The week loop
    // knows what it just allocated, so it says so and the back-to-back rail
    // reaches across planned days too (§10).
    recentDays: overrides.yesterdayHard
      ? [...dayContext.recentDays, { date: subDays(date, 1), load: 0, hard: true }]
      : dayContext.recentDays,
    tomorrow: tomorrowSpec.runType
      ? { date: addDays(date, 1), runType: tomorrowSpec.runType, priority: tomorrowSpec.priority }
      : null,
    engineFlags,
    disclaimer: movement.disclaimer,
  })

  return {
    ...planned,
    readiness,
    intent,
    movement,
    strength,
    run: runResult.prescription,
    scenarioMode: scenarioMode(),
  }
}

export interface TodaySessionResult extends GatheredDay {
  session: EditableSession
  created: boolean
}

/**
 * Today's session row, created or regenerated as needed.
 *
 * A session the athlete has edited is never rebuilt — that would throw away the
 * override §11 promises to preserve. An untouched, engine-authored one *is*
 * rebuilt while a scenario is active, which is what makes §16's "every feature
 * works in mock mode" true for a screen that persists its own output: flipping
 * MOVEMENT_SCENARIO and reloading has to show the new day, not yesterday's.
 */
export async function ensureToday(today = new Date()): Promise<TodaySessionResult> {
  const date = startOfDay(today)
  const existing = await findSessionRow(date)
  const gathered = await gatherToday(today)

  if (existing && !(scenarioMode() && isUntouched(existing))) {
    return {
      ...gathered,
      session: toEditableSession(existing),
      // The stored blocks win — they are what the athlete has been looking at.
      blocks: parseBlocks(existing.blocksJson),
      created: false,
    }
  }

  if (existing) {
    const refreshed = await replaceEngineSession(existing.id, gathered.blocks)
    return { ...gathered, session: toEditableSession(refreshed), created: false }
  }

  const totals = plannedTotals(gathered.blocks)
  const row = await createSessionRow({
    date,
    blocks: gathered.blocks,
    plannedLoad: gathered.allocation.plannedLoad || totals.plannedLoad,
    plannedDurationMin: gathered.allocation.plannedDurationMin || totals.plannedDurationMin,
  })

  await logDecision({
    date,
    blocks: gathered.blocks,
    rationale: gathered.why,
    readinessBand: gathered.readiness.band,
    context: {
      budget: gathered.budget,
      decisions: gathered.allocation.decisions,
      flags: gathered.verdictFlags,
    },
  })

  return { ...gathered, session: toEditableSession(row), created: true }
}

// ── The edit funnel's context ─────────────────────────────────────────────────

/**
 * Build the `ValidationContext` an edit is judged against.
 *
 * Leaner than `gatherToday` on purpose — a patch does not need candidates, only
 * the rails: today's budget, the band, what is sore, what tomorrow wants, and
 * whether yesterday was hard. `buildValidationContext` supplies the two
 * callbacks that make the niggle and concurrent-training rules bite at all.
 */
export async function todayValidationContext(
  today = new Date(),
  overrides: DayOverrides = {},
): Promise<ValidationContext> {
  const date = startOfDay(today)
  const measured = getScenario() ?? (await computeReadiness())
  const readiness = overrides.band ? { ...measured, band: overrides.band } : measured

  const [profile, plannedTomorrow, assessments, dayContext] = await Promise.all([
    prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } }),
    prisma.planned_session.findFirst({ where: { date: addDays(date, 1), modality: 'run' } }),
    getNiggleAssessments(today),
    loadDayContext(today),
  ])

  const painLevel = (readiness.currentPainLevel ?? profile?.currentPainLevel ?? 'none') as
    | 'none'
    | 'sometimes'
    | 'yes'
  const tomorrowSpec = parsePlannedSpec(plannedTomorrow as PlannedRow | null)

  const budget = computeDailyBudget({
    dailyLoads: dayContext.dailyLoads,
    band: readiness.band,
    calibrating: readiness.provisional,
    painFlagged: readiness.painFlagged || painLevel === 'yes',
    lastWeekLoad: dayContext.lastWeekLoad,
    thisWeekLoadSoFar: dayContext.thisWeekLoadSoFar,
  })

  // One ceiling, not two. The allocator's near-free exemption is bounded now
  // (§9's "small dose", `NEAR_FREE_ALLOWANCE`), so the validator judges an edit
  // against the same number the day was allocated against — and the rule that
  // an edit which *shrinks* an over-budget day is never pushed back for being
  // over budget lives in the validator itself, where both actors hit it.
  return buildValidationContext({
    budget,
    band: readiness.band,
    calibrating: readiness.provisional,
    niggles: toAllocatorNiggles(assessments),
    tomorrow: tomorrowSpec.runType
      ? { date: addDays(date, 1), runType: tomorrowSpec.runType, priority: tomorrowSpec.priority }
      : null,
    yesterdayHard: overrides.yesterdayHard ?? dayContext.yesterdayHard,
    qualityHistory: dayContext.qualityHistory,
  })
}
