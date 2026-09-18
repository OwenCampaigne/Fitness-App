import { format, subDays } from 'date-fns';
import type { DailyMetrics } from './types';
import { SPLITS_SCHEMA_VERSION, type ActivitySplits, type RunSplit } from './splits';

const today = new Date();

// ── Mock splits (framework §16) ───────────────────────────────────────────────
// Every feature works in mock mode first, and decoupling is the one that most
// needs it: real per-split data arrives only from a watch, bad long runs are
// rare, and waiting for one to appear is not a test strategy. These generators
// produce laps whose shape matches what `parseGarminSplits` emits, so the mock
// path runs through the same parser, the same gate and the same maths as live.

export interface MockSplitsSpec {
  /** Number of full kilometre laps. */
  km: number
  /** Seconds per kilometre at the start of the run. */
  startPaceSecPerKm: number
  /** Seconds per kilometre at the end — equal to the start means a held pace. */
  endPaceSecPerKm: number
  startHr: number
  endHr: number
  /** Add the ragged closing lap Garmin always records. */
  tailKm?: number
  startTime?: Date
}

/**
 * Build a lap list that drifts linearly from start to end.
 *
 * Linear rather than random on purpose: a mock whose verdict changes between
 * runs is useless for demonstrating a band, and the gate is deterministic.
 */
export function buildMockSplits(spec: MockSplitsSpec, activityId = 'mock-run'): ActivitySplits {
  const start = spec.startTime ?? new Date(today.getTime() - 3600_000);
  let clock = 0;
  const lerp = (a: number, b: number, i: number, n: number) =>
    n <= 1 ? a : a + ((b - a) * i) / (n - 1);

  const splits: RunSplit[] = Array.from({ length: spec.km }, (_, i) => {
    const durationSec = Math.round(lerp(spec.startPaceSecPerKm, spec.endPaceSecPerKm, i, spec.km));
    const startTimeGmt = new Date(start.getTime() + clock * 1000).toISOString();
    clock += durationSec;
    const hr = Math.round(lerp(spec.startHr, spec.endHr, i, spec.km));
    return {
      index: i + 1,
      distanceKm: 1,
      durationSec,
      avgHr: hr,
      maxHr: hr + 7,
      paceSecPerKm: durationSec,
      elevationGainM: 4,
      elevationLossM: 3,
      avgCadenceSpm: 168,
      startTimeGmt,
    };
  });

  if (spec.tailKm && spec.tailKm > 0) {
    const durationSec = Math.round(spec.endPaceSecPerKm * spec.tailKm);
    splits.push({
      index: splits.length + 1,
      distanceKm: spec.tailKm,
      durationSec,
      avgHr: spec.endHr,
      maxHr: spec.endHr + 7,
      paceSecPerKm: spec.endPaceSecPerKm,
      elevationGainM: 1,
      elevationLossM: 1,
      avgCadenceSpm: 170,
      startTimeGmt: new Date(start.getTime() + clock * 1000).toISOString(),
    });
  }

  return {
    version: SPLITS_SCHEMA_VERSION,
    source: 'mock',
    activityId,
    fetchedAt: today.toISOString(),
    splits,
  };
}

/**
 * The default mock long run: 10 km held at 5:48/km with heart rate drifting
 * 142 → 151. Lands at roughly 3% decoupling — a base that holds, which is the
 * state the app should look right in before it is asked to look right in the
 * broken one.
 */
export const mockRunSplits: ActivitySplits = buildMockSplits(
  { km: 10, startPaceSecPerKm: 348, endPaceSecPerKm: 348, startHr: 142, endHr: 151, tailKm: 0.27 },
  'mock-long-run',
);

/** A walk/run session: the shape the steady-state gate must refuse. */
export const mockWalkRunSplits: ActivitySplits = {
  version: SPLITS_SCHEMA_VERSION,
  source: 'mock',
  activityId: 'mock-walk-run',
  fetchedAt: today.toISOString(),
  splits: Array.from({ length: 12 }, (_, i): RunSplit => {
    const running = i % 2 === 0;
    const durationSec = running ? 360 : 180;
    const distanceKm = running ? 1 : 0.25;
    const hr = running ? 148 : 116;
    return {
      index: i + 1,
      distanceKm,
      durationSec,
      avgHr: hr,
      maxHr: hr + 10,
      paceSecPerKm: Math.round(durationSec / distanceKm),
      elevationGainM: 2,
      elevationLossM: 2,
      avgCadenceSpm: running ? 166 : 120,
      startTimeGmt: null,
    };
  }),
};

