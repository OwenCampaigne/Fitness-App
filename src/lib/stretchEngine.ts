// ── Stretch engine ────────────────────────────────────────────────────────────
// Deterministic placement for dynamic and static stretching
// (RUNNING-ON-AI-Framework.md §9). Pure and DB-free.
//
// One rule does most of the work here: **static stretching stays out of a
// pre-quality warmup.** A long static hold transiently cuts force output, so
// the best-intentioned "I stretched properly first" is precisely what makes a
// speed session worse. The rule lives in `staticPreVerdict` so both the
// generator and the Phase 5 edit validator can call the same line.

import {
  DEFAULT_DYNAMIC_REPS,
  DEFAULT_STATIC_HOLD_SEC,
  getStretch,
  stretchesFor,
  touchesBlockedRegion,
} from './stretches'
import type { HoldParams, SessionItem } from '../types/session'
import type {
  BodyRegion,
  StaticPreVerdict,
  Stretch,
  StretchContext,
  StretchPrescription,
} from '../types/movement'

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * The longest static hold tolerated before a session on a non-quality day. The
 * power cost of static stretching is dose-dependent — brief holds are roughly
 * neutral, long ones are not — so this is a cap, not a ban.
 */
export const STATIC_PRE_HOLD_CAP_SEC = 15

const WARMUP_COUNT = 4
const COOLDOWN_COUNT = 4
/** Pain flagged means less of everything, including the warmup. */
const WARMUP_COUNT_PAIN = 3

/** Stretches that are not done one side at a time. */
const BILATERAL_IDS = new Set([
  'high-knees-dynamic',
  'butt-kicks-dynamic',
  'lateral-shuffles',
  'chest-opener',
])

// ── The rule ──────────────────────────────────────────────────────────────────

/** Whether a static hold may appear in today's warmup, and for how long. */
export function staticPreVerdict(isQualityDay: boolean): StaticPreVerdict {
  if (isQualityDay) {
    return {
      allowed: false,
      maxHoldSec: 0,
      reason:
        'Static holds cut force output for a while afterwards, and today is a quality day — so the warmup stays dynamic. Save these for the cooldown.',
    }
  }
  return {
    allowed: true,
    maxHoldSec: STATIC_PRE_HOLD_CAP_SEC,
    reason: `No quality work today, so a short hold before you start is fine — kept to ${STATIC_PRE_HOLD_CAP_SEC} seconds, because the power cost rises with the hold.`,
  }
}

/**
 * Apply that rule to an arbitrary list. Both the generator and a hand edit go
 * through here, so a user dragging a static stretch into the warmup meets the
 * same validator the engine does (§11).
 */
export function filterWarmupStretches(
  candidates: Stretch[],
  isQualityDay: boolean,
): { kept: Stretch[]; removed: Array<{ stretch: Stretch; reason: string }> } {
  const verdict = staticPreVerdict(isQualityDay)
  const kept: Stretch[] = []
  const removed: Array<{ stretch: Stretch; reason: string }> = []

  for (const stretch of candidates) {
    if (stretch.type === 'static' && !verdict.allowed) {
      removed.push({ stretch, reason: verdict.reason })
    } else {
      kept.push(stretch)
    }
  }

  return { kept, removed }
}

// ── Selection ─────────────────────────────────────────────────────────────────

function allowed(stretch: Stretch, blocked: BodyRegion[]): boolean {
  return !touchesBlockedRegion(stretch.id, blocked)
}

/** Dynamic work only — the warmup's job is range under movement, not range at rest. */
export function warmupStretches(ctx: StretchContext, count?: number): Stretch[] {
  const blocked = ctx.blockedRegions ?? []
  const target = count ?? (ctx.painFlagged ? WARMUP_COUNT_PAIN : WARMUP_COUNT)
  return stretchesFor('pre')
    .filter((s) => s.type === 'dynamic' && allowed(s, blocked))
    .slice(0, target)
}

/**
 * Static work, after. A recovery day leads with the dedicated recovery set
 * rather than the post-run set — the mobility block of §9, which is the whole
 * point of an easy day.
 */
