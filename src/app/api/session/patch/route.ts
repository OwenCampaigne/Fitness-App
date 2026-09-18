// ── POST /api/session/patch ───────────────────────────────────────────────────
// The one edit funnel (framework §11). The UI's tap and the coach's sentence
// both arrive here as a structured patch, both go through the identical
// validator, and both get the same answer: applied, applied-with-a-flag, or
// pushed back with a safer counter-proposal.
//
// Any day in the seven-day window may be the subject — `date` defaults to today,
// so every existing caller is unchanged — and a future day is judged by exactly
// the same rails against its own context. Planning ahead is not a licence to
// plan something unsafe.

import { NextRequest, NextResponse } from 'next/server'
import {
  applyPatchToSession,
  parsePatchBody,
  readEditableSession,
} from '@/lib/sessionStore'
import { editContextFor, parseEditableDate } from '@/lib/weekPlan'
import { DISCLAIMER } from '@/lib/prehabEngine'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const { patch, error } = parsePatchBody(body)
    if (!patch) {
      return NextResponse.json({ error: error ?? 'Invalid patch.' }, { status: 400 })
    }

    const date = parseEditableDate((body as { date?: unknown })?.date)
    if (!date) {
      return NextResponse.json(
        { error: 'That date is outside the week you can edit.' },
        { status: 400 },
      )
    }

    const session = await readEditableSession(date)
    if (!session) {
      return NextResponse.json(
        { error: 'No session for that day yet — load the week or today first.' },
        { status: 404 },
      )
    }
    if (session.status === 'completed') {
      return NextResponse.json(
        { error: 'That day is already logged as complete — it is history now, not a plan.' },
        { status: 409 },
      )
    }

    const context = await editContextFor(date)
    const reason =
      typeof (body as { reason?: unknown })?.reason === 'string'
        ? ((body as { reason: string }).reason.trim().slice(0, 500) || null)
        : null

    const outcome = await applyPatchToSession(session, patch, context, { reason })

    return NextResponse.json({
      applied: outcome.applied,
      verdict: outcome.verdict,
      blocks: outcome.session.blocks,
      version: outcome.version,
      diff: outcome.diff,
      date: date.toISOString(),
      // §15 — a patch can add or remove prehab, so the line travels with it.
      disclaimer: DISCLAIMER,
    })
  } catch (err) {
    console.error('[/api/session/patch]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to apply that edit' }, { status: 500 })
  }
}
