import {
  LADDER_RUNGS,
  RUN_TYPES,
  applyRunReadiness,
  decideLadder,
  eligibleRunTypes,
  highestRungWithinCeiling,
  isRunTypeEligible,
  prescribeRun,
  resolveTarget,
  rungAt,
  rungTotalDurationMin,
  rungTotalRunMin,
  weekKey,
} from '../runEngine'
import type { LadderState, RunEligibilityContext } from '../../types/run'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TODAY = new Date('2026-08-20T09:00:00Z') // a Thursday

function state(overrides: Partial<LadderState> = {}): LadderState {
  return {
    rungIndex: 4,
    sessionsAtRung: 0,
    painFreeStreak: 0,
    lastVolumeIncreaseWeek: null,
    lastSegmentIncreaseWeek: null,
    graduated: false,
    ...overrides,
  }
}

function ladderInput(overrides: Record<string, unknown> = {}) {
  return {
    state: state(),
    today: TODAY,
    band: 'green' as const,
    painLevel: 'none' as const,
    longestRunSegmentMin: 20,
    provisional: false,
    ...overrides,
  }
}

const GRADUATED_CTX: RunEligibilityContext = {
  ladderGraduated: true,
  lthrAnchorSource: 'confirmed',
  weeksOfBase: 12,
  impactCleared: true,
}

// ── Taxonomy ─────────────────────────────────────────────────────────────────

describe('run taxonomy', () => {
  test('every type carries an intensity cost the allocator can price', () => {
    for (const def of Object.values(RUN_TYPES)) {
      expect(typeof def.intensityCost).toBe('number')
      expect(def.intensityCost).toBeGreaterThanOrEqual(0)
      expect(def.intensityCost).toBeLessThanOrEqual(10)
    }
  })

  test('harder sessions cost more than easier ones', () => {
    expect(RUN_TYPES.vo2.intensityCost).toBeGreaterThan(RUN_TYPES.tempo.intensityCost)
    expect(RUN_TYPES.tempo.intensityCost).toBeGreaterThan(RUN_TYPES.easy.intensityCost)
    expect(RUN_TYPES.easy.intensityCost).toBeGreaterThan(RUN_TYPES.walk.intensityCost)
  })
})

describe('isRunTypeEligible', () => {
  const onLadder: RunEligibilityContext = {
    ladderGraduated: false,
    lthrAnchorSource: 'estimate',
    weeksOfBase: 0,
    impactCleared: false,
  }

  test('walk/run is always available', () => {
    expect(isRunTypeEligible('walk_run', onLadder)).toBe(true)
    expect(isRunTypeEligible('walk', onLadder)).toBe(true)
    expect(isRunTypeEligible('rest', onLadder)).toBe(true)
  })

  test('continuous running is unreachable until the ladder graduates', () => {
    expect(isRunTypeEligible('easy', onLadder)).toBe(false)
    expect(isRunTypeEligible('long', onLadder)).toBe(false)
    expect(isRunTypeEligible('tempo', onLadder)).toBe(false)
  })

  test('easy unlocks on graduation but the long run still needs base', () => {
    const justGraduated: RunEligibilityContext = { ...onLadder, ladderGraduated: true }
    expect(isRunTypeEligible('easy', justGraduated)).toBe(true)
    expect(isRunTypeEligible('long', justGraduated)).toBe(false)
  })

  test('tempo needs an observed LTHR anchor, VO2 needs a confirmed one', () => {
    const observed: RunEligibilityContext = { ...GRADUATED_CTX, lthrAnchorSource: 'observed' }
    expect(isRunTypeEligible('tempo', observed)).toBe(true)
    expect(isRunTypeEligible('vo2', observed)).toBe(false)
    expect(isRunTypeEligible('vo2', GRADUATED_CTX)).toBe(true)
  })

  test('hills need impact clearance', () => {
    expect(isRunTypeEligible('hills', { ...GRADUATED_CTX, impactCleared: false })).toBe(false)
  })

  test('a fully graduated athlete can reach everything', () => {
    expect(eligibleRunTypes(GRADUATED_CTX)).toHaveLength(Object.keys(RUN_TYPES).length)
  })
})

// ── Rung arithmetic ──────────────────────────────────────────────────────────

