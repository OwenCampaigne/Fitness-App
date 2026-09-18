// ── Rehab stage ───────────────────────────────────────────────────────────────
// Post-surgical rehab is a progression, not a switch. Before this module the app
// held two states — a clinical clearance on file, or nothing — and "nothing"
// meant maximum caution forever. That conflates two genuinely different people:
// an athlete whose restrictions are *unknown*, and an athlete who has *finished
// rehab* and never had a form to say so. The first deserves maximum caution. The
// second is being told to walk.
//
// The fix is a small state machine stored beside the clearance, not a second
// clearance. `clearance` stays exactly what a clinician said, verbatim and
// untouched; `rehabStage` records where the athlete now is and who said so; and
// `applyRehabStage` folds the two into the single `RecoveryContext` the engines
// already read. `strengthEngine` and `runEngine` are unchanged — they keep
// reading one clearance object and one ceiling, and neither learns a new axis.
//
// §15 governs the whole file. Three rules fall out of it and none of them bend:
//
//   1. Nothing is invented. A stage only exists because a human stated it, and
//      the verbatim statement is kept (`sourceQuote`) so it can be read back.
//   2. Self-report is weaker evidence than a clinician's note, and the code says
//      so structurally rather than in copy: an athlete's statement can reach
//      `graduated` and no further, and `graduated` grants strictly less than
//      `unrestricted` (see STAGE_GRANTS).
//   3. A fresh clinical restriction is not overridable by a sentence. §15's
//      "deterministic safety floor always wins" — a proposal that would unlock
//      what a clinician declined inside the last six months comes back refused,
//      with the reason, rather than quietly applying.
//
// Framework: §15 (safety), §11 (preview → confirm), §5 (conservative posture
// while confidence is unearned).

import {
  DEEP_FLEXION_THRESHOLD_DEG,
  STALE_CLEARANCE_MONTHS,
  clearanceAgeMonths,
  toIsoDate,
  type ClearanceEntry,
  type StoredRecoveryContext,
} from './clearance'
import type { RecoveryContext } from '../types/strength'

// ── The machine ───────────────────────────────────────────────────────────────

/**
 * Where the athlete is, in order of increasing freedom.
 *
 * - `unknown` — nothing stated. The default, and the posture the app has always
 *   held with an empty form: no lift is offered that loads the knee hard, and
 *   the run ladder offers no rung at all.
 * - `restricted` — a clinician's clearance is on file. The engines read exactly
 *   what it says; this module adds nothing.
 * - `progressing` — the athlete reports rehab moving, not finished. Opens the
 *   closed-chain and open-chain strength work that late-stage rehab is made of.
 *   Impact stays shut.
 * - `graduated` — the athlete reports rehab complete. Opens impact and a capped
 *   ladder. Loaded pivot stays shut (see STAGE_GRANTS for why).
 * - `unrestricted` — a clinician discharged them with no restrictions. Only
 *   reachable through the clearance form, never through a sentence.
 */
export type RehabStage = 'unknown' | 'restricted' | 'progressing' | 'graduated' | 'unrestricted'

/** Who stated it. This is provenance, and it reaches the screen unedited. */
export type StageActor = 'athlete' | 'clinician'

export const STAGE_ORDER: RehabStage[] = [
  'unknown',
  'restricted',
  'progressing',
  'graduated',
  'unrestricted',
]

/** The furthest an athlete's own statement may move the machine (§15 rule 2). */
export const MAX_SELF_REPORTED_STAGE: RehabStage = 'graduated'

/**
 * The ladder ceiling a self-reported graduation is worth, in minutes.
 *
 * Ten minutes is rung 9 of thirteen — a real run for someone through rehab, and
 * still short of the continuous running that rung 12 unlocks. The number is a
 * *cap*, not a starting point: `decideLadder` still makes every rung earn itself
 * over three pain-free sessions. The point is that a sentence can move you up
 * the ladder but cannot move you off the end of it. Only a clinician's number
 * can do that.
 */
export const SELF_REPORT_RUN_CEILING_MIN = 10

export interface RehabStageRecord {
  stage: RehabStage
  setBy: StageActor
  /** ISO `YYYY-MM-DD`, the day the statement was made. */
  recordedOn: string
  /** Verbatim, when it came from chat. Null when it came from a form. */
  sourceQuote: string | null
  notes: string | null
}

