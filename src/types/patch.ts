// ── The patch ─────────────────────────────────────────────────────────────────
// Framework §11. There are two ways to change a workout — you tap a card, or
// you tell the coach "make today easier" — and exactly one thing both of them
// produce: a structured patch. Generation and editing are the same operation
// (§10), so this shape is what the whole product turns on.
//
// Every op carries its own `reason`. That is not decoration: the reason is what
// the diff shows you, what `edit_history` stores, and what Phase 6 learns your
// preferences from (§13).

import type {
  BlockKind,
  ContactParams,
  EditActor,
  HoldParams,
  ItemStatus,
  RunParams,
  SessionBlock,
  SessionItem,
  SessionStatus,
  StrengthParams,
} from './session'

// ── The session as the edit funnel sees it ────────────────────────────────────
// `src/types/session.ts` owns the blocks. This adds only what an *edit* needs:
// the version it is editing and who touched it last. It mirrors the `session`
// table without importing Prisma, so the whole funnel stays pure.

export interface EditableSession {
  id?: number
  date?: Date
  status: SessionStatus
  version: number
  blocks: SessionBlock[]
  sourceOfLastEdit?: EditActor | null
}

// ── Ops ───────────────────────────────────────────────────────────────────────

export type PatchOpKind = 'remove' | 'replace' | 'modify' | 'reorder' | 'add'

/**
 * A partial params update. The `kind` is deliberately immutable — turning a run
 * into a lift is a `replace`, not a `modify`, and the validator says so rather
 * than quietly producing a half-run half-squat.
 */
export type ParamsPatch =
  | Partial<StrengthParams>
  | Partial<RunParams>
  | Partial<ContactParams>
  | Partial<HoldParams>

interface OpBase {
  /** Why. Shown in the diff, stored in edit_history, learned from later (§13). */
  reason: string
}

export interface RemoveOp extends OpBase {
  op: 'remove'
  itemId: string
}

/** Swap one item for another — "something gentler on my knee" (§11-A). */
export interface ReplaceOp extends OpBase {
  op: 'replace'
  itemId: string
  item: SessionItem
}

export interface ModifyOp extends OpBase {
  op: 'modify'
  itemId: string
  params?: ParamsPatch
  why?: string
  status?: ItemStatus
}

export interface ReorderOp extends OpBase {
  op: 'reorder'
  blockKind: BlockKind
  /** The block's items, in their new order. Must be exactly the same set. */
  itemIds: string[]
}

export interface AddOp extends OpBase {
  op: 'add'
  blockKind: BlockKind
  item: SessionItem
  /** Where in the block. Appended when omitted. */
  index?: number
}

export type PatchOp = RemoveOp | ReplaceOp | ModifyOp | ReorderOp | AddOp

export interface SessionPatch {
  actor: EditActor
  ops: PatchOp[]
  /** The sentence that produced it, when the coach wrote it (§11-A). */
  source?: string
  /**
   * Set after a push-back, when the athlete means it anyway. Bounded authority
   * cuts both ways: an override turns a judgement call into a flag, and the
   * deterministic safety floor still refuses (§10, §15).
   */
  override?: boolean
}

// ── The verdict ───────────────────────────────────────────────────────────────

export type RuleId =
  | 'unknown_item'
  | 'unknown_block'
  | 'kind_change'
  | 'reorder_mismatch'
  | 'load_ceiling'
  | 'back_to_back_hard'
  | 'niggle_contraindicated'
  | 'concurrent_training'
  | 'calibration_ramp_cap'
  | 'quality_dodging'
  | 'load_floor'

/** `info` records; `flag` applies and warns; `block` pushes back (§11). */
export type FindingSeverity = 'info' | 'flag' | 'block'

export interface RuleFinding {
  rule: RuleId
  severity: FindingSeverity
  message: string
  /** Item this is about, when it is about one. */
  itemId?: string
  /**
   * True when no override may cross it — a structural error, or the tissue
   * protections of §15. Everything else the athlete can insist on.
   */
  hardFloor?: boolean
}

export type VerdictKind = 'ok' | 'applied_with_flag' | 'pushed_back'

export interface ValidationVerdict {
  kind: VerdictKind
  /** One line, written for a person. */
  message: string
  findings: RuleFinding[]
  /**
   * The safer version. Present whenever something was pushed back, and offered
   * alongside a flag when there is a better answer than the athlete's — a
   * shorter interval session rather than no intervals (§21).
   */
  counterProposal?: SessionPatch
}

// ── The reviewable diff (§11, §14) ────────────────────────────────────────────

export interface SessionDiffEntry {
  op: PatchOpKind
  itemId: string
  name: string
  blockKind: BlockKind | null
  /** Human-readable prescription before and after. Null means it did not exist. */
  before: string | null
  after: string | null
  reason: string
}

export interface SessionDiff {
  entries: SessionDiffEntry[]
  loadBefore: number
  loadAfter: number
  /** "nothing to action" when the patch changed nothing (§14). */
  summary: string
}

export interface ApplyResult {
  applied: boolean
  verdict: ValidationVerdict
  /** The new session when applied; the one you passed in, untouched, when not. */
  session: EditableSession
  /** What the patch does — populated even when it was pushed back. */
  diff: SessionDiff
  /** Undo. Null when nothing was applied (§11 "versioned + reversible"). */
  inverse: SessionPatch | null
}
