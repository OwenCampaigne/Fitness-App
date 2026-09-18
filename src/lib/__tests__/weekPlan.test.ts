// ── The week ahead ────────────────────────────────────────────────────────────
// Framework §10 step 5, §11, §3. The DB half of `weekPlan` is a loop over
// `gatherToday`; what is worth asserting is the judgement it makes on each pass,
// and every one of those is pure.
//
// The load-bearing one is `shouldRegenerate`. Everything else in the feature is
// a convenience; that predicate is the promise that a session you moved by hand
// on Monday is still where you put it on Thursday.

import {
  FUTURE_BAND,
  WEEK_DAYS,
  acwrTrajectory,
  destinationBlockKind,
  moveItemOps,
  parseEditableDate,
  shouldRegenerate,
  summarizeBlocks,
  weekDates,
  weekTotals,
} from '../weekPlan'
import { itemCost } from '../sessionStore'
import { HARD_DAY_SRPE } from '../load'
import type { SessionBlock, SessionItem } from '../../types/session'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MONDAY = new Date(2026, 8, 14) // local, because weekDates reads local days

function run(over: Partial<SessionItem> = {}, durationMin = 75): SessionItem {
  return {
    id: 'run-long',
    ref: { kind: 'run', id: 'long', name: 'Long run' },
    params: { kind: 'run', runType: 'long', durationMin },
    status: 'prescribed',
    ...over,
  }
}

function lift(id = 'back-squat', name = 'Back squat'): SessionItem {
  return {
    id,
    ref: { kind: 'exercise', id, name },
    params: { kind: 'strength', sets: 3, reps: 5, weightKg: 60, targetRir: 2 },
    status: 'prescribed',
  }
}

function prehab(id = 'calf-raise'): SessionItem {
  return {
    id,
    ref: { kind: 'prehab', id, name: 'Calf raise' },
    params: { kind: 'hold', sets: 2, reps: 12 },
    status: 'prescribed',
  }
}

function blocks(main: SessionItem[], accessory: SessionItem[] = []): SessionBlock[] {
  return [
    { id: 'b-main', kind: 'main', label: 'Main', items: main },
    ...(accessory.length > 0
      ? [{ id: 'b-acc', kind: 'accessory' as const, label: 'Accessory', items: accessory }]
      : []),
  ]
}

// ── Dates ────────────────────────────────────────────────────────────────────

describe('weekDates', () => {
  it('is today plus the six days you can still rearrange', () => {
    const dates = weekDates(MONDAY)
    expect(dates).toHaveLength(WEEK_DAYS)
    expect(dates[0].getDate()).toBe(14)
    expect(dates[6].getDate()).toBe(20)
  })

  it('starts at midnight whatever time of day it is asked', () => {
    const [first] = weekDates(new Date(2026, 8, 14, 22, 41))
    expect(first.getHours()).toBe(0)
    expect(first.getMinutes()).toBe(0)
  })
})

describe('parseEditableDate', () => {
  it('defaults to today when nothing is asked for', () => {
    expect(parseEditableDate(undefined, MONDAY)?.getDate()).toBe(14)
    expect(parseEditableDate(null, MONDAY)?.getDate()).toBe(14)
  })

  it('accepts every day of the window', () => {
    for (const date of weekDates(MONDAY)) {
      expect(parseEditableDate(date.toISOString(), MONDAY)).not.toBeNull()
    }
  })

  it('refuses the past — that is history, not a plan', () => {
    expect(parseEditableDate(new Date(2026, 8, 13).toISOString(), MONDAY)).toBeNull()
  })

  it('refuses past the end of the window', () => {
    expect(parseEditableDate(new Date(2026, 8, 21).toISOString(), MONDAY)).toBeNull()
  })

  it('refuses rubbish rather than guessing at it', () => {
    expect(parseEditableDate('not a date', MONDAY)).toBeNull()
    expect(parseEditableDate(42, MONDAY)).toBeNull()
    expect(parseEditableDate({ date: 'today' }, MONDAY)).toBeNull()
  })
})

// ── The invariant (§11) ──────────────────────────────────────────────────────

describe('shouldRegenerate', () => {
  it('builds a day that has no session yet', () => {
    expect(shouldRegenerate(null)).toBe(true)
    expect(shouldRegenerate(undefined)).toBe(true)
  })

  it('rebuilds an untouched engine-written day', () => {
    expect(shouldRegenerate({ version: 1, sourceOfLastEdit: 'engine' })).toBe(true)
  })

  it('never rebuilds a day the athlete edited — the moved long run survives', () => {
    expect(shouldRegenerate({ version: 2, sourceOfLastEdit: 'user' })).toBe(false)
  })

  it('never rebuilds a day the coach edited either', () => {
    expect(shouldRegenerate({ version: 2, sourceOfLastEdit: 'coach' })).toBe(false)
  })

  it('treats a bumped version as edited even if the actor was recorded as the engine', () => {
    // Belt and braces: an actor column that lost its value must not read as
    // "never touched", because that is the one way an override gets discarded.
    expect(shouldRegenerate({ version: 3, sourceOfLastEdit: 'engine' })).toBe(false)
    expect(shouldRegenerate({ version: 1, sourceOfLastEdit: null })).toBe(false)
  })

  it('plans days past today at the shape the plan wants, not at today’s band', () => {
    expect(FUTURE_BAND).toBe('green')
  })
})

// ── What a day adds up to ────────────────────────────────────────────────────

