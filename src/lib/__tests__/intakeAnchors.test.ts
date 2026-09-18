import {
  EASY_PACE_FACTOR_FROM_10K,
  INTAKE_LIFT_IDS,
  INTAKE_LOAD_HAIRCUT,
  buildAnchorConfidenceMap,
  deriveEasyPaceFromRace,
  deriveEasyPaceFromSelfReport,
  deriveIntakeStrengthAnchors,
  deriveIntakeWorkingLoadAnchor,
  formatPace,
  isEmptySetEntry,
  mergeEasyPaceAnchor,
  mergeStrengthAnchors,
  parseDurationToSeconds,
  parsePaceToSecPerKm,
  parseRunAnchorSubmission,
  riegelEquivalentSec,
} from '../intakeAnchors'
import { KEY_LIFTS_BY_ID } from '../keyLifts'
import { resolveTarget } from '../runEngine'

const RDL = KEY_LIFTS_BY_ID['romanian-deadlift']
const NORDIC = KEY_LIFTS_BY_ID['nordic-curl'] // bodyweight

// ── Parsing ──────────────────────────────────────────────────────────────────

describe('duration parsing', () => {
  test('mm:ss', () => {
    expect(parseDurationToSeconds('22:30')).toBe(1350)
  })

  test('h:mm:ss', () => {
    expect(parseDurationToSeconds('1:45:10')).toBe(6310)
  })

  test('a bare number is rejected rather than guessed at', () => {
    expect(parseDurationToSeconds('1350')).toBeNull()
    expect(parseDurationToSeconds('22')).toBeNull()
  })

  test('out-of-range minutes and seconds are rejected', () => {
    expect(parseDurationToSeconds('22:75')).toBeNull()
    expect(parseDurationToSeconds('1:99:00')).toBeNull()
  })

  test('junk and empties are null, never NaN', () => {
    expect(parseDurationToSeconds('')).toBeNull()
    expect(parseDurationToSeconds('abc')).toBeNull()
    expect(parseDurationToSeconds(null)).toBeNull()
    expect(parseDurationToSeconds('0:00')).toBeNull()
  })

  test('pace parsing rejects implausible paces', () => {
    expect(parsePaceToSecPerKm('5:30')).toBe(330)
    expect(parsePaceToSecPerKm('1:00')).toBeNull()
    expect(parsePaceToSecPerKm('25:00')).toBeNull()
  })

  test('formatPace round trips', () => {
    expect(formatPace(330)).toBe('5:30')
    expect(formatPace(305)).toBe('5:05')
  })
})

// ── Race equivalency ─────────────────────────────────────────────────────────

describe('riegel', () => {
  test('a longer target is slower per km', () => {
    const tenK = riegelEquivalentSec(5, 1200, 10) as number
    expect(tenK / 10).toBeGreaterThan(1200 / 5)
  })

  test('the identity case returns the same time', () => {
    expect(riegelEquivalentSec(10, 2400, 10)).toBeCloseTo(2400, 6)
  })

  test('nonsense input is null', () => {
    expect(riegelEquivalentSec(0, 2400, 10)).toBeNull()
    expect(riegelEquivalentSec(10, 0, 10)).toBeNull()
  })
})

// ── Pace anchors ─────────────────────────────────────────────────────────────

describe('easy pace anchors', () => {
  test('a race-derived easy pace is an estimate, never observed', () => {
    const a = deriveEasyPaceFromRace({ distanceKm: 10, timeSec: 2400 })
    expect(a?.source).toBe('estimate')
    expect(a?.confidence).toBeLessThan(0.5)
  })

  test('easy pace is the equivalent 10 km pace slowed by the easy factor', () => {
    const a = deriveEasyPaceFromRace({ distanceKm: 10, timeSec: 2400 })
    expect(a?.value).toBe(Math.round(240 * EASY_PACE_FACTOR_FROM_10K))
  })

  test('easy pace is slower than race pace', () => {
    const a = deriveEasyPaceFromRace({ distanceKm: 5, timeSec: 1200 })
    expect(a!.value as number).toBeGreaterThan(240)
  })

  test('a self-reported pace is an estimate with lower confidence than a race', () => {
    const self = deriveEasyPaceFromSelfReport(360)
    const race = deriveEasyPaceFromRace({ distanceKm: 10, timeSec: 2400 })
    expect(self?.source).toBe('estimate')
    expect(self!.confidence).toBeLessThan(race!.confidence)
  })

  test('an implausible self-reported pace writes nothing', () => {
    expect(deriveEasyPaceFromSelfReport(30)).toBeNull()
    expect(deriveEasyPaceFromSelfReport(null)).toBeNull()
  })

  test('an estimate anchor cannot become a pace target in the run engine', () => {
    const anchor = deriveEasyPaceFromRace({ distanceKm: 10, timeSec: 2400 })!
    const target = resolveTarget('easy', anchor, { z2Ceiling: 150, lthr: 170, maxHr: 190 }, true)
    expect(target.kind).toBe('heart_rate')
    expect(target.paceSecPerKm).toBeNull()
  })
})