/** What a stage adds on top of whatever the clinician already granted. */
export interface StageGrants {
  deepFlexion: boolean
  openChain: boolean
  impact: boolean
  pivot: boolean
  /** Ceiling in minutes this stage is worth on its own. Null adds nothing. */
  runCeilingMin: number | null
}

const NOTHING: StageGrants = {
  deepFlexion: false,
  openChain: false,
  impact: false,
  pivot: false,
  runCeilingMin: null,
}

/**
 * The table the whole design reduces to.
 *
 * `progressing` and `graduated` are the only rows that add anything, because
 * they are the only rows an athlete can reach on their own word. Read the gap
 * between `graduated` and `unrestricted` as the price of self-report:
 *
 *   - **Loaded pivot stays shut at `graduated`.** Cutting and twisting on a
 *     loaded leg is the mechanism that tears the graft again, and readiness for
 *     it is decided by a hop battery and a limb-symmetry number, not by how the
 *     knee feels. "I'm through rehab" is honest evidence about training
 *     tolerance and no evidence at all about limb symmetry, so §15's
 *     conservative default holds on this one attribute until someone measures
 *     it.
 *   - **The run ceiling is capped, not lifted.** See
 *     SELF_REPORT_RUN_CEILING_MIN.
 *
 * `unrestricted` is all-true, but it never grants anything in practice: the
 * clearance already on file says the same. It is all-true so the "what this
 * permits" table on screen can be rendered from the stage alone.
 */
export const STAGE_GRANTS: Record<RehabStage, StageGrants> = {
  unknown: NOTHING,
  restricted: NOTHING,
  progressing: { deepFlexion: true, openChain: true, impact: false, pivot: false, runCeilingMin: null },
  graduated: {
    deepFlexion: true,
    openChain: true,
    impact: true,
    pivot: false,
    runCeilingMin: SELF_REPORT_RUN_CEILING_MIN,
  },
  unrestricted: { deepFlexion: true, openChain: true, impact: true, pivot: true, runCeilingMin: null },
}

export function stageGrants(stage: RehabStage): StageGrants {
  return STAGE_GRANTS[stage] ?? NOTHING
}

// ── Reading the stage off a stored context ────────────────────────────────────

function isStage(v: unknown): v is RehabStage {
  return typeof v === 'string' && (STAGE_ORDER as string[]).includes(v)
}

/**
 * The stage record as stored, or null. Anything malformed reads as null, which
 * lands on the conservative default rather than on a guess.
 */
export function readStageRecord(
  context: StoredRecoveryContext | null | undefined,
): RehabStageRecord | null {
  const raw = context?.rehabStage as Partial<RehabStageRecord> | undefined
  if (!raw || typeof raw !== 'object') return null
  if (!isStage(raw.stage)) return null
  if (raw.setBy !== 'athlete' && raw.setBy !== 'clinician') return null
  return {
    stage: raw.stage,
    setBy: raw.setBy,
    recordedOn: typeof raw.recordedOn === 'string' ? raw.recordedOn : '',
    sourceQuote: typeof raw.sourceQuote === 'string' ? raw.sourceQuote : null,
    notes: typeof raw.notes === 'string' ? raw.notes : null,
  }
}

/**
 * The current stage.
 *
 * A context written before this module existed has no record, so the stage is
 * inferred from what is there: a clearance on file means `restricted`, nothing
 * on file means `unknown`. Both infer to a row that grants nothing, which is why
 * every context predating this feature keeps behaving exactly as it did.
 */
export function currentStage(context: StoredRecoveryContext | null | undefined): RehabStage {
  const record = readStageRecord(context)
  if (record) return record.stage
  return context?.clearance ? 'restricted' : 'unknown'
}

// ── The fold ──────────────────────────────────────────────────────────────────

/**
 * Fold the stage into the recovery context the engines read.
 *
 * This is the single seam between the stage machine and the safety core. Call it
 * on every read of `recoveryContextJson`; never on a write, or the derived
 * clearance would overwrite the clinician's words in the column.
 *
 * It is the identity function for every stage that grants nothing, which is the
 * `unknown` guarantee: with no stage recorded, the context comes out byte-for-
 * byte as it went in and `filterContraindicated` sees exactly what it always saw.
 */
