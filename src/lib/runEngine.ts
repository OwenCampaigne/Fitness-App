// ── Run engine ────────────────────────────────────────────────────────────────
// Deterministic selection and safety rails for running (framework §7). Pure and
// DB-free throughout, like the strength engine: math and safety live here,
// judgment and explanation belong to the Claude layer (§10).

import rawRungs from '../data/ladder-rungs.json'
import type { ReadinessBand } from '../types/readiness'
import type { AnchorSource } from '../types/strength'
import type {
  LadderDecision,
  LadderRung,
  LadderState,
  RunEligibilityContext,
  RunPrescription,
  RunType,
  RunTypeDef,
  TargetKind,
} from '../types/run'

export const LADDER_RUNGS: LadderRung[] = rawRungs as LadderRung[]

// ── Taxonomy ──────────────────────────────────────────────────────────────────

export const RUN_TYPES: Record<RunType, RunTypeDef> = {
  rest: {
    type: 'rest',
    label: 'Rest',
    purpose: 'Nothing today. Adaptation happens now, not during the session.',
    intensityCost: 0,
    requires: {},
  },
  walk: {
    type: 'walk',
    label: 'Walk',
    purpose: 'Movement and circulation without impact loading.',
    intensityCost: 2,
    requires: {},
  },
  walk_run: {
    type: 'walk_run',
    label: 'Walk/run intervals',
    purpose: 'Rebuild running tolerance in measured doses.',
    intensityCost: 3,
    requires: {},
  },
  recovery: {
    type: 'recovery',
    label: 'Recovery run',
    purpose: 'Flush the legs at minimal cost.',
    intensityCost: 3,
    requires: { ladderGraduated: true },
  },
  easy: {
    type: 'easy',
    label: 'Easy run',
    purpose: 'Aerobic base. This is meant to be most of the weekly volume.',
    intensityCost: 4,
    requires: { ladderGraduated: true },
  },
  long: {
    type: 'long',
    label: 'Long run',
    purpose: 'Durability — holding form and pace as fatigue accumulates.',
    intensityCost: 5,
    requires: { ladderGraduated: true, weeksOfBase: 8 },
  },
  steady: {
    type: 'steady',
    label: 'Steady run',
    purpose: 'Sustained aerobic work below threshold.',
    intensityCost: 6,
    requires: { ladderGraduated: true, weeksOfBase: 4 },
  },
  tempo: {
    type: 'tempo',
    label: 'Tempo / threshold',
    purpose: 'Push the pace you can hold for an hour.',
    intensityCost: 7,
    requires: { ladderGraduated: true, weeksOfBase: 6, lthrAnchor: 'observed' },
  },
  vo2: {
    type: 'vo2',
    label: 'VO₂ intervals',
    purpose: 'Maximal aerobic power.',
    intensityCost: 9,
    requires: { ladderGraduated: true, weeksOfBase: 10, lthrAnchor: 'confirmed' },
  },
  strides: {
    type: 'strides',
    label: 'Strides',
    purpose: 'Neuromuscular sharpness at almost no aerobic cost.',
    intensityCost: 4,
    requires: { ladderGraduated: true },
  },
  hills: {
    type: 'hills',
    label: 'Hill repeats',
    purpose: 'Strength-endurance with less impact than flat speed work.',
    intensityCost: 7,
    requires: { ladderGraduated: true, weeksOfBase: 6, impactCleared: true },
  },
  progression: {
    type: 'progression',
    label: 'Progression run',
    purpose: 'Practise finishing faster than you started.',
    intensityCost: 6,
    requires: { ladderGraduated: true, weeksOfBase: 6 },
  },
  fartlek: {
    type: 'fartlek',
    label: 'Fartlek',
    purpose: 'Unstructured speed play — variety without a rigid target.',
    intensityCost: 6,
    requires: { ladderGraduated: true, weeksOfBase: 6 },
  },
}

const ANCHOR_RANK: Record<AnchorSource, number> = { estimate: 0, observed: 1, confirmed: 2 }