// ── Run-anchor submission ────────────────────────────────────────────────────

describe('run anchor submission', () => {
  test('skipping writes no anchor and is not an error', () => {
    expect(parseRunAnchorSubmission({ kind: 'skip' })).toEqual({ ok: true, errors: [], anchor: null })
    expect(parseRunAnchorSubmission(null)).toEqual({ ok: true, errors: [], anchor: null })
  })

  test('a race needs a distance and a readable time', () => {
    const r = parseRunAnchorSubmission({ kind: 'race', raceDistance: '', raceTime: '' })
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual(
      expect.arrayContaining(['race_distance_required', 'race_time_required']),
    )
  })

  test('an unreadable race time is reported, not silently dropped', () => {
    const r = parseRunAnchorSubmission({ kind: 'race', raceDistance: '10k', raceTime: '40 minutes' })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('race_time_invalid')
  })

  test('a half marathon produces an estimate anchor', () => {
    const r = parseRunAnchorSubmission({ kind: 'race', raceDistance: 'half', raceTime: '1:45:00' })
    expect(r.ok).toBe(true)
    expect(r.anchor?.source).toBe('estimate')
    expect(r.anchor?.value).toBeGreaterThan(0)
  })

  test('a self-reported easy pace produces an estimate anchor', () => {
    const r = parseRunAnchorSubmission({ kind: 'easy', easyPace: '6:15' })
    expect(r.ok).toBe(true)
    expect(r.anchor?.value).toBe(375)
    expect(r.anchor?.source).toBe('estimate')
  })

  test('a blank easy pace is an error once that mode is chosen', () => {
    expect(parseRunAnchorSubmission({ kind: 'easy', easyPace: '' }).errors).toContain(
      'easy_pace_required',
    )
  })
})

// ── Strength anchors ─────────────────────────────────────────────────────────

