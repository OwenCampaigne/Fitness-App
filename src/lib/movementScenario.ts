// ── Movement scenario mode ────────────────────────────────────────────────────
// Framework §16: every feature works in mock mode first. These presets fabricate
// the plyo history and niggle log the Phase 4 engines read, so the escalation
// path, the prerequisite gate and the ACWR ramp can all be exercised without
// waiting for a real bad ankle.
//
// The niggle paths are the ones that matter most here. A logged niggle that
// escalates is rare, slow, and impossible to schedule — and it is also the one
// place the app has to behave perfectly. So it gets a preset.
//
// Controlled by MOVEMENT_SCENARIO in .env.local. Ignored in production.

import { subDays } from 'date-fns'
import type {
  BodyRegion,
  NiggleQuality,
  NiggleRecord,
  NiggleSide,
  PlyoSessionHistory,
  PlyoTier,
} from '../types/movement'

export interface MovementScenario {
  label: string
  niggles: NiggleRecord[]
  plyoHistory: PlyoSessionHistory[]
  /** Plyo ids treated as owned — the prerequisite currency. */
  masteredPlyoIds: string[]
  /** Ground contacts per completed week, oldest first. */
  weeklyContacts: number[]
  contactsThisWeek: number
  /** Clearance for impact work. Entered by a clinician, never by the app (§15). */
  impactCleared: boolean
}

const FOUNDATIONS = ['pogo-jumps', 'ankling', 'a-skips', 'jump-rope-basic']

function plyo(
  daysAgo: number,
  plyoId: string,
  tier: PlyoTier,
  cleanExecution: boolean | null = true,
  sorenessNextDay: number | null = 2,
): PlyoSessionHistory {
  return {
    date: subDays(new Date(), daysAgo),
    plyoId,
    tier,
    contacts: tier === 1 ? 80 : tier === 2 ? 60 : 40,
    cleanExecution,
    sorenessNextDay,
  }
}

/** One report inside an episode that started `startedDaysAgo` ago. */
function niggle(
  startedDaysAgo: number,
  daysAgo: number,
  severity: number,
  over: Partial<NiggleRecord> = {},
): NiggleRecord {
  const now = new Date()
  return {
    date: subDays(now, daysAgo),
    bodyRegion: 'ankle_foot' as BodyRegion,
    side: 'left' as NiggleSide,
    severity,
    quality: 'achy' as NiggleQuality,
    status: 'active',
    firstReportedOn: subDays(now, startedDaysAgo),
    ...over,
  }
}

