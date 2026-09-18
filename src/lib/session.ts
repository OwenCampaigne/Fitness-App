// ── The session edit funnel ───────────────────────────────────────────────────
// Framework §11, the centre of the product. Two actors change the workout — the
// athlete tapping a card and the coach reading a sentence — and both of them go
// through here. One canonical object, one validator, one diff, one version
// counter, one undo.
//
// The contract, literally:
//   · every edit is a reviewable diff
//   · versioned and reversible
//   · the identical validator for both actors
//   · a rule-breaking change is never silently dropped — it is applied with a
//     flag, or pushed back with a safer counter-proposal
//
// And it pushes *up* as well as down. §21's Contrarian: an editor where "make
// it easier" is one tap away erodes your 80/20 unless something notices you
// only ever tap it on the hard days.

import {
  HARD_DAY_SRPE,
  WEEKLY_RAMP_CAP,
  CALIBRATION_RAMP_CAP,
  estimateItemCost,
  scaleItem,
  sessionCost,
} from './load'
import type { LoadBudget, LoadCost } from './load'
import type { Modality, Niggle, DayPlanLike } from './allocator'
import type { ReadinessBand } from '../types/readiness'
import type {
  ApplyResult,
  EditableSession,
  ParamsPatch,
  PatchOp,
  RuleFinding,
  SessionDiff,
  SessionDiffEntry,
  SessionPatch,
  ValidationVerdict,
} from '../types/patch'
import type { BlockKind, ItemParams, SessionBlock, SessionItem } from '../types/session'

// ── Context ───────────────────────────────────────────────────────────────────

/**
 * What an item is made of, as far as the safety rules care.
 *
 * A `SessionItem` deliberately carries no clinical tags — it references a
 * library entry and the library is the wiring agent's problem. So the funnel
 * asks. Supply `factsOf` and the niggle and concurrent-training rules bite;
 * leave it out and they stay quiet rather than guessing.
 */
export interface ItemFacts {
  tissues?: string[]
  heavyLowerBody?: boolean
  modality?: Modality
}

/** Quality work asked for versus quality work edited away (§21). */
export interface QualityHistory {
  prescribed: number
  dodged: number
  windowDays: number
}

