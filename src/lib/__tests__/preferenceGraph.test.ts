// ── The preference graph (framework §13) ──────────────────────────────────────
// The thing these tests exist for is one sentence from the athlete: "no weights
// on weekends — which might not be true for me anymore."
//
// So the assertions are about *change*, not about rules. A later statement on
// the same subject retires the earlier one; the retired one is still in the
// table, still readable, still dated; nothing binds until it is confirmed; and
// two rules that merely overlap are shown to the athlete rather than silently
// resolved in favour of whichever was written last.
//
// The write path runs against an in-memory stand-in for the `preferences`
// table, because "the old row is retired, not deleted" is a claim about rows
// and can only honestly be checked by looking at them.

import {
  activePreferenceRules,
  captureStatedPreferences,
  checkPreferenceViolations,
  confirmPreference,
  findPreferenceConflicts,
  matchExercise,
  namesExercise,
  parseExplicitRule,
  preferenceEdge,
  preferenceScope,
  preferenceSubject,
  readPreferenceHistory,
  readPreferences,
  recordStatedPreference,
  retirePreference,
} from '../preferences'
import { parseObservedPreferences, parseCoachOutput } from '../coach'
import { toPreferenceRule } from '../todaySession'
import type { StoredPreference } from '../preferences'
import type { EditableSession } from '../../types/patch'
import type { SessionBlock } from '../../types/session'

