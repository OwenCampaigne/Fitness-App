// ── What the Today screen talks to ────────────────────────────────────────────
// The wire shapes of the five session routes and the catalog the server hands
// down. Kept in one file so a route change breaks a type rather than a screen.

import type { EditActor, SessionBlock, SessionStatus } from '@/types/session'
import type { SessionDiff, SessionPatch, ValidationVerdict } from '@/types/patch'
import type { ReadinessBand } from '@/types/readiness'

export interface TodayResponse {
  session: {
    id: number | null
    date: string | null
    version: number
    status: SessionStatus
    sourceOfLastEdit: EditActor | null
  }
  blocks: SessionBlock[]
  /**
   * §14 step 6 — the day's `set_logs`, keyed by the card that owns them, in the
   * same shape `POST /api/session/log` answers with. Optional only because a
   * failed fetch is cast to this type.
   */
  loggedSets?: Record<string, LoggedSetRow[]>
  budget: {
    ceiling: number
    target: number
    floor: number
    acwr: number
    band: ReadinessBand
    calibrating: boolean
    reasons: string[]
  }
  verdictFlags: Array<{ code: string; message: string; source: string }>
  why: string
  changedVsPlan: {
    changed: boolean
    summary: string
    entries: Array<{
      itemId: string
      name: string
      modality: string
      outcome: string
      code: string
      reason: string
    }>
  }
  /** §15 — returned on every response that can carry prehab. Never hardcoded here. */
  disclaimer: string
  readiness: {
    band: ReadinessBand
    provisional: boolean
    plainText: string
    decidingSignals: [string, string]
    painFlagged: boolean
  }
  scenarioMode: Record<string, string> | null
  error?: string
}

export interface PatchResponse {
  applied: boolean
  verdict: ValidationVerdict
  blocks: SessionBlock[]
  version: number
  diff: SessionDiff
  disclaimer?: string
  error?: string
}

export interface UndoResponse extends PatchResponse {
  undoneEditId: number | null
}

export interface LoggedSetRow {
  id?: number
  itemId?: string | null
  exerciseId?: string | null
  setNumber: number
  weightKg?: number | null
  reps?: number | null
  rir?: number | null
  contacts?: number | null
  holdSec?: number | null
}

export interface LogResponse {
  ok: boolean
  sets: LoggedSetRow[]
  disclaimer?: string
  error?: string
}

export interface CompleteResponse {
  ok: boolean
  actualLoad: number
  actualDurationMin: number
  srpe: number
  error?: string
}

/**
 * What `POST /api/coach` answers with.
 *
 * It previews by default (§11-A: shows a diff; you confirm; it applies), so a
 * successful answer carries `preview: true`, `applied: false`, and the patch
 * the athlete has not yet agreed to. Confirming it is a post to
 * `/api/session/patch` with `actor: 'coach'` — the same funnel the tap-to-edit
 * path uses — where it is validated again against the session as it is then.
 *
 * Every field is optional because the route has six distinct shapes (no key,
 * network, out of contract, preference violation, preview, applied) and a
 * screen that hard-failed on an unexpected one would be worse than one that
 * shows the reply it did get (§16).
 */
export interface CoachResponse {
  reply?: string | null
  available?: boolean
  /** True when nothing was persisted and the patch is waiting on a confirmation. */
  preview?: boolean
  applied?: boolean
  patch?: SessionPatch | null
  verdict?: ValidationVerdict | null
  counterProposal?: SessionPatch | null
  diff?: SessionDiff | null
  blocks?: SessionBlock[] | null
  version?: number
  deload?: { triggered: boolean; applied: boolean; reasons: string[]; severity: string } | null
  rejected?: string
  reason?: string
  disclaimer?: string
  error?: string
}

// ── The catalog (§12) ─────────────────────────────────────────────────────────
// Lives in `todayView` so it is built and diagnosis-checked where it can be
// tested, and re-exported here so components import their props from one place.

export { catalogKey } from '@/lib/todayView'
export type { Catalog, CatalogEntry } from '@/lib/todayView'