describe('intake working-load anchors', () => {
  test('a blank row is a skip, not an error, and writes nothing', () => {
    expect(isEmptySetEntry({ liftId: 'romanian-deadlift' })).toBe(true)
    const r = deriveIntakeWorkingLoadAnchor({ liftId: 'romanian-deadlift' }, RDL)
    expect(r.ok).toBe(true)
    expect(r.anchor).toBeNull()
  })

  test('a reported set is always source estimate, never observed', () => {
    const r = deriveIntakeWorkingLoadAnchor(
      { liftId: 'romanian-deadlift', weightKg: '60', reps: '8', rir: '2' },
      RDL,
    )
    expect(r.anchor?.source).toBe('estimate')
    expect(r.anchor?.sessions).toBe(0)
    expect(r.anchor?.confidence).toBeLessThanOrEqual(0.3)
  })

  test('the starting load is under what was reported', () => {
    const r = deriveIntakeWorkingLoadAnchor(
      { liftId: 'romanian-deadlift', weightKg: '60', reps: '8', rir: '2' },
      RDL,
    )
    expect(r.anchor!.reportedKg).toBe(60)
    expect(r.anchor!.value as number).toBeLessThan(60)
    expect(r.anchor!.value as number).toBeLessThanOrEqual(60 * INTAKE_LOAD_HAIRCUT)
  })

  test('the starting load lands on a loadable step', () => {
    const r = deriveIntakeWorkingLoadAnchor(
      { liftId: 'romanian-deadlift', weightKg: '62.5', reps: '8', rir: '2' },
      RDL,
    )
    const step = RDL.microStepKg ?? 2.5
    expect((r.anchor!.value as number) % step).toBeCloseTo(0, 6)
  })

  test('a very light reported load never floors to zero, nor rounds up past itself', () => {
    const r = deriveIntakeWorkingLoadAnchor(
      { liftId: 'romanian-deadlift', weightKg: '2', reps: '8', rir: '2' },
      RDL,
    )
    expect(r.anchor!.value as number).toBeGreaterThan(0)
    expect(r.anchor!.value as number).toBeLessThanOrEqual(2)
  })

  test('the starting load never exceeds the reported load, at any weight', () => {
    for (const kg of [1, 2, 5, 12.5, 40, 60, 102.5, 200]) {
      const r = deriveIntakeWorkingLoadAnchor(
        { liftId: 'romanian-deadlift', weightKg: String(kg), reps: '8', rir: '2' },
        RDL,
      )
      expect(r.anchor!.value as number).toBeLessThanOrEqual(kg)
    }
  })

  test('an e1RM is recorded alongside, from a submaximal set only', () => {
    const r = deriveIntakeWorkingLoadAnchor(
      { liftId: 'romanian-deadlift', weightKg: '60', reps: '8', rir: '2' },
      RDL,
    )
    expect(r.anchor!.e1rmKg).toBeGreaterThan(60)
  })

  test('a bodyweight lift anchors on reps with no load', () => {
    const r = deriveIntakeWorkingLoadAnchor(
      { liftId: 'nordic-curl', weightKg: '', reps: '6', rir: '1' },
      NORDIC,
    )
    expect(r.anchor!.value).toBeNull()
    expect(r.anchor!.reportedKg).toBeNull()
    expect(r.anchor!.reportedReps).toBe(6)
  })

  test('a blank RIR is read as zero, the conservative reading', () => {
    const r = deriveIntakeWorkingLoadAnchor(
      { liftId: 'romanian-deadlift', weightKg: '60', reps: '8', rir: '' },
      RDL,
    )
    expect(r.anchor!.reportedRir).toBe(0)
  })

  test('a weight with no reps is an error, not a half-anchor', () => {
    const r = deriveIntakeWorkingLoadAnchor(
      { liftId: 'romanian-deadlift', weightKg: '60', reps: '', rir: '' },
      RDL,
    )
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('reps_required')
    expect(r.anchor).toBeNull()
  })

  test('out-of-range reps, RIR and weight are reported', () => {
    expect(
      deriveIntakeWorkingLoadAnchor({ liftId: 'romanian-deadlift', reps: '99' }, RDL).errors,
    ).toContain('reps_range')
    expect(
      deriveIntakeWorkingLoadAnchor({ liftId: 'romanian-deadlift', reps: '8', rir: '99' }, RDL)
        .errors,
    ).toContain('rir_range')
    expect(
      deriveIntakeWorkingLoadAnchor(
        { liftId: 'romanian-deadlift', weightKg: '9000', reps: '8' },
        RDL,
      ).errors,
    ).toContain('weight_range')
  })

  test('high effective reps carry less confidence than low', () => {
    const low = deriveIntakeWorkingLoadAnchor(
      { liftId: 'romanian-deadlift', weightKg: '60', reps: '5', rir: '2' },
      RDL,
    )
    const high = deriveIntakeWorkingLoadAnchor(
      { liftId: 'romanian-deadlift', weightKg: '40', reps: '20', rir: '3' },
      RDL,
    )
    expect(high.anchor!.confidence).toBeLessThan(low.anchor!.confidence)
  })
})

describe('the intake lift set', () => {
  test('every id the intake asks about is a real key lift', () => {
    for (const id of INTAKE_LIFT_IDS) {
      expect(KEY_LIFTS_BY_ID[id]).toBeDefined()
    }
  })

  test('an unknown lift id is dropped rather than guessed at', () => {
    const r = deriveIntakeStrengthAnchors([{ liftId: 'not-a-lift', weightKg: '60', reps: '8' }])
    expect(r.ok).toBe(true)
    expect(r.anchors).toEqual({})
  })

  test('skipped rows write nothing while filled rows write anchors', () => {
    const r = deriveIntakeStrengthAnchors([
      { liftId: 'romanian-deadlift', weightKg: '60', reps: '8', rir: '2' },
      { liftId: 'split-squat' },
      { liftId: 'standing-calf-raise' },
    ])
    expect(r.ok).toBe(true)
    expect(Object.keys(r.anchors)).toEqual(['romanian-deadlift'])
  })

  test('one bad row fails the batch and names the lift', () => {
    const r = deriveIntakeStrengthAnchors([
      { liftId: 'romanian-deadlift', weightKg: '60', reps: '8', rir: '2' },
      { liftId: 'split-squat', weightKg: '20', reps: '' },
    ])
    expect(r.ok).toBe(false)
    expect(r.errors['split-squat']).toContain('reps_required')
  })
})

