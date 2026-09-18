// ── Coach layer tests ─────────────────────────────────────────────────────────
// Everything here runs with no network and no ANTHROPIC_API_KEY, against
// recorded Anthropic responses in `fixtures/coach-response-*.json`. That is the
// point: the parsing and rejection logic is the part that decides what reaches
// a real training day, so it has to be assertable without the model.

import {
  COACH_MODEL,
  COACH_TOOL,
  COACH_TOOL_NAME,
  NO_KEY_MESSAGE,
  buildWhyOps,
  callCoach,
  extractToolInput,
  formatCoachReply,
  modelAuthoredStrings,
  parseCoachOutput,
  proposeFromText,
  renderContract,
  sessionItemIds,
} from '../coach'
import { applySessionPatch } from '../session'
import type { CoachContract, CoachReply, FetchLike } from '../coach'
import type { ValidationContext } from '../session'
import type { EditableSession } from '../../types/patch'
import type { SessionBlock, SessionItem } from '../../types/session'
import type { LoadBudget } from '../load'

import okResponse from './fixtures/coach-response-ok.json'
import proseResponse from './fixtures/coach-response-prose.json'
import truncatedResponse from './fixtures/coach-response-truncated.json'
import unknownItemResponse from './fixtures/coach-response-unknown-item.json'
import diagnosisResponse from './fixtures/coach-response-diagnosis.json'
import kindChangeResponse from './fixtures/coach-response-kind-change.json'
import missingSectionResponse from './fixtures/coach-response-missing-section.json'
import outOfBoundsResponse from './fixtures/coach-response-out-of-bounds.json'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function easyRun(): SessionItem {
  return {
    id: 'run-easy',
    ref: { kind: 'run', id: 'easy', name: 'Easy run' },
    params: { kind: 'run', runType: 'easy', durationMin: 45, targetHrLow: 120, targetHrHigh: 145 },
    why: 'Placeholder why from the run engine.',
    status: 'prescribed',
  }
}

