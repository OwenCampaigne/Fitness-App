import { NextRequest, NextResponse } from 'next/server'
import { loadExerciseHistories } from '@/lib/strengthSession'
import { getStrengthScenario } from '@/lib/strengthScenario'
import { getKeyLift } from '@/lib/keyLifts'
import { deriveWorkingLoadAnchor, estimateE1RM, meanRir, topWeight } from '@/lib/strengthEngine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const exerciseId = req.nextUrl.searchParams.get('exerciseId')
    const limit = Math.min(20, Number(req.nextUrl.searchParams.get('limit') ?? 5))

    if (!exerciseId) {
      return NextResponse.json({ error: 'exerciseId is required' }, { status: 400 })
    }

    const scenario = getStrengthScenario()
    const all = scenario ? scenario.histories : await loadExerciseHistories()
    const histories = all
      .filter((h) => h.exerciseId === exerciseId)
      .sort((a, b) => b.date.getTime() - a.date.getTime())

    const lift = getKeyLift(exerciseId)
    const anchor = lift
      ? deriveWorkingLoadAnchor(histories, lift.defaultTargetRir)
      : null

    const sessions = histories.slice(0, limit).map((h) => {
      const top = topWeight(h.sets)
      const rir = meanRir(h.sets)
      const bestSet = h.sets.find((s) => s.weightKg === top && s.reps)
      return {
        sessionId: h.sessionId,
        date: h.date,
        sets: h.sets,
        topWeightKg: top,
        meanRir: rir,
        e1rm:
          top !== null && bestSet?.reps
            ? estimateE1RM(top, bestSet.reps, bestSet.rir ?? 0)
            : null,
      }
    })

    return NextResponse.json({ exerciseId, sessions, anchor })
  } catch (err) {
    console.error('[/api/strength/history]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to load history' }, { status: 500 })
  }
}
