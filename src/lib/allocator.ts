// ── The allocator ─────────────────────────────────────────────────────────────
// One budget, four modalities competing for it (framework §2, §18). This is the
// deterministic safety floor: load ceiling, ACWR band, "never two hard days
// back-to-back", niggle down-weighting, concurrent-training spacing and
// calibration ramp caps all live here, in code, not in a prompt (§10).
//
// It does not know what a plyometric is. Each engine hands it costed
// `CandidateItem`s through the interface below and the allocator decides what
// the day can afford — which is why this module imports no engine and can be
// tested with nothing but literals.
//
// Replaces the deliberate lookup table in `buildStrengthSession` (§19: start
// dumb, earn the intelligence).

import { NEAR_FREE_ALLOWANCE, NEAR_FREE_LOAD, HARD_DAY_SRPE, scaleItem } from './load'
import type { LoadBudget, LoadCost } from './load'
import type { ReadinessBand } from '../types/readiness'
import type { AnchorSource } from '../types/strength'
import type { BlockKind, SessionBlock, SessionItem } from '../types/session'

// ── The interface the engines satisfy ─────────────────────────────────────────

export type Modality = 'run' | 'strength' | 'plyo' | 'prehab' | 'stretch'
export type Priority = 'A' | 'B' | 'C'

export interface CandidateConstraints {
  /** Tissues this item loads, matched against a logged niggle (§9). */
  tissues?: string[]
  /** Tissues this item *treats* — the hook that promotes prehab into the day. */
  treats?: string[]
  /** Heavy lower-body lifting: the thing concurrent training is about (§8). */
  heavyLowerBody?: boolean
  /** Needs a fresh athlete — high-tier plyos, sprint work (§9). */
  requiresFresh?: boolean
  /** Must not land the day before a long run (§9). */
  notBeforeLongRun?: boolean
  /** Static stretching: fine after, power-sapping before quality work (§9). */
  excludeFromWarmupBeforeQuality?: boolean
  /** How well-known the athlete's anchors must be before this is safe (§5b). */
  minAnchorConfidence?: AnchorSource
  /** Set false for anything that is meaningless at reduced dose. */
  trimmable?: boolean
}

/**
 * What an engine offers the allocator. The engine prices its own work — it
 * knows what a depth jump costs and the allocator does not — and says where the
 * item belongs and how much the plan wants it.
 */
export interface CandidateItem {
  item: SessionItem
  cost: LoadCost
  priority: Priority
  placement: BlockKind
  modality: Modality
  constraints?: CandidateConstraints
}

// ── Inputs ────────────────────────────────────────────────────────────────────

/** A logged niggle: "left Achilles, 3/10" (§9). */
export interface Niggle {
  id: string
  bodyRegion: string
  /** Tags matched against `CandidateConstraints.tissues` / `treats`. */
  tissues: string[]
  /** As the athlete logged it, 0–10. */
  severity: number
  daysActive?: number
}

/** An explicit rule is a constraint; an inferred one is only a lean (§13). */
export interface PreferenceRule {
  id: string
  label: string
  source: 'explicit' | 'inferred'
  confidence: number
  effect: 'exclude' | 'deprioritize'
  match: { modality?: Modality; itemIds?: string[] }
}

/** What the plan wants today, before readiness gets a say (§18 step 3). */
export interface DayIntent {
  primaryModality: Modality
  isQualityDay: boolean
  plannedRunType?: string | null
  priority: Priority
  phase?: string
}

export interface DayPlanLike {
  date?: Date
  runType?: string | null
  priority?: Priority
  isQuality?: boolean
}

export interface DayLoadRecord {
  date: Date
  load: number
  hard: boolean
}

export interface AllocatorInput {
  date: Date
  band: ReadinessBand
  calibrating: boolean
  /** The weakest anchor the day's work depends on (§5). */
  anchorConfidence: AnchorSource
  intent: DayIntent
  budget: LoadBudget
  candidates: CandidateItem[]
  niggles?: Niggle[]
  preferences?: PreferenceRule[]
  /** Most recent days, any order — used for the back-to-back rule. */
  recentDays?: DayLoadRecord[]
  tomorrow?: DayPlanLike | null
}

// ── Outputs ───────────────────────────────────────────────────────────────────

