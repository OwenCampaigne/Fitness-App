import type { SleepData, ActivityData } from './types';

export function calculateSleepScore(sleep: SleepData): number {
  if (!sleep.totalSleepSeconds) return 50;

  const totalHours = sleep.totalSleepSeconds / 3600;
  const deepPct = sleep.deepSleepSeconds / sleep.totalSleepSeconds;
  const remPct = sleep.remSleepSeconds / sleep.totalSleepSeconds;

  // Duration score (60%) — optimal: 7–9h
  let durationScore: number;
  if (totalHours >= 7 && totalHours <= 9) durationScore = 100;
  else if (totalHours >= 6.5) durationScore = 85;
  else if (totalHours >= 6) durationScore = 70;
  else if (totalHours >= 5) durationScore = 50;
  else durationScore = 25;

  // Quality score (40%) — targets: deep=20%, REM=25%
  const deepScore = Math.min(100, (deepPct / 0.2) * 100);
  const remScore = Math.min(100, (remPct / 0.25) * 100);
  const qualityScore = deepScore * 0.5 + remScore * 0.5;

  return Math.round(Math.max(0, Math.min(100, durationScore * 0.6 + qualityScore * 0.4)));
}

export function calculateRecoveryScore(params: {
  lastNightHRV: number;
  baselineHRV: number;
  restingHR: number;
  baselineRHR: number;
  sleepScore: number;
}): number {
  const { lastNightHRV, baselineHRV, restingHR, baselineRHR, sleepScore } = params;

  if (!baselineHRV || !baselineRHR) return Math.round(sleepScore);

  // HRV component (40%): ratio vs 7-day baseline
  const hrvRatio = lastNightHRV / baselineHRV;
  const hrvScore = Math.min(100, Math.max(0, 50 + (hrvRatio - 1) * 200));

  // RHR component (30%): percentage deviation from baseline (lower = better)
  const rhrDevPct = ((baselineRHR - restingHR) / baselineRHR) * 100;
  const rhrScore = Math.min(100, Math.max(0, 50 + rhrDevPct * 3));

  return Math.round(
    Math.max(0, Math.min(100, hrvScore * 0.4 + rhrScore * 0.3 + sleepScore * 0.3))
  );
}

/**
 * Per-activity strain using Bannister TRIMP (Training Impulse, 1991).
 * Gold standard in sports science — used by Whoop, Garmin Training Load, etc.
 *
 * TRIMP = duration_min × HRreserve × e^(1.92 × HRreserve)
 * HRreserve = (avgHR − restingHR) / (maxHR − restingHR)
 *
 * The exponential weighting captures that high-intensity zones are
 * disproportionately harder (lactate accumulation, muscle damage, cortisol).
 *
 * Scale: 280 TRIMP ≈ 21 strain (elite marathon effort).
 */
export function calculateStrainScore(
  activities: ActivityData[],
  restingHR = 60,
  userAge = 35,
): number {
  if (!activities.length) return 0;

  // Tanaka formula for estimated max HR (more accurate than 220-age)
  const estMaxHR = 208 - 0.7 * userAge;

  const totalTRIMP = activities.reduce((sum, a) => {
    const durationMin = a.duration / 60;
    if (durationMin <= 0) return sum;

    if (a.averageHR <= 0) {
      // No HR data: assume moderate intensity (HRR ≈ 0.5)
      return sum + durationMin * 0.5 * Math.exp(1.92 * 0.5);
    }

    // Use observed maxHR (actual device data beats age estimate)
    const effectiveMaxHR = a.maxHR > 0 ? a.maxHR : estMaxHR;
    const hrReserve = Math.max(0, Math.min(1,
      (a.averageHR - restingHR) / (effectiveMaxHR - restingHR),
    ));
    return sum + durationMin * hrReserve * Math.exp(1.92 * hrReserve);
  }, 0);

  // Divide by 15 → 280 TRIMP ≈ 18.7, epic 3h effort hits cap of 21
  return Math.round(Math.min(21, totalTRIMP / 15) * 10) / 10;
}

