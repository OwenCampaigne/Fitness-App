// ── GET /api/session/today ────────────────────────────────────────────────────
// The Today screen's single call (framework §14). One answer, already allocated
// and persisted, with the budget it was built against and the reasons anything
// changed. Never calls Garmin — the nightly job fills the DB and this reads it (§4).

import { NextResponse } from 'next/server'
import { ensureToday } from '@/lib/todaySession'
import { groupSetsByItem } from '@/lib/todayView'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const today = await ensureToday()

    // §14 step 6 — what has already been logged today, so a reload shows the
    // sets that are in the database rather than an empty card. Same rows, same
    // grouping as `POST /api/session/log` returns, so the card has one path.
    const rows = today.session.id
      ? await prisma.set_logs.findMany({
          where: { sessionId: today.session.id },
          orderBy: { setNumber: 'asc' },
        })
      : []

    return NextResponse.json({
      session: {
        id: today.session.id ?? null,
        date: today.session.date?.toISOString() ?? null,
        version: today.session.version,
        status: today.session.status,
        sourceOfLastEdit: today.session.sourceOfLastEdit ?? null,
      },
      blocks: today.blocks,
      loggedSets: groupSetsByItem(rows, today.blocks),
      budget: today.budget,
      verdictFlags: today.verdictFlags,
      why: today.why,
      changedVsPlan: today.changedVsPlan,
      // §15 — returned unconditionally so the UI cannot render a prehab card
      // without the line that has to sit under it.
      disclaimer: today.disclaimer,
      readiness: {
        band: today.readiness.band,
        provisional: today.readiness.provisional,
        plainText: today.readiness.plainText,
        decidingSignals: today.readiness.decidingSignals,
        painFlagged: today.readiness.painFlagged,
      },
      decisions: today.allocation.decisions,
      scenarioMode: today.scenarioMode,
    })
  } catch (err) {
    console.error('[/api/session/today]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: "Unable to build today's session" }, { status: 500 })
  }
}
