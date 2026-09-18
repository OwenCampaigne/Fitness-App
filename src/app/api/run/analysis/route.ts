import { NextResponse } from 'next/server'
import { subDays } from 'date-fns'
import { prisma } from '@/lib/db'
import { analyzeRuns, toRunActivityRow } from '@/lib/runAnalysis'
import { deriveZones, refreshPaceAnchors } from '@/lib/runSession'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const profile = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
    const activities = await prisma.activities.findMany({
      where: { date: { gte: subDays(new Date(), 42) } },
      orderBy: { date: 'asc' },
    })

    const zones = deriveZones(profile?.age ?? null, profile?.hrZonesJson ?? null, null)
    // Map through toRunActivityRow rather than by hand: the hand-rolled version
    // silently omitted `splits`, so decoupling reported "unavailable" for a
    // reason that was false here — the rows had splits, the route dropped them.
    // An omitted optional field is not a type error, which is how that hid.
    const analysis = analyzeRuns(activities.map(toRunActivityRow), {
      z2Ceiling: zones.z2Ceiling,
      maxHr: zones.maxHr,
    })

    return NextResponse.json({ analysis, zones, windowDays: 42 })
  } catch (err) {
    console.error('[/api/run/analysis]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to analyse runs' }, { status: 500 })
  }
}

// POST — push what the analysis learned back into the anchors.
export async function POST() {
  try {
    await refreshPaceAnchors()
    const profile = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
    return NextResponse.json({
      ok: true,
      trainingPaces: profile?.trainingPacesJson ? JSON.parse(profile.trainingPacesJson) : {},
      hrZones: profile?.hrZonesJson ? JSON.parse(profile.hrZonesJson) : {},
    })
  } catch (err) {
    console.error('[/api/run/analysis POST]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to refresh anchors' }, { status: 500 })
  }
}
