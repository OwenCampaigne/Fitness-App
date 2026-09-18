// ── POST /api/session/undo ────────────────────────────────────────────────────
// "Versioned and reversible" (framework §11), for real: the stored inverse of
// the last edit is replayed through the same validator, so an undo is an edit
// like any other — audited, versioned, and refusable if it would itself break a
// rule. It is not a rollback to a saved blob.
//
// One POST undoes one *edit*, not one day. A move is one intent written as two
// rows on two days, so undoing either half reverses both — all-or-nothing, and
// each half judged against its own day's rails. The bare POST the Today screen
// sends still means "today", and a single-day edit still reverses exactly one.

import { NextRequest, NextResponse } from 'next/server'
import { readEditableSession, undoLastEdit } from '@/lib/sessionStore'
import { editContextFor, parseEditableDate } from '@/lib/weekPlan'
import { DISCLAIMER } from '@/lib/prehabEngine'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    // The body is optional: a bare POST still means today, which is what the
    // Today screen sends and has always sent.
    const body = await req.json().catch(() => null)
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

    const context = await editContextFor(date)
    const outcome = await undoLastEdit(session, context, editContextFor)

    return NextResponse.json({
      applied: outcome.applied,
      blocks: outcome.session.blocks,
      version: outcome.version,
      verdict: outcome.verdict,
      diff: outcome.diff,
      undoneEditId: outcome.undoneEditId,
      // The receipt for the other day, when the edit spanned one (§11).
      alsoUndone: outcome.alsoUndone.map((d) => ({
        date: d.date.toISOString(),
        version: d.version,
        editId: d.editId,
      })),
      date: date.toISOString(),
      disclaimer: DISCLAIMER,
    })
  } catch (err) {
    console.error('[/api/session/undo]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to undo the last edit' }, { status: 500 })
  }
}
