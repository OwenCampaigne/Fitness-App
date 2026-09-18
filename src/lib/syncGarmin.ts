import { fetchActivitySplits, fetchDailyMetrics } from './garmin'
import { prisma } from './db'
import {
  type ActivitySplits,
  computeDecoupling,
  parseStoredSplits,
  serializeSplits,
} from './splits'

export interface SyncResult {
  ok: boolean
  date: string
  isDemo: boolean
  activitiesCount: number
  /** Activities that ended the sync with per-split data stored. */
  splitsStored: number
  /** Activities whose splits passed the Pa:HR gate and got a number. */
  decouplingComputed: number
  error?: string
}

export interface SyncOptions {
  /**
   * Re-pull laps for activities that already have them. Off by default: splits
   * of a finished activity never change, and asking Garmin again for 28 days of
   * them is the fastest route to a 429 (framework §20).
   */
  refreshSplits?: boolean
  /** Skip the lap fetch entirely — readiness-only sync. */
  skipSplits?: boolean
}

/** Garmin's type keys for running are `running`, `trail_running`, `treadmill_running`… */
export function isRunType(type: string | null | undefined): boolean {
  return !!type && type.toLowerCase().includes('run')
}

/**
 * Ensure an activity row has splits, without asking Garmin twice for the same
 * thing.
 *
 * This is what makes the backfill resumable: a row that already carries splits
 * is reused as-is, so re-running after a rate limit picks up exactly where it
 * stopped rather than starting the whole conversation again.
 */
async function resolveSplits(
  garminActivityId: string | null,
  stored: string | null,
  opts: SyncOptions,
): Promise<ActivitySplits | null> {
  if (opts.skipSplits) return parseStoredSplits(stored)

  if (!opts.refreshSplits) {
    const existing = parseStoredSplits(stored)
    if (existing) return existing
  }

  // A synthetic id is one we made up locally; Garmin has never heard of it.
  if (!garminActivityId || !/^\d+$/.test(garminActivityId)) return parseStoredSplits(stored)

  const fetched = await fetchActivitySplits(garminActivityId, { force: opts.refreshSplits })
  return fetched ?? parseStoredSplits(stored)
}

export async function syncGarmin(dateStr: string, opts: SyncOptions = {}): Promise<SyncResult> {
  const metrics = await fetchDailyMetrics(dateStr)

  if (metrics.isDemo) {
    return {
      ok: false,
      date: dateStr,
      isDemo: true,
      activitiesCount: 0,
      splitsStored: 0,
      decouplingComputed: 0,
      error: metrics.demoReason ?? 'demo_mode',
    }
  }

  // Parse date as local midnight to avoid UTC off-by-one in date comparisons
  const [year, month, day] = dateStr.split('-').map(Number)
  const dateObj = new Date(year, month - 1, day)

  // Upsert readiness_daily
  const readinessData = {
    recoveryScore: metrics.recovery.score || null,
    hrv: metrics.hrv.lastNight || null,
    hrvBaseline: metrics.hrv.weeklyAverage || null,
    rhr: metrics.recovery.restingHR || null,
    sleepScore: metrics.sleep.sleepScore || null,
    sleepHours:
      metrics.sleep.totalSleepSeconds > 0
        ? Math.round((metrics.sleep.totalSleepSeconds / 3600) * 10) / 10
        : null,
    bodyBattery: metrics.bodyBattery.isAvailable ? (metrics.bodyBattery.current || null) : null,
    stress: metrics.stress.average || null,
  }

  await prisma.readiness_daily.upsert({
    where: { date: dateObj },
    create: { date: dateObj, ...readinessData },
    update: readinessData,
  })

  // Upsert activities
  let activitiesCount = 0
  let splitsStored = 0
  let decouplingComputed = 0

  for (const act of metrics.activities) {
    // TODO: synthetic fallback ID can drift if Garmin recalculates duration — upsert idempotency mitigates but doesn't prevent orphan rows
    const syntheticId =
      act.garminActivityId ?? `${dateStr}_${act.type}_${Math.round(act.duration)}`

    const existing = await prisma.activities.findUnique({
      where: { garminActivityId: syntheticId },
      select: { splits: true },
    })

    // ── Averages the sync was previously dropping (framework §3) ──────────────
    // Distance is the one that mattered most: without it there is no pace, and
    // without pace there is no pace:HR ratio to decouple.
    const distanceKm =
      typeof act.distanceM === 'number' && act.distanceM > 0
        ? Math.round((act.distanceM / 1000) * 100) / 100
        : null
    const durationMin = act.duration > 0 ? Math.round((act.duration / 60) * 10) / 10 : null
    const avgPaceSecPerKm =
      distanceKm && distanceKm > 0 && act.duration > 0
        ? Math.round(act.duration / distanceKm)
        : null

    // ── Splits and decoupling (framework §7) ──────────────────────────────────
    const splits = isRunType(act.type)
      ? act.splits ?? (await resolveSplits(act.garminActivityId ?? null, existing?.splits ?? null, opts))
      : null

    const decoupling = computeDecoupling(splits)
    const decouplingPct = decoupling.available ? decoupling.driftPct : null

    if (splits) splitsStored++
    if (decouplingPct !== null) decouplingComputed++

    const detail = {
      durationMin,
      distanceKm,
      avgHr: act.averageHR || null,
      maxHr: act.maxHR || null,
      avgPaceSecPerKm,
      cadence: act.cadenceSpm ?? null,
      elevationM: act.elevationGainM ?? null,
      trimp: act.strain || null,
      // Never null out splits we already have because this pull came back empty:
      // a sync failure is stale data, never a deletion (framework §20).
      ...(splits ? { splits: serializeSplits(splits), decoupling: decouplingPct } : {}),
    }

    await prisma.activities.upsert({
      where: { garminActivityId: syntheticId },
      create: {
        date: dateObj,
        type: act.type,
        garminActivityId: syntheticId,
        ...detail,
      },
      update: detail,
    })
    activitiesCount++
  }

  // Update calibration baseline flag once we have 14+ days of data
  const dayCount = await prisma.readiness_daily.count()
  if (dayCount >= 14) {
    await prisma.calibration_state.updateMany({
      where: { recoveryBaselineReady: false },
      data: { recoveryBaselineReady: true },
    })
  }

  return {
    ok: true,
    date: dateStr,
    isDemo: false,
    activitiesCount,
    splitsStored,
    decouplingComputed,
  }
}