export function applyRehabStage<T extends RecoveryContext>(context: T | null): T | null {
  if (!context) return context
  const ctx = context as unknown as StoredRecoveryContext

  // A clinician's entry supersedes: when the current record came from the
  // clearance form, the stored clearance *is* the truth and there is nothing to
  // fold. Only an athlete's own report adds anything, and this is the line that
  // guarantees a clinician's "not cleared" cannot be papered over from here.
  const record = readStageRecord(ctx)
  if (!record || record.setBy !== 'athlete') return context

  const grants = stageGrants(record.stage)

  // A stage that grants nothing — `restricted`, i.e. the athlete walking their
  // own report back — must not synthesise a clearance object out of thin air.
  // `filterContraindicated` drops its conservative default the *instant* a
  // clearance exists, so an all-false object would read as permission rather
  // than as caution. Nothing to add means nothing to write.
  const adds =
    grants.deepFlexion || grants.openChain || grants.impact || grants.pivot || grants.runCeilingMin
  if (!adds) return context

  const clinical = ctx.clearance ?? null
  const merged: ClearanceEntry = {
    // A clinician's limit in degrees is a measurement; a self-report is not, so
    // the stage can only remove the *absence* of a measurement, never relax one
    // that exists. `null` here means "no limit", which is what the grant says.
    maxKneeFlexionDeg: grants.deepFlexion ? null : (clinical?.maxKneeFlexionDeg ?? 0),
    openChainCleared: grants.openChain || (clinical?.openChainCleared ?? false),
    impactCleared: grants.impact || (clinical?.impactCleared ?? false),
    pivotCleared: grants.pivot || (clinical?.pivotCleared ?? false),
    notes: clinical?.notes ?? null,
    setBy: 'user',
    updatedAt: clinical?.updatedAt,
    clearedOn: clinical?.clearedOn ?? '',
    clearedBy: clinical?.clearedBy ?? null,
  }

  // `max`, not "replace": a clinician's ceiling is a real number and a self-
  // report can only ever raise a missing one up to the cap. It can never lower
  // what a clinician allowed, and never exceed it.
  const ceiling = Math.max(
    typeof ctx.longestRunSegmentMin === 'number' ? ctx.longestRunSegmentMin : 0,
    grants.runCeilingMin ?? 0,
  )

  return {
    ...context,
    clearance: merged,
    ...(ceiling > 0 ? { longestRunSegmentMin: ceiling } : {}),
  } as T
}

// ── What the stage permits, in the engine's own terms ─────────────────────────

export interface StagePermits {
  stage: RehabStage
  setBy: StageActor | null
  deepFlexionAllowed: boolean
  openChainAllowed: boolean
  impactAllowed: boolean
  pivotAllowed: boolean
  /** Null means no ladder rung is offered — running is not prescribed at all. */
  runSegmentMin: number | null
  /** True when the posture rests on the athlete's word, not a clinician's note. */
  selfReported: boolean
}

/**
 * What the athlete would actually be offered right now. Derived through
 * `applyRehabStage` on purpose — if this and the engines ever disagreed, this is
 * the one that would be lying.
 */
export function stagePermits(context: StoredRecoveryContext | null | undefined): StagePermits {
  const stage = currentStage(context)
  const record = readStageRecord(context)
  const folded = applyRehabStage((context ?? {}) as StoredRecoveryContext)
  const c = folded?.clearance ?? null
  const seg = typeof folded?.longestRunSegmentMin === 'number' ? folded.longestRunSegmentMin : null

  return {
    stage,
    setBy: record?.setBy ?? (context?.clearance ? 'clinician' : null),
    deepFlexionAllowed: c
      ? c.maxKneeFlexionDeg === null || c.maxKneeFlexionDeg >= DEEP_FLEXION_THRESHOLD_DEG
      : false,
    openChainAllowed: c?.openChainCleared ?? false,
    impactAllowed: c?.impactCleared ?? false,
    pivotAllowed: c?.pivotCleared ?? false,
    runSegmentMin: seg && seg > 0 ? seg : null,
    selfReported: record?.setBy === 'athlete',
  }
}

