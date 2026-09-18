# Phase 1: Readiness + Intro Ramp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a real "today's readiness" screen backed by Garmin data showing GREEN / AMBER / RED with the two numbers that decided it and a plain-language line.

**Architecture:** DB-first — cron-job.org hits `/api/sync` 3×/day which writes to SQLite; all other paths read from DB. Cold-start: `/api/readiness` calls `syncGarmin()` inline if DB is empty. Home screen is a Server Component that checks onboarding status and calls `computeReadiness()` directly.

**Tech Stack:** Next.js 14.2.5 App Router, Prisma 7 + better-sqlite3, date-fns, TypeScript, Tailwind CSS, Jest

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add `currentPainLevel` + `recoveryContextJson` to `athlete_profile` |
| `src/types/readiness.ts` | Create | Shared types: `ReadinessBand`, `ReadinessResult`, `ReadinessSignals` |
| `src/lib/scenario.ts` | Create | Dev scenario presets keyed by `SCENARIO` env var |
| `src/lib/__tests__/readiness.test.ts` | Create | Unit tests for pure math functions |
| `src/lib/readiness.ts` | Create | Pure math functions + `computeReadiness()` DB function |
| `src/lib/types.ts` | Modify | Add `garminActivityId?` to `ActivityData` |
| `src/lib/garmin.ts` | Modify | Extract `activityId` in `parseActivities` |
| `src/lib/syncGarmin.ts` | Create | Garmin fetch + DB write logic (shared by API route + bootstrap) |
| `src/app/api/sync/route.ts` | Create | Auth guard wrapper that calls `syncGarmin()` |
| `src/app/api/readiness/route.ts` | Create | Cold-start bootstrap + scenario check + `computeReadiness()` |
| `src/app/api/profile/route.ts` | Create | POST (onboarding save) + PATCH (pain update) |
| `src/app/onboarding/page.tsx` | Create | Two-screen intake form (client component) |
| `src/components/ReadinessBand.tsx` | Create | GREEN/AMBER/RED display card + stat rows |
| `src/components/PainStatusModal.tsx` | Create | Bottom sheet for pain level update |
| `src/app/page.tsx` | Modify | Server component: check onboarding, fetch readiness, render |

---

## Environment variables to add to `.env.local`

```bash
CRON_SECRET=replace-with-random-string
# Optional dev-only scenario override:
# SCENARIO=green_day
```

Scenario values: `green_day` | `amber_day` | `red_day` | `high_acwr` | `calibrating` | `pain_flagged`

---

## Task 1: Schema Migration + Shared Types + Scenario Mode

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/types/readiness.ts`
- Create: `src/lib/scenario.ts`

- [ ] **Step 1: Add two fields to `athlete_profile` in `prisma/schema.prisma`**

Find the `athlete_profile` model (ends with `updatedAt DateTime @updatedAt`) and add two lines **before** the closing `}`:

```prisma
  currentPainLevel    String  @default("none")
  recoveryContextJson String?
```

The final model should look like:

```prisma
model athlete_profile {
  id                    Int       @id @default(autoincrement())
  age                   Int?
  sex                   String?
  heightCm              Float?
  weightKg              Float?
  goalRace              String?
  goalRaceDate          DateTime?
  fitnessLevel          String?
  injuryHistory         String?
  hrZonesJson           String?
  trainingPacesJson     String?
  keyLiftLoadsJson      String?
  plyoTier              Int?
  plyoTierSource        String?
  plyoTierConfidence    String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  currentPainLevel      String    @default("none")
  recoveryContextJson   String?
}
```

- [ ] **Step 2: Push schema to DB and regenerate client**

Run from the project root:
```bash
npx prisma db push
npx prisma generate
```

Expected output from `db push`: `Your database is now in sync with your Prisma schema.`
Expected output from `generate`: `Generated Prisma Client ... to ./src/generated/prisma`

- [ ] **Step 3: Create `src/types/readiness.ts`**

```ts
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
```

- [ ] **Step 4: Create `src/lib/scenario.ts`**

```ts
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
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/types/readiness.ts src/lib/scenario.ts
git commit -m "feat: Phase 1 schema migration + readiness types + scenario presets"
```

---

## Task 2: Readiness Computation Library (TDD)

**Files:**
- Create: `src/lib/__tests__/readiness.test.ts`
- Create: `src/lib/readiness.ts`

- [ ] **Step 1: Write the failing tests in `src/lib/__tests__/readiness.test.ts`**

```ts
import { subDays } from 'date-fns'
import {
  computeMedian,
  estimateSRPE,
  computeSignals,
  computeBand,
  getDecidingSignals,
  getPlainText,
  type DailyRow,
  type ActivityRow,
} from '../readiness'
import type { ReadinessSignals } from '../../types/readiness'

// ── computeMedian ────────────────────────────────────────────────────────────

