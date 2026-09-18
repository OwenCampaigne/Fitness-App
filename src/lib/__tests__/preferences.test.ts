// ── Preference learning tests ─────────────────────────────────────────────────
// Every function under test is pure and takes its rows as arguments, so the
// whole of §13 is assertable against literals with no database.

import {
  CONFIDENT_SAMPLE,
  MIN_SAMPLE,
  activePreferenceRules,
  bindingEffect,
  buildInferenceInput,
  checkPreferenceViolations,
  confidenceFrom,
  describeDays,
  entryDroppedOrSoftened,
  inferEasyRunDrift,
  inferPreferences,
  inferQualitySwapAfterShortSleep,
  inferSkippedWeekdayModality,
  parseExplicitRule,
  parseRecommendedItems,
  parseStoredPreference,
  preferenceKey,
  serializePreference,
} from '../preferences'
import { toPreferenceRule } from '../todaySession'
import type { PreferenceDraft, StoredPreference } from '../preferences'
import type { SessionBlock } from '../../types/session'

// ── Helpers ───────────────────────────────────────────────────────────────────

function stored(over: Partial<StoredPreference> = {}): StoredPreference {
  return {
    id: 1,
    kind: 'no_modality',
    source: 'explicit',
    label: 'No plyo, any day.',
    confidence: 1,
    weight: 1,
    confirmed: true,
    modality: 'plyo',
    ...over,
  }
}

/** A Sunday, so weekend rules bite and weekday rules do not. */
const SUNDAY = new Date('2026-09-20T09:00:00')
const MONDAY = new Date('2026-09-21T09:00:00')
const FRIDAY = new Date('2026-09-18T09:00:00')

function recommended(items: Array<Record<string, unknown>>): string {
  return JSON.stringify({ blocks: [{ kind: 'main', items }] })
}

function runItem(id: string, runType: string, targetHrHigh: number | null = null) {
  return {
    id,
    ref: { kind: 'run', id: runType, name: `${runType} run` },
    params: { kind: 'run', runType, durationMin: 45, targetHrHigh },
  }
}

function liftItem(id: string) {
  return {
    id,
    ref: { kind: 'exercise', id: 'back-squat', name: 'Back Squat' },
    params: { kind: 'strength', sets: 3, reps: 8, weightKg: 60, targetRir: 2 },
  }
}

// ── Explicit rules (§13) ──────────────────────────────────────────────────────

describe('parseExplicitRule — the four §13 examples', () => {
  it('"no weights on weekends"', () => {
    const rule = parseExplicitRule('no weights on weekends')
    expect(rule).toMatchObject({
      kind: 'no_modality_on_days',
      modality: 'strength',
      days: [0, 6],
      confirmed: true,
      source: 'explicit',
    })
  })

  it('"long run Sunday"', () => {
    expect(parseExplicitRule('long run Sunday')).toMatchObject({
      kind: 'modality_on_day',
      modality: 'run',
      runTypes: ['long'],
      days: [0],
    })
  })

  it('"rest Monday"', () => {
    expect(parseExplicitRule('rest Monday')).toMatchObject({ kind: 'rest_on_day', days: [1] })
  })

  it('"no doubles"', () => {
    expect(parseExplicitRule('no doubles')).toMatchObject({ kind: 'no_doubles', confirmed: true })
  })

  it('handles an unconditional exclusion', () => {
    expect(parseExplicitRule('never any plyos')).toMatchObject({
      kind: 'no_modality',
      modality: 'plyo',
    })
  })

  it('refuses to guess rather than mis-parsing (a bad rule deletes real work)', () => {
    expect(parseExplicitRule('I would prefer things to feel nicer')).toBeNull()
    expect(parseExplicitRule('')).toBeNull()
    expect(parseExplicitRule('x'.repeat(400))).toBeNull()
  })
})

describe('describeDays', () => {
  it('names the common groupings', () => {
    expect(describeDays([0, 6])).toBe('weekends')
    expect(describeDays([1, 2, 3, 4, 5])).toBe('weekdays')
    expect(describeDays([5])).toBe('Friday')
    expect(describeDays([1, 3])).toBe('Monday and Wednesday')
  })
})

// ── Serialization and the binding boundary ────────────────────────────────────

describe('bindingEffect — what may reach the allocator', () => {
  it('binds an unconditional, confirmed, explicit exclusion', () => {
    expect(bindingEffect(stored())).toBe('exclude')
  })

  it('never binds an unconfirmed inference (§13)', () => {
    expect(bindingEffect(stored({ confirmed: false, source: 'inferred' }))).toBe('suggest')
  })

  it('never binds a day-scoped rule, because a stored row has no date', () => {
    expect(bindingEffect(stored({ days: [0, 6], kind: 'no_modality_on_days' }))).toBe('suggest')
  })
})