export type AllocationReasonCode =
  // selected
  | 'fits_budget'
  | 'near_free'
  | 'niggle_targeted'
  | 'niggle_downweighted'
  | 'trimmed_to_budget'
  // rejected
  | 'budget_exhausted'
  | 'readiness_veto'
  | 'back_to_back_hard'
  | 'niggle_contraindicated'
  | 'niggle_escalated'
  | 'concurrent_next_day'
  | 'concurrent_same_day'
  | 'not_before_long_run'
  | 'static_stretch_pre_quality'
  | 'calibration_unproven'
  | 'requires_freshness'
  | 'preference_excluded'

export interface AllocationDecision {
  itemId: string
  name: string
  modality: Modality
  outcome: 'selected' | 'trimmed' | 'rejected'
  code: AllocationReasonCode
  reason: string
}

export type AllocationFlagCode =
  | 'calibrating'
  | 'niggle_active'
  | 'escalate_to_professional'
  | 'run_before_lift'
  | 'under_floor'
  | 'acwr_over_band'

export interface AllocationFlag {
  code: AllocationFlagCode
  message: string
}

export interface AllocatedSession {
  blocks: SessionBlock[]
  plannedLoad: number
  plannedDurationMin: number
  budget: LoadBudget
  /** How much of `plannedLoad` rode in on §9's near-free allowance, not the budget. */
  nearFreeLoad: number
  decisions: AllocationDecision[]
  flags: AllocationFlag[]
  /** True when anything hard landed — tomorrow's allocator reads this (§10). */
  hardDay: boolean
}

// ── Rules ─────────────────────────────────────────────────────────────────────

const BLOCK_ORDER: BlockKind[] = ['warmup', 'main', 'accessory', 'cooldown']
const BLOCK_LABEL: Record<BlockKind, string> = {
  warmup: 'Warmup',
  main: 'Main',
  accessory: 'Accessory',
  cooldown: 'Cooldown',
}

const PRIORITY_RANK: Record<Priority, number> = { A: 0, B: 1, C: 2 }
const ANCHOR_RANK: Record<AnchorSource, number> = { estimate: 0, observed: 1, confirmed: 2 }

/** Runs that a heavy lifting day has to stay clear of (§8). */
const QUALITY_RUN_TYPES = new Set([
  'long', 'vo2', 'tempo', 'threshold', 'intervals', 'race', 'hills', 'progression',
])

/** Severity at or above this means nothing loads that tissue today (§9). */
const NIGGLE_BLOCK_SEVERITY = 7
/** Between this and the block threshold, only easy work on that tissue. */
const NIGGLE_CAUTION_SEVERITY = 4
/** Past this many days it is a referral, not a training problem (§15). */
const NIGGLE_ESCALATION_DAYS = 14
/** Amber tolerates moderate work, not the hardest session on the menu (§7). */
const AMBER_HARDNESS_CEILING = 8

function demote(priority: Priority): Priority {
  return priority === 'A' ? 'B' : 'C'
}

function overlaps(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b) return false
  return a.some((x) => b.includes(x))
}

function isQualityRun(runType: string | null | undefined): boolean {
  return runType != null && QUALITY_RUN_TYPES.has(runType)
}

/** Did yesterday end up hard? The one input the back-to-back rule needs (§10). */
function wasYesterdayHard(today: Date, recentDays: DayLoadRecord[] | undefined): boolean {
  if (!recentDays || recentDays.length === 0) return false
  const startOfToday = new Date(today).setHours(0, 0, 0, 0)
  const yesterday = startOfToday - 86_400_000
  return recentDays.some(
    (d) => new Date(d.date).setHours(0, 0, 0, 0) === yesterday && d.hard,
  )
}

// ── Evaluation ────────────────────────────────────────────────────────────────

interface Evaluation {
  candidate: CandidateItem
  index: number
  priority: Priority
  /** Set when a rule has already decided why this is in, before budgeting. */
  selectHint?: { code: AllocationReasonCode; reason: string }
  rejection?: { code: AllocationReasonCode; reason: string }
}

/**
 * The gauntlet. First rejection wins, and the order is deliberate: the rules
 * that protect tissue run before the ones that protect the plan.
 */
