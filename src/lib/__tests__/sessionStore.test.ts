import { subDays } from 'date-fns'
import {
  DODGE_COMPLETION_SHARE,
  MAX_PATCH_OPS,
  RUN_TISSUES,
  buildValidationContext,
  computeQualityHistory,
  findSessionItem,
  isUntouched,
  itemCost,
  itemFacts,
  nigglesFromRegions,
  parseBlocks,
  parseEditHistory,
  parseEditRecord,
  parsePatchBody,
  plannedTotals,
  sanitizeItem,
  sanitizeParams,
  selectUndoTarget,
  serializeBlocks,
  summarizeDailyLoads,
  toEditableSession,
  wasYesterdayHard,
} from '../sessionStore'
import type {
  ActivityLoadRow,
  EditHistoryRow,
  QualityDayRow,
  SessionLoadRow,
  SessionRow,
} from '../sessionStore'
import { applySessionPatch, validateSessionPatch } from '../session'
import { computeDailyBudget } from '../load'
import { tissuesForRegion } from '../movementSession'
import type { SessionBlock, SessionItem } from '../../types/session'
import type { EditableSession, SessionPatch } from '../../types/patch'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TODAY = new Date('2026-05-20T08:00:00Z')

function lift(id = 'romanian-deadlift', weightKg: number | null = 60): SessionItem {
  return {
    id: `lift-${id}`,
    ref: { kind: 'exercise', id, name: id },
    params: { kind: 'strength', sets: 3, reps: 8, weightKg, targetRir: 2, restSec: 150 },
    status: 'prescribed',
  }
}

function run(durationMin = 40, runType = 'tempo'): SessionItem {
  return {
    id: `run-${runType}`,
    ref: { kind: 'run', id: runType, name: runType },
    params: { kind: 'run', runType, durationMin },
    status: 'prescribed',
  }
}

function prehab(id = 'eccentric-heel-drops'): SessionItem {
  return {
    id: `prehab-${id}`,
    ref: { kind: 'prehab', id, name: id },
    params: { kind: 'hold', sets: 3, reps: 12, holdSec: null, perSide: true },
    status: 'prescribed',
  }
}

function blocks(items: SessionItem[]): SessionBlock[] {
  return [{ id: 'block-main', kind: 'main', label: 'Main', items }]
}

function session(items: SessionItem[], over: Partial<EditableSession> = {}): EditableSession {
  return { id: 1, date: TODAY, status: 'draft', version: 1, blocks: blocks(items), ...over }
}

const BUDGET = computeDailyBudget({
  dailyLoads: new Array(28).fill(250),
  band: 'green',
  calibrating: false,
})

// ── itemFacts — the resolver the validator's rails depend on ─────────────────

describe('itemFacts', () => {
  it('resolves a key lift to tissues and the concurrent-training flag', () => {
    const facts = itemFacts(lift('back-squat'))
    expect(facts.modality).toBe('strength')
    expect(facts.heavyLowerBody).toBe(true)
    expect(facts.tissues).toContain('knee')
  })

  it('does not call bodyweight or calf work heavy lower body', () => {
    expect(itemFacts(lift('standing-calf-raise')).heavyLowerBody).toBe(false)
    expect(itemFacts(lift('dead-bug')).heavyLowerBody).toBe(false)
  })

  it('maps a hinge onto the posterior chain', () => {
    const facts = itemFacts(lift('romanian-deadlift'))
    expect(facts.tissues).toEqual(expect.arrayContaining(['hamstring', 'hip']))
  })

  it('gives running the whole lower body', () => {
    const facts = itemFacts(run())
    expect(facts.modality).toBe('run')
    expect(facts.heavyLowerBody).toBe(false)
    expect(facts.tissues).toEqual(RUN_TISSUES)
  })

  it('resolves plyo, prehab and stretch through their catalogs', () => {
    expect(itemFacts(prehab()).tissues).toContain('ankle_foot')
    expect(itemFacts(prehab()).modality).toBe('prehab')

    const plyo: SessionItem = {
      id: 'plyo-depth-jumps',
      ref: { kind: 'plyo', id: 'depth-jumps', name: 'Depth Jumps' },
      params: { kind: 'contacts', sets: 2, contactsPerSet: 5 },
      status: 'prescribed',
    }
    expect(itemFacts(plyo).tissues).toContain('knee')
    expect(itemFacts(plyo).heavyLowerBody).toBe(false)
  })

  it('degrades quietly for an exercise outside the curated set', () => {
    const facts = itemFacts(lift('some-machine-thing'))
    expect(facts.tissues).toEqual([])
    expect(facts.heavyLowerBody).toBe(false)
  })

  it('prices a tier-3 plyo above a tier-1 one', () => {
    const tier3: SessionItem = {
      id: 'a',
      ref: { kind: 'plyo', id: 'depth-jumps', name: 'Depth Jumps' },
      params: { kind: 'contacts', sets: 3, contactsPerSet: 5 },
      status: 'prescribed',
    }
    const tier1: SessionItem = {
      id: 'b',
      ref: { kind: 'plyo', id: 'pogo-jumps', name: 'Pogo Jumps' },
      params: { kind: 'contacts', sets: 3, contactsPerSet: 5 },
      status: 'prescribed',
    }
    expect(itemCost(tier3).hardness).toBeGreaterThan(itemCost(tier1).hardness)
  })
})