/** Whether a run type is reachable given what the system currently knows. */
export function isRunTypeEligible(type: RunType, ctx: RunEligibilityContext): boolean {
  const req = RUN_TYPES[type].requires

  if (req.ladderGraduated && !ctx.ladderGraduated) return false
  if (req.weeksOfBase !== undefined && ctx.weeksOfBase < req.weeksOfBase) return false
  if (req.impactCleared && !ctx.impactCleared) return false
  if (req.lthrAnchor && ANCHOR_RANK[ctx.lthrAnchorSource] < ANCHOR_RANK[req.lthrAnchor]) {
    return false
  }
  return true
}

export function eligibleRunTypes(ctx: RunEligibilityContext): RunType[] {
  return (Object.keys(RUN_TYPES) as RunType[]).filter((t) => isRunTypeEligible(t, ctx))
}

// ── Ladder ────────────────────────────────────────────────────────────────────

/** ISO-ish week key, used to enforce one advance of each kind per week. */
export function weekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function rungAt(index: number): LadderRung {
  const clamped = Math.min(LADDER_RUNGS.length - 1, Math.max(0, index))
  return LADDER_RUNGS[clamped]
}

export function rungTotalRunMin(rung: LadderRung): number {
  return Math.round(((rung.runSec * rung.reps) / 60) * 10) / 10
}

export function rungTotalDurationMin(rung: LadderRung): number {
  // The final walk break is not served — you stop when the last rep ends.
  const walk = rung.walkSec * Math.max(0, rung.reps - 1)
  return Math.round(((rung.runSec * rung.reps + walk) / 60) * 10) / 10
}

/** The highest rung permitted by an entered clearance ceiling, in minutes. */
export function highestRungWithinCeiling(longestRunSegmentMin: number | null): number {
  // No clearance entered is not the same as "cleared for the first rung".
  // Nothing is offered until a number comes back from a clinician.
  if (!longestRunSegmentMin || longestRunSegmentMin <= 0) return -1
  const ceilingSec = longestRunSegmentMin * 60
  let best = -1
  for (const rung of LADDER_RUNGS) {
    if (rung.runSec <= ceilingSec) best = rung.index
  }
  // If even the first rung exceeds the ceiling, the ceiling governs and the
  // athlete is not yet cleared for the ladder at all.
  return best
}

export interface LadderInput {
  state: LadderState
  today: Date
  band: ReadinessBand
  painLevel: 'none' | 'sometimes' | 'yes'
  /** Hard ceiling from the profile — a clinician's number, not the app's. */
  longestRunSegmentMin: number | null
  /** Tightens the ramp while calibration is still provisional. */
  provisional: boolean
  /** Sessions required at a rung before the segment may lengthen. */
  sessionsRequired?: number
}

/**
 * Decide today's rung.
 *
 * Three rules, in priority order:
 *   1. Never advance two dimensions in the same week — segment length or
 *      volume, not both. This is the rule most often broken in practice and
 *      the one most responsible for re-injury.
 *   2. Segment length advances on evidence (completed sessions, pain-free),
 *      never on a schedule.
 *   3. The clearance ceiling always wins. The app does not raise it.
 */
