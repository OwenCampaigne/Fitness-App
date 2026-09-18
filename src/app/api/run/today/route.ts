import { NextRequest, NextResponse } from 'next/server'
import { computeReadiness } from '@/lib/readiness'
import { getScenario } from '@/lib/scenario'
import { getRunScenario } from '@/lib/runScenario'
import { prisma } from '@/lib/db'
import {
  buildTodayRun,
  deriveZones,
  getTodayRun,
  parseRecoveryContext,
  writeLadderState,
} from '@/lib/runSession'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const readiness = getScenario() ?? (await computeReadiness())
    const runScenario = getRunScenario()

    // Scenario mode: fabricate the ladder state, never touch the DB.
    if (runScenario) {
      const profile = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
      const zones = deriveZones(profile?.age ?? 24, profile?.hrZonesJson ?? null, null)

      const result = buildTodayRun({
        band: readiness.band,
        provisional: readiness.provisional,
        painLevel: runScenario.painLevel,
        context: { ...runScenario.recoveryContext, ladder: runScenario.ladder },
        zones,
        easyPaceAnchor: runScenario.easyPaceAnchor,
        today: new Date(),
      })

      return NextResponse.json({
        scenarioMode: process.env.RUN_SCENARIO,
        scenarioLabel: runScenario.label,
        ...result,
        zones,
        analysis: null,
        readiness: { band: readiness.band, provisional: readiness.provisional },
      })
    }

    const result = await getTodayRun(readiness.band, readiness.provisional)
    return NextResponse.json({
      ...result,
      readiness: { band: readiness.band, provisional: readiness.provisional },
    })
  } catch (err) {
    console.error('[/api/run/today]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: "Unable to build today's run" }, { status: 500 })
  }
}

// POST — mark today's run complete, which is what moves the ladder.
export async function POST(req: NextRequest) {
  try {
    if (getRunScenario()) {
      return NextResponse.json(
        { error: 'Scenario mode is read-only — unset RUN_SCENARIO to log real sessions.' },
        { status: 400 },
      )
    }

    const body = (await req.json().catch(() => ({}))) as { painAfter?: 'none' | 'sometimes' | 'yes' }

    const readiness = getScenario() ?? (await computeReadiness())
    const result = await getTodayRun(readiness.band, readiness.provisional)

    // Pain reported after the session updates the profile before the ladder
    // state advances, so the next decision sees it.
    if (body.painAfter && body.painAfter !== 'none') {
      const profile = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
      if (profile) {
        await prisma.athlete_profile.update({
          where: { id: profile.id },
          data: { currentPainLevel: body.painAfter },
        })
      }
    }

    await writeLadderState(result.nextLadderState)

    const profile = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
    const context = parseRecoveryContext(profile?.recoveryContextJson ?? null)

    return NextResponse.json({
      ok: true,
      ladder: context?.ladder ?? result.nextLadderState,
      completed: result.prescription.label,
    })
  } catch (err) {
    console.error('[/api/run/today POST]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to log the run' }, { status: 500 })
  }
}
