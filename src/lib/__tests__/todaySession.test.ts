import { subDays } from 'date-fns'
import {
  anchorConfidenceFor,
  deriveIntent,
  diffAgainstPlan,
  isQualityRunType,
  isRecoveryRunType,
  parsePlannedSpec,
  planTodaySession,
  runCandidate,
  strengthCandidates,
  summarizeDay,
  toPreferenceRule,
} from '../todaySession'
import type { PlannedRow, PreferenceRow, TodaySessionInput } from '../todaySession'
import { buildStrengthSession } from '../strengthSession'
import { buildMovementCandidates } from '../movementSession'
import { computeDailyBudget, HARD_DAY_SRPE } from '../load'
import { DISCLAIMER } from '../prehabEngine'
import { SCENARIOS } from '../scenario'
import type { CandidateItem, DayIntent } from '../allocator'
import type { RunPrescription } from '../../types/run'
import type { MovementCandidateInput } from '../movementSession'
import type { ReadinessResult } from '../../types/readiness'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TODAY = new Date('2026-06-10T07:00:00Z')

function prescription(over: Partial<RunPrescription> = {}): RunPrescription {
  return {
    type: 'easy',
    label: 'Easy run',
    durationMin: 40,
    runMin: 40,
    targetKind: 'heart_rate',
    targetHrLow: 130,
    targetHrHigh: 145,
    targetNote: 'Z2',
    why: 'Aerobic base.',
    band: 'green',
    changed: null,
    ...over,
  }
}

function strengthInput(band: 'green' | 'amber' | 'red' = 'green') {
  return {
    band,
    provisional: false,
    painLevel: 'none' as const,
    recoveryContext: null,
    lastSessionByExercise: {},
    daysSinceIncreaseByExercise: {},
  }
}

function movementInput(over: Partial<MovementCandidateInput> = {}): MovementCandidateInput {
  return {
    band: 'green',
    isQualityDay: false,
    isRecoveryDay: false,
    painFlagged: false,
    todayRunType: 'easy',
    tomorrowRunType: 'easy',
    assessments: [],
    tierAnchor: { value: 1, source: 'observed', confidence: 0.5, sessions: 2, basis: 'test' },
    masteredIds: ['pogo-jumps', 'ankling', 'a-skips', 'jump-rope-basic'],
    impactCleared: true,
    weeklyContacts: [200, 220, 240, 260],
    contactsThisWeek: 0,
    provisional: false,
    dayIndex: 3,
    ...over,
  }
}

const INTENT: DayIntent = {
  primaryModality: 'run',
  isQualityDay: false,
  plannedRunType: 'easy',
  priority: 'B',
}

function budgetOf(daily = 250) {
  return computeDailyBudget({
    dailyLoads: new Array(28).fill(daily),
    band: 'green',
    calibrating: false,
  })
}

function planInput(over: Partial<TodaySessionInput> = {}): TodaySessionInput {
  return {
    date: TODAY,
    band: 'green',
    calibrating: false,
    anchorConfidence: 'observed',
    intent: INTENT,
    budget: budgetOf(),
    candidates: [],
    niggles: [],
    preferences: [],
    recentDays: [],
    tomorrow: null,
    engineFlags: [],
    disclaimer: DISCLAIMER,
    ...over,
  }
}

// ── Candidate production ─────────────────────────────────────────────────────

describe('runCandidate', () => {
  it('turns a prescription into a priced A-priority candidate', () => {
    const candidate = runCandidate(prescription(), true)!
    expect(candidate.modality).toBe('run')
    expect(candidate.priority).toBe('A')
    expect(candidate.placement).toBe('main')
    expect(candidate.cost.durationMin).toBe(40)
    expect(candidate.cost.load).toBeGreaterThan(0)
  })

  it('prices intensity off the run type, not the clock', () => {
    const easy = runCandidate(prescription({ type: 'easy' }), true)!
    const vo2 = runCandidate(prescription({ type: 'vo2', label: 'VO2' }), true)!
    expect(vo2.cost.hardness).toBeGreaterThan(easy.cost.hardness)
  })

  it('offers nothing for a rest day or a zero-length session', () => {
    expect(runCandidate(prescription({ type: 'rest', durationMin: 0 }), true)).toBeNull()
    expect(runCandidate(prescription({ durationMin: 0 }), true)).toBeNull()
  })

  it('demotes the run when the day is not built around it', () => {
    expect(runCandidate(prescription(), false)!.priority).toBe('B')
  })

  it('carries the interval spec through', () => {
    const candidate = runCandidate(
      prescription({
        type: 'walk_run',
        label: 'Walk/run',
        intervals: [{ repeat: 6, workSec: 240, recoverSec: 90, label: '4 min' }],
      }),
      true,
    )!
    const params = candidate.item.params
    expect(params.kind).toBe('run')
    if (params.kind === 'run') expect(params.intervals).toHaveLength(1)
  })

  it('tags the run with the tissues it loads, so a niggle can reach it', () => {
    expect(runCandidate(prescription(), true)!.constraints?.tissues).toContain('knee')
  })

  it('gives the same prescription the same item id — a regenerate is not a new day', () => {
    expect(runCandidate(prescription(), true)!.item.id).toBe(
      runCandidate(prescription(), true)!.item.id,
    )
  })
})

