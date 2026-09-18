// ── Records store ─────────────────────────────────────────────────────────────
// The Prisma half of `records.ts`: read the source rows, run the pure detector,
// persist what changed. No judgement lives here — every threshold, refusal and
// sentence comes from `records.ts`, which is unit-tested.
//
// Two write paths, both idempotent by construction:
//
//   `syncPersonalRecords` inserts only what `diffRecords` says is new, and
//   marks the beaten row `supersededById` rather than editing it. Re-running it
//   over unchanged data writes nothing.
//
//   `rollUpClosedWeeks` recomputes each closed week from source rows and
//   upserts on the unique `weekStart`. Nothing is incremented, so re-running it
//   replaces rather than accumulates.

import { format, subDays } from 'date-fns'
import { prisma } from './db'
import { estimateSRPE } from './readiness'
import { loadExerciseHistories } from './strengthSession'
import { getStrengthScenario } from './strengthScenario'
import { deriveZones } from './runSession'
import { KEY_LIFTS_BY_ID } from './keyLifts'
import { summarizeDailyLoads } from './sessionStore'
import { dailyLoadSeries } from './trends'
import {
  closedWeekStarts,
  detectLiftRecords,
  detectRunRecords,
  diffRecords,
  formatRecordValue,
  recordCurrency,
  recordFamily,
  rollUpWeek,
  weekStartOf,
} from './records'
import type {
  DetectedRecord,
  HistoryView,
  RecordHistoryEntry,
  RecordKind,
  RecordRefusal,
  RecordRow,
  RecordSource,
  RecordUnit,
  StatedLiftRecord,
  StoredRecord,
  WeekRow,
} from './records'
import type { RunActivityRow } from '../types/run'
import type { WorkingLoadAnchor } from '../types/strength'

/** How far back detection looks. Records are meant to be old; the window is not. */
const RECORD_WINDOW_DAYS = 730
const ROLLUP_WEEKS = 12

function isoDay(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

// ── Detection inputs ──────────────────────────────────────────────────────────

async function loadActivities(days: number): Promise<RunActivityRow[]> {
  const rows = await prisma.activities.findMany({
    where: { date: { gte: subDays(new Date(), days) } },
    orderBy: { date: 'asc' },
  })
  return rows.map((a) => ({
    date: new Date(a.date),
    type: a.type,
    durationMin: a.durationMin,
    distanceKm: a.distanceKm,
    avgHr: a.avgHr,
    maxHr: a.maxHr,
  }))
}

/**
 * Working loads the athlete typed at intake, as stated records.
 *
 * Only `estimate`-sourced anchors qualify. Once an anchor is `observed` a
 * logged set is already behind it, and the logged set is the record — surfacing
 * the intake number beside it would be showing the same fact twice, once
 * honestly and once not.
 */
function statedFromProfile(
  keyLiftLoadsJson: string | null,
  statedOn: Date | null,
): StatedLiftRecord[] {
  if (!keyLiftLoadsJson || !statedOn) return []
  try {
    const stored = JSON.parse(keyLiftLoadsJson) as Record<string, WorkingLoadAnchor>
    return Object.entries(stored)
      .filter(([, anchor]) => anchor.source === 'estimate' && (anchor.value ?? 0) > 0)
      .map(([id, anchor]) => ({
        exerciseId: id,
        label: KEY_LIFTS_BY_ID[id]?.name ?? id,
        weightKg: anchor.value as number,
        statedOn,
      }))
  } catch {
    return []
  }
}

// ── Detect and persist ────────────────────────────────────────────────────────

export interface SyncResult {
  inserted: number
  superseded: number
  unchanged: number
  refusals: RecordRefusal[]
}

export async function syncPersonalRecords(): Promise<SyncResult> {
  const [profile, activities] = await Promise.all([
    prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } }),
    loadActivities(RECORD_WINDOW_DAYS),
  ])

  // Scenario mode first, per the architecture rule (§16).
  const scenario = getStrengthScenario()
  const histories = scenario ? scenario.histories : await loadExerciseHistories(RECORD_WINDOW_DAYS)
  const zones = deriveZones(profile?.age ?? null, profile?.hrZonesJson ?? null, null)

  const lifts = detectLiftRecords(histories, {
    labelOf: (id) => KEY_LIFTS_BY_ID[id]?.name ?? id,
    stated: statedFromProfile(
      profile?.keyLiftLoadsJson ?? null,
      profile?.createdAt ? new Date(profile.createdAt) : null,
    ),
  })
  const runs = detectRunRecords(activities, { matchHr: zones.z2Ceiling })

  const detected = [...lifts.records, ...runs.records]
  const refusals = [...lifts.refusals, ...runs.refusals]

  const storedRows = await prisma.personal_records.findMany({ orderBy: { id: 'asc' } })
  const stored: StoredRecord[] = storedRows.map((r) => ({
    id: r.id,
    kind: r.kind as RecordKind,
    subjectId: r.subjectId,
    value: r.value,
    achievedOn: new Date(r.achievedOn),
    source: r.source as RecordSource,
    supersededById: r.supersededById,
  }))

  const diff = diffRecords(detected, stored)

  let superseded = 0
  for (let i = 0; i < diff.insert.length; i++) {
    const record = diff.insert[i]
    const beaten = diff.supersedes[i]
    const created = await prisma.personal_records.create({
      data: {
        kind: record.kind,
        subjectId: record.subjectId,
        label: record.label,
        value: record.value,
        unit: record.unit,
        reps: record.reps,
        achievedOn: record.achievedOn,
        source: record.source,
        sessionId: record.sessionId,
        verified: record.verified,
        notes: record.notes,
      },
    })
    if (beaten !== null) {
      // The old row keeps its date and its number. That chain is the history
      // the athlete actually wants to see (§13 — the memory is the asset).
      await prisma.personal_records.update({
        where: { id: beaten },
        data: { supersededById: created.id },
      })
      superseded += 1
    }
  }

  return {
    inserted: diff.insert.length,
    superseded,
    unchanged: diff.unchanged.length,
    refusals,
  }
}

