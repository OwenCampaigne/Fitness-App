import { NextRequest, NextResponse } from 'next/server'
import { addDays } from 'date-fns'
import { prisma } from '@/lib/db'

// POST — full onboarding save (creates or replaces the single athlete_profile row)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      age: number
      sex: string
      surgicalLeg: 'left' | 'right'
      surgeryDateApprox: string    // 'YYYY-MM'
      weeklyRunMinutes: number
      longestRunSegmentMin: number
      currentPainLevel: 'none' | 'sometimes' | 'yes'
    }

    const {
      age, sex,
      surgicalLeg, surgeryDateApprox,
      weeklyRunMinutes, longestRunSegmentMin,
      currentPainLevel,
    } = body

    const injuryHistory = JSON.stringify([
      'ACL tear', 'MACI', 'HTO', `${surgicalLeg} knee`,
    ])
    const recoveryContextJson = JSON.stringify({
      surgicalLeg,
      surgeryDateApprox,
      weeklyRunMinutes,
      longestRunSegmentMin,
    })

    const profileData = {
      age,
      sex,
      injuryHistory,
      currentPainLevel,
      recoveryContextJson,
      plyoTier: 1,
      plyoTierSource: 'estimate',
      plyoTierConfidence: 'estimate',
      trainingPacesJson: JSON.stringify({
        easy: { value: null, source: 'unknown', confidence: 'estimate' },
      }),
      keyLiftLoadsJson: JSON.stringify({}),
    }

    const existing = await prisma.athlete_profile.findFirst()
    if (existing) {
      await prisma.athlete_profile.update({ where: { id: existing.id }, data: profileData })
    } else {
      await prisma.athlete_profile.create({ data: profileData })
    }

    // Initialize calibration_state
    const today = new Date()
    const existingDays = await prisma.readiness_daily.count()
    const calibrationDays = Math.max(7, 21 - existingDays)
    const windowEnd = addDays(today, calibrationDays)

    const calData = {
      startedOn: today,
      windowEnd,
      recoveryBaselineReady: existingDays >= 14,
      graduated: existingDays >= 21,
    }

    const existingCal = await prisma.calibration_state.findFirst()
    if (existingCal) {
      await prisma.calibration_state.update({ where: { id: existingCal.id }, data: calData })
    } else {
      await prisma.calibration_state.create({ data: calData })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// PATCH — update pain level only (used by pain chip modal on home screen)
export async function PATCH(req: NextRequest) {
  try {
    const { currentPainLevel } = await req.json() as { currentPainLevel: string }
    const existing = await prisma.athlete_profile.findFirst()
    if (!existing) {
      return NextResponse.json({ error: 'No profile found' }, { status: 404 })
    }
    await prisma.athlete_profile.update({
      where: { id: existing.id },
      data: { currentPainLevel },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