describe('rung arithmetic', () => {
  test('total run time counts only the running', () => {
    // rung 4: 3 min run / 2 min walk × 6
    expect(rungTotalRunMin(rungAt(4))).toBe(18)
  })

  test('session duration excludes the final walk break', () => {
    // 6 × 3 min run + 5 × 2 min walk = 28 min
    expect(rungTotalDurationMin(rungAt(4))).toBe(28)
  })

  test('rung index is clamped rather than throwing', () => {
    expect(rungAt(-5).index).toBe(0)
    expect(rungAt(999).index).toBe(LADDER_RUNGS.length - 1)
  })

  test('the ladder ends in continuous running', () => {
    expect(LADDER_RUNGS[LADDER_RUNGS.length - 1].continuous).toBe(true)
  })

  test('run segments never shrink as the ladder climbs', () => {
    for (let i = 1; i < LADDER_RUNGS.length; i++) {
      expect(LADDER_RUNGS[i].runSec).toBeGreaterThanOrEqual(LADDER_RUNGS[i - 1].runSec)
    }
  })
})

describe('highestRungWithinCeiling', () => {
  test('finds the tallest rung inside the cleared segment length', () => {
    // 6 min cleared → rung 7 is exactly 6 min
    expect(highestRungWithinCeiling(6)).toBe(7)
  })

  test('returns -1 when nothing is cleared', () => {
    expect(highestRungWithinCeiling(null)).toBe(-1)
    expect(highestRungWithinCeiling(0)).toBe(-1)
  })

  test('a generous ceiling reaches the top of the ladder', () => {
    expect(highestRungWithinCeiling(60)).toBe(LADDER_RUNGS.length - 1)
  })
})

// ── decideLadder ─────────────────────────────────────────────────────────────

describe('decideLadder', () => {
  test('holds until enough clean sessions have accumulated', () => {
    const d = decideLadder(ladderInput({ state: state({ sessionsAtRung: 1 }) }))
    expect(d.action).toBe('hold')
    expect(d.reason).toMatch(/2 more clean session/)
  })

  test('advances the segment after three clean sessions', () => {
    const d = decideLadder(ladderInput({ state: state({ sessionsAtRung: 3 }) }))
    expect(d.action).toBe('advance_segment')
    expect(d.rung.index).toBe(5)
  })

  test('never advances two dimensions in the same week', () => {
    const d = decideLadder(
      ladderInput({
        state: state({ sessionsAtRung: 3, lastVolumeIncreaseWeek: weekKey(TODAY) }),
      }),
    )
    expect(d.action).toBe('hold')
    expect(d.reason).toMatch(/only one dimension moves per week/i)
  })

  test('a segment advance last week does not block this week', () => {
    const lastWeek = new Date('2026-08-13T09:00:00Z')
    const d = decideLadder(
      ladderInput({
        state: state({ sessionsAtRung: 3, lastSegmentIncreaseWeek: weekKey(lastWeek) }),
      }),
    )
    expect(d.action).toBe('advance_segment')
  })

  test('flagged pain drops a rung and says so', () => {
    const d = decideLadder(ladderInput({ painLevel: 'yes', state: state({ sessionsAtRung: 5 }) }))
    expect(d.action).toBe('drop_back')
    expect(d.rung.index).toBe(3)
    expect(d.reason).toMatch(/pain/i)
  })

  test('intermittent pain holds without dropping', () => {
    const d = decideLadder({
      ...ladderInput({ painLevel: 'sometimes', state: state({ sessionsAtRung: 5 }) }),
    })
    expect(d.action).toBe('hold')
    expect(d.rung.index).toBe(4)
  })

  test('a drop-back has to be earned back before anything advances', () => {
    const d = decideLadder(
      ladderInput({ state: state({ sessionsAtRung: 5, painFreeStreak: 1 }) }),
    )
    expect(d.action).toBe('hold')
    expect(d.reason).toMatch(/2 more pain-free/)
  })

  test('advances are green-day only', () => {
    for (const band of ['amber', 'red'] as const) {
      const d = decideLadder(ladderInput({ band, state: state({ sessionsAtRung: 3 }) }))
      expect(d.action).toBe('hold')
    }
  })

  test('the clearance ceiling stops an otherwise-earned advance', () => {
    const d = decideLadder(
      ladderInput({ state: state({ rungIndex: 7, sessionsAtRung: 3 }), longestRunSegmentMin: 6 }),
    )
    expect(d.action).toBe('capped_by_clearance')
    expect(d.blockedByCeiling).toBe(true)
    expect(d.reason).toMatch(/surgeon or PT/i)
  })

  test('no clearance entered means no rung is offered at all', () => {
    const d = decideLadder(ladderInput({ longestRunSegmentMin: null }))
    expect(d.action).toBe('capped_by_clearance')
    expect(d.reason).toMatch(/profile page/i)
  })

  test('an already-graduated ladder reports graduation', () => {
    const d = decideLadder(ladderInput({ state: state({ graduated: true }) }))
    expect(d.action).toBe('graduated')
  })

  test('reaching the top of the ladder graduates it', () => {
    const d = decideLadder(
      ladderInput({
        state: state({ rungIndex: LADDER_RUNGS.length - 1, sessionsAtRung: 3 }),
        longestRunSegmentMin: 60,
      }),
    )
    expect(d.action).toBe('graduated')
  })

  test('pain outranks a ready-to-advance state', () => {
    const d = decideLadder(
      ladderInput({ painLevel: 'yes', state: state({ sessionsAtRung: 3 }), band: 'green' }),
    )
    expect(d.action).toBe('drop_back')
  })
})

