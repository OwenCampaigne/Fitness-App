// ── Rehab stage API (§11 preview → confirm, §15 safety) ──────────────────────
// One funnel for every stage change that does not come from the clearance form:
// a sentence goes in, a *proposal* comes back, and nothing moves until a second
// request confirms it. Both the chat coach and the profile card use this route,
// so there is exactly one place where free text can change what the engines
// prescribe — and it is a place that refuses to act on one round-trip.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { parseStoredContext } from '@/lib/clearance'
import {
  applyClearanceUpdate,
  currentStage,
  proposeClearanceUpdate,
  readStageRecord,
  stagePermits,
} from '@/lib/rehabStage'
import type { ClearanceProposal } from '@/lib/rehabStage'

export const dynamic = 'force-dynamic'

function fail(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status })
}

// ── GET — the progression view ───────────────────────────────────────────────
export async function GET() {
  try {
    const profile = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
    const context = parseStoredContext(profile?.recoveryContextJson)

    const history = await prisma.clearance_history.findMany({
      orderBy: [{ recordedOn: 'desc' }, { id: 'desc' }],
      take: 50,
    })

    return NextResponse.json({
      exists: Boolean(profile),
      stage: currentStage(context),
      record: readStageRecord(context),
      permits: stagePermits(context),
      history: history.map((h) => ({
        id: h.id,
        recordedOn: h.recordedOn.toISOString().slice(0, 10),
        stage: h.stage,
        setBy: h.setBy,
        sourceQuote: h.sourceQuote,
        notes: h.notes,
      })),
    })
  } catch (err) {
    console.error('[/api/clearance/stage GET]', err instanceof Error ? err.message : String(err))
    return fail('Failed to load rehab stage')
  }
}

// ── POST — propose, then confirm ─────────────────────────────────────────────
/**
 * `{ text }` previews. `{ text, confirm: true }` applies.
 *
 * The confirm branch re-derives the proposal from the text server-side rather
 * than trusting the one it is handed. A preview is not a token (CLAUDE.md rule
 * 2): the profile may have moved since, and a client that posts
 * `{ to: 'unrestricted' }` must get the same answer as one that posts nothing at
 * all. The only input this route takes from the caller is the sentence.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      text?: unknown
      confirm?: unknown
      /** Accepted for shape-compatibility; only its `sourceQuote` is read. */
      proposal?: Partial<ClearanceProposal>
    }

    const text =
      typeof body.text === 'string'
        ? body.text
        : typeof body.proposal?.sourceQuote === 'string'
          ? body.proposal.sourceQuote
          : ''
    if (text.trim() === '') return fail('No statement to read', 400)
    if (text.length > 2000) return fail('Statement too long', 400)

    const profile = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
    if (!profile) return fail('No profile found', 404)

    const context = parseStoredContext(profile.recoveryContextJson)
    const proposal = proposeClearanceUpdate(text, context)

    if (!proposal) {
      return NextResponse.json({ proposal: null, applied: false })
    }

    if (body.confirm !== true) {
      return NextResponse.json({ proposal, applied: false })
    }

    if (!proposal.applicable) {
      return NextResponse.json({ proposal, applied: false, error: proposal.blockedReason }, { status: 409 })
    }

    // The client's idea of the target is never used — only the one just derived
    // from the athlete's own words against the current profile.
    if (body.proposal?.to && body.proposal.to !== proposal.to) {
      return NextResponse.json(
        { proposal, applied: false, error: 'The proposal changed — review it again.' },
        { status: 409 },
      )
    }

    const applied = applyClearanceUpdate(proposal, 'athlete', context)

    await prisma.$transaction([
      prisma.athlete_profile.update({
        where: { id: profile.id },
        data: { recoveryContextJson: JSON.stringify(applied.context) },
      }),
      prisma.clearance_history.create({ data: applied.history }),
    ])

    return NextResponse.json({
      proposal,
      applied: true,
      stage: currentStage(applied.context),
      permits: stagePermits(applied.context),
    })
  } catch (err) {
    console.error('[/api/clearance/stage POST]', err instanceof Error ? err.message : String(err))
    return fail('Failed to update rehab stage')
  }
}