// ── Chat → proposal (§11: preview, then confirm) ──────────────────────────────

export interface ClearanceProposal {
  from: RehabStage
  to: RehabStage
  setBy: StageActor
  /** The athlete's own words, kept so the history row can quote them. */
  sourceQuote: string
  /** False when §15 forbids applying this. The preview still renders it. */
  applicable: boolean
  blockedReason: string | null
  /** What changes if confirmed, phrased the way the engines behave. */
  unlocks: string[]
}

// Phrases that mean "rehab is finished". Deliberately narrow: a near-miss that
// returns null costs a follow-up question, a near-miss that returns a proposal
// costs an unearned unlock.
const GRADUATED_PATTERNS: RegExp[] = [
  /\b(?:all|way|well)?\s*(?:the\s+)?(?:way\s+)?through\s+(?:all\s+)?(?:of\s+)?(?:my|the)?\s*rehab\b/i,
  /\b(?:done|finished|through|out)\s+with\s+(?:my\s+)?(?:rehab|pt|physio(?:therapy)?)\b/i,
  /\b(?:finished|completed)\s+(?:my\s+|all\s+(?:of\s+)?my\s+)?(?:rehab|pt|physio(?:therapy)?)\b/i,
  /\bgraduated\s+(?:from\s+)?(?:rehab|pt|physio(?:therapy)?)\b/i,
  /\bdischarged\s+from\s+(?:rehab|pt|physio(?:therapy)?)\b/i,
  /\brehab\s+is\s+(?:done|over|finished|complete)\b/i,
]

const PROGRESSING_PATTERNS: RegExp[] = [
  /\brehab\s+is\s+going\s+(?:well|great|fine)\b/i,
  /\b(?:i'?m|i am)\s+(?:progressing|further along|much further along)\b/i,
  /\bpast\s+the\s+early\s+(?:stages|phase)\b/i,
  /\blate[- ]stage\s+rehab\b/i,
  /\bmoved\s+on\s+from\s+(?:the\s+)?early\s+rehab\b/i,
]

// A downgrade is always safe to apply, but it still goes through confirmation —
// one funnel, no exceptions (§11).
const BACK_IN_REHAB_PATTERNS: RegExp[] = [
  /\bstill\s+in\s+rehab\b/i,
  /\bback\s+in\s+(?:rehab|pt|physio(?:therapy)?)\b/i,
  /\b(?:not|haven'?t)\s+(?:yet\s+)?(?:done|finished|through)\s+(?:with\s+)?(?:my\s+)?rehab\b/i,
]

// "I'm not through rehab" must never read as "I'm through rehab". Negation is
// checked first and wins outright.
function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text))
}

function rank(stage: RehabStage): number {
  return STAGE_ORDER.indexOf(stage)
}

/**
 * Read a statement and propose a stage change. **Proposes only** — nothing here
 * writes, and the caller must show the proposal and get an explicit confirmation
 * before calling `applyClearanceUpdate`.
 *
 * Returns null when the text says nothing about rehab progression, which is the
 * overwhelmingly common case.
 *
 * This is the function the coach's extractor should call. It is deliberately a
 * keyword matcher rather than a model call: the model's job is to decide that a
 * message is *about* rehab progression, and this function's job is to decide
 * what that is worth — which must stay deterministic, because it is a safety
 * decision (§10: "safety logic in code, not prompts").
 */
export function proposeClearanceUpdate(
  text: string,
  context: StoredRecoveryContext | null | undefined,
  now: Date = new Date(),
): ClearanceProposal | null {
  const quote = (text ?? '').trim()
  if (quote === '') return null

  const from = currentStage(context)

  let to: RehabStage | null = null
  if (matchesAny(quote, BACK_IN_REHAB_PATTERNS)) to = 'restricted'
  else if (matchesAny(quote, GRADUATED_PATTERNS)) to = 'graduated'
  else if (matchesAny(quote, PROGRESSING_PATTERNS)) to = 'progressing'

  if (to === null) return null

  // §15 rule 2, enforced structurally rather than in copy: whatever the sentence
  // says, an athlete's word tops out here. There is no phrasing that reaches
  // `unrestricted` — that needs the clearance form and a clinician's note.
  if (rank(to) > rank(MAX_SELF_REPORTED_STAGE)) to = MAX_SELF_REPORTED_STAGE

  if (to === from) return null

  const proposal: ClearanceProposal = {
    from,
    to,
    setBy: 'athlete',
    sourceQuote: quote,
    applicable: true,
    blockedReason: null,
    unlocks: describeChange(from, to, context),
  }

  const blocked = blockedByFreshClinicalRestriction(from, to, context, now)
  if (blocked) {
    proposal.applicable = false
    proposal.blockedReason = blocked
  }

  return proposal
}

