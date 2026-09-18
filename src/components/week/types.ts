// ── What the week screen talks to ─────────────────────────────────────────────
// The wire shape of `/api/session/week` and `/api/session/move`. Everything else
// the screen posts — patch, undo — reuses the Today screen's own response types,
// because it is posting to the identical routes.

import type { SessionBlock } from '@/types/session'
import type { ValidationVerdict } from '@/types/patch'
import type { ReadinessBand } from '@/types/readiness'
import type { WeekDaySummary, WeekTotals } from '@/lib/weekPlan'
import type { PatchResponse, TodayResponse } from '@/components/today/types'

export interface WeekDayResponse {
  date: string
  isToday: boolean
  /** True when you or the coach wrote this day — the planner leaves it alone. */
  edited: boolean
  session: TodayResponse['session']
  blocks: SessionBlock[]
  summary: WeekDaySummary
  priority: 'A' | 'B' | 'C'
  why: string
  ceiling: number
  verdictFlags: Array<{ code: string; message: string; source: string }>
  changedVsPlan: TodayResponse['changedVsPlan']
}

export interface WeekResponse {
  start: string
  days: WeekDayResponse[]
  totals: WeekTotals
  disclaimer: string
  band: ReadinessBand
  scenarioMode: Record<string, string> | null
  error?: string
}

/**
 * A move's answer, shaped as a `PatchResponse` on purpose.
 *
 * The destination day's verdict *is* the move's verdict — it is the half that
 * can be refused — so `PatchReview` renders it with no idea a second day was
 * involved. `movedFrom` is the receipt for the source, null when nothing left it.
 */
export interface MoveResponse extends PatchResponse {
  date?: string
  movedFrom?: {
    date: string
    applied: boolean
    version: number
    blocks: SessionBlock[]
    verdict: ValidationVerdict
  } | null
}
