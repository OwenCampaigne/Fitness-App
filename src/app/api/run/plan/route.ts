import { NextResponse } from 'next/server'
import { startOfDay, subDays } from 'date-fns'
import { prisma } from '@/lib/db'
import { ensureWeeklyPlan } from '@/lib/runSession'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const sessions = await prisma.planned_session.findMany({
      where: { date: { gte: subDays(startOfDay(new Date()), 1) }, modality: 'run' },
      orderBy: { date: 'asc' },
      take: 14,
    })

    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        date: s.date,
        priority: s.priority,
        spec: safeParse(s.targetSpecJson),
      })),
    })
  } catch (err) {
    console.error('[/api/run/plan]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to load the run plan' }, { status: 500 })
  }
}

// POST — lay down the coming week. Idempotent: existing days are left alone.
export async function POST() {
  try {
    const created = await ensureWeeklyPlan()
    return NextResponse.json({ ok: true, created })
  } catch (err) {
    console.error('[/api/run/plan POST]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to build the run plan' }, { status: 500 })
  }
}

function safeParse(json: string | null): unknown {
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
