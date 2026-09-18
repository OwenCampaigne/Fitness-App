// ── POST /api/session/log ─────────────────────────────────────────────────────
// Quick log (framework §14 step 6). One endpoint for every kind of item because
// there is one Session and one `set_logs` table: weights and reps for a lift,
// ground contacts for a plyo, holds for prehab and stretching (§3).

import { NextRequest, NextResponse } from 'next/server'
import { startOfDay } from 'date-fns'
import {
  findSessionItem,
  findSessionRow,
  logSessionSet,
  markSessionActive,
  parseBlocks,
} from '@/lib/sessionStore'
import { DISCLAIMER } from '@/lib/prehabEngine'
import type { ItemKind } from '@/types/session'

export const dynamic = 'force-dynamic'

const LOGGABLE_KINDS: ItemKind[] = ['exercise', 'plyo', 'prehab', 'stretch']

/** A bounded number, or a message saying which field is wrong. */
function optionalNumber(
  value: unknown,
  field: string,
  min: number,
  max: number,
): { value: number | null; error: string | null } {
  if (value === undefined || value === null) return { value: null, error: null }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return { value: null, error: `${field} must be a number between ${min} and ${max}.` }
  }
  return { value, error: null }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'A JSON object body is required.' }, { status: 400 })
    }

    const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : ''
    if (!itemId || itemId.length > 120) {
      return NextResponse.json({ error: 'itemId is required.' }, { status: 400 })
    }

    const setNumber = body.setNumber
    if (
      typeof setNumber !== 'number' ||
      !Number.isInteger(setNumber) ||
      setNumber < 1 ||
      setNumber > 50
    ) {
      return NextResponse.json(
        { error: 'setNumber must be a whole number between 1 and 50.' },
        { status: 400 },
      )
    }

    const numbers = {
      weightKg: optionalNumber(body.weightKg, 'weightKg', 0, 500),
      reps: optionalNumber(body.reps, 'reps', 0, 200),
      rir: optionalNumber(body.rir, 'rir', 0, 10),
      contacts: optionalNumber(body.contacts, 'contacts', 0, 500),
      holdSec: optionalNumber(body.holdSec, 'holdSec', 0, 600),
    }
    for (const parsed of Object.values(numbers)) {
      if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const notes =
      typeof body.notes === 'string' && body.notes.trim().length > 0
        ? body.notes.trim().slice(0, 500)
        : null

    const row = await findSessionRow(startOfDay(new Date()))
    if (!row) {
      return NextResponse.json(
        { error: "No session for today yet — load /api/session/today first." },
        { status: 404 },
      )
    }

    const item = findSessionItem(parseBlocks(row.blocksJson), itemId)
    if (!item) {
      return NextResponse.json(
        { error: 'No item with that id in today’s session.' },
        { status: 404 },
      )
    }

    // `itemKind` in the body is a cross-check, not the source of truth — the
    // session says what an item is, and a mismatch means the client is looking
    // at a session that has since been edited.
    if (typeof body.itemKind === 'string' && body.itemKind !== item.ref.kind) {
      return NextResponse.json(
        {
          error: `That item is a ${item.ref.kind}, not a ${body.itemKind} — reload today’s session.`,
        },
        { status: 409 },
      )
    }

    if (!LOGGABLE_KINDS.includes(item.ref.kind)) {
      return NextResponse.json(
        { error: 'Runs are logged by completing the session, not set by set.' },
        { status: 400 },
      )
    }

    const logged = await logSessionSet(row.id, item, {
      setNumber,
      weightKg: numbers.weightKg.value,
      reps: numbers.reps.value,
      rir: numbers.rir.value,
      contacts: numbers.contacts.value,
      holdSec: numbers.holdSec.value,
      notes,
    })

    await markSessionActive(row.id, row.status)

    return NextResponse.json({
      ok: true,
      // The persisted `set_logs` row.
      item: logged.row,
      // Everything logged against this card so far, and the card itself.
      sets: logged.sets,
      sessionItem: item,
      ...(item.ref.kind === 'prehab' ? { disclaimer: DISCLAIMER } : {}),
    })
  } catch (err) {
    console.error('[/api/session/log]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to log that set' }, { status: 500 })
  }
}
