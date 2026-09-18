// ── Plyo engine ───────────────────────────────────────────────────────────────
// Deterministic dosing, gating and placement for plyometrics
// (RUNNING-ON-AI-Framework.md §9). Pure and DB-free like the strength and run
// engines: contacts, tiers and ceilings live here, judgment lives in the Claude
// layer (§10).
//
// The load currency for plyos is the **ground contact**, not time or sRPE. A
// tier-3 contact costs several times what a tier-1 contact costs, which is why
// the session dose falls as the tier rises rather than climbing with it.

import { subDays } from 'date-fns'
import {
  CONTACTS_PER_SET,
  CONTACT_LOAD_RANK,
  PLYOS,
  needsImpactClearance,
  plyoRegions,
} from './plyos'
import type { BlockKind, ContactParams, SessionItem } from '../types/session'
import type {
  BodyRegion,
  ContactBudget,
  ContactBudgetInput,
  Plyo,
  PlyoPlacementContext,
  PlyoPlacementDecision,
  PlyoPrescription,
  PlyoSessionHistory,
  PlyoTier,
  PlyoTierAnchor,
  PlyoUnlockContext,
  PlyoUnlockResult,
} from '../types/movement'
import type { RunType } from '../types/run'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Ground contacts in one session, by tier. Fewer as the cost per contact rises. */
export const TIER_SESSION_CONTACTS: Record<PlyoTier, number> = { 1: 80, 2: 60, 3: 40 }

/** Rest between sets, by tier. Quality is the point; fatigue makes it a jump-and-hope. */
export const TIER_REST_SEC: Record<PlyoTier, number> = { 1: 45, 2: 90, 3: 150 }

/** A first-ever plyo session is small on purpose — nothing has been earned yet. */
export const COLD_START_CONTACTS = 40
export const COLD_START_WEEKLY_CEILING = 120

/** Week-on-week growth ceiling, and the tighter one used mid-calibration (§5b). */
export const WEEKLY_RAMP = 1.1
export const PROVISIONAL_RAMP = 1.05

/** Acute:chronic on contacts. Same 1.3 line the readiness engine uses on load. */
export const CONTACT_ACWR_CEILING = 1.3

/** Weeks of history the tier anchor looks back over. */
export const ANCHOR_WINDOW_DAYS = 42

/** Next-day soreness at or above this reads as "that tier did not hold". */
const SORENESS_FAIL = 7

/** Drills per session. A primer is short by design — it precedes the real work. */
const MAX_DRILLS_STANDALONE = 3
const MAX_DRILLS_PRIMER = 2
const MAX_SETS_PER_DRILL = 4

const TIERS: PlyoTier[] = [3, 2, 1]

// ── Tier anchor (§3 — value, source, confidence) ──────────────────────────────

/**
 * Derive the plyo-tier anchor from logged exposures.
 *
 * Tiers advance on demonstrated quality, never on elapsed weeks — the same
 * evidence-not-calendar rule the return-to-run ladder uses. Two sessions that
 * did not hold at a tier take that tier off the table entirely, because the
 * athlete has already answered the question of whether they own it.
 */
export function derivePlyoTierAnchor(
  history: PlyoSessionHistory[],
  today: Date = new Date(),
  windowDays: number = ANCHOR_WINDOW_DAYS,
): PlyoTierAnchor {
  const cutoff = subDays(today, windowDays)
  const inWindow = history.filter((h) => h.date >= cutoff)

  if (inWindow.length === 0) {
    return {
      value: 1,
      source: 'estimate',
      confidence: 0.2,
      sessions: 0,
      basis: 'No plyo work logged yet — starting from the foundational tier.',
    }
  }

  const cleanAt = (tier: PlyoTier) =>
    inWindow.filter(
      (h) =>
        h.tier === tier && h.cleanExecution === true && (h.sorenessNextDay ?? 0) < SORENESS_FAIL,
    )
  const failedAt = (tier: PlyoTier) =>
    inWindow.filter(
      (h) =>
        h.tier === tier && (h.cleanExecution === false || (h.sorenessNextDay ?? 0) >= SORENESS_FAIL),
    )

  for (const tier of TIERS) {
    if (failedAt(tier).length >= 2) continue
    const clean = cleanAt(tier)
    if (clean.length >= 3) {
      return {
        value: tier,
        source: 'confirmed',
        confidence: 0.85,
        sessions: clean.length,
        basis: `${clean.length} clean sessions at tier ${tier} in the last ${windowDays} days.`,
      }
    }
  }

  for (const tier of TIERS) {
    if (failedAt(tier).length >= 2) continue
    const clean = cleanAt(tier)
    if (clean.length >= 1) {
      return {
        value: tier,
        source: 'observed',
        confidence: 0.5,
        sessions: clean.length,
        basis: `Tier ${tier} has been handled ${clean.length} time(s) — not enough yet to call it owned.`,
      }
    }
  }

  return {
    value: 1,
    source: 'estimate',
    confidence: 0.25,
    sessions: 0,
    basis: 'Plyo work is logged, but none of it clean enough to move the tier yet.',
  }
}

