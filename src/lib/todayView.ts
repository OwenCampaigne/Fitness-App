// ── The Today screen's view model ─────────────────────────────────────────────
// Framework §14. The Today screen is the product, which makes "what does this
// card actually say" a correctness question rather than a styling one: a plyo
// that renders its sets as reps, a diff that claims nothing changed when
// something did, or a prehab line that leaks a condition name are all bugs you
// cannot see in a screenshot.
//
// So none of that judgement lives in a component. This file is pure — no React,
// no fetch, no Prisma — and every function here is asserted against literals in
// `__tests__/todayView.test.ts`. Components are left with layout.

import { containsDiagnosisLanguage } from './prehabEngine'
import type {
  BlockKind,
  ItemKind,
  ItemParams,
  ItemStatus,
  SessionBlock,
  SessionItem,
} from '../types/session'
import type {
  ModifyOp,
  PatchOp,
  RuleFinding,
  SessionDiff,
  ValidationVerdict,
} from '../types/patch'

// ── Ordering the stack ────────────────────────────────────────────────────────

/** warmup → main → accessory → cooldown. The order of §14 step 3, not the DB's. */
export const BLOCK_ORDER: BlockKind[] = ['warmup', 'main', 'accessory', 'cooldown']

const BLOCK_FALLBACK_LABELS: Record<BlockKind, string> = {
  warmup: 'Warm-up',
  main: 'Main',
  accessory: 'Accessory',
  cooldown: 'Cool-down',
}

/**
 * The card stack, in the order it is trained in.
 *
 * An empty block is dropped rather than rendered as a bare heading: a session
 * with no cool-down should look like a session with no cool-down, not like one
 * that failed to load.
 */
export function orderBlocks(blocks: SessionBlock[]): SessionBlock[] {
  const withItems = blocks.filter((b) => b.items.length > 0)
  return [...withItems].sort(
    (a, b) => BLOCK_ORDER.indexOf(a.kind) - BLOCK_ORDER.indexOf(b.kind),
  )
}

export function blockTitle(block: Pick<SessionBlock, 'kind' | 'label'>): string {
  const label = block.label?.trim()
  return label && label.length > 0 ? label : (BLOCK_FALLBACK_LABELS[block.kind] ?? block.kind)
}

export function countItems(blocks: SessionBlock[]): number {
  return blocks.reduce((n, b) => n + b.items.length, 0)
}

export function allItems(blocks: SessionBlock[]): SessionItem[] {
  return orderBlocks(blocks).flatMap((b) => b.items)
}

// ── Formatting a prescription ─────────────────────────────────────────────────

/** `330` → `5:30 /km`. Null for a missing or nonsensical pace. */
export function formatPace(secPerKm: number | null | undefined): string | null {
  if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0) return null
  const min = Math.floor(secPerKm / 60)
  const sec = Math.round(secPerKm % 60)
  // 5:60 is 6:00. Rounding must not print a clock face that does not exist.
  const carry = sec === 60
  return `${carry ? min + 1 : min}:${String(carry ? 0 : sec).padStart(2, '0')} /km`
}

