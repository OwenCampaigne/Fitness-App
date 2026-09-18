import { NextRequest, NextResponse } from 'next/server'
import { addDays } from 'date-fns'
import { prisma } from '@/lib/db'
import {
  clearanceToSubmission,
  mergeClearanceIntoContext,
  parseClearanceSubmission,
  parseStoredContext,
} from '@/lib/clearance'
import type { ClearanceSubmission, StoredRecoveryContext } from '@/lib/clearance'
import { historyRowFor, stageForClearanceEntry } from '@/lib/rehabStage'
import {
  buildAnchorConfidenceMap,
  deriveIntakeStrengthAnchors,
  mergeEasyPaceAnchor,
  mergeStrengthAnchors,
  parseRunAnchorSubmission,
} from '@/lib/intakeAnchors'
import type { IntakeSetEntry, RunAnchorSubmission } from '@/lib/intakeAnchors'

// Error bodies stay generic on purpose: the client never needs the exception
// text, and echoing it back leaks schema and file paths into the browser.
function fail(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status })
}

function logError(scope: string, err: unknown) {
  console.error(`[${scope}]`, err instanceof Error ? err.message : String(err))
}

// ── GET — what the clearance form needs to render itself ──────────────────────
// Deliberately narrow. This returns only the recovery context, never the whole
// profile row, so the response cannot grow into an accidental data dump.
export async function GET() {
  try {
    const profile = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
    if (!profile) {
      return NextResponse.json({ exists: false, clearance: null, submission: null })
    }

    const context = parseStoredContext(profile.recoveryContextJson)
    return NextResponse.json({
      exists: true,
      surgicalLeg: context.surgicalLeg ?? null,
      clearance: context.clearance ?? null,
      longestRunSegmentMin: context.longestRunSegmentMin ?? null,
      submission: clearanceToSubmission(context),
    })
  } catch (err) {
    logError('/api/profile GET', err)
    return fail('Failed to load profile')
  }
}

// ── POST — full onboarding save ───────────────────────────────────────────────
// Creates or replaces the single athlete_profile row and opens the calibration
// window. Every anchor written here is `source: 'estimate'` (§3, §5a) — the
// calibration window is what upgrades it.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      age?: unknown
      sex?: unknown
      surgicalLeg?: unknown
      surgeryDateApprox?: unknown
      weeklyRunMinutes?: unknown
      longestRunSegmentMin?: unknown
      currentPainLevel?: unknown
      strengthSets?: IntakeSetEntry[]
      runAnchor?: RunAnchorSubmission
    }

    // ── Server-side validation ────────────────────────────────────────────────
    // The form validates too, but the form is not the boundary.
    const age = Number(body.age)
    if (!Number.isFinite(age) || age < 10 || age > 100) {
      return fail('Age must be between 10 and 100', 400)
    }

    const sex = body.sex === 'female' ? 'female' : body.sex === 'male' ? 'male' : null
    if (sex === null) return fail('Sex must be male or female', 400)

    const surgicalLeg =
      body.surgicalLeg === 'left' ? 'left' : body.surgicalLeg === 'right' ? 'right' : null
    if (surgicalLeg === null) return fail('Surgical leg must be left or right', 400)

    const surgeryDateApprox = String(body.surgeryDateApprox ?? '')
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(surgeryDateApprox)) {
      return fail('Surgery date must be YYYY-MM', 400)
    }

    const painLevel = ['none', 'sometimes', 'yes'].includes(String(body.currentPainLevel))
      ? String(body.currentPainLevel)
      : 'none'

    const weeklyRunMinutesRaw = Number(body.weeklyRunMinutes)
    const weeklyRunMinutes =
      Number.isFinite(weeklyRunMinutesRaw) && weeklyRunMinutesRaw >= 0
        ? Math.round(weeklyRunMinutesRaw)
        : 0

    // The ladder ceiling is a clinician's number. Blank stays blank — writing a
    // stand-in here would hand the run engine a clearance nobody gave.
    const segRaw = Number(body.longestRunSegmentMin)
    const longestRunSegmentMin =
      body.longestRunSegmentMin !== null &&
      body.longestRunSegmentMin !== undefined &&
      body.longestRunSegmentMin !== '' &&
      Number.isFinite(segRaw) &&
      segRaw >= 0 &&
      segRaw <= 180
        ? Math.round(segRaw)
        : null

    // ── Anchors from the intake (§5a) ─────────────────────────────────────────
    const strengthSets = Array.isArray(body.strengthSets) ? body.strengthSets : []
    const strength = deriveIntakeStrengthAnchors(strengthSets)
    if (!strength.ok) return fail('One of the reported working sets is out of range', 400)

    const run = parseRunAnchorSubmission(body.runAnchor)
    if (!run.ok) return fail('The recent race or easy pace could not be read', 400)

    const existing = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })

    // Onboarding never writes `clearance`; it is entered on the profile page from
    // a clinician's note. Whatever is already there is preserved untouched.
    const priorContext = parseStoredContext(existing?.recoveryContextJson)
    const recoveryContext: StoredRecoveryContext = {
      ...priorContext,
      surgicalLeg,
      surgeryDateApprox,
      weeklyRunMinutes,
    }
    if (longestRunSegmentMin !== null) recoveryContext.longestRunSegmentMin = longestRunSegmentMin
    else delete recoveryContext.longestRunSegmentMin

    const profileData = {
      age: Math.round(age),
      sex,
      injuryHistory: JSON.stringify(['ACL tear', 'MACI', 'HTO', `${surgicalLeg} knee`]),
      currentPainLevel: painLevel,
      recoveryContextJson: JSON.stringify(recoveryContext),
      plyoTier: 1,
      plyoTierSource: 'estimate',
      plyoTierConfidence: 'estimate',
      trainingPacesJson: JSON.stringify(
        mergeEasyPaceAnchor(existing?.trainingPacesJson ?? null, run.anchor),
      ),
      keyLiftLoadsJson: JSON.stringify(
        mergeStrengthAnchors(existing?.keyLiftLoadsJson ?? null, strength.anchors),
      ),
    }

    if (existing) {
      await prisma.athlete_profile.update({ where: { id: existing.id }, data: profileData })
    } else {
      await prisma.athlete_profile.create({ data: profileData })
    }

    // ── Calibration window (§5b) ──────────────────────────────────────────────
    const today = new Date()
    const existingDays = await prisma.readiness_daily.count()
    const calibrationDays = Math.max(7, 21 - existingDays)

    const calData = {
      startedOn: today,
      windowEnd: addDays(today, calibrationDays),
      recoveryBaselineReady: existingDays >= 14,
      graduated: existingDays >= 21,
      anchorConfidenceJson: JSON.stringify(
        buildAnchorConfidenceMap(strength.anchors, run.anchor),
      ),
    }

    const existingCal = await prisma.calibration_state.findFirst()
    if (existingCal) {
      await prisma.calibration_state.update({ where: { id: existingCal.id }, data: calData })
    } else {
      await prisma.calibration_state.create({ data: calData })
    }

    return NextResponse.json({
      ok: true,
      anchorsWritten: {
        strength: Object.keys(strength.anchors).length,
        easyPace: run.anchor !== null,
        source: 'estimate',
      },
    })
  } catch (err) {
    logError('/api/profile POST', err)
    return fail('Failed to save profile')
  }
}

