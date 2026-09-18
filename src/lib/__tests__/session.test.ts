import { applySessionPatch, describeParams, validateSessionPatch } from '../session'
import type { ValidationContext } from '../session'
import type { EditableSession, SessionPatch } from '../../types/patch'
import type { SessionBlock, SessionItem } from '../../types/session'
import type { LoadBudget } from '../load'
// ── Fixtures ─────────────────────────────────────────────────────────────────

function budgetFixture(over: Partial<LoadBudget> = {}): LoadBudget {
  return {
    ceiling: 2000,
    target: 1700,
    floor: 0,
    acwr: 1.0,
    acwrCap: 1.3,
    chronicDailyLoad: 300,
    band: 'green',
    calibrating: false,
    reasons: [],
    ...over,
  }
}

function easyRun(id = 'run-1'): SessionItem {
  return {
    id,
    ref: { kind: 'run', id: 'easy', name: 'Easy run' },
    params: { kind: 'run', runType: 'easy', durationMin: 45 },
    status: 'prescribed',
  }
}

function vo2(id = 'vo2-1'): SessionItem {
  return {
    id,
    ref: { kind: 'run', id: 'vo2', name: 'VO₂ intervals' },
    params: { kind: 'run', runType: 'vo2', durationMin: 40 },
    status: 'prescribed',
  }
}

function squat(id = 'squat-1'): SessionItem {
  return {
    id,
    ref: { kind: 'exercise', id: 'back-squat', name: 'Back Squat' },
    params: { kind: 'strength', sets: 3, reps: 8, weightKg: 60, targetRir: 2, restSec: 150 },
    status: 'prescribed',
  }
}

function heelDrop(id = 'calf-1'): SessionItem {
  return {
    id,
    ref: { kind: 'prehab', id: 'heel-drop', name: 'Eccentric heel drop' },
    params: { kind: 'hold', sets: 3, reps: 15, holdSec: 3, perSide: true },
    status: 'prescribed',
  }
}

function session(blocks: SessionBlock[], version = 3): EditableSession {
  return { id: 1, date: new Date('2026-03-15T00:00:00'), status: 'active', version, blocks }
}

function mainOnly(items: SessionItem[], version = 3): EditableSession {
  return session([{ id: 'block-main', kind: 'main', label: 'Main', items }], version)
}

function ctx(over: Partial<ValidationContext> = {}): ValidationContext {
  return {
    budget: budgetFixture({ ceiling: 2000, floor: 0 }),
    band: 'green',
    calibrating: false,
    ...over,
  }
}

function patch(ops: SessionPatch['ops'], over: Partial<SessionPatch> = {}): SessionPatch {
  return { actor: 'user', ops, ...over }
}

// ── Applying ─────────────────────────────────────────────────────────────────