/**
 * Daily strain = activity TRIMP + enriched background (NEAT) + physiological signals.
 *
 * Scientific basis:
 *  - TRIMP per activity (Bannister 1991) — unchanged, gold standard
 *  - NEAT via Garmin intensity-minutes (WHO METs classification):
 *      vigorous ≥ 6 METs (highlyActiveSeconds), moderate 3–6 METs (activeSeconds)
 *  - Body Battery drain: Garmin's HRV/HR/SpO2/accelerometry-derived load index —
 *      the most direct "physiological cost" signal available without lab data;
 *      captures load that TRIMP misses (heat, illness, travel, prolonged standing)
 *  - Active calories above BMR: energy expenditure from movement, not metabolism
 *  - Steps: NEAT proxy when Garmin intensity-minutes unavailable
 *  - Floors: stair-climbing METs ≈ 8–9, poorly captured by steps alone
 *  - Stress: Garmin HRV-derived sympathetic load, not just subjective mood
 *
 * Key improvements vs prior version:
 *  1. bodyBatteryDrained integrated as a direct strain signal (new)
 *  2. Steps + active-calories combined additively instead of max() in fallback path
 *  3. Step weight raised: 10k steps → 3.0 strain (was 2.0)
 *  4. BMR baseline lowered to 1500 kcal (closer to average sedentary adult BMR)
 *  5. Stress threshold lowered to 50 (Garmin's official "high stress" cutoff, was 60)
 *  6. Overlap correction softened to max 65% (was 80%) so active workout days
 *     still get fair NEAT credit for movement beyond the exercise session itself
 *
 * Calibration targets (Whoop-compatible 0–21 scale):
 *  Sedentary day  (<5k steps, no workout)          →  1–3
 *  Light active   (5–8k steps, no workout)          →  3–6
 *  Moderate day   (30 min workout + 8k steps)       →  7–11
 *  Hard day       (60 min workout + active NEAT)    → 12–17
 *  Elite / race   (2h+ hard training, double day)   → 18–21
 */
export function calculateDailyStrain(
  activities: ActivityData[],
  steps: number,
  totalCalories: number,
  opts: {
    highlyActiveSeconds?: number;
    activeSeconds?: number;
    floorsAscended?: number;
    stressAverage?: number;
    bodyBatteryDrained?: number; // Garmin HRV-derived physiological load index
  } = {},
): number {
  const {
    highlyActiveSeconds = 0,
    activeSeconds       = 0,
    floorsAscended      = 0,
    stressAverage       = 0,
    bodyBatteryDrained  = 0,
  } = opts;

  // 1. Activity strain (TRIMP pre-computed per activity in garmin.ts)
  const actStrain = activities.reduce((s, a) => s + a.strain, 0);

  // 2. Background NEAT — prefer Garmin's intensity-split minutes when available
  let background: number;
  if (highlyActiveSeconds > 0 || activeSeconds > 0) {
    const highlyActiveMin = highlyActiveSeconds / 60;
    const activeMin       = activeSeconds / 60;
    // Vigorous (≥6 METs) weighted ~3.3× vs moderate (3–6 METs)
    // 60 min vigorous = 3.6 strain | 60 min moderate = 1.1 strain; cap at 6
    background = Math.min(6, highlyActiveMin * 0.06 + activeMin * 0.018);
  } else {
    // Fallback: steps + active-calorie signal, combined additively (not max)
    // 10k steps ≈ 8 km walking ≈ 400–500 kcal → 3.0 strain
    const stepStrain = Math.min(3.5, (steps / 10_000) * 3.0);
    // Calories above BMR (1500 kcal ≈ sedentary adult baseline)
    const activeCals = Math.max(0, totalCalories - 1_500);
    const calStrain  = Math.min(3.0, (activeCals / 600) * 2.0);
    // Weighted sum — steps anchor NEAT load; calories complement without full double-count
    background = Math.min(6, stepStrain * 0.7 + calStrain * 0.5);
  }

  // 3. Floors: stair climbing ~8–9 METs — vigorous but not well reflected in steps
  const floorBonus = Math.min(1.5, floorsAscended * 0.05);

  // 4. Body Battery drain — Garmin's patent-backed HRV + HR + SpO2 index
  //    Drain of 40 pts = significant systemic load; contributes up to 2.0 strain points.
  //    This is the only signal that captures non-exercise physiological cost (stress,
  //    heat, illness, travel fatigue) that pure activity metrics cannot detect.
  const batteryDrainBonus = bodyBatteryDrained > 0
    ? Math.min(2.0, (bodyBatteryDrained / 40) * 2.0)
    : 0;

  // 5. Physiological stress (Garmin HRV-derived sympathetic nervous system load)
  //    Threshold: 50 = Garmin's "high stress" cutoff (lowered from 60)
  //    Sustained high stress elevates cortisol and adds real recovery cost even at rest.
  const stressBonus = stressAverage > 50
    ? Math.min(1.5, ((stressAverage - 50) / 50) * 1.5)
    : 0;

  // 6. Overlap correction: workout time is already partly counted in highlyActiveSeconds
  //    and step totals. Gentler curve (max 65%, was 80%) preserves NEAT credit for
  //    the movement that genuinely occurred beyond the registered exercise session.
  const overlapFactor      = Math.min(0.65, actStrain / 21);
  const adjustedBackground = (background + floorBonus) * (1 - overlapFactor);

  return Math.round(
    Math.min(21, actStrain + adjustedBackground + batteryDrainBonus + stressBonus) * 10
  ) / 10;
}

