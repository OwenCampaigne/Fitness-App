// ── POST /api/session/move ────────────────────────────────────────────────────
// "Move the long run to Saturday" (framework §11-A names this one literally).
//
// There is no cross-day patch op and there should not be one. A move is an `add`
// on the destination day and a `remove` on the source, each judged by the
// validator against *its own* day — which is the entire reason moving a session
// around your week is safe rather than a way to smuggle work past the rails.
// Landing the long run on Saturday re-checks Sunday through the same
// concurrent-training rule that would have checked it had the engine put it
// there (§8), and lands it next to Friday through the same back-to-back rule
// (§10).
//
// Order matters: the destination is written first. If its rails push back,
// nothing has moved and the item is still sitting where it was — the athlete
// gets a verdict, not a hole in their week.
//
// The two rows share a `groupId`, which is what makes the move *reversible*
// (§11) rather than merely auditable: undoing one half alone would leave the
// item on both days or on neither, so `undoLastEdit` reverses the pair together.

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { applyPatchToSession, findSessionItem, readEditableSession } from '@/lib/sessionStore'
import {
  destinationBlockKind,
  editContextFor,
  moveItemOps,
  parseEditableDate,
} from '@/lib/weekPlan'
import { DISCLAIMER } from '@/lib/prehabEngine'
import type { EditActor } from '@/types/session'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      itemId?: unknown
      from?: unknown
      to?: unknown
      reason?: unknown
      actor?: unknown
      override?: unknown
    } | null

    const itemId = typeof body?.itemId === 'string' ? body.itemId : null
    if (!itemId) {
      return NextResponse.json({ error: 'Which item is moving?' }, { status: 400 })
    }

    const from = parseEditableDate(body?.from)
    const to = parseEditableDate(body?.to)
    if (!from || !to) {
      return NextResponse.json(
        { error: 'Both days have to be inside the week you can edit.' },
        { status: 400 },
      )
    }
    if (from.getTime() === to.getTime()) {
      return NextResponse.json({ error: 'That is the day it is already on.' }, { status: 400 })
    }

    const [source, destination] = await Promise.all([
      readEditableSession(from),
      readEditableSession(to),
    ])
    if (!source || !destination) {
      return NextResponse.json(
        { error: 'Load the week first — one of those days has no session yet.' },
        { status: 404 },
      )
    }
    for (const day of [source, destination]) {
      if (day.status === 'completed') {
        return NextResponse.json(
          { error: 'One of those days is already logged as complete — that is history, not a plan.' },
          { status: 409 },
        )
      }
    }

    const item = findSessionItem(source.blocks, itemId)
    if (!item) {
      return NextResponse.json({ error: 'That item is not on that day.' }, { status: 404 })
    }

    // The coach may move things too (§11-A), and the actor is what `edit_history`
    // records. Anything unrecognised is the athlete — never silently the engine,
    // which would make a hand-moved day look regenerable again.
    const actor: EditActor = body?.actor === 'coach' ? 'coach' : 'user'
    const reason =
      typeof body?.reason === 'string' && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : `Moved ${item.ref.name} to another day.`

    // One intent, two rows. `edit_history` has to be able to say so.
    const groupId = randomUUID()

    const { add, remove } = moveItemOps(
      item,
      destination.blocks,
      destinationBlockKind(item, source.blocks),
      reason,
    )

    // A push-back on a move is a judgement call like any other, so the "do it
    // anyway" the review panel offers has to reach the rails. The hard floors of
    // §15 still refuse it — that is the validator's job, not this route's.
    const landed = await applyPatchToSession(
      destination,
      { actor, ops: [add], ...(body?.override === true ? { override: true } : {}) },
      await editContextFor(to),
      { reason, groupId },
    )

    if (!landed.applied) {
      return NextResponse.json({
        applied: false,
        verdict: landed.verdict,
        blocks: landed.session.blocks,
        version: landed.version,
        diff: landed.diff,
        date: to.toISOString(),
        movedFrom: null,
        disclaimer: DISCLAIMER,
      })
    }

    // Taking work off a day never breaks a rail, but it still goes through the
    // funnel: the source day needs its own version bump and its own audit row,
    // or a regenerate would later decide it was never touched (§11).
    const lifted = await applyPatchToSession(
      source,
      { actor, ops: [remove], override: true },
      await editContextFor(from),
      { reason, groupId },
    )

    return NextResponse.json({
      applied: true,
      verdict: landed.verdict,
      blocks: landed.session.blocks,
      version: landed.version,
      diff: landed.diff,
      date: to.toISOString(),
      movedFrom: {
        date: from.toISOString(),
        applied: lifted.applied,
        version: lifted.version,
        blocks: lifted.session.blocks,
        verdict: lifted.verdict,
      },
      disclaimer: DISCLAIMER,
    })
  } catch (err) {
    console.error('[/api/session/move]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to move that session' }, { status: 500 })
  }
}