describe('applySessionPatch — mechanics', () => {
  test('modify merges params, bumps the version and records the actor (§11)', () => {
    const before = mainOnly([easyRun()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'modify', itemId: 'run-1', params: { durationMin: 30 }, reason: 'Only 30 min today' }]),
      ctx(),
    )

    expect(result.applied).toBe(true)
    expect(result.session.version).toBe(4)
    expect(result.session.sourceOfLastEdit).toBe('user')
    const item = result.session.blocks[0].items[0]
    expect((item.params as { durationMin?: number | null }).durationMin).toBe(30)
    expect((item.params as { runType: string }).runType).toBe('easy')
    expect(item.status).toBe('edited')
  })

  test('never mutates the session it was handed', () => {
    const before = mainOnly([easyRun()])
    const snapshot = JSON.stringify(before)
    applySessionPatch(before, patch([{ op: 'modify', itemId: 'run-1', params: { durationMin: 30 }, reason: 'x' }]), ctx())
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  test('remove drops the item', () => {
    const before = mainOnly([easyRun(), squat()])
    const result = applySessionPatch(before, patch([{ op: 'remove', itemId: 'squat-1', reason: 'Knee is cranky' }]), ctx())
    expect(result.session.blocks[0].items.map((i) => i.id)).toEqual(['run-1'])
  })

  test('add drops the item into the named block, creating it if need be', () => {
    const before = mainOnly([easyRun()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'add', blockKind: 'cooldown', item: heelDrop(), reason: 'Achilles maintenance' }]),
      ctx(),
    )
    expect(result.session.blocks.map((b) => b.kind)).toEqual(['main', 'cooldown'])
    expect(result.session.blocks[1].items[0].id).toBe('calf-1')
  })

  test('add honours an index', () => {
    const before = mainOnly([easyRun(), squat()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'add', blockKind: 'main', item: heelDrop(), index: 1, reason: 'slot it in' }]),
      ctx(),
    )
    expect(result.session.blocks[0].items.map((i) => i.id)).toEqual(['run-1', 'calf-1', 'squat-1'])
  })

  test('replace swaps one item for another', () => {
    const before = mainOnly([squat()])
    const result = applySessionPatch(
      before,
      patch([{
        op: 'replace',
        itemId: 'squat-1',
        item: heelDrop(),
        reason: 'Swap back squats for something gentler on the knee',
      }]),
      ctx(),
    )
    expect(result.session.blocks[0].items.map((i) => i.id)).toEqual(['calf-1'])
  })

  test('reorder rearranges a block', () => {
    const before = mainOnly([easyRun(), squat()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'reorder', blockKind: 'main', itemIds: ['squat-1', 'run-1'], reason: 'Lift first today' }]),
      ctx(),
    )
    expect(result.session.blocks[0].items.map((i) => i.id)).toEqual(['squat-1', 'run-1'])
  })

  test('an empty patch is "nothing to action", not an error (§14)', () => {
    const before = mainOnly([easyRun()])
    const result = applySessionPatch(before, patch([]), ctx())
    expect(result.applied).toBe(false)
    expect(result.verdict.kind).toBe('ok')
    expect(result.diff.summary).toBe('nothing to action')
    expect(result.session.version).toBe(3)
  })
})

// ── Structural safety ────────────────────────────────────────────────────────

describe('applySessionPatch — structural safety', () => {
  test('an unknown item is pushed back, never silently dropped (§11)', () => {
    const before = mainOnly([easyRun()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'modify', itemId: 'ghost', params: { durationMin: 10 }, reason: 'x' }]),
      ctx(),
    )
    expect(result.applied).toBe(false)
    expect(result.verdict.kind).toBe('pushed_back')
    expect(result.verdict.findings[0].rule).toBe('unknown_item')
  })

  test('a modify may not change what kind of thing an item is', () => {
    const before = mainOnly([easyRun()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'modify', itemId: 'run-1', params: { kind: 'strength', sets: 3 } as never, reason: 'x' }]),
      ctx(),
    )
    expect(result.verdict.kind).toBe('pushed_back')
    expect(result.verdict.findings[0].rule).toBe('kind_change')
  })

  test('a reorder that loses or invents an item is pushed back', () => {
    const before = mainOnly([easyRun(), squat()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'reorder', blockKind: 'main', itemIds: ['squat-1'], reason: 'x' }]),
      ctx(),
    )
    expect(result.verdict.kind).toBe('pushed_back')
    expect(result.verdict.findings[0].rule).toBe('reorder_mismatch')
  })

  test('a structural error survives an override — it is not a judgement call', () => {
    const before = mainOnly([easyRun()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'remove', itemId: 'ghost', reason: 'x' }], { override: true }),
      ctx(),
    )
    expect(result.applied).toBe(false)
  })
})

// ── Reversibility ────────────────────────────────────────────────────────────

describe('applySessionPatch — reversibility (§11)', () => {
  const cases: Array<[string, EditableSession, SessionPatch]> = [
    ['modify', mainOnly([easyRun()]), patch([{ op: 'modify', itemId: 'run-1', params: { durationMin: 25 }, reason: 'r' }])],
    ['remove', mainOnly([easyRun(), squat()]), patch([{ op: 'remove', itemId: 'run-1', reason: 'r' }])],
    ['add', mainOnly([easyRun()]), patch([{ op: 'add', blockKind: 'main', item: squat(), reason: 'r' }])],
    ['add to a new block', mainOnly([easyRun()]), patch([{ op: 'add', blockKind: 'cooldown', item: heelDrop(), reason: 'r' }])],
    ['replace', mainOnly([squat()]), patch([{ op: 'replace', itemId: 'squat-1', item: heelDrop(), reason: 'r' }])],
    ['reorder', mainOnly([easyRun(), squat()]), patch([{ op: 'reorder', blockKind: 'main', itemIds: ['squat-1', 'run-1'], reason: 'r' }])],
  ]

  test.each(cases)('undoing a %s restores the session exactly', (_label, before, p) => {
    const forward = applySessionPatch(before, p, ctx())
    expect(forward.applied).toBe(true)
    expect(forward.inverse).not.toBeNull()

    const back = applySessionPatch(forward.session, forward.inverse!, ctx())
    expect(back.applied).toBe(true)
    expect(back.session.blocks).toEqual(before.blocks)
  })

  test('undo moves the version forward, it does not rewind history', () => {
    const before = mainOnly([easyRun()])
    const forward = applySessionPatch(before, patch([{ op: 'remove', itemId: 'run-1', reason: 'r' }]), ctx())
    const back = applySessionPatch(forward.session, forward.inverse!, ctx())
    expect(back.session.version).toBe(5)
  })

  test('a pushed-back patch has no inverse because nothing happened', () => {
    const before = mainOnly([easyRun()])
    const result = applySessionPatch(before, patch([{ op: 'remove', itemId: 'ghost', reason: 'r' }]), ctx())
    expect(result.inverse).toBeNull()
  })
})