export const mockData: DailyMetrics = {
  date: format(today, 'yyyy-MM-dd'),
  isDemo: true,
  recovery: {
    score: 73,
    category: 'green',
    hrv: 52,
    restingHR: 58,
    sleepScore: 78,
  },
  sleep: {
    totalSleepSeconds: 26100,  // 7h 15m
    deepSleepSeconds: 5220,    // 1h 27m (20%)
    remSleepSeconds: 6900,     // 1h 55m (26%)
    lightSleepSeconds: 12180,  // 3h 23m
    awakeSleepSeconds: 1800,   // 30m
    sleepScore: 78,
    averageSpO2: 96.2,
    averageHRV: 48,
    averageRespiration: 14.1,
    startTime: new Date(today.getTime() - 8.5 * 3600000).toISOString(),
    endTime: new Date(today.getTime() - 0.5 * 3600000).toISOString(),
  },
  hrv: {
    weeklyAverage: 50,
    lastNight: 52,
    status: 'balanced',
    trend: [45, 48, 44, 51, 49, 53, 52],
  },
  bodyBattery: {
    isAvailable: true,
    current: 68,
    charged: 82,
    drained: 14,
    data: [
      { time: '00:00', value: 42 },
      { time: '01:00', value: 52 },
      { time: '02:00', value: 62 },
      { time: '03:00', value: 70 },
      { time: '04:00', value: 77 },
      { time: '05:00', value: 82 },
      { time: '06:00', value: 82 },
      { time: '07:00', value: 80 },
      { time: '08:00', value: 74 },
      { time: '09:00', value: 68 },
      { time: '10:00', value: 72 },
      { time: '11:00', value: 65 },
      { time: '12:00', value: 60 },
      { time: '13:00', value: 65 },
      { time: '14:00', value: 58 },
      { time: '15:00', value: 52 },
      { time: '16:00', value: 55 },
      { time: '17:00', value: 62 },
      { time: '18:00', value: 68 },
      { time: '19:00', value: 68 },
    ],
  },
  stress: {
    average: 28,
    data: [
      { time: '06:00', value: 12 },
      { time: '07:00', value: 20 },
      { time: '08:00', value: 42 },
      { time: '09:00', value: 55 },
      { time: '10:00', value: 38 },
      { time: '11:00', value: 45 },
      { time: '12:00', value: 22 },
      { time: '13:00', value: 18 },
      { time: '14:00', value: 35 },
      { time: '15:00', value: 48 },
      { time: '16:00', value: 30 },
      { time: '17:00', value: 25 },
      { time: '18:00', value: 20 },
      { time: '19:00', value: 15 },
    ],
    highStressPercentage: 18,
    restingPercentage: 42,
  },
  activities: [
    {
      name: 'Morning Run',
      duration: 3480,
      calories: 512,
      strain: 13.8,
      averageHR: 151,
      maxHR: 176,
      type: 'running',
      distanceM: 10270,
      cadenceSpm: 168,
      elevationGainM: 43,
      splits: mockRunSplits,
    },
  ],
  steps: 8432,
  calories: 2387,
  floorsAscended: 8,
  highlyActiveSeconds: 4200,   // ~70 min vigorous (includes 58-min run + extra)
  activeSeconds: 2400,          // ~40 min moderate (brisk walking, etc.)
  strain: 16.4,  // 13.8 TRIMP (run) + 1.9 NEAT (60+40 active min) + 0.7 battery drain (14pt)
  weeklyTrend: {
    dates: Array.from({ length: 7 }, (_, i) => format(subDays(today, 6 - i), 'EEE')),
    recovery: [65, 45, 72, 81, 58, 69, 73],
    hrv: [48, 42, 51, 55, 47, 50, 52],
    sleep: [75, 68, 82, 79, 65, 72, 78],
    sleepHours: [6.8, 6.2, 7.5, 7.8, 5.9, 7.0, 7.25],
    rhr: [60, 62, 58, 57, 61, 59, 58],
    strain: [8.2, 12.5, 6.1, 15.3, 9.8, 7.2, 13.8],
  },
};
