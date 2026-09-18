// ── The coach edit funnel, end to end (framework §11) ─────────────────────────
// §11-A is one sentence long and the whole trust model hangs off its last
// clause: "returns a structured patch … **Shows a diff; you confirm; it
// applies.**" These tests exercise the two routes that sentence describes —
// `/api/coach` for the diff and `/api/session/patch` for the confirmation — and
// they assert against the *database* rather than the response body, because the
// only honest definition of "nothing was persisted" is that no row moved.
//
// Nothing here talks to Anthropic. `proposeFromText` is stubbed with a recorded
// tool response run through the real `parseCoachOutput`, so every gate the
// model's output has to clear is still a gate; only the network is absent.
//
// The load-bearing test is the last one. A preview is not a permit: the patch
// is re-validated on apply against the session *as it is then*, so a patch that
// previewed clean is still refused when the day moved underneath it. Without
// that, preview-then-confirm would be a new way around the validator rather
// than the confirmation step §11 asks for.

import {
  parseCoachOutput,
  type CoachContract,
  type CoachParseResult,
} from '@/lib/coach'
import { serializeBlocks } from '@/lib/sessionStore'
import type { NextRequest } from 'next/server'
import type { EditableSession, SessionPatch } from '@/types/patch'
import type { SessionBlock, SessionItem } from '@/types/session'
import type { ValidationContext } from '@/lib/session'
import type { LoadBudget } from '@/lib/load'

import okResponse from '@/lib/__tests__/fixtures/coach-response-ok.json'

// ── Mocks: the DB and everything that reads it ────────────────────────────────
// `applySessionPatch`, `applyPatchToSession`, `parsePatchBody` and the whole
// validator stay real — they are the subject. Only the edges are stubbed.

jest.mock('@/lib/db', () => ({
  prisma: {
    session: { findUnique: jest.fn(), update: jest.fn() },
    edit_history: { create: jest.fn(), findMany: jest.fn() },
  },
}))

jest.mock('@/lib/todaySession', () => ({
  ensureToday: jest.fn(),
  todayValidationContext: jest.fn(),
}))

jest.mock('@/lib/deload', () => ({
  applyDeloadIfWarranted: jest.fn(),
  evaluateDeloadForDate: jest.fn(),
}))

jest.mock('@/lib/preferences', () => ({
  ...jest.requireActual('@/lib/preferences'),
  readPreferences: jest.fn(),
}))

jest.mock('@/lib/coach', () => ({
  ...jest.requireActual('@/lib/coach'),
  gatherCoachContract: jest.fn(),
  proposeFromText: jest.fn(),
}))

import { prisma } from '@/lib/db'
import { ensureToday, todayValidationContext } from '@/lib/todaySession'
import { applyDeloadIfWarranted } from '@/lib/deload'
import { readPreferences } from '@/lib/preferences'
import { gatherCoachContract, proposeFromText } from '@/lib/coach'

import { POST as coachPOST } from '../route'
import { POST as patchPOST } from '@/app/api/session/patch/route'

const findUnique = prisma.session.findUnique as jest.Mock
const updateSession = prisma.session.update as jest.Mock
const createEdit = prisma.edit_history.create as jest.Mock
const mockEnsureToday = ensureToday as jest.Mock
const mockContext = todayValidationContext as jest.Mock
const mockDeload = applyDeloadIfWarranted as jest.Mock
const mockPreferences = readPreferences as jest.Mock
const mockContract = gatherCoachContract as jest.Mock
const mockPropose = proposeFromText as jest.Mock

// ── Fixtures ──────────────────────────────────────────────────────────────────

function easyRun(durationMin = 45): SessionItem {
  return {
    id: 'run-easy',
    ref: { kind: 'run', id: 'easy', name: 'Easy run' },
    params: { kind: 'run', runType: 'easy', durationMin, targetHrLow: 120, targetHrHigh: 145 },
    why: 'Placeholder why from the run engine.',
    status: 'prescribed',
  }
}

function calfWork(): SessionItem {
  return {
    id: 'calf-1',
    ref: { kind: 'prehab', id: 'heel-drop', name: 'Eccentric heel drop' },
    params: { kind: 'hold', sets: 3, reps: 15, holdSec: 3, perSide: true },
    status: 'prescribed',
  }
}

