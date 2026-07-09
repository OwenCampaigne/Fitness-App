import type { ReadinessResult } from '../types/readiness'

const BASE: ReadinessResult = {
  band: 'green',
  plainText: 'Ready to train',
  decidingSignals: ['HRV 1.0×', 'ACWR 1.0'],
  signals: { hrvRatio: 1.0, rhrDelta: 0, sleepScore: 75, acwr: 1.0 },
  calibration: 'graduated',
  provisional: false,
  daysUntilCalibrated: null,
  painFlagged: false,
  lastSyncedAt: new Date().toISOString(),
  sleepHours: 7.5,
  bodyBattery: 72,
  stress: 28,
  hrv: 52,
  rhr: 58,
}

export const SCENARIOS: Record<string, ReadinessResult> = {
  green_day: {
    ...BASE,
    band: 'green',
    plainText: 'Ready to train',
    signals: { hrvRatio: 1.04, rhrDelta: -1, sleepScore: 82, acwr: 0.95 },
    decidingSignals: ['HRV 1.04×', 'ACWR 0.95'],
    sleepHours: 7.2,
    bodyBattery: 71,
    stress: 24,
  },
  amber_day: {
    ...BASE,
    band: 'amber',
    plainText: 'Take it easy today',
    signals: { hrvRatio: 0.92, rhrDelta: 2, sleepScore: 65, acwr: 1.15 },
    decidingSignals: ['HRV 0.92×', 'ACWR 1.15'],
    sleepHours: 6.5,
    bodyBattery: 58,
    stress: 42,
  },
  red_day: {
    ...BASE,
    band: 'red',
    plainText: 'Rest and recover',
    signals: { hrvRatio: 0.74, rhrDelta: 9, sleepScore: 35, acwr: 1.2 },
    decidingSignals: ['HRV 0.74×', 'RHR +9'],
    sleepHours: 5.2,
    bodyBattery: 30,
    stress: 65,
    hrv: 38,
    rhr: 67,
  },
  high_acwr: {
    ...BASE,
    band: 'red',
    plainText: 'Rest and recover',
    signals: { hrvRatio: 0.96, rhrDelta: 1, sleepScore: 78, acwr: 1.6 },
    decidingSignals: ['ACWR 1.60', 'Sleep 78'],
    sleepHours: 7.8,
    bodyBattery: 68,
  },
  calibrating: {
    ...BASE,
    band: 'amber',
    plainText: 'Take it easy today',
    calibration: 'calibrating',
    provisional: true,
    daysUntilCalibrated: 13,
    signals: { hrvRatio: 0.95, rhrDelta: 0, sleepScore: 72, acwr: 0.8 },
    decidingSignals: ['HRV 0.95×', 'Sleep 72'],
    sleepHours: 7.0,
    bodyBattery: 65,
  },
  pain_flagged: {
    ...BASE,
    band: 'amber',
    plainText: 'Take it easy today',
    painFlagged: true,
    signals: { hrvRatio: 1.02, rhrDelta: 0, sleepScore: 80, acwr: 0.9 },
    decidingSignals: ['Knee pain flagged', 'HRV 1.02×'],
  },
}

export function getScenario(): ReadinessResult | null {
  if (process.env.NODE_ENV === 'production') return null
  const name = process.env.SCENARIO
  if (!name) return null
  return SCENARIOS[name] ?? null
}