describe('serialize → the allocator parser', () => {
  it('an unconfirmed inference parses to nothing in the allocator', () => {
    const draft: PreferenceDraft = {
      kind: 'deprioritize_day_modality',
      source: 'inferred',
      label: 'Friday lifts keep getting dropped.',
      confidence: 0.7,
      confirmed: false,
      days: [5],
      modality: 'strength',
    }
    const parsed = toPreferenceRule({
      id: 7,
      rule: serializePreference(draft),
      source: 'inferred',
      confidence: 0.7,
      weight: 0,
    })
    expect(parsed).toBeNull()
  })

  it('a confirmed unconditional rule does reach the allocator', () => {
    const parsed = toPreferenceRule({
      id: 8,
      rule: serializePreference(stored()),
      source: 'explicit',
      confidence: 1,
      weight: 1,
    })
    expect(parsed).toMatchObject({ effect: 'exclude', match: { modality: 'plyo' } })
  })

  it('round-trips through parseStoredPreference', () => {
    const draft = parseExplicitRule('no weights on weekends')!
    const back = parseStoredPreference({
      id: 3,
      rule: serializePreference(draft),
      source: 'explicit',
      confidence: 1,
      weight: 1,
    })
    expect(back).toMatchObject({
      kind: 'no_modality_on_days',
      modality: 'strength',
      days: [0, 6],
      confirmed: true,
    })
  })

  it('returns null for a row this module did not write', () => {
    expect(
      parseStoredPreference({ id: 1, rule: 'not json', source: 'explicit', confidence: 1, weight: 1 }),
    ).toBeNull()
    expect(
      parseStoredPreference({
        id: 1,
        rule: JSON.stringify({ label: 'x', effect: 'exclude', match: {} }),
        source: 'explicit',
        confidence: 1,
        weight: 1,
      }),
    ).toBeNull()
  })
})

// ── Resolving for a day ───────────────────────────────────────────────────────

describe('activePreferenceRules', () => {
  const weekendRule = stored({
    id: 2,
    kind: 'no_modality_on_days',
    modality: 'strength',
    days: [0, 6],
    label: 'No strength on weekends.',
  })

  it('binds a day-scoped rule on its own days', () => {
    const rules = activePreferenceRules([weekendRule], SUNDAY)
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ effect: 'exclude', match: { modality: 'strength' } })
  })

  it('stays silent on every other day', () => {
    expect(activePreferenceRules([weekendRule], MONDAY)).toHaveLength(0)
  })

  it('never returns an unconfirmed inference', () => {
    const pending = stored({
      id: 3,
      source: 'inferred',
      confirmed: false,
      kind: 'deprioritize_day_modality',
      modality: 'strength',
      days: [5],
    })
    expect(activePreferenceRules([pending], FRIDAY)).toHaveLength(0)
  })

  it('returns a confirmed inference as a lean, not an exclusion', () => {
    const confirmed = stored({
      id: 4,
      source: 'inferred',
      confirmed: true,
      kind: 'deprioritize_day_modality',
      modality: 'strength',
      days: [5],
      confidence: 0.7,
    })
    expect(activePreferenceRules([confirmed], FRIDAY)[0]).toMatchObject({
      effect: 'deprioritize',
      source: 'inferred',
    })
  })

  it('turns "rest Monday" into an exclusion on every training modality', () => {
    const rest = stored({ id: 5, kind: 'rest_on_day', days: [1], modality: undefined })
    const rules = activePreferenceRules([rest], MONDAY)
    const modalities = rules.map((r) => r.match.modality).sort()
    expect(modalities).toEqual(['plyo', 'run', 'strength'])
  })
})

// ── Explicit rules as a gate ──────────────────────────────────────────────────

