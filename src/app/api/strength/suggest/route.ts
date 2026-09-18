import { NextRequest, NextResponse } from 'next/server'
import { startOfDay } from 'date-fns'
import { computeReadiness } from '@/lib/readiness'
import { getScenario } from '@/lib/scenario'
import { getStrengthScenario } from '@/lib/strengthScenario'
import { getKeyLift } from '@/lib/keyLifts'
import {
  daysSinceLastIncrease,
  latestByExercise,
  loadExerciseHistories,
} from '@/lib/strengthSession'
import { applyReadinessAdjustment, suggestProgression, topWeight } from '@/lib/strengthEngine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const exerciseId = req.nextUrl.searchParams.get('exerciseId')
    if (!exerciseId) {
      return NextResponse.json({ error: 'exerciseId is required' }, { status: 400 })
    }

    const lift = getKeyLift(exerciseId)
    if (!lift) {
      return NextResponse.json(
        {
          error: 'Not a curated key lift',
          detail:
            'Any library exercise can be logged, but only the curated key lifts are auto-progressed.',
        },
        { status: 404 },
      )
    }

    const scenario = getStrengthScenario()
    const histories = scenario ? scenario.histories : await loadExerciseHistories()
    const last = latestByExercise(histories, { before: startOfDay(new Date()) })[lift.id] ?? null

    const readiness = getScenario() ?? (await computeReadiness())
    const adjustment = applyReadinessAdjustment(
      readiness.band,
      readiness.provisional,
      readiness.painFlagged,
    )

    const suggestion = suggestProgression(lift, last, {
      provisional: readiness.provisional,
      daysSinceLastIncrease: daysSinceLastIncrease(histories)[lift.id] ?? null,
    })

    // An amber or provisional day holds the load rather than progressing it.
    let weightKg = suggestion.weightKg
    let reason = suggestion.reason
    if (adjustment.capLoadAtLastSession && suggestion.action === 'increase_load' && last) {
      const lastTop = topWeight(last.sets)
      if (lastTop !== null) {
        weightKg = lastTop
        reason = `Ready to add load, but ${adjustment.summary.toLowerCase()}`
      }
    }

    return NextResponse.json({
      exerciseId: lift.id,
      name: lift.name,
      action: suggestion.action,
      weightKg,
      reps: suggestion.reps,
      repsMin: lift.defaultRepsMin,
      sets: Math.max(1, lift.defaultSets - adjustment.setsDropped),
      targetRir: suggestion.targetRir,
      reason,
      band: readiness.band,
      bodyweight: lift.bodyweight,
    })
  } catch (err) {
    console.error('[/api/strength/suggest]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to compute suggestion' }, { status: 500 })
  }
}