// ── The reviewable diff ──────────────────────────────────────────────────────

describe('the diff (§11, §14)', () => {
  test('shows before and after in words, and carries the reason', () => {
    const before = mainOnly([squat()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'modify', itemId: 'squat-1', params: { sets: 2 }, reason: 'Legs are heavy' }]),
      ctx(),
    )
    const entry = result.diff.entries[0]
    expect(entry.op).toBe('modify')
    expect(entry.name).toBe('Back Squat')
    expect(entry.before).toContain('3×8')
    expect(entry.after).toContain('2×8')
    expect(entry.reason).toBe('Legs are heavy')
  })

  test('reports the load either side of the change', () => {
    const before = mainOnly([easyRun()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'modify', itemId: 'run-1', params: { durationMin: 20 }, reason: 'short on time' }]),
      ctx(),
    )
    expect(result.diff.loadBefore).toBeGreaterThan(result.diff.loadAfter)
  })

  test('a rejected patch still shows what it would have done', () => {
    const before = mainOnly([easyRun()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'modify', itemId: 'run-1', params: { durationMin: 240 }, reason: 'feeling good' }]),
      ctx({ budget: budgetFixture({ ceiling: 200 }) }),
    )
    expect(result.applied).toBe(false)
    expect(result.diff.entries).toHaveLength(1)
    expect(result.diff.loadAfter).toBeGreaterThan(result.diff.loadBefore)
  })
})

describe('describeParams', () => {
  test('reads like a prescription, not a JSON dump', () => {
    expect(describeParams(squat().params)).toBe('3×8 @ 60 kg, RIR 2')
    expect(describeParams({ kind: 'strength', sets: 3, reps: 12, weightKg: null, targetRir: 2 }))
      .toBe('3×12 bodyweight, RIR 2')
    expect(describeParams(easyRun().params)).toBe('easy, 45 min')
    expect(describeParams({ kind: 'contacts', sets: 3, contactsPerSet: 20 })).toBe('3×20 contacts')
    expect(describeParams(heelDrop().params)).toBe('3×15, 3 s hold, per side')
  })
})

// ── The validator pushes down (§11) ──────────────────────────────────────────

describe('validateSessionPatch — the load ceiling', () => {
  test('a small overshoot is applied with a flag, not blocked', () => {
    const before = mainOnly([easyRun()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'modify', itemId: 'run-1', params: { durationMin: 52 }, reason: 'nice morning' }]),
      ctx({ budget: budgetFixture({ ceiling: 200 }) }),
    )
    expect(result.applied).toBe(true)
    expect(result.verdict.kind).toBe('applied_with_flag')
    expect(result.verdict.findings.some((f) => f.rule === 'load_ceiling')).toBe(true)
  })

  test('a big overshoot is pushed back with a safer version attached', () => {
    const before = mainOnly([easyRun()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'modify', itemId: 'run-1', params: { durationMin: 150 }, reason: 'feeling great' }]),
      ctx({ budget: budgetFixture({ ceiling: 200 }) }),
    )
    expect(result.applied).toBe(false)
    expect(result.verdict.kind).toBe('pushed_back')
    expect(result.verdict.counterProposal).toBeDefined()

    // The counter-proposal has to be something the validator would itself accept.
    const safer = applySessionPatch(before, result.verdict.counterProposal!, ctx({ budget: budgetFixture({ ceiling: 200 }) }))
    expect(safer.applied).toBe(true)
  })

  test('a zero budget means nothing gets added today', () => {
    const before = mainOnly([])
    const result = applySessionPatch(
      before,
      patch([{ op: 'add', blockKind: 'main', item: easyRun(), reason: 'just a jog' }]),
      ctx({ budget: budgetFixture({ ceiling: 0 }), band: 'red' }),
    )
    expect(result.verdict.kind).toBe('pushed_back')
  })
})