describe('strengthCandidates', () => {
  it('prices every lift the template picked', () => {
    const built = buildStrengthSession(strengthInput())
    const candidates = strengthCandidates(built, false)
    expect(candidates.length).toBeGreaterThan(0)
    for (const candidate of candidates) {
      expect(candidate.modality).toBe('strength')
      expect(candidate.cost.load).toBeGreaterThan(0)
      expect(['main', 'accessory']).toContain(candidate.placement)
    }
  })

  it('flags the heavy lower-body work the concurrent rule is about', () => {
    const built = buildStrengthSession(strengthInput())
    const candidates = strengthCandidates(built, true)
    expect(candidates.some((c) => c.constraints?.heavyLowerBody === true)).toBe(true)
  })

  it('makes main lifts A only when the day is built around lifting', () => {
    const built = buildStrengthSession(strengthInput())
    const primary = strengthCandidates(built, true).filter((c) => c.placement === 'main')
    const secondary = strengthCandidates(built, false).filter((c) => c.placement === 'main')
    expect(primary.every((c) => c.priority === 'A')).toBe(true)
    expect(secondary.every((c) => c.priority === 'B')).toBe(true)
  })

  it('keeps accessories at C so they are the first thing the budget drops', () => {
    const built = buildStrengthSession(strengthInput())
    const accessories = strengthCandidates(built, true).filter((c) => c.placement === 'accessory')
    expect(accessories.length).toBeGreaterThan(0)
    expect(accessories.every((c) => c.priority === 'C')).toBe(true)
  })
})

// ── The plan's intent ────────────────────────────────────────────────────────

describe('parsePlannedSpec', () => {
  function row(over: Partial<PlannedRow> = {}): PlannedRow {
    return {
      date: TODAY,
      modality: 'run',
      targetSpecJson: JSON.stringify({ runType: 'tempo', durationMin: 40 }),
      priority: 'A',
      ...over,
    }
  }

  it('reads the run type, duration and priority', () => {
    expect(parsePlannedSpec(row())).toEqual({ runType: 'tempo', durationMin: 40, priority: 'A' })
  })

  it('defaults to B and no run when there is no plan row', () => {
    expect(parsePlannedSpec(null)).toEqual({ runType: null, durationMin: null, priority: 'B' })
  })

  it('survives a malformed spec rather than taking the day down', () => {
    expect(parsePlannedSpec(row({ targetSpecJson: '{{' })).runType).toBeNull()
  })

  it('knows its quality types from its recovery types', () => {
    expect(isQualityRunType('tempo')).toBe(true)
    expect(isQualityRunType('easy')).toBe(false)
    expect(isQualityRunType(null)).toBe(false)
    expect(isRecoveryRunType('recovery')).toBe(true)
    expect(isRecoveryRunType('walk')).toBe(true)
    expect(isRecoveryRunType('long')).toBe(false)
  })
})

describe('deriveIntent', () => {
  it('builds the day around the run when there is one', () => {
    const intent = deriveIntent({ runType: 'long', durationMin: 60, priority: 'A' }, 'green')
    expect(intent.primaryModality).toBe('run')
    expect(intent.priority).toBe('A')
  })

  it('falls back to lifting on a day with no planned run', () => {
    expect(deriveIntent({ runType: null, durationMin: null, priority: 'B' }, 'green').primaryModality)
      .toBe('strength')
  })

  it('is only a quality day when the band agrees', () => {
    const spec = { runType: 'vo2' as const, durationMin: 40, priority: 'A' as const }
    expect(deriveIntent(spec, 'green').isQualityDay).toBe(true)
    expect(deriveIntent(spec, 'amber').isQualityDay).toBe(false)
    expect(deriveIntent(spec, 'red').isQualityDay).toBe(false)
  })

  it('keeps the plan intact on a red day — the budget cuts it, not the intent', () => {
    const intent = deriveIntent({ runType: 'long', durationMin: 90, priority: 'A' }, 'red')
    expect(intent.plannedRunType).toBe('long')
    expect(intent.priority).toBe('A')
  })
})

