import {
  DEEP_FLEXION_THRESHOLD_DEG,
  clearanceAgeMonths,
  clearanceConsequences,
  clearanceToSubmission,
  isEmptyClearanceSubmission,
  mergeClearanceIntoContext,
  parseClearanceSubmission,
  parseStoredContext,
  toIsoDate,
} from '../clearance'
import type { ClearanceSubmission, StoredRecoveryContext } from '../clearance'
import { filterContraindicated } from '../strengthEngine'
import { highestRungWithinCeiling } from '../runEngine'
import { KEY_LIFTS } from '../keyLifts'

const NOW = new Date('2026-09-14T12:00:00Z')

function full(over: Partial<ClearanceSubmission> = {}): ClearanceSubmission {
  return {
    maxKneeFlexionDeg: '125',
    openChainCleared: true,
    impactCleared: true,
    pivotCleared: true,
    longestRunSegmentMin: '8',
    surgeryDateApprox: '2025-03',
    clearedOn: '2026-09-01',
    ...over,
  }
}

// ── Emptiness is a valid, safe answer ────────────────────────────────────────

describe('empty submissions', () => {
  test('null is empty', () => {
    expect(isEmptyClearanceSubmission(null)).toBe(true)
  })

  test('blank strings and unanswered toggles are empty', () => {
    expect(
      isEmptyClearanceSubmission({
        maxKneeFlexionDeg: '',
        noFlexionLimit: false,
        openChainCleared: null,
        impactCleared: null,
        pivotCleared: null,
        longestRunSegmentMin: '',
        surgeryDateApprox: '',
        clearedOn: '',
        clearedBy: '',
        notes: '',
      }),
    ).toBe(true)
  })

  test('a single answered toggle makes it non-empty', () => {
    expect(isEmptyClearanceSubmission({ impactCleared: false })).toBe(false)
  })

  test('an empty form parses ok and stores nothing', () => {
    const r = parseClearanceSubmission(null, NOW)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.clearance).toBeNull()
    expect(r.longestRunSegmentMin).toBeNull()
  })
})

// ── Partial submissions are rejected, never half-stored ──────────────────────

describe('partial submissions', () => {
  test('a lone flexion number is not a clearance', () => {
    const r = parseClearanceSubmission({ maxKneeFlexionDeg: '110' }, NOW)
    expect(r.ok).toBe(false)
    expect(r.clearance).toBeNull()
    expect(r.errors).toEqual(
      expect.arrayContaining([
        'open_chain_required',
        'impact_required',
        'pivot_required',
        'run_segment_required',
        'surgery_date_required',
        'cleared_on_required',
      ]),
    )
  })

  test('a blank flexion field is required rather than read as unrestricted', () => {
    const r = parseClearanceSubmission(full({ maxKneeFlexionDeg: '' }), NOW)
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('flexion_required')
  })

  test('an explicit no-limit statement stores null flexion', () => {
    const r = parseClearanceSubmission(
      full({ maxKneeFlexionDeg: '', noFlexionLimit: true }),
      NOW,
    )
    expect(r.ok).toBe(true)
    expect(r.clearance?.maxKneeFlexionDeg).toBeNull()
  })

  test('flexion outside 0–160 is rejected', () => {
    expect(parseClearanceSubmission(full({ maxKneeFlexionDeg: '400' }), NOW).errors).toContain(
      'flexion_range',
    )
    expect(parseClearanceSubmission(full({ maxKneeFlexionDeg: '-5' }), NOW).errors).toContain(
      'flexion_range',
    )
  })
})

// ── Field-by-field validation ────────────────────────────────────────────────

describe('field validation', () => {
  test('zero is a valid run segment — cleared to lift, not to run', () => {
    const r = parseClearanceSubmission(full({ longestRunSegmentMin: '0' }), NOW)
    expect(r.ok).toBe(true)
    expect(r.longestRunSegmentMin).toBe(0)
  })

  test('a run segment over 180 minutes is rejected', () => {
    expect(parseClearanceSubmission(full({ longestRunSegmentMin: '400' }), NOW).errors).toContain(
      'run_segment_range',
    )
  })

  test('the surgery date must be YYYY-MM', () => {
    expect(parseClearanceSubmission(full({ surgeryDateApprox: 'March 2025' }), NOW).errors).toContain(
      'surgery_date_invalid',
    )
  })

  test('a YYYY-MM-DD surgery date is narrowed to the month', () => {
    const r = parseClearanceSubmission(full({ surgeryDateApprox: '2025-03-14' }), NOW)
    expect(r.ok).toBe(true)
    expect(r.surgeryDateApprox).toBe('2025-03')
  })

  test('the clearance date cannot be in the future', () => {
    expect(parseClearanceSubmission(full({ clearedOn: '2027-01-01' }), NOW).errors).toContain(
      'cleared_on_future',
    )
  })

  test('a nonexistent calendar date is rejected', () => {
    expect(parseClearanceSubmission(full({ clearedOn: '2026-02-30' }), NOW).errors).toContain(
      'cleared_on_invalid',
    )
  })

  test('today is allowed', () => {
    const r = parseClearanceSubmission(full({ clearedOn: toIsoDate(NOW) }), NOW)
    expect(r.ok).toBe(true)
  })
})