function blocks(runMin = 45): SessionBlock[] {
  return [
    { id: 'b-main', kind: 'main', label: 'Main', items: [easyRun(runMin)] },
    { id: 'b-acc', kind: 'accessory', label: 'Accessory', items: [calfWork()] },
  ]
}

function session(over: Partial<EditableSession> = {}): EditableSession {
  return {
    id: 1,
    date: new Date('2026-09-16T00:00:00'),
    status: 'active',
    version: 1,
    blocks: blocks(),
    sourceOfLastEdit: 'engine',
    ...over,
  }
}

function budget(over: Partial<LoadBudget> = {}): LoadBudget {
  return {
    ceiling: 2000,
    target: 1700,
    floor: 0,
    acwr: 1.05,
    acwrCap: 1.3,
    chronicDailyLoad: 300,
    band: 'amber',
    calibrating: false,
    reasons: ['Amber day — 65% of the raw ceiling.'],
    ...over,
  }
}

function context(over: Partial<ValidationContext> = {}): ValidationContext {
  return { budget: budget(), band: 'amber', calibrating: false, niggles: [], ...over }
}

/** What `prisma.session.findUnique` hands back — the session as it is *now*. */
function rowFor(day: EditableSession) {
  return {
    id: day.id ?? 1,
    date: day.date ?? new Date('2026-09-16T00:00:00'),
    status: day.status,
    version: day.version,
    blocksJson: serializeBlocks(day.blocks),
    sourceOfLastEdit: day.sourceOfLastEdit ?? 'engine',
  }
}

