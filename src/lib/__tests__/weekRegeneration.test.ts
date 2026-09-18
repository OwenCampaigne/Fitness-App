// ── Regeneration respects edits ───────────────────────────────────────────────
// Framework §11: "preserving your override." This is the one behaviour in the
// week feature that is genuinely dangerous to get wrong, because getting it
// wrong is silent — you move the long run to Saturday on Monday, the planner
// runs again on Tuesday, and the session is quietly back where the engine wanted
// it with nothing on screen to say so.
//
// `shouldRegenerate` is asserted directly in `weekPlan.test.ts`. This file
// asserts the *wiring*: that `ensureWeek` actually consults it, that a day it
// refuses is returned with the **stored** blocks rather than the freshly
// allocated ones, and that no write goes anywhere near it.
//
// The DB and the engines are mocked. That is the point — what is under test is
// the decision, and a real allocator would only make the fixture harder to read.

import { addDays, startOfDay } from 'date-fns'
import type { SessionBlock } from '../../types/session'

jest.mock('../runSession', () => ({
  ensureWeeklyPlan: jest.fn().mockResolvedValue(0),
}))

jest.mock('../todaySession', () => ({
  ensureToday: jest.fn(),
  gatherToday: jest.fn(),
  todayValidationContext: jest.fn(),
}))

jest.mock('../sessionStore', () => ({
  ...jest.requireActual('../sessionStore'),
  findSessionRow: jest.fn(),
  loadDayContext: jest.fn(),
  createSessionRow: jest.fn(),
  replaceEngineSession: jest.fn(),
}))

import {
  createSessionRow,
  findSessionRow,
  loadDayContext,
  replaceEngineSession,
  serializeBlocks,
} from '../sessionStore'
import { ensureToday, gatherToday } from '../todaySession'
import { ensureWeek } from '../weekPlan'

const TODAY = new Date(2026, 8, 14)

// ── Fixtures ─────────────────────────────────────────────────────────────────

function runBlocks(runType: string, name: string, durationMin: number): SessionBlock[] {
  return [
    {
      id: 'b-main',
      kind: 'main',
      label: 'Main',
      items: [
        {
          id: `run-${runType}`,
          ref: { kind: 'run', id: runType, name },
          params: { kind: 'run', runType, durationMin },
          status: 'prescribed',
        },
      ],
    },
  ]
}

function blocksNamed(name: string): SessionBlock[] {
  return runBlocks('long', name, 70)
}

/** What the engine would like today to be, if nobody had an opinion. */
const ENGINE_BLOCKS = blocksNamed('Engine long run')
/** What the athlete moved here by hand on Monday. */
const MOVED_BLOCKS = blocksNamed('The long run I moved here')

function gathered(blocks: SessionBlock[]) {
  return {
    blocks,
    allocation: { plannedLoad: 400, plannedDurationMin: 70, decisions: [], hardDay: true },
    budget: { ceiling: 500, target: 425, floor: 100, acwr: 1, acwrCap: 1.3, chronicDailyLoad: 100, band: 'green', calibrating: false, reasons: [] },
    intent: { primaryModality: 'run', isQualityDay: true, plannedRunType: 'long', priority: 'A' },
    why: 'Green day.',
    verdictFlags: [],
    changedVsPlan: { changed: false, summary: 'nothing to action', entries: [] },
    disclaimer: 'Not medical advice.',
    readiness: { band: 'green', provisional: false },
    scenarioMode: null,
  }
}

function sessionRow(over: { id: number; version: number; sourceOfLastEdit: string | null; blocks: SessionBlock[]; date: Date }) {
  return {
    id: over.id,
    date: over.date,
    status: 'draft',
    version: over.version,
    blocksJson: serializeBlocks(over.blocks),
    sourceOfLastEdit: over.sourceOfLastEdit,
    plannedLoad: 400,
    plannedDurationMin: 70,
  }
}