describe('summarizeBlocks', () => {
  it('reports the mix in a stable order whatever order the blocks came in', () => {
    const summary = summarizeBlocks(blocks([lift(), run()], [prehab()]), itemCost)
    expect(summary.modalities).toEqual(['run', 'strength', 'prehab'])
    expect(summary.itemCount).toBe(3)
  })

  it('names the main block’s movements as the day’s shape', () => {
    const summary = summarizeBlocks(blocks([run(), lift()], [prehab()]), itemCost)
    expect(summary.headline).toEqual(['Long run', 'Back squat'])
  })

  it('picks the run type out so the week can show what kind of day it is', () => {
    expect(summarizeBlocks(blocks([run()]), itemCost).runType).toBe('long')
    expect(summarizeBlocks(blocks([lift()]), itemCost).runType).toBeNull()
  })

  it('calls a day hard by the same threshold the back-to-back rail uses', () => {
    const vo2: SessionItem = {
      id: 'run-vo2',
      ref: { kind: 'run', id: 'vo2', name: 'VO2 intervals' },
      params: { kind: 'run', runType: 'vo2', durationMin: 45 },
      status: 'prescribed',
    }
    const easy: SessionItem = {
      id: 'run-easy',
      ref: { kind: 'run', id: 'easy', name: 'Easy run' },
      params: { kind: 'run', runType: 'easy', durationMin: 45 },
      status: 'prescribed',
    }
    expect(summarizeBlocks(blocks([vo2]), itemCost).hard).toBe(true)
    expect(summarizeBlocks(blocks([easy]), itemCost).hard).toBe(false)
    expect(HARD_DAY_SRPE).toBe(7)
  })

  it('reads an empty day as a rest day rather than as missing data', () => {
    const summary = summarizeBlocks([], itemCost)
    expect(summary.itemCount).toBe(0)
    expect(summary.plannedLoad).toBe(0)
    expect(summary.hard).toBe(false)
    expect(summary.modalities).toEqual([])
  })
})

// ── Where the week is heading (§3) ───────────────────────────────────────────

describe('acwrTrajectory', () => {
  const steady = new Array(28).fill(100) as number[]

  it('gives one figure per planned day', () => {
    expect(acwrTrajectory(steady, [100, 100, 100])).toHaveLength(3)
  })

  it('holds the band flat when the week matches the chronic load', () => {
    for (const acwr of acwrTrajectory(steady, new Array(7).fill(100))) {
      expect(acwr).toBeCloseTo(1, 1)
    }
  })

  it('climbs when the week ramps — the point of showing it days ahead', () => {
    const climbing = acwrTrajectory(steady, new Array(7).fill(220))
    expect(climbing[6]).toBeGreaterThan(climbing[0])
    expect(climbing[6]).toBeGreaterThan(1.3)
  })

  it('falls when the week is emptier than the block behind it', () => {
    const falling = acwrTrajectory(steady, new Array(7).fill(0))
    expect(falling[6]).toBeLessThan(0.8)
  })
})

describe('weekTotals', () => {
  const steady = new Array(28).fill(100) as number[]

  it('adds the week up and counts what kind of days it is made of', () => {
    const summaries = [
      summarizeBlocks(blocks([run()]), itemCost),
      summarizeBlocks([], itemCost),
      summarizeBlocks(blocks([lift()]), itemCost),
    ]
    const totals = weekTotals(summaries, steady)
    expect(totals.totalLoad).toBe(
      summaries.reduce((a, s) => a + s.plannedLoad, 0),
    )
    expect(totals.restDays).toBe(1)
    expect(totals.acwr).toHaveLength(3)
  })

  it('ends on the zone the last planned day actually lands in', () => {
    const big = summarizeBlocks(blocks([run({}, 240)]), itemCost)
    const totals = weekTotals(new Array(7).fill(big), steady)
    expect(['caution', 'danger']).toContain(totals.zoneEnd)
    expect(totals.acwrEnd).toBe(totals.acwr[6])
  })
})

// ── Moving a session to another day (§11) ────────────────────────────────────

describe('moveItemOps', () => {
  it('is an add over there and a remove over here', () => {
    const item = run()
    const { add, remove } = moveItemOps(item, blocks([lift()]), 'main', 'to Saturday')
    expect(add.op).toBe('add')
    expect(add.blockKind).toBe('main')
    expect(add.item.ref.name).toBe('Long run')
    expect(remove.op).toBe('remove')
    expect(remove.itemId).toBe('run-long')
    expect(add.reason).toBe('to Saturday')
    expect(remove.reason).toBe('to Saturday')
  })

  it('lands as prescribed, whatever it was on the day it left', () => {
    const { add } = moveItemOps(run({ status: 'skipped' }), [], 'main', 'r')
    expect(add.item.status).toBe('prescribed')
  })

  it('suffixes an id the destination has already taken', () => {
    // Item ids are unique within a session, not across them — two easy runs on
    // two days share `run-easy`, and a collision would make every later patch
    // against that day ambiguous.
    const item = run({ id: 'run-easy' })
    const destination = blocks([run({ id: 'run-easy' })])
    const { add, remove } = moveItemOps(item, destination, 'main', 'r')
    expect(add.item.id).toBe('run-easy-2')
    // The remove still names the id on the *source* day.
    expect(remove.itemId).toBe('run-easy')
  })

  it('keeps suffixing until it finds a free id', () => {
    const destination = blocks([run({ id: 'x' }), run({ id: 'x-2' }), run({ id: 'x-3' })])
    expect(moveItemOps(run({ id: 'x' }), destination, 'main', 'r').add.item.id).toBe('x-4')
  })
})

describe('destinationBlockKind', () => {
  it('keeps an item in the kind of block it was already in', () => {
    const item = prehab()
    expect(destinationBlockKind(item, blocks([run()], [item]))).toBe('accessory')
  })

  it('falls back to the main block when the item is not found', () => {
    expect(destinationBlockKind(run(), blocks([lift()]))).toBe('main')
  })
})