describe('validateSessionPatch — the training rails', () => {
  test('pushes back a patch that stacks two hard days (§10, §11)', () => {
    const before = mainOnly([easyRun()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'replace', itemId: 'run-1', item: vo2(), reason: 'want to hit intervals' }]),
      ctx({ yesterdayHard: true }),
    )
    expect(result.verdict.kind).toBe('pushed_back')
    expect(result.verdict.findings.some((f) => f.rule === 'back_to_back_hard')).toBe(true)
    expect(result.verdict.message).toMatch(/hard/i)
    expect(result.verdict.counterProposal).toBeDefined()
  })

  test('leaves an unrelated edit alone on a day that was already hard', () => {
    const before = mainOnly([vo2()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'add', blockKind: 'cooldown', item: heelDrop(), reason: 'calf work' }]),
      ctx({ yesterdayHard: true }),
    )
    expect(result.applied).toBe(true)
  })

  test('blocks loading a tissue the athlete flagged as painful (§9)', () => {
    const before = mainOnly([easyRun()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'add', blockKind: 'accessory', item: squat(), reason: 'feel like squatting' }]),
      ctx({
        niggles: [{ id: 'n1', bodyRegion: 'knee', tissues: ['knee'], severity: 7, daysActive: 3 }],
        factsOf: (item) => (item.id === 'squat-1' ? { tissues: ['knee'] } : {}),
      }),
    )
    expect(result.verdict.kind).toBe('pushed_back')
    expect(result.verdict.findings.some((f) => f.rule === 'niggle_contraindicated')).toBe(true)
  })

  test('keeps heavy legs off the day before a long run (§8)', () => {
    const before = mainOnly([easyRun()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'add', blockKind: 'main', item: squat(), reason: 'squats today' }]),
      ctx({
        tomorrow: { runType: 'long', priority: 'A' },
        factsOf: () => ({ heavyLowerBody: true }),
      }),
    )
    expect(result.verdict.kind).toBe('pushed_back')
    expect(result.verdict.findings.some((f) => f.rule === 'concurrent_training')).toBe(true)
  })

  test('caps how fast a load can climb while the anchors are still guesses (§5b)', () => {
    const before = mainOnly([squat()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'modify', itemId: 'squat-1', params: { weightKg: 75 }, reason: 'felt easy last week' }]),
      ctx({ calibrating: true }),
    )
    expect(result.verdict.kind).toBe('pushed_back')
    expect(result.verdict.findings.some((f) => f.rule === 'calibration_ramp_cap')).toBe(true)
  })

  test('the same jump is only flagged once the numbers are known', () => {
    const before = mainOnly([squat()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'modify', itemId: 'squat-1', params: { weightKg: 75 }, reason: 'felt easy last week' }]),
      ctx({ calibrating: false }),
    )
    expect(result.applied).toBe(true)
    expect(result.verdict.kind).toBe('applied_with_flag')
  })

  test('a small, sane load increase passes clean', () => {
    const before = mainOnly([squat()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'modify', itemId: 'squat-1', params: { weightKg: 62.5 }, reason: 'RIR 4 last time' }]),
      ctx(),
    )
    expect(result.verdict.kind).toBe('ok')
  })
})

// ── Override, and the floor that override cannot cross (§10, §15) ────────────

describe('override', () => {
  test('an override turns a judgement-call block into an applied flag', () => {
    const before = mainOnly([easyRun()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'replace', itemId: 'run-1', item: vo2(), reason: 'doing it anyway' }], { override: true }),
      ctx({ yesterdayHard: true }),
    )
    expect(result.applied).toBe(true)
    expect(result.verdict.kind).toBe('applied_with_flag')
    expect(result.verdict.findings.some((f) => f.rule === 'back_to_back_hard')).toBe(true)
  })

  test('an override cannot cross the safety floor — a painful tissue stays protected (§15)', () => {
    const before = mainOnly([easyRun()])
    const result = applySessionPatch(
      before,
      patch([{ op: 'add', blockKind: 'main', item: squat(), reason: 'doing it anyway' }], { override: true }),
      ctx({
        niggles: [{ id: 'n1', bodyRegion: 'knee', tissues: ['knee'], severity: 8, daysActive: 3 }],
        factsOf: () => ({ tissues: ['knee'] }),
      }),
    )
    expect(result.applied).toBe(false)
    expect(result.verdict.kind).toBe('pushed_back')
    expect(result.verdict.findings.some((f) => f.hardFloor)).toBe(true)
  })
})