// ── Backfilling splits onto rows that already exist ───────────────────────────

export interface SplitsBackfillResult {
  candidates: number
  fetched: number
  decouplingComputed: number
  stillMissing: number
  rateLimited: boolean
}

export interface SplitsBackfillOptions {
  /** Only consider activities on or after this date. */
  since?: Date
  /** Re-pull even for rows that already carry splits. */
  refresh?: boolean
  /** Pause between Garmin calls. Garmin rate-limits; this is not optional. */
  pauseMs?: number
  /** Stop after this many fetches, so a long backfill can be run in slices. */
  limit?: number
  onProgress?: (line: string) => void
}

/**
 * Fill in splits and decoupling for run rows that are missing them.
 *
 * Separate from the day-walk because the two fail differently: a day sync can
 * fail because Garmin had no data for that date, while a splits fetch fails per
 * activity. Running this as its own pass means a rate limit halfway through
 * leaves every completed row intact, and a re-run resumes at the first row that
 * still has no splits — idempotent by construction, not by bookkeeping.
 */
export async function backfillActivitySplits(
  opts: SplitsBackfillOptions = {},
): Promise<SplitsBackfillResult> {
  const pauseMs = opts.pauseMs ?? 1200
  const log = opts.onProgress ?? (() => {})

  const rows = await prisma.activities.findMany({
    where: {
      ...(opts.since ? { date: { gte: opts.since } } : {}),
      ...(opts.refresh ? {} : { splits: null }),
    },
    orderBy: { date: 'desc' },
    select: { id: true, date: true, type: true, garminActivityId: true, splits: true },
  })

  // Garmin only knows numeric activity ids; a synthetic one was invented here
  // because the summary had none, and no amount of asking will resolve it.
  const candidates = rows.filter(
    (r) => isRunType(r.type) && r.garminActivityId && /^\d+$/.test(r.garminActivityId),
  )

  let fetched = 0
  let decouplingComputed = 0
  let rateLimited = false

  for (const row of candidates) {
    if (opts.limit && fetched >= opts.limit) break

    let splits: ActivitySplits | null = null
    try {
      splits = await fetchActivitySplits(row.garminActivityId as string, { force: opts.refresh })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`  ✗ ${row.garminActivityId}  ${msg}`)
      if (msg.includes('429')) {
        rateLimited = true
        break
      }
      continue
    }

    if (!splits) {
      log(`  · ${row.garminActivityId}  no laps recorded`)
      await new Promise((r) => setTimeout(r, pauseMs))
      continue
    }

    const decoupling = computeDecoupling(splits)
    const decouplingPct = decoupling.available ? decoupling.driftPct : null
    if (decouplingPct !== null) decouplingComputed++

    await prisma.activities.update({
      where: { id: row.id },
      data: { splits: serializeSplits(splits), decoupling: decouplingPct },
    })
    fetched++

    log(
      `  ✓ ${row.garminActivityId}  ${splits.splits.length} splits, ` +
        (decouplingPct !== null
          ? `decoupling ${decouplingPct}%`
          : `no decoupling — ${(decoupling as { reason: string }).reason}`),
    )

    await new Promise((r) => setTimeout(r, pauseMs))
  }

  const stillMissing = await prisma.activities.count({
    where: {
      ...(opts.since ? { date: { gte: opts.since } } : {}),
      splits: null,
      type: { contains: 'run' },
    },
  })

  return { candidates: candidates.length, fetched, decouplingComputed, stillMissing, rateLimited }
}