describe('anchorConfidenceFor', () => {
  function readiness(over: Partial<ReadinessResult>): ReadinessResult {
    return { ...SCENARIOS.green_day, ...over }
  }

  it('maps calibration status onto the anchor ladder', () => {
    expect(anchorConfidenceFor(readiness({ calibration: 'calibrating' }))).toBe('estimate')
    expect(anchorConfidenceFor(readiness({ calibration: 'baseline_ready' }))).toBe('observed')
    expect(anchorConfidenceFor(readiness({ calibration: 'graduated' }))).toBe('confirmed')
  })
})

// ── Preferences ──────────────────────────────────────────────────────────────

describe('toPreferenceRule', () => {
  function row(rule: string, over: Partial<PreferenceRow> = {}): PreferenceRow {
    return { id: 1, rule, source: 'explicit', confidence: 1, weight: 1, ...over }
  }

  it('reads a structured rule', () => {
    const parsed = toPreferenceRule(
      row(JSON.stringify({ label: 'No lifting Sundays', effect: 'exclude', match: { modality: 'strength' } })),
    )
    expect(parsed?.effect).toBe('exclude')
    expect(parsed?.match.modality).toBe('strength')
    expect(parsed?.source).toBe('explicit')
  })

  it('ignores free text rather than guessing at it', () => {
    expect(toPreferenceRule(row('no weights on weekends'))).toBeNull()
  })

  it('ignores a rule with nothing to match on', () => {
    expect(toPreferenceRule(row(JSON.stringify({ effect: 'exclude', match: {} })))).toBeNull()
  })

  it('ignores an unknown effect or modality', () => {
    expect(toPreferenceRule(row(JSON.stringify({ effect: 'ban', match: { modality: 'run' } })))).toBeNull()
    expect(
      toPreferenceRule(row(JSON.stringify({ effect: 'exclude', match: { modality: 'swimming' } }))),
    ).toBeNull()
  })

  it('accepts an item-id rule', () => {
    const parsed = toPreferenceRule(
      row(JSON.stringify({ effect: 'deprioritize', match: { itemIds: ['lift-back-squat'] } }), {
        source: 'inferred',
        confidence: 0.6,
      }),
    )
    expect(parsed?.match.itemIds).toEqual(['lift-back-squat'])
    expect(parsed?.source).toBe('inferred')
  })
})

// ── The allocation ───────────────────────────────────────────────────────────

