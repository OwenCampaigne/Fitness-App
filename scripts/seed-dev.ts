/**
 * Dev seed — a realistic 28 days of history so every screen can be exercised
 * without Garmin credentials or a month of waiting.
 *
 *   npx tsx scripts/seed-dev.ts            # profile + readiness + activities
 *   npx tsx scripts/seed-dev.ts --strength # …plus four weeks of logged lifting
 *   npx tsx scripts/seed-dev.ts --reset    # wipe the dev rows first
 *
 * Safe to re-run: it upserts. It never touches the exercise libraries.
 */

import { addDays, startOfDay, subDays } from 'date-fns'
import { prisma } from '../src/lib/db'
import { buildMockSplits, mockWalkRunSplits } from '../src/lib/mockData'
import { computeDecoupling, serializeSplits, splitsTotals } from '../src/lib/splits'

const DAYS = 28
const withStrength = process.argv.includes('--strength')
const reset = process.argv.includes('--reset')

/** Deterministic pseudo-random so re-runs produce the same history. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

// ── TRIMP ─────────────────────────────────────────────────────────────────────
// Bannister (1991), the same formula `scoring.ts` uses. Seeding this matters
// more than it looks: `activities.trimp` is what `computeAcwr` reads for the
// chronic load window, and with it null every seeded day scores zero load. The
// budget then cold-starts, today overspends it, and every following day gets a
// ceiling of 0 — which reads on /week as "danger" when it actually means
// "no data". Empty history is not the same as an easy history.
function seedTrimp(durationMin: number, avgHr: number, maxHr: number, restingHr = 52): number {
  if (durationMin <= 0) return 0
  const hrReserve = Math.max(0, Math.min(1, (avgHr - restingHr) / (maxHr - restingHr)))
  return Math.round(durationMin * hrReserve * Math.exp(1.92 * hrReserve) * 10) / 10
}

async function main() {
  if (reset) {
    await prisma.set_logs.deleteMany()
    await prisma.edit_history.deleteMany()
    await prisma.session.deleteMany()
    await prisma.activities.deleteMany()
    await prisma.readiness_daily.deleteMany()
    await prisma.calibration_state.deleteMany()
    await prisma.athlete_profile.deleteMany()
    console.log('· cleared dev rows')
  }

  const today = startOfDay(new Date())

  // ── Athlete profile ─────────────────────────────────────────────────────────
  // Post-surgical context from the Phase 1 spec: ACL + MACI + HTO, left knee,
  // currently in walk/run intervals. No surgical clearance entered — the
  // strength engine will take its conservative posture and say so.
  const profileData = {
    age: 24,
    sex: 'male',
    injuryHistory: JSON.stringify(['ACL tear', 'MACI', 'HTO', 'left knee']),
    currentPainLevel: 'none',
    recoveryContextJson: JSON.stringify({
      surgicalLeg: 'left',
      surgeryDateApprox: '2025-11',
      weeklyRunMinutes: 40,
      longestRunSegmentMin: 6,
    }),
    plyoTier: 1,
    plyoTierSource: 'estimate',
    plyoTierConfidence: 'estimate',
    trainingPacesJson: JSON.stringify({
      easy: { value: null, source: 'unknown', confidence: 'estimate' },
    }),
    keyLiftLoadsJson: JSON.stringify({}),
  }

  const existingProfile = await prisma.athlete_profile.findFirst()
  if (existingProfile) {
    await prisma.athlete_profile.update({ where: { id: existingProfile.id }, data: profileData })
  } else {
    await prisma.athlete_profile.create({ data: profileData })
  }
  console.log('· athlete_profile')

  // ── Calibration state ───────────────────────────────────────────────────────
  const calData = {
    startedOn: subDays(today, DAYS),
    windowEnd: addDays(subDays(today, DAYS), 21),
    recoveryBaselineReady: true,
    graduated: true,
  }
  const existingCal = await prisma.calibration_state.findFirst()
  if (existingCal) {
    await prisma.calibration_state.update({ where: { id: existingCal.id }, data: calData })
  } else {
    await prisma.calibration_state.create({ data: calData })
  }
  console.log('· calibration_state (graduated)')

  // ── 28 days of readiness + activities ───────────────────────────────────────
  for (let i = DAYS - 1; i >= 0; i--) {
    const date = subDays(today, i)
    const r = rand(i + 1)

    const hrv = Math.round(48 + r * 14 - 5)
    const rhr = Math.round(54 + (1 - r) * 6)
    const sleepHours = Math.round((6.4 + r * 1.9) * 10) / 10
    const sleepScore = Math.round(58 + r * 32)

    await prisma.readiness_daily.upsert({
      where: { date },
      update: {},
      create: {
        date,
        hrv,
        rhr,
        sleepScore,
        sleepHours,
        bodyBattery: Math.round(50 + r * 40),
        stress: Math.round(20 + (1 - r) * 35),
        recoveryScore: Math.round(50 + r * 40),
      },
    })

    // Walk/run intervals four days a week, matching the recovery context.
    if (i % 7 === 1 || i % 7 === 3 || i % 7 === 5 || i % 7 === 6) {
      const durationMin = Math.round(28 + r * 14)
      // Walk/run splits on purpose: this is the shape the decoupling gate has
      // to refuse, and it is the shape most of this athlete's week is in.
      const splits = mockWalkRunSplits
      await prisma.activities.upsert({
        where: { garminActivityId: `dev-${i}` },
        update: {},
        create: {
          garminActivityId: `dev-${i}`,
          date,
          type: 'running',
          durationMin,
          distanceKm: Math.round((durationMin / 9.5) * 100) / 100,
          avgHr: Math.round(132 + r * 16),
          maxHr: Math.round(158 + r * 14),
          trimp: seedTrimp(durationMin, Math.round(132 + r * 16), Math.round(158 + r * 14)),
          cadence: 162,
          splits: serializeSplits(splits),
          decoupling: null,
        },
      })
    }

    // ── One steady long run a week (framework §7, §16) ────────────────────────
    // The walk/run sessions above can never produce a decoupling figure, so on
    // their own they would leave the whole durability path untested in mock
    // mode. These are held-effort long runs whose drift widens week by week, so
    // every band — under 5%, 5–10%, past 10% — is reachable locally without
    // waiting months for a real bad long run.
    if (i % 7 === 0) {
      const weeksAgo = Math.floor(i / 7)
      const splits = buildMockSplits(
        {
          km: 11,
          startPaceSecPerKm: 348,
          endPaceSecPerKm: 348,
          startHr: 140,
          // Older weeks drifted harder; the most recent long run is the cleanest.
          endHr: 148 + weeksAgo * 4,
          tailKm: 0.4,
          startTime: date,
        },
        `dev-long-${i}`,
      )
      const decoupling = computeDecoupling(splits)
      const totals = splitsTotals(splits)
      await prisma.activities.upsert({
        where: { garminActivityId: `dev-long-${i}` },
        update: {},
        create: {
          garminActivityId: `dev-long-${i}`,
          date,
          type: 'running',
          durationMin: totals.durationMin,
          distanceKm: totals.distanceKm,
          avgPaceSecPerKm: 348,
          avgHr: Math.round(144 + weeksAgo * 2),
          maxHr: Math.round(160 + weeksAgo * 2),
          trimp: seedTrimp(
            totals.durationMin,
            Math.round(144 + weeksAgo * 2),
            Math.round(160 + weeksAgo * 2),
          ),
          cadence: 168,
          elevationM: 48,
          splits: serializeSplits(splits),
          decoupling: decoupling.available ? decoupling.driftPct : null,
        },
      })
    }
  }
  console.log(`· ${DAYS} days of readiness_daily + walk/run activities + weekly long runs with splits`)

  // ── Optional strength history ───────────────────────────────────────────────
  if (withStrength) {
    const plan: Array<{ daysAgo: number; exerciseId: string; weight: number; reps: number; rir: number }> = [
      { daysAgo: 21, exerciseId: 'romanian-deadlift', weight: 55, reps: 8, rir: 2 },
      { daysAgo: 14, exerciseId: 'romanian-deadlift', weight: 57.5, reps: 8, rir: 2 },
      { daysAgo: 7, exerciseId: 'romanian-deadlift', weight: 60, reps: 8, rir: 2 },
      { daysAgo: 21, exerciseId: 'box-squat', weight: 50, reps: 6, rir: 3 },
      { daysAgo: 14, exerciseId: 'box-squat', weight: 55, reps: 6, rir: 2 },
      { daysAgo: 7, exerciseId: 'box-squat', weight: 57.5, reps: 6, rir: 2 },
      { daysAgo: 7, exerciseId: 'standing-calf-raise', weight: 40, reps: 10, rir: 2 },
    ]

    const sessionIds = new Map<number, number>()
    for (const daysAgo of Array.from(new Set(plan.map((p) => p.daysAgo))).sort((a, b) => b - a)) {
      const date = subDays(today, daysAgo)
      const session = await prisma.session.upsert({
        where: { date },
        update: {},
        create: {
          date,
          status: 'completed',
          version: 1,
          blocksJson: JSON.stringify({ blocks: [] }),
          sourceOfLastEdit: 'engine',
        },
      })
      sessionIds.set(daysAgo, session.id)
    }

    for (const entry of plan) {
      const sessionId = sessionIds.get(entry.daysAgo)!
      for (let setNumber = 1; setNumber <= 3; setNumber++) {
        const existing = await prisma.set_logs.findFirst({
          where: { sessionId, exerciseId: entry.exerciseId, setNumber },
        })
        if (existing) continue
        await prisma.set_logs.create({
          data: {
            sessionId,
            exerciseId: entry.exerciseId,
            setNumber,
            weightKg: entry.weight,
            reps: entry.reps,
            rir: entry.rir,
          },
        })
      }
    }
    console.log(`· ${plan.length * 3} logged sets across ${sessionIds.size} sessions`)
  }

  const counts = {
    readiness: await prisma.readiness_daily.count(),
    activities: await prisma.activities.count(),
    sessions: await prisma.session.count(),
    sets: await prisma.set_logs.count(),
  }
  console.log('\nDone:', counts)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
