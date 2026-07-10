import { NextResponse } from 'next/server'
import { format } from 'date-fns'
import { computeReadiness } from '@/lib/readiness'
import { getScenario } from '@/lib/scenario'
import { syncGarmin } from '@/lib/syncGarmin'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  // Scenario mode: return preset without touching DB (dev only)
  const scenario = getScenario()
  if (scenario) {
    return NextResponse.json({
      ...scenario,
      scenarioMode: process.env.SCENARIO,
    })
  }

  try {
    // Cold-start bootstrap: if DB is empty, run sync inline before computing
    const rowCount = await prisma.readiness_daily.count()
    if (rowCount === 0) {
      const syncResult = await syncGarmin(format(new Date(), 'yyyy-MM-dd'))
      if (!syncResult.ok) {
        return NextResponse.json(
          { error: 'No data yet — Garmin sync failed', detail: syncResult.error },
          { status: 503 },
        )
      }
    }

    const result = await computeReadiness()
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/readiness] error:', msg)
    return NextResponse.json({ error: 'Unable to compute readiness' }, { status: 500 })
  }
}
