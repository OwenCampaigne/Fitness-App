import { fetchDailyMetrics } from './garmin'
import { prisma } from './db'

export interface SyncResult {
  ok: boolean
  date: string
  isDemo: boolean
  activitiesCount: number
  error?: string
}

export async function syncGarmin(dateStr: string): Promise<SyncResult> {
  const metrics = await fetchDailyMetrics(dateStr)

  if (metrics.isDemo) {
    return {
      ok: false,
      date: dateStr,
      isDemo: true,
      activitiesCount: 0,
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
  for (const act of metrics.activities) {
    // TODO: synthetic fallback ID can drift if Garmin recalculates duration — upsert idempotency mitigates but doesn't prevent orphan rows
    const syntheticId =
      act.garminActivityId ?? `${dateStr}_${act.type}_${Math.round(act.duration)}`
    await prisma.activities.upsert({
      where: { garminActivityId: syntheticId },
      create: {
        date: dateObj,
        type: act.type,
        durationMin:
          act.duration > 0 ? Math.round((act.duration / 60) * 10) / 10 : null,
        avgHr: act.averageHR || null,
        maxHr: act.maxHR || null,
        trimp: act.strain || null,
        garminActivityId: syntheticId,
      },
      update: {
        avgHr: act.averageHR || null,
        maxHr: act.maxHR || null,
        trimp: act.strain || null,
      },
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

  return { ok: true, date: dateStr, isDemo: false, activitiesCount }
}