function screen(
  evaluation: Evaluation,
  input: AllocatorInput,
  ctx: { yesterdayHard: boolean; aRunToday: boolean },
): void {
  const { candidate } = evaluation
  const c = candidate.constraints ?? {}
  const name = candidate.item.ref.name

  // Explicit preferences are hard constraints (§13).
  for (const pref of input.preferences ?? []) {
    const matches =
      (pref.match.modality !== undefined && pref.match.modality === candidate.modality) ||
      (pref.match.itemIds?.includes(candidate.item.id) ?? false)
    if (!matches) continue
    if (pref.effect === 'exclude') {
      evaluation.rejection = {
        code: 'preference_excluded',
        reason: `Your rule "${pref.label}" rules this out.`,
      }
      return
    }
    evaluation.priority = demote(evaluation.priority)
  }

  // Niggles (§9, §15).
  for (const niggle of input.niggles ?? []) {
    const loadsTissue = overlaps(c.tissues, niggle.tissues)
    const treatsTissue = overlaps(c.treats, niggle.tissues)

    if (treatsTissue) {
      evaluation.priority = 'A'
      evaluation.selectHint = {
        code: 'niggle_targeted',
        reason: `Targets the ${niggle.bodyRegion} you flagged at ${niggle.severity}/10.`,
      }
      continue
    }
    if (!loadsTissue) continue

    if ((niggle.daysActive ?? 0) >= NIGGLE_ESCALATION_DAYS) {
      evaluation.rejection = {
        code: 'niggle_escalated',
        reason:
          `${name} loads a ${niggle.bodyRegion} that has been sore for ` +
          `${niggle.daysActive} days — nothing goes into that area until someone qualified looks at it.`,
      }
      return
    }
    if (niggle.severity >= NIGGLE_BLOCK_SEVERITY) {
      evaluation.rejection = {
        code: 'niggle_contraindicated',
        reason: `${name} loads the ${niggle.bodyRegion} you flagged at ${niggle.severity}/10.`,
      }
      return
    }
    if (niggle.severity >= NIGGLE_CAUTION_SEVERITY) {
      if (candidate.cost.hardness >= HARD_DAY_SRPE || c.heavyLowerBody) {
        evaluation.rejection = {
          code: 'niggle_contraindicated',
          reason:
            `${name} is hard work on a ${niggle.bodyRegion} sitting at ${niggle.severity}/10 — ` +
            `easy work on it is fine, this is not.`,
        }
        return
      }
    }
    evaluation.priority = demote(evaluation.priority)
    evaluation.selectHint ??= {
      code: 'niggle_downweighted',
      reason: `Kept, but down-weighted — the ${niggle.bodyRegion} is at ${niggle.severity}/10.`,
    }
  }

  // Calibration ramp caps (§5b): unproven anchors gate the work that depends
  // on them. Conservative when uncertain, by design.
  if (c.minAnchorConfidence && ANCHOR_RANK[input.anchorConfidence] < ANCHOR_RANK[c.minAnchorConfidence]) {
    evaluation.rejection = {
      code: 'calibration_unproven',
      reason:
        `${name} needs a ${c.minAnchorConfidence} anchor and yours is still an ` +
        `${input.anchorConfidence} — prescribing it now would be guessing.`,
    }
    return
  }

  if (c.requiresFresh && input.band !== 'green') {
    evaluation.rejection = {
      code: 'requires_freshness',
      reason: `${name} is only worth doing fresh, and today is ${input.band}.`,
    }
    return
  }

  // Readiness veto (§7).
  if (input.band === 'red' && candidate.cost.hardness >= HARD_DAY_SRPE) {
    evaluation.rejection = {
      code: 'readiness_veto',
      reason: `Red day — nothing at sRPE ${candidate.cost.hardness} goes ahead.`,
    }
    return
  }
  if (input.band === 'amber' && candidate.cost.hardness >= AMBER_HARDNESS_CEILING) {
    evaluation.rejection = {
      code: 'readiness_veto',
      reason: `Amber day — sRPE ${candidate.cost.hardness} is past what today can absorb.`,
    }
    return
  }

  // Never two hard days back-to-back (§10).
  if (ctx.yesterdayHard && candidate.cost.hardness >= HARD_DAY_SRPE) {
    evaluation.rejection = {
      code: 'back_to_back_hard',
      reason: `Yesterday was hard — stacking ${name} on top of it is how weeks fall apart.`,
    }
    return
  }

  // Concurrent training (§8).
  const tomorrowQuality =
    input.tomorrow != null &&
    (input.tomorrow.isQuality === true || isQualityRun(input.tomorrow.runType))

  if (c.heavyLowerBody && tomorrowQuality) {
    evaluation.rejection = {
      code: 'concurrent_next_day',
      reason: `A ${input.tomorrow?.runType ?? 'quality'} run is tomorrow — heavy legs today would land on tired ones.`,
    }
    return
  }
  if (c.heavyLowerBody && ctx.aRunToday) {
    evaluation.rejection = {
      code: 'concurrent_same_day',
      reason: `This is the week's A-run day — the heaviest lift stays away from it.`,
    }
    return
  }
  if (c.notBeforeLongRun && input.tomorrow?.runType === 'long') {
    evaluation.rejection = {
      code: 'not_before_long_run',
      reason: `${name} is not something to do the day before a long run.`,
    }
    return
  }

  // Static stretching before quality work costs power (§9).
  if (c.excludeFromWarmupBeforeQuality && candidate.placement === 'warmup' && input.intent.isQualityDay) {
    evaluation.rejection = {
      code: 'static_stretch_pre_quality',
      reason: `Static holds before quality work blunt it — this belongs in the cooldown.`,
    }
    return
  }
}