describe('computeMedian', () => {
  it('returns middle value for odd-length array', () => {
    expect(computeMedian([1, 3, 5])).toBe(3)
  })
  it('returns average of two middles for even-length array', () => {
    expect(computeMedian([1, 2, 3, 4])).toBe(2.5)
  })
  it('handles single value', () => {
    expect(computeMedian([42])).toBe(42)
  })
  it('returns 0 for empty array', () => {
    expect(computeMedian([])).toBe(0)
  })
  it('sorts before computing median', () => {
    expect(computeMedian([5, 1, 3])).toBe(3)
  })
})

// ── estimateSRPE ─────────────────────────────────────────────────────────────

describe('estimateSRPE', () => {
  // age 30 → maxHR = 208 - 0.7*30 = 187 bpm
  it('returns 3 for easy effort (< 60% maxHR)', () => {
    expect(estimateSRPE(100, 30)).toBe(3) // 100/187 = 53%
  })
  it('returns 4 for light effort (60–70% maxHR)', () => {
    expect(estimateSRPE(118, 30)).toBe(4) // 118/187 = 63%
  })
  it('returns 5 for moderate effort (70–80% maxHR)', () => {
    expect(estimateSRPE(140, 30)).toBe(5) // 140/187 = 75%
  })
  it('returns 7 for hard effort (80–90% maxHR)', () => {
    expect(estimateSRPE(158, 30)).toBe(7) // 158/187 = 84%
  })
  it('returns 9 for maximal effort (> 90% maxHR)', () => {
    expect(estimateSRPE(178, 30)).toBe(9) // 178/187 = 95%
  })
})

// ── computeSignals ───────────────────────────────────────────────────────────

function makeRow(date: Date, hrv: number | null, rhr: number | null, sleepScore: number | null): DailyRow {
  return { date, hrv, rhr, sleepScore, sleepHours: null, bodyBattery: null, stress: null }
}

describe('computeSignals', () => {
  it('returns acwr 1.0 when no activity rows', () => {
    const today = new Date(2026, 0, 28, 12, 0, 0)
    const result = computeSignals([], [], today, 30)
    expect(result.acwr).toBe(1.0)
  })

  it('computes hrv ratio from 28-day median', () => {
    // 10 rows: hrv=50 for all days except today which has hrv=60
    const today = new Date(2026, 0, 28, 12, 0, 0)
    const rows: DailyRow[] = Array.from({ length: 10 }, (_, i) =>
      makeRow(
        new Date(2026, 0, 19 + i, 12, 0, 0), // Jan 19–28
        i === 9 ? 60 : 50,  // today (Jan 28, i=9) has hrv=60
        58,
        75,
      )
    )
    const result = computeSignals(rows, [], today, 30)
    // median([50,50,50,50,50,50,50,50,50,60]) = (50+50)/2 = 50
    // today hrv = 60 → ratio = 60/50 = 1.2
    expect(result.hrvRatio).toBe(1.2)
  })

  it('returns hrv ratio 1.0 when no hrv data', () => {
    const today = new Date(2026, 0, 28, 12, 0, 0)
    const rows: DailyRow[] = [makeRow(today, null, 60, 75)]
    const result = computeSignals(rows, [], today, 30)
    expect(result.hrvRatio).toBe(1.0)
  })
})

// ── computeBand ──────────────────────────────────────────────────────────────

const goodSignals: ReadinessSignals = {
  hrvRatio: 1.0,
  rhrDelta: 0,
  sleepScore: 75,
  acwr: 1.0,
}

describe('computeBand', () => {
  it('returns green for healthy signals without pain', () => {
    expect(computeBand(goodSignals, false)).toBe('green')
  })
  it('returns red when HRV ratio below 0.80', () => {
    expect(computeBand({ ...goodSignals, hrvRatio: 0.79 }, false)).toBe('red')
  })
  it('returns red when RHR delta above 7', () => {
    expect(computeBand({ ...goodSignals, rhrDelta: 8 }, false)).toBe('red')
  })
  it('returns red when sleep score below 40', () => {
    expect(computeBand({ ...goodSignals, sleepScore: 39 }, false)).toBe('red')
  })
  it('returns red when ACWR above 1.5', () => {
    expect(computeBand({ ...goodSignals, acwr: 1.6 }, false)).toBe('red')
  })
  it('returns amber when pain flagged even with green signals', () => {
    expect(computeBand(goodSignals, true)).toBe('amber')
  })
  it('returns amber when HRV is borderline (0.90–0.95)', () => {
    expect(computeBand({ ...goodSignals, hrvRatio: 0.92 }, false)).toBe('amber')
  })
  it('returns green at acwr 1.2 with default cap 1.3', () => {
    expect(computeBand({ ...goodSignals, acwr: 1.2 }, false, 1.3)).toBe('green')
  })
  it('returns amber at acwr 1.2 with tighter cap 1.1 (calibration window)', () => {
    expect(computeBand({ ...goodSignals, acwr: 1.2 }, false, 1.1)).toBe('amber')
  })
})

// ── getDecidingSignals ────────────────────────────────────────────────────────