// ── The context assembly, and that it actually makes the rails fire ──────────

describe('buildValidationContext', () => {
  it('wires both callbacks through', () => {
    const context = buildValidationContext({ budget: BUDGET, band: 'green', calibrating: false })
    expect(typeof context.factsOf).toBe('function')
    expect(typeof context.costOf).toBe('function')
    expect(context.niggles).toEqual([])
    expect(context.tomorrow).toBeNull()
    expect(context.yesterdayHard).toBe(false)
  })

  it('makes the niggle rail bite — it is silent without factsOf', () => {
    const niggles = nigglesFromRegions([{ bodyRegion: 'knee', severity: 8, daysActive: 3 }])
    const context = buildValidationContext({
      budget: BUDGET,
      band: 'green',
      calibrating: false,
      niggles,
    })
    const patch: SessionPatch = {
      actor: 'user',
      ops: [
        {
          op: 'add',
          blockKind: 'main',
          item: lift('back-squat', 100),
          reason: 'I want to squat',
        },
      ],
    }

    const verdict = validateSessionPatch(session([prehab()]), patch, context)
    expect(verdict.kind).toBe('pushed_back')
    expect(verdict.findings.some((f) => f.rule === 'niggle_contraindicated')).toBe(true)

    // The same patch against a context with no factsOf sails through — which is
    // exactly the failure this resolver exists to prevent.
    const blind = { ...context, factsOf: undefined }
    expect(validateSessionPatch(session([prehab()]), patch, blind).kind).not.toBe('pushed_back')
  })

  it('will not let an override cross a painful tissue (§15)', () => {
    const context = buildValidationContext({
      budget: BUDGET,
      band: 'green',
      calibrating: false,
      niggles: nigglesFromRegions([{ bodyRegion: 'knee', severity: 9 }]),
    })
    const verdict = validateSessionPatch(
      session([prehab()]),
      {
        actor: 'user',
        override: true,
        ops: [{ op: 'add', blockKind: 'main', item: lift('back-squat', 100), reason: 'anyway' }],
      },
      context,
    )
    expect(verdict.kind).toBe('pushed_back')
  })

  it('makes the concurrent-training rail bite', () => {
    const context = buildValidationContext({
      budget: BUDGET,
      band: 'green',
      calibrating: false,
      tomorrow: { runType: 'long' },
    })
    const verdict = validateSessionPatch(
      session([prehab()]),
      {
        actor: 'user',
        ops: [{ op: 'add', blockKind: 'main', item: lift('back-squat', 100), reason: 'legs day' }],
      },
      context,
    )
    expect(verdict.findings.some((f) => f.rule === 'concurrent_training')).toBe(true)
  })

  it('leaves a calf raise alone on the same day', () => {
    const context = buildValidationContext({
      budget: BUDGET,
      band: 'green',
      calibrating: false,
      tomorrow: { runType: 'long' },
    })
    const verdict = validateSessionPatch(
      session([prehab()]),
      {
        actor: 'user',
        ops: [
          { op: 'add', blockKind: 'accessory', item: lift('standing-calf-raise', 40), reason: 'calves' },
        ],
      },
      context,
    )
    expect(verdict.findings.some((f) => f.rule === 'concurrent_training')).toBe(false)
  })

  it('carries the quality-dodging history into the verdict (§21)', () => {
    const context = buildValidationContext({
      budget: BUDGET,
      band: 'green',
      calibrating: false,
      qualityHistory: { prescribed: 6, dodged: 4, windowDays: 28 },
    })
    const verdict = validateSessionPatch(
      session([run(50, 'vo2')]),
      { actor: 'user', ops: [{ op: 'remove', itemId: 'run-vo2', reason: 'not feeling it' }] },
      context,
    )
    expect(verdict.findings.some((f) => f.rule === 'quality_dodging')).toBe(true)
  })
})