describe('checkPreferenceViolations', () => {
  const blocks: SessionBlock[] = [
    {
      id: 'b',
      kind: 'main',
      label: 'Main',
      items: [
        {
          id: 'squat-1',
          ref: { kind: 'exercise', id: 'back-squat', name: 'Back Squat' },
          params: { kind: 'strength', sets: 3, reps: 8, weightKg: 60, targetRir: 2 },
          status: 'prescribed',
        },
      ],
    },
  ]

  it('catches work that breaks the athlete\'s own rule', () => {
    const rule = stored({ kind: 'no_modality_on_days', modality: 'strength', days: [0, 6], label: 'No strength on weekends.' })
    const violations = checkPreferenceViolations([rule], SUNDAY, blocks)
    expect(violations).toHaveLength(1)
    expect(violations[0].message).toContain('Back Squat')
  })

  it('stays quiet on a day the rule does not cover', () => {
    const rule = stored({ kind: 'no_modality_on_days', modality: 'strength', days: [0, 6] })
    expect(checkPreferenceViolations([rule], MONDAY, blocks)).toHaveLength(0)
  })

  it('never lets a learned lean refuse work — only something you said outright', () => {
    const inferred = stored({
      source: 'inferred',
      confirmed: true,
      kind: 'no_modality',
      modality: 'strength',
    })
    expect(checkPreferenceViolations([inferred], MONDAY, blocks)).toHaveLength(0)
  })
})

// ── Confidence ────────────────────────────────────────────────────────────────

describe('confidenceFrom', () => {
  it('damps a high rate on a small sample', () => {
    const small = confidenceFrom(3, 3)
    const large = confidenceFrom(CONFIDENT_SAMPLE, CONFIDENT_SAMPLE)
    expect(small).toBeLessThan(large)
  })

  it('never claims certainty', () => {
    expect(confidenceFrom(100, 100)).toBeLessThanOrEqual(0.95)
  })

  it('is zero with nothing to go on', () => {
    expect(confidenceFrom(0, 0)).toBe(0)
  })
})

// ── Inference 1: skipped weekday lifts ────────────────────────────────────────

describe('inferSkippedWeekdayModality', () => {
  function fridayInput(skipCount: number, prescribedCount: number) {
    const decisions = []
    const edits = []
    for (let i = 0; i < prescribedCount; i++) {
      const date = new Date(2026, 6, 3 + i * 7) // Fridays
      decisions.push({
        date,
        prescribedModalities: ['strength' as const, 'run' as const],
        prescribedRunTypes: ['easy'],
        sleepHours: 7.5,
        wasFollowed: i >= skipCount,
      })
      if (i < skipCount) {
        edits.push({
          date,
          modality: 'strength' as const,
          itemName: 'Back Squat',
          runType: null,
          droppedOrSoftened: true,
          sleepHours: 7.5,
        })
      }
    }
    return { decisions, edits, easyRuns: [] }
  }

  it('notices a Friday lifting pattern', () => {
    const drafts = inferSkippedWeekdayModality(fridayInput(5, 6))
    const strength = drafts.find((d) => d.modality === 'strength')
    expect(strength).toBeDefined()
    expect(strength).toMatchObject({
      kind: 'deprioritize_day_modality',
      days: [5],
      source: 'inferred',
      confirmed: false,
    })
    expect(strength!.label).toContain('Friday')
  })

  it('carries the evidence it was drawn from (§13 legibility)', () => {
    const strength = inferSkippedWeekdayModality(fridayInput(5, 6)).find(
      (d) => d.modality === 'strength',
    )!
    expect(strength.sampleSize).toBe(6)
    expect(strength.evidence![0]).toContain('5 of the last 6 Fridays')
  })

  it('does not fire on an occasional skip', () => {
    const drafts = inferSkippedWeekdayModality(fridayInput(1, 6))
    expect(drafts.find((d) => d.modality === 'strength')).toBeUndefined()
  })

  it('does not fire below the minimum sample', () => {
    const drafts = inferSkippedWeekdayModality(fridayInput(MIN_SAMPLE - 1, MIN_SAMPLE - 1))
    expect(drafts).toHaveLength(0)
  })

  it('counts a day once however many items that edit removed', () => {
    const date = new Date(2026, 6, 3)
    const edit = {
      date,
      modality: 'strength' as const,
      itemName: 'Back Squat',
      runType: null,
      droppedOrSoftened: true,
      sleepHours: 7,
    }
    const input = {
      decisions: [
        { date, prescribedModalities: ['strength' as const], prescribedRunTypes: [], sleepHours: 7, wasFollowed: false },
        { date: new Date(2026, 6, 10), prescribedModalities: ['strength' as const], prescribedRunTypes: [], sleepHours: 7, wasFollowed: true },
        { date: new Date(2026, 6, 17), prescribedModalities: ['strength' as const], prescribedRunTypes: [], sleepHours: 7, wasFollowed: true },
      ],
      edits: [edit, { ...edit }, { ...edit }],
      easyRuns: [],
    }
    // One Friday of three dropped is 33%, under the pattern threshold — it
    // would have been 100% had the three items counted separately.
    expect(inferSkippedWeekdayModality(input)).toHaveLength(0)
  })
})

