import { prisma } from './db'
import { format, subDays, differenceInDays } from 'date-fns'
import type { ReadinessBand, ReadinessResult, ReadinessSignals, CalibrationStatus } from '../types/readiness'

// ── Exported interfaces (used by tests without importing Prisma types) ────────

export interface DailyRow {
  date: Date
  hrv: number | null
  rhr: number | null
  sleepScore: number | null
  sleepHours: number | null
  bodyBattery: number | null
  stress: number | null
}

export interface ActivityRow {
  date: Date
  durationMin: number | null
  avgHr: number | null
}

// ── Pure functions (fully unit-testable, no DB) ───────────────────────────────

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

export function estimateSRPE(avgHr: number, age: number): number {
  const maxHR = Math.max(150, 208 - 0.7 * age)
  const pct = avgHr / maxHR
  if (pct < 0.60) return 3
  if (pct < 0.70) return 4
  if (pct < 0.80) return 5
  if (pct < 0.90) return 7
  return 9
}

export function computeSignals(
  rows: DailyRow[],
  activityRows: ActivityRow[],
  today: Date,
  age: number,
): ReadinessSignals {
  const todayStr = format(today, 'yyyy-MM-dd')
  const validHRV = rows.filter(r => r.hrv !== null && r.hrv! > 0).map(r => r.hrv!)
  const validRHR = rows.filter(r => r.rhr !== null && r.rhr! > 0).map(r => r.rhr!)

  const medianHRV = computeMedian(validHRV)
  const medianRHR = computeMedian(validRHR)

  const todayRow = rows.find(r => format(new Date(r.date), 'yyyy-MM-dd') === todayStr)

  const lastNightHRV = (todayRow?.hrv && todayRow.hrv > 0)
    ? todayRow.hrv
    : (validHRV.at(-1) ?? 0)
  const todayRHR = (todayRow?.rhr && todayRow.rhr > 0)
    ? todayRow.rhr
    : (validRHR.at(-1) ?? 0)
  const sleepScore = todayRow?.sleepScore ?? 50

  const hrvRatio = medianHRV > 0 ? lastNightHRV / medianHRV : 1.0
  const rhrDelta = medianRHR > 0 ? todayRHR - medianRHR : 0

  // ACWR: session load = durationMin × sRPE
  function dayLoad(acts: ActivityRow[]): number {
    return acts.reduce((sum, a) => {
      if (!a.durationMin || !a.avgHr) return sum
      return sum + a.durationMin * estimateSRPE(a.avgHr, age)
    }, 0)
  }

  // Build array of 28 daily loads: index 0 = 27 days ago, index 27 = today
  const dailyLoads: number[] = []
  for (let i = 27; i >= 0; i--) {
    const d = format(subDays(today, i), 'yyyy-MM-dd')
    const dayActs = activityRows.filter(a => format(new Date(a.date), 'yyyy-MM-dd') === d)
    dailyLoads.push(dayLoad(dayActs))
  }

  const load7 = dailyLoads.slice(-7).reduce((s, v) => s + v, 0)
  const avg28 = dailyLoads.reduce((s, v) => s + v, 0) / 28
  const acwr = avg28 > 0 ? (load7 / 7) / avg28 : 1.0

  return {
    hrvRatio: Math.round(hrvRatio * 100) / 100,
    rhrDelta: Math.round(rhrDelta * 10) / 10,
    sleepScore: sleepScore ?? 50,
    acwr: Math.round(acwr * 100) / 100,
  }
}

export function computeBand(
  signals: ReadinessSignals,
  painFlagged: boolean,
  acwrCap = 1.3,
): ReadinessBand {
  const { hrvRatio, rhrDelta, sleepScore, acwr } = signals

  // RED veto: any single threshold breach → red
  if (hrvRatio < 0.80 || rhrDelta > 7 || sleepScore < 40 || acwr > 1.5) return 'red'

  // GREEN: all signals healthy AND no pain
  if (
    !painFlagged &&
    hrvRatio >= 0.95 &&
    rhrDelta <= 3 &&
    sleepScore >= 60 &&
    acwr >= 0.8 && acwr <= acwrCap
  ) return 'green'

  return 'amber'
}

