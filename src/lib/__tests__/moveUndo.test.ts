// ── Undoing a move (framework §11) ────────────────────────────────────────────
// §11 promises every edit is "versioned + reversible". A move is the one edit
// that is not one row: it is an `add` on the destination day and a `remove` on
// the source, written to two different sessions. Reversing one alone is not a
// partial undo, it is corruption — undo the destination and the session is on
// *neither* day, undo the source and it is on *both*, double-counting against
// the §3 load currency in a week that now has two long runs in it.
//
// So these tests are about the pair. Both halves carry one `groupId`; undoing
// from either end reverses both; a day that has moved on underneath the move
// refuses the whole undo rather than half of it; and an ordinary single-day
// edit still reverses exactly one day and writes exactly one row, which is what
// the Today screen's bare `POST /undo` has always done.
//
// The `session` and `edit_history` tables are stood up in memory, because every
// claim here is a claim about rows: which rows share a group, which rows were
// written, and — for the refusal — that none were.

import { addDays, startOfDay } from 'date-fns'

jest.mock('../db', () => ({
  prisma: {
    session: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    edit_history: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '../db'
import {
  applyPatchToSession,
  buildValidationContext,
  parseBlocks,
  serializeBlocks,
  toEditableSession,
  undoLastEdit,
} from '../sessionStore'
import type { SessionRow } from '../sessionStore'
import { destinationBlockKind, moveItemOps } from '../weekPlan'
import { computeDailyBudget } from '../load'
import type { SessionBlock, SessionItem } from '../../types/session'
import type { EditableSession } from '../../types/patch'
import type { ValidationContext } from '../session'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TODAY = startOfDay(new Date(2026, 4, 20))
const SATURDAY = addDays(TODAY, 3)

const BUDGET = computeDailyBudget({
  dailyLoads: new Array(28).fill(320),
  band: 'green',
  calibrating: false,
})

const CONTEXT: ValidationContext = buildValidationContext({
  budget: BUDGET,
  band: 'green',
  calibrating: false,
})

function longRun(): SessionItem {
  return {
    id: 'run-long',
    ref: { kind: 'run', id: 'long', name: 'Long run' },
    params: { kind: 'run', runType: 'easy', durationMin: 50 },
    status: 'prescribed',
  }
}

function mobility(): SessionItem {
  return {
    id: 'stretch-calf',
    ref: { kind: 'stretch', id: 'calf-wall', name: 'Calf wall stretch' },
    params: { kind: 'hold', sets: 2, reps: 1, holdSec: 30, perSide: true },
    status: 'prescribed',
  }
}

function blocks(items: SessionItem[]): SessionBlock[] {
  return [{ id: 'block-main', kind: 'main', label: 'Main', items }]
}

// ── An in-memory `session` + `edit_history` ──────────────────────────────────

interface EditRow {
  id: number
  sessionId: number
  version: number
  actor: string
  diffJson: string
  reason: string | null
  groupId: string | null
  timestamp: Date
}

let sessions: SessionRow[] = []
let edits: EditRow[] = []
let nextEditId = 1

function install() {
  sessions = [
    {
      id: 1,
      date: TODAY,
      status: 'draft',
      version: 1,
      blocksJson: serializeBlocks(blocks([longRun(), mobility()])),
      sourceOfLastEdit: 'engine',
    },
    {
      id: 2,
      date: SATURDAY,
      status: 'draft',
      version: 1,
      blocksJson: serializeBlocks(blocks([mobility()])),
      sourceOfLastEdit: 'engine',
    },
  ]
  edits = []
  nextEditId = 1

  const s = prisma.session as unknown as Record<string, jest.Mock>
  s.findMany.mockImplementation(async (args?: { where?: { id?: { in: number[] } } }) => {
    const ids = args?.where?.id?.in
    return sessions.filter((row) => !ids || ids.includes(row.id)).map((row) => ({ ...row }))
  })
  s.update.mockImplementation(
    async (args: { where: { id: number }; data: Record<string, unknown> }) => {
      const row = sessions.find((r) => r.id === args.where.id)
      if (!row) throw new Error(`no session ${args.where.id}`)
      Object.assign(row, args.data)
      return { ...row }
    },
  )

  const e = prisma.edit_history as unknown as Record<string, jest.Mock>
  e.create.mockImplementation(async (args: { data: Omit<EditRow, 'id' | 'timestamp'> }) => {
    const row: EditRow = { id: nextEditId++, timestamp: new Date(), ...args.data }
    edits.push(row)
    return { ...row }
  })
  e.findMany.mockImplementation(
    async (args: {
      where: { sessionId?: number; groupId?: string }
      orderBy?: { id?: 'asc' | 'desc' }
    }) => {
      const { sessionId, groupId } = args.where
      const found = edits.filter(
        (row) =>
          (sessionId === undefined || row.sessionId === sessionId) &&
          (groupId === undefined || row.groupId === groupId),
      )
      const dir = args.orderBy?.id === 'desc' ? -1 : 1
      return [...found].sort((a, b) => dir * (a.id - b.id)).map((row) => ({ ...row }))
    },
  )
}

function read(id: number): EditableSession {
  const row = sessions.find((r) => r.id === id)
  if (!row) throw new Error(`no session ${id}`)
  return toEditableSession(row)
}

function itemIds(id: number): string[] {
  return parseBlocks(sessions.find((r) => r.id === id)!.blocksJson)
    .flatMap((b) => b.items)
    .map((i) => i.id)
}

/**
 * The move, exactly as `/api/session/move` performs it: destination first, then
 * source, both rows stamped with the one groupId.
 */
async function move(): Promise<string> {
  const source = read(1)
  const destination = read(2)
  const item = source.blocks.flatMap((b) => b.items).find((i) => i.id === 'run-long')!
  const reason = 'Moved the long run to Saturday.'
  const { add, remove } = moveItemOps(
    item,
    destination.blocks,
    destinationBlockKind(item, source.blocks),
    reason,
  )

  const groupId = 'group-move-1'
  const landed = await applyPatchToSession(
    destination,
    { actor: 'user', ops: [add] },
    CONTEXT,
    { reason, groupId },
  )
  expect(landed.applied).toBe(true)
  const lifted = await applyPatchToSession(
    read(1),
    { actor: 'user', ops: [remove], override: true },
    CONTEXT,
    { reason, groupId },
  )
  expect(lifted.applied).toBe(true)
  return groupId
}

/** The per-day rails, which every half of an undo is judged against (§11). */
const contextFor = jest.fn(async (_date: Date) => CONTEXT)

beforeEach(() => {
  jest.clearAllMocks()
  install()
})

// ── The pair is written as a pair ────────────────────────────────────────────

describe('a move writes one group across two days', () => {
  it('stamps both `edit_history` rows with the same groupId', async () => {
    const groupId = await move()

    expect(edits).toHaveLength(2)
    expect(edits.map((e) => e.sessionId)).toEqual([2, 1])
    expect(edits.every((e) => e.groupId === groupId)).toBe(true)
    expect(itemIds(1)).toEqual(['stretch-calf'])
    expect(itemIds(2)).toEqual(['stretch-calf', 'run-long'])
  })
})

// ── Undo from either end ─────────────────────────────────────────────────────

describe('undoing a move', () => {
  it('reverses both days when asked from the source day', async () => {
    await move()

    const outcome = await undoLastEdit(read(1), CONTEXT, contextFor)

    expect(outcome.applied).toBe(true)
    // On exactly one day, in the slot it left — the bug was the long run
    // existing on both days or on neither.
    expect(itemIds(1)).toEqual(['run-long', 'stretch-calf'])
    expect(itemIds(2)).toEqual(['stretch-calf'])
    expect(outcome.alsoUndone.map((d) => d.date)).toEqual([SATURDAY])
  })

  it('reverses both days when asked from the destination day', async () => {
    await move()

    const outcome = await undoLastEdit(read(2), CONTEXT, contextFor)

    expect(outcome.applied).toBe(true)
    expect(itemIds(1)).toEqual(['run-long', 'stretch-calf'])
    expect(itemIds(2)).toEqual(['stretch-calf'])
    expect(outcome.alsoUndone.map((d) => d.date)).toEqual([TODAY])
  })

  it('takes the item off the destination before putting it back on the source', async () => {
    await move()
    await undoLastEdit(read(1), CONTEXT, contextFor)

    // Both undo rows, in the order they were written. The destination's removal
    // goes first so no instant has the long run sitting on two days at once.
    const undos = edits.filter((e) => e.reason?.startsWith('Undo of'))
    expect(undos.map((e) => e.sessionId)).toEqual([2, 1])
  })

  it('judges the other day against its own rails, not the day you clicked', async () => {
    await move()
    await undoLastEdit(read(1), CONTEXT, contextFor)

    expect(contextFor).toHaveBeenCalledTimes(1)
    expect(contextFor).toHaveBeenCalledWith(SATURDAY)
  })

  it('links the two undo rows as a group of their own', async () => {
    await move()
    await undoLastEdit(read(2), CONTEXT, contextFor)

    const undos = edits.filter((e) => e.reason?.startsWith('Undo of'))
    expect(undos).toHaveLength(2)
    expect(undos[0].groupId).toBe(undos[1].groupId)
    expect(undos[0].groupId).not.toBe('group-move-1')
  })

  it('does not undo the same move twice', async () => {
    await move()
    await undoLastEdit(read(1), CONTEXT, contextFor)
    const after = await undoLastEdit(read(1), CONTEXT, contextFor)

    expect(after.applied).toBe(false)
    expect(itemIds(1)).toEqual(['run-long', 'stretch-calf'])
    expect(itemIds(2)).toEqual(['stretch-calf'])
  })
})

// ── Partial failure is no failure at all ─────────────────────────────────────

describe('a group whose other half is refused', () => {
  /** Saturday moved on: something else took the long run off it. */
  function dropTheRunFromSaturday() {
    const row = sessions.find((r) => r.id === 2)!
    row.blocksJson = serializeBlocks(blocks([mobility()]))
  }

  it('writes nothing on either day rather than leaving it on both', async () => {
    await move()
    dropTheRunFromSaturday()
    const editsBefore = edits.length
    const versionsBefore = sessions.map((r) => r.version)

    const outcome = await undoLastEdit(read(1), CONTEXT, contextFor)

    expect(outcome.applied).toBe(false)
    expect(outcome.verdict.kind).toBe('pushed_back')
    // The source day is untouched: no duplicate, no version bump, no audit row.
    expect(itemIds(1)).toEqual(['stretch-calf'])
    expect(itemIds(2)).toEqual(['stretch-calf'])
    expect(sessions.map((r) => r.version)).toEqual(versionsBefore)
    expect(edits).toHaveLength(editsBefore)
  })

  it('leaves the move undoable once the day it refused on is readable again', async () => {
    await move()
    dropTheRunFromSaturday()
    expect((await undoLastEdit(read(1), CONTEXT, contextFor)).applied).toBe(false)

    // Put Saturday back the way the move left it, and the undo works as before.
    sessions.find((r) => r.id === 2)!.blocksJson = serializeBlocks(
      blocks([mobility(), { ...longRun(), status: 'prescribed' }]),
    )
    const outcome = await undoLastEdit(read(1), CONTEXT, contextFor)

    expect(outcome.applied).toBe(true)
    expect(itemIds(1)).toEqual(['run-long', 'stretch-calf'])
    expect(itemIds(2)).toEqual(['stretch-calf'])
  })
})

// ── The ordinary case is still the ordinary case ─────────────────────────────

describe('a single-day edit', () => {
  it('undoes one day and writes one row, as the Today screen has always done', async () => {
    const applied = await applyPatchToSession(
      read(1),
      {
        actor: 'user',
        ops: [{ op: 'remove', itemId: 'stretch-calf', reason: 'no time' }],
      },
      CONTEXT,
      { reason: 'no time' },
    )
    expect(applied.applied).toBe(true)
    expect(edits).toHaveLength(1)
    expect(edits[0].groupId).toBeNull()

    const outcome = await undoLastEdit(read(1), CONTEXT, contextFor)

    expect(outcome.applied).toBe(true)
    expect(outcome.alsoUndone).toEqual([])
    expect(outcome.undoneEditId).toBe(1)
    expect(itemIds(1)).toEqual(['run-long', 'stretch-calf'])
    expect(itemIds(2)).toEqual(['stretch-calf'])
    expect(edits).toHaveLength(2)
    // Nothing needed a second day's rails, so nothing asked for them.
    expect(contextFor).not.toHaveBeenCalled()
  })

  it('reports nothing to undo on an untouched day', async () => {
    const outcome = await undoLastEdit(read(2), CONTEXT, contextFor)

    expect(outcome.applied).toBe(false)
    expect(outcome.undoneEditId).toBeNull()
    expect(edits).toHaveLength(0)
  })
})