export function decideLadder(input: LadderInput): LadderDecision {
  const {
    state,
    today,
    band,
    painLevel,
    longestRunSegmentMin,
    provisional,
    sessionsRequired = 3,
  } = input

  const current = rungAt(state.rungIndex)
  const thisWeek = weekKey(today)
  const ceilingIndex = highestRungWithinCeiling(longestRunSegmentMin)

  if (state.graduated) {
    return {
      action: 'graduated',
      rung: rungAt(LADDER_RUNGS.length - 1),
      reason: 'Ladder complete — continuous easy running is unlocked.',
    }
  }

  // Nothing is cleared yet: the ceiling is below even the first rung.
  if (ceilingIndex < 0) {
    return {
      action: 'capped_by_clearance',
      rung: current,
      reason:
        'No continuous-running clearance entered yet, so no ladder rung is offered. Today is a walk. Enter your longest cleared run segment on the profile page — that number comes from your surgeon or PT.',
      blockedByCeiling: true,
      noRungAvailable: true,
    }
  }

  // ── Pain overrides everything ───────────────────────────────────────────────
  if (painLevel === 'yes') {
    const dropped = rungAt(Math.max(0, state.rungIndex - 1))
    return {
      action: 'drop_back',
      rung: dropped,
      reason: `Knee pain flagged — back to ${dropped.label} and holding there until three sessions come and go pain-free.`,
    }
  }

  if (painLevel === 'sometimes') {
    return {
      action: 'hold',
      rung: current,
      reason: `Intermittent pain flagged — holding at ${current.label} rather than advancing.`,
    }
  }

  // A drop-back has to be earned back before anything else can advance.
  if (state.painFreeStreak > 0 && state.painFreeStreak < 3) {
    return {
      action: 'hold',
      rung: current,
      reason: `${3 - state.painFreeStreak} more pain-free session(s) at ${current.label} before advancing again.`,
    }
  }

  // ── Readiness gates the advance, not the session ────────────────────────────
  if (band === 'red') {
    return {
      action: 'hold',
      rung: current,
      reason: 'Red day — no rung advance. Today is a walk.',
    }
  }

  if (band === 'amber') {
    return {
      action: 'hold',
      rung: current,
      reason: `Amber day — holding at ${current.label}. Advances happen on green days only.`,
    }
  }

  // ── Rule 1: one dimension per week ──────────────────────────────────────────
  const segmentAdvancedThisWeek = state.lastSegmentIncreaseWeek === thisWeek
  const volumeAdvancedThisWeek = state.lastVolumeIncreaseWeek === thisWeek

  if (segmentAdvancedThisWeek || volumeAdvancedThisWeek) {
    const which = segmentAdvancedThisWeek ? 'segment length' : 'volume'
    return {
      action: 'hold',
      rung: current,
      reason: `Already advanced ${which} this week — only one dimension moves per week.`,
    }
  }

  // ── Rule 2: segment length advances on evidence ─────────────────────────────
  if (state.sessionsAtRung < sessionsRequired) {
    const remaining = sessionsRequired - state.sessionsAtRung
    return {
      action: 'hold',
      rung: current,
      reason: `${remaining} more clean session(s) at ${current.label} before the run segment gets longer.`,
    }
  }

  const nextIndex = state.rungIndex + 1

  // Ladder complete.
  if (nextIndex >= LADDER_RUNGS.length) {
    return {
      action: 'graduated',
      rung: current,
      reason: 'Twenty minutes continuous, three times, pain-free — the ladder is done.',
    }
  }

  // ── Rule 3: the clearance ceiling wins ──────────────────────────────────────
  if (nextIndex > ceilingIndex) {
    return {
      action: 'capped_by_clearance',
      rung: current,
      reason: `Ready for a longer segment, but ${longestRunSegmentMin} minutes is the longest you have entered as cleared. Raising that is a conversation with your surgeon or PT, not something this app decides.`,
      blockedByCeiling: true,
    }
  }

  const next = rungAt(nextIndex)

  // Provisional calibration tightens the step: only advance if the jump in
  // total running time stays inside 5% rather than the usual 10%.
  const growth = (rungTotalRunMin(next) - rungTotalRunMin(current)) / rungTotalRunMin(current)
  const cap = provisional ? 0.05 : 0.1

  if (growth > cap) {
    return {
      action: 'advance_segment',
      rung: next,
      reason: `Three clean sessions at ${current.label} — stepping up to ${next.label}. Total running time rises ${Math.round(growth * 100)}%, so volume stays put this week.`,
    }
  }

  return {
    action: 'advance_segment',
    rung: next,
    reason: `Three clean sessions at ${current.label} — stepping up to ${next.label}.`,
  }
}

// ── Readiness gating for a graduated runner ───────────────────────────────────

