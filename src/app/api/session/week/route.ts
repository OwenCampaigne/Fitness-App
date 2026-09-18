// ── GET /api/session/week ─────────────────────────────────────────────────────
// The week view's single call — §10 step 5's "updated skeleton", persisted.
// Seven days, each already a real `session` row, so what you see here is the
// same object the Today screen will hand you on the morning and the same object
// an edit patches. There is no separate "plan" representation to drift.
//
// Like `/today` it never calls Garmin: the nightly job fills the DB and this
// reads it (§4).

import { NextResponse } from 'next/server'
import { ensureWeek } from '@/lib/weekPlan'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const week = await ensureWeek()

    return NextResponse.json({
      start: week.start.toISOString(),
      days: week.days.map((day) => ({
        date: day.date.toISOString(),
        isToday: day.isToday,
        edited: day.edited,
        session: {
          id: day.session.id ?? null,
          version: day.session.version,
          status: day.session.status,
          sourceOfLastEdit: day.session.sourceOfLastEdit ?? null,
        },
        blocks: day.blocks,
        summary: day.summary,
        priority: day.priority,
        why: day.why,
        ceiling: Math.round(day.budget.ceiling),
        verdictFlags: day.verdictFlags,
        changedVsPlan: day.changedVsPlan,
      })),
      totals: week.totals,
      // §15 — the week carries prehab cards too, so it carries the line.
      disclaimer: week.disclaimer,
      band: week.band,
      scenarioMode: week.scenarioMode,
    })
  } catch (err) {
    console.error('[/api/session/week]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to build the week' }, { status: 500 })
  }
}