// ── PUT — surgical clearance ──────────────────────────────────────────────────
// The one write in the app that must never fabricate. A partial submission is
// rejected rather than half-stored, and an empty one removes the record so the
// engines fall back to the posture they hold with nothing entered.
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as { clearance?: ClearanceSubmission | null }

    const parsed = parseClearanceSubmission(body?.clearance ?? null)
    if (!parsed.ok) {
      // Codes, not prose — the UI renders them through its own locale files.
      return NextResponse.json({ error: 'Invalid clearance', codes: parsed.errors }, { status: 400 })
    }

    const existing = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
    if (!existing) return fail('No profile found', 404)

    const context = mergeClearanceIntoContext(
      parseStoredContext(existing.recoveryContextJson),
      parsed,
    )

    // ── Stage + audit row (§15) ───────────────────────────────────────────────
    // A clinician's entry supersedes: saving this form replaces whatever the
    // athlete had reported about themselves, because the person who just
    // examined the knee outranks the person describing it. Clearing the form
    // drops the stage with it, back to `unknown`.
    const record = stageForClearanceEntry(
      context.clearance ?? null,
      context.longestRunSegmentMin ?? null,
    )
    if (record) context.rehabStage = record
    else delete context.rehabStage

    await prisma.$transaction([
      prisma.athlete_profile.update({
        where: { id: existing.id },
        data: { recoveryContextJson: JSON.stringify(context) },
      }),
      ...(record ? [prisma.clearance_history.create({ data: historyRowFor(record, context) })] : []),
    ])

    return NextResponse.json({
      ok: true,
      clearance: context.clearance ?? null,
      longestRunSegmentMin: context.longestRunSegmentMin ?? null,
      stage: record?.stage ?? 'unknown',
    })
  } catch (err) {
    logError('/api/profile PUT', err)
    return fail('Failed to save clearance')
  }
}

// ── PATCH — pain level only (the pain chip on the home screen) ────────────────
export async function PATCH(req: NextRequest) {
  try {
    const { currentPainLevel } = (await req.json()) as { currentPainLevel?: unknown }
    if (!['none', 'sometimes', 'yes'].includes(String(currentPainLevel))) {
      return fail('Invalid pain level', 400)
    }

    const existing = await prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } })
    if (!existing) return fail('No profile found', 404)

    await prisma.athlete_profile.update({
      where: { id: existing.id },
      data: { currentPainLevel: String(currentPainLevel) },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    logError('/api/profile PATCH', err)
    return fail('Failed to update pain level')
  }
}
