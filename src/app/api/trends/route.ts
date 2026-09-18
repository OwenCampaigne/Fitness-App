// ── /api/trends ───────────────────────────────────────────────────────────────
// Two jobs behind one path.
//
// `?range=30|90` is the original daily-metric series the /hrv and /strain pages
// still read; it is left exactly as it was.
//
// `?view=review` is the weekly review (framework §14 — charts live on /trends
// and nowhere else). It is nothing but DB reads plus the pure functions in
// `lib/trends.ts`: every judgement, threshold and sentence lives there so it is
// unit-tested, and this file stays a data-loading shim.

import { NextResponse } from 'next/server'
import { format, subDays } from 'date-fns'
import { fetchTrendData } from '@/lib/garmin'
import { prisma } from '@/lib/db'
import { estimateSRPE } from '@/lib/readiness'
import { deriveZones } from '@/lib/runSession'
import { loadExerciseHistories } from '@/lib/strengthSession'
import { getStrengthScenario } from '@/lib/strengthScenario'
import { KEY_LIFTS, KEY_LIFTS_BY_ID, getKeyLift } from '@/lib/keyLifts'
import { buildHistoryView } from '@/lib/recordsStore'
import {
  acwrSeries,
  buildLiftAnchorArc,
  buildLthrAnchorArc,
  buildPaceAnchorArc,
  buildPlyoTierArc,
  dailyLoadSeries,
  intensityDistribution,
  readinessTrend,
  setsByMuscleGroup,
  summariseCalibration,
  weeklyVolume,
} from '@/lib/trends'
import type { AnchorArc, WeeklyReview } from '@/lib/trends'
import type { RunActivityRow } from '@/types/run'
import type { ExerciseSessionHistory, WorkingLoadAnchor } from '@/types/strength'

export const dynamic = 'force-dynamic'

/** How far back the review looks. 8 weeks of weeks, 12 of raw days for ACWR. */
const REVIEW_WEEKS = 8
const ACWR_WINDOW_DAYS = 84
const HISTORY_DAYS = 120

export async function GET(req: Request) {
  const url = new URL(req.url)

  // `?view=history` is the dated records and past weeks. Both are derived from
  // the same source rows every time and written back idempotently, so a page
  // load is allowed to trigger the rollup — there is no cron to depend on.
  if (url.searchParams.get('view') === 'history') {
    try {
      return NextResponse.json(await buildHistoryView())
    } catch (err) {
      console.error('[/api/trends?view=history]', err instanceof Error ? err.message : String(err))
      return NextResponse.json({ error: 'Unable to build the training history' }, { status: 500 })
    }
  }

  if (url.searchParams.get('view') === 'review') {
    try {
      return NextResponse.json(await buildWeeklyReview())
    } catch (err) {
      console.error('[/api/trends?view=review]', err instanceof Error ? err.message : String(err))
      return NextResponse.json({ error: 'Unable to build the weekly review' }, { status: 500 })
    }
  }

  const range = parseInt(url.searchParams.get('range') ?? '30')
  const date = url.searchParams.get('date') ?? format(new Date(), 'yyyy-MM-dd')

  if (![30, 90].includes(range)) {
    return NextResponse.json({ error: 'Invalid range. Use 30 or 90.' }, { status: 400 })
  }

  const points = await fetchTrendData(range, date)
  return NextResponse.json(points)
}

// ── The weekly review ─────────────────────────────────────────────────────────

