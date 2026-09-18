// ── POST /api/niggle/resolve ──────────────────────────────────────────────────
// Close an episode. Resolves every report in it rather than the single row the
// athlete tapped — an episode is the unit the escalation ladder reasons over
// (framework §9), so half-resolving one would leave a phantom "twelve days and
// counting" behind.

import { NextRequest, NextResponse } from 'next/server'
import { getMovementScenario } from '@/lib/movementScenario'
import { DISCLAIMER } from '@/lib/prehabEngine'
import { resolveNiggle } from '@/lib/movementSession'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'A JSON object body is required.' }, { status: 400 })
    }

    const id = body.id
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'id must be a positive whole number.' }, { status: 400 })
    }

    // A scenario's niggles are fabricated and have no rows behind them, so the
    // honest answer is that nothing was written (§16).
    if (getMovementScenario()) {
      return NextResponse.json({ ok: true, persisted: false, resolved: 0, disclaimer: DISCLAIMER })
    }

    const resolved = await resolveNiggle(id)
    if (resolved === 0) {
      return NextResponse.json({ error: 'No open niggle with that id.' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, persisted: true, resolved, disclaimer: DISCLAIMER })
  } catch (err) {
    console.error('[/api/niggle/resolve]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to resolve that' }, { status: 500 })
  }
}