// ── Weekly rollup ─────────────────────────────────────────────────────────────

export async function rollUpClosedWeeks(today = new Date(), weeks = ROLLUP_WEEKS): Promise<number> {
  const starts = closedWeekStarts(today, weeks)
  if (starts.length === 0) return 0

  const from = starts[0]
  const profile = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
  const age = profile?.age ?? 35
  const srpe = (avgHr: number) => estimateSRPE(avgHr, age)

  // One read per table for the whole span, rather than one per week: twelve
  // weeks of history is small, and twelve round trips per page load is not.
  const [activityRows, sessionRows] = await Promise.all([
    prisma.activities.findMany({
      where: { date: { gte: subDays(from, 28) } },
      orderBy: { date: 'asc' },
    }),
    prisma.session.findMany({
      where: { date: { gte: subDays(from, 28) } },
      orderBy: { date: 'asc' },
    }),
  ])

  const setRows = await prisma.set_logs.findMany({
    where: { sessionId: { in: sessionRows.map((s) => s.id) } },
  })

  const activities: RunActivityRow[] = activityRows.map((a) => ({
    date: new Date(a.date),
    type: a.type,
    durationMin: a.durationMin,
    distanceKm: a.distanceKm,
    avgHr: a.avgHr,
    maxHr: a.maxHr,
  }))

  // `set_logs` has no date of its own — it hangs off the session that owns it,
  // which is the row that carries the training date.
  const sessionDates = new Map(sessionRows.map((s) => [s.id, new Date(s.date)]))
  const setLogs = setRows
    .map((s) => ({
      date: sessionDates.get(s.sessionId) ?? new Date(s.createdAt),
      itemKind: s.itemKind,
      reps: s.reps,
      contacts: s.contacts,
    }))

  const sessions = sessionRows.map((s) => ({ date: new Date(s.date), status: s.status }))

  for (const weekStart of starts) {
    const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000)
    const { dailyLoads: storedLoads } = summarizeDailyLoads(
      sessionRows.map((s) => ({
        date: new Date(s.date),
        plannedLoad: s.plannedLoad,
        actualLoad: s.actualLoad,
        srpe: s.srpe,
        status: s.status,
      })),
      activityRows.map((a) => ({
        date: new Date(a.date),
        durationMin: a.durationMin,
        trimp: a.trimp,
      })),
      weekEnd,
      28,
    )

    // Two views of the same 28 days, aligned day for day and maxed rather than
    // summed: `summarizeDailyLoads` is what the allocator banked, and
    // `dailyLoadSeries` is duration × sRPE derived from the runs themselves.
    // Without the second, a history of runs that arrived with no TRIMP reads as
    // a chronic window of zero, and the ACWR that comes out of that is 1.0 —
    // a number that looks balanced and means "no data". Using the same series
    // `trends.ts` draws also keeps this row and the review chart in agreement.
    const derived = dailyLoadSeries(activities, { days: 28, today: weekEnd, srpe })
    const dailyLoads = storedLoads.map((load, i) => Math.max(load, derived[i]?.load ?? 0))

    const summary = rollUpWeek({ weekStart, activities, sessions, setLogs, dailyLoads, srpe })

    await prisma.week_summary.upsert({
      where: { weekStart: summary.weekStart },
      update: {
        totalLoad: summary.totalLoad,
        runKm: summary.runKm,
        runMinutes: summary.runMinutes,
        strengthSets: summary.strengthSets,
        plyoContacts: summary.plyoContacts,
        sessionsPlanned: summary.sessionsPlanned,
        sessionsDone: summary.sessionsDone,
        acwrEnd: summary.acwrEnd,
        summaryJson: summary.summaryJson,
      },
      create: {
        weekStart: summary.weekStart,
        totalLoad: summary.totalLoad,
        runKm: summary.runKm,
        runMinutes: summary.runMinutes,
        strengthSets: summary.strengthSets,
        plyoContacts: summary.plyoContacts,
        sessionsPlanned: summary.sessionsPlanned,
        sessionsDone: summary.sessionsDone,
        acwrEnd: summary.acwrEnd,
        summaryJson: summary.summaryJson,
      },
    })
  }

  return starts.length
}