async function buildWeeklyReview(): Promise<WeeklyReview> {
  const today = new Date()

  const [profile, calibration, activityRows, readinessRows] = await Promise.all([
    prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } }),
    prisma.calibration_state.findFirst({ orderBy: { id: 'desc' } }),
    prisma.activities.findMany({
      where: { date: { gte: subDays(today, HISTORY_DAYS) } },
      orderBy: { date: 'asc' },
    }),
    prisma.readiness_daily.findMany({
      where: { date: { gte: subDays(today, REVIEW_WEEKS * 7 + 7) } },
      orderBy: { date: 'asc' },
    }),
  ])

  const activities: RunActivityRow[] = activityRows.map((a) => ({
    date: new Date(a.date),
    type: a.type,
    durationMin: a.durationMin,
    distanceKm: a.distanceKm,
    avgHr: a.avgHr,
    maxHr: a.maxHr,
  }))

  // Scenario mode first, per the architecture rule — the review has to render
  // against presets before it ever sees live data (§16).
  const scenario = getStrengthScenario()
  const histories = scenario ? scenario.histories : await loadExerciseHistories(HISTORY_DAYS)

  const age = profile?.age ?? null
  const zones = deriveZones(age, profile?.hrZonesJson ?? null, null)
  const srpe = (avgHr: number) => estimateSRPE(avgHr, age ?? 35)

  const anchors = buildAnchors(profile, histories, activities, zones, today)

  const daily = dailyLoadSeries(activities, { days: ACWR_WINDOW_DAYS, today, srpe })
  const runsInWindow = activities.filter((a) => a.date >= subDays(today, REVIEW_WEEKS * 7))

  return {
    generatedFor: format(today, 'yyyy-MM-dd'),
    anchors,
    volume: weeklyVolume(activities, { weeks: REVIEW_WEEKS, today, srpe }),
    acwr: acwrSeries(daily, { days: REVIEW_WEEKS * 7 }),
    intensity: intensityDistribution(runsInWindow, zones.z2Ceiling),
    readiness: readinessTrend(
      readinessRows.map((r) => ({
        date: new Date(r.date),
        recoveryScore: r.recoveryScore,
        hrv: r.hrv,
        rhr: r.rhr,
        sleepScore: r.sleepScore,
        sleepHours: r.sleepHours,
      })),
      { weeks: REVIEW_WEEKS, today },
    ),
    muscles: setsByMuscleGroup(histories, KEY_LIFTS_BY_ID, { today }),
    calibration: summariseCalibration(anchors, {
      graduated: calibration?.graduated ?? false,
      recoveryBaselineReady: calibration?.recoveryBaselineReady ?? false,
    }),
  }
}

/**
 * Every anchor §3 names — HR zones, training paces, key-lift working loads,
 * plyo tier — in one list, arcs that actually moved first.
 */
function buildAnchors(
  profile: { plyoTier: number | null; plyoTierSource: string | null; plyoTierConfidence: string | null; keyLiftLoadsJson: string | null } | null,
  histories: ExerciseSessionHistory[],
  activities: RunActivityRow[],
  zones: { z2Ceiling: number | null; lthr: number | null; maxHr: number | null },
  today: Date,
): AnchorArc[] {
  const anchors: AnchorArc[] = [
    buildLthrAnchorArc(activities, zones.maxHr, { today }),
    buildPaceAnchorArc(activities, zones.z2Ceiling, { today }),
  ]

  for (const lift of liftsToShow(profile?.keyLiftLoadsJson ?? null, histories)) {
    anchors.push(
      buildLiftAnchorArc(
        lift,
        histories.filter((h) => h.exerciseId === lift.id),
        { today },
      ),
    )
  }

  anchors.push(
    buildPlyoTierArc(
      {
        plyoTier: profile?.plyoTier ?? null,
        plyoTierSource: profile?.plyoTierSource ?? null,
        plyoTierConfidence: profile?.plyoTierConfidence ?? null,
      },
      { today },
    ),
  )

  // Arcs that moved lead; estimates follow, but none of them are hidden — an
  // anchor the system is still guessing at is the most important thing on the
  // page to be honest about (§5b).
  return anchors.sort((a, b) => Number(b.hasMovement) - Number(a.hasMovement))
}

/**
 * Which lifts get a card: anything with logged history, plus anything the
 * profile already holds an anchor for. With neither, fall back to the three
 * main-pattern lifts so the page can say out loud that they are still guesses.
 */
function liftsToShow(keyLiftLoadsJson: string | null, histories: ExerciseSessionHistory[]) {
  const ids = new Set<string>()

  for (const history of histories) {
    if (getKeyLift(history.exerciseId)) ids.add(getKeyLift(history.exerciseId)!.id)
  }

  try {
    const stored = keyLiftLoadsJson
      ? (JSON.parse(keyLiftLoadsJson) as Record<string, WorkingLoadAnchor>)
      : {}
    for (const id of Object.keys(stored)) {
      const lift = getKeyLift(id)
      if (lift) ids.add(lift.id)
    }
  } catch {
    /* a malformed anchor blob should not take the page down */
  }

  if (ids.size === 0) {
    return KEY_LIFTS.filter((l) => ['hinge', 'squat', 'unilateral_squat'].includes(l.pattern)).slice(0, 3)
  }

  return Array.from(ids)
    .map((id) => KEY_LIFTS_BY_ID[id])
    .filter((l): l is (typeof KEY_LIFTS)[number] => Boolean(l))
}