function buildScenarios(): Record<string, MovementScenario> {
  return {
    // Nothing wrong, foundations owned, a steady contact history to ramp off.
    movement_clear: {
      label: 'No niggles, tier 2 owned, contact load ramping cleanly',
      niggles: [],
      plyoHistory: [
        plyo(24, 'pogo-jumps', 1),
        plyo(17, 'bounding', 2),
        plyo(10, 'box-jumps', 2),
        plyo(3, 'bounding', 2),
      ],
      masteredPlyoIds: [...FOUNDATIONS, 'bounding'],
      weeklyContacts: [200, 220, 240, 260],
      contactsThisWeek: 0,
      impactCleared: true,
    },

    // Cold start. Nothing logged, no clearance — the most conservative posture.
    plyo_untrained: {
      label: 'No plyo history and no impact clearance — foundational only',
      niggles: [],
      plyoHistory: [],
      masteredPlyoIds: [],
      weeklyContacts: [],
      contactsThisWeek: 0,
      impactCleared: false,
    },

    // Foundations clean and repeated: tier 2 should now be reachable.
    plyo_progressing: {
      label: 'Foundations owned, tier 2 unlocking',
      niggles: [],
      plyoHistory: [
        plyo(26, 'pogo-jumps', 1),
        plyo(19, 'a-skips', 1),
        plyo(12, 'pogo-jumps', 1),
        plyo(5, 'jump-rope-basic', 1),
      ],
      masteredPlyoIds: FOUNDATIONS,
      weeklyContacts: [120, 140, 160, 180],
      contactsThisWeek: 0,
      impactCleared: true,
    },

    // Tier 3 was attempted twice and did not hold — the anchor should fall back.
    plyo_overreached: {
      label: 'Contact load spiked and tier 3 did not hold',
      niggles: [],
      plyoHistory: [
        plyo(20, 'depth-jumps', 3, false),
        plyo(16, 'depth-jumps', 3, true, 8),
        plyo(9, 'bounding', 2),
        plyo(2, 'box-jumps', 2),
      ],
      masteredPlyoIds: [...FOUNDATIONS, 'bounding', 'box-jumps', 'broad-jumps'],
      weeklyContacts: [100, 100, 100, 200],
      contactsThisWeek: 0,
      impactCleared: true,
    },

    // The framework's own worked example: "left Achilles, 3/10", steady, recent.
    niggle_achilles: {
      label: 'Left ankle/foot at 3/10 for three days — targeted protocol, watch it',
      niggles: [niggle(2, 2, 3), niggle(2, 0, 3)],
      plyoHistory: [plyo(10, 'pogo-jumps', 1), plyo(3, 'bounding', 2)],
      masteredPlyoIds: [...FOUNDATIONS, 'bounding'],
      weeklyContacts: [200, 220, 240, 260],
      contactsThisWeek: 0,
      impactCleared: true,
    },

    // Climbing over a week. Should escalate on the trend, not on the calendar.
    niggle_escalating: {
      label: 'Left ankle/foot climbing 3 → 6 over six days — escalation path',
      niggles: [niggle(6, 6, 3), niggle(6, 4, 4), niggle(6, 2, 5), niggle(6, 0, 6)],
      plyoHistory: [plyo(12, 'pogo-jumps', 1)],
      masteredPlyoIds: FOUNDATIONS,
      weeklyContacts: [200, 220, 240, 260],
      contactsThisWeek: 0,
      impactCleared: true,
    },

    // Mild, but it has simply not gone away. The ~10–14 day rule (§15).
    niggle_lingering: {
      label: 'Shin at 3/10 for twelve days without settling',
      niggles: [
        niggle(12, 12, 3, { bodyRegion: 'shin', side: 'right' }),
        niggle(12, 6, 3, { bodyRegion: 'shin', side: 'right' }),
        niggle(12, 0, 3, { bodyRegion: 'shin', side: 'right' }),
      ],
      plyoHistory: [plyo(14, 'pogo-jumps', 1)],
      masteredPlyoIds: FOUNDATIONS,
      weeklyContacts: [200, 220, 240, 260],
      contactsThisWeek: 0,
      impactCleared: true,
    },

    // Sharp is where the app stops, whatever the number next to it.
    niggle_sharp: {
      label: 'Knee described as sharp — immediate referral, whatever the severity',
      niggles: [niggle(1, 0, 4, { bodyRegion: 'knee', side: 'right', quality: 'sharp' })],
      plyoHistory: [plyo(10, 'pogo-jumps', 1)],
      masteredPlyoIds: FOUNDATIONS,
      weeklyContacts: [200, 220, 240, 260],
      contactsThisWeek: 0,
      impactCleared: true,
    },

    // Two at once — the combiner has to take the more conservative of them.
    niggle_two_regions: {
      label: 'A mild hip and an escalating shin at the same time',
      niggles: [
        niggle(3, 0, 3, { bodyRegion: 'hip', side: 'left' }),
        niggle(8, 8, 3, { bodyRegion: 'shin', side: 'right' }),
        niggle(8, 4, 5, { bodyRegion: 'shin', side: 'right' }),
        niggle(8, 0, 6, { bodyRegion: 'shin', side: 'right' }),
      ],
      plyoHistory: [plyo(10, 'pogo-jumps', 1)],
      masteredPlyoIds: FOUNDATIONS,
      weeklyContacts: [200, 220, 240, 260],
      contactsThisWeek: 0,
      impactCleared: true,
    },
  }
}

export function getMovementScenario(): MovementScenario | null {
  if (process.env.NODE_ENV === 'production') return null
  const name = process.env.MOVEMENT_SCENARIO
  if (!name) return null
  return buildScenarios()[name] ?? null
}

export function listMovementScenarios(): string[] {
  return Object.keys(buildScenarios())
}

/** Exposed for tests and the scenario picker in dev mode. */
export function movementScenarios(): Record<string, MovementScenario> {
  return buildScenarios()
}