// ── Merging into the stored anchor blobs ─────────────────────────────────────

describe('merging anchors', () => {
  test('an intake estimate never overwrites a logged observed anchor', () => {
    const existing = JSON.stringify({
      'romanian-deadlift': { value: 80, source: 'observed', confidence: 0.6, sessions: 4 },
    })
    const r = deriveIntakeStrengthAnchors([
      { liftId: 'romanian-deadlift', weightKg: '60', reps: '8', rir: '2' },
    ])
    const merged = mergeStrengthAnchors(existing, r.anchors)
    expect(merged['romanian-deadlift'].value).toBe(80)
    expect(merged['romanian-deadlift'].source).toBe('observed')
  })

  test('an intake estimate does replace an earlier estimate', () => {
    const existing = JSON.stringify({
      'romanian-deadlift': { value: 40, source: 'estimate', confidence: 0.2, sessions: 0 },
    })
    const r = deriveIntakeStrengthAnchors([
      { liftId: 'romanian-deadlift', weightKg: '60', reps: '8', rir: '2' },
    ])
    const merged = mergeStrengthAnchors(existing, r.anchors)
    expect(merged['romanian-deadlift'].value).toBe(52.5)
  })

  test('other lifts already stored are left alone', () => {
    const existing = JSON.stringify({
      'split-squat': { value: 20, source: 'confirmed', confidence: 0.85, sessions: 6 },
    })
    const merged = mergeStrengthAnchors(
      existing,
      deriveIntakeStrengthAnchors([
        { liftId: 'romanian-deadlift', weightKg: '60', reps: '8', rir: '2' },
      ]).anchors,
    )
    expect(Object.keys(merged).sort()).toEqual(['romanian-deadlift', 'split-squat'])
  })

  test('malformed stored JSON does not take the save down', () => {
    expect(mergeStrengthAnchors('{broken', {})).toEqual({})
    expect(mergeEasyPaceAnchor('{broken', null)).toEqual({})
  })

  test('a skipped run anchor leaves trainingPaces untouched', () => {
    const existing = JSON.stringify({ easy: { value: 300, source: 'observed', confidence: 0.55 } })
    expect(mergeEasyPaceAnchor(existing, null)).toEqual({
      easy: { value: 300, source: 'observed', confidence: 0.55 },
    })
  })

  test('an intake pace never displaces an observed pace', () => {
    const existing = JSON.stringify({ easy: { value: 300, source: 'observed', confidence: 0.55 } })
    const anchor = deriveEasyPaceFromSelfReport(400)
    expect(mergeEasyPaceAnchor(existing, anchor).easy!.value).toBe(300)
  })

  test('an intake pace fills an empty slot', () => {
    const anchor = deriveEasyPaceFromSelfReport(400)
    const merged = mergeEasyPaceAnchor(null, anchor)
    expect(merged.easy!.value).toBe(400)
    expect(merged.easy!.source).toBe('estimate')
  })

  test('it replaces the null estimate the old onboarding wrote', () => {
    const existing = JSON.stringify({ easy: { value: null, source: 'unknown', confidence: 'estimate' } })
    const merged = mergeEasyPaceAnchor(existing, deriveEasyPaceFromSelfReport(400))
    expect(merged.easy!.value).toBe(400)
  })
})

describe('anchor confidence map', () => {
  test('every written anchor is recorded with its source and confidence', () => {
    const strength = deriveIntakeStrengthAnchors([
      { liftId: 'romanian-deadlift', weightKg: '60', reps: '8', rir: '2' },
    ]).anchors
    const pace = deriveEasyPaceFromSelfReport(400)
    const map = buildAnchorConfidenceMap(strength, pace)
    expect(map['keyLift.romanian-deadlift'].source).toBe('estimate')
    expect(map['pace.easy'].source).toBe('estimate')
  })

  test('nothing entered means nothing recorded', () => {
    expect(buildAnchorConfidenceMap({}, null)).toEqual({})
  })
})