// ── The stored shape ─────────────────────────────────────────────────────────

describe('stored shape', () => {
  test('a valid submission produces the SurgicalClearance shape the engine reads', () => {
    const r = parseClearanceSubmission(
      full({ clearedBy: '  Dr Reed, orthopaedic surgeon  ', notes: '  no deep squats  ' }),
      NOW,
    )
    expect(r.clearance).toEqual({
      maxKneeFlexionDeg: 125,
      openChainCleared: true,
      impactCleared: true,
      pivotCleared: true,
      notes: 'no deep squats',
      setBy: 'user',
      updatedAt: NOW.toISOString(),
      clearedOn: '2026-09-01',
      clearedBy: 'Dr Reed, orthopaedic surgeon',
    })
  })

  test('the run ceiling stays top level, beside the ladder state, not inside clearance', () => {
    const parsed = parseClearanceSubmission(full(), NOW)
    const merged = mergeClearanceIntoContext({ ladder: { rungIndex: 3 } }, parsed)
    expect(merged.longestRunSegmentMin).toBe(8)
    expect(merged.clearance).not.toHaveProperty('longestRunSegmentMin')
    expect(merged.ladder).toEqual({ rungIndex: 3 })
  })

  test('merging preserves onboarding context it does not own', () => {
    const existing: StoredRecoveryContext = {
      surgicalLeg: 'right',
      weeklyRunMinutes: 15,
      surgeryDateApprox: '2025-03',
    }
    const merged = mergeClearanceIntoContext(existing, parseClearanceSubmission(full(), NOW))
    expect(merged.surgicalLeg).toBe('right')
    expect(merged.weeklyRunMinutes).toBe(15)
  })

  test('an empty submission removes both the clearance and the ceiling', () => {
    const existing: StoredRecoveryContext = {
      surgicalLeg: 'left',
      longestRunSegmentMin: 12,
      clearance: {
        maxKneeFlexionDeg: 130,
        openChainCleared: true,
        impactCleared: true,
        pivotCleared: true,
        setBy: 'user',
        clearedOn: '2026-01-01',
        clearedBy: null,
      },
    }
    const merged = mergeClearanceIntoContext(existing, parseClearanceSubmission(null, NOW))
    expect(merged.clearance).toBeUndefined()
    expect(merged.longestRunSegmentMin).toBeUndefined()
    expect(merged.surgicalLeg).toBe('left')
  })

  test('malformed stored JSON degrades to an empty context, not a throw', () => {
    expect(parseStoredContext('{not json')).toEqual({})
    expect(parseStoredContext(null)).toEqual({})
    expect(parseStoredContext('"a string"')).toEqual({})
  })
})

// ── The consumers actually agree with what we write ──────────────────────────