// ── Row mapping ──────────────────────────────────────────────────────────────

describe('session row mapping', () => {
  function row(over: Partial<SessionRow> = {}): SessionRow {
    return {
      id: 7,
      date: TODAY,
      status: 'draft',
      version: 2,
      blocksJson: serializeBlocks(blocks([lift()])),
      sourceOfLastEdit: 'user',
      ...over,
    }
  }

  it('round-trips blocks', () => {
    const parsed = parseBlocks(serializeBlocks(blocks([lift(), prehab()])))
    expect(parsed).toHaveLength(1)
    expect(parsed[0].items).toHaveLength(2)
  })

  it('accepts a bare array as well as the wrapped shape', () => {
    expect(parseBlocks(JSON.stringify(blocks([lift()])))).toHaveLength(1)
  })

  it('returns an empty session rather than throwing on a corrupt blob', () => {
    expect(parseBlocks('not json')).toEqual([])
    expect(parseBlocks('{"blocks": 4}')).toEqual([])
  })

  it('sorts blocks into canonical order', () => {
    const scrambled = JSON.stringify({
      blocks: [
        { id: 'c', kind: 'cooldown', label: 'Cooldown', items: [] },
        { id: 'w', kind: 'warmup', label: 'Warmup', items: [] },
      ],
    })
    expect(parseBlocks(scrambled).map((b) => b.kind)).toEqual(['warmup', 'cooldown'])
  })

  it('maps a row onto an EditableSession', () => {
    const editable = toEditableSession(row())
    expect(editable.id).toBe(7)
    expect(editable.version).toBe(2)
    expect(editable.status).toBe('draft')
    expect(editable.sourceOfLastEdit).toBe('user')
  })

  it('falls back on statuses and actors SQLite let through', () => {
    const editable = toEditableSession(row({ status: 'weird', sourceOfLastEdit: 'martian' }))
    expect(editable.status).toBe('draft')
    expect(editable.sourceOfLastEdit).toBeNull()
  })

  it('knows an untouched engine session from an edited one', () => {
    expect(isUntouched({ version: 1, sourceOfLastEdit: 'engine' })).toBe(true)
    expect(isUntouched({ version: 2, sourceOfLastEdit: 'engine' })).toBe(false)
    expect(isUntouched({ version: 1, sourceOfLastEdit: 'user' })).toBe(false)
  })

  it('prices a set of blocks in the one currency', () => {
    const totals = plannedTotals(blocks([run(40, 'easy'), prehab()]))
    expect(totals.plannedLoad).toBeGreaterThan(0)
    expect(totals.plannedDurationMin).toBeGreaterThan(40)
  })

  it('finds an item across blocks', () => {
    const all: SessionBlock[] = [
      { id: 'w', kind: 'warmup', label: 'Warmup', items: [prehab()] },
      { id: 'm', kind: 'main', label: 'Main', items: [lift()] },
    ]
    expect(findSessionItem(all, 'lift-romanian-deadlift')?.ref.id).toBe('romanian-deadlift')
    expect(findSessionItem(all, 'nope')).toBeNull()
  })
})

// ── Daily loads ──────────────────────────────────────────────────────────────