export function cooldownStretches(ctx: StretchContext, count?: number): Stretch[] {
  const blocked = ctx.blockedRegions ?? []
  const target = count ?? COOLDOWN_COUNT
  const mobilityDay = ctx.isRecoveryDay || ctx.band === 'red'

  const pool = mobilityDay
    ? [...stretchesFor('recovery'), ...stretchesFor('post')]
    : stretchesFor('post')

  return pool.filter((s) => s.type === 'static' && allowed(s, blocked)).slice(0, target)
}

// ── Items ─────────────────────────────────────────────────────────────────────

/** Build a `SessionItem`. `maxHoldSec` caps a static hold, ignored for dynamic. */
export function stretchItem(
  stretch: Stretch,
  block: 'warmup' | 'cooldown',
  maxHoldSec?: number | null,
): SessionItem {
  const perSide = !BILATERAL_IDS.has(stretch.id)

  let params: HoldParams
  if (stretch.type === 'dynamic') {
    params = {
      kind: 'hold',
      sets: 1,
      reps: stretch.reps ?? DEFAULT_DYNAMIC_REPS,
      holdSec: null,
      perSide,
    }
  } else {
    const authored = stretch.durationSec ?? DEFAULT_STATIC_HOLD_SEC
    params = {
      kind: 'hold',
      sets: 1,
      reps: null,
      holdSec: maxHoldSec ? Math.min(authored, maxHoldSec) : authored,
      perSide,
    }
  }

  return {
    // Block-scoped so the same stretch can legitimately appear in both.
    id: `stretch-${block}-${stretch.id}`,
    ref: { kind: 'stretch', id: stretch.id, name: stretch.name },
    params,
    why: stretch.target,
    status: 'prescribed',
  }
}

// ── Assembling the prescription ───────────────────────────────────────────────

export interface PrescribeStretchOptions {
  /**
   * Stretches a plan or a user edit wants in the warmup on top of the default
   * dynamic set. They go through `filterWarmupStretches` like everything else.
   */
  extraWarmupIds?: string[]
  warmupCount?: number
  cooldownCount?: number
}

export function prescribeStretches(
  ctx: StretchContext,
  opts: PrescribeStretchOptions = {},
): StretchPrescription {
  const blocked = ctx.blockedRegions ?? []
  const verdict = staticPreVerdict(ctx.isQualityDay)
  const mobilityDay = ctx.isRecoveryDay || ctx.band === 'red'

  const base = warmupStretches(ctx, opts.warmupCount)

  const extras = (opts.extraWarmupIds ?? [])
    .map((id) => getStretch(id))
    .filter((s): s is Stretch => s !== null && allowed(s, blocked))

  const { kept, removed } = filterWarmupStretches(extras, ctx.isQualityDay)

  const warmupSelection = [...base]
  for (const stretch of kept) {
    if (!warmupSelection.some((s) => s.id === stretch.id)) warmupSelection.push(stretch)
  }

  const staticInWarmup = warmupSelection.some((s) => s.type === 'static')

  const warmup = warmupSelection.map((s) =>
    stretchItem(s, 'warmup', s.type === 'static' ? verdict.maxHoldSec : null),
  )

  const warmupIds = new Set(warmupSelection.map((s) => s.id))
  const cooldown = cooldownStretches(ctx, opts.cooldownCount)
    .filter((s) => !warmupIds.has(s.id))
    .map((s) => stretchItem(s, 'cooldown'))

  const why = mobilityDay
    ? 'Recovery day — a short dynamic warmup and then a proper mobility block, which is the one day of the week it actually gets time.'
    : ctx.isQualityDay
      ? 'Dynamic warmup before the quality work, static holds saved for afterwards.'
      : 'Dynamic before, static after — the only ordering that does not cost you anything.'

  const flag =
    removed.length > 0
      ? `${removed.map((r) => r.stretch.name).join(', ')} moved out of the warmup: ${verdict.reason}`
      : null

  return { warmup, cooldown, staticInWarmup, why, flag }
}