export function getRecoveryCategory(score: number): 'green' | 'yellow' | 'red' {
  if (score >= 67) return 'green';
  if (score >= 34) return 'yellow';
  return 'red';
}

export function getCategoryColor(score: number): string {
  if (score >= 67) return '#4ade80';
  if (score >= 34) return '#facc15';
  return '#f87171';
}

export function getStrainColor(strain: number): string {
  if (strain <= 8) return '#38bdf8';
  if (strain <= 14) return '#fb923c';
  return '#f87171';
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function getHRVStatus(hrv: number, baseline: number): 'balanced' | 'unbalanced' | 'poor' {
  const ratio = hrv / Math.max(baseline, 1);
  if (ratio >= 0.95) return 'balanced';
  if (ratio >= 0.8) return 'unbalanced';
  return 'poor';
}

/** Sleep efficiency: % of time in bed actually spent asleep. */
export function calculateSleepEfficiency(sleep: SleepData): number {
  const inBed = sleep.totalSleepSeconds + sleep.awakeSleepSeconds;
  if (!inBed) return 0;
  return Math.round((sleep.totalSleepSeconds / inBed) * 100);
}

// ─── VO2max ────────────────────────────────────────────────────────────────────

/**
 * VO2max estimation using the Uth-Sørensen-Overgaard-Pedersen formula (2004).
 * VO2max ≈ 15.3 × (HRmax / HRrest)
 *
 * HRmax defaults to Tanaka (208 − 0.7 × age) if not observed.
 * Validated within ~10% of lab values when resting HR is measured accurately.
 */
export function calculateVO2max(
  restingHR: number,
  age: number,
  observedMaxHR?: number,
): number {
  if (!restingHR || restingHR < 20) return 0;
  const maxHR = observedMaxHR && observedMaxHR > 100
    ? observedMaxHR
    : Math.round(208 - 0.7 * age);
  return Math.round(15.3 * (maxHR / restingHR));
}

export type VO2maxCategory = 'superior' | 'excelente' | 'bueno' | 'promedio' | 'bajo';

interface VO2maxNorm { label: VO2maxCategory; minVO2: number; color: string }

/**
 * ACSM normative VO2max values (mL/kg/min) by age + sex.
 * Source: ACSM's Guidelines for Exercise Testing and Prescription, 10th ed.
 */
export function getVO2maxCategory(
  vo2max: number,
  age: number,
  sex: 'male' | 'female',
): VO2maxNorm {
  // [ageMin, ageMax, superior, excelente, bueno, promedio]
  const maleNorms: Array<[number, number, number, number, number, number]> = [
    [20, 29, 55, 46, 38, 30],
    [30, 39, 52, 43, 36, 28],
    [40, 49, 49, 40, 33, 25],
    [50, 59, 45, 36, 29, 22],
    [60, 99, 40, 32, 26, 19],
  ];
  const femaleNorms: Array<[number, number, number, number, number, number]> = [
    [20, 29, 49, 43, 36, 27],
    [30, 39, 47, 41, 34, 25],
    [40, 49, 44, 38, 31, 23],
    [50, 59, 42, 35, 28, 21],
    [60, 99, 37, 31, 24, 18],
  ];
  const norms = sex === 'male' ? maleNorms : femaleNorms;
  const row = norms.find(([lo, hi]) => age >= lo && age <= hi) ?? norms[norms.length - 1];
  const [, , sup, exc, good, avg] = row;
  if (vo2max >= sup)  return { label: 'superior',   minVO2: sup,  color: '#4ade80' };
  if (vo2max >= exc)  return { label: 'excelente',  minVO2: exc,  color: '#86efac' };
  if (vo2max >= good) return { label: 'bueno',      minVO2: good, color: '#facc15' };
  if (vo2max >= avg)  return { label: 'promedio',   minVO2: avg,  color: '#fb923c' };
  return                     { label: 'bajo',       minVO2: 0,    color: '#f87171' };
}

// ─── Training Zones ────────────────────────────────────────────────────────────

export interface TrainingZone {
  zone: number;
  name: string;
  description: string;
  color: string;
  hrLow: number;   // bpm lower bound
  hrHigh: number;  // bpm upper bound
  pctLow: number;  // % HRR lower bound
  pctHigh: number; // % HRR upper bound
}

/**
 * Karvonen (Heart Rate Reserve) 5-zone model.
 * HR_zone = HRrest + (HRmax − HRrest) × zone_pct
 *
 * Backed by: Karvonen & Vuorimaa (1988), widely used in Polar, Garmin, Whoop.
 */
export function calculateTrainingZones(
  restingHR: number,
  age: number,
  observedMaxHR?: number,
): TrainingZone[] {
  const maxHR = observedMaxHR && observedMaxHR > 100
    ? observedMaxHR
    : Math.round(208 - 0.7 * age);
  const hrr = maxHR - restingHR;

  const defs: Array<[number, string, string, string, number, number]> = [
    [1, 'trainingZones.z1.name', 'trainingZones.z1.desc', '#818cf8', 0.50, 0.60],
    [2, 'trainingZones.z2.name', 'trainingZones.z2.desc', '#38bdf8', 0.60, 0.70],
    [3, 'trainingZones.z3.name', 'trainingZones.z3.desc', '#4ade80', 0.70, 0.80],
    [4, 'trainingZones.z4.name', 'trainingZones.z4.desc', '#fb923c', 0.80, 0.90],
    [5, 'trainingZones.z5.name', 'trainingZones.z5.desc', '#f87171', 0.90, 1.00],
  ];

  return defs.map(([zone, name, description, color, lo, hi]) => ({
    zone,
    name,
    description,
    color,
    pctLow: lo * 100,
    pctHigh: hi * 100,
    hrLow:  Math.round(restingHR + hrr * lo),
    hrHigh: Math.round(restingHR + hrr * hi),
  }));
}

/** p50 (median) of an array of positive numbers. */
export function calculateMedian(values: number[]): number {
  const sorted = values.filter(v => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : Math.round(sorted[mid]);
}

/**
 * Net 7-day sleep debt vs a nightly target.
 * Positive = still owe sleep; negative = surplus.
 * Returns value in hours.
 */
export function calculateSleepDebt(sleepHours: number[], targetHours = 8): number {
  const valid = sleepHours.filter(h => h > 0);
  if (!valid.length) return 0;
  const debt = valid.reduce((sum, h) => sum + (targetHours - h), 0);
  return Math.round(debt * 10) / 10;
}
