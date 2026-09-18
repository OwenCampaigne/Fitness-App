// ── Movement session ──────────────────────────────────────────────────────────
// The DB-facing half of Phase 4, mirroring `strengthSession.ts`: it reads the
// niggle log and the logged plyo/prehab/stretch work, hands the pure engines
// what they need, and turns their prescriptions into the `CandidateItem`s the
// allocator prices (framework §9).
//
// The engines stay DB-free on purpose — every plyo tier rule and every
// escalation branch is unit-tested against literals. This file is the only
// place that knows a `niggle_log` row exists, and the only place that knows
// `set_logs` now carries contacts and holds as well as weights (§3).
//
// Two things live here that look like they should live in the engines and
// deliberately do not:
//   · the `set_logs.notes` codec for plyo execution quality — see the schema
//     note below, this is a workaround for two missing columns
//   · the tissue vocabulary that connects a logged body region to what an item
//     loads, because that mapping is catalog wiring, not physiology the engine
//     reasons about

import { startOfDay, subDays } from 'date-fns'
import { prisma } from './db'
import { estimateItemCost } from './load'
import {
  contactBudget,
  decidePlyoPlacement,
  derivePlyoTierAnchor,
  prescribePlyos,
  unlockedPlyos,
} from './plyoEngine'
import {
  DISCLAIMER,
  assessNiggles,
  combineTissueLoad,
  prescribePrehab,
} from './prehabEngine'
import { prescribeStretches } from './stretchEngine'
import { PLYOS_BY_ID, plyoRegions } from './plyos'
import { PREHAB_BY_ID, REGION_TAGS } from './prehab'
import { STRETCHES_BY_ID, stretchRegions } from './stretches'
import { getMovementScenario } from './movementScenario'
import type { CandidateItem, Modality, Niggle, Priority } from './allocator'
import type { ReadinessBand } from '../types/readiness'
import type { RunType } from '../types/run'
import type { BlockKind, ItemKind, SessionItem } from '../types/session'
import type {
  BodyRegion,
  NiggleAssessment,
  NiggleQuality,
  NiggleRecord,
  NiggleSide,
  NiggleStatus,
  PlyoPrescription,
  PlyoSessionHistory,
  PlyoTier,
  PlyoTierAnchor,
  PrehabPrescription,
  StretchPrescription,
  TissueLoadAdjustment,
} from '../types/movement'

export { DISCLAIMER } from './prehabEngine'

// ── Constants ─────────────────────────────────────────────────────────────────

/** How far back the niggle tracker looks for an open episode. */
export const NIGGLE_WINDOW_DAYS = 45
/** Weeks of contact history the ACWR ramp reads (§9). */
export const CONTACT_WEEKS = 4
/** How long a plyo drill stays "owned" for prerequisite purposes. */
export const MASTERY_WINDOW_DAYS = 90

export const BODY_REGIONS: BodyRegion[] = [
  'ankle_foot',
  'shin',
  'knee',
  'hip',
  'hamstring',
  'low_back',
  'other',
]

export const NIGGLE_QUALITIES: NiggleQuality[] = [
  'dull',
  'achy',
  'tight',
  'stiff',
  'sharp',
  'burning',
]

export const NIGGLE_SIDES: NiggleSide[] = ['left', 'right', 'both']

/** Item kinds this module logs through `set_logs`. */
const MOVEMENT_KINDS: ItemKind[] = ['plyo', 'prehab', 'stretch']

// ── Niggle rows ↔ NiggleRecord ────────────────────────────────────────────────

