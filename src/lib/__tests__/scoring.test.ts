import {
  calculateSleepScore,
  calculateRecoveryScore,
  calculateStrainScore,
  calculateDailyStrain,
  getRecoveryCategory,
  getHRVStatus,
  formatDuration,
  calculateVO2max,
  calculateTrainingZones,
  calculateMedian,
  calculateSleepDebt,
  calculateSleepEfficiency,
} from '../scoring';
import type { SleepData, ActivityData } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSleep(overrides: Partial<SleepData> = {}): SleepData {
  return {
    totalSleepSeconds: 7 * 3600,       // 7h
    deepSleepSeconds:  1.4 * 3600,     // 20% deep
    remSleepSeconds:   1.75 * 3600,    // 25% REM
    lightSleepSeconds: 3.85 * 3600,
    awakeSleepSeconds: 0.5 * 3600,
    sleepScore: 0,
    averageSpO2: 97,
    averageHRV: 45,
    averageRespiration: 14,
    startTime: '',
    endTime: '',
    ...overrides,
  };
}

function makeActivity(overrides: Partial<ActivityData> = {}): ActivityData {
  return {
    name: 'Run',
    duration: 3600,    // 60 min
    calories: 500,
    strain: 8,
    averageHR: 150,
    maxHR: 185,
    type: 'running',
    ...overrides,
  };
}

// ── calculateSleepScore ───────────────────────────────────────────────────────