describe('getDecidingSignals', () => {
  it('puts knee pain first when pain is flagged', () => {
    const [first] = getDecidingSignals(goodSignals, 'amber', true)
    expect(first).toBe('Knee pain flagged')
  })
  it('picks the two highest-deviation signals', () => {
    // HRV very low (big deviation) + RHR very high (big deviation)
    const signals: ReadinessSignals = { hrvRatio: 0.70, rhrDelta: 10, sleepScore: 70, acwr: 1.0 }
    const [first, second] = getDecidingSignals(signals, 'red', false)
    expect(first).toMatch(/HRV 0\.70/)
    expect(second).toMatch(/RHR \+10/)
  })
})

// ── getPlainText ──────────────────────────────────────────────────────────────

describe('getPlainText', () => {
  it('returns correct text for each band', () => {
    expect(getPlainText('green')).toBe('Ready to train')
    expect(getPlainText('amber')).toBe('Take it easy today')
    expect(getPlainText('red')).toBe('Rest and recover')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=readiness
```

Expected: FAIL — `Cannot find module '../readiness'`

- [ ] **Step 3: Create `src/lib/readiness.ts`**

```ts
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

  const deviations = [
    { label: `HRV ${signals.hrvRatio.toFixed(2)}×`, score: Math.abs(signals.hrvRatio - 1.0) * 3 },
    { label: `RHR ${signals.rhrDelta > 0 ? '+' : ''}${Math.round(signals.rhrDelta)}`, score: Math.abs(signals.rhrDelta) / 7 },
    { label: `Sleep ${Math.round(signals.sleepScore)}`, score: Math.abs(signals.sleepScore - 70) / 30 },
    { label: `ACWR ${signals.acwr.toFixed(2)}`, score: Math.abs(signals.acwr - 1.0) * 2 },
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=readiness
```

Expected: All tests PASS. If `date-fns` is not transforming correctly, check `jest.config.ts` — `nextJest` handles this automatically.

- [ ] **Step 5: Commit**

```bash
git add src/lib/__tests__/readiness.test.ts src/lib/readiness.ts
git commit -m "feat: readiness computation library with TDD (median, sRPE, band, deciding signals)"
```

---

## Task 3: ActivityData Update + Garmin Sync Infrastructure

**Files:**
- Modify: `src/lib/types.ts` (line 38–47, `ActivityData` interface)
- Modify: `src/lib/garmin.ts` (line 153–171, `parseActivities` function)
- Create: `src/lib/syncGarmin.ts`
- Create: `src/app/api/sync/route.ts`

- [ ] **Step 1: Add `garminActivityId` to `ActivityData` in `src/lib/types.ts`**

Find the `ActivityData` interface (currently lines 38–46) and add one optional field:

```ts
export interface ActivityData {
  name: string;
  duration: number;
  calories: number;
  strain: number;
  averageHR: number;
  maxHR: number;
  type: string;
  garminActivityId?: string;  // add this line
}
```

- [ ] **Step 2: Update `parseActivities` in `src/lib/garmin.ts` to extract `activityId`**

Find the `parseActivities` function (lines 153–171). Change the return object to include `garminActivityId`:

```ts
function parseActivities(raw: unknown[]): ActivityData[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 5).map((a: unknown) => {
    const act = a as Record<string, unknown>;
    const avgHR = (act.averageHR ?? act.averageHeartRateInBeatsPerMinute ?? 0) as number;
    const maxHR = (act.maxHR ?? act.maxHeartRateInBeatsPerMinute ?? 0) as number;
    const dur = (act.duration ?? act.movingDuration ?? 0) as number;
    const type = act.activityType as Record<string, unknown> | undefined;
    const activityId = act.activityId ?? act.activitySummaryDTO
      ? String((act.activityId ?? (act.activitySummaryDTO as Record<string, unknown> | undefined)?.activityId) ?? '')
      : undefined;
    return {
      name: (act.activityName ?? act.name ?? 'Activity') as string,
      duration: dur,
      calories: (act.calories ?? 0) as number,
      strain: 0,
      averageHR: avgHR,
      maxHR,
      type: (type?.typeKey ?? type?.key ?? 'other') as string,
      garminActivityId: activityId || undefined,
    };
  });
}
```

- [ ] **Step 3: Create `src/lib/syncGarmin.ts`**

```ts
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
```

- [ ] **Step 4: Create `src/app/api/sync/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { format } from 'date-fns'
import { syncGarmin } from '@/lib/syncGarmin'

export async function GET(req: NextRequest) {
  return handler(req)
}

export async function POST(req: NextRequest) {
  return handler(req)
}

async function handler(req: NextRequest) {
  const secret =
    req.nextUrl.searchParams.get('secret') ?? req.headers.get('x-cron-secret')

  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dateStr =
    req.nextUrl.searchParams.get('date') ?? format(new Date(), 'yyyy-MM-dd')

  try {
    const result = await syncGarmin(dateStr)
    if (!result.ok) {
      return NextResponse.json(result, { status: 503 })
    }
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/sync] error:', msg)
    return NextResponse.json({ error: msg }, { status: 503 })
  }
}
```

- [ ] **Step 5: Add `.env.local` entry if not already present**

Open `.env.local` (create if missing) and confirm it has:

```bash
CRON_SECRET=replace-with-random-string
```

- [ ] **Step 6: Test the auth guard**

Start the dev server (`npm run dev`) and visit:
```
http://localhost:3030/api/sync
```

Expected: `{"error":"Unauthorized"}` with status 401.

Then test with correct secret:
```
http://localhost:3030/api/sync?secret=replace-with-random-string
```

Expected: `{"ok":true,...}` or `{"ok":false,"error":"demo_mode"}` if no Garmin credentials.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/garmin.ts src/lib/syncGarmin.ts src/app/api/sync/route.ts
git commit -m "feat: Garmin sync infrastructure — syncGarmin shared fn + /api/sync route"
```

---

## Task 4: Readiness API Route

**Files:**
- Create: `src/app/api/readiness/route.ts`

- [ ] **Step 1: Create `src/app/api/readiness/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { format } from 'date-fns'
import { computeReadiness } from '@/lib/readiness'
import { getScenario } from '@/lib/scenario'
import { syncGarmin } from '@/lib/syncGarmin'
import { prisma } from '@/lib/db'

export async function GET() {
  // Scenario mode: return preset without touching DB (dev only)
  const scenario = getScenario()
  if (scenario) {
    return NextResponse.json({
      ...scenario,
      scenarioMode: process.env.SCENARIO,
    })
  }

  // Cold-start bootstrap: if DB is empty, run sync inline before computing
  const rowCount = await prisma.readiness_daily.count()
  if (rowCount === 0) {
    const syncResult = await syncGarmin(format(new Date(), 'yyyy-MM-dd'))
    if (!syncResult.ok) {
      return NextResponse.json(
        { error: 'No data yet — Garmin sync failed', detail: syncResult.error },
        { status: 503 },
      )
    }
  }

  try {
    const result = await computeReadiness()
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/readiness] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
```

- [ ] **Step 2: Test the route with scenario mode**

Add `SCENARIO=green_day` to `.env.local`, restart the dev server, and visit:
```
http://localhost:3030/api/readiness
```

Expected: JSON with `band: "green"`, `scenarioMode: "green_day"`, `plainText: "Ready to train"`.

Then test with `SCENARIO=red_day` — expected `band: "red"`.

Remove or comment out the SCENARIO line when done testing.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/readiness/route.ts
git commit -m "feat: /api/readiness route with scenario mode and cold-start bootstrap"
```

---

## Task 5: Profile API + Onboarding Intake Form

**Files:**
- Create: `src/app/api/profile/route.ts`
- Create: `src/app/onboarding/page.tsx`

- [ ] **Step 1: Create `src/app/api/profile/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { addDays } from 'date-fns'
import { prisma } from '@/lib/db'

// POST — full onboarding save (creates or replaces the single athlete_profile row)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      age: number
      sex: string
      surgicalLeg: 'left' | 'right'
      surgeryDateApprox: string    // 'YYYY-MM'
      weeklyRunMinutes: number
      longestRunSegmentMin: number
      currentPainLevel: 'none' | 'sometimes' | 'yes'
    }

    const {
      age, sex,
      surgicalLeg, surgeryDateApprox,
      weeklyRunMinutes, longestRunSegmentMin,
      currentPainLevel,
    } = body

    const injuryHistory = JSON.stringify([
      'ACL tear', 'MACI', 'HTO', `${surgicalLeg} knee`,
    ])
    const recoveryContextJson = JSON.stringify({
      surgicalLeg,
      surgeryDateApprox,
      weeklyRunMinutes,
      longestRunSegmentMin,
    })

    const profileData = {
      age,
      sex,
      injuryHistory,
      currentPainLevel,
      recoveryContextJson,
      plyoTier: 1,
      plyoTierSource: 'estimate',
      plyoTierConfidence: 'estimate',
      trainingPacesJson: JSON.stringify({
        easy: { value: null, source: 'unknown', confidence: 'estimate' },
      }),
      keyLiftLoadsJson: JSON.stringify({}),
    }

    const existing = await prisma.athlete_profile.findFirst()
    if (existing) {
      await prisma.athlete_profile.update({ where: { id: existing.id }, data: profileData })
    } else {
      await prisma.athlete_profile.create({ data: profileData })
    }

    // Initialize calibration_state
    const today = new Date()
    const existingDays = await prisma.readiness_daily.count()
    const calibrationDays = Math.max(7, 21 - existingDays)
    const windowEnd = addDays(today, calibrationDays)

    const calData = {
      startedOn: today,
      windowEnd,
      recoveryBaselineReady: existingDays >= 14,
      graduated: existingDays >= 21,
    }

    const existingCal = await prisma.calibration_state.findFirst()
    if (existingCal) {
      await prisma.calibration_state.update({ where: { id: existingCal.id }, data: calData })
    } else {
      await prisma.calibration_state.create({ data: calData })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// PATCH — update pain level only (used by pain chip modal on home screen)
export async function PATCH(req: NextRequest) {
  try {
    const { currentPainLevel } = await req.json() as { currentPainLevel: string }
    const existing = await prisma.athlete_profile.findFirst()
    if (!existing) {
      return NextResponse.json({ error: 'No profile found' }, { status: 404 })
    }
    await prisma.athlete_profile.update({
      where: { id: existing.id },
      data: { currentPainLevel },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
```

- [ ] **Step 2: Create `src/app/onboarding/page.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, CheckCircle } from 'lucide-react'

type PainLevel = 'none' | 'sometimes' | 'yes'
type SurgicalLeg = 'left' | 'right'

interface Screen1 { age: string; sex: 'male' | 'female' }
interface Screen2 {
  surgicalLeg: SurgicalLeg
  surgeryYear: string
  surgeryMonth: string
  weeklyRunMinutes: string
  longestRunSegmentMin: string
  currentPainLevel: PainLevel
}

function OptionBtn<T extends string>({
  value, current, label, onClick,
}: { value: T; current: T; label: string; onClick: (v: T) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={`flex-1 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
        value === current
          ? 'bg-primary text-bg border-primary'
          : 'bg-surface text-secondary border-border'
      }`}
    >
      {label}
    </button>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [s1, setS1] = useState<Screen1>({ age: '', sex: 'male' })
  const [s2, setS2] = useState<Screen2>({
    surgicalLeg: 'right',
    surgeryYear: '',
    surgeryMonth: '',
    weeklyRunMinutes: '',
    longestRunSegmentMin: '',
    currentPainLevel: 'none',
  })

  const screen1Valid =
    s1.age !== '' && parseInt(s1.age, 10) >= 10 && parseInt(s1.age, 10) <= 100

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          age: parseInt(s1.age, 10),
          sex: s1.sex,
          surgicalLeg: s2.surgicalLeg,
          surgeryDateApprox: `${s2.surgeryYear}-${s2.surgeryMonth.padStart(2, '0')}`,
          weeklyRunMinutes: parseInt(s2.weeklyRunMinutes, 10) || 0,
          longestRunSegmentMin: parseInt(s2.longestRunSegmentMin, 10) || 1,
          currentPainLevel: s2.currentPainLevel,
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      router.push('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-primary/50 transition-colors'

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-md py-8">
        {/* Progress bar */}
        <div className="flex gap-2 mb-8">
          <div className="h-1 flex-1 rounded-full bg-primary" />
          <div className={`h-1 flex-1 rounded-full transition-colors ${step === 2 ? 'bg-primary' : 'bg-border'}`} />
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="text-xl font-bold text-primary mb-1">Welcome to Running on AI</h1>
              <p className="text-sm text-secondary">A few quick questions to calibrate your readiness system.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-secondary uppercase tracking-widest">Age</label>
              <input
                type="number"
                value={s1.age}
                onChange={e => setS1(p => ({ ...p, age: e.target.value }))}
                min={10}
                max={100}
                placeholder="e.g. 28"
                className={inputCls}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-secondary uppercase tracking-widest">Sex</label>
              <div className="flex gap-2">
                <OptionBtn value="male" current={s1.sex} label="Male" onClick={v => setS1(p => ({ ...p, sex: v }))} />
                <OptionBtn value="female" current={s1.sex} label="Female" onClick={v => setS1(p => ({ ...p, sex: v }))} />
              </div>
            </div>

            <div className="pt-2 border-t border-border text-xs text-muted">
              <p className="font-semibold text-secondary mb-0.5">Goal</p>
              <p>Return to run — post-surgical recovery</p>
            </div>

            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!screen1Valid}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-bg font-bold text-sm disabled:opacity-40"
            >
              Next <ArrowRight size={16} />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="text-xl font-bold text-primary mb-1">Where you are right now</h1>
              <p className="text-sm text-secondary">Helps the system start conservative and adapt as you improve.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-secondary uppercase tracking-widest">Surgical Leg</label>
              <div className="flex gap-2">
                <OptionBtn value="left" current={s2.surgicalLeg} label="Left" onClick={v => setS2(p => ({ ...p, surgicalLeg: v }))} />
                <OptionBtn value="right" current={s2.surgicalLeg} label="Right" onClick={v => setS2(p => ({ ...p, surgicalLeg: v }))} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-secondary uppercase tracking-widest">
                Surgery Date <span className="text-muted font-normal normal-case">(approximate)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={s2.surgeryYear}
                  onChange={e => setS2(p => ({ ...p, surgeryYear: e.target.value }))}
                  placeholder="Year (2025)"
                  min={2020}
                  max={2030}
                  className="flex-1 bg-surface border border-border rounded-xl px-3 py-3 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-primary/50"
                />
                <input
                  type="number"
                  value={s2.surgeryMonth}
                  onChange={e => setS2(p => ({ ...p, surgeryMonth: e.target.value }))}
                  placeholder="Month (1–12)"
                  min={1}
                  max={12}
                  className="flex-1 bg-surface border border-border rounded-xl px-3 py-3 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-primary/50"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-secondary uppercase tracking-widest">
                Weekly Running Time <span className="text-muted font-normal normal-case">(run segments only, min)</span>
              </label>
              <input
                type="number"
                value={s2.weeklyRunMinutes}
                onChange={e => setS2(p => ({ ...p, weeklyRunMinutes: e.target.value }))}
                placeholder="e.g. 15"
                min={0}
                className={inputCls}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-secondary uppercase tracking-widest">
                Longest Continuous Run <span className="text-muted font-normal normal-case">(min without stopping)</span>
              </label>
              <input
                type="number"
                value={s2.longestRunSegmentMin}
                onChange={e => setS2(p => ({ ...p, longestRunSegmentMin: e.target.value }))}
                placeholder="e.g. 2"
                min={0}
                className={inputCls}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-secondary uppercase tracking-widest">Current Knee Pain</label>
              <div className="flex gap-2">
                {([ 
                  { value: 'none' as PainLevel, label: 'None' },
                  { value: 'sometimes' as PainLevel, label: 'Sometimes' },
                  { value: 'yes' as PainLevel, label: 'Yes' },
                ]).map(({ value, label }) => (
                  <OptionBtn
                    key={value}
                    value={value}
                    current={s2.currentPainLevel}
                    label={label}
                    onClick={v => setS2(p => ({ ...p, currentPainLevel: v }))}
                  />
                ))}
              </div>
            </div>

            {error && <p className="text-xs text-recovery-red">{error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-secondary bg-surface border border-border"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-bg font-bold text-sm disabled:opacity-40"
              >
                <CheckCircle size={16} />
                {saving ? 'Saving...' : 'Start'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Test the onboarding flow**

Navigate to `http://localhost:3030/onboarding`. Fill in Screen 1 (age + sex) → click Next → fill Screen 2 → click Start.

Expected: POST to `/api/profile` succeeds, redirects to `/`. Run:
```bash
npx prisma studio
```
Open `http://localhost:5555`, check `athlete_profile` table has one row with `currentPainLevel = "none"` and `calibration_state` has one row.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/profile/route.ts src/app/onboarding/page.tsx
git commit -m "feat: onboarding intake form + profile API (POST + PATCH)"
```

---

## Task 6: Home Screen — ReadinessBand + Updated page.tsx

**Files:**
- Create: `src/components/ReadinessBand.tsx`
- Create: `src/components/PainStatusModal.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Create `src/components/PainStatusModal.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { X } from 'lucide-react'

type PainLevel = 'none' | 'sometimes' | 'yes'

const OPTIONS: { value: PainLevel; label: string; desc: string }[] = [
  { value: 'none', label: 'None', desc: 'No knee pain or swelling' },
  { value: 'sometimes', label: 'Sometimes', desc: 'Mild pain that clears during activity' },
  { value: 'yes', label: 'Yes', desc: 'Active pain or swelling — rest day' },
]

interface Props {
  current: PainLevel
  onClose: () => void
  onSaved: () => void
}

export default function PainStatusModal({ current, onClose, onSaved }: Props) {
  const [selected, setSelected] = useState<PainLevel>(current)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPainLevel: selected }),
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-bg rounded-t-2xl p-6 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-primary">Update knee status</h2>
          <button onClick={onClose} className="p-1 rounded-lg text-muted hover:text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSelected(opt.value)}
              className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                selected === opt.value
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-surface'
              }`}
            >
              <div
                className={`w-3 h-3 mt-0.5 rounded-full border-2 shrink-0 transition-all ${
                  selected === opt.value ? 'border-primary bg-primary' : 'border-border'
                }`}
              />
              <div>
                <p className="text-sm font-semibold text-primary">{opt.label}</p>
                <p className="text-xs text-secondary">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 rounded-xl bg-primary text-bg font-bold text-sm disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Update'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/components/ReadinessBand.tsx`**

Note: Tailwind colors from `tailwind.config.ts` — band "amber" maps to `recovery-yellow` (the configured name). GREEN = `recovery-green`, AMBER = `recovery-yellow`, RED = `recovery-red`.

```tsx
'use client'
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import type { ReadinessResult } from '@/types/readiness'
import PainStatusModal from './PainStatusModal'

type BandKey = 'green' | 'amber' | 'red'

const BAND_CONFIG: Record<BandKey, { dot: string; text: string; label: string; bg: string }> = {
  green: {
    dot: 'bg-recovery-green',
    text: 'text-recovery-green',
    label: 'GREEN',
    bg: 'bg-recovery-green/10',
  },
  amber: {
    dot: 'bg-recovery-yellow',
    text: 'text-recovery-yellow',
    label: 'AMBER',
    bg: 'bg-recovery-yellow/10',
  },
  red: {
    dot: 'bg-recovery-red',
    text: 'text-recovery-red',
    label: 'RED',
    bg: 'bg-recovery-red/10',
  },
}

interface Props {
  result: ReadinessResult
  scenarioMode?: string
}

export default function ReadinessBand({ result, scenarioMode }: Props) {
  const [showPainModal, setShowPainModal] = useState(false)
  const config = BAND_CONFIG[result.band]

  const lastSynced = result.lastSyncedAt
    ? formatDistanceToNow(new Date(result.lastSyncedAt), { addSuffix: true })
    : 'never'

  const painCurrent = result.painFlagged ? 'yes' : 'none'

  return (
    <>
      {/* Main readiness card */}
      <div className={`relative rounded-2xl p-5 ${config.bg}`}>
        {scenarioMode && (
          <div className="absolute top-3 right-3">
            <span className="text-[9px] font-mono bg-border/80 text-secondary px-1.5 py-0.5 rounded">
              SCENARIO: {scenarioMode}
            </span>
          </div>
        )}

        <div className="flex items-center gap-3 mb-1">
          <div className={`w-4 h-4 rounded-full flex-shrink-0 ${config.dot}`} />
          <span className={`text-2xl font-black tracking-tight ${config.text}`}>
            {config.label}
          </span>
          {result.provisional && (
            <span className="text-[10px] text-muted border border-border px-1.5 py-0.5 rounded-full">
              provisional
            </span>
          )}
        </div>

        <p className="text-base font-semibold text-primary mb-4 ml-7">
          {result.plainText}
        </p>

        <div className="flex gap-2 ml-7">
          {result.decidingSignals.map((sig, i) => (
            <span
              key={i}
              className="text-xs font-mono text-secondary bg-bg/60 px-2.5 py-1 rounded-lg"
            >
              {sig}
            </span>
          ))}
        </div>
      </div>

      {/* Secondary stats */}
      {(result.sleepHours !== null || result.bodyBattery !== null || result.stress !== null) && (
        <div className="card flex flex-col gap-2.5">
          {result.sleepHours !== null && (
            <StatRow
              label="Sleep"
              value={`${result.sleepHours.toFixed(1)}h`}
              score={result.signals.sleepScore}
              max={100}
            />
          )}
          {result.bodyBattery !== null && (
            <StatRow
              label="Body Battery"
              value={`${Math.round(result.bodyBattery)}`}
              score={result.bodyBattery}
              max={100}
            />
          )}
          {result.stress !== null && (
            <StatRow
              label="Stress"
              value={`${Math.round(result.stress)}`}
              score={100 - result.stress}
              max={100}
            />
          )}
        </div>
      )}

      {/* Calibration warning */}
      {result.provisional && result.daysUntilCalibrated !== null && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-surface border border-recovery-yellow/30">
          <span className="text-xs text-recovery-yellow">
            Still calibrating · {result.daysUntilCalibrated} day
            {result.daysUntilCalibrated !== 1 ? 's' : ''} left · Being conservative
          </span>
        </div>
      )}

      {/* Pain chip */}
      {result.painFlagged && (
        <button
          onClick={() => setShowPainModal(true)}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-surface border border-recovery-yellow/40 w-full text-left"
        >
          <span className="text-recovery-yellow text-xs">
            Knee pain flagged · Prehab only · Tap to update
          </span>
        </button>
      )}

      {/* Last synced */}
      <p className="text-[11px] text-muted text-center">Last synced {lastSynced}</p>

      {showPainModal && (
        <PainStatusModal
          current={painCurrent as 'none' | 'sometimes' | 'yes'}
          onClose={() => setShowPainModal(false)}
          onSaved={() => {
            setShowPainModal(false)
            window.location.reload()
          }}
        />
      )}
    </>
  )
}

function StatRow({
  label, value, score, max,
}: {
  label: string
  value: string
  score: number
  max: number
}) {
  const pct = Math.min(100, Math.max(0, (score / max) * 100))
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-secondary shrink-0">{label}</span>
      <span className="font-mono text-primary w-10 shrink-0">{value}</span>
      <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className="h-full bg-primary/40 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Replace `src/app/page.tsx` with the readiness home screen**

The current `page.tsx` is 5 lines rendering `<Dashboard />`. Replace it entirely:

```tsx
import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import { prisma } from '@/lib/db'
import { computeReadiness } from '@/lib/readiness'
import { getScenario } from '@/lib/scenario'
import { syncGarmin } from '@/lib/syncGarmin'
import BottomNav from '@/components/BottomNav'
import ReadinessBand from '@/components/ReadinessBand'

export default async function HomePage() {
  // Gate: onboarding required first
  const profile = await prisma.athlete_profile.findFirst()
  if (!profile) redirect('/onboarding')

  // Scenario mode: skip DB entirely
  const scenario = getScenario()
  const scenarioMode = scenario ? (process.env.SCENARIO ?? undefined) : undefined

  // Bootstrap: first visit with empty DB → sync once
  if (!scenario) {
    const rowCount = await prisma.readiness_daily.count()
    if (rowCount === 0) {
      await syncGarmin(format(new Date(), 'yyyy-MM-dd'))
    }
  }

  const result = scenario ?? (await computeReadiness())
  const today = format(new Date(), 'EEEE, MMM d')

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 bg-bg/95 backdrop-blur border-b border-border">
        <div className="max-w-md mx-auto px-4 py-3">
          <p className="text-[11px] text-muted uppercase tracking-widest">{today}</p>
          <h1 className="text-sm font-bold text-primary">Today&#39;s Readiness</h1>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-28 pt-4 flex flex-col gap-3">
        <ReadinessBand result={result} scenarioMode={scenarioMode} />
      </main>

      <BottomNav />
    </div>
  )
}
```

- [ ] **Step 4: Test the full flow end-to-end**

1. Clear the DB (if needed): `npx prisma db push --force-reset && npx prisma generate && npx tsx src/data/seed-libraries.ts`
2. Start the dev server: `npm run dev`
3. Visit `http://localhost:3030` — should redirect to `/onboarding`
4. Complete onboarding form → submit → redirects to `/`
5. Home screen shows readiness band (AMBER provisional during calibration since 0 data days)
6. Set `SCENARIO=green_day` in `.env.local`, restart, verify GREEN band shows
7. Set `SCENARIO=pain_flagged`, verify AMBER band + pain chip + no GREEN possible
8. Tap pain chip → modal opens → select "None" → tap Update → page reloads → chip gone

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npm test
```

Expected: All existing tests pass + new readiness tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/ReadinessBand.tsx src/components/PainStatusModal.tsx src/app/page.tsx
git commit -m "feat: readiness home screen with GREEN/AMBER/RED band, pain chip, calibration status"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task covering it |
|---|---|
| GREEN/AMBER/RED band with two deciding numbers | Task 2 (computation) + Task 6 (UI) |
| HRV ratio, RHR delta, sleep score, ACWR as four signals | Task 2 — all four in `computeSignals` |
| RED as a veto (any single flag overrides) | Task 2 — `computeBand` veto check first |
| GREEN threshold: HRV≥0.95, RHR≤+3, sleep≥60, ACWR 0.8–1.3 | Task 2 — exact thresholds |
| Calibration window 21 days, baseline ready at 14 days | Task 2 — `computeReadiness`, Task 3 — `syncGarmin` updates flag |
| ACWR cap 1.3→1.1 during calibration window | Task 2 — `acwrCap` parameter to `computeBand` |
| Pain cap: active pain → AMBER max | Task 2 — `computeBand(signals, painFlagged=true)` always ≥ amber |
| Tappable pain chip | Task 6 — `PainStatusModal` + PATCH `/api/profile` |
| Scenario mode via `SCENARIO` env var | Task 1 — `scenario.ts` |
| Scenario chip in corner | Task 6 — `ReadinessBand` scenarioMode prop |
| Cold-start bootstrap | Task 4 — `/api/readiness`, Task 6 — `page.tsx` |
| cron-job.org sync target | Task 3 — `/api/sync` route with `CRON_SECRET` auth |
| Sync: upsert readiness_daily + activities | Task 3 — `syncGarmin.ts` |
| Last synced timestamp | Task 6 — `formatDistanceToNow` in `ReadinessBand` |
| Onboarding: age, sex, surgical leg, surgery date, weekly run, longest run, pain | Task 5 — two-screen form |
| calibration_state initialized at onboarding | Task 5 — `/api/profile POST` |
| Secondary stats: sleep, body battery, stress | Task 6 — `StatRow` components |
| Provisional label during calibration window | Task 6 — `ReadinessBand` provisional chip |

### Type consistency check

- `ReadinessBand = 'green' | 'amber' | 'red'` — defined in Task 1, used consistently in Tasks 2 and 6
- `computeBand(signals, painFlagged, acwrCap?)` — signature in Task 2 matches test calls in Task 2
- `getDecidingSignals(signals, band, painFlagged)` — matches test assertions
- `ReadinessResult.decidingSignals: [string, string]` — tuple, matches `getDecidingSignals` return type
- `DailyRow` and `ActivityRow` exported from `readiness.ts` — imported in test file
- `syncGarmin(dateStr)` returns `SyncResult` — imported in Tasks 4 and 6
- `/api/profile PATCH` body: `{ currentPainLevel: string }` — matches `PainStatusModal` fetch call
- `BAND_CONFIG` in `ReadinessBand.tsx` — has keys `'green' | 'amber' | 'red'`, matching `ReadinessBand` type

### Placeholder scan

No TBD, TODO, or missing code blocks present. All steps include complete code.

---

## Deployment Notes (post-implementation)

After Phase 1 is complete locally:

1. **Set env vars in Vercel dashboard:** `CRON_SECRET`, `GARMIN_USERNAME`, `GARMIN_PASSWORD` (or `GARMIN_OAUTH1`/`GARMIN_OAUTH2`)
2. **Create 3 cron jobs at cron-job.org** pointing to:
   - `https://your-app.vercel.app/api/sync?secret=YOUR_CRON_SECRET`
   - Schedule: 06:00 UTC, 12:00 UTC, 21:00 UTC
3. **SQLite on Vercel:** Vercel's ephemeral filesystem means the SQLite DB resets on cold starts. For production persistence: migrate to Turso (libsql) or use a persistent volume. For local dev and testing, `prisma/dev.db` is fine.
