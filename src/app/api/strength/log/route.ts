import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logSet, loadExerciseHistories, latestByExercise } from '@/lib/strengthSession'
import { getKeyLift } from '@/lib/keyLifts'
import { suggestProgression } from '@/lib/strengthEngine'

export const dynamic = 'force-dynamic'

interface LogBody {
  sessionId: number
  exerciseId: string
  setNumber: number
  weightKg?: number | null
  reps: number
  rir: number
  notes?: string | null
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as LogBody

    if (!body?.sessionId || !body?.exerciseId || !body?.setNumber) {
      return NextResponse.json(
        { error: 'sessionId, exerciseId and setNumber are required' },
        { status: 400 },
      )
    }
    if (typeof body.reps !== 'number' || body.reps < 0 || body.reps > 100) {
      return NextResponse.json({ error: 'reps must be between 0 and 100' }, { status: 400 })
    }
    // RIR is the autoregulation and calibration signal — a set without it is
    // worth much less, so it is required rather than optional (spec §5).
    if (typeof body.rir !== 'number' || body.rir < 0 || body.rir > 10) {
      return NextResponse.json({ error: 'rir must be between 0 and 10' }, { status: 400 })
    }
    if (
      body.weightKg !== null &&
      body.weightKg !== undefined &&
      (typeof body.weightKg !== 'number' || body.weightKg < 0 || body.weightKg > 500)
    ) {
      return NextResponse.json({ error: 'weightKg must be between 0 and 500' }, { status: 400 })
    }

    const session = await prisma.session.findUnique({ where: { id: body.sessionId } })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const row = await logSet({
      sessionId: body.sessionId,
      exerciseId: body.exerciseId,
      setNumber: body.setNumber,
      weightKg: body.weightKg ?? null,
      reps: body.reps,
      rir: body.rir,
      notes: body.notes ?? null,
    })

    if (session.status === 'draft') {
      await prisma.session.update({ where: { id: session.id }, data: { status: 'active' } })
    }

    // What the next session should look like, given this one.
    const lift = getKeyLift(body.exerciseId)
    let nextSuggestion = null
    if (lift) {
      const histories = await loadExerciseHistories()
      const latest = latestByExercise(histories)[lift.id] ?? null
      nextSuggestion = suggestProgression(lift, latest)
    }

    const sets = await prisma.set_logs.findMany({
      where: { sessionId: body.sessionId, exerciseId: body.exerciseId },
      orderBy: { setNumber: 'asc' },
    })

    return NextResponse.json({ ok: true, set: row, sets, nextSuggestion })
  } catch (err) {
    console.error('[/api/strength/log]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to log set' }, { status: 500 })
  }
}
