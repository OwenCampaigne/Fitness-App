import { NextRequest, NextResponse } from 'next/server'
import { startOfDay } from 'date-fns'
import { computeReadiness } from '@/lib/readiness'
import { getScenario } from '@/lib/scenario'
import { prisma } from '@/lib/db'
import {
  buildStrengthSession,
  concurrentGuard,
  checkDeload,
  daysSinceLastIncrease,
  getOrCreateTodaySession,
  latestByExercise,
  loadExerciseHistories,
  recordEdit,
} from '@/lib/strengthSession'
import { getStrengthScenario } from '@/lib/strengthScenario'
import { applyRehabStage } from '@/lib/rehabStage'
import type { RecoveryContext } from '@/types/strength'
import type { SessionBlock, SessionBlocks } from '@/types/session'

export const dynamic = 'force-dynamic'

// The rehab stage is folded in on read so `filterContraindicated` sees one
// clearance object and one ceiling, exactly as it always has (§15).
function parseRecoveryContext(json: string | null): RecoveryContext | null {
  if (!json) return null
  try {
    return applyRehabStage(JSON.parse(json) as RecoveryContext)
  } catch {
    return null
  }
}

export async function GET() {
  try {
    const strengthScenario = getStrengthScenario()

    const readiness = getScenario() ?? (await computeReadiness())
    const profile = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })

    const histories = strengthScenario
      ? strengthScenario.histories
      : await loadExerciseHistories()

    const input = {
      band: readiness.band,
      provisional: readiness.provisional,
      painLevel: (profile?.currentPainLevel ?? 'none') as 'none' | 'sometimes' | 'yes',
      recoveryContext: parseRecoveryContext(profile?.recoveryContextJson ?? null),
      // Exclude today so the session is built against the previous session,
      // not against sets logged into it a moment ago.
      lastSessionByExercise: latestByExercise(histories, { before: startOfDay(new Date()) }),
      daysSinceIncreaseByExercise: daysSinceLastIncrease(histories),
    }

    // Scenario mode never writes to the DB.
    if (strengthScenario) {
      const built = buildStrengthSession(input)
      return NextResponse.json({
        sessionId: null,
        scenarioMode: process.env.STRENGTH_SCENARIO,
        blocks: built.blocks,
        adjustment: built.adjustment,
        blockedLifts: built.blockedLifts,
        usingConservativeDefault: built.usingConservativeDefault,
        readiness: { band: readiness.band, provisional: readiness.provisional },
        deload: { shouldDeload: false, reason: null },
        concurrent: { conflict: false, reason: 'Scenario mode — no run plan.' },
        loggedSets: [],
      })
    }

    const { session, blocks, built } = await getOrCreateTodaySession(input)
    const loggedSets = await prisma.set_logs.findMany({
      where: { sessionId: session.id },
      orderBy: [{ exerciseId: 'asc' }, { setNumber: 'asc' }],
    })

    const liftIds = blocks.flatMap((b: SessionBlock) => b.items.map((i) => i.ref.id))
    const [concurrent, deload] = await Promise.all([
      concurrentGuard(liftIds),
      checkDeload([readiness.signals.acwr]),
    ])

    // `built` is only present when this request created the session.
    const rebuilt = built ?? buildStrengthSession(input)

    return NextResponse.json({
      sessionId: session.id,
      version: session.version,
      status: session.status,
      blocks,
      adjustment: rebuilt.adjustment,
      blockedLifts: rebuilt.blockedLifts,
      usingConservativeDefault: rebuilt.usingConservativeDefault,
      readiness: { band: readiness.band, provisional: readiness.provisional },
      deload,
      concurrent,
      loggedSets,
    })
  } catch (err) {
    console.error('[/api/strength/session]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to load strength session' }, { status: 500 })
  }
}

// PATCH — replace the block list (add / remove / reorder), writing edit_history.
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      sessionId: number
      blocks: SessionBlock[]
      reason?: string
    }

    if (!body?.sessionId || !Array.isArray(body.blocks)) {
      return NextResponse.json({ error: 'sessionId and blocks are required' }, { status: 400 })
    }

    const existing = await prisma.session.findUnique({ where: { id: body.sessionId } })
    if (!existing) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const before = JSON.parse(existing.blocksJson) as SessionBlocks
    const nextVersion = existing.version + 1

    const updated = await prisma.session.update({
      where: { id: existing.id },
      data: {
        blocksJson: JSON.stringify({ blocks: body.blocks } satisfies SessionBlocks),
        version: nextVersion,
        sourceOfLastEdit: 'user',
      },
    })

    await recordEdit({
      sessionId: existing.id,
      version: nextVersion,
      actor: 'user',
      diff: { before: before.blocks, after: body.blocks },
      reason: body.reason ?? 'Manual edit',
    })

    return NextResponse.json({ ok: true, version: updated.version })
  } catch (err) {
    console.error('[/api/strength/session PATCH]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to update session' }, { status: 500 })
  }
}