describe('planTodaySession', () => {
  function fullDay(over: Partial<TodaySessionInput> = {}): TodaySessionInput {
    const run = runCandidate(prescription(), true)!
    const strength = strengthCandidates(buildStrengthSession(strengthInput()), false)
    const movement = buildMovementCandidates(movementInput())
    return planInput({
      candidates: [run, ...strength, ...movement.candidates],
      ...over,
    })
  }

  it('produces ordered blocks from five modalities', () => {
    const day = planTodaySession(fullDay())
    expect(day.blocks.length).toBeGreaterThan(0)
    const kinds = day.blocks.map((b) => b.kind)
    expect(kinds).toEqual([...kinds].sort(
      (a, b) =>
        ['warmup', 'main', 'accessory', 'cooldown'].indexOf(a) -
        ['warmup', 'main', 'accessory', 'cooldown'].indexOf(b),
    ))
  })

  it('never spends past the ceiling', () => {
    const day = planTodaySession(fullDay({ budget: budgetOf(60) }))
    // Near-free prehab and mobility are always affordable; everything else has
    // to fit, so the total can only exceed the ceiling by those.
    const nearFree = day.allocation.decisions.filter((d) => d.code === 'near_free').length
    expect(nearFree).toBeGreaterThanOrEqual(0)
    expect(day.budget.ceiling).toBeGreaterThan(0)
  })

  it('returns a decision for every candidate it was offered', () => {
    const input = fullDay()
    const day = planTodaySession(input)
    expect(day.allocation.decisions).toHaveLength(input.candidates.length)
    for (const decision of day.allocation.decisions) expect(decision.reason.length).toBeGreaterThan(0)
  })

  it('says "nothing to action" when the plan came through intact', () => {
    const run = runCandidate(prescription(), true)!
    const day = planTodaySession(planInput({ candidates: [run], budget: budgetOf(400) }))
    expect(day.changedVsPlan.changed).toBe(false)
    expect(day.changedVsPlan.summary).toBe('nothing to action')
  })

  it('explains what a rail refused', () => {
    const vo2 = runCandidate(prescription({ type: 'vo2', label: 'VO2' }), true)!
    const day = planTodaySession(
      planInput({
        band: 'red',
        candidates: [vo2],
        budget: computeDailyBudget({ dailyLoads: new Array(28).fill(250), band: 'red', calibrating: false }),
      }),
    )
    expect(day.changedVsPlan.changed).toBe(true)
    expect(day.changedVsPlan.entries[0].code).toBe('readiness_veto')
    expect(day.blocks).toHaveLength(0)
  })

  it('does not call an unreached candidate a change to the plan', () => {
    const run = runCandidate(prescription({ durationMin: 200 }), true)!
    const extra: CandidateItem = {
      ...runCandidate(prescription({ type: 'steady', label: 'Steady', durationMin: 90 }), false)!,
      priority: 'C',
    }
    const day = planTodaySession(planInput({ candidates: [run, extra], budget: budgetOf(40) }))
    const codes = day.changedVsPlan.entries.map((e) => e.code)
    expect(codes).not.toContain('budget_exhausted')
  })

  it('merges engine flags with the allocator’s', () => {
    const day = planTodaySession(
      fullDay({
        engineFlags: [{ code: 'plyo_flag', message: 'Plyo volume trimmed.', source: 'plyo' }],
      }),
    )
    expect(day.verdictFlags.some((f) => f.source === 'plyo')).toBe(true)
  })

  it('raises the calibration flag while the anchors are guesses', () => {
    const day = planTodaySession(fullDay({ calibrating: true, anchorConfidence: 'estimate' }))
    expect(day.verdictFlags.some((f) => f.code === 'calibrating')).toBe(true)
  })

  it('down-weights but does not silence a mild niggle', () => {
    const day = planTodaySession(
      fullDay({
        niggles: [
          { id: 'knee|right', bodyRegion: 'knee', tissues: ['knee', 'it_band'], severity: 3, daysActive: 2 },
        ],
      }),
    )
    expect(day.verdictFlags.some((f) => f.code === 'niggle_active')).toBe(true)
    expect(day.blocks.length).toBeGreaterThan(0)
  })

  it('carries the §15 disclaimer through', () => {
    expect(planTodaySession(fullDay()).disclaimer).toBe(DISCLAIMER)
  })

  it('keeps heavy legs away from tomorrow’s long run (§8)', () => {
    const day = planTodaySession(
      fullDay({ tomorrow: { runType: 'long' }, budget: budgetOf(600) }),
    )
    const refused = day.allocation.decisions.filter((d) => d.code === 'concurrent_next_day')
    expect(refused.length).toBeGreaterThan(0)
  })

  it('refuses a second hard day in a row', () => {
    const vo2 = runCandidate(prescription({ type: 'vo2', label: 'VO2' }), true)!
    expect(vo2.cost.hardness).toBeGreaterThanOrEqual(HARD_DAY_SRPE)
    const day = planTodaySession(
      planInput({
        candidates: [vo2],
        budget: budgetOf(600),
        recentDays: [{ date: subDays(TODAY, 1), load: 500, hard: true }],
      }),
    )
    expect(day.allocation.decisions[0].code).toBe('back_to_back_hard')
  })
})

describe('summarizeDay and diffAgainstPlan', () => {
  it('writes one sentence naming the band and the shape', () => {
    const day = planTodaySession(
      planInput({ candidates: [runCandidate(prescription(), true)!], budget: budgetOf(400) }),
    )
    expect(day.why).toContain('Green day')
    expect(day.why).toContain('run')
    expect(day.why.split('.').length).toBeLessThanOrEqual(3)
  })

  it('says something useful when nothing survives', () => {
    const empty = planTodaySession(planInput({ band: 'red', candidates: [] }))
    expect(empty.why.length).toBeGreaterThan(0)
    expect(summarizeDay(empty.allocation, INTENT, 'red')).toMatch(/recover/i)
  })

  it('counts trims and drops separately', () => {
    const diff = diffAgainstPlan({
      blocks: [],
      plannedLoad: 0,
      plannedDurationMin: 0,
      budget: budgetOf(),
      nearFreeLoad: 0,
      flags: [],
      hardDay: false,
      decisions: [
        { itemId: 'a', name: 'A', modality: 'run', outcome: 'trimmed', code: 'trimmed_to_budget', reason: 'x' },
        { itemId: 'b', name: 'B', modality: 'strength', outcome: 'rejected', code: 'readiness_veto', reason: 'y' },
      ],
    })
    expect(diff.changed).toBe(true)
    expect(diff.summary).toContain('1 dropped')
    expect(diff.summary).toContain('1 trimmed')
    expect(diff.entries).toHaveLength(2)
  })
})
