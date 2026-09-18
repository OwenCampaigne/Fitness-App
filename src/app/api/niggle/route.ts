// ── /api/niggle ───────────────────────────────────────────────────────────────
// The niggle tracker (framework §9): "left Achilles, 3/10" goes in, a targeted
// protocol and an escalation verdict come out. This is the most medical-adjacent
// surface in the app, so two rules hold without exception:
//
//   · every response carries the §15 disclaimer, so the UI cannot render one of
//     these screens without the line that has to sit under it
//   · the app never names a condition — it describes a region and a protocol,
//     and `containsDiagnosisLanguage` in the engine is the executable form of
//     that promise

import { NextRequest, NextResponse } from 'next/server'
import { computeReadiness } from '@/lib/readiness'
import { getScenario } from '@/lib/scenario'
import { getMovementScenario } from '@/lib/movementScenario'
import { DISCLAIMER, assessNiggles, prescribePrehab } from '@/lib/prehabEngine'
import {
  BODY_REGIONS,
  NIGGLE_QUALITIES,
  NIGGLE_SIDES,
  episodeKey,
  loadNiggleRecords,
  logNiggle,
} from '@/lib/movementSession'
import type { BodyRegion, NiggleQuality, NiggleRecord, NiggleSide } from '@/types/movement'

export const dynamic = 'force-dynamic'

/** Day-of-year rotates the routine dose so the same three do not land daily (§9). */
function dayIndex(today: Date): number {
  return Math.floor(
    (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86_400_000,
  )
}

/**
 * The newest row id per episode.
 *
 * `NiggleAssessment` is about a tissue over time and deliberately carries no row
 * id — but the resolve endpoint needs one, so the mapping is handed over
 * alongside rather than smuggled into the engine's type.
 */
function episodeIds(records: NiggleRecord[]): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const record of records) {
    const key = episodeKey(record.bodyRegion, record.side)
    const existing = out[key]
    if (existing === undefined || (record.id !== undefined && record.id > (existing ?? 0))) {
      out[key] = record.id ?? null
    }
  }
  return out
}

export async function GET() {
  try {
    const today = new Date()
    const records = await loadNiggleRecords(today)
    const niggles = assessNiggles(records, today)

    return NextResponse.json({
      niggles,
      // Additive: what the resolve endpoint needs, keyed by region|side.
      episodeIds: episodeIds(records.filter((r) => r.status !== 'resolved')),
      disclaimer: DISCLAIMER,
      scenarioMode: getMovementScenario() ? process.env.MOVEMENT_SCENARIO : null,
    })
  } catch (err) {
    console.error('[/api/niggle GET]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to read the niggle log' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'A JSON object body is required.' }, { status: 400 })
    }

    const bodyRegion = body.bodyRegion
    if (typeof bodyRegion !== 'string' || !BODY_REGIONS.includes(bodyRegion as BodyRegion)) {
      return NextResponse.json(
        { error: `bodyRegion must be one of: ${BODY_REGIONS.join(', ')}.` },
        { status: 400 },
      )
    }

    let side: NiggleSide | null = null
    if (body.side !== undefined && body.side !== null) {
      if (typeof body.side !== 'string' || !NIGGLE_SIDES.includes(body.side as NiggleSide)) {
        return NextResponse.json(
          { error: `side must be one of: ${NIGGLE_SIDES.join(', ')}.` },
          { status: 400 },
        )
      }
      side = body.side as NiggleSide
    }

    const severity = body.severity
    if (
      typeof severity !== 'number' ||
      !Number.isFinite(severity) ||
      severity < 0 ||
      severity > 10
    ) {
      return NextResponse.json(
        { error: 'severity must be a number between 0 and 10.' },
        { status: 400 },
      )
    }

    let quality: NiggleQuality | null = null
    if (body.quality !== undefined && body.quality !== null) {
      if (
        typeof body.quality !== 'string' ||
        !NIGGLE_QUALITIES.includes(body.quality as NiggleQuality)
      ) {
        return NextResponse.json(
          { error: `quality must be one of: ${NIGGLE_QUALITIES.join(', ')}.` },
          { status: 400 },
        )
      }
      quality = body.quality as NiggleQuality
    }

    const notes =
      typeof body.notes === 'string' && body.notes.trim().length > 0
        ? body.notes.trim().slice(0, 500)
        : null

    const today = new Date()
    const scenario = getMovementScenario()
    const region = bodyRegion as BodyRegion

    // Scenario mode assesses the report without persisting it, so the whole
    // flow — including the escalation paths, which are rare and slow in real
    // life — is demonstrable against a preset (§16).
    let records: NiggleRecord[]
    if (scenario) {
      const existing = scenario.niggles.filter(
        (n) => n.bodyRegion === region && n.side === side && n.status !== 'resolved',
      )
      const firstReportedOn = existing.reduce<Date>(
        (min, n) => (n.firstReportedOn < min ? n.firstReportedOn : min),
        today,
      )
      records = [
        ...scenario.niggles,
        {
          date: today,
          bodyRegion: region,
          side,
          severity: Math.round(severity),
          quality,
          notes,
          status: 'active',
          firstReportedOn,
        },
      ]
    } else {
      await logNiggle({ bodyRegion: region, side, severity, quality, notes, date: today })
      records = await loadNiggleRecords(today)
    }

    const assessments = assessNiggles(records, today)
    const assessment =
      assessments.find((a) => a.bodyRegion === region && a.side === side) ?? null

    const readiness = getScenario() ?? (await computeReadiness())

    const prescribed = prescribePrehab({
      assessments,
      band: readiness.band,
      painFlagged: readiness.painFlagged || severity >= 4,
      dayIndex: dayIndex(today),
    })

    return NextResponse.json({
      ok: true,
      persisted: scenario === null,
      assessment,
      prescribed,
      escalation: assessment
        ? {
            level: assessment.level,
            prescribeIntoRegion: assessment.prescribeIntoRegion,
            reason: assessment.reason,
            flag: assessment.flag,
          }
        : null,
      disclaimer: DISCLAIMER,
    })
  } catch (err) {
    console.error('[/api/niggle POST]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to log that' }, { status: 500 })
  }
}