// ── Inference 2: easy runs drifting hot ───────────────────────────────────────

describe('inferEasyRunDrift', () => {
  function runs(hot: number, total: number, overshoot = 8) {
    return Array.from({ length: total }, (_, i) => ({
      date: new Date(2026, 6, 1 + i),
      z2CeilingHr: 145,
      avgHr: i < hot ? 145 + overshoot : 138,
    }))
  }

  it('proposes a stricter ceiling when easy runs keep coming in hot', () => {
    const drafts = inferEasyRunDrift({ decisions: [], edits: [], easyRuns: runs(5, 6) })
    expect(drafts[0]).toMatchObject({
      kind: 'tighten_easy_ceiling',
      tightenBpm: 8,
      confirmed: false,
    })
    expect(drafts[0].label).toContain('8 bpm')
  })

  it('shows the runs it is talking about', () => {
    const drafts = inferEasyRunDrift({ decisions: [], edits: [], easyRuns: runs(5, 6) })
    expect(drafts[0].evidence![0]).toContain('5 of the last 6 easy runs')
    expect(drafts[0].evidence!.length).toBeGreaterThan(1)
  })

  it('stays quiet when most easy runs are actually easy', () => {
    expect(inferEasyRunDrift({ decisions: [], edits: [], easyRuns: runs(1, 6) })).toHaveLength(0)
  })

  it('stays quiet below the minimum sample', () => {
    expect(inferEasyRunDrift({ decisions: [], edits: [], easyRuns: runs(2, 2) })).toHaveLength(0)
  })
})

// ── Inference 3: quality swapped after a short night ──────────────────────────

describe('inferQualitySwapAfterShortSleep', () => {
  function input(swaps: number, nights: number) {
    const decisions = []
    const edits = []
    for (let i = 0; i < nights; i++) {
      const date = new Date(2026, 6, 1 + i * 3)
      decisions.push({
        date,
        prescribedModalities: ['run' as const],
        prescribedRunTypes: ['vo2'],
        sleepHours: 5.2,
        wasFollowed: i >= swaps,
      })
      if (i < swaps) {
        edits.push({
          date,
          modality: 'run' as const,
          itemName: 'VO₂ intervals',
          runType: 'vo2',
          droppedOrSoftened: true,
          sleepHours: 5.2,
        })
      }
    }
    return { decisions, edits, easyRuns: [] }
  }

  it('proposes pre-empting the session rather than correcting it later', () => {
    const drafts = inferQualitySwapAfterShortSleep(input(4, 5))
    expect(drafts[0]).toMatchObject({
      kind: 'preempt_after_short_sleep',
      sleepHoursThreshold: 6,
      confirmed: false,
      source: 'inferred',
    })
  })

  it('ignores quality runs after a full night', () => {
    const slept = input(4, 5)
    for (const d of slept.decisions) d.sleepHours = 8
    for (const e of slept.edits) e.sleepHours = 8
    expect(inferQualitySwapAfterShortSleep(slept)).toHaveLength(0)
  })

  it('stays quiet when the sessions mostly get done', () => {
    expect(inferQualitySwapAfterShortSleep(input(1, 5))).toHaveLength(0)
  })

  it('respects a custom threshold', () => {
    const base = input(4, 5)
    expect(
      inferQualitySwapAfterShortSleep({ ...base, shortSleepHours: 5 }),
    ).toHaveLength(0)
  })
})

describe('inferPreferences', () => {
  it('returns nothing at all from an empty history', () => {
    expect(inferPreferences({ decisions: [], edits: [], easyRuns: [] })).toEqual([])
  })

  it('never returns a confirmed rule — confirmation is the athlete\'s (§13)', () => {
    const decisions = Array.from({ length: 6 }, (_, i) => ({
      date: new Date(2026, 6, 3 + i * 7),
      prescribedModalities: ['strength' as const],
      prescribedRunTypes: [],
      sleepHours: 7,
      wasFollowed: false,
    }))
    const edits = decisions.map((d) => ({
      date: d.date,
      modality: 'strength' as const,
      itemName: 'Back Squat',
      runType: null,
      droppedOrSoftened: true,
      sleepHours: 7,
    }))
    const drafts = inferPreferences({ decisions, edits, easyRuns: [] })
    expect(drafts.length).toBeGreaterThan(0)
    expect(drafts.every((d) => d.confirmed === false)).toBe(true)
    expect(drafts.every((d) => d.source === 'inferred')).toBe(true)
    expect(drafts.every((d) => d.evidence && d.evidence.length > 0)).toBe(true)
  })
})