// ── Reading it back ───────────────────────────────────────────────────────────

/**
 * The current record for each subject, each carrying the chain it beat.
 *
 * "Current" is `supersededById === null`. Nothing is deleted, so the chain is
 * always walkable backwards from whatever is on top.
 */
export async function buildHistoryView(today = new Date()): Promise<HistoryView> {
  const sync = await syncPersonalRecords()
  await rollUpClosedWeeks(today)

  const [rows, weekRows] = await Promise.all([
    prisma.personal_records.findMany({ orderBy: { achievedOn: 'desc' } }),
    prisma.week_summary.findMany({
      where: { weekStart: { gte: weekStartOf(subDays(today, ROLLUP_WEEKS * 7)) } },
      orderBy: { weekStart: 'desc' },
    }),
  ])

  const predecessors = new Map<number, typeof rows>()
  for (const row of rows) {
    if (row.supersededById === null) continue
    const list = predecessors.get(row.supersededById) ?? []
    list.push(row)
    predecessors.set(row.supersededById, list)
  }

  const chainOf = (id: number): RecordHistoryEntry[] => {
    const out: RecordHistoryEntry[] = []
    let frontier = predecessors.get(id) ?? []
    while (frontier.length > 0) {
      const next: typeof rows = []
      for (const row of frontier) {
        out.push({
          id: row.id,
          value: row.value,
          achievedOn: isoDay(new Date(row.achievedOn)),
          source: row.source as RecordSource,
          verified: row.verified,
          notes: row.notes,
        })
        next.push(...(predecessors.get(row.id) ?? []))
      }
      frontier = next
    }
    return out.sort((a, b) => b.achievedOn.localeCompare(a.achievedOn))
  }

  const toRow = (row: (typeof rows)[number]): RecordRow => {
    const achievedOn = new Date(row.achievedOn)
    const kind = row.kind as RecordKind
    const detectedLike: Pick<DetectedRecord, 'kind' | 'achievedOn' | 'verified' | 'source'> = {
      kind,
      achievedOn,
      verified: row.verified,
      source: row.source as RecordSource,
    }
    return {
      id: row.id,
      kind,
      family: recordFamily(kind),
      subjectId: row.subjectId,
      label: row.label,
      value: row.value,
      display: formatRecordValue(row.unit as RecordUnit, row.value, row.reps),
      unit: row.unit as RecordUnit,
      reps: row.reps,
      achievedOn: isoDay(achievedOn),
      source: row.source as RecordSource,
      verified: row.verified,
      notes: row.notes,
      currency: recordCurrency(detectedLike, today),
      history: chainOf(row.id),
    }
  }

  const current = rows.filter((r) => r.supersededById === null).map(toRow)

  const weeks: WeekRow[] = weekRows.map((w) => ({
    weekStart: isoDay(new Date(w.weekStart)),
    label: format(new Date(w.weekStart), 'MMM d'),
    totalLoad: w.totalLoad,
    runKm: w.runKm,
    runMinutes: w.runMinutes,
    strengthSets: w.strengthSets,
    plyoContacts: w.plyoContacts,
    sessionsPlanned: w.sessionsPlanned,
    sessionsDone: w.sessionsDone,
    acwrEnd: w.acwrEnd,
  }))

  // Freshest first within each family — a record set last week is the one the
  // athlete is looking for, not the alphabetically first lift.
  const byDate = (a: RecordRow, b: RecordRow) => b.achievedOn.localeCompare(a.achievedOn)

  return {
    generatedFor: isoDay(today),
    lifts: current.filter((r) => r.family === 'lift').sort(byDate),
    runs: current.filter((r) => r.family === 'run').sort(byDate),
    refusals: sync.refusals,
    weeks,
  }
}