// ── applyRunReadiness ────────────────────────────────────────────────────────

describe('applyRunReadiness', () => {
  test('green leaves the session alone', () => {
    const a = applyRunReadiness('easy', 'green')
    expect(a.type).toBe('easy')
    expect(a.durationFactor).toBe(1)
  })

  test('amber trims a hard session rather than dropping it', () => {
    const a = applyRunReadiness('tempo', 'amber')
    expect(a.type).toBe('tempo')
    expect(a.durationFactor).toBeLessThan(1)
  })

  test('red removes hard work entirely', () => {
    expect(applyRunReadiness('vo2', 'red').type).toBe('rest')
    expect(applyRunReadiness('easy', 'red').type).toBe('recovery')
  })

  test('the long run is moved, not cut', () => {
    const a = applyRunReadiness('long', 'red')
    expect(a.deferLongRun).toBe(true)
    expect(a.summary).toMatch(/moves rather than gets cut/i)
  })

  test('amber shortens the long run instead of deferring it', () => {
    const a = applyRunReadiness('long', 'amber')
    expect(a.type).toBe('long')
    expect(a.deferLongRun).toBe(false)
    expect(a.durationFactor).toBeCloseTo(0.8)
  })

  test('flagged pain replaces any run with a walk', () => {
    const a = applyRunReadiness('tempo', 'green', true)
    expect(a.type).toBe('walk')
  })
})

// ── resolveTarget ────────────────────────────────────────────────────────────

describe('resolveTarget', () => {
  const zones = { z2Ceiling: 148, lthr: 168, maxHr: 191 }

  test('never prescribes a pace during return-to-run', () => {
    const t = resolveTarget('walk_run', { value: 300, source: 'confirmed' }, zones, false)
    expect(t.kind).toBe('heart_rate')
    expect(t.paceSecPerKm).toBeNull()
    expect(t.note).toMatch(/not something to hit/i)
  })

  test('never hands over a pace that is only an estimate', () => {
    const t = resolveTarget('easy', { value: 330, source: 'estimate' }, zones, true)
    expect(t.kind).toBe('heart_rate')
    expect(t.paceSecPerKm).toBeNull()
    expect(t.note).toMatch(/no confirmed pace/i)
  })

  test('prescribes a pace once it has been observed', () => {
    const t = resolveTarget('easy', { value: 330, source: 'observed' }, zones, true)
    expect(t.kind).toBe('pace')
    expect(t.paceSecPerKm).toBe(330)
  })

  test('a confirmed anchor says so', () => {
    const t = resolveTarget('easy', { value: 330, source: 'confirmed' }, zones, true)
    expect(t.note).toMatch(/confirmed/i)
  })

  test('falls back to effort when there is neither pace nor heart rate', () => {
    const t = resolveTarget('easy', null, { z2Ceiling: null, lthr: null, maxHr: null }, true)
    expect(t.kind).toBe('effort')
  })

  test('return-to-run with no zones still gives usable guidance', () => {
    const t = resolveTarget('walk_run', null, { z2Ceiling: null, lthr: null, maxHr: null }, false)
    expect(t.kind).toBe('effort')
    expect(t.note).toMatch(/full sentences/i)
  })
})