export interface RunReadinessAdjustment {
  band: ReadinessBand
  /** The type actually prescribed after the veto. */
  type: RunType
  /** Multiplier on planned duration. */
  durationFactor: number
  /** The long run is moved, never cut (§7). */
  deferLongRun: boolean
  summary: string
}

const HARD_TYPES = new Set<RunType>(['tempo', 'vo2', 'hills', 'progression', 'fartlek', 'steady'])

export function applyRunReadiness(
  plannedType: RunType,
  band: ReadinessBand,
  painFlagged = false,
): RunReadinessAdjustment {
  if (painFlagged) {
    return {
      band,
      type: 'walk',
      durationFactor: 1,
      deferLongRun: plannedType === 'long',
      summary: 'Pain flagged — walking today, no running.',
    }
  }

  if (band === 'red') {
    // Still on the ladder: a red day is a walk, not a recovery *run* — that
    // would be continuous running the athlete is not cleared for.
    if (plannedType === 'walk_run') {
      return {
        band,
        type: 'walk',
        durationFactor: 1,
        deferLongRun: false,
        summary: 'Red day — walking instead of the walk/run session.',
      }
    }
    if (plannedType === 'long') {
      return {
        band,
        type: 'rest',
        durationFactor: 0,
        deferLongRun: true,
        summary: 'Red day — the long run moves rather than gets cut. Rest today.',
      }
    }
    return {
      band,
      type: HARD_TYPES.has(plannedType) ? 'rest' : 'recovery',
      durationFactor: 0.5,
      deferLongRun: false,
      summary: 'Red day — hard work is off. Recovery or rest only.',
    }
  }

  if (band === 'amber') {
    if (HARD_TYPES.has(plannedType)) {
      return {
        band,
        type: plannedType,
        durationFactor: 0.75,
        deferLongRun: false,
        summary: 'Amber day — session kept, but trimmed: the hardest element comes off.',
      }
    }
    if (plannedType === 'long') {
      return {
        band,
        type: 'long',
        durationFactor: 0.8,
        deferLongRun: false,
        summary: 'Amber day — long run shortened about 20%, not dropped.',
      }
    }
    return {
      band,
      type: plannedType,
      durationFactor: 0.9,
      deferLongRun: false,
      summary: 'Amber day — a touch shorter than planned.',
    }
  }

  return {
    band,
    type: plannedType,
    durationFactor: 1,
    deferLongRun: false,
    summary: 'Green day — session stands as planned.',
  }
}

// ── Targets: pace only when it has been earned ────────────────────────────────

export interface PaceAnchor {
  value: number | null // sec/km
  source: AnchorSource
  confidence?: number
}

export interface HrZones {
  z2Ceiling: number | null
  lthr: number | null
  maxHr: number | null
}

export interface TargetResolution {
  kind: TargetKind
  paceSecPerKm: number | null
  hrLow: number | null
  hrHigh: number | null
  note: string
}

/**
 * Choose what to prescribe as the target.
 *
 * The rule that matters: **a pace anchor at `estimate` is never handed over as
 * a target.** An invented pace is the fastest way to make someone chase a
 * number the system made up. Heart rate, or plain effort, until the pace is
 * observed in the athlete's own training.
 */