describe('preferenceKey', () => {
  it('gives the same rule the same identity, so re-running updates rather than piles up', () => {
    const a = parseExplicitRule('no weights on weekends')!
    const b = parseExplicitRule('never lifting on weekends')!
    expect(preferenceKey(a)).toBe(preferenceKey(b))
  })
})

// ── Rows → observations ───────────────────────────────────────────────────────

describe('parseRecommendedItems', () => {
  it('flattens what the engine proposed', () => {
    const items = parseRecommendedItems(recommended([runItem('r1', 'easy', 145), liftItem('s1')]))
    expect(items).toEqual([
      { itemId: 'r1', kind: 'run', name: 'easy run', runType: 'easy', targetHrHigh: 145 },
      { itemId: 's1', kind: 'exercise', name: 'Back Squat', runType: null, targetHrHigh: null },
    ])
  })

  it('returns nothing from a corrupt blob rather than throwing', () => {
    expect(parseRecommendedItems('{{{')).toEqual([])
  })
})

describe('entryDroppedOrSoftened', () => {
  it('counts a removal', () => {
    expect(
      entryDroppedOrSoftened({ op: 'remove', itemId: 'x', name: 'x', before: '3×8', after: null }),
    ).toBe(true)
  })

  it('counts a modify that shrank the prescription', () => {
    expect(
      entryDroppedOrSoftened({
        op: 'modify',
        itemId: 'x',
        name: 'x',
        before: 'easy, 45 min',
        after: 'easy, 30 min',
      }),
    ).toBe(true)
  })

  it('does not count a modify that grew it', () => {
    expect(
      entryDroppedOrSoftened({
        op: 'modify',
        itemId: 'x',
        name: 'x',
        before: 'easy, 30 min',
        after: 'easy, 45 min',
      }),
    ).toBe(false)
  })

  it('does not count a reorder', () => {
    expect(
      entryDroppedOrSoftened({ op: 'reorder', itemId: 'b', name: 'Main', before: null, after: null }),
    ).toBe(false)
  })
})

describe('buildInferenceInput', () => {
  const date = new Date('2026-07-03T00:00:00')

  it('joins decisions, edits and sleep into observations', () => {
    const input = buildInferenceInput({
      decisions: [
        {
          date,
          recommendedSessionJson: recommended([runItem('r1', 'vo2'), liftItem('s1')]),
          wasFollowed: false,
        },
      ],
      edits: [
        {
          date,
          actor: 'user',
          entries: [{ op: 'remove', itemId: 'r1', name: 'vo2 run', before: 'vo2, 45 min', after: null }],
        },
      ],
      sleep: [{ date, sleepHours: 5.1 }],
      activities: [],
    })

    expect(input.decisions[0]).toMatchObject({
      prescribedModalities: ['run', 'strength'],
      prescribedRunTypes: ['vo2'],
      sleepHours: 5.1,
    })
    expect(input.edits[0]).toMatchObject({
      modality: 'run',
      runType: 'vo2',
      droppedOrSoftened: true,
      sleepHours: 5.1,
    })
  })

  it('ignores the engine\'s own edits — §13 learns from yours', () => {
    const input = buildInferenceInput({
      decisions: [{ date, recommendedSessionJson: recommended([liftItem('s1')]), wasFollowed: true }],
      edits: [
        {
          date,
          actor: 'engine',
          entries: [{ op: 'remove', itemId: 's1', name: 'Back Squat', before: '3×8', after: null }],
        },
      ],
      sleep: [],
      activities: [],
    })
    expect(input.edits).toHaveLength(0)
  })

  it('pairs an easy run with the ceiling it was actually prescribed against', () => {
    const input = buildInferenceInput({
      decisions: [
        { date, recommendedSessionJson: recommended([runItem('r1', 'easy', 145)]), wasFollowed: true },
      ],
      edits: [],
      sleep: [],
      activities: [{ date, type: 'running', avgHr: 152 }],
    })
    expect(input.easyRuns).toEqual([{ date: expect.any(Date), avgHr: 152, z2CeilingHr: 145 }])
  })

  it('ignores a run that was never prescribed a ceiling', () => {
    const input = buildInferenceInput({
      decisions: [
        { date, recommendedSessionJson: recommended([runItem('r1', 'easy', null)]), wasFollowed: true },
      ],
      edits: [],
      sleep: [],
      activities: [{ date, type: 'running', avgHr: 152 }],
    })
    expect(input.easyRuns).toHaveLength(0)
  })
})