describe('summarizeDailyLoads', () => {
  function s(daysAgo: number, over: Partial<SessionLoadRow> = {}): SessionLoadRow {
    return {
      date: subDays(TODAY, daysAgo),
      plannedLoad: 200,
      actualLoad: null,
      status: 'draft',
      ...over,
    }
  }
  function a(daysAgo: number, trimp: number, durationMin = 40): ActivityLoadRow {
    return { date: subDays(TODAY, daysAgo), durationMin, trimp }
  }

  it('returns a dense series ending on the end date', () => {
    const { dailyLoads } = summarizeDailyLoads([s(0)], [], TODAY, 7)
    expect(dailyLoads).toHaveLength(7)
    expect(dailyLoads[6]).toBe(200)
  })

  it('counts rest days as real zeros', () => {
    const { dailyLoads } = summarizeDailyLoads([s(3)], [], TODAY, 7)
    expect(dailyLoads.filter((v) => v === 0)).toHaveLength(6)
  })

  it('maxes session against activity rather than summing — a run is both', () => {
    // A 200-load session and a 60-TRIMP run (=120) on the same day is one day
    // of training, not 320.
    const { dailyLoads } = summarizeDailyLoads([s(0)], [a(0, 60)], TODAY, 7)
    expect(dailyLoads[6]).toBe(200)
  })

  it('takes the activity when it is the bigger of the two', () => {
    const { dailyLoads } = summarizeDailyLoads([s(0, { plannedLoad: 50 })], [a(0, 200)], TODAY, 7)
    expect(dailyLoads[6]).toBe(400)
  })

  it('prefers a completed session actual over its plan', () => {
    const { dailyLoads } = summarizeDailyLoads(
      [s(0, { actualLoad: 90, status: 'completed' })],
      [],
      TODAY,
      7,
    )
    expect(dailyLoads[6]).toBe(90)
  })

  it('counts a completed-but-unpriced session as zero, not as its plan', () => {
    const { dailyLoads } = summarizeDailyLoads([s(0, { status: 'completed' })], [], TODAY, 7)
    expect(dailyLoads[6]).toBe(0)
  })

  it('marks a day hard on intensity, not on total', () => {
    // 400 TRIMP over 40 min = load 800, i.e. sRPE 20/min — plainly hard.
    const { recentDays } = summarizeDailyLoads([], [a(1, 400, 40)], TODAY, 7)
    expect(wasYesterdayHard(recentDays, TODAY)).toBe(true)
  })

  it('does not call a long easy day hard', () => {
    const { recentDays } = summarizeDailyLoads([], [a(1, 100, 120)], TODAY, 7)
    expect(wasYesterdayHard(recentDays, TODAY)).toBe(false)
  })

  it("reads the athlete's own sRPE off a session row", () => {
    const { recentDays } = summarizeDailyLoads(
      [s(1, { srpe: 8, actualLoad: 400, status: 'completed' })],
      [],
      TODAY,
      7,
    )
    expect(wasYesterdayHard(recentDays, TODAY)).toBe(true)
  })

  it('ignores rows outside the window', () => {
    const { dailyLoads } = summarizeDailyLoads([s(90)], [a(90, 300)], TODAY, 7)
    expect(dailyLoads.reduce((x, y) => x + y, 0)).toBe(0)
  })
})

// ── Quality history ──────────────────────────────────────────────────────────

describe('computeQualityHistory', () => {
  function q(daysAgo: number, over: Partial<QualityDayRow> = {}): QualityDayRow {
    return {
      date: subDays(TODAY, daysAgo),
      prescribedHardness: 8,
      completedShare: 1,
      wasFollowed: true,
      ...over,
    }
  }

  it('counts only the days that were prescribed hard', () => {
    const history = computeQualityHistory([q(1), q(2, { prescribedHardness: 4 })], TODAY)
    expect(history.prescribed).toBe(1)
  })

  it('counts a not-followed day as dodged', () => {
    expect(computeQualityHistory([q(1, { wasFollowed: false })], TODAY).dodged).toBe(1)
  })

  it('counts a session cut in half as dodged too', () => {
    const history = computeQualityHistory(
      [q(1, { completedShare: DODGE_COMPLETION_SHARE - 0.2 })],
      TODAY,
    )
    expect(history.dodged).toBe(1)
  })

  it('does not count a session that was merely trimmed a little', () => {
    expect(
      computeQualityHistory([q(1, { completedShare: DODGE_COMPLETION_SHARE + 0.1 })], TODAY).dodged,
    ).toBe(0)
  })

  it('does not count a session that has not happened yet', () => {
    expect(computeQualityHistory([q(1, { completedShare: null })], TODAY).dodged).toBe(0)
  })

  it('ignores anything outside the window', () => {
    expect(computeQualityHistory([q(90, { wasFollowed: false })], TODAY).prescribed).toBe(0)
  })

  it('reports the window it used', () => {
    expect(computeQualityHistory([], TODAY, 14).windowDays).toBe(14)
  })
})