const mockFind = findSessionRow as jest.Mock
const mockLoadDay = loadDayContext as jest.Mock
const mockCreate = createSessionRow as jest.Mock
const mockReplace = replaceEngineSession as jest.Mock
const mockEnsureToday = ensureToday as jest.Mock
const mockGather = gatherToday as jest.Mock

/** Make every day of the week — today included — the same session. */
function everyDay(blocks: SessionBlock[]) {
  mockEnsureToday.mockImplementation(async (date: Date) => ({
    ...gathered(blocks),
    session: { id: 1, date, status: 'draft', version: 1, blocks, sourceOfLastEdit: 'engine' },
    created: false,
  }))
  mockGather.mockImplementation(async () => gathered(blocks))
}

function resetDefaults() {
  mockLoadDay.mockResolvedValue({
    dailyLoads: new Array(28).fill(100),
    recentDays: [],
    yesterdayHard: false,
    qualityHistory: { prescribed: 0, dodged: 0, windowDays: 28 },
    lastWeekLoad: 700,
    thisWeekLoadSoFar: 0,
  })

  mockEnsureToday.mockImplementation(async (date: Date) => ({
    ...gathered(ENGINE_BLOCKS),
    session: { id: 1, date, status: 'draft', version: 1, blocks: ENGINE_BLOCKS, sourceOfLastEdit: 'engine' },
    created: false,
  }))

  mockGather.mockImplementation(async () => gathered(ENGINE_BLOCKS))

  mockCreate.mockImplementation(async ({ date, blocks }: { date: Date; blocks: SessionBlock[] }) =>
    sessionRow({ id: 99, version: 1, sourceOfLastEdit: 'engine', blocks, date }),
  )
  mockReplace.mockImplementation(async (id: number, blocks: SessionBlock[]) =>
    sessionRow({ id, version: 1, sourceOfLastEdit: 'engine', blocks, date: TODAY }),
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  resetDefaults()
})

// ── The promise ──────────────────────────────────────────────────────────────

describe('ensureWeek — an edited day is never regenerated (§11)', () => {
  const saturday = startOfDay(addDays(TODAY, 5))

  it('keeps the blocks the athlete moved there, and writes nothing to that day', async () => {
    mockFind.mockImplementation(async (date: Date) =>
      startOfDay(date).getTime() === saturday.getTime()
        ? sessionRow({ id: 6, version: 2, sourceOfLastEdit: 'user', blocks: MOVED_BLOCKS, date })
        : null,
    )

    const week = await ensureWeek(TODAY)
    const day = week.days.find((d) => d.date.getTime() === saturday.getTime())

    expect(day?.edited).toBe(true)
    expect(day?.blocks[0].items[0].ref.name).toBe('The long run I moved here')
    expect(day?.session.version).toBe(2)

    // Not "did not change it" — never touched it at all.
    for (const call of mockReplace.mock.calls) expect(call[0]).not.toBe(6)
    for (const call of mockCreate.mock.calls) {
      expect(startOfDay(call[0].date).getTime()).not.toBe(saturday.getTime())
    }
  })

  it('survives a second planning pass, and a third', async () => {
    mockFind.mockImplementation(async (date: Date) =>
      startOfDay(date).getTime() === saturday.getTime()
        ? sessionRow({ id: 6, version: 2, sourceOfLastEdit: 'user', blocks: MOVED_BLOCKS, date })
        : null,
    )

    for (let pass = 0; pass < 3; pass++) {
      const week = await ensureWeek(TODAY)
      const day = week.days.find((d) => d.date.getTime() === saturday.getTime())
      expect(day?.blocks[0].items[0].ref.name).toBe('The long run I moved here')
    }
    expect(mockReplace).not.toHaveBeenCalledWith(6, expect.anything())
  })

  it('holds for a coach edit too — the actor is not what makes it yours', async () => {
    mockFind.mockImplementation(async (date: Date) =>
      startOfDay(date).getTime() === saturday.getTime()
        ? sessionRow({ id: 6, version: 4, sourceOfLastEdit: 'coach', blocks: MOVED_BLOCKS, date })
        : null,
    )

    const week = await ensureWeek(TODAY)
    const day = week.days.find((d) => d.date.getTime() === saturday.getTime())
    expect(day?.edited).toBe(true)
    expect(day?.blocks[0].items[0].ref.name).toBe('The long run I moved here')
  })

  it('does rebuild an untouched engine day — that is the other half of the deal', async () => {
    mockFind.mockImplementation(async (date: Date) =>
      startOfDay(date).getTime() === saturday.getTime()
        ? sessionRow({ id: 6, version: 1, sourceOfLastEdit: 'engine', blocks: blocksNamed('Yesterday’s idea'), date })
        : null,
    )

    const week = await ensureWeek(TODAY)
    const day = week.days.find((d) => d.date.getTime() === saturday.getTime())

    expect(mockReplace).toHaveBeenCalledWith(6, ENGINE_BLOCKS)
    expect(day?.edited).toBe(false)
    expect(day?.blocks[0].items[0].ref.name).toBe('Engine long run')
  })

  it('creates a session for a day that has none yet', async () => {
    mockFind.mockResolvedValue(null)
    await ensureWeek(TODAY)
    // Six future days; today goes through `ensureToday`, which owns its own row.
    expect(mockCreate).toHaveBeenCalledTimes(6)
    expect(mockReplace).not.toHaveBeenCalled()
  })
})