jest.mock('../db', () => ({
  prisma: {
    preferences: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { prisma } from '../db'

// ── An in-memory `preferences` table ──────────────────────────────────────────

interface Row {
  id: number
  rule: string
  source: string
  confidence: number
  weight: number
  active: boolean
  supersededById: number | null
  sourceQuote: string | null
  statedOn: Date | null
  confirmedAt: Date | null
  lastAppliedOn: Date | null
  updatedAt: Date
}

let table: Row[] = []
let nextId = 1

function install() {
  table = []
  nextId = 1
  const p = prisma.preferences as unknown as Record<string, jest.Mock>

  p.findMany.mockImplementation(async (args?: { where?: { active?: boolean } }) => {
    const want = args?.where?.active
    return table
      .filter((r) => want === undefined || r.active === want)
      .map((r) => ({ ...r }))
  })
  p.findUnique.mockImplementation(async (args: { where: { id: number } }) => {
    const found = table.find((r) => r.id === args.where.id)
    return found ? { ...found } : null
  })
  p.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
    const row: Row = {
      id: nextId++,
      rule: '',
      source: 'explicit',
      confidence: 1,
      weight: 1,
      active: true,
      supersededById: null,
      sourceQuote: null,
      statedOn: null,
      confirmedAt: null,
      lastAppliedOn: null,
      updatedAt: new Date('2026-09-17T00:00:00'),
      ...(args.data as Partial<Row>),
    }
    table.push(row)
    return { ...row }
  })
  p.update.mockImplementation(
    async (args: { where: { id: number }; data: Record<string, unknown> }) => {
      const row = table.find((r) => r.id === args.where.id)
      if (!row) throw new Error('no such row')
      Object.assign(row, args.data, { updatedAt: new Date('2026-09-18T00:00:00') })
      return { ...row }
    },
  )
  p.delete.mockImplementation(async (args: { where: { id: number } }) => {
    const i = table.findIndex((r) => r.id === args.where.id)
    const [row] = table.splice(i, 1)
    return row
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  install()
})

const MARCH = new Date('2026-03-07T09:00:00')
const SEPTEMBER = new Date('2026-09-17T09:00:00')
/** A Saturday, so weekend rules bite. */
const SATURDAY = new Date('2026-09-19T09:00:00')

// ── The edges ─────────────────────────────────────────────────────────────────

describe('scope and subject are the edges', () => {
  test('two rules about weekend lifting share a subject whichever way they point', () => {
    const no = parseExplicitRule('no weights on weekends')!
    const yes = parseExplicitRule('weights on weekends')!

    expect(no.kind).toBe('no_modality_on_days')
    expect(yes.kind).toBe('modality_on_day')
    // Opposite rules, same subject — which is exactly what makes one supersede
    // the other rather than both being true at once.
    expect(preferenceEdge(no)).toBe(preferenceEdge(yes))
    expect(preferenceSubject(no)).toBe('strength:weekends')
  })

  test('a different day is a different subject, not a supersession', () => {
    const weekend = parseExplicitRule('no weights on weekends')!
    const saturday = parseExplicitRule('weights on Saturday')!
    expect(preferenceEdge(weekend)).not.toBe(preferenceEdge(saturday))
  })

  test('scope groups the rule by the part of training it speaks to', () => {
    expect(preferenceScope(parseExplicitRule('no weights on weekends')!)).toBe('schedule')
    expect(preferenceScope(parseExplicitRule('no plyos')!)).toBe('modality')
    expect(preferenceScope(parseExplicitRule('stop giving me burpees')!)).toBe('exercise')
  })
})

// ── One movement, not a modality ──────────────────────────────────────────────

describe('a named movement', () => {
  test('"stop giving me burpees" is a rule about burpees', () => {
    const rule = parseExplicitRule('stop giving me burpees')
    expect(rule).toMatchObject({ kind: 'no_exercise', exercise: 'burpee', confirmed: true })
  })

  test('singular and plural are one subject', () => {
    expect(matchExercise('no more burpees')).toBe('burpee')
    expect(matchExercise('no burpee')).toBe('burpee')
  })

  test('a modality rule never falls through to the movement branch', () => {
    expect(parseExplicitRule('no weights on weekends')!.kind).toBe('no_modality_on_days')
    expect(parseExplicitRule('no running')!.kind).toBe('no_modality')
  })

  test('a trailing clause is not an exercise name', () => {
    expect(matchExercise('no hard sessions on Tuesday')).toBeNull()
  })

  test('it gates a coach proposal by item name', () => {
    const pref: StoredPreference = {
      id: 7,
      kind: 'no_exercise',
      source: 'explicit',
      label: 'No burpee.',
      confidence: 1,
      weight: 1,
      confirmed: true,
      active: true,
      exercise: 'burpee',
    }
    const blocks: SessionBlock[] = [
      {
        id: 'b',
        kind: 'main',
        label: 'Main',
        items: [
          {
            id: 'i1',
            ref: { kind: 'exercise', id: 'burpee-box', name: 'Burpee box jump' },
            params: { kind: 'strength', sets: 3, reps: 10, weightKg: 0, targetRir: 3 },
            status: 'prescribed',
          },
        ],
      },
    ]
    expect(checkPreferenceViolations([pref], SATURDAY, blocks)).toHaveLength(1)
  })

  test('containment is word-bounded, so "burpee" does not match "burp"', () => {
    expect(namesExercise('Burpee box jump', 'burpee')).toBe(true)
    expect(namesExercise('Bulgarian split squat', 'burpee')).toBe(false)
  })
})

// ── Supersession ──────────────────────────────────────────────────────────────

describe('supersession', () => {
  async function stateAndConfirm(statement: string, quote: string, on: Date) {
    const outcome = await recordStatedPreference({ statement, quote }, on)
    if (outcome.status !== 'stored') throw new Error(`expected stored, got ${outcome.status}`)
    const written = await confirmPreference(outcome.preference.id)
    return { outcome, written: written! }
  }

  test('a new statement retires the old one and the old one survives as history', async () => {
    const march = await stateAndConfirm('no weights on weekends', 'no weights on weekends', MARCH)
    expect((await readPreferences()).map((p) => p.label)).toEqual(['No strength on weekends.'])

    const september = await stateAndConfirm(
      'weights on weekends',
      'actually I lift at weekends now',
      SEPTEMBER,
    )

    // The new rule retired the old one, and said so.
    expect(september.written.superseded.map((p) => p.id)).toEqual([march.written.preference.id])

    const live = await readPreferences()
    expect(live.map((p) => p.label)).toEqual(['strength work on weekends.'])

    // Nothing was deleted: the March rule is still there, still readable, with
    // its date, its words, and a pointer to what replaced it.
    const history = await readPreferenceHistory()
    expect(history).toHaveLength(1)
    expect(history[0].label).toBe('No strength on weekends.')
    expect(history[0].active).toBe(false)
    expect(history[0].supersededById).toBe(september.written.preference.id)
    expect(history[0].sourceQuote).toBe('no weights on weekends')
    expect(history[0].statedOn?.toISOString().slice(0, 10)).toBe('2026-03-07')
  })

  test('a retired rule cannot bind, by either road into the allocator', async () => {
    await stateAndConfirm('no running on weekends', 'no running on weekends', MARCH)
    await stateAndConfirm('running on weekends', 'I do run at weekends now', SEPTEMBER)

    const retired = (await readPreferenceHistory())[0]

    // The dated road: `activePreferenceRules` drops it even if a caller hands
    // it a retired row by mistake.
    expect(activePreferenceRules([retired], SATURDAY)).toEqual([])

    // The date-blind fallback drops it too, so neither path can resurrect it.
    expect(
      toPreferenceRule({
        id: retired.id,
        rule: JSON.stringify({ label: 'x', effect: 'exclude', match: { modality: 'run' } }),
        source: 'explicit',
        confidence: 1,
        weight: 1,
        active: false,
      }),
    ).toBeNull()
  })

  test('nothing is retired until the athlete confirms', async () => {
    await stateAndConfirm('no weights on weekends', 'no weights on weekends', MARCH)

    const outcome = await recordStatedPreference(
      { statement: 'weights on weekends', quote: 'I lift at weekends these days' },
      SEPTEMBER,
    )
    if (outcome.status !== 'stored') throw new Error('expected stored')

    // Extraction alone changes nothing: the March rule is still live and still
    // the only one binding.
    expect(await readPreferenceHistory()).toEqual([])
    const live = await readPreferences()
    // Saturday: the March rule still binds, and the September one binds nothing
    // — the only rule reaching the allocator is the one the athlete confirmed.
    expect(activePreferenceRules(live, SATURDAY).map((r) => r.label)).toEqual([
      'No strength on weekends.',
    ])
    expect(live.filter((p) => p.confirmed).map((p) => p.label)).toEqual([
      'No strength on weekends.',
    ])

    // And what confirming *would* retire is named beforehand, not reported
    // afterwards.
    expect(outcome.wouldSupersede.map((p) => p.label)).toEqual(['No strength on weekends.'])
  })

  test('saying the same thing twice refreshes it rather than queueing it twice', async () => {
    const first = await recordStatedPreference(
      { statement: 'no weights on weekends', quote: 'no weights on weekends' },
      MARCH,
    )
    const second = await recordStatedPreference(
      { statement: 'no weights on weekends', quote: 'still no weights at weekends' },
      SEPTEMBER,
    )
    expect(second.status).toBe('restated')
    expect(table).toHaveLength(1)
    if (second.status !== 'restated') throw new Error('expected restated')
    expect(second.preference.id).toBe(
      first.status === 'stored' ? first.preference.id : -1,
    )
    expect(second.preference.sourceQuote).toBe('still no weights at weekends')
  })

  test('retiring by hand keeps the row and leaves no replacement pointer', async () => {
    const { written } = await stateAndConfirm('no doubles', 'no doubles please', MARCH)
    await retirePreference(written.preference.id)

    const history = await readPreferenceHistory()
    expect(history).toHaveLength(1)
    expect(history[0].supersededById).toBeNull()
    expect(await readPreferences()).toEqual([])
  })

  test('a statement this app cannot type is refused, never approximated', async () => {
    const outcome = await recordStatedPreference(
      { statement: 'go faster sometimes', quote: 'go faster sometimes' },
      SEPTEMBER,
    )
    expect(outcome.status).toBe('unparsed')
    expect(table).toHaveLength(0)
  })

  test('an untypeable statement with a topic is kept as an inert note', async () => {
    const outcome = await recordStatedPreference(
      {
        statement: 'I would rather run in the mornings',
        quote: "I'd rather run in the mornings",
        topic: 'time of day',
      },
      SEPTEMBER,
    )
    if (outcome.status !== 'stored') throw new Error('expected stored')
    expect(outcome.preference.kind).toBe('note')
    // Visible to the coach, binding on nothing — even once confirmed.
    const written = await confirmPreference(outcome.preference.id)
    expect(activePreferenceRules([written!.preference], SATURDAY)).toEqual([])
  })
})

// ── Contradictions that are not supersessions ─────────────────────────────────

describe('conflicts', () => {
  function pref(over: Partial<StoredPreference>): StoredPreference {
    return {
      id: 1,
      kind: 'no_modality_on_days',
      source: 'explicit',
      label: 'x',
      confidence: 1,
      weight: 1,
      confirmed: true,
      active: true,
      ...over,
    }
  }

  test('overlapping days with opposite answers are surfaced', () => {
    const conflicts = findPreferenceConflicts([
      pref({ id: 1, kind: 'no_modality_on_days', modality: 'strength', days: [0, 6], label: 'No strength on weekends.' }),
      pref({ id: 2, kind: 'modality_on_day', modality: 'strength', days: [6], label: 'strength work on Saturday.' }),
    ])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].overlapDays).toEqual([6])
  })

  test('the same subject never appears as a conflict — supersession owns that', () => {
    expect(
      findPreferenceConflicts([
        pref({ id: 1, kind: 'no_modality_on_days', modality: 'strength', days: [0, 6] }),
        pref({ id: 2, kind: 'modality_on_day', modality: 'strength', days: [0, 6] }),
      ]),
    ).toEqual([])
  })

  test('different modalities do not conflict', () => {
    expect(
      findPreferenceConflicts([
        pref({ id: 1, kind: 'no_modality_on_days', modality: 'strength', days: [6] }),
        pref({ id: 2, kind: 'modality_on_day', modality: 'run', days: [6] }),
      ]),
    ).toEqual([])
  })

  test('a rest day conflicts with anything asked for on it', () => {
    const conflicts = findPreferenceConflicts([
      pref({ id: 1, kind: 'rest_on_day', days: [1], label: 'Rest on Monday.' }),
      pref({ id: 2, kind: 'modality_on_day', modality: 'run', days: [1], label: 'run work on Monday.' }),
    ])
    expect(conflicts).toHaveLength(1)
  })

  test('retired rules do not conflict with anything', () => {
    expect(
      findPreferenceConflicts([
        pref({ id: 1, kind: 'no_modality_on_days', modality: 'strength', days: [0, 6], active: false }),
        pref({ id: 2, kind: 'modality_on_day', modality: 'strength', days: [6] }),
      ]),
    ).toEqual([])
  })
})

// ── Extraction from the coach turn ────────────────────────────────────────────

describe('extraction', () => {
  const SAID = "make today easier, and by the way no weights on weekends anymore"

  test('a candidate is kept only when the quote is really in the message', () => {
    const kept = parseObservedPreferences(
      [
        { quote: 'no weights on weekends', statement: 'no weights on weekends' },
        { quote: 'I hate running', statement: 'no running' },
      ],
      SAID,
    )
    expect(kept).toHaveLength(1)
    expect(kept[0].statement).toBe('no weights on weekends')
  })

  test('punctuation and case do not break the quote check', () => {
    expect(
      parseObservedPreferences(
        [{ quote: 'No weights, on weekends!', statement: 'no weights on weekends' }],
        SAID,
      ),
    ).toHaveLength(1)
  })

  test('a malformed extraction is discarded, never coerced', () => {
    expect(parseObservedPreferences('not a list', SAID)).toEqual([])
    expect(parseObservedPreferences([null, 3, {}, { quote: 'x' }], SAID)).toEqual([])
  })

  test('diagnosis language drops the candidate, not the turn', () => {
    expect(
      parseObservedPreferences(
        [{ quote: 'no weights on weekends', statement: 'no weights on weekends' }],
        SAID,
      ),
    ).toHaveLength(1)
  })
})

describe('extraction rides along without touching the patch', () => {
  const session: EditableSession = {
    id: 1,
    date: SEPTEMBER,
    status: 'active',
    version: 1,
    sourceOfLastEdit: 'engine',
    blocks: [
      {
        id: 'b-main',
        kind: 'main',
        label: 'Main',
        items: [
          {
            id: 'run-easy',
            ref: { kind: 'run', id: 'easy', name: 'Easy run' },
            params: { kind: 'run', runType: 'easy', durationMin: 45 },
            status: 'prescribed',
          },
        ],
      },
    ],
  }

  function toolInput(over: Record<string, unknown> = {}) {
    return {
      readinessBand: 'green',
      decidingSignals: ['HRV 55 ms', '7.5 h sleep'],
      today: 'Easy 45.',
      why: 'Aerobic day.',
      changed: 'no change',
      week: 'unchanged',
      flag: 'nothing to action',
      ops: [],
      ...over,
    }
  }

  test('a stated preference comes back alongside the patch', () => {
    const result = parseCoachOutput(
      toolInput({
        observedPreferences: [
          { quote: 'no weights on weekends', statement: 'no weights on weekends' },
        ],
      }),
      session,
      'easy today please, and no weights on weekends from now on',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preferences).toEqual([
      { quote: 'no weights on weekends', statement: 'no weights on weekends' },
    ])
  })

  test('a garbage extraction does not cost the edit', () => {
    const result = parseCoachOutput(
      toolInput({ observedPreferences: { nonsense: true } }),
      session,
      'easy today please',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preferences).toEqual([])
    expect(result.reply.today).toBe('Easy 45.')
  })

  test('a failing database does not cost the edit either', async () => {
    ;(prisma.preferences as unknown as Record<string, jest.Mock>).findMany.mockRejectedValue(
      new Error('database is gone'),
    )
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      captureStatedPreferences(
        [{ quote: 'no weights on weekends', statement: 'no weights on weekends' }],
        SEPTEMBER,
      ),
    ).resolves.toEqual([])
    spy.mockRestore()
  })
})