export function getDecidingSignals(
  signals: ReadinessSignals,
  _band: ReadinessBand,
  painFlagged: boolean,
): [string, string] {
  if (painFlagged) {
    return ['Knee pain flagged', `HRV ${signals.hrvRatio.toFixed(2)}×`]
  }

  // Score each signal by how far it deviates from ideal, normalized to red thresholds
  // HRV red threshold: < 0.80 (ideal = 1.0, red deviation = 0.20)
  // RHR red threshold: > 7 (ideal = 0, red deviation = 7)
  // Sleep red threshold: < 40 (ideal = 70, red deviation = 30)
  // ACWR red threshold: > 1.5 (ideal = 1.0, red deviation = 0.5)
  const deviations = [
    { label: `HRV ${signals.hrvRatio.toFixed(2)}×`, score: (1.0 - signals.hrvRatio) / 0.20 },
    { label: `RHR ${signals.rhrDelta > 0 ? '+' : ''}${Math.round(signals.rhrDelta)}`, score: signals.rhrDelta / 7 },
    { label: `Sleep ${Math.round(signals.sleepScore)}`, score: (70 - signals.sleepScore) / 30 },
    { label: `ACWR ${signals.acwr.toFixed(2)}`, score: (signals.acwr - 1.0) / 0.5 },
  ]

  const sorted = [...deviations].sort((a, b) => b.score - a.score)
  return [sorted[0].label, sorted[1].label]
}

export function getPlainText(band: ReadinessBand): string {
  if (band === 'green') return 'Ready to train'
  if (band === 'amber') return 'Take it easy today'
  return 'Rest and recover'
}

// ── DB-backed function (not unit tested, tested via /api/readiness endpoint) ──

export async function computeReadiness(): Promise<ReadinessResult> {
  const today = new Date()
  const cutoff28 = subDays(today, 28)

  const [rows, activityRows, calibration, profile] = await Promise.all([
    prisma.readiness_daily.findMany({
      where: { date: { gte: cutoff28 } },
      orderBy: { date: 'asc' },
    }),
    prisma.activities.findMany({
      where: { date: { gte: cutoff28 } },
      orderBy: { date: 'asc' },
    }),
    prisma.calibration_state.findFirst(),
    prisma.athlete_profile.findFirst(),
  ])

  const age = profile?.age ?? 30
  const painFlagged = profile?.currentPainLevel === 'yes'

  // Calibration status
  const dayCount = rows.length
  const windowEnd = calibration?.windowEnd ? new Date(calibration.windowEnd) : null
  const isInCalibrationWindow = windowEnd ? today < windowEnd : dayCount < 21
  const daysUntilCalibrated = windowEnd
    ? Math.max(0, differenceInDays(windowEnd, today))
    : Math.max(0, 21 - dayCount)
  const recoveryBaselineReady = calibration?.recoveryBaselineReady ?? dayCount >= 14

  let calibrationStatus: CalibrationStatus
  if (calibration?.graduated) calibrationStatus = 'graduated'
  else if (isInCalibrationWindow && !recoveryBaselineReady) calibrationStatus = 'calibrating'
  else if (isInCalibrationWindow) calibrationStatus = 'baseline_ready'
  else calibrationStatus = 'graduated'

  const acwrCap = isInCalibrationWindow ? 1.1 : 1.3

  const signals = computeSignals(rows, activityRows, today, age)
  const band = computeBand(signals, painFlagged, acwrCap)
  const decidingSignals = getDecidingSignals(signals, band, painFlagged)

  const todayStr = format(today, 'yyyy-MM-dd')
  const todayRow = rows.find(r => format(new Date(r.date), 'yyyy-MM-dd') === todayStr)
  const lastRow = rows.at(-1)

  return {
    band,
    decidingSignals,
    plainText: getPlainText(band),
    signals,
    calibration: calibrationStatus,
    daysUntilCalibrated: isInCalibrationWindow ? daysUntilCalibrated : null,
    painFlagged,
    provisional: isInCalibrationWindow,
    lastSyncedAt: lastRow ? new Date(lastRow.date).toISOString() : null,
    sleepHours: todayRow?.sleepHours ?? null,
    bodyBattery: todayRow?.bodyBattery ?? null,
    stress: todayRow?.stress ?? null,
    hrv: todayRow?.hrv ?? null,
    rhr: todayRow?.rhr ?? null,
  }
}