describe('calculateSleepScore', () => {
  test('returns 50 when totalSleepSeconds is 0', () => {
    expect(calculateSleepScore(makeSleep({ totalSleepSeconds: 0 }))).toBe(50);
  });

  test('scores optimal sleep (7-9h, good deep+REM) near 100', () => {
    const score = calculateSleepScore(makeSleep());
    expect(score).toBeGreaterThanOrEqual(90);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('scores 8h sleep at 100 with ideal stage ratios', () => {
    const score = calculateSleepScore(makeSleep({
      totalSleepSeconds: 8 * 3600,
      deepSleepSeconds:  1.6 * 3600,  // 20%
      remSleepSeconds:   2.0 * 3600,  // 25%
      lightSleepSeconds: 4.4 * 3600,
    }));
    expect(score).toBe(100);
  });

  test('penalises short sleep (5h)', () => {
    const score = calculateSleepScore(makeSleep({
      totalSleepSeconds: 5 * 3600,
      deepSleepSeconds:  1 * 3600,
      remSleepSeconds:   1.25 * 3600,
      lightSleepSeconds: 2.75 * 3600,
    }));
    expect(score).toBeLessThanOrEqual(70);
  });

  test('penalises very short sleep (<5h)', () => {
    const score = calculateSleepScore(makeSleep({
      totalSleepSeconds: 4 * 3600,
      deepSleepSeconds:  0.5 * 3600,
      remSleepSeconds:   0.5 * 3600,
      lightSleepSeconds: 3 * 3600,
    }));
    expect(score).toBeLessThan(50);
  });

  test('score is always between 0 and 100', () => {
    const extremes = [0, 2, 5, 7, 8, 12].map(h =>
      calculateSleepScore(makeSleep({
        totalSleepSeconds: h * 3600,
        deepSleepSeconds:  h * 0.2 * 3600,
        remSleepSeconds:   h * 0.25 * 3600,
        lightSleepSeconds: h * 0.55 * 3600,
      }))
    );
    extremes.forEach(s => {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    });
  });
});

// ── calculateRecoveryScore ────────────────────────────────────────────────────

describe('calculateRecoveryScore', () => {
  const base = { lastNightHRV: 50, baselineHRV: 50, restingHR: 55, baselineRHR: 60, sleepScore: 80 };

  test('returns sleepScore when baseline is 0 (no history)', () => {
    expect(calculateRecoveryScore({ ...base, baselineHRV: 0, baselineRHR: 0 })).toBe(80);
  });

  test('high HRV vs baseline → high recovery', () => {
    const score = calculateRecoveryScore({ ...base, lastNightHRV: 65, baselineHRV: 50 });
    expect(score).toBeGreaterThan(75);
  });

  test('low HRV vs baseline → low recovery', () => {
    const score = calculateRecoveryScore({ ...base, lastNightHRV: 30, baselineHRV: 50 });
    expect(score).toBeLessThan(60);
  });

  test('resting HR below baseline improves score', () => {
    const good = calculateRecoveryScore({ ...base, restingHR: 50, baselineRHR: 60 });
    const bad  = calculateRecoveryScore({ ...base, restingHR: 70, baselineRHR: 60 });
    expect(good).toBeGreaterThan(bad);
  });

  test('score is always between 0 and 100', () => {
    const extremes = [
      { lastNightHRV: 0,   baselineHRV: 50, restingHR: 100, baselineRHR: 60, sleepScore: 0 },
      { lastNightHRV: 100, baselineHRV: 50, restingHR: 20,  baselineRHR: 60, sleepScore: 100 },
    ];
    extremes.forEach(p => {
      const s = calculateRecoveryScore(p);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    });
  });
});

// ── calculateStrainScore ──────────────────────────────────────────────────────

describe('calculateStrainScore', () => {
  test('returns 0 for empty activity list', () => {
    expect(calculateStrainScore([], 60, 35)).toBe(0);
  });

  test('moderate 60-min run produces mid-range strain', () => {
    const strain = calculateStrainScore([makeActivity()], 60, 35);
    expect(strain).toBeGreaterThan(3);
    expect(strain).toBeLessThan(15);
  });

  test('activity without HR data gets estimated strain', () => {
    const strain = calculateStrainScore([makeActivity({ averageHR: 0, maxHR: 0 })], 60, 35);
    expect(strain).toBeGreaterThan(0);
  });

  test('never exceeds 21', () => {
    const extremeActivities = Array(10).fill(makeActivity({ duration: 7200, averageHR: 185, maxHR: 200 }));
    expect(calculateStrainScore(extremeActivities, 40, 25)).toBeLessThanOrEqual(21);
  });

  test('higher intensity → higher strain', () => {
    const low  = calculateStrainScore([makeActivity({ averageHR: 120, maxHR: 185 })], 60, 35);
    const high = calculateStrainScore([makeActivity({ averageHR: 175, maxHR: 185 })], 60, 35);
    expect(high).toBeGreaterThan(low);
  });
});

// ── calculateDailyStrain ──────────────────────────────────────────────────────

describe('calculateDailyStrain', () => {
  test('sedentary day with no activities is low', () => {
    const s = calculateDailyStrain([], 4000, 1800, {});
    expect(s).toBeLessThan(4);
  });

  test('adds stress bonus above threshold (>50)', () => {
    const noStress   = calculateDailyStrain([], 8000, 2200, { stressAverage: 30 });
    const highStress = calculateDailyStrain([], 8000, 2200, { stressAverage: 80 });
    expect(highStress).toBeGreaterThan(noStress);
  });

  test('body battery drain contributes to strain', () => {
    const noDrain   = calculateDailyStrain([], 8000, 2200, { bodyBatteryDrained: 0 });
    const highDrain = calculateDailyStrain([], 8000, 2200, { bodyBatteryDrained: 50 });
    expect(highDrain).toBeGreaterThan(noDrain);
  });

  test('never exceeds 21', () => {
    const s = calculateDailyStrain(
      Array(5).fill(makeActivity({ duration: 7200, averageHR: 185, maxHR: 200, strain: 18 })),
      20000, 4000,
      { highlyActiveSeconds: 7200, stressAverage: 90, bodyBatteryDrained: 80 },
    );
    expect(s).toBeLessThanOrEqual(21);
  });
});

// ── getRecoveryCategory ───────────────────────────────────────────────────────

describe('getRecoveryCategory', () => {
  test('≥67 → green', () => expect(getRecoveryCategory(67)).toBe('green'));
  test('66 → yellow',  () => expect(getRecoveryCategory(66)).toBe('yellow'));
  test('34 → yellow',  () => expect(getRecoveryCategory(34)).toBe('yellow'));
  test('33 → red',     () => expect(getRecoveryCategory(33)).toBe('red'));
  test('0 → red',      () => expect(getRecoveryCategory(0)).toBe('red'));
  test('100 → green',  () => expect(getRecoveryCategory(100)).toBe('green'));
});

// ── getHRVStatus ──────────────────────────────────────────────────────────────

describe('getHRVStatus', () => {
  test('HRV at baseline → balanced',      () => expect(getHRVStatus(50, 50)).toBe('balanced'));
  test('HRV 5% below baseline → balanced',() => expect(getHRVStatus(48, 50)).toBe('balanced'));
  test('HRV 15% below baseline → unbalanced', () => expect(getHRVStatus(43, 50)).toBe('unbalanced'));
  test('HRV 25% below baseline → poor',   () => expect(getHRVStatus(37, 50)).toBe('poor'));
  test('HRV above baseline → balanced',   () => expect(getHRVStatus(60, 50)).toBe('balanced'));
  test('baseline 0 does not throw',       () => expect(() => getHRVStatus(40, 0)).not.toThrow());
});

// ── formatDuration ────────────────────────────────────────────────────────────

describe('formatDuration', () => {
  test('0s → 0m',           () => expect(formatDuration(0)).toBe('0m'));
  test('30min → 30m',       () => expect(formatDuration(1800)).toBe('30m'));
  test('60min → 1h',        () => expect(formatDuration(3600)).toBe('1h'));
  test('90min → 1h 30m',    () => expect(formatDuration(5400)).toBe('1h 30m'));
  test('2h exactly → 2h',   () => expect(formatDuration(7200)).toBe('2h'));
});

// ── calculateVO2max ───────────────────────────────────────────────────────────

describe('calculateVO2max', () => {
  test('returns 0 when restingHR is 0',  () => expect(calculateVO2max(0, 35)).toBe(0));
  test('returns 0 when restingHR < 20',  () => expect(calculateVO2max(15, 35)).toBe(0));
  test('uses Tanaka maxHR when none observed', () => {
    // age=35 → maxHR = 208 - 0.7*35 = 183.5 ≈ 184; VO2max = 15.3*(184/60) ≈ 47
    const vo2 = calculateVO2max(60, 35);
    expect(vo2).toBeCloseTo(47, 0);
  });
  test('uses observedMaxHR when provided and >100', () => {
    const with_obs    = calculateVO2max(60, 35, 190);
    const without_obs = calculateVO2max(60, 35);
    expect(with_obs).toBeGreaterThan(without_obs);
  });
  test('lower resting HR → higher VO2max', () => {
    expect(calculateVO2max(45, 35)).toBeGreaterThan(calculateVO2max(70, 35));
  });
});

// ── calculateTrainingZones ────────────────────────────────────────────────────

describe('calculateTrainingZones', () => {
  test('returns 5 zones', () => {
    expect(calculateTrainingZones(60, 35)).toHaveLength(5);
  });

  test('zones are ordered lowest to highest HR', () => {
    const zones = calculateTrainingZones(60, 35);
    for (let i = 1; i < zones.length; i++) {
      expect(zones[i].hrLow).toBeGreaterThan(zones[i - 1].hrLow);
    }
  });

  test('zone 1 lower bound > resting HR', () => {
    const zones = calculateTrainingZones(55, 40);
    expect(zones[0].hrLow).toBeGreaterThan(55);
  });

  test('zone 5 upper bound ≈ maxHR', () => {
    const zones = calculateTrainingZones(60, 35, 185);
    expect(zones[4].hrHigh).toBe(185);
  });

  test('observed maxHR overrides Tanaka estimate', () => {
    const withObs    = calculateTrainingZones(60, 35, 195);
    const withTanaka = calculateTrainingZones(60, 35);
    expect(withObs[4].hrHigh).toBeGreaterThan(withTanaka[4].hrHigh);
  });
});

// ── calculateMedian ───────────────────────────────────────────────────────────

describe('calculateMedian', () => {
  test('empty array → 0',             () => expect(calculateMedian([])).toBe(0));
  test('filters out zeros',           () => expect(calculateMedian([0, 0, 50])).toBe(50));
  test('odd count → middle element',  () => expect(calculateMedian([10, 30, 50])).toBe(30));
  test('even count → avg of two mid', () => expect(calculateMedian([10, 20, 30, 40])).toBe(25));
  test('single element',              () => expect(calculateMedian([42])).toBe(42));
});

// ── calculateSleepDebt ────────────────────────────────────────────────────────

describe('calculateSleepDebt', () => {
  test('no sleep hours → 0', () => expect(calculateSleepDebt([])).toBe(0));
  test('filters zeros',      () => expect(calculateSleepDebt([0, 0, 8])).toBe(0));
  test('7h/night vs 8h target → 1h debt', () => expect(calculateSleepDebt([7, 7, 7], 8)).toBe(3));
  test('9h/night → surplus (negative)',    () => expect(calculateSleepDebt([9, 9], 8)).toBe(-2));
  test('exact target → 0 debt',           () => expect(calculateSleepDebt([8, 8, 8], 8)).toBe(0));
});

// ── calculateSleepEfficiency ──────────────────────────────────────────────────

describe('calculateSleepEfficiency', () => {
  test('returns 0 when no time in bed', () => {
    expect(calculateSleepEfficiency(makeSleep({ totalSleepSeconds: 0, awakeSleepSeconds: 0 }))).toBe(0);
  });
  test('100% efficiency when awake time is 0', () => {
    expect(calculateSleepEfficiency(makeSleep({ awakeSleepSeconds: 0 }))).toBe(100);
  });
  test('calculates correctly with awake time', () => {
    // 7h sleep, 1h awake → 87.5%
    const eff = calculateSleepEfficiency(makeSleep({
      totalSleepSeconds: 7 * 3600,
      awakeSleepSeconds: 1 * 3600,
    }));
    expect(eff).toBe(88); // rounded
  });
});
