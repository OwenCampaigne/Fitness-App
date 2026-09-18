// ── Strength scenario mode ────────────────────────────────────────────────────
// Framework §16: every feature works in mock mode first. These presets fabricate
// the logged history the strength engine reads, so progression, stalling and
// overreaching can all be exercised without waiting weeks for real data.
//
// Controlled by STRENGTH_SCENARIO in .env.local. Ignored in production.

import { subDays } from 'date-fns'
import type { ExerciseSessionHistory, LoggedSet } from '../types/strength'

export interface StrengthScenario {
  label: string
  histories: ExerciseSessionHistory[]
}

let sessionCounter = 1000

function session(
  daysAgo: number,
  exerciseId: string,
  sets: Array<[weight: number | null, reps: number, rir: number]>,
): ExerciseSessionHistory {
  const sessionId = sessionCounter++
  const logged: LoggedSet[] = sets.map(([weightKg, reps, rir], i) => ({
    sessionId,
    exerciseId,
    setNumber: i + 1,
    weightKg,
    reps,
    rir,
  }))
  return { sessionId, date: subDays(new Date(), daysAgo), exerciseId, sets: logged }
}

function buildScenarios(): Record<string, StrengthScenario> {
  sessionCounter = 1000
  return {
    // Cold start — nothing logged. Suggestions should decline to guess.
    strength_fresh: {
      label: 'No history — cold start',
      histories: [],
    },

    // Four weeks of clean work: RIR on target, load climbing steadily.
    strength_progressing: {
      label: '4 weeks of clean logs, loads climbing',
      histories: [
        session(28, 'romanian-deadlift', [[55, 8, 2], [55, 8, 2], [55, 8, 2]]),
        session(21, 'romanian-deadlift', [[57.5, 8, 2], [57.5, 8, 2], [57.5, 8, 2]]),
        session(14, 'romanian-deadlift', [[60, 8, 2], [60, 8, 2], [60, 8, 2]]),
        session(7, 'romanian-deadlift', [[62.5, 8, 2], [62.5, 8, 2], [62.5, 8, 2]]),
        session(21, 'box-squat', [[60, 6, 2], [60, 6, 2], [60, 6, 2]]),
        session(14, 'box-squat', [[62.5, 6, 2], [62.5, 6, 2], [62.5, 6, 2]]),
        session(7, 'box-squat', [[65, 6, 2], [65, 6, 2], [65, 6, 2]]),
        session(7, 'standing-calf-raise', [[40, 10, 2], [40, 10, 2], [40, 10, 2]]),
      ],
    },

    // The same loads keep coming in harder than prescribed → deload trigger.
    strength_stalled: {
      label: 'RIR falling at unchanged load — deload should fire',
      histories: [
        session(21, 'romanian-deadlift', [[62.5, 8, 2], [62.5, 8, 2], [62.5, 8, 2]]),
        session(14, 'romanian-deadlift', [[62.5, 8, 1], [62.5, 7, 1], [62.5, 7, 0]]),
        session(7, 'romanian-deadlift', [[62.5, 7, 0], [62.5, 6, 0], [62.5, 5, 0]]),
        session(3, 'romanian-deadlift', [[62.5, 6, 0], [62.5, 5, 0], [62.5, 5, 0]]),
      ],
    },

    // Weekly hard sets above MRV two weeks running.
    strength_overreached: {
      label: 'Above MRV two weeks running',
      histories: [
        ...[13, 12, 11, 10, 9, 8].map((d) =>
          session(d, 'romanian-deadlift', [[60, 8, 2], [60, 8, 2], [60, 8, 2]]),
        ),
        ...[6, 5, 4, 3, 2, 1].map((d) =>
          session(d, 'romanian-deadlift', [[60, 8, 2], [60, 8, 2], [60, 8, 2]]),
        ),
      ],
    },
  }
}

export function getStrengthScenario(): StrengthScenario | null {
  if (process.env.NODE_ENV === 'production') return null
  const name = process.env.STRENGTH_SCENARIO
  if (!name) return null
  return buildScenarios()[name] ?? null
}

export function listStrengthScenarios(): string[] {
  return Object.keys(buildScenarios())
}