function post(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

/**
 * The model's answer, parsed by the real parser against the real session.
 *
 * The fixture's single op sets the easy run to 30 minutes, so against a
 * 45-minute day it is a cut and against a 20-minute day it is a lengthening —
 * which is what lets one fixture exercise both sides of the load ceiling.
 */
function proposalFor(day: EditableSession, text: string): CoachParseResult {
  const input = (okResponse.content[0] as { input: unknown }).input
  return parseCoachOutput(input, day, text)
}

function setDay(day: EditableSession, ctx: ValidationContext = context()) {
  findUnique.mockResolvedValue(rowFor(day))
  mockContext.mockResolvedValue(ctx)
  mockEnsureToday.mockResolvedValue({ session: day, created: false })
  mockPropose.mockImplementation(
    async (_contract: CoachContract, s: EditableSession, text: string) => proposalFor(s, text),
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPreferences.mockResolvedValue([])
  mockContract.mockResolvedValue({} as CoachContract)
  mockDeload.mockResolvedValue({
    verdict: { triggered: false, reasons: [], severity: 'none' },
    applied: false,
    skipped: 'not_warranted',
    session: null,
    diffSummary: null,
    patchVerdict: null,
  })
  updateSession.mockImplementation(async () => ({}))
  createEdit.mockResolvedValue({ id: 99 })
  createEdit.mockClear()
  prisma.edit_history.findMany = jest.fn().mockResolvedValue([])
})

// ── §11: shows a diff; you confirm; it applies ────────────────────────────────

describe('POST /api/coach previews before it applies (§11)', () => {
  // THE §11 TEST. Before this existed the route applied the coach's patch and
  // the athlete's only recourse was undo — the AI's edits skipped the
  // confirmation step the athlete's own taps get.
  it('returns the patch, the verdict and the diff without persisting anything', async () => {
    setDay(session())

    const res = await coachPOST(post({ text: 'make today easier' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.preview).toBe(true)
    expect(json.applied).toBe(false)

    // The diff §11 says you confirm.
    expect(json.patch.actor).toBe('coach')
    expect(json.patch.ops.length).toBeGreaterThan(0)
    expect(json.verdict.kind).toBe('ok')
    expect(json.diff.entries.length).toBeGreaterThan(0)

    // And the only definition of "nothing happened" that means anything.
    expect(updateSession).not.toHaveBeenCalled()
    expect(createEdit).not.toHaveBeenCalled()

    // The blocks that come back are the session as it stands, not as it would be.
    expect(json.blocks[0].items[0].params.durationMin).toBe(45)
    expect(json.version).toBe(1)
  })

  it('applies only when the caller opts in, and then through the one funnel as the coach', async () => {
    setDay(session())

    const res = await coachPOST(post({ text: 'make today easier', apply: true }))
    const json = await res.json()

    expect(json.preview).toBe(false)
    expect(json.applied).toBe(true)
    expect(updateSession).toHaveBeenCalledTimes(1)
    expect(updateSession.mock.calls[0][0].data.sourceOfLastEdit).toBe('coach')
    expect(createEdit.mock.calls[0][0].data.actor).toBe('coach')
  })

  it('runs the validator in preview, so a push-back and its safer version are visible first', async () => {
    // A 20-minute day: the fixture's op *lengthens* the run to 30, which a
    // ceiling of 1 refuses.
    setDay(
      session({ blocks: blocks(20) }),
      context({ budget: budget({ ceiling: 1, target: 1 }) }),
    )

    const res = await coachPOST(post({ text: 'give me thirty minutes' }))
    const json = await res.json()

    expect(json.preview).toBe(true)
    expect(json.applied).toBe(false)
    expect(json.verdict.kind).toBe('pushed_back')
    expect(json.counterProposal).not.toBeNull()
    expect(json.reply).toContain('FLAG')
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('still renders the no-key reply inline, with no patch to confirm', async () => {
    setDay(session())
    mockPropose.mockResolvedValue({
      ok: false,
      code: 'no_api_key',
      message: 'The coach is not wired up on this build.',
    })

    const res = await coachPOST(post({ text: 'make today easier' }))
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.reply).toContain('not wired up')
    expect(json.verdict).toBeNull()
    expect(json.applied).toBe(false)
    expect(updateSession).not.toHaveBeenCalled()
  })

  // §15 — a tissue protection is not a judgement call, so the preview has to
  // carry `hardFloor` out to the screen, which is what suppresses "do it
  // anyway" before the athlete can reach for a button that would only fail.
  it('marks a hard floor in the preview verdict, so no override is offered for it', async () => {
    setDay(
      session({ blocks: blocks(20) }),
      context({
        niggles: [{ id: 'n1', bodyRegion: 'calf', tissues: ['calf'], severity: 8 }],
        factsOf: (item) =>
          item.id === 'run-easy' ? { tissues: ['calf'], modality: 'run' } : {},
      }),
    )

    const json = await (await coachPOST(post({ text: 'give me thirty minutes' }))).json()

    expect(json.verdict.kind).toBe('pushed_back')
    expect(
      (json.verdict.findings as Array<{ rule: string; hardFloor?: boolean }>).some(
        (f) => f.rule === 'niggle_contraindicated' && f.hardFloor === true,
      ),
    ).toBe(true)
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('never lets a model response claim to be the engine', async () => {
    setDay(session())
    const res = await coachPOST(post({ text: 'make today easier' }))
    const json = await res.json()
    expect(json.patch.actor).toBe('coach')
    expect(json.patch.override).toBeUndefined()
  })
})

// ── The confirmation, and the invariant it must not weaken ────────────────────

describe('confirming a previewed coach patch (§11)', () => {
  /** Preview, then post exactly what came back — what the UI does. */
  async function previewThenConfirm(
    day: EditableSession,
    previewCtx: ValidationContext,
    atApply: { day: EditableSession; ctx: ValidationContext },
  ) {
    setDay(day, previewCtx)
    const preview = await (await coachPOST(post({ text: 'make today easier' }))).json()

    // The day moves between the diff and the tap: another edit, a deload, a
    // completed session. The apply path must see *that* day, not the preview's.
    findUnique.mockResolvedValue(rowFor(atApply.day))
    mockContext.mockResolvedValue(atApply.ctx)

    const res = await patchPOST(
      post({
        patch: { ops: preview.patch.ops },
        actor: 'coach',
        source: preview.patch.source,
        reason: 'make today easier',
      }),
    )
    return { preview, applied: await res.json(), status: res.status }
  }

  it('applies it as the coach when the day has not moved', async () => {
    const day = session()
    const { preview, applied } = await previewThenConfirm(day, context(), {
      day,
      ctx: context(),
    })

    expect(preview.applied).toBe(false)
    expect(applied.applied).toBe(true)
    expect(applied.version).toBe(2)
    expect(updateSession).toHaveBeenCalledTimes(1)
    expect(updateSession.mock.calls[0][0].data.sourceOfLastEdit).toBe('coach')
  })

  // ── THE INVARIANT ──────────────────────────────────────────────────────────
  // A preview is not a token. Validation lives on the apply path, against the
  // session as it is at that moment — otherwise preview-then-confirm would be a
  // bypass dressed up as a confirmation step.
  it('refuses a patch that previewed clean when another edit removed the item underneath it', async () => {
    const day = session()
    const moved = session({
      version: 2,
      sourceOfLastEdit: 'user',
      // Somebody deleted the run between the diff and the tap.
      blocks: [{ id: 'b-acc', kind: 'accessory', label: 'Accessory', items: [calfWork()] }],
    })

    const { preview, applied } = await previewThenConfirm(day, context(), {
      day: moved,
      ctx: context(),
    })

    expect(preview.verdict.kind).toBe('ok')
    expect(applied.applied).toBe(false)
    expect(applied.verdict.kind).toBe('pushed_back')
    expect(applied.verdict.findings[0].rule).toBe('unknown_item')
    expect(updateSession).not.toHaveBeenCalled()
    expect(createEdit).not.toHaveBeenCalled()
  })

  it('refuses a patch that previewed clean when a deload dropped the ceiling underneath it', async () => {
    // Previews against a 20-minute day with room to spare; by the time it is
    // confirmed the deload has cut the budget to nothing.
    const day = session({ blocks: blocks(20) })
    const { preview, applied } = await previewThenConfirm(day, context(), {
      day: session({ blocks: blocks(20), version: 2 }),
      ctx: context({ budget: budget({ ceiling: 1, target: 1 }) }),
    })

    expect(preview.verdict.kind).toBe('ok')
    expect(applied.applied).toBe(false)
    expect(applied.verdict.kind).toBe('pushed_back')
    expect(applied.verdict.findings.some((f: { rule: string }) => f.rule === 'load_ceiling')).toBe(
      true,
    )
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('refuses a patch that previewed clean when the session was completed underneath it', async () => {
    const day = session()
    const { preview, applied, status } = await previewThenConfirm(day, context(), {
      day: session({ status: 'completed', version: 2 }),
      ctx: context(),
    })

    expect(preview.verdict.kind).toBe('ok')
    expect(status).toBe(409)
    expect(applied.error).toContain('complete')
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('carries the override the athlete set, and still refuses a hard floor', async () => {
    const day = session({ blocks: blocks(20) })
    setDay(day, context({ budget: budget({ ceiling: 1, target: 1 }) }))
    const preview = await (await coachPOST(post({ text: 'thirty minutes anyway' }))).json()
    expect(preview.verdict.kind).toBe('pushed_back')

    // "Do it anyway" — the athlete's call, on their own next request (§11).
    const res = await patchPOST(
      post({
        patch: { ops: preview.patch.ops },
        actor: 'coach',
        override: true,
        reason: 'thirty minutes anyway',
      }),
    )
    const applied = await res.json()
    expect(applied.applied).toBe(true)
    expect(applied.verdict.kind).toBe('applied_with_flag')
    expect(
      (applied.verdict.findings as Array<{ hardFloor?: boolean }>).some((f) => f.hardFloor),
    ).toBe(false)
  })
})

// ── The preview shape the client depends on ───────────────────────────────────

describe('the preview response shape', () => {
  it('is a superset of the applied shape, so one panel renders both', async () => {
    setDay(session())
    const json = await (await coachPOST(post({ text: 'make today easier' }))).json()

    for (const key of [
      'reply',
      'parts',
      'available',
      'preview',
      'applied',
      'patch',
      'verdict',
      'counterProposal',
      'diff',
      'blocks',
      'version',
      'deload',
      'disclaimer',
    ]) {
      expect(json).toHaveProperty(key)
    }
  })

  it('treats an unparsable apply flag as a preview — confirm is the default (§11)', async () => {
    setDay(session())
    const json = await (
      await coachPOST(post({ text: 'make today easier', apply: 'yes please' }))
    ).json()
    expect(json.preview).toBe(true)
    expect(updateSession).not.toHaveBeenCalled()
  })
})