/**
 * The sentence a tap on the progression card sends.
 *
 * The card does not set a stage; it states something on the athlete's behalf and
 * lets the same matcher read it, so the button and the chat coach cannot end up
 * on two different code paths. These stay English even in a Spanish UI — the
 * label the athlete reads is translated, but the statement that gets matched and
 * quoted into `clearance_history` is the one this module understands. A test
 * round-trips every entry so a reworded button cannot silently stop working.
 */
export const CANONICAL_STATEMENTS: Record<'progressing' | 'graduated' | 'restricted', string> = {
  progressing: 'My rehab is going well and I am past the early stages.',
  graduated: 'I am through all of my rehab.',
  restricted: 'I am still in rehab.',
}

/**
 * §15's safety floor. A clinician who examined the knee inside the last six
 * months and wrote "not cleared for impact" outranks a sentence typed into a
 * chat box, so a proposal that would undo that comes back refused rather than
 * applied. Six months is the same threshold the clearance card already uses to
 * call a clearance stale — past it, the note describes a different knee, and the
 * athlete's own report becomes the better evidence.
 */
function blockedByFreshClinicalRestriction(
  from: RehabStage,
  to: RehabStage,
  context: StoredRecoveryContext | null | undefined,
  now: Date,
): string | null {
  const clinical = context?.clearance
  if (!clinical) return null
  if (rank(to) <= rank(from)) return null

  const record = readStageRecord(context)
  // Only a clinician-authored record (or a legacy clearance with no record at
  // all, which is by definition from the form) counts as a clinical restriction.
  if (record && record.setBy !== 'clinician') return null

  const age = clearanceAgeMonths(clinical, now)
  if (age === null || age >= STALE_CLEARANCE_MONTHS) return null

  const grants = stageGrants(to)
  const declined: string[] = []
  if (grants.impact && !clinical.impactCleared) declined.push('impact')
  if (grants.openChain && !clinical.openChainCleared) declined.push('open-chain knee extension')
  if (grants.pivot && !clinical.pivotCleared) declined.push('loaded pivot')
  if (declined.length === 0) return null

  return (
    `Your clearance from ${clinical.clearedOn} is ${age} month${age === 1 ? '' : 's'} old and ` +
    `does not clear ${declined.join(', ')}. A clearance that recent stays in charge — ` +
    `update it from your surgeon or PT rather than from here.`
  )
}

/** The consequence of a stage change, in the terms the engines actually use. */
export function describeChange(
  from: RehabStage,
  to: RehabStage,
  context: StoredRecoveryContext | null | undefined,
): string[] {
  const before = stagePermits(context)
  const after = stagePermits({ ...(context ?? {}), rehabStage: stubRecord(to) })
  const lines: string[] = []

  if (after.deepFlexionAllowed && !before.deepFlexionAllowed) lines.push('Deep-knee loading becomes available.')
  if (after.openChainAllowed && !before.openChainAllowed) lines.push('Open-chain knee extension becomes available.')
  if (after.impactAllowed && !before.impactAllowed) lines.push('Impact work becomes available.')
  if (after.pivotAllowed && !before.pivotAllowed) lines.push('Loaded pivoting becomes available.')

  if (after.runSegmentMin !== before.runSegmentMin) {
    if (after.runSegmentMin === null) lines.push('No return-to-run rung is offered.')
    else if (before.runSegmentMin === null)
      lines.push(
        `The return-to-run ladder opens, capped at ${after.runSegmentMin} min of continuous running.`,
      )
    else
      lines.push(
        `The return-to-run ceiling moves from ${before.runSegmentMin} to ${after.runSegmentMin} min ` +
          'of continuous running.',
      )
  }

  if (!after.pivotAllowed && stageGrants(to).impact) {
    lines.push('Loaded pivoting stays closed — that one needs a clinician.')
  }

  if (rank(to) < rank(from)) lines.push('Anything you reported yourself is dropped.')
  if (lines.length === 0) lines.push('Nothing the engines prescribe changes.')
  return lines
}