function squat(): SessionItem {
  return {
    id: 'squat-1',
    ref: { kind: 'exercise', id: 'back-squat', name: 'Back Squat' },
    params: { kind: 'strength', sets: 3, reps: 8, weightKg: 60, targetRir: 2, restSec: 150 },
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

function blocks(): SessionBlock[] {
  return [
    { id: 'b-main', kind: 'main', label: 'Main', items: [easyRun(), squat()] },
    { id: 'b-acc', kind: 'accessory', label: 'Accessory', items: [calfWork()] },
  ]
}

function session(): EditableSession {
  return {
    id: 1,
    date: new Date('2026-09-16T00:00:00'),
    status: 'active',
    version: 1,
    blocks: blocks(),
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

function validationContext(over: Partial<ValidationContext> = {}): ValidationContext {
  return { budget: budget(), band: 'amber', calibrating: false, niggles: [], ...over }
}

function contract(over: Partial<CoachContract> = {}): CoachContract {
  return {
    date: '2026-09-16',
    readiness: {
      band: 'amber',
      decidingSignals: ['HRV 42 ms vs 51 ms baseline', 'Sleep 6.1 h'],
      plainText: 'A bit run-down — keep it easy.',
      provisional: false,
      calibration: 'graduated',
      daysUntilCalibrated: null,
      hrv: 42,
      rhr: 51,
      sleepHours: 6.1,
    },
    yesterday: { date: '2026-09-15', load: 320, hard: false },
    load: {
      acwr: 1.05,
      acwrCap: 1.3,
      zone: 'optimal',
      ceiling: 2000,
      target: 1700,
      floor: 200,
      chronicDailyLoad: 300,
      plannedToday: 410,
      reasons: ['Amber day — 65% of the raw ceiling.'],
    },
    week: {
      phase: 'base',
      daysToRace: 84,
      goalRace: 'Half marathon',
      plannedRunTypes: [{ date: '2026-09-16', runType: 'easy', priority: 'B' }],
      lastWeekLoad: 2100,
      thisWeekLoadSoFar: 640,
    },
    calibration: { status: 'graduated', provisional: false, anchorConfidence: 'confirmed' },
    preferences: [
      { label: 'No strength on weekends.', source: 'explicit', confidence: 1, binding: true },
      {
        label: 'Friday strength work keeps getting dropped — lower its priority on Fridays?',
        source: 'inferred',
        confidence: 0.62,
        binding: false,
      },
    ],
    niggles: [{ bodyRegion: 'calf', severity: 3, daysActive: 4 }],
    candidates: [
      {
        itemId: 'run-easy',
        name: 'Easy run',
        modality: 'run',
        outcome: 'selected',
        code: 'fits_budget',
        reason: 'Fits inside the budget.',
      },
    ],
    session: [
      {
        itemId: 'run-easy',
        block: 'main',
        kind: 'run',
        name: 'Easy run',
        prescription: 'easy, 45 min, HR 120–145',
        why: 'Placeholder why from the run engine.',
      },
    ],
    deload: { triggered: false, reasons: [] },
    flags: [],
    disclaimer: 'General training and educational information — not medical advice.',
    ...over,
  }
}

function reply(over: Partial<CoachReply> = {}): CoachReply {
  return {
    readiness: { band: 'amber', decidingSignals: ['a', 'b'] },
    today: 'Easy 30.',
    why: 'Because.',
    itemWhy: [],
    changed: 'no change',
    week: 'unchanged',
    flag: 'nothing to action',
    ...over,
  }
}

// ── The model id (§10) ────────────────────────────────────────────────────────

describe('wiring', () => {
  it('calls the current model id', () => {
    expect(COACH_MODEL).toBe('claude-opus-5')
  })

  it('constrains the tool to the ops the patch schema allows', () => {
    const ops = COACH_TOOL.input_schema.properties.ops.items.properties.op.enum
    expect(Array.from(ops)).toEqual(['remove', 'replace', 'modify', 'reorder', 'add'])
  })

  it('requires all six parts of the §10 contract', () => {
    expect(COACH_TOOL.input_schema.required).toEqual(
      expect.arrayContaining(['readinessBand', 'decidingSignals', 'today', 'why', 'changed', 'week', 'flag']),
    )
  })
})

// ── The prompt ────────────────────────────────────────────────────────────────

describe('renderContract', () => {
  it('names every item id the model is allowed to reference', () => {
    const rendered = renderContract(contract(), 'make today easier')
    expect(rendered).toContain('[run-easy]')
    expect(rendered).toContain("TODAY'S SESSION (the only item ids that exist)")
  })

  it('marks an unconfirmed inference as not actionable (§13)', () => {
    const rendered = renderContract(contract(), '')
    expect(rendered).toContain('awaiting confirmation — do not act on it')
    // The explicit rule carries no such caveat.
    expect(rendered).toContain('No strength on weekends. [explicit, confidence 1.00]')
  })

  it('carries the readiness numbers, the budget and the disclaimer', () => {
    const rendered = renderContract(contract(), '')
    expect(rendered).toContain('band: AMBER')
    expect(rendered).toContain('ceiling: 2000')
    expect(rendered).toContain('DISCLAIMER')
  })

  it('says so plainly when the athlete typed nothing', () => {
    expect(renderContract(contract(), '   ')).toContain('(nothing — just compose today and explain it)')
  })
})

// ── Extracting the tool call ──────────────────────────────────────────────────

describe('extractToolInput', () => {
  it('finds the tool call in a recorded response', () => {
    const result = extractToolInput(okResponse)
    expect('input' in result).toBe(true)
  })

  it('rejects a prose answer rather than salvaging it', () => {
    const result = extractToolInput(proseResponse)
    expect(result).toMatchObject({ ok: false, code: 'no_tool_use' })
  })

  it('rejects a truncated answer rather than half-applying it', () => {
    const result = extractToolInput(truncatedResponse)
    expect(result).toMatchObject({ ok: false, code: 'malformed' })
  })

  it('rejects a non-response', () => {
    expect(extractToolInput('nope')).toMatchObject({ ok: false, code: 'malformed' })
    expect(extractToolInput(null)).toMatchObject({ ok: false, code: 'malformed' })
  })

  it('ignores a tool call by some other name', () => {
    const wrong = { content: [{ type: 'tool_use', name: 'something_else', input: {} }] }
    expect(extractToolInput(wrong)).toMatchObject({ ok: false, code: 'no_tool_use' })
  })
})

// ── Parsing, and refusing ─────────────────────────────────────────────────────

function parseFixture(fixture: unknown, s = session()) {
  const extracted = extractToolInput(fixture)
  if ('ok' in extracted) throw new Error('fixture did not carry a tool call')
  return parseCoachOutput(extracted.input, s, 'make today easier')
}

describe('parseCoachOutput — the happy path', () => {
  it('produces a typed six-part reply', () => {
    const result = parseFixture(okResponse)
    if (!result.ok) throw new Error(result.message)
    expect(result.reply.readiness.band).toBe('amber')
    expect(result.reply.readiness.decidingSignals).toHaveLength(2)
    expect(result.reply.today).toContain('30 min easy')
    expect(result.reply.changed).toContain('45 to 30')
    expect(result.reply.week).toContain('Sunday')
    expect(result.reply.flag).toBe('nothing to action')
  })

  it('forces the actor to coach — a model cannot claim to be the engine', () => {
    const result = parseFixture(okResponse)
    if (!result.ok) throw new Error(result.message)
    expect(result.patch.actor).toBe('coach')
  })

  it('keeps the athlete sentence as the patch source, for edit_history', () => {
    const result = parseFixture(okResponse)
    if (!result.ok) throw new Error(result.message)
    expect(result.patch.source).toBe('make today easier')
  })

  it('never sets override — only the athlete can insist', () => {
    const result = parseFixture(okResponse)
    if (!result.ok) throw new Error(result.message)
    expect(result.patch.override).toBeUndefined()
  })

  it('turns per-item whys into ops for untouched items only (§12)', () => {
    const result = parseFixture(okResponse)
    if (!result.ok) throw new Error(result.message)
    // run-easy already has a modify op, so its why rides along rather than
    // producing a second op against the same item.
    const whyOps = result.patch.ops.filter(
      (op) => op.op === 'modify' && op.reason === 'Explanation for today, from the coach.',
    )
    expect(whyOps).toHaveLength(1)
    expect(whyOps[0]).toMatchObject({ op: 'modify', itemId: 'calf-1' })
  })
})

describe('parseCoachOutput — refusals', () => {
  it('refuses an unknown item id before the validator ever sees it', () => {
    const result = parseFixture(unknownItemResponse)
    expect(result).toMatchObject({ ok: false, code: 'unknown_item' })
    if (result.ok) return
    expect(result.message).toContain('run-vo2-intervals')
  })

  it('refuses a kind change — that is a swap, not an edit', () => {
    const result = parseFixture(kindChangeResponse)
    expect(result).toMatchObject({ ok: false, code: 'kind_change' })
  })

  it('refuses an incomplete daily contract', () => {
    const result = parseFixture(missingSectionResponse)
    expect(result).toMatchObject({ ok: false, code: 'missing_section' })
    if (result.ok) return
    expect(result.message).toContain('WEEK')
  })

  it('refuses out-of-bounds params through the same parser the UI uses', () => {
    const result = parseFixture(outOfBoundsResponse)
    expect(result).toMatchObject({ ok: false, code: 'bad_op' })
  })

  it('refuses the whole response when any model string names a condition (§15)', () => {
    const result = parseFixture(diagnosisResponse)
    expect(result).toMatchObject({ ok: false, code: 'diagnosis_language' })
    if (result.ok) return
    expect(result.message).toContain('not medical advice')
  })

  it('refuses a bad band', () => {
    const result = parseCoachOutput(
      { readinessBand: 'yellow', decidingSignals: ['a', 'b'], today: 't', why: 'w', changed: 'c', week: 'k', flag: 'f', ops: [] },
      session(),
      '',
    )
    expect(result).toMatchObject({ ok: false, code: 'bad_band' })
  })

  it('refuses anything but exactly two deciding numbers', () => {
    const base = { readinessBand: 'green', today: 't', why: 'w', changed: 'c', week: 'k', flag: 'f', ops: [] }
    expect(parseCoachOutput({ ...base, decidingSignals: ['only one'] }, session(), '')).toMatchObject({
      ok: false,
      code: 'bad_deciding_signals',
    })
    expect(
      parseCoachOutput({ ...base, decidingSignals: ['a', 'b', 'c'] }, session(), ''),
    ).toMatchObject({ ok: false, code: 'bad_deciding_signals' })
  })

  it('refuses an explanation aimed at an item that does not exist', () => {
    const result = parseCoachOutput(
      {
        readinessBand: 'green',
        decidingSignals: ['a', 'b'],
        today: 't',
        why: 'w',
        changed: 'c',
        week: 'k',
        flag: 'f',
        itemWhy: [{ itemId: 'ghost-item', why: 'because' }],
        ops: [],
      },
      session(),
      '',
    )
    expect(result).toMatchObject({ ok: false, code: 'unknown_item' })
  })

  it('refuses an add that reuses an existing item id', () => {
    const result = parseCoachOutput(
      {
        readinessBand: 'green',
        decidingSignals: ['a', 'b'],
        today: 't',
        why: 'w',
        changed: 'c',
        week: 'k',
        flag: 'f',
        ops: [
          {
            op: 'add',
            blockKind: 'accessory',
            reason: 'More calf work.',
            item: {
              id: 'calf-1',
              ref: { kind: 'prehab', id: 'heel-drop', name: 'Eccentric heel drop' },
              params: { kind: 'hold', sets: 2 },
            },
          },
        ],
      },
      session(),
      '',
    )
    expect(result).toMatchObject({ ok: false, code: 'duplicate_item_id' })
  })

  it('refuses a reorder naming an item outside the session', () => {
    const result = parseCoachOutput(
      {
        readinessBand: 'green',
        decidingSignals: ['a', 'b'],
        today: 't',
        why: 'w',
        changed: 'c',
        week: 'k',
        flag: 'f',
        ops: [
          { op: 'reorder', blockKind: 'main', itemIds: ['run-easy', 'invented'], reason: 'Run first.' },
        ],
      },
      session(),
      '',
    )
    expect(result).toMatchObject({ ok: false, code: 'unknown_item' })
  })

  it('refuses more ops than one edit may carry', () => {
    const ops = Array.from({ length: 60 }, () => ({
      op: 'remove',
      itemId: 'run-easy',
      reason: 'x',
    }))
    const result = parseCoachOutput(
      { readinessBand: 'green', decidingSignals: ['a', 'b'], today: 't', why: 'w', changed: 'c', week: 'k', flag: 'f', ops },
      session(),
      '',
    )
    expect(result).toMatchObject({ ok: false, code: 'too_many_ops' })
  })

  it('refuses a non-object proposal', () => {
    expect(parseCoachOutput('a sentence', session(), '')).toMatchObject({
      ok: false,
      code: 'malformed',
    })
  })
})

// ── The funnel is the same funnel ─────────────────────────────────────────────

describe('a coach patch goes through the one validator', () => {
  it('is applied when it breaks no rule', () => {
    const result = parseFixture(okResponse)
    if (!result.ok) throw new Error(result.message)
    const outcome = applySessionPatch(session(), result.patch, validationContext())
    expect(outcome.applied).toBe(true)
    expect(outcome.verdict.kind).toBe('ok')
    expect(outcome.inverse).not.toBeNull()
  })

  // The fixture's op sets the easy run to 30 minutes. Against the 45-minute
  // session above that is a *cut*, and the validator never refuses a cut for
  // being over budget. So the ceiling rail is tested where it bites: a 20-minute
  // run the coach would lengthen.
  function shortDaySession(): EditableSession {
    const day = session()
    day.blocks[0].items[0] = {
      ...easyRun(),
      params: { ...easyRun().params, durationMin: 20 } as SessionItem['params'],
    }
    return day
  }

  it('is pushed back by the load ceiling exactly as a human tap would be', () => {
    const result = parseFixture(okResponse)
    if (!result.ok) throw new Error(result.message)
    const outcome = applySessionPatch(
      shortDaySession(),
      result.patch,
      validationContext({ budget: budget({ ceiling: 1 }) }),
    )
    expect(outcome.applied).toBe(false)
    expect(outcome.verdict.kind).toBe('pushed_back')
    expect(outcome.verdict.counterProposal).toBeDefined()
  })

  it('cannot smuggle an override past the validator', () => {
    const result = parseFixture(okResponse)
    if (!result.ok) throw new Error(result.message)
    // The coach never sets it; a session that is over the ceiling stays refused.
    expect(result.patch.override).toBeUndefined()
    const outcome = applySessionPatch(
      shortDaySession(),
      result.patch,
      validationContext({ budget: budget({ ceiling: 1 }) }),
    )
    expect(outcome.session.version).toBe(1)
  })

  it('records the coach as the editing actor', () => {
    const result = parseFixture(okResponse)
    if (!result.ok) throw new Error(result.message)
    const outcome = applySessionPatch(session(), result.patch, validationContext())
    expect(outcome.session.sourceOfLastEdit).toBe('coach')
  })
})

// ── Why ops ───────────────────────────────────────────────────────────────────

describe('buildWhyOps', () => {
  it('skips a why that already matches the card', () => {
    const s = session()
    const ops = buildWhyOps(
      [{ itemId: 'run-easy', why: 'Placeholder why from the run engine.' }],
      s,
      [],
    )
    expect(ops).toHaveLength(0)
  })

  it('preserves the item status so explaining a card does not mark it edited', () => {
    const s = session()
    const ops = buildWhyOps([{ itemId: 'run-easy', why: 'A better why.' }], s, [])
    expect(ops[0]).toMatchObject({ op: 'modify', status: 'prescribed' })

    const outcome = applySessionPatch(s, { actor: 'coach', ops }, validationContext())
    const item = outcome.session.blocks[0].items.find((i) => i.id === 'run-easy')
    expect(item?.status).toBe('prescribed')
    expect(item?.why).toBe('A better why.')
  })

  it('ignores a why for an item that is not there', () => {
    expect(buildWhyOps([{ itemId: 'nope', why: 'x' }], session(), [])).toHaveLength(0)
  })
})

describe('sessionItemIds', () => {
  it('collects every id across every block', () => {
    expect(Array.from(sessionItemIds(blocks())).sort()).toEqual(['calf-1', 'run-easy', 'squat-1'])
  })
})

describe('modelAuthoredStrings', () => {
  it('includes op reasons and swapped-in names, not just the six parts', () => {
    const strings = modelAuthoredStrings(reply(), [
      {
        op: 'add',
        blockKind: 'main',
        reason: 'A reason.',
        item: {
          id: 'x',
          ref: { kind: 'prehab', id: 'y', name: 'A swapped-in name' },
          params: { kind: 'hold', sets: 1 },
          why: 'An item why.',
          status: 'prescribed',
        },
      },
    ])
    expect(strings).toEqual(expect.arrayContaining(['A reason.', 'A swapped-in name', 'An item why.']))
  })
})

describe('formatCoachReply', () => {
  it('renders all six labels of §10', () => {
    const text = formatCoachReply(reply())
    for (const label of ['READINESS:', 'TODAY:', 'WHY:', 'CHANGED:', 'WEEK:', 'FLAG:']) {
      expect(text).toContain(label)
    }
  })
})

// ── No API key ────────────────────────────────────────────────────────────────

describe('with no ANTHROPIC_API_KEY', () => {
  it('says it is unavailable rather than doing nothing quietly', async () => {
    const result = await callCoach(contract(), 'make today easier', { apiKey: null })
    expect(result).toEqual({ ok: false, code: 'no_api_key', message: NO_KEY_MESSAGE })
  })

  it('never reaches the network', async () => {
    const fetchImpl = jest.fn()
    await callCoach(contract(), 'x', { apiKey: null, fetchImpl: fetchImpl as unknown as FetchLike })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('points at the edit path that still works', () => {
    expect(NO_KEY_MESSAGE).toContain('edit today by hand')
    expect(NO_KEY_MESSAGE).toContain('ANTHROPIC_API_KEY')
  })

  it('returns no patch, rather than an empty one that looks like agreement', async () => {
    const result = await proposeFromText(contract(), session(), 'easier', { apiKey: null })
    expect(result.ok).toBe(false)
    expect('patch' in result).toBe(false)
  })
})

// ── The call itself ───────────────────────────────────────────────────────────

describe('callCoach', () => {
  function fakeFetch(response: unknown, ok = true, status = 200) {
    const calls: Array<{ url: string; init: Record<string, unknown> }> = []
    const impl = (async (url: string, init: Record<string, unknown>) => {
      calls.push({ url, init })
      return {
        ok,
        status,
        text: async () => JSON.stringify(response),
        json: async () => response,
      }
    }) as FetchLike
    return { impl, calls }
  }

  it('posts the tool-constrained request the parser expects back', async () => {
    const { impl, calls } = fakeFetch(okResponse)
    const result = await callCoach(contract(), 'make today easier', {
      apiKey: 'sk-test',
      fetchImpl: impl,
    })
    expect(result.ok).toBe(true)

    const body = JSON.parse(calls[0].init.body as string)
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect(body.model).toBe('claude-opus-5')
    expect(body.tool_choice).toEqual({ type: 'tool', name: COACH_TOOL_NAME })
    expect(body.tools[0].name).toBe(COACH_TOOL_NAME)
    expect(body.messages[0].content).toContain('[run-easy]')
    // Matches ai-summary's header pair.
    expect((calls[0].init.headers as Record<string, string>)['x-api-key']).toBe('sk-test')
    expect((calls[0].init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01')
  })

  it('never returns the upstream error body — it can echo the key (§20)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { impl } = fakeFetch({ error: { message: 'invalid x-api-key: sk-leaked' } }, false, 401)
    const result = await callCoach(contract(), 'x', { apiKey: 'sk-leaked', fetchImpl: impl })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).not.toContain('sk-leaked')
    expect(result.code).toBe('api_error')
    spy.mockRestore()
  })

  it('turns a thrown fetch into an honest message, not a crash', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const impl = (async () => {
      throw new Error('ECONNREFUSED 1.2.3.4:443')
    }) as unknown as FetchLike
    const result = await callCoach(contract(), 'x', { apiKey: 'k', fetchImpl: impl })
    expect(result).toMatchObject({ ok: false, code: 'network_error' })
    if (result.ok) return
    expect(result.message).not.toContain('ECONNREFUSED')
    spy.mockRestore()
  })
})

describe('proposeFromText', () => {
  it('runs call → extract → parse against a recorded response', async () => {
    const impl = (async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => okResponse,
    })) as FetchLike

    const result = await proposeFromText(contract(), session(), 'make today easier', {
      apiKey: 'sk-test',
      fetchImpl: impl,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.actor).toBe('coach')
  })

  it('surfaces a prose answer as a rejection, with no patch', async () => {
    const impl = (async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => proseResponse,
    })) as FetchLike

    const result = await proposeFromText(contract(), session(), 'x', {
      apiKey: 'sk-test',
      fetchImpl: impl,
    })
    expect(result).toMatchObject({ ok: false, code: 'no_tool_use' })
  })
})