// ── The validator pushes up too (§21 — the Contrarian) ───────────────────────

describe('validateSessionPatch — quality dodging (§21)', () => {
  const dodge = patch([{ op: 'remove', itemId: 'vo2-1', reason: 'not feeling it' }])

  test('flags a pattern of dodging the hard sessions', () => {
    const result = applySessionPatch(
      mainOnly([vo2(), heelDrop()]),
      dodge,
      ctx({ qualityHistory: { prescribed: 4, dodged: 2, windowDays: 28 } }),
    )
    expect(result.applied).toBe(true)
    expect(result.verdict.kind).toBe('applied_with_flag')
    const finding = result.verdict.findings.find((f) => f.rule === 'quality_dodging')
    expect(finding).toBeDefined()
    expect(finding!.message).toMatch(/quality|hard|80\/20/i)
  })

  test('offers a smaller version of the quality work rather than none of it', () => {
    const result = applySessionPatch(
      mainOnly([vo2()]),
      dodge,
      ctx({ qualityHistory: { prescribed: 4, dodged: 3, windowDays: 28 } }),
    )
    expect(result.verdict.counterProposal).toBeDefined()
    const softened = applySessionPatch(mainOnly([vo2()]), result.verdict.counterProposal!, ctx())
    expect(softened.session.blocks[0].items).toHaveLength(1)
    const durationMin = (softened.session.blocks[0].items[0].params as { durationMin?: number | null }).durationMin
    expect(durationMin).toBeLessThan(40)
    expect(durationMin).toBeGreaterThan(0)
  })

  test('one bad day is not a pattern — it applies clean', () => {
    const result = applySessionPatch(
      mainOnly([vo2()]),
      dodge,
      ctx({ qualityHistory: { prescribed: 6, dodged: 0, windowDays: 28 } }),
    )
    expect(result.verdict.kind).toBe('ok')
  })

  test('softening a hard session counts as a dodge, not only deleting it', () => {
    const result = applySessionPatch(
      mainOnly([vo2()]),
      patch([{ op: 'modify', itemId: 'vo2-1', params: { durationMin: 10 }, reason: 'make it easier' }]),
      ctx({ qualityHistory: { prescribed: 4, dodged: 2, windowDays: 28 } }),
    )
    expect(result.verdict.findings.some((f) => f.rule === 'quality_dodging')).toBe(true)
  })

  test('trimming an easy run is not dodging anything', () => {
    const result = applySessionPatch(
      mainOnly([easyRun()]),
      patch([{ op: 'modify', itemId: 'run-1', params: { durationMin: 20 }, reason: 'short on time' }]),
      ctx({ qualityHistory: { prescribed: 4, dodged: 3, windowDays: 28 } }),
    )
    expect(result.verdict.findings.some((f) => f.rule === 'quality_dodging')).toBe(false)
  })
})

// ── One funnel, two actors (§11) ─────────────────────────────────────────────

describe('one funnel for both actors', () => {
  const p = patch([{ op: 'replace', itemId: 'run-1', item: vo2(), reason: 'intervals' }])

  test('the coach and the athlete get the identical verdict', () => {
    const context = ctx({ yesterdayHard: true })
    const asUser = validateSessionPatch(mainOnly([easyRun()]), { ...p, actor: 'user' }, context)
    const asCoach = validateSessionPatch(mainOnly([easyRun()]), { ...p, actor: 'coach' }, context)

    expect(asCoach.kind).toBe(asUser.kind)
    expect(asCoach.findings.map((f) => f.rule)).toEqual(asUser.findings.map((f) => f.rule))
  })

  test('validateSessionPatch changes nothing on its own', () => {
    const before = mainOnly([easyRun()])
    const snapshot = JSON.stringify(before)
    validateSessionPatch(before, p, ctx())
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