function stubRecord(stage: RehabStage): RehabStageRecord {
  return { stage, setBy: 'athlete', recordedOn: '', sourceQuote: null, notes: null }
}

// ── Applying ──────────────────────────────────────────────────────────────────

/** Exactly the columns of `clearance_history`. The caller does the insert. */
export interface ClearanceHistoryRow {
  recordedOn: Date
  clearanceJson: string
  stage: string
  setBy: string
  sourceQuote: string | null
  notes: string | null
}

export interface AppliedClearanceUpdate {
  context: StoredRecoveryContext
  history: ClearanceHistoryRow
}

/**
 * Apply a confirmed proposal. Pure: the new context and the history row come
 * back, and the caller writes both in one transaction.
 *
 * `actor` is passed separately from `proposal.setBy` and must match it. A
 * proposal is not a token — it crossed the wire and may have been edited, so the
 * caller re-derives it from `sourceQuote` before getting here, and this last
 * check catches a proposal being applied by someone it was not authored by.
 *
 * Note what this does *not* write: `clearance`. The clinician's words stay
 * exactly as entered. The stage is folded in at read time by `applyRehabStage`,
 * so there is never a moment where a self-report is stored looking like a note
 * from a surgeon.
 */
export function applyClearanceUpdate(
  proposal: ClearanceProposal,
  actor: StageActor,
  context: StoredRecoveryContext,
  now: Date = new Date(),
): AppliedClearanceUpdate {
  if (proposal.setBy !== actor) {
    throw new Error('Clearance proposal actor mismatch')
  }
  if (!proposal.applicable) {
    throw new Error(proposal.blockedReason ?? 'Clearance proposal is not applicable')
  }
  if (actor === 'athlete' && rank(proposal.to) > rank(MAX_SELF_REPORTED_STAGE)) {
    throw new Error('A self-reported stage cannot exceed graduated')
  }

  const record: RehabStageRecord = {
    stage: proposal.to,
    setBy: actor,
    recordedOn: toIsoDate(now),
    sourceQuote: proposal.sourceQuote || null,
    notes: null,
  }

  const next: StoredRecoveryContext = { ...context, rehabStage: record }

  return { context: next, history: historyRowFor(record, next, now) }
}

/**
 * The audit row for a transition. `clearanceJson` stores what the engines would
 * *actually* see at that moment — the fold, not the raw clearance — because the
 * question this table answers six months from now is "what was I being allowed
 * to do, and on whose say-so".
 */
export function historyRowFor(
  record: RehabStageRecord,
  context: StoredRecoveryContext,
  now: Date = new Date(),
): ClearanceHistoryRow {
  const folded = applyRehabStage(context)
  return {
    recordedOn: now,
    clearanceJson: JSON.stringify({
      clearance: folded?.clearance ?? null,
      longestRunSegmentMin: folded?.longestRunSegmentMin ?? null,
      permits: stagePermits(context),
    }),
    stage: record.stage,
    setBy: record.setBy,
    sourceQuote: record.sourceQuote,
    notes: record.notes,
  }
}

/**
 * The stage a saved clearance form implies. All four boxes open with no flexion
 * limit is a discharge with no restrictions; anything else is a restriction.
 * Always `clinician` — the form's every field is a transcription of what a
 * surgeon or PT said, which is the whole premise of that screen.
 */
export function stageForClearanceEntry(
  entry: ClearanceEntry | null,
  longestRunSegmentMin: number | null,
): RehabStageRecord | null {
  if (!entry) return null
  const unrestricted =
    entry.maxKneeFlexionDeg === null &&
    entry.openChainCleared &&
    entry.impactCleared &&
    entry.pivotCleared &&
    (longestRunSegmentMin ?? 0) > 0
  return {
    stage: unrestricted ? 'unrestricted' : 'restricted',
    setBy: 'clinician',
    recordedOn: entry.clearedOn,
    sourceQuote: null,
    notes: entry.notes ?? null,
  }
}