// ── Undo ─────────────────────────────────────────────────────────────────────

describe('edit history and undo selection', () => {
  function row(id: number, record: Record<string, unknown>): EditHistoryRow {
    return {
      id,
      sessionId: 1,
      version: id + 1,
      actor: 'user',
      diffJson: JSON.stringify(record),
      reason: `edit ${id}`,
      timestamp: subDays(TODAY, 0),
    }
  }

  const inverse = { actor: 'user', ops: [{ op: 'remove', itemId: 'x', reason: 'undo' }] }

  it('parses a record, and survives a corrupt one', () => {
    expect(parseEditRecord('{}').inverse).toBeNull()
    expect(parseEditRecord('garbage').findings).toEqual([])
    expect(parseEditRecord(JSON.stringify({ undoOf: 3 })).undoOf).toBe(3)
  })

  it('picks the newest reversible edit', () => {
    const parsed = parseEditHistory([row(3, { inverse }), row(2, { inverse }), row(1, { inverse })])
    expect(selectUndoTarget(parsed)?.id).toBe(3)
  })

  it('reaches past an undo to the edit before it', () => {
    const parsed = parseEditHistory([
      row(4, { undoOf: 3 }),
      row(3, { inverse }),
      row(2, { inverse }),
    ])
    expect(selectUndoTarget(parsed)?.id).toBe(2)
  })

  it('reaches past two undos', () => {
    const parsed = parseEditHistory([
      row(5, { undoOf: 2 }),
      row(4, { undoOf: 3 }),
      row(3, { inverse }),
      row(2, { inverse }),
      row(1, { inverse }),
    ])
    expect(selectUndoTarget(parsed)?.id).toBe(1)
  })

  it('returns nothing when there is nothing left to undo', () => {
    expect(selectUndoTarget(parseEditHistory([row(2, { undoOf: 1 }), row(1, { inverse })]))).toBeNull()
    expect(selectUndoTarget([])).toBeNull()
  })

  it('skips an entry with an empty inverse', () => {
    const parsed = parseEditHistory([row(2, { inverse: { actor: 'user', ops: [] } }), row(1, { inverse })])
    expect(selectUndoTarget(parsed)?.id).toBe(1)
  })

  it("replays an inverse to the session it started from", () => {
    const context = buildValidationContext({ budget: BUDGET, band: 'green', calibrating: false })
    const start = session([lift(), prehab()])
    const applied = applySessionPatch(
      start,
      { actor: 'user', ops: [{ op: 'remove', itemId: 'lift-romanian-deadlift', reason: 'sore' }] },
      context,
    )
    expect(applied.applied).toBe(true)
    expect(applied.session.blocks[0].items).toHaveLength(1)

    const undone = applySessionPatch(applied.session, applied.inverse!, context)
    expect(undone.applied).toBe(true)
    expect(undone.session.blocks[0].items.map((i) => i.id).sort()).toEqual(
      start.blocks[0].items.map((i) => i.id).sort(),
    )
    expect(undone.session.version).toBe(start.version + 2)
  })
})

// ── Request validation ───────────────────────────────────────────────────────