// ── prescribeRun ─────────────────────────────────────────────────────────────

describe('prescribeRun', () => {
  const zones = { z2Ceiling: 148, lthr: 168, maxHr: 191 }

  test('builds a walk/run session from the current rung', () => {
    const ladder = decideLadder(ladderInput({ state: state({ sessionsAtRung: 1 }) }))
    const adjustment = applyRunReadiness('walk_run', 'green')
    const target = resolveTarget('walk_run', null, zones, false)
    const rx = prescribeRun({ ladder, adjustment, target })

    expect(rx.type).toBe('walk_run')
    expect(rx.runMin).toBe(18)
    expect(rx.durationMin).toBe(28)
    expect(rx.intervals?.[0]).toEqual({
      repeat: 6,
      workSec: 180,
      recoverSec: 120,
      label: '3 min run / 2 min walk × 6',
    })
    expect(rx.changed).toBeNull()
  })

  test('a red day on the ladder becomes a walk and says what changed', () => {
    const ladder = decideLadder(ladderInput({ band: 'red' }))
    const adjustment = applyRunReadiness('walk_run', 'red', false)
    const target = resolveTarget('walk', null, zones, false)
    const rx = prescribeRun({ ladder, adjustment, target })

    expect(rx.runMin).toBe(0)
    expect(rx.changed).toBeTruthy()
  })

  test('scales a graduated session by the readiness factor', () => {
    const ladder = decideLadder(ladderInput({ state: state({ graduated: true }) }))
    const adjustment = applyRunReadiness('easy', 'amber')
    const target = resolveTarget('easy', { value: 330, source: 'observed' }, zones, true)
    const rx = prescribeRun({ ladder, adjustment, target, plannedDurationMin: 40 })

    expect(rx.type).toBe('easy')
    expect(rx.durationMin).toBe(36) // 40 × 0.9
    expect(rx.targetPaceSecPerKm).toBe(330)
    expect(rx.changed).toBeTruthy()
  })

  test('a green graduated day reports no change', () => {
    const ladder = decideLadder(ladderInput({ state: state({ graduated: true }) }))
    const adjustment = applyRunReadiness('easy', 'green')
    const target = resolveTarget('easy', { value: 330, source: 'observed' }, zones, true)
    const rx = prescribeRun({ ladder, adjustment, target, plannedDurationMin: 40 })
    expect(rx.changed).toBeNull()
  })
})

// ── weekKey ──────────────────────────────────────────────────────────────────

describe('weekKey', () => {
  // weekKey reads local calendar components, so the fixtures must be local
  // dates too — a UTC-midnight literal lands on the previous day west of
  // Greenwich and silently straddles the week boundary.
  test('days in the same week share a key', () => {
    expect(weekKey(new Date(2026, 7, 17))).toBe(weekKey(new Date(2026, 7, 21)))
  })

  test('the following week gets a different key', () => {
    expect(weekKey(new Date(2026, 7, 20))).not.toBe(weekKey(new Date(2026, 7, 27)))
  })
})

// ── No clearance entered ─────────────────────────────────────────────────────

describe('no clearance entered', () => {
  const zones = { z2Ceiling: 148, lthr: 168, maxHr: 191 }

  test('the decision is flagged distinctly from a merely capped advance', () => {
    const none = decideLadder(ladderInput({ longestRunSegmentMin: null }))
    expect(none.noRungAvailable).toBe(true)

    const capped = decideLadder(
      ladderInput({ state: state({ rungIndex: 7, sessionsAtRung: 3 }), longestRunSegmentMin: 6 }),
    )
    expect(capped.blockedByCeiling).toBe(true)
    expect(capped.noRungAvailable).toBeUndefined()
  })

  test('prescribes a walk rather than contradicting itself with running minutes', () => {
    const ladder = decideLadder(ladderInput({ longestRunSegmentMin: null }))
    const adjustment = applyRunReadiness('walk_run', 'green')
    const target = resolveTarget('walk_run', null, zones, false)
    const rx = prescribeRun({ ladder, adjustment, target })

    expect(rx.type).toBe('walk')
    expect(rx.runMin).toBe(0)
    expect(rx.why).toMatch(/no ladder rung is offered/i)
  })
})