// ── Gating: prerequisites, tier ceiling, clearance ────────────────────────────

/**
 * Whether a drill may be offered at all.
 *
 * Four gates, checked in this order deliberately. Impact clearance comes first
 * because it is the only one the athlete cannot train their way past — it is a
 * clinician's number (§15). Prerequisites come last because they are the gate
 * with an obvious path through it, and the reason shown should be actionable.
 */
export function isPlyoUnlocked(plyo: Plyo, ctx: PlyoUnlockContext): PlyoUnlockResult {
  const base = { plyo, missingPrerequisites: [] as string[] }

  if (needsImpactClearance(plyo) && !ctx.impactCleared) {
    return {
      ...base,
      unlocked: false,
      blockedBy: 'impact',
      reason: `${plyo.name} lands hard enough to need impact clearance, and none has been entered. That number comes from your surgeon or PT, not from this app.`,
    }
  }

  const blocked = ctx.blockedRegions ?? []
  const hit = plyoRegions(plyo.id).find((r) => blocked.includes(r as BodyRegion))
  if (hit) {
    return {
      ...base,
      unlocked: false,
      blockedBy: 'niggle',
      reason: `${plyo.name} loads an area you have flagged — it stays off until that settles.`,
    }
  }

  if (plyo.progressionTier > ctx.tierAnchor + 1) {
    return {
      ...base,
      unlocked: false,
      blockedBy: 'tier',
      reason: `${plyo.name} is tier ${plyo.progressionTier} and you are anchored at tier ${ctx.tierAnchor} — that is a two-tier jump. Tier ${ctx.tierAnchor + 1} first.`,
    }
  }

  const mastered = new Set(ctx.masteredIds)
  const missing = plyo.prerequisites.filter((id) => !mastered.has(id))
  if (missing.length > 0) {
    return {
      ...base,
      unlocked: false,
      blockedBy: 'prerequisites',
      missingPrerequisites: missing,
      reason: `${plyo.name} builds on work you have not logged yet: ${missing.join(', ')}.`,
    }
  }

  return { ...base, unlocked: true, blockedBy: null, reason: `${plyo.name} is available.` }
}

export function unlockedPlyos(ctx: PlyoUnlockContext, catalog: Plyo[] = PLYOS): Plyo[] {
  return catalog.filter((p) => isPlyoUnlocked(p, ctx).unlocked)
}

// ── Contact budget, ramped with ACWR (§9) ─────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function floorTo10(value: number): number {
  return Math.max(0, Math.floor(value / 10) * 10)
}

function emptyBudget(reason: string, weeklyCeiling: number, acwr: number | null): ContactBudget {
  return { contacts: 0, maxTier: 0, weeklyCeiling, acwr, rampCapped: false, reason }
}

/**
 * Today's ground-contact allowance.
 *
 * Two independent ceilings apply and the tighter one wins: a weekly ramp on the
 * chronic contact load (contacts are the plyo load currency, §3) and the
 * readiness band. Neither can be talked past by a good-feeling day — that is
 * exactly the day plyo injuries get booked.
 */