describe('the engines read what this writes', () => {
  test('nothing stored keeps filterContraindicated on its conservative default', () => {
    const merged = mergeClearanceIntoContext({}, parseClearanceSubmission(null, NOW))
    const result = filterContraindicated(KEY_LIFTS, merged)
    expect(result.usingConservativeDefault).toBe(true)
    expect(result.blocked.map((b) => b.lift.id)).toContain('leg-extension')
  })

  test('nothing stored offers no ladder rung', () => {
    const merged = mergeClearanceIntoContext({}, parseClearanceSubmission(null, NOW))
    expect(highestRungWithinCeiling(merged.longestRunSegmentMin ?? null)).toBe(-1)
  })

  test('a full clearance lifts the conservative default', () => {
    const merged = mergeClearanceIntoContext({}, parseClearanceSubmission(full(), NOW))
    const result = filterContraindicated(KEY_LIFTS, merged)
    expect(result.usingConservativeDefault).toBe(false)
    expect(result.allowed.map((l) => l.id)).toContain('leg-extension')
  })

  test('an uncleared open chain still hides open-chain knee extension', () => {
    const merged = mergeClearanceIntoContext(
      {},
      parseClearanceSubmission(full({ openChainCleared: false }), NOW),
    )
    const result = filterContraindicated(KEY_LIFTS, merged)
    expect(result.usingConservativeDefault).toBe(false)
    expect(result.blocked.map((b) => b.attribute)).toContain('open_chain_knee_extension')
    expect(result.blocked.map((b) => b.lift.id)).toContain('leg-extension')
  })

  test('the reason names the entered clearance, not the app, as the source', () => {
    const merged = mergeClearanceIntoContext(
      {},
      parseClearanceSubmission(full({ openChainCleared: false }), NOW),
    )
    const blocked = filterContraindicated(KEY_LIFTS, merged).blocked
    expect(blocked[0].reason).toMatch(/your entered clearance/i)
  })

  test('an uncleared pivot is stored faithfully even though no curated lift pivots yet', () => {
    const parsed = parseClearanceSubmission(full({ pivotCleared: false }), NOW)
    expect(parsed.clearance?.pivotCleared).toBe(false)
    const merged = mergeClearanceIntoContext({}, parsed)
    expect(clearanceConsequences(merged).pivotAllowed).toBe(false)
  })

  test('flexion under the engine threshold still hides deep-knee work', () => {
    const merged = mergeClearanceIntoContext(
      {},
      parseClearanceSubmission(full({ maxKneeFlexionDeg: String(DEEP_FLEXION_THRESHOLD_DEG - 5) }), NOW),
    )
    const blocked = filterContraindicated(KEY_LIFTS, merged).blocked.map((b) => b.lift.id)
    expect(blocked).toContain('back-squat')
  })

  test('a stored ceiling feeds the ladder', () => {
    const merged = mergeClearanceIntoContext(
      {},
      parseClearanceSubmission(full({ longestRunSegmentMin: '8' }), NOW),
    )
    expect(highestRungWithinCeiling(merged.longestRunSegmentMin ?? null)).toBeGreaterThanOrEqual(0)
  })

  test('a zero ceiling offers no rung', () => {
    const merged = mergeClearanceIntoContext(
      {},
      parseClearanceSubmission(full({ longestRunSegmentMin: '0' }), NOW),
    )
    expect(highestRungWithinCeiling(merged.longestRunSegmentMin ?? null)).toBe(-1)
  })
})

// ── Read-back and display helpers ────────────────────────────────────────────

describe('read-back', () => {
  test('an empty context yields a form with nothing pre-selected', () => {
    const sub = clearanceToSubmission({})
    expect(sub.maxKneeFlexionDeg).toBe('')
    expect(sub.noFlexionLimit).toBe(false)
    expect(sub.openChainCleared).toBeNull()
    expect(sub.impactCleared).toBeNull()
    expect(sub.pivotCleared).toBeNull()
    expect(sub.longestRunSegmentMin).toBe('')
    expect(sub.clearedOn).toBe('')
  })

  test('a round trip through storage and back preserves the answers', () => {
    const parsed = parseClearanceSubmission(full({ clearedBy: 'PT' }), NOW)
    const context = mergeClearanceIntoContext({}, parsed)
    const sub = clearanceToSubmission(context)
    expect(sub.maxKneeFlexionDeg).toBe(125)
    expect(sub.openChainCleared).toBe(true)
    expect(sub.longestRunSegmentMin).toBe(8)
    expect(sub.clearedBy).toBe('PT')
    expect(parseClearanceSubmission(sub, NOW).ok).toBe(true)
  })

  test('a no-limit clearance reads back as the ticked checkbox, not a blank number', () => {
    const parsed = parseClearanceSubmission(full({ maxKneeFlexionDeg: '', noFlexionLimit: true }), NOW)
    const sub = clearanceToSubmission(mergeClearanceIntoContext({}, parsed))
    expect(sub.noFlexionLimit).toBe(true)
    expect(sub.maxKneeFlexionDeg).toBe('')
  })

  test('consequences with nothing entered show everything hidden', () => {
    expect(clearanceConsequences({})).toEqual({
      deepFlexionAllowed: false,
      openChainAllowed: false,
      impactAllowed: false,
      pivotAllowed: false,
      runSegmentMin: null,
    })
  })

  test('consequences mirror the stored clearance', () => {
    const context = mergeClearanceIntoContext(
      {},
      parseClearanceSubmission(full({ maxKneeFlexionDeg: '100', impactCleared: false }), NOW),
    )
    const c = clearanceConsequences(context)
    expect(c.deepFlexionAllowed).toBe(false)
    expect(c.impactAllowed).toBe(false)
    expect(c.openChainAllowed).toBe(true)
    expect(c.runSegmentMin).toBe(8)
  })

  test('clearance age is reported in whole months', () => {
    const parsed = parseClearanceSubmission(full({ clearedOn: '2026-03-01' }), NOW)
    expect(clearanceAgeMonths(parsed.clearance!, NOW)).toBe(6)
  })

  test('a clearance given today is zero months old', () => {
    const parsed = parseClearanceSubmission(full({ clearedOn: toIsoDate(NOW) }), NOW)
    expect(clearanceAgeMonths(parsed.clearance!, NOW)).toBe(0)
  })
})