export interface ValidationContext {
  budget: LoadBudget
  band: ReadinessBand
  calibrating: boolean
  niggles?: Niggle[]
  tomorrow?: DayPlanLike | null
  /** Did yesterday end up hard? The back-to-back rule's only input (§10). */
  yesterdayHard?: boolean
  qualityHistory?: QualityHistory
  factsOf?: (item: SessionItem) => ItemFacts
  /** Engine-supplied pricing wins over the estimate when the caller has it. */
  costOf?: (item: SessionItem) => LoadCost
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BLOCK_ORDER: BlockKind[] = ['warmup', 'main', 'accessory', 'cooldown']
const BLOCK_LABEL: Record<BlockKind, string> = {
  warmup: 'Warmup',
  main: 'Main',
  accessory: 'Accessory',
  cooldown: 'Cooldown',
}

/** Over the ceiling by less than this is a flag; more is a push-back. */
const CEILING_FLAG_TOLERANCE = 0.15
/** Counter-proposals aim just under the ceiling, not exactly at it. */
const COUNTER_MARGIN = 0.95
/** A hard session cut by more than this much has been dodged, not adjusted. */
const DODGE_DROP = 0.3
/** What a counter-proposal offers instead of deleting the quality work. */
const QUALITY_SOFTEN_FACTOR = 0.6
/** Below this many prescribed quality sessions there is no pattern to see. */
const DODGE_MIN_SAMPLE = 3
const DODGE_RATE = 0.5
/** Severity at which a tissue is protected from any override (§15). */
const NIGGLE_BLOCK_SEVERITY = 7

const QUALITY_RUN_TYPES = new Set([
  'long', 'vo2', 'tempo', 'threshold', 'intervals', 'race', 'hills', 'progression',
])

// ── Rendering a prescription ──────────────────────────────────────────────────

/** The diff is only reviewable if a person can read it (§11). */
export function describeParams(params: ItemParams): string {
  if (params.kind === 'strength') {
    const load = params.weightKg === null ? 'bodyweight' : `@ ${params.weightKg} kg`
    return `${params.sets}×${params.reps} ${load}, RIR ${params.targetRir}`
  }
  if (params.kind === 'run') {
    const parts: string[] = [params.runType]
    if (params.durationMin != null) parts.push(`${params.durationMin} min`)
    if (params.distanceKm != null) parts.push(`${params.distanceKm} km`)
    if (params.intervals?.length) {
      parts.push(
        params.intervals
          .map((i) => `${i.repeat}×${i.workSec}s/${i.recoverSec}s`)
          .join(' + '),
      )
    }
    if (params.targetHrLow != null && params.targetHrHigh != null) {
      parts.push(`HR ${params.targetHrLow}–${params.targetHrHigh}`)
    }
    return parts.join(', ')
  }
  if (params.kind === 'contacts') {
    return `${params.sets}×${params.contactsPerSet} contacts`
  }
  const parts = [`${params.sets}×${params.reps ?? 1}`]
  if (params.holdSec != null) parts.push(`${params.holdSec} s hold`)
  if (params.perSide) parts.push('per side')
  return parts.join(', ')
}

// ── Applying the ops ──────────────────────────────────────────────────────────

interface Touch {
  op: PatchOp
  itemId: string
  name: string
  blockKind: BlockKind | null
  before: SessionItem | null
  after: SessionItem | null
}

interface ApplyOutcome {
  blocks: SessionBlock[]
  structural: RuleFinding[]
  touches: Touch[]
  inverseOps: PatchOp[]
}

function clone(blocks: SessionBlock[]): SessionBlock[] {
  return JSON.parse(JSON.stringify(blocks)) as SessionBlock[]
}

function findItem(blocks: SessionBlock[], itemId: string) {
  for (const block of blocks) {
    const index = block.items.findIndex((i) => i.id === itemId)
    if (index >= 0) return { block, index, item: block.items[index] }
  }
  return null
}

/** Blocks come back in canonical order, and an emptied block disappears. */
function normalize(blocks: SessionBlock[]): SessionBlock[] {
  return blocks
    .filter((b) => b.items.length > 0)
    .sort((a, b) => BLOCK_ORDER.indexOf(a.kind) - BLOCK_ORDER.indexOf(b.kind))
}

/**
 * Run the ops against a copy. Structural problems are collected rather than
 * thrown — a patch that half-applies is exactly the silent data loss §11
 * forbids, so nothing is committed until the verdict says so.
 */
function applyOps(original: SessionBlock[], ops: PatchOp[]): ApplyOutcome {
  const blocks = clone(original)
  const structural: RuleFinding[] = []
  const touches: Touch[] = []
  const inverseOps: PatchOp[] = []

  for (const op of ops) {
    if (op.op === 'reorder') {
      const block = blocks.find((b) => b.kind === op.blockKind)
      if (!block) {
        structural.push({
          rule: 'unknown_block',
          severity: 'block',
          hardFloor: true,
          message: `There is no ${op.blockKind} block in this session to reorder.`,
        })
        continue
      }
      const existing = block.items.map((i) => i.id)
      const sameSet =
        existing.length === op.itemIds.length && existing.every((id) => op.itemIds.includes(id))
      if (!sameSet) {
        structural.push({
          rule: 'reorder_mismatch',
          severity: 'block',
          hardFloor: true,
          message: `That reorder does not list the same items the ${op.blockKind} block holds — reordering must not add or drop anything.`,
        })
        continue
      }
      inverseOps.unshift({
        op: 'reorder',
        blockKind: op.blockKind,
        itemIds: existing,
        reason: `Undo: ${op.reason}`,
      })
      block.items = op.itemIds.map((id) => block.items.find((i) => i.id === id)!)
      touches.push({
        op,
        itemId: block.id,
        name: BLOCK_LABEL[op.blockKind],
        blockKind: op.blockKind,
        before: null,
        after: null,
      })
      continue
    }

    if (op.op === 'add') {
      let block = blocks.find((b) => b.kind === op.blockKind)
      if (!block) {
        block = {
          id: `block-${op.blockKind}`,
          kind: op.blockKind,
          label: BLOCK_LABEL[op.blockKind],
          items: [],
        }
        blocks.push(block)
      }
      const index = op.index ?? block.items.length
      block.items.splice(index, 0, op.item)
      inverseOps.unshift({ op: 'remove', itemId: op.item.id, reason: `Undo: ${op.reason}` })
      touches.push({
        op,
        itemId: op.item.id,
        name: op.item.ref.name,
        blockKind: op.blockKind,
        before: null,
        after: op.item,
      })
      continue
    }

    const found = findItem(blocks, op.itemId)
    if (!found) {
      structural.push({
        rule: 'unknown_item',
        severity: 'block',
        hardFloor: true,
        itemId: op.itemId,
        message: `No item "${op.itemId}" in this session — refusing rather than guessing which one you meant.`,
      })
      continue
    }

    if (op.op === 'remove') {
      const { block, index, item } = found
      block.items.splice(index, 1)
      inverseOps.unshift({
        op: 'add',
        blockKind: block.kind,
        item,
        index,
        reason: `Undo: ${op.reason}`,
      })
      touches.push({
        op,
        itemId: item.id,
        name: item.ref.name,
        blockKind: block.kind,
        before: item,
        after: null,
      })
      continue
    }

    if (op.op === 'replace') {
      const { block, index, item } = found
      block.items[index] = op.item
      inverseOps.unshift({ op: 'replace', itemId: op.item.id, item, reason: `Undo: ${op.reason}` })
      touches.push({
        op,
        itemId: item.id,
        name: op.item.ref.name,
        blockKind: block.kind,
        before: item,
        after: op.item,
      })
      continue
    }

    // modify
    const { block, index, item } = found
    const incoming = op.params as Record<string, unknown> | undefined
    if (incoming && 'kind' in incoming && incoming.kind !== item.params.kind) {
      structural.push({
        rule: 'kind_change',
        severity: 'block',
        hardFloor: true,
        itemId: item.id,
        message: `A ${item.params.kind} item cannot be modified into a ${String(incoming.kind)} one — that is a swap, not an edit.`,
      })
      continue
    }

    const params = { ...item.params, ...(incoming ?? {}), kind: item.params.kind } as ItemParams
    const updated: SessionItem = {
      ...item,
      params,
      why: op.why ?? item.why,
      // An edit marks the card, unless the op says otherwise — which is how the
      // inverse restores the original status on undo.
      status: op.status ?? (item.status === 'prescribed' ? 'edited' : item.status),
    }
    block.items[index] = updated

    const restored: Record<string, unknown> = {}
    for (const key of Object.keys(incoming ?? {})) {
      restored[key] = (item.params as unknown as Record<string, unknown>)[key]
    }
    inverseOps.unshift({
      op: 'modify',
      itemId: item.id,
      params: restored as ParamsPatch,
      why: item.why,
      status: item.status,
      reason: `Undo: ${op.reason}`,
    })

    touches.push({
      op,
      itemId: item.id,
      name: item.ref.name,
      blockKind: block.kind,
      before: item,
      after: updated,
    })
  }

  return { blocks: normalize(blocks), structural, touches, inverseOps }
}

// ── The rules ─────────────────────────────────────────────────────────────────

function isQualityRun(runType: string | null | undefined): boolean {
  return runType != null && QUALITY_RUN_TYPES.has(runType)
}

interface RuleOutput {
  findings: RuleFinding[]
  /** Ops the validator would rather see softened, or not made at all. */
  offending: Set<number>
  softenFactor?: number
  dodgedTouch?: Touch
}

function runRules(
  originalBlocks: SessionBlock[],
  proposedBlocks: SessionBlock[],
  touches: Touch[],
  patch: SessionPatch,
  context: ValidationContext,
): RuleOutput {
  const costOf = context.costOf ?? ((item: SessionItem) => estimateItemCost(item))
  const factsOf = context.factsOf ?? (() => ({} as ItemFacts))
  const findings: RuleFinding[] = []
  const offending = new Set<number>()
  let softenFactor: number | undefined
  let dodgedTouch: Touch | undefined

  const before = sessionCost(originalBlocks, costOf)
  const after = sessionCost(proposedBlocks, costOf)
  const opIndex = (touch: Touch) => patch.ops.indexOf(touch.op)

  // 1. The load ceiling (§3, §11).
  //
  // An edit that makes an over-budget day *smaller* is never refused for being
  // over budget. A session can legitimately start above its ceiling — §9's
  // near-free prehab allowance is exactly that, and the budget is recomputed
  // through the day as the week's loads land — and answering "too much load" to
  // the one edit that is taking load off would leave today heavier than
  // refusing nothing. The overshoot is still reported; it just does not block.
  const ceiling = context.budget.ceiling
  const reducesLoad = after.load < before.load
  if (after.load > ceiling) {
    const over = ceiling > 0 ? (after.load - ceiling) / ceiling : Infinity
    const message =
      ceiling <= 0
        ? `Today's budget is zero — nothing goes in until the load comes back down.`
        : `This puts today at ${Math.round(after.load)} against a ceiling of ${Math.round(ceiling)} ` +
          `(${Math.round(over * 100)}% over).`
    if (over > CEILING_FLAG_TOLERANCE && !reducesLoad) {
      findings.push({ rule: 'load_ceiling', severity: 'block', message })
      softenFactor = after.load > 0 ? (ceiling * COUNTER_MARGIN) / after.load : 0
      for (const touch of touches) {
        if (touch.after) offending.add(opIndex(touch))
      }
    } else {
      findings.push({
        rule: 'load_ceiling',
        severity: 'flag',
        message: reducesLoad
          ? `${message} Let through: this edit takes ${Math.round(before.load - after.load)} off ` +
            `the day, and refusing it would only leave today bigger.`
          : `${message} Close enough to let through — logged so the week knows.`,
      })
    }
  }

  // 2. Never two hard days back-to-back (§10). Only when *this* patch is what
  //    created the stack — an unrelated edit on an already-hard day is not the
  //    validator's business.
  if (context.yesterdayHard && after.hardness >= HARD_DAY_SRPE && before.hardness < HARD_DAY_SRPE) {
    findings.push({
      rule: 'back_to_back_hard',
      severity: 'block',
      message:
        `Yesterday was hard and this makes today hard too. Two hard days back-to-back is ` +
        `how good weeks turn into bad fortnights — here is a safer version.`,
    })
    for (const touch of touches) {
      if (touch.after && costOf(touch.after).hardness >= HARD_DAY_SRPE) offending.add(opIndex(touch))
    }
  }

  // 3. Niggles (§9). A painful tissue is a safety floor, not a preference —
  //    §15's bounded autonomy runs in this direction too.
  for (const touch of touches) {
    if (!touch.after) continue
    const tissues = factsOf(touch.after).tissues ?? []
    if (tissues.length === 0) continue
    for (const niggle of context.niggles ?? []) {
      if (!tissues.some((t) => niggle.tissues.includes(t))) continue
      const hardFloor = niggle.severity >= NIGGLE_BLOCK_SEVERITY
      if (!hardFloor) continue
      findings.push({
        rule: 'niggle_contraindicated',
        severity: 'block',
        hardFloor: true,
        itemId: touch.itemId,
        message:
          `${touch.name} loads the ${niggle.bodyRegion} you logged at ${niggle.severity}/10. ` +
          `That one is not an override — give it a few days and let the prehab work.`,
      })
      offending.add(opIndex(touch))
    }
  }

  // 4. Concurrent training (§8).
  const tomorrowQuality =
    context.tomorrow != null &&
    (context.tomorrow.isQuality === true || isQualityRun(context.tomorrow.runType))
  if (tomorrowQuality) {
    for (const touch of touches) {
      if (!touch.after) continue
      if (!factsOf(touch.after).heavyLowerBody) continue
      findings.push({
        rule: 'concurrent_training',
        severity: 'block',
        itemId: touch.itemId,
        message:
          `A ${context.tomorrow?.runType ?? 'quality'} run is tomorrow. Heavy legs today means ` +
          `running it on tired ones, which costs the run more than the lift is worth.`,
      })
      offending.add(opIndex(touch))
    }
  }

  // 5. Calibration ramp caps (§5a, §5b). Working loads are where an over-eager
  //    jump actually hurts, so that is what this watches.
  const rampCap = context.calibrating ? CALIBRATION_RAMP_CAP : WEEKLY_RAMP_CAP
  for (const touch of touches) {
    if (!touch.before || !touch.after) continue
    if (touch.before.params.kind !== 'strength' || touch.after.params.kind !== 'strength') continue
    const was = touch.before.params.weightKg
    const now = touch.after.params.weightKg
    if (was === null || now === null || was <= 0 || now <= was) continue
    const jump = (now - was) / was
    if (jump <= rampCap) continue
    const message =
      `${touch.name} goes from ${was} kg to ${now} kg — a ${Math.round(jump * 100)}% jump against ` +
      `a ${Math.round(rampCap * 100)}% cap.`
    if (context.calibrating) {
      findings.push({
        rule: 'calibration_ramp_cap',
        severity: 'block',
        itemId: touch.itemId,
        message: `${message} Your numbers are still estimates, so the ramp stays tight (§5b).`,
      })
      offending.add(opIndex(touch))
    } else {
      findings.push({
        rule: 'calibration_ramp_cap',
        severity: 'flag',
        itemId: touch.itemId,
        message: `${message} Your call — but that is a fast climb.`,
      })
    }
  }

  // 6. Pushing up (§21). Every rule above protects you from doing too much.
  //    This one is the other half: it notices that "make it easier" only ever
  //    gets tapped on the days that were supposed to be hard.
  for (const touch of touches) {
    if (!touch.before) continue
    const beforeCost = costOf(touch.before)
    if (beforeCost.hardness < HARD_DAY_SRPE) continue
    const afterCost = touch.after ? costOf(touch.after) : null
    const dodged =
      afterCost === null ||
      afterCost.load < beforeCost.load * (1 - DODGE_DROP) ||
      afterCost.hardness < HARD_DAY_SRPE
    if (!dodged) continue

    const history = context.qualityHistory
    if (!history || history.prescribed < DODGE_MIN_SAMPLE) {
      findings.push({
        rule: 'quality_dodging',
        severity: 'info',
        itemId: touch.itemId,
        message: `${touch.name} was the hard work today. Noted — one skipped session is not a pattern.`,
      })
      continue
    }

    const rate = (history.dodged + 1) / Math.max(1, history.prescribed)
    if (rate < DODGE_RATE) {
      findings.push({
        rule: 'quality_dodging',
        severity: 'info',
        itemId: touch.itemId,
        message: `${touch.name} was today's quality work — skipped ${history.dodged} of ${history.prescribed} recently, which is still a fine record.`,
      })
      continue
    }

    findings.push({
      rule: 'quality_dodging',
      severity: 'flag',
      itemId: touch.itemId,
      message:
        `That is ${history.dodged + 1} of the last ${history.prescribed} quality sessions edited ` +
        `away. Easy days are meant to be easy so the hard ones can be hard — an 80/20 week with ` +
        `no 20 is just a slow week. A shorter version beats none of it.`,
    })
    dodgedTouch ??= touch
  }

  // 7. And the floor, for the record (§3).
  if (context.budget.floor > 0 && after.load < context.budget.floor && context.band !== 'red') {
    findings.push({
      rule: 'load_floor',
      severity: 'info',
      message: `Today now comes to ${Math.round(after.load)}, under the ${Math.round(context.budget.floor)} that holds the week steady.`,
    })
  }

  return { findings, offending, softenFactor, dodgedTouch }
}

// ── Counter-proposals ─────────────────────────────────────────────────────────

/**
 * The safer version. Never "no" on its own — §11 is explicit that a push-back
 * comes with something you can accept instead.
 */
function buildCounterProposal(
  patch: SessionPatch,
  rules: RuleOutput,
  originalBlocks: SessionBlock[],
): SessionPatch | undefined {
  // A dodge is answered with a smaller version of the work, not a refusal.
  if (rules.dodgedTouch && rules.dodgedTouch.before) {
    const touch = rules.dodgedTouch
    const softened = scaleItem(touch.before!, QUALITY_SOFTEN_FACTOR)
    if (softened) {
      const ops = patch.ops.map((op) =>
        op === touch.op
          ? ({
              op: 'modify' as const,
              itemId: touch.itemId,
              params: softened.params,
              reason: `Half the session beats none of it — ${touch.name} cut to ${Math.round(QUALITY_SOFTEN_FACTOR * 100)}%.`,
            })
          : op,
      )
      return { actor: 'engine', ops, source: patch.source }
    }
  }

  if (rules.offending.size === 0) return undefined

  const ops: PatchOp[] = []
  patch.ops.forEach((op, index) => {
    if (!rules.offending.has(index)) {
      ops.push(op)
      return
    }
    // Over budget: shrink it. Anything else: it is the change itself that is
    // unsafe, so the safer version is the session without it.
    if (rules.softenFactor !== undefined && rules.softenFactor > 0) {
      if (op.op === 'add') {
        const smaller = scaleItem(op.item, rules.softenFactor)
        if (smaller) {
          ops.push({ ...op, item: smaller, reason: `${op.reason} — trimmed to fit today's budget.` })
          return
        }
      }
      if (op.op === 'replace') {
        const smaller = scaleItem(op.item, rules.softenFactor)
        if (smaller) {
          ops.push({ ...op, item: smaller, reason: `${op.reason} — trimmed to fit today's budget.` })
          return
        }
      }
      if (op.op === 'modify') {
        const found = findItem(clone(originalBlocks), op.itemId)
        if (found) {
          const merged = {
            ...found.item.params,
            ...(op.params as Record<string, unknown>),
            kind: found.item.params.kind,
          } as ItemParams
          const smaller = scaleItem({ ...found.item, params: merged }, rules.softenFactor)
          if (smaller) {
            ops.push({
              ...op,
              params: smaller.params,
              reason: `${op.reason} — trimmed to fit today's budget.`,
            })
            return
          }
        }
      }
    }
    // Dropped: the safer version is simply not making this change.
  })

  return { actor: 'engine', ops, source: patch.source }
}

// ── The diff ──────────────────────────────────────────────────────────────────

function buildDiff(
  originalBlocks: SessionBlock[],
  proposedBlocks: SessionBlock[],
  touches: Touch[],
  costOf: (item: SessionItem) => LoadCost,
): SessionDiff {
  const entries: SessionDiffEntry[] = touches.map((touch) => ({
    op: touch.op.op,
    itemId: touch.itemId,
    name: touch.name,
    blockKind: touch.blockKind,
    before: touch.before ? describeParams(touch.before.params) : null,
    after: touch.after ? describeParams(touch.after.params) : null,
    reason: touch.op.reason,
  }))

  const loadBefore = Math.round(sessionCost(originalBlocks, costOf).load * 10) / 10
  const loadAfter = Math.round(sessionCost(proposedBlocks, costOf).load * 10) / 10

  const summary =
    entries.length === 0
      ? 'nothing to action'
      : `${entries.length} change${entries.length === 1 ? '' : 's'} · load ${Math.round(loadBefore)} → ${Math.round(loadAfter)}`

  return { entries, loadBefore, loadAfter, summary }
}

// ── Verdict ───────────────────────────────────────────────────────────────────

function buildVerdict(
  findings: RuleFinding[],
  patch: SessionPatch,
  counterProposal: SessionPatch | undefined,
): ValidationVerdict {
  const blocks = findings.filter((f) => f.severity === 'block')
  const flags = findings.filter((f) => f.severity === 'flag')

  if (blocks.length > 0) {
    const overridable = blocks.every((f) => !f.hardFloor)
    if (patch.override && overridable) {
      return {
        kind: 'applied_with_flag',
        message: `Applied because you asked for it. ${blocks[0].message}`,
        findings,
        counterProposal,
      }
    }
    return {
      kind: 'pushed_back',
      message: blocks[0].message,
      findings,
      counterProposal,
    }
  }

  if (flags.length > 0) {
    return {
      kind: 'applied_with_flag',
      message: flags[0].message,
      findings,
      counterProposal,
    }
  }

  return { kind: 'ok', message: 'Applied — nothing here breaks a rule.', findings }
}

// ── The two exports the whole app goes through ────────────────────────────────

/**
 * Check a patch without touching anything. The coach calls this to preview, the
 * UI calls it to grey out a button, and `applySessionPatch` calls it for real —
 * one validator, both actors (§11).
 */
export function validateSessionPatch(
  session: EditableSession,
  patch: SessionPatch,
  context: ValidationContext,
): ValidationVerdict {
  if (patch.ops.length === 0) {
    return { kind: 'ok', message: 'Nothing to action.', findings: [] }
  }

  const outcome = applyOps(session.blocks, patch.ops)
  if (outcome.structural.length > 0) {
    return {
      kind: 'pushed_back',
      message: outcome.structural[0].message,
      findings: outcome.structural,
    }
  }

  const rules = runRules(session.blocks, outcome.blocks, outcome.touches, patch, context)
  const counterProposal = buildCounterProposal(patch, rules, session.blocks)
  return buildVerdict(rules.findings, patch, counterProposal)
}

/**
 * The one funnel. Both the Today screen's edit bar and the coach's natural
 * language end up here; nothing else may write a session's blocks.
 *
 * Applies nothing on a push-back, returns the diff either way so the athlete
 * can see what was refused, and hands back an inverse patch so undo is a first
 * class operation rather than a re-render.
 */
export function applySessionPatch(
  session: EditableSession,
  patch: SessionPatch,
  context: ValidationContext,
): ApplyResult {
  const costOf = context.costOf ?? ((item: SessionItem) => estimateItemCost(item))

  if (patch.ops.length === 0) {
    return {
      applied: false,
      verdict: { kind: 'ok', message: 'Nothing to action.', findings: [] },
      session,
      diff: buildDiff(session.blocks, session.blocks, [], costOf),
      inverse: null,
    }
  }

  const outcome = applyOps(session.blocks, patch.ops)

  if (outcome.structural.length > 0) {
    return {
      applied: false,
      verdict: {
        kind: 'pushed_back',
        message: outcome.structural[0].message,
        findings: outcome.structural,
      },
      session,
      diff: buildDiff(session.blocks, session.blocks, outcome.touches, costOf),
      inverse: null,
    }
  }

  const rules = runRules(session.blocks, outcome.blocks, outcome.touches, patch, context)
  const counterProposal = buildCounterProposal(patch, rules, session.blocks)
  const verdict = buildVerdict(rules.findings, patch, counterProposal)
  const diff = buildDiff(session.blocks, outcome.blocks, outcome.touches, costOf)

  if (verdict.kind === 'pushed_back') {
    return { applied: false, verdict, session, diff, inverse: null }
  }

  return {
    applied: true,
    verdict,
    session: {
      ...session,
      version: session.version + 1,
      blocks: outcome.blocks,
      sourceOfLastEdit: patch.actor,
    },
    diff,
    inverse: { actor: patch.actor, ops: outcome.inverseOps, source: 'undo' },
  }
}
