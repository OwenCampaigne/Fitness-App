export type ReadinessBand = 'green' | 'amber' | 'red'
export type PainLevel = 'none' | 'sometimes' | 'yes'
export type CalibrationStatus = 'calibrating' | 'baseline_ready' | 'graduated'

export interface ReadinessSignals {
  hrvRatio: number      // lastNight / 28-day rolling median HRV
  rhrDelta: number      // today RHR − 28-day rolling median RHR (bpm above baseline)
  sleepScore: number    // 0–100
  acwr: number          // (7d avg daily load) / (28d avg daily load)
}

export interface ReadinessResult {
  band: ReadinessBand
  decidingSignals: [string, string]
  plainText: string
  signals: ReadinessSignals
  calibration: CalibrationStatus
  daysUntilCalibrated: number | null
  painFlagged: boolean
  provisional: boolean
  lastSyncedAt: string | null  // ISO date string of most recent DB row
  // Secondary display stats
  sleepHours: number | null
  bodyBattery: number | null
  stress: number | null
  hrv: number | null
  rhr: number | null
}