export function resolveTarget(
  type: RunType,
  anchor: PaceAnchor | null,
  zones: HrZones,
  ladderGraduated: boolean,
): TargetResolution {
  // During return-to-run, pace is an output to be watched, never a target.
  if (!ladderGraduated || type === 'walk_run' || type === 'walk') {
    if (zones.z2Ceiling) {
      return {
        kind: 'heart_rate',
        paceSecPerKm: null,
        hrLow: null,
        hrHigh: zones.z2Ceiling,
        note: `Keep the run segments under ${zones.z2Ceiling} bpm. Pace is something to watch right now, not something to hit.`,
      }
    }
    return {
      kind: 'effort',
      paceSecPerKm: null,
      hrLow: null,
      hrHigh: null,
      note: 'Conversational effort — you should be able to talk in full sentences throughout. No pace target while you are rebuilding.',
    }
  }

  if (type === 'rest') {
    return { kind: 'effort', paceSecPerKm: null, hrLow: null, hrHigh: null, note: 'Rest.' }
  }

  if (anchor && anchor.value !== null && anchor.source !== 'estimate') {
    return {
      kind: 'pace',
      paceSecPerKm: anchor.value,
      hrLow: null,
      hrHigh: zones.z2Ceiling,
      note:
        anchor.source === 'confirmed'
          ? 'Pace target from your own confirmed training data.'
          : 'Pace target from your training data — still firming up, so treat the range loosely.',
    }
  }

  if (zones.z2Ceiling) {
    return {
      kind: 'heart_rate',
      paceSecPerKm: null,
      hrLow: null,
      hrHigh: zones.z2Ceiling,
      note: `No confirmed pace for this yet, so the target is heart rate: stay under ${zones.z2Ceiling} bpm. Once a few runs land, this becomes a pace.`,
    }
  }

  return {
    kind: 'effort',
    paceSecPerKm: null,
    hrLow: null,
    hrHigh: null,
    note: 'No pace or heart-rate anchor established yet — go by effort and the app will learn from what you do.',
  }
}

// ── Assembling the prescription ───────────────────────────────────────────────

export interface PrescribeInput {
  ladder: LadderDecision
  adjustment: RunReadinessAdjustment
  target: TargetResolution
  /** Planned duration for a graduated runner, in minutes. */
  plannedDurationMin?: number
}

export function prescribeRun(input: PrescribeInput): RunPrescription {
  const { ladder, adjustment, target, plannedDurationMin } = input
  const band = adjustment.band

  // Still on the ladder.
  if (ladder.action !== 'graduated') {
    // Nothing cleared means nothing with running in it, whatever the band says.
    if (ladder.noRungAvailable) {
      return {
        type: 'walk',
        label: RUN_TYPES.walk.label,
        durationMin: 20,
        runMin: 0,
        targetKind: 'effort',
        targetNote: 'Easy walking — movement without impact.',
        why: ladder.reason,
        band,
        changed: null,
      }
    }

    if (adjustment.type === 'walk' || adjustment.type === 'rest') {
      const isRest = adjustment.type === 'rest'
      return {
        type: adjustment.type,
        label: RUN_TYPES[adjustment.type].label,
        durationMin: isRest ? 0 : 20,
        runMin: 0,
        targetKind: 'effort',
        targetNote: isRest ? 'Rest.' : 'Easy walking — movement without impact.',
        why: adjustment.summary,
        band,
        changed: adjustment.summary,
      }
    }

    const rung = ladder.rung
    return {
      type: 'walk_run',
      label: RUN_TYPES.walk_run.label,
      durationMin: rungTotalDurationMin(rung),
      runMin: rungTotalRunMin(rung),
      intervals: [
        {
          repeat: rung.reps,
          workSec: rung.runSec,
          recoverSec: rung.walkSec,
          label: rung.label,
        },
      ],
      targetKind: target.kind,
      targetPaceSecPerKm: target.paceSecPerKm,
      targetHrLow: target.hrLow,
      targetHrHigh: target.hrHigh,
      targetNote: target.note,
      why: ladder.reason,
      band,
      changed: band === 'green' ? null : adjustment.summary,
    }
  }

  // Graduated.
  const base = plannedDurationMin ?? 30
  const duration = Math.round(base * adjustment.durationFactor)

  return {
    type: adjustment.type,
    label: RUN_TYPES[adjustment.type].label,
    durationMin: duration,
    runMin: duration,
    targetKind: target.kind,
    targetPaceSecPerKm: target.paceSecPerKm,
    targetHrLow: target.hrLow,
    targetHrHigh: target.hrHigh,
    targetNote: target.note,
    why: RUN_TYPES[adjustment.type].purpose,
    band,
    changed: adjustment.durationFactor === 1 && band === 'green' ? null : adjustment.summary,
  }
}
