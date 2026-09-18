// ── Run scenario mode ─────────────────────────────────────────────────────────
// Framework §16. Fabricates the ladder state and anchors the run engine reads,
// so every rung, the pain drop-back and the graduated path can all be exercised
// without waiting months. Controlled by RUN_SCENARIO; ignored in production.

import type { LadderState } from '../types/run'
import type { PaceAnchor } from './runEngine'
import type { RecoveryContext } from '../types/strength'

export interface RunScenario {
  label: string
  ladder: LadderState
  recoveryContext: RecoveryContext
  easyPaceAnchor: PaceAnchor | null
  painLevel: 'none' | 'sometimes' | 'yes'
}

const BASE_CONTEXT: RecoveryContext = {
  surgicalLeg: 'left',
  surgeryDateApprox: '2025-11',
  weeklyRunMinutes: 40,
  longestRunSegmentMin: 20,
}

const BASE_LADDER: LadderState = {
  rungIndex: 0,
  sessionsAtRung: 0,
  painFreeStreak: 0,
  lastVolumeIncreaseWeek: null,
  lastSegmentIncreaseWeek: null,
  graduated: false,
}

export const RUN_SCENARIOS: Record<string, RunScenario> = {
  run_ladder_early: {
    label: 'Rung 2, one session in — no advance yet',
    ladder: { ...BASE_LADDER, rungIndex: 2, sessionsAtRung: 1 },
    recoveryContext: BASE_CONTEXT,
    easyPaceAnchor: null,
    painLevel: 'none',
  },

  run_ladder_ready: {
    label: 'Rung 4, three clean sessions — advance available',
    ladder: { ...BASE_LADDER, rungIndex: 4, sessionsAtRung: 3 },
    recoveryContext: BASE_CONTEXT,
    easyPaceAnchor: null,
    painLevel: 'none',
  },

  run_ladder_capped: {
    label: 'Ready to advance, but the cleared segment length is the ceiling',
    ladder: { ...BASE_LADDER, rungIndex: 7, sessionsAtRung: 3 },
    recoveryContext: { ...BASE_CONTEXT, longestRunSegmentMin: 6 },
    easyPaceAnchor: null,
    painLevel: 'none',
  },

  run_ladder_pain: {
    label: 'Pain flagged mid-ladder — drop a rung and hold',
    ladder: { ...BASE_LADDER, rungIndex: 5, sessionsAtRung: 4 },
    recoveryContext: BASE_CONTEXT,
    easyPaceAnchor: null,
    painLevel: 'yes',
  },

  run_graduated: {
    label: 'Ladder complete, easy running unlocked, pace anchor observed',
    ladder: { ...BASE_LADDER, rungIndex: 12, sessionsAtRung: 3, graduated: true },
    recoveryContext: { ...BASE_CONTEXT, longestRunSegmentMin: 60 },
    easyPaceAnchor: { value: 330, source: 'observed', confidence: 0.55 },
    painLevel: 'none',
  },

  run_no_anchors: {
    label: 'Graduated but every pace anchor is still an estimate — HR targets only',
    ladder: { ...BASE_LADDER, rungIndex: 12, sessionsAtRung: 3, graduated: true },
    recoveryContext: { ...BASE_CONTEXT, longestRunSegmentMin: 60 },
    easyPaceAnchor: { value: 300, source: 'estimate', confidence: 0.2 },
    painLevel: 'none',
  },

  run_no_clearance: {
    label: 'No cleared segment length entered — nothing is offered',
    ladder: BASE_LADDER,
    recoveryContext: { ...BASE_CONTEXT, longestRunSegmentMin: undefined },
    easyPaceAnchor: null,
    painLevel: 'none',
  },
}

export function getRunScenario(): RunScenario | null {
  if (process.env.NODE_ENV === 'production') return null
  const name = process.env.RUN_SCENARIO
  if (!name) return null
  return RUN_SCENARIOS[name] ?? null
}

export function listRunScenarios(): string[] {
  return Object.keys(RUN_SCENARIOS)
}