describe('parsePatchBody', () => {
  const removeOp = { op: 'remove', itemId: 'lift-romanian-deadlift', reason: 'sore knee' }

  it('accepts a well-formed patch', () => {
    const { patch, error } = parsePatchBody({ actor: 'user', patch: { ops: [removeOp] } })
    expect(error).toBeNull()
    expect(patch?.actor).toBe('user')
    expect(patch?.ops).toHaveLength(1)
  })

  it('accepts a bare ops array as the patch', () => {
    expect(parsePatchBody({ actor: 'coach', patch: [removeOp] }).patch?.ops).toHaveLength(1)
  })

  it('refuses a non-object body', () => {
    expect(parsePatchBody(null).error).toBeTruthy()
    expect(parsePatchBody('hello').error).toBeTruthy()
    expect(parsePatchBody([1, 2]).error).toBeTruthy()
  })

  it('refuses an actor that is not the user or the coach', () => {
    expect(parsePatchBody({ actor: 'engine', patch: [removeOp] }).error).toBeTruthy()
    expect(parsePatchBody({ patch: [removeOp] }).error).toBeTruthy()
  })

  it('refuses an empty or oversized op list', () => {
    expect(parsePatchBody({ actor: 'user', patch: { ops: [] } }).error).toBeTruthy()
    const many = new Array(MAX_PATCH_OPS + 1).fill(removeOp)
    expect(parsePatchBody({ actor: 'user', patch: { ops: many } }).error).toBeTruthy()
  })

  it('requires a reason on every op, or one for the whole patch', () => {
    const noReason = { op: 'remove', itemId: 'x' }
    expect(parsePatchBody({ actor: 'user', patch: [noReason] }).error).toBeTruthy()
    const withFallback = parsePatchBody({
      actor: 'user',
      reason: 'make today easier',
      patch: [noReason],
    })
    expect(withFallback.patch?.ops[0].reason).toBe('make today easier')
  })

  it('refuses an unknown op', () => {
    expect(parsePatchBody({ actor: 'user', patch: [{ op: 'nuke', reason: 'x' }] }).error).toBeTruthy()
  })

  it('carries an override through only when it is literally true', () => {
    expect(parsePatchBody({ actor: 'user', patch: [removeOp], override: true }).patch?.override).toBe(true)
    expect(parsePatchBody({ actor: 'user', patch: [removeOp], override: 'yes' }).patch?.override).toBeUndefined()
  })

  it('validates an added item and its params', () => {
    const good = parsePatchBody({
      actor: 'user',
      patch: [
        {
          op: 'add',
          blockKind: 'accessory',
          reason: 'add calves',
          item: {
            id: 'lift-standing-calf-raise',
            ref: { kind: 'exercise', id: 'standing-calf-raise', name: 'Standing Calf Raise' },
            params: { kind: 'strength', sets: 3, reps: 12, weightKg: 40, targetRir: 2 },
            status: 'prescribed',
          },
        },
      ],
    })
    expect(good.error).toBeNull()

    const badBlock = parsePatchBody({
      actor: 'user',
      patch: [{ op: 'add', blockKind: 'finisher', reason: 'x', item: {} }],
    })
    expect(badBlock.error).toBeTruthy()
  })

  it('refuses out-of-range params', () => {
    expect(sanitizeParams({ kind: 'strength', sets: 999, reps: 8, targetRir: 2 }, false)).toBeNull()
    expect(sanitizeParams({ kind: 'strength', sets: 3, reps: 8, weightKg: 9000, targetRir: 2 }, false)).toBeNull()
    expect(sanitizeParams({ kind: 'contacts', sets: 3, contactsPerSet: -1 }, false)).toBeNull()
    expect(sanitizeParams({ kind: 'hold', sets: 2, holdSec: 100000 }, false)).toBeNull()
    expect(sanitizeParams({ kind: 'nonsense' }, false)).toBeNull()
  })

  it('lets a partial params patch through for a modify', () => {
    expect(sanitizeParams({ kind: 'strength', sets: 2 }, true)).toEqual({ kind: 'strength', sets: 2 })
    expect(sanitizeParams({ kind: 'strength', sets: 2 }, false)).toBeNull()
  })

  it('keeps the params kind immutable — a swap is not an edit', () => {
    const parsed = parsePatchBody({
      actor: 'user',
      patch: [
        { op: 'modify', itemId: 'lift-x', reason: 'lighter', params: { kind: 'run', durationMin: 20 } },
      ],
    })
    // Parsing accepts it; the validator is what refuses the kind change, and
    // that refusal is its own rule with its own message.
    expect(parsed.error).toBeNull()
    const context = buildValidationContext({ budget: BUDGET, band: 'green', calibrating: false })
    const verdict = validateSessionPatch(
      session([{ ...lift(), id: 'lift-x' }]),
      parsed.patch!,
      context,
    )
    expect(verdict.findings.some((f) => f.rule === 'kind_change')).toBe(true)
  })

  it('refuses an item missing its reference', () => {
    expect(sanitizeItem({ id: 'x', params: { kind: 'hold', sets: 1 } })).toBeNull()
    expect(sanitizeItem({ id: 'x', ref: { kind: 'wand', id: 'y', name: 'z' }, params: { kind: 'hold', sets: 1 } })).toBeNull()
  })

  it('clips over-long free text rather than rejecting the edit', () => {
    const { patch } = parsePatchBody({
      actor: 'user',
      patch: [{ op: 'remove', itemId: 'x', reason: 'y'.repeat(5000) }],
    })
    expect(patch?.ops[0].reason.length).toBeLessThanOrEqual(500)
  })

  it('validates a reorder', () => {
    expect(
      parsePatchBody({
        actor: 'user',
        patch: [{ op: 'reorder', blockKind: 'main', itemIds: ['a', 'b'], reason: 'run first' }],
      }).error,
    ).toBeNull()
    expect(
      parsePatchBody({
        actor: 'user',
        patch: [{ op: 'reorder', blockKind: 'main', itemIds: [], reason: 'x' }],
      }).error,
    ).toBeTruthy()
  })
})