/** Seconds → `3 min`, `90 s`, `2:30`. Used for interval legs. */
export function formatSeconds(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} s`
  if (sec % 60 === 0) return `${sec / 60} min`
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
}

/** Run type ids are snake_case in the engine and sentences on screen. */
export function humanizeToken(token: string): string {
  const spaced = token.replace(/[_-]+/g, ' ').trim()
  if (spaced.length === 0) return token
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * The one line under the card's name — the prescription, concrete (§10 step 2).
 *
 * Deliberately not `describeParams` from `session.ts`: that one is written for
 * the diff, where density wins, and this one is written for a thumb at 6am.
 */
export function prescriptionLine(params: ItemParams): string {
  if (params.kind === 'strength') {
    const reps =
      params.repsMin != null && params.repsMin !== params.reps
        ? `${params.repsMin}–${params.reps}`
        : `${params.reps}`
    const load = params.weightKg == null ? 'bodyweight' : `@ ${params.weightKg} kg`
    return `${params.sets} × ${reps} ${load} · RIR ${params.targetRir}`
  }

  if (params.kind === 'run') {
    const parts: string[] = []
    if (params.durationMin != null && params.durationMin > 0) parts.push(`${params.durationMin} min`)
    if (params.distanceKm != null && params.distanceKm > 0) {
      parts.push(`${Number(params.distanceKm.toFixed(2))} km`)
    }
    const pace = formatPace(params.targetPaceSecPerKm)
    if (pace) parts.push(pace)
    if (parts.length === 0) parts.push(humanizeToken(params.runType))
    return parts.join(' · ')
  }

  if (params.kind === 'contacts') {
    const total = params.sets * params.contactsPerSet
    return `${params.sets} × ${params.contactsPerSet} contacts · ${total} total`
  }

  // Hold params — prehab and stretching, dosed in reps or holds (§9).
  const parts: string[] = []
  if (params.reps != null && params.reps > 0) parts.push(`${params.sets} × ${params.reps}`)
  else parts.push(`${params.sets} ${params.sets === 1 ? 'set' : 'sets'}`)
  if (params.holdSec != null && params.holdSec > 0) parts.push(`${params.holdSec} s hold`)
  if (params.perSide) parts.push('each side')
  return parts.join(' · ')
}

/** The secondary lines — targets a card shows but does not lead with. */
export function prescriptionDetails(params: ItemParams): string[] {
  const out: string[] = []

  if (params.kind === 'run') {
    if (params.targetHrLow != null && params.targetHrHigh != null) {
      out.push(`Heart rate ${params.targetHrLow}–${params.targetHrHigh} bpm`)
    } else if (params.targetHrHigh != null) {
      out.push(`Heart rate under ${params.targetHrHigh} bpm`)
    }
    for (const leg of params.intervals ?? []) {
      const recover =
        leg.recoverSec > 0 ? ` / ${formatSeconds(leg.recoverSec)} recover` : ''
      out.push(
        `${leg.repeat} × ${formatSeconds(leg.workSec)}${recover}${leg.label ? ` — ${leg.label}` : ''}`,
      )
    }
    return out
  }

  if (params.kind === 'strength' && params.restSec != null && params.restSec > 0) {
    out.push(`Rest ${formatSeconds(params.restSec)}`)
  }
  if (params.kind === 'contacts' && params.restSec != null && params.restSec > 0) {
    out.push(`Rest ${formatSeconds(params.restSec)} between sets`)
  }
  return out
}

// ── Logging ───────────────────────────────────────────────────────────────────

/** A run is logged by Garmin and by completing the day, never set by set (§14). */
export const LOGGABLE_KINDS: ItemKind[] = ['exercise', 'plyo', 'prehab', 'stretch']

export function isLoggable(kind: ItemKind): boolean {
  return LOGGABLE_KINDS.includes(kind)
}

/** How many sets the card is asking for. Zero when the idea does not apply. */
export function plannedSets(params: ItemParams): number {
  if (params.kind === 'run') return 0
  return Math.max(0, Math.round(params.sets))
}

export type LogField = 'weightKg' | 'reps' | 'rir' | 'contacts' | 'holdSec'

/**
 * Which steppers a card's logger shows.
 *
 * Driven by the params, not the item kind, so a bodyweight lift loses its
 * weight stepper and a rep-dosed stretch loses its hold stepper without either
 * card knowing anything special about itself.
 */
export function logFields(params: ItemParams): LogField[] {
  if (params.kind === 'strength') {
    const fields: LogField[] = []
    if (params.weightKg !== null) fields.push('weightKg')
    fields.push('reps', 'rir')
    return fields
  }
  if (params.kind === 'contacts') return ['contacts']
  if (params.kind === 'hold') {
    const fields: LogField[] = []
    if (params.reps != null && params.reps > 0) fields.push('reps')
    if (params.holdSec != null && params.holdSec > 0) fields.push('holdSec')
    return fields.length > 0 ? fields : ['reps']
  }
  return []
}

export type LogValues = Partial<Record<LogField, number>>

/** The logger opens on what was prescribed — most sets are logged as written. */
export function defaultLogValues(params: ItemParams): LogValues {
  if (params.kind === 'strength') {
    return {
      ...(params.weightKg !== null ? { weightKg: params.weightKg } : {}),
      reps: params.reps,
      rir: params.targetRir,
    }
  }
  if (params.kind === 'contacts') return { contacts: params.contactsPerSet }
  if (params.kind === 'hold') {
    return {
      ...(params.reps != null && params.reps > 0 ? { reps: params.reps } : {}),
      ...(params.holdSec != null && params.holdSec > 0 ? { holdSec: params.holdSec } : {}),
      ...(params.reps == null && params.holdSec == null ? { reps: 1 } : {}),
    }
  }
  return {}
}

/** Bounds mirroring the ones `/api/session/log` enforces, so a stepper cannot 400. */
export const LOG_FIELD_BOUNDS: Record<LogField, { min: number; max: number; step: number }> = {
  weightKg: { min: 0, max: 500, step: 2.5 },
  reps: { min: 0, max: 200, step: 1 },
  rir: { min: 0, max: 10, step: 1 },
  contacts: { min: 0, max: 500, step: 5 },
  holdSec: { min: 0, max: 600, step: 5 },
}

export interface LoggedSetLike {
  setNumber: number
  weightKg?: number | null
  reps?: number | null
  rir?: number | null
  contacts?: number | null
  holdSec?: number | null
}

export interface ItemProgress {
  done: number
  total: number
  complete: boolean
  nextSetNumber: number
}

/**
 * Where a card is up to.
 *
 * Counts distinct set numbers rather than rows, because re-logging set 2 is a
 * correction, not a second set — and a card that counted it twice would tell
 * the athlete they were finished when they were not.
 */
export function itemProgress(params: ItemParams, logged: LoggedSetLike[]): ItemProgress {
  const total = plannedSets(params)
  const numbers = new Set(logged.map((s) => s.setNumber))
  const done = numbers.size
  let next = 1
  while (numbers.has(next)) next += 1
  return { done, total, complete: total > 0 && done >= total, nextSetNumber: next }
}

/** One logged set, as the card reads it back. */
export function describeLoggedSet(params: ItemParams, set: LoggedSetLike): string {
  if (params.kind === 'contacts') return `${set.contacts ?? 0} contacts`
  if (params.kind === 'hold') {
    const parts: string[] = []
    if (set.reps != null) parts.push(`${set.reps} reps`)
    if (set.holdSec != null) parts.push(`${set.holdSec} s`)
    return parts.length > 0 ? parts.join(' · ') : 'done'
  }
  const parts: string[] = []
  if (set.weightKg != null) parts.push(`${set.weightKg} kg`)
  if (set.reps != null) parts.push(`× ${set.reps}`)
  if (set.rir != null) parts.push(`RIR ${set.rir}`)
  return parts.length > 0 ? parts.join(' ') : 'done'
}

/**
 * The day's `set_logs`, keyed by the card that owns them.
 *
 * Both halves of §14 step 6 come through here: the rows `POST /api/session/log`
 * hands back after a tap, and the rows `GET /api/session/today` reads on a
 * reload. One shape, one grouping, so a set you just logged and the same set
 * after a refresh cannot render differently.
 *
 * `blocks` is the fallback path. `itemId` post-dates the strength logger, so
 * rows written before it exist only as an `exerciseId` — and a session that has
 * rows must never render as a session with none. Those are matched back to the
 * first item referencing that library entry; rows that match nothing are
 * dropped rather than guessed at.
 */
export function groupSetsByItem<
  T extends { itemId?: string | null; exerciseId?: string | null; setNumber: number },
>(sets: T[], blocks: SessionBlock[] = []): Record<string, T[]> {
  const byExerciseId = new Map<string, string>()
  for (const block of blocks) {
    for (const item of block.items) {
      if (!byExerciseId.has(item.ref.id)) byExerciseId.set(item.ref.id, item.id)
    }
  }

  const out: Record<string, T[]> = {}
  for (const set of sets) {
    const key = set.itemId || (set.exerciseId ? byExerciseId.get(set.exerciseId) : undefined)
    if (!key) continue
    ;(out[key] ??= []).push(set)
  }
  for (const rows of Object.values(out)) rows.sort((a, b) => a.setNumber - b.setNumber)
  return out
}

// ── Safety (§15) ──────────────────────────────────────────────────────────────

/** The kinds whose presence obliges the screen to carry the disclaimer. */
const DISCLAIMER_KINDS: ItemKind[] = ['prehab']

export function itemNeedsDisclaimer(kind: ItemKind): boolean {
  return DISCLAIMER_KINDS.includes(kind)
}

/** True when anything on screen is prehab, and the §15 line has to sit under it. */
export function needsDisclaimer(blocks: SessionBlock[]): boolean {
  return blocks.some((b) => b.items.some((i) => itemNeedsDisclaimer(i.ref.kind)))
}

/**
 * Authored copy, or nothing.
 *
 * The prehab catalog's `rationale` field names conditions — that is what makes
 * it good reference material and exactly what §15 forbids the app from saying
 * to an athlete about their own body. Rather than editing the catalog, every
 * free-text field that reaches a card goes through here, and copy that trips
 * the engine's own check is dropped in favour of the structured fields
 * (`muscleText`, `targetTissue`) which never carried a diagnosis.
 */
export function safeCopy(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  return containsDiagnosisLanguage(trimmed) ? null : trimmed
}

// ── The card catalog (§12) ────────────────────────────────────────────────────

/**
 * The library facts a card shows, denormalized.
 *
 * A Session item carries an id and a name and nothing else, and there is no
 * route that turns an id back into its library row — so the server component
 * builds this from the authored catalogs and hands it down as a prop, the way
 * `/strength` already hands down its key lifts.
 *
 * Built here rather than in the page because of the last field: every piece of
 * free text is put through `safeCopy` on the way in, on the server, so copy
 * that names a condition never reaches the browser at all (§15).
 */
export interface CatalogEntry {
  kind: ItemKind
  refId: string
  name: string
  muscleText?: string | null
  targetTissue?: string | null
  target?: string | null
  category?: string | null
  videoUrl?: string | null
  note?: string | null
  stepKg?: number
  bodyweight?: boolean
}

/** Keyed `${itemKind}:${ref.id}` so two libraries may share an id without colliding. */
export type Catalog = Record<string, CatalogEntry>

export function catalogKey(kind: string, refId: string): string {
  return `${kind}:${refId}`
}

export interface CatalogSources {
  lifts?: Array<{
    id: string
    name: string
    runnerRationale?: string
    microStepKg?: number
    bodyweight?: boolean
  }>
  plyos?: Array<{
    id: string
    name: string
    target?: string
    muscleText?: string
    videoUrl?: string | null
    rationale?: string
  }>
  prehab?: Array<{
    id: string
    name: string
    category?: string
    targetTissue?: string
    muscleText?: string
    videoUrl?: string | null
    rationale?: string
  }>
  stretches?: Array<{
    id: string
    name: string
    target?: string
    muscleText?: string
    rationale?: string
  }>
}

export function buildCatalog(sources: CatalogSources): Catalog {
  const out: Catalog = {}

  for (const lift of sources.lifts ?? []) {
    out[catalogKey('exercise', lift.id)] = {
      kind: 'exercise',
      refId: lift.id,
      name: lift.name,
      note: safeCopy(lift.runnerRationale),
      stepKg: lift.microStepKg ?? 2.5,
      bodyweight: lift.bodyweight ?? false,
    }
  }

  for (const plyo of sources.plyos ?? []) {
    out[catalogKey('plyo', plyo.id)] = {
      kind: 'plyo',
      refId: plyo.id,
      name: plyo.name,
      target: plyo.target ?? null,
      muscleText: plyo.muscleText ?? null,
      videoUrl: plyo.videoUrl ?? null,
      note: safeCopy(plyo.rationale),
    }
  }

  // Prehab is the one that matters: its authored `rationale` is written for a
  // clinician and names conditions, which is exactly what §15 forbids saying to
  // an athlete. `targetTissue` and `muscleText` carry the same information
  // anatomically and always survive.
  for (const protocol of sources.prehab ?? []) {
    out[catalogKey('prehab', protocol.id)] = {
      kind: 'prehab',
      refId: protocol.id,
      name: protocol.name,
      category: protocol.category ?? null,
      targetTissue: protocol.targetTissue ?? null,
      muscleText: protocol.muscleText ?? null,
      videoUrl: protocol.videoUrl ?? null,
      note: safeCopy(protocol.rationale),
    }
  }

  for (const stretch of sources.stretches ?? []) {
    out[catalogKey('stretch', stretch.id)] = {
      kind: 'stretch',
      refId: stretch.id,
      name: stretch.name,
      target: stretch.target ?? null,
      muscleText: stretch.muscleText ?? null,
      note: safeCopy(stretch.rationale),
    }
  }

  return out
}

// ── Verdicts (§11) ────────────────────────────────────────────────────────────

export type VerdictTone = 'ok' | 'flag' | 'blocked'

export interface VerdictView {
  tone: VerdictTone
  message: string
  findings: RuleFinding[]
  /** A safer version the athlete can take in one tap instead of insisting. */
  hasCounterProposal: boolean
  /**
   * Whether "do it anyway" may be offered. False the moment any finding is a
   * hard floor: §15's tissue protections and structural errors are not
   * negotiable, and offering a button that will be refused is worse than not
   * offering one.
   */
  canOverride: boolean
}

export function verdictView(verdict: ValidationVerdict, applied: boolean): VerdictView {
  const hardFloor = verdict.findings.some((f) => f.hardFloor === true)
  const tone: VerdictTone =
    verdict.kind === 'pushed_back' ? 'blocked' : verdict.kind === 'applied_with_flag' ? 'flag' : 'ok'

  return {
    tone,
    message: verdict.message,
    findings: verdict.findings,
    hasCounterProposal: verdict.counterProposal != null,
    canOverride: !applied && verdict.kind === 'pushed_back' && !hardFloor,
  }
}

/** The findings worth putting in front of someone — `info` is for the audit log. */
export function visibleFindings(verdict: ValidationVerdict): RuleFinding[] {
  return verdict.findings.filter((f) => f.severity !== 'info')
}

// ── Diffs (§11, §14) ──────────────────────────────────────────────────────────

/** "2 changes · load 210 → 168", or the "nothing to action" of §14. */
export function diffHeadline(diff: SessionDiff): string {
  if (diff.entries.length === 0) return diff.summary || 'nothing to action'
  const count = `${diff.entries.length} change${diff.entries.length === 1 ? '' : 's'}`
  const before = Math.round(diff.loadBefore)
  const after = Math.round(diff.loadAfter)
  return before === after ? count : `${count} · load ${before} → ${after}`
}

export function diffChangedAnything(diff: SessionDiff | null | undefined): boolean {
  return (diff?.entries.length ?? 0) > 0
}

/**
 * What a patch will do, computed before it is sent.
 *
 * The server returns the authoritative diff, but it returns it *after* applying
 * — and §11 says the athlete confirms a diff, not a promise. So the same
 * before/after is rendered locally from the session already on screen, the
 * athlete confirms that, and the server's own diff is then shown as the
 * receipt. Two views of the same edit, and a disagreement between them is
 * visible rather than silent.
 */
export interface PreviewEntry {
  op: PatchOp['op']
  itemId: string
  name: string
  before: string | null
  after: string | null
  reason: string
}

export function previewPatch(blocks: SessionBlock[], ops: PatchOp[]): PreviewEntry[] {
  const byId = new Map<string, SessionItem>()
  for (const block of blocks) for (const item of block.items) byId.set(item.id, item)

  const entries: PreviewEntry[] = []

  for (const op of ops) {
    if (op.op === 'remove') {
      const item = byId.get(op.itemId)
      entries.push({
        op: 'remove',
        itemId: op.itemId,
        name: item?.ref.name ?? op.itemId,
        before: item ? prescriptionLine(item.params) : null,
        after: null,
        reason: op.reason,
      })
      continue
    }

    if (op.op === 'add') {
      entries.push({
        op: 'add',
        itemId: op.item.id,
        name: op.item.ref.name,
        before: null,
        after: prescriptionLine(op.item.params),
        reason: op.reason,
      })
      continue
    }

    if (op.op === 'replace') {
      const item = byId.get(op.itemId)
      entries.push({
        op: 'replace',
        itemId: op.itemId,
        name: `${item?.ref.name ?? op.itemId} → ${op.item.ref.name}`,
        before: item ? prescriptionLine(item.params) : null,
        after: prescriptionLine(op.item.params),
        reason: op.reason,
      })
      continue
    }

    if (op.op === 'modify') {
      const item = byId.get(op.itemId)
      if (!item) {
        entries.push({
          op: 'modify',
          itemId: op.itemId,
          name: op.itemId,
          before: null,
          after: null,
          reason: op.reason,
        })
        continue
      }
      const merged = { ...item.params, ...(op.params ?? {}) } as ItemParams
      entries.push({
        op: 'modify',
        itemId: op.itemId,
        name: item.ref.name,
        before: prescriptionLine(item.params),
        after: prescriptionLine(merged),
        reason: op.reason,
      })
      continue
    }

    // Reorder — the block moved, no single item changed.
    const names = op.itemIds.map((id) => byId.get(id)?.ref.name ?? id)
    entries.push({
      op: 'reorder',
      itemId: op.blockKind,
      name: blockTitle({ kind: op.blockKind, label: '' }),
      before: null,
      after: names.join(' → '),
      reason: op.reason,
    })
  }

  return entries
}

// ── Building the manual edit's patch (§11-B) ──────────────────────────────────

/**
 * The tap-to-edit op.
 *
 * Only the fields the athlete actually moved are sent. A modify carrying the
 * whole params object would look to `edit_history` like a rewrite of every
 * number on the card, which would poison the preference signal §13 learns from.
 */
export function buildModifyOp(
  item: SessionItem,
  next: Partial<ItemParams>,
  reason: string,
): ModifyOp | null {
  const current = item.params as unknown as Record<string, unknown>
  const changed: Record<string, unknown> = { kind: item.params.kind }
  let any = false

  for (const [key, value] of Object.entries(next)) {
    if (key === 'kind' || value === undefined) continue
    if (current[key] === value) continue
    changed[key] = value
    any = true
  }

  if (!any) return null
  return {
    op: 'modify',
    itemId: item.id,
    params: changed as ModifyOp['params'],
    reason,
  }
}

/** Skipping is an edit like any other — reversible, audited, and explained. */
export function buildStatusOp(
  item: SessionItem,
  status: ItemStatus,
  reason: string,
): ModifyOp | null {
  if (item.status === status) return null
  return { op: 'modify', itemId: item.id, status, reason }
}

// ── Changed vs plan (§14 step 5) ──────────────────────────────────────────────

export interface ChangedVsPlanLike {
  changed: boolean
  summary: string
  entries: Array<{ itemId: string; name: string; reason: string; outcome: string; code: string }>
}

/** The collapsible's own heading, and the honest empty state. */
export function changedHeadline(changed: ChangedVsPlanLike | null | undefined): string {
  if (!changed || !changed.changed || changed.entries.length === 0) return 'nothing to action'
  return changed.summary || `${changed.entries.length} changed`
}

export function changedCount(changed: ChangedVsPlanLike | null | undefined): number {
  return changed?.entries.length ?? 0
}

// ── Completion ────────────────────────────────────────────────────────────────

/** Planned minutes across the stack — the default the sRPE prompt opens on. */
export function plannedDurationMin(blocks: SessionBlock[]): number {
  let total = 0
  for (const item of allItems(blocks)) {
    if (item.params.kind === 'run') total += item.params.durationMin ?? 0
    else if (item.params.kind === 'strength') total += item.params.sets * 2
    else if (item.params.kind === 'contacts') total += item.params.sets * 1.5
    else total += item.params.sets * 1
  }
  return Math.max(0, Math.round(total))
}

/** sRPE is a word before it is a number — the scale says what each one means. */
export const SRPE_ANCHORS: Record<number, string> = {
  0: 'nothing',
  2: 'very easy',
  4: 'moderate',
  6: 'hard',
  8: 'very hard',
  10: 'maximal',
}

export function srpeAnchor(srpe: number): string {
  const keys = Object.keys(SRPE_ANCHORS)
    .map(Number)
    .sort((a, b) => a - b)
  let best = keys[0]
  for (const key of keys) if (srpe >= key) best = key
  return SRPE_ANCHORS[best]
}