export function contactBudget(input: ContactBudgetInput): ContactBudget {
  const {
    tierAnchor,
    weeklyContacts,
    contactsThisWeek = 0,
    band,
    painFlagged = false,
    provisional = false,
    blockImpact = false,
  } = input

  const completed = weeklyContacts.slice(-4)
  const chronic = mean(completed)
  const acute = completed.length > 0 ? completed[completed.length - 1] : 0
  const acwr = chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : null

  const ramp = provisional ? PROVISIONAL_RAMP : WEEKLY_RAMP
  const weeklyCeiling =
    chronic > 0 ? Math.round(chronic * ramp) : COLD_START_WEEKLY_CEILING

  if (painFlagged) {
    return emptyBudget(
      'Pain is flagged today — no ground contacts. Impact is the first thing off when something hurts.',
      weeklyCeiling,
      acwr,
    )
  }

  if (blockImpact) {
    return emptyBudget(
      'A logged niggle has impact work switched off — no plyos until it settles.',
      weeklyCeiling,
      acwr,
    )
  }

  if (band === 'red') {
    return emptyBudget(
      'Red day — plyos are a quality stimulus and quality needs fresh legs.',
      weeklyCeiling,
      acwr,
    )
  }

  if (acwr !== null && acwr > CONTACT_ACWR_CEILING) {
    return {
      ...emptyBudget(
        `Contact load has spiked — acute:chronic is ${acwr.toFixed(2)} against a 1.3 ceiling. Nothing today; the ramp catches up first.`,
        weeklyCeiling,
        acwr,
      ),
      rampCapped: true,
    }
  }

  const coldStart = chronic <= 0
  let maxTier: PlyoTier = coldStart ? 1 : tierAnchor
  let base = coldStart ? COLD_START_CONTACTS : TIER_SESSION_CONTACTS[tierAnchor]

  if (band === 'amber') {
    base = base / 2
    maxTier = 1
  }

  const remaining = Math.max(0, weeklyCeiling - contactsThisWeek)
  const contacts = floorTo10(Math.min(base, remaining))
  const rampCapped = contacts < base

  if (contacts === 0) {
    return {
      ...emptyBudget(
        `This week's contact ceiling of ${weeklyCeiling} is already spent. Plyos come back next week.`,
        weeklyCeiling,
        acwr,
      ),
      rampCapped: true,
    }
  }

  const reason = coldStart
    ? `First plyo dose — ${contacts} contacts of foundational work, and the tier only moves once that lands clean.`
    : band === 'amber'
      ? `Amber day — half dose at ${contacts} contacts, foundational drills only.`
      : rampCapped
        ? `${contacts} contacts — all that is left under this week's ceiling of ${weeklyCeiling}.`
        : `${contacts} contacts at tier ${maxTier}, inside a weekly ceiling of ${weeklyCeiling}.`

  return { contacts, maxTier, weeklyCeiling, acwr, rampCapped, reason }
}

// ── Placement (§9) ────────────────────────────────────────────────────────────

/** Runs whose warmup a plyo primer belongs in. */
const QUALITY_RUN_TYPES = new Set<RunType>([
  'strides',
  'vo2',
  'tempo',
  'hills',
  'fartlek',
  'progression',
])

/** Runs whose whole point is that nothing is asked of the legs. */
const RECOVERY_RUN_TYPES = new Set<RunType>(['recovery', 'rest', 'walk'])

function veto(reason: string): PlyoPlacementDecision {
  return { allowed: false, placement: 'none', block: 'main', reason }
}

/**
 * Where — and whether — plyos go today.
 *
 * The two hard "never"s from §9 are checked before anything that could say yes:
 * not the day before a long run, and not on a recovery day. Both exist because
 * a plyo session's cost is paid 24–48 hours later, which is precisely when
 * those two sessions need the legs.
 */
export function decidePlyoPlacement(ctx: PlyoPlacementContext): PlyoPlacementDecision {
  const { band, todayRunType, tomorrowRunType, isRecoveryDay, painFlagged = false } = ctx

  if (painFlagged) {
    return veto('Pain is flagged — nothing with impact in it today.')
  }

  if (tomorrowRunType === 'long') {
    return veto(
      'Long run tomorrow. Plyos cost you 24–48 hours later, which lands exactly on it — so not today.',
    )
  }

  if (isRecoveryDay || (todayRunType && RECOVERY_RUN_TYPES.has(todayRunType))) {
    return veto('Recovery day — plyos are a quality stimulus and would undo the point of it.')
  }

  if (band === 'red') {
    return veto('Red day — quality work is off, and plyos are quality work.')
  }

  if (todayRunType === 'long') {
    return veto('Long-run day — the long run gets the fresh legs, not the plyos.')
  }

  if (todayRunType && QUALITY_RUN_TYPES.has(todayRunType)) {
    return {
      allowed: true,
      placement: 'primer',
      block: 'warmup',
      reason: `Primer before the ${todayRunType} session — a few sharp contacts wake the stretch-shortening cycle up before the real work.`,
    }
  }

  return {
    allowed: true,
    placement: 'standalone',
    block: 'main',
    reason:
      band === 'amber'
        ? 'Standalone plyo block, kept foundational because today is amber.'
        : 'Standalone plyo block — the legs are fresh, which is the only time this stimulus is worth having.',
  }
}

// ── Assembling the prescription ───────────────────────────────────────────────