// ── The near-free allowance (§9) ──────────────────────────────────────────────

/**
 * Hand out §9's "small dose" exemption, most deserving first.
 *
 * Which cheap items ride free before the allowance runs out is a real decision
 * now that it is bounded, so it is made here instead of falling out of the
 * budgeting loop's iteration order. Prehab that treats a logged niggle goes
 * first: §9 has the coach *insert* the targeted protocol for a sore Achilles,
 * and a day where a routine mobility drill spent the allowance those heel drops
 * needed has the priority exactly backwards. Everything else keeps the ordinary
 * ranking — what the plan wants most, then block order, then the order the
 * engines offered — which `survivors` is already sorted by, and which a stable
 * sort on the treatment key alone preserves.
 *
 * Greedy, not optimal: an item that would overrun the allowance is skipped and
 * the next one still gets its chance. A cheaper drill filling the last few
 * points is the right answer for a rule whose whole purpose is to fit small
 * things in.
 */
function grantNearFree(survivors: Evaluation[]): Set<string> {
  const exempt = new Set<string>()
  const queue = survivors
    .filter((e) => isNearFree(e.candidate))
    .sort((a, b) => nearFreeRank(a) - nearFreeRank(b))

  let allowanceSpent = 0
  for (const evaluation of queue) {
    const { load } = evaluation.candidate.cost
    if (allowanceSpent + load > NEAR_FREE_ALLOWANCE) continue
    allowanceSpent += load
    exempt.add(evaluation.candidate.item.id)
  }
  return exempt
}

/** Targeted prehab outranks everything else for the exemption, and only that. */
function nearFreeRank(evaluation: Evaluation): number {
  return evaluation.selectHint?.code === 'niggle_targeted' ? 0 : 1
}

/**
 * Cheap is not the same as near-free.
 *
 * §9 names what the exemption is for: routine prehab — calf raises, single-leg
 * balance, glute-med, Nordics — and the mobility either side of a session. It
 * doses plyometrics in *contacts* and ramps them with ACWR in the same
 * paragraph, because a plyo session is short on the clock and expensive on
 * tendon and CNS. A 30-contact tier-2 dose prices at ~27 load, under the
 * per-item line, and on the dev DB two of them took 44 of the 60 allowance while
 * every prehab drill was rejected for want of budget — §9 exactly backwards. So
 * the gate is the modality §9 calls near-free, not the price alone; cheap work
 * in any other modality is simply cheap and pays its way.
 *
 * The engine's own tag is what decides, which is the right seam: a Nordic the
 * prehab engine offers as a drill is near-free, and the same movement offered by
 * the strength engine as an accessory lift pays like the lift it was prescribed
 * as. The engine prices its work and names it; the allocator takes it at its
 * word.
 */