describe('nigglesFromRegions', () => {
  it('speaks the tissue vocabulary the items are tagged with', () => {
    const [niggle] = nigglesFromRegions([{ bodyRegion: 'hip', severity: 5, daysActive: 2 }])
    expect(niggle.tissues).toEqual(tissuesForRegion('hip'))
    expect(niggle.severity).toBe(5)
  })

  it('funnels an unknown region to `other` rather than inventing one', () => {
    expect(nigglesFromRegions([{ bodyRegion: 'elbow', severity: 3 }])[0].bodyRegion).toBe('other')
  })
})

// ── One ceiling, and the edit that makes an over-budget day smaller ──────────
//
// `reconcileBudget` used to widen the *validation* ceiling by the near-free load
// so that a day the allocator had over-spent did not push back every later edit,
// including edits that made the day smaller. The allocator's near-free exemption
// is bounded now (§9's "small dose", `NEAR_FREE_ALLOWANCE`), so there is one
// ceiling again — but the property that widening protected is real and survives
// it, in the validator, where both actors hit the same rule.

describe('an edit that shrinks an over-budget day', () => {
  const mobility: SessionItem = {
    id: 'stretch-cooldown-pigeon-pose',
    ref: { kind: 'stretch', id: 'pigeon-pose', name: 'Pigeon Pose' },
    params: { kind: 'hold', sets: 1, reps: null, holdSec: 30, perSide: true },
    status: 'prescribed',
  }

  /** A day of nothing but cheap work that still costs more than a tight ceiling. */
  const many = new Array(12).fill(null).map((_, i) => ({ ...mobility, id: `m-${i}` }))
  const tight = computeDailyBudget({
    dailyLoads: new Array(28).fill(12),
    band: 'amber',
    calibrating: true,
  })
  const day = session(many)
  const context = buildValidationContext({ budget: tight, band: 'amber', calibrating: true })

  it('is never pushed back for being over budget', () => {
    const shrink: SessionPatch = {
      actor: 'user',
      ops: [{ op: 'remove', itemId: 'm-0', reason: 'short on time' }],
    }
    expect(validateSessionPatch(day, shrink, context).kind).not.toBe('pushed_back')
  })

  it('says the day is still over the ceiling rather than swallowing it', () => {
    const shrink: SessionPatch = {
      actor: 'user',
      ops: [{ op: 'remove', itemId: 'm-0', reason: 'short on time' }],
    }
    const verdict = validateSessionPatch(day, shrink, context)
    expect(verdict.findings.some((f) => f.rule === 'load_ceiling')).toBe(true)
    expect(verdict.findings.every((f) => f.rule !== 'load_ceiling' || f.severity !== 'block')).toBe(true)
  })

  it('still refuses an edit that makes the same day bigger', () => {
    const grow: SessionPatch = {
      actor: 'user',
      ops: [
        {
          op: 'add',
          blockKind: 'main',
          item: { ...mobility, id: 'm-extra' },
          reason: 'one more',
        },
      ],
    }
    const verdict = validateSessionPatch(day, grow, context)
    expect(verdict.kind).toBe('pushed_back')
    expect(verdict.findings.some((f) => f.rule === 'load_ceiling' && f.severity === 'block')).toBe(true)
  })

  it('leaves a day inside its budget alone either way', () => {
    const roomy = buildValidationContext({ budget: BUDGET, band: 'green', calibrating: false })
    const shrink: SessionPatch = {
      actor: 'user',
      ops: [{ op: 'remove', itemId: 'm-0', reason: 'short on time' }],
    }
    const verdict = validateSessionPatch(day, shrink, roomy)
    expect(verdict.findings.some((f) => f.rule === 'load_ceiling')).toBe(false)
  })
})