/** The `niggle_log` row shape, without importing Prisma into a pure function. */
export interface NiggleRow {
  id: number
  date: Date | string
  bodyRegion: string
  side: string | null
  severity: number
  quality: string | null
  notes: string | null
  status: string
  firstReportedOn: Date | string
  resolvedOn: Date | string | null
  escalatedOn: Date | string | null
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * Widen a stored string back into the engine's union.
 *
 * SQLite has no enums, so every one of these columns is a free-text field that
 * a bad write could put anything into. Falling back rather than throwing is the
 * right failure mode: an unrecognised region becomes `other`, which the engine
 * handles conservatively, instead of taking the whole day's session down.
 */
export function toBodyRegion(value: string | null | undefined): BodyRegion {
  return BODY_REGIONS.includes(value as BodyRegion) ? (value as BodyRegion) : 'other'
}

export function toNiggleSide(value: string | null | undefined): NiggleSide | null {
  return NIGGLE_SIDES.includes(value as NiggleSide) ? (value as NiggleSide) : null
}

export function toNiggleQuality(value: string | null | undefined): NiggleQuality | null {
  return NIGGLE_QUALITIES.includes(value as NiggleQuality) ? (value as NiggleQuality) : null
}

export function toNiggleStatus(value: string | null | undefined): NiggleStatus {
  return value === 'resolved' || value === 'escalated' ? value : 'active'
}

/** One `niggle_log` row as the prehab engine wants it. */
export function toNiggleRecord(row: NiggleRow): NiggleRecord {
  return {
    id: row.id,
    date: asDate(row.date),
    bodyRegion: toBodyRegion(row.bodyRegion),
    side: toNiggleSide(row.side),
    severity: Math.max(0, Math.min(10, Math.round(row.severity))),
    quality: toNiggleQuality(row.quality),
    notes: row.notes,
    status: toNiggleStatus(row.status),
    firstReportedOn: asDate(row.firstReportedOn),
    resolvedOn: row.resolvedOn ? asDate(row.resolvedOn) : null,
    escalatedOn: row.escalatedOn ? asDate(row.escalatedOn) : null,
  }
}

/** The episode key: left and right are separate tissues with separate histories. */
export function episodeKey(bodyRegion: BodyRegion, side: NiggleSide | null): string {
  return `${bodyRegion}|${side ?? 'none'}`
}

/**
 * The tissue vocabulary the allocator matches on.
 *
 * A niggle is logged as a region and a number; a candidate item declares the
 * tissues it loads. Both sides have to speak the same language or the rails
 * silently never fire — so both go through here. The region itself is included
 * alongside its tags so a coarse match still lands.
 */
export function tissuesForRegion(region: BodyRegion): string[] {
  return Array.from(new Set([region, ...(REGION_TAGS[region] ?? [])]))
}

/** An assessed episode, as the allocator's screening gauntlet wants it. */
export function toAllocatorNiggle(assessment: NiggleAssessment): Niggle {
  return {
    id: episodeKey(assessment.bodyRegion, assessment.side),
    bodyRegion: assessment.bodyRegion,
    tissues: tissuesForRegion(assessment.bodyRegion),
    severity: assessment.currentSeverity,
    daysActive: assessment.daysActive,
  }
}

export function toAllocatorNiggles(assessments: NiggleAssessment[]): Niggle[] {
  return assessments.filter((a) => a.level !== 'none').map(toAllocatorNiggle)
}

// ── Plyo execution quality, encoded into set_logs.notes ───────────────────────
// SCHEMA GAP: `PlyoSessionHistory` needs `cleanExecution` and `sorenessNextDay`
// and `set_logs` has no column for either. Until it does, they ride in `notes`
// behind a tag that the athlete's own free text cannot collide with. Both the
// encode and the decode are pure, so swapping this for real columns later is a
// two-line change here and a migration — nothing else reads the tag.

const QUALITY_TAG = /^\[plyo clean=(yes|no|unknown) soreness=(\d+|na)\]\s?/

export interface PlyoQuality {
  cleanExecution: boolean | null
  sorenessNextDay: number | null
}

export function encodePlyoQuality(quality: PlyoQuality, notes?: string | null): string {
  const clean =
    quality.cleanExecution === true ? 'yes' : quality.cleanExecution === false ? 'no' : 'unknown'
  const soreness =
    quality.sorenessNextDay === null || quality.sorenessNextDay === undefined
      ? 'na'
      : String(Math.max(0, Math.min(10, Math.round(quality.sorenessNextDay))))
  return `[plyo clean=${clean} soreness=${soreness}]${notes ? ` ${notes}` : ''}`
}

export function decodePlyoQuality(
  notes: string | null | undefined,
): PlyoQuality & { notes: string | null } {
  if (!notes) return { cleanExecution: null, sorenessNextDay: null, notes: null }
  const match = QUALITY_TAG.exec(notes)
  if (!match) return { cleanExecution: null, sorenessNextDay: null, notes }
  return {
    cleanExecution: match[1] === 'unknown' ? null : match[1] === 'yes',
    sorenessNextDay: match[2] === 'na' ? null : Number(match[2]),
    notes: notes.replace(QUALITY_TAG, '') || null,
  }
}

// ── Plyo history from set_logs ────────────────────────────────────────────────

/** A `set_logs` row as this module reads it, Prisma-free so it can be tested. */
export interface MovementSetRow {
  sessionId: number
  exerciseId: string
  itemId: string | null
  itemKind: string | null
  setNumber: number
  contacts: number | null
  holdSec: number | null
  reps: number | null
  notes: string | null
}

/**
 * Rebuild plyo exposures from the set log.
 *
 * One exposure is one drill in one session, not one set — the tier anchor asks
 * "did that session hold", and a per-set answer would let three clean sets of
 * an easy drill outvote one session that did not.
 */
export function groupPlyoHistory(
  rows: MovementSetRow[],
  sessionDates: Record<number, Date>,
): PlyoSessionHistory[] {
  const bucket = new Map<string, PlyoSessionHistory>()

  for (const row of rows) {
    if (row.itemKind !== 'plyo') continue
    const plyo = PLYOS_BY_ID[row.exerciseId]
    if (!plyo) continue

    const key = `${row.sessionId}::${row.exerciseId}`
    const quality = decodePlyoQuality(row.notes)
    let entry = bucket.get(key)
    if (!entry) {
      entry = {
        date: sessionDates[row.sessionId] ?? new Date(),
        plyoId: row.exerciseId,
        tier: plyo.progressionTier,
        contacts: 0,
        cleanExecution: null,
        sorenessNextDay: null,
      }
      bucket.set(key, entry)
    }
    entry.contacts += row.contacts ?? 0
    // The most pessimistic answer across the session's sets wins: one ugly set
    // is what the tier anchor is trying to notice.
    if (quality.cleanExecution === false) entry.cleanExecution = false
    else if (quality.cleanExecution === true && entry.cleanExecution === null) {
      entry.cleanExecution = true
    }
    if (quality.sorenessNextDay !== null) {
      entry.sorenessNextDay = Math.max(entry.sorenessNextDay ?? 0, quality.sorenessNextDay)
    }
  }

  return Array.from(bucket.values()).sort((a, b) => a.date.getTime() - b.date.getTime())
}

/** Contacts per completed week, oldest first, plus the incomplete week so far. */
export function weeklyContactTotals(
  history: PlyoSessionHistory[],
  today: Date,
  weeks = CONTACT_WEEKS,
): { weeklyContacts: number[]; contactsThisWeek: number } {
  const weeklyContacts = new Array(weeks).fill(0) as number[]
  let contactsThisWeek = 0
  const end = startOfDay(today).getTime()

  for (const entry of history) {
    const daysAgo = Math.floor((end - startOfDay(entry.date).getTime()) / 86_400_000)
    if (daysAgo < 0) continue
    if (daysAgo < 7) {
      contactsThisWeek += entry.contacts
      continue
    }
    const weekIndex = Math.floor(daysAgo / 7) - 1
    if (weekIndex >= weeks) continue
    // Oldest first: index 0 is the furthest-back completed week.
    weeklyContacts[weeks - 1 - weekIndex] += entry.contacts
  }

  return { weeklyContacts, contactsThisWeek }
}

/** Drills logged cleanly inside the window — the prerequisite currency (§9). */
export function masteredPlyoIds(history: PlyoSessionHistory[], today: Date): string[] {
  const cutoff = subDays(startOfDay(today), MASTERY_WINDOW_DAYS).getTime()
  const ids = new Set<string>()
  for (const entry of history) {
    if (entry.date.getTime() < cutoff) continue
    if (entry.cleanExecution === false) continue
    ids.add(entry.plyoId)
  }
  return Array.from(ids)
}

// ── Candidates ────────────────────────────────────────────────────────────────

/**
 * What an item loads, in the tissue vocabulary above. Kept next to the catalogs
 * rather than inside the allocator, which is not allowed to know what a
 * plyometric is.
 */
export function movementItemTissues(item: SessionItem): string[] {
  if (item.ref.kind === 'plyo') {
    return plyoRegions(item.ref.id).flatMap((r) => tissuesForRegion(toBodyRegion(r)))
  }
  if (item.ref.kind === 'prehab') {
    const protocol = PREHAB_BY_ID[item.ref.id]
    return protocol ? tissuesForRegion(protocol.bodyRegion) : []
  }
  if (item.ref.kind === 'stretch') {
    return stretchRegions(item.ref.id).flatMap((r) => tissuesForRegion(r))
  }
  return []
}

/** What a prehab protocol *treats* — the hook that promotes it into the day. */
export function prehabTreats(prehabId: string): string[] {
  const protocol = PREHAB_BY_ID[prehabId]
  if (!protocol) return []
  return Array.from(new Set([protocol.bodyRegion, ...protocol.niggleTags]))
}

function candidate(
  item: SessionItem,
  modality: Modality,
  placement: BlockKind,
  priority: Priority,
  constraints: CandidateItem['constraints'],
  srpe?: number,
): CandidateItem {
  return {
    item,
    cost: estimateItemCost(item, srpe === undefined ? {} : { srpe }),
    priority,
    placement,
    modality,
    constraints,
  }
}

export interface MovementCandidateInput {
  band: ReadinessBand
  isQualityDay: boolean
  isRecoveryDay: boolean
  painFlagged: boolean
  todayRunType: RunType | null
  tomorrowRunType: RunType | null
  /** Open episodes, already assessed. */
  assessments: NiggleAssessment[]
  tierAnchor: PlyoTierAnchor
  masteredIds: string[]
  impactCleared: boolean
  weeklyContacts: number[]
  contactsThisWeek: number
  /** Calibration window still open — the plyo ramp tightens (§5b). */
  provisional: boolean
  /** Rotates the routine prehab dose. Day-of-year works. */
  dayIndex: number
}

export interface MovementCandidates {
  candidates: CandidateItem[]
  plyo: PlyoPrescription
  prehab: PrehabPrescription
  stretch: StretchPrescription
  adjustment: TissueLoadAdjustment
  /** §15 — returned from every prehab-bearing surface so the UI cannot forget. */
  disclaimer: string
}

/**
 * Run all three Phase 4 engines and price what they produce.
 *
 * Pure: everything the engines need arrives in `input`, so the whole of Phase 4's
 * contribution to a day can be asserted against literals. The DB-facing
 * `gatherMovementInput` below is the only part that needs a database.
 */
export function buildMovementCandidates(input: MovementCandidateInput): MovementCandidates {
  const adjustment = combineTissueLoad(input.assessments)
  const blockedRegions = adjustment.blockedRegions

  // Plyos (§9). Placement first — the two hard "never"s are cheaper to check
  // than a budget, and a vetoed day needs no budget at all.
  const placement = decidePlyoPlacement({
    band: input.band,
    todayRunType: input.todayRunType,
    tomorrowRunType: input.tomorrowRunType,
    isRecoveryDay: input.isRecoveryDay,
    painFlagged: input.painFlagged,
  })

  const budget = contactBudget({
    tierAnchor: input.tierAnchor.value,
    weeklyContacts: input.weeklyContacts,
    contactsThisWeek: input.contactsThisWeek,
    band: input.band,
    painFlagged: input.painFlagged,
    provisional: input.provisional,
    blockImpact: adjustment.blockImpact,
  })

  const unlocked = unlockedPlyos({
    tierAnchor: input.tierAnchor.value,
    masteredIds: input.masteredIds,
    impactCleared: input.impactCleared,
    blockedRegions,
  })

  const plyo = prescribePlyos({ budget, placement, unlocked })

  const prehab = prescribePrehab({
    assessments: input.assessments,
    band: input.band,
    painFlagged: input.painFlagged,
    dayIndex: input.dayIndex,
  })

  const stretch = prescribeStretches({
    band: input.band,
    isQualityDay: input.isQualityDay,
    isRecoveryDay: input.isRecoveryDay,
    painFlagged: input.painFlagged,
    blockedRegions,
  })

  const candidates: CandidateItem[] = []

  for (const item of plyo.items) {
    const tier = PLYOS_BY_ID[item.ref.id]?.progressionTier ?? 1
    candidates.push(
      candidate(item, 'plyo', plyo.block, 'B', {
        tissues: movementItemTissues(item),
        // Tier 3 is reactive work — worth nothing on tired legs, and expensive.
        requiresFresh: tier >= 3,
        notBeforeLongRun: true,
        trimmable: true,
      }),
    )
  }

  const targetedIds = new Set(
    prehab.targeted
      ? prehab.items
          .filter((i) => input.assessments.some((a) => prehabTreats(i.ref.id).includes(a.bodyRegion)))
          .map((i) => i.id)
      : [],
  )

  for (const item of prehab.items) {
    candidates.push(
      candidate(item, 'prehab', prehab.block, targetedIds.has(item.id) ? 'B' : 'C', {
        tissues: movementItemTissues(item),
        treats: prehabTreats(item.ref.id),
        trimmable: false,
      }),
    )
  }

  for (const item of stretch.warmup) {
    const entry = STRETCHES_BY_ID[item.ref.id]
    candidates.push(
      candidate(item, 'stretch', 'warmup', 'C', {
        tissues: movementItemTissues(item),
        excludeFromWarmupBeforeQuality: entry?.type === 'static',
        trimmable: false,
      }),
    )
  }

  for (const item of stretch.cooldown) {
    candidates.push(
      candidate(item, 'stretch', 'cooldown', 'C', {
        tissues: movementItemTissues(item),
        trimmable: false,
      }),
    )
  }

  return { candidates, plyo, prehab, stretch, adjustment, disclaimer: DISCLAIMER }
}

// ── DB: niggle CRUD ───────────────────────────────────────────────────────────

/** Every report inside the window, scenario presets included (§16). */
export async function loadNiggleRecords(today = new Date()): Promise<NiggleRecord[]> {
  const scenario = getMovementScenario()
  if (scenario) return scenario.niggles

  const rows = await prisma.niggle_log.findMany({
    where: { date: { gte: subDays(startOfDay(today), NIGGLE_WINDOW_DAYS) } },
    orderBy: { date: 'asc' },
  })
  return rows.map((r) => toNiggleRecord(r as NiggleRow))
}

/** Open episodes only — what the engines and the allocator actually read. */
export async function listActiveNiggles(today = new Date()): Promise<NiggleRecord[]> {
  const all = await loadNiggleRecords(today)
  return all.filter((r) => r.status !== 'resolved')
}

/** Assessed open episodes. The single entry point for "what is sore today". */
export async function getNiggleAssessments(today = new Date()): Promise<NiggleAssessment[]> {
  return assessNiggles(await loadNiggleRecords(today), today)
}

export interface LogNiggleInput {
  bodyRegion: BodyRegion
  side?: NiggleSide | null
  severity: number
  quality?: NiggleQuality | null
  notes?: string | null
  date?: Date
}

/**
 * Log one report.
 *
 * A report joins the open episode for that region and side when there is one,
 * inheriting its `firstReportedOn` — which is what makes "twelve days and not
 * settling" a fact the escalation ladder can read rather than something the
 * athlete has to remember to say (§15).
 */
export async function logNiggle(input: LogNiggleInput): Promise<NiggleRecord> {
  const date = input.date ?? new Date()
  const side = input.side ?? null

  const open = await prisma.niggle_log.findFirst({
    where: {
      bodyRegion: input.bodyRegion,
      side,
      status: { in: ['active', 'escalated'] },
      date: { gte: subDays(startOfDay(date), NIGGLE_WINDOW_DAYS) },
    },
    orderBy: { date: 'asc' },
  })

  const row = await prisma.niggle_log.create({
    data: {
      date,
      bodyRegion: input.bodyRegion,
      side,
      severity: Math.max(0, Math.min(10, Math.round(input.severity))),
      quality: input.quality ?? null,
      notes: input.notes ?? null,
      status: open ? toNiggleStatus(open.status) : 'active',
      firstReportedOn: open ? new Date(open.firstReportedOn) : startOfDay(date),
    },
  })

  return toNiggleRecord(row as NiggleRow)
}

/** Close an episode. Resolves every report in it, not just the row tapped. */
export async function resolveNiggle(id: number, today = new Date()): Promise<number> {
  const row = await prisma.niggle_log.findUnique({ where: { id } })
  if (!row) return 0

  const result = await prisma.niggle_log.updateMany({
    where: {
      bodyRegion: row.bodyRegion,
      side: row.side,
      firstReportedOn: row.firstReportedOn,
      status: { not: 'resolved' },
    },
    data: { status: 'resolved', resolvedOn: today },
  })
  return result.count
}

/**
 * Mark an episode for a professional opinion. Terminal for the app: once this
 * is set, `assessNiggle` returns `stop_and_refer` and nothing is prescribed
 * into the area again until the athlete resolves it (§15).
 */
export async function escalateNiggle(id: number, today = new Date()): Promise<number> {
  const row = await prisma.niggle_log.findUnique({ where: { id } })
  if (!row) return 0

  const result = await prisma.niggle_log.updateMany({
    where: {
      bodyRegion: row.bodyRegion,
      side: row.side,
      firstReportedOn: row.firstReportedOn,
      status: 'active',
    },
    data: { status: 'escalated', escalatedOn: today },
  })
  return result.count
}

// ── DB: plyo / prehab / stretch logging ───────────────────────────────────────

export interface LogMovementSetInput {
  sessionId: number
  /** The library id — plyo, prehab or stretch. */
  exerciseId: string
  /** The Session item this set belongs to, so the card can be matched back. */
  itemId: string
  itemKind: ItemKind
  setNumber: number
  contacts?: number | null
  holdSec?: number | null
  reps?: number | null
  notes?: string | null
  /** Plyo only: did it look like the drill, and how sore the next day (§9). */
  quality?: PlyoQuality
}

/**
 * Persist one plyo/prehab/stretch set through the same table the lifts use.
 *
 * One log table, one history query, one place a session's completed work lives
 * — the alternative was a second table per modality and a join to find out what
 * an athlete actually did on a Tuesday.
 */
export async function logMovementSet(input: LogMovementSetInput) {
  if (!MOVEMENT_KINDS.includes(input.itemKind)) {
    throw new Error(`logMovementSet handles plyo, prehab and stretch — not ${input.itemKind}`)
  }

  const notes =
    input.itemKind === 'plyo' && input.quality
      ? encodePlyoQuality(input.quality, input.notes ?? null)
      : (input.notes ?? null)

  const existing = await prisma.set_logs.findFirst({
    where: {
      sessionId: input.sessionId,
      itemId: input.itemId,
      setNumber: input.setNumber,
    },
  })

  const data = {
    sessionId: input.sessionId,
    exerciseId: input.exerciseId,
    itemId: input.itemId,
    itemKind: input.itemKind,
    setNumber: input.setNumber,
    contacts: input.contacts ?? null,
    holdSec: input.holdSec ?? null,
    reps: input.reps ?? null,
    notes,
  }

  const row = existing
    ? await prisma.set_logs.update({ where: { id: existing.id }, data })
    : await prisma.set_logs.create({ data })

  // A logged plyo set is new evidence about the tier, so the anchor moves now
  // rather than at some nightly job — the same loop `refreshWorkingLoadAnchor`
  // runs for lifts (§5b).
  if (input.itemKind === 'plyo') await refreshPlyoTierAnchor()

  return row
}

// ── DB: plyo history and the tier anchor ──────────────────────────────────────

export async function loadPlyoHistory(sinceDays = 120): Promise<PlyoSessionHistory[]> {
  const scenario = getMovementScenario()
  if (scenario) return scenario.plyoHistory

  const since = subDays(new Date(), sinceDays)
  const sessions = await prisma.session.findMany({
    where: { date: { gte: since } },
    orderBy: { date: 'asc' },
  })
  if (sessions.length === 0) return []

  const sessionDates: Record<number, Date> = {}
  for (const s of sessions) sessionDates[s.id] = new Date(s.date)

  const rows = await prisma.set_logs.findMany({
    where: { sessionId: { in: sessions.map((s) => s.id) }, itemKind: 'plyo' },
    orderBy: [{ sessionId: 'asc' }, { setNumber: 'asc' }],
  })

  return groupPlyoHistory(rows as MovementSetRow[], sessionDates)
}

/**
 * Recompute the plyo-tier anchor and write it to `athlete_profile`.
 *
 * The plyo counterpart to `refreshWorkingLoadAnchor` — same §3 anchor shape
 * (value, source, confidence), same §5b loop, different evidence: clean
 * sessions at a tier rather than sets at a weight.
 */
export async function refreshPlyoTierAnchor(today = new Date()): Promise<PlyoTierAnchor> {
  const history = await loadPlyoHistory()
  const anchor = derivePlyoTierAnchor(history, today)

  if (getMovementScenario()) return anchor

  const profile = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
  if (!profile) return anchor

  await prisma.athlete_profile.update({
    where: { id: profile.id },
    data: {
      plyoTier: anchor.value,
      plyoTierSource: anchor.source,
      plyoTierConfidence: String(anchor.confidence),
    },
  })

  return anchor
}

export async function readPlyoTierAnchor(today = new Date()): Promise<PlyoTierAnchor> {
  return derivePlyoTierAnchor(await loadPlyoHistory(), today)
}

// ── DB: assembling the engine input ───────────────────────────────────────────

export interface GatherMovementInput {
  band: ReadinessBand
  provisional: boolean
  painFlagged: boolean
  isQualityDay: boolean
  isRecoveryDay: boolean
  todayRunType: RunType | null
  tomorrowRunType: RunType | null
  impactCleared: boolean
  today?: Date
}

/**
 * Everything `buildMovementCandidates` needs, read from the DB or a scenario.
 * Split from the pure builder so the builder stays assertable against literals.
 */
export async function gatherMovementInput(
  input: GatherMovementInput,
): Promise<MovementCandidateInput> {
  const today = input.today ?? new Date()
  const scenario = getMovementScenario()

  const [assessments, history] = await Promise.all([
    getNiggleAssessments(today),
    loadPlyoHistory(),
  ])

  const tierAnchor = derivePlyoTierAnchor(history, today)
  const contacts = scenario
    ? { weeklyContacts: scenario.weeklyContacts, contactsThisWeek: scenario.contactsThisWeek }
    : weeklyContactTotals(history, today)

  // Day-of-year rotates the routine prehab dose, so the same three do not land
  // seven days running (§9).
  const dayIndex = Math.floor(
    (startOfDay(today).getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86_400_000,
  )

  return {
    band: input.band,
    isQualityDay: input.isQualityDay,
    isRecoveryDay: input.isRecoveryDay,
    painFlagged: input.painFlagged,
    todayRunType: input.todayRunType,
    tomorrowRunType: input.tomorrowRunType,
    assessments,
    tierAnchor,
    masteredIds: scenario ? scenario.masteredPlyoIds : masteredPlyoIds(history, today),
    impactCleared: scenario ? scenario.impactCleared : input.impactCleared,
    weeklyContacts: contacts.weeklyContacts,
    contactsThisWeek: contacts.contactsThisWeek,
    provisional: input.provisional,
    dayIndex,
  }
}

/** The full Phase 4 contribution to today, DB-backed. */
export async function getMovementCandidates(
  input: GatherMovementInput,
): Promise<MovementCandidates & { input: MovementCandidateInput }> {
  const gathered = await gatherMovementInput(input)
  return { ...buildMovementCandidates(gathered), input: gathered }
}