export interface PrescribePlyoInput {
  budget: ContactBudget
  placement: PlyoPlacementDecision
  /** Already filtered through `isPlyoUnlocked`. */
  unlocked: Plyo[]
  /** Drills to favour — a preference, never an override of the gates (§13). */
  preferIds?: string[]
}

function contactItem(plyo: Plyo, sets: number): SessionItem {
  const params: ContactParams = {
    kind: 'contacts',
    sets,
    contactsPerSet: CONTACTS_PER_SET[plyo.progressionTier],
    restSec: TIER_REST_SEC[plyo.progressionTier],
  }
  return {
    // Deterministic so the same inputs render the same session, not a new one.
    id: `plyo-${plyo.id}`,
    ref: { kind: 'plyo', id: plyo.id, name: plyo.name },
    params,
    why: `Tier ${plyo.progressionTier} — ${plyo.target}.`,
    status: 'prescribed',
  }
}

/**
 * Turn a budget into concrete sets.
 *
 * Every drill starts at one set, then sets are handed out round-robin until the
 * budget runs out. Spreading before deepening keeps the session varied at low
 * contact counts, and guarantees the total never exceeds the budget — the cap
 * is enforced by construction rather than checked afterwards.
 */
export function prescribePlyos(input: PrescribePlyoInput): PlyoPrescription {
  const { budget, placement, unlocked, preferIds = [] } = input
  const block: BlockKind = placement.block

  if (!placement.allowed) {
    return {
      items: [],
      block,
      placement: 'none',
      totalContacts: 0,
      why: placement.reason,
      flag: null,
    }
  }

  if (budget.contacts <= 0 || budget.maxTier === 0) {
    return {
      items: [],
      block,
      placement: placement.placement,
      totalContacts: 0,
      why: budget.reason,
      flag: null,
    }
  }

  const eligible = unlocked.filter((p) => p.progressionTier <= budget.maxTier)

  if (eligible.length === 0) {
    return {
      items: [],
      block,
      placement: placement.placement,
      totalContacts: 0,
      why: 'No plyo drill is open yet at the tier today allows.',
      flag: 'Nothing in the plyo catalog is unlocked for you today — log a foundational session, or enter impact clearance, to open the progression.',
    }
  }

  // Highest tier the budget allows first (that is the stimulus worth having),
  // then cheapest contact load, then catalog order — which is authored as a
  // sensible progression rather than alphabetically.
  const catalogIndex = new Map(PLYOS.map((p, i) => [p.id, i]))
  const preferred = new Set(preferIds)
  const ordered = [...eligible].sort((a, b) => {
    if (preferred.has(a.id) !== preferred.has(b.id)) return preferred.has(a.id) ? -1 : 1
    if (a.progressionTier !== b.progressionTier) return b.progressionTier - a.progressionTier
    const load = CONTACT_LOAD_RANK[a.contactLoad] - CONTACT_LOAD_RANK[b.contactLoad]
    if (load !== 0) return load
    return (catalogIndex.get(a.id) ?? 0) - (catalogIndex.get(b.id) ?? 0)
  })

  const maxDrills =
    placement.placement === 'primer' ? MAX_DRILLS_PRIMER : MAX_DRILLS_STANDALONE
  const chosen = ordered.slice(0, maxDrills)

  const allocation: Array<{ plyo: Plyo; sets: number }> = []
  let used = 0

  for (const plyo of chosen) {
    const cost = CONTACTS_PER_SET[plyo.progressionTier]
    if (used + cost > budget.contacts) break
    allocation.push({ plyo, sets: 1 })
    used += cost
  }

  let added = true
  while (added) {
    added = false
    for (const entry of allocation) {
      if (entry.sets >= MAX_SETS_PER_DRILL) continue
      const cost = CONTACTS_PER_SET[entry.plyo.progressionTier]
      if (used + cost > budget.contacts) continue
      entry.sets += 1
      used += cost
      added = true
    }
  }

  if (allocation.length === 0) {
    return {
      items: [],
      block,
      placement: placement.placement,
      totalContacts: 0,
      why: `Today's budget of ${budget.contacts} contacts is smaller than a single set of anything unlocked.`,
      flag: null,
    }
  }

  return {
    items: allocation.map((a) => contactItem(a.plyo, a.sets)),
    block,
    placement: placement.placement,
    totalContacts: used,
    why: `${placement.reason} ${budget.reason}`,
    flag: budget.rampCapped
      ? `Plyo volume was trimmed to stay under this week's contact ceiling of ${budget.weeklyCeiling}.`
      : null,
  }
}