// ── The sequence (§3, §10) ───────────────────────────────────────────────────

describe('ensureWeek — the week is planned in order', () => {
  beforeEach(() => mockFind.mockResolvedValue(null))

  it('plans today first and each day after it, never in parallel', async () => {
    const week = await ensureWeek(TODAY)
    expect(week.days).toHaveLength(7)
    expect(week.days[0].isToday).toBe(true)
    expect(week.days.slice(1).every((d) => !d.isToday)).toBe(true)

    const dates = mockGather.mock.calls.map((c) => startOfDay(c[0] as Date).getTime())
    expect(dates).toEqual([...dates].sort((a, b) => a - b))
  })

  it('plans every day past today at the plan’s shape, not at today’s band', async () => {
    await ensureWeek(TODAY)
    for (const call of mockGather.mock.calls) {
      expect(call[1]).toMatchObject({ band: 'green' })
    }
  })

  it('tells each day whether the day before it came out hard (§10)', async () => {
    // The input the back-to-back rail has and `summarizeDailyLoads` cannot give
    // it: a planned day carries no sRPE, so the DB cannot tell that yesterday's
    // *plan* was hard. Every fixture day here is a VO2 session, so every day but
    // the first is told so.
    everyDay(runBlocks('vo2', 'VO2 intervals', 45))
    await ensureWeek(TODAY)
    expect(mockGather).toHaveBeenCalledTimes(6)
    for (const call of mockGather.mock.calls) {
      expect(call[1].yesterdayHard).toBe(true)
    }
  })

  it('reports an easy previous day as easy — and a long run is not "hard" (§10)', async () => {
    // A long easy day is volume, not intensity. That distinction is the whole
    // reason the rail reads hardness rather than load, and the week must not
    // quietly widen it just because a long run is the biggest thing in it.
    everyDay(runBlocks('easy', 'Easy run', 35))
    await ensureWeek(TODAY)
    for (const call of mockGather.mock.calls) {
      expect(call[1].yesterdayHard).toBe(false)
    }

    jest.clearAllMocks()
    resetDefaults()
    everyDay(runBlocks('long', 'Long run', 110))
    await ensureWeek(TODAY)
    for (const call of mockGather.mock.calls) {
      expect(call[1].yesterdayHard).toBe(false)
    }
  })

  it('carries the week total and the ACWR trajectory out to the caller', async () => {
    const week = await ensureWeek(TODAY)
    expect(week.totals.acwr).toHaveLength(7)
    expect(week.totals.totalLoad).toBeGreaterThan(0)
    expect(week.days.every((d) => d.summary.itemCount === 1)).toBe(true)
  })
})
