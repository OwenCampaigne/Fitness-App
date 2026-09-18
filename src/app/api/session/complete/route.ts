// ── POST /api/session/complete ────────────────────────────────────────────────
// Close the day out and price it in the one currency (framework §3): session
// load = duration(min) × sRPE(0–10). Nothing else can supply the sRPE — TRIMP
// prices the run and contacts price the plyos, but only the athlete can say what
// the whole thing felt like, which is why it is the one required field.

import { NextRequest, NextResponse } from 'next/server'
import { startOfDay } from 'date-fns'
import { completeSession, findSessionRow } from '@/lib/sessionStore'
import { refreshPlyoTierAnchor } from '@/lib/movementSession'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      srpe?: unknown
      actualDurationMin?: unknown
    } | null

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'A JSON object body is required.' }, { status: 400 })
    }

    const srpe = body.srpe
    if (typeof srpe !== 'number' || !Number.isFinite(srpe) || srpe < 0 || srpe > 10) {
      return NextResponse.json({ error: 'srpe must be a number between 0 and 10.' }, { status: 400 })
    }

    let actualDurationMin: number | null = null
    if (body.actualDurationMin !== undefined && body.actualDurationMin !== null) {
      const value = body.actualDurationMin
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 600) {
        return NextResponse.json(
          { error: 'actualDurationMin must be a number between 0 and 600.' },
          { status: 400 },
        )
      }
      actualDurationMin = value
    }

    const row = await findSessionRow(startOfDay(new Date()))
    if (!row) {
      return NextResponse.json(
        { error: "No session for today yet — load /api/session/today first." },
        { status: 404 },
      )
    }

    const result = await completeSession({
      sessionId: row.id,
      srpe,
      actualDurationMin,
    })

    // A completed plyo session is new evidence about the tier, so the anchor
    // moves now rather than waiting for a nightly job (§5b).
    const anchor = await refreshPlyoTierAnchor()

    return NextResponse.json({
      ok: result.ok,
      actualLoad: result.actualLoad,
      actualDurationMin: result.actualDurationMin,
      srpe: result.srpe,
      plyoTier: { value: anchor.value, source: anchor.source, basis: anchor.basis },
    })
  } catch (err) {
    console.error('[/api/session/complete]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to complete the session' }, { status: 500 })
  }
}