function isNearFree(candidate: CandidateItem): boolean {
  if (candidate.cost.load > NEAR_FREE_LOAD) return false
  return candidate.modality === 'prehab' || candidate.modality === 'stretch'
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Spend today's budget. Returns an ordered Session plus a decision for every
 * candidate it was offered, each carrying a machine-readable code — the Claude
 * layer turns those into prose, it does not get to overrule them (§10).
 */
export function allocateSession(input: AllocatorInput): AllocatedSession {
  const flags: AllocationFlag[] = []
  const yesterdayHard = wasYesterdayHard(input.date, input.recentDays)
  const aRunToday = input.intent.isQualityDay && input.intent.priority === 'A'

  if (input.calibrating) {
    flags.push({
      code: 'calibrating',
      message: 'Still learning your numbers — today is deliberately on the conservative side.',
    })
  }
  if (input.budget.acwr > input.budget.acwrCap) {
    flags.push({
      code: 'acwr_over_band',
      message: `ACWR is ${input.budget.acwr.toFixed(2)} against a ${input.budget.acwrCap.toFixed(2)} cap — the week is already ahead of itself.`,
    })
  }

  const niggles = input.niggles ?? []
  if (niggles.length > 0) {
    flags.push({
      code: 'niggle_active',
      message: niggles
        .map((n) => `${n.bodyRegion} at ${n.severity}/10`)
        .join('; ') + ' — load on those tissues is capped.',
    })
  }
  for (const n of niggles) {
    if ((n.daysActive ?? 0) >= NIGGLE_ESCALATION_DAYS) {
      flags.push({
        code: 'escalate_to_professional',
        message:
          `Your ${n.bodyRegion} has been sore for ${n.daysActive} days. That is past the point ` +
          `where training advice helps — see a professional. Nothing is being prescribed into it.`,
      })
    }
  }

  // 1. Screen every candidate against the rails.
  const evaluations: Evaluation[] = input.candidates.map((candidate, index) => ({
    candidate,
    index,
    priority: candidate.priority,
  }))
  for (const evaluation of evaluations) {
    screen(evaluation, input, { yesterdayHard, aRunToday })
  }

  // 2. Spend the budget on the survivors, most wanted first.
  const survivors = evaluations
    .filter((e) => !e.rejection)
    .sort((a, b) => {
      const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      if (byPriority !== 0) return byPriority
      const byBlock = BLOCK_ORDER.indexOf(a.candidate.placement) - BLOCK_ORDER.indexOf(b.candidate.placement)
      if (byBlock !== 0) return byBlock
      return a.index - b.index
    })

  // §9's exemption is bounded and therefore rationed — decided up front, in a
  // deliberate order, before a single point of budget is spent.
  const nearFree = grantNearFree(survivors)

  const decisions = new Map<string, AllocationDecision>()
  const selected: Array<{ evaluation: Evaluation; item: SessionItem; load: number; durationMin: number; hardness: number }> = []
  let spent = 0
  /** What the near-free exemption has handed out so far (§9's "small dose"). */
  let nearFreeSpent = 0

  for (const evaluation of survivors) {
    const { candidate } = evaluation
    const { cost } = candidate
    const name = candidate.item.ref.name

    const take = (
      item: SessionItem,
      load: number,
      durationMin: number,
      code: AllocationReasonCode,
      reason: string,
      outcome: AllocationDecision['outcome'] = 'selected',
    ) => {
      selected.push({ evaluation, item, load, durationMin, hardness: cost.hardness })
      spent += load
      decisions.set(candidate.item.id, {
        itemId: candidate.item.id,
        name,
        modality: candidate.modality,
        outcome,
        code,
        reason,
      })
    }

    // Routine prehab and mobility are near-free and always affordable (§9) —
    // up to a small dose, and no further. The per-item price rule alone has no
    // aggregate ceiling, so any number of sub-40 drills ride free and the day
    // quietly costs twice what the budget allowed. Past the allowance a
    // near-free candidate is just a cheap candidate: it competes for the
    // ordinary budget below like everything else.
    if (nearFree.has(candidate.item.id)) {
      const hint = evaluation.selectHint
      nearFreeSpent += cost.load
      take(
        candidate.item,
        cost.load,
        cost.durationMin,
        hint?.code ?? 'near_free',
        hint?.reason ?? `Costs almost nothing (${Math.round(cost.load)} load) and pays for itself.`,
      )
      continue
    }

    if (spent + cost.load <= input.budget.ceiling) {
      const hint = evaluation.selectHint
      take(
        candidate.item,
        cost.load,
        cost.durationMin,
        hint?.code ?? 'fits_budget',
        hint?.reason ??
          `Fits: ${Math.round(cost.load)} of the ${Math.round(input.budget.ceiling)} today allows.`,
      )
      continue
    }

    // An A-priority session is the point of the day. Trim it before dropping it.
    const remaining = input.budget.ceiling - spent
    if (evaluation.priority === 'A' && candidate.constraints?.trimmable !== false && remaining > 0) {
      const factor = remaining / cost.load
      const trimmed = scaleItem(candidate.item, factor)
      if (trimmed) {
        take(
          trimmed,
          cost.load * factor,
          cost.durationMin * factor,
          'trimmed_to_budget',
          `Cut to about ${Math.round(factor * 100)}% — the budget has ${Math.round(remaining)} left, not ${Math.round(cost.load)}.`,
          'trimmed',
        )
        continue
      }
    }

    decisions.set(candidate.item.id, {
      itemId: candidate.item.id,
      name,
      modality: candidate.modality,
      outcome: 'rejected',
      code: 'budget_exhausted',
      reason: `No budget left — ${Math.round(spent)} of ${Math.round(input.budget.ceiling)} already spent.`,
    })
  }

  for (const evaluation of evaluations) {
    if (!evaluation.rejection) continue
    decisions.set(evaluation.candidate.item.id, {
      itemId: evaluation.candidate.item.id,
      name: evaluation.candidate.item.ref.name,
      modality: evaluation.candidate.modality,
      outcome: 'rejected',
      code: evaluation.rejection.code,
      reason: evaluation.rejection.reason,
    })
  }

  // 3. Order the day. Run before lift when they share it (§8).
  const sharesDayWithQualityRun =
    selected.some((s) => s.evaluation.candidate.modality === 'run' && s.hardness >= 6) &&
    selected.some((s) => s.evaluation.candidate.constraints?.heavyLowerBody)

  if (sharesDayWithQualityRun) {
    flags.push({
      code: 'run_before_lift',
      message: 'Run first, or separate the two by at least six hours — the run is the session that matters today.',
    })
  }

  const blocks: SessionBlock[] = []
  for (const kind of BLOCK_ORDER) {
    const inBlock = selected.filter((s) => s.evaluation.candidate.placement === kind)
    if (inBlock.length === 0) continue

    const ordered = [...inBlock].sort((a, b) => {
      if (sharesDayWithQualityRun) {
        const aRun = a.evaluation.candidate.modality === 'run' ? 0 : 1
        const bRun = b.evaluation.candidate.modality === 'run' ? 0 : 1
        if (aRun !== bRun) return aRun - bRun
      }
      const byPriority = PRIORITY_RANK[a.evaluation.priority] - PRIORITY_RANK[b.evaluation.priority]
      if (byPriority !== 0) return byPriority
      return a.evaluation.index - b.evaluation.index
    })

    blocks.push({
      id: `block-${kind}`,
      kind,
      label: BLOCK_LABEL[kind],
      items: ordered.map((s) => s.item),
    })
  }

  const plannedLoad = selected.reduce((sum, s) => sum + s.load, 0)
  const plannedDurationMin = selected.reduce((sum, s) => sum + s.durationMin, 0)
  const hardDay = selected.some((s) => s.hardness >= HARD_DAY_SRPE)

  // The band cuts both ways (§21): a green day that lands under the floor is
  // fitness quietly leaking away, and it gets said out loud.
  if (input.band !== 'red' && input.budget.floor > 0 && plannedLoad < input.budget.floor) {
    flags.push({
      code: 'under_floor',
      message:
        `Today comes to ${Math.round(plannedLoad)} against a floor of ${Math.round(input.budget.floor)}. ` +
        `Nothing is wrong — but this is a light week getting lighter.`,
    })
  }

  return {
    blocks,
    plannedLoad: Math.round(plannedLoad * 10) / 10,
    plannedDurationMin: Math.round(plannedDurationMin * 10) / 10,
    budget: input.budget,
    nearFreeLoad: Math.round(nearFreeSpent * 10) / 10,
    decisions: input.candidates.map((c) => decisions.get(c.item.id)!).filter(Boolean),
    flags,
    hardDay,
  }
}
