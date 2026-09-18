import { allocateSession } from '../allocator'
import type { AllocatorInput, CandidateItem, Niggle, PreferenceRule } from '../allocator'
import { NEAR_FREE_ALLOWANCE } from '../load'
import type { LoadBudget } from '../load'
import type { SessionItem } from '../../types/session'

// ── Fixtures ─────────────────────────────────────────────────────────────────

function budget(over: Partial<LoadBudget> = {}): LoadBudget {
  return {
    ceiling: 500,
    target: 425,
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

function item(id: string, name: string, kind: SessionItem['ref']['kind']): SessionItem {
  const params: SessionItem['params'] =
    kind === 'run'
      ? { kind: 'run', runType: 'easy', durationMin: 45 }
      : kind === 'plyo'
        ? { kind: 'contacts', sets: 3, contactsPerSet: 20 }
        : kind === 'exercise'
          ? { kind: 'strength', sets: 3, reps: 8, weightKg: 60, targetRir: 2 }
          : { kind: 'hold', sets: 2, reps: 12, holdSec: 3 }
  return { id, ref: { kind, id: `lib-${id}`, name }, params, status: 'prescribed' }
}

function candidate(over: Partial<CandidateItem> & { id: string }): CandidateItem {
  const kind = over.modality === 'run' ? 'run' : over.modality === 'plyo' ? 'plyo' : over.modality === 'strength' ? 'exercise' : 'prehab'
  return {
    item: item(over.id, over.id, kind),
    cost: { durationMin: 40, srpe: 5, load: 200, hardness: 5 },
    priority: 'B',
    placement: 'main',
    modality: 'strength',
    ...over,
  } as CandidateItem
}

function input(over: Partial<AllocatorInput> = {}): AllocatorInput {
  return {
    date: new Date('2026-03-15T09:00:00'),
    band: 'green',
    calibrating: false,
    anchorConfidence: 'confirmed',
    intent: { primaryModality: 'run', isQualityDay: false, priority: 'B' },
    budget: budget(),
    candidates: [],
    ...over,
  }
}

const ACHILLES: Niggle = {
  id: 'n1',
  bodyRegion: 'ankle',
  tissues: ['achilles', 'calf'],
  severity: 3,
  daysActive: 2,
}

// ── Shape and ordering ───────────────────────────────────────────────────────

describe('allocateSession — shape', () => {
  test('an empty candidate list yields an empty session rather than throwing', () => {
    const out = allocateSession(input())
    expect(out.blocks).toEqual([])
    expect(out.plannedLoad).toBe(0)
    expect(out.decisions).toEqual([])
  })

  test('blocks come back in warmup → main → accessory → cooldown order (§3)', () => {
    const out = allocateSession(
      input({
        candidates: [
          candidate({ id: 'cooldown-stretch', placement: 'cooldown', modality: 'stretch', cost: { durationMin: 6, srpe: 2, load: 12, hardness: 2 } }),
          candidate({ id: 'main-run', placement: 'main', modality: 'run' }),
          candidate({ id: 'warmup-drill', placement: 'warmup', modality: 'stretch', cost: { durationMin: 6, srpe: 2, load: 12, hardness: 2 } }),
          candidate({ id: 'accessory-calf', placement: 'accessory', modality: 'strength', cost: { durationMin: 8, srpe: 4, load: 32, hardness: 4 } }),
        ],
      }),
    )
    expect(out.blocks.map((b) => b.kind)).toEqual(['warmup', 'main', 'accessory', 'cooldown'])
    expect(out.blocks.every((b) => b.items.length > 0)).toBe(true)
  })

  test('every candidate gets a decision with a machine-readable code and a sentence', () => {
    const out = allocateSession(
      input({
        budget: budget({ ceiling: 250 }),
        candidates: [
          candidate({ id: 'a', priority: 'A' }),
          candidate({ id: 'b', priority: 'C' }),
        ],
      }),
    )
    expect(out.decisions).toHaveLength(2)
    for (const d of out.decisions) {
      expect(d.code).toBeTruthy()
      expect(d.reason.length).toBeGreaterThan(5)
      expect(['selected', 'trimmed', 'rejected']).toContain(d.outcome)
    }
  })

  test('plannedLoad is the sum of what actually made it in', () => {
    const out = allocateSession(
      input({
        candidates: [
          candidate({ id: 'a', priority: 'A', cost: { durationMin: 40, srpe: 5, load: 200, hardness: 5 } }),
          candidate({ id: 'b', priority: 'B', cost: { durationMin: 20, srpe: 4, load: 80, hardness: 4 } }),
        ],
      }),
    )
    expect(out.plannedLoad).toBeCloseTo(280, 4)
  })
})

// ── The load ceiling ─────────────────────────────────────────────────────────

describe('allocateSession — load ceiling', () => {
  test('spends A priority first and refuses what no longer fits', () => {
    const out = allocateSession(
      input({
        budget: budget({ ceiling: 300 }),
        candidates: [
          candidate({ id: 'nice-to-have', priority: 'C', cost: { durationMin: 40, srpe: 5, load: 200, hardness: 5 } }),
          candidate({ id: 'the-point-of-today', priority: 'A', cost: { durationMin: 40, srpe: 5, load: 200, hardness: 5 } }),
        ],
      }),
    )
    const byId = Object.fromEntries(out.decisions.map((d) => [d.itemId, d]))
    expect(byId['the-point-of-today'].outcome).toBe('selected')
    expect(byId['nice-to-have'].outcome).toBe('rejected')
    expect(byId['nice-to-have'].code).toBe('budget_exhausted')
  })

  test('trims an A-priority item rather than dropping it', () => {
    const out = allocateSession(
      input({
        budget: budget({ ceiling: 300 }),
        candidates: [
          candidate({
            id: 'long-run',
            priority: 'A',
            modality: 'run',
            cost: { durationMin: 60, srpe: 5, load: 600, hardness: 5 },
          }),
        ],
      }),
    )
    const d = out.decisions[0]
    expect(d.outcome).toBe('trimmed')
    expect(d.code).toBe('trimmed_to_budget')
    const placed = out.blocks[0].items[0]
    expect((placed.params as { durationMin?: number | null }).durationMin).toBeLessThan(60)
    expect(out.plannedLoad).toBeLessThanOrEqual(300)
  })

  test('near-free prehab still lands after the budget is spent (§9)', () => {
    const out = allocateSession(
      input({
        budget: budget({ ceiling: 200 }),
        candidates: [
          candidate({ id: 'main-lift', priority: 'A', cost: { durationMin: 40, srpe: 5, load: 200, hardness: 5 } }),
          candidate({
            id: 'calf-raises',
            priority: 'B',
            placement: 'accessory',
            modality: 'prehab',
            cost: { durationMin: 6, srpe: 2, load: 12, hardness: 2 },
          }),
        ],
      }),
    )
    const byId = Object.fromEntries(out.decisions.map((d) => [d.itemId, d]))
    expect(byId['calf-raises'].outcome).toBe('selected')
    expect(byId['calf-raises'].code).toBe('near_free')
  })

  // §9 says "fit a small dose", not "fit any number of small doses". Fourteen
  // sub-40 items on the dev DB came to 210 load against a 98 ceiling, all of it
  // free, which is the whole reason the allowance exists.
  test('the near-free exemption is a small dose, not an open bar (§9)', () => {
    const many = new Array(14).fill(null).map((_, i) =>
      candidate({
        id: `mobility-${i}`,
        priority: 'C',
        placement: 'accessory',
        modality: 'prehab',
        cost: { durationMin: 8, srpe: 2, load: 15, hardness: 2 },
      }),
    )
    const out = allocateSession(input({ budget: budget({ ceiling: 98 }), candidates: many }))

    expect(out.nearFreeLoad).toBeLessThanOrEqual(NEAR_FREE_ALLOWANCE)
    expect(out.plannedLoad).toBeLessThanOrEqual(98 + NEAR_FREE_ALLOWANCE)

    const free = out.decisions.filter((d) => d.code === 'near_free')
    expect(free.length).toBeLessThan(many.length)
    expect(free.length).toBeGreaterThan(0)
  })

  test('past the allowance a cheap item competes for the budget like anything else', () => {
    const cheap = (i: number) =>
      candidate({
        id: `mobility-${i}`,
        priority: 'C',
        placement: 'accessory',
        modality: 'prehab',
        cost: { durationMin: 8, srpe: 2, load: 30, hardness: 2 },
      })
    // Two ride the allowance (60); the third has to find room in a spent budget.
    const out = allocateSession(
      input({
        budget: budget({ ceiling: 200 }),
        candidates: [
          candidate({ id: 'main-lift', priority: 'A', cost: { durationMin: 40, srpe: 5, load: 200, hardness: 5 } }),
          cheap(0),
          cheap(1),
          cheap(2),
        ],
      }),
    )
    const byId = Object.fromEntries(out.decisions.map((d) => [d.itemId, d]))
    expect(byId['mobility-0'].code).toBe('near_free')
    expect(byId['mobility-1'].code).toBe('near_free')
    expect(byId['mobility-2'].outcome).toBe('rejected')
    expect(byId['mobility-2'].code).toBe('budget_exhausted')
    expect(out.nearFreeLoad).toBe(60)
  })

  // A small plyo dose prices under the per-item line — 30 contacts is about 27
  // load — but §9 doses plyometrics in contacts and ramps them with ACWR
  // precisely because they are expensive where the clock cannot see. The
  // exemption belongs to the work §9 calls near-free, not to everything cheap.
  test('a cheap plyo dose pays for itself rather than riding the allowance (§9)', () => {
    const out = allocateSession(
      input({
        budget: budget({ ceiling: 200 }),
        candidates: [
          candidate({ id: 'main-lift', priority: 'A', cost: { durationMin: 40, srpe: 5, load: 200, hardness: 5 } }),
          candidate({
            id: 'pogos',
            priority: 'B',
            placement: 'main',
            modality: 'plyo',
            cost: { durationMin: 5, srpe: 6, load: 27, hardness: 6, contacts: 30 },
          }),
          candidate({
            id: 'calf-raises',
            priority: 'B',
            placement: 'accessory',
            modality: 'prehab',
            cost: { durationMin: 8, srpe: 2, load: 15, hardness: 2 },
          }),
        ],
      }),
    )
    const byId = Object.fromEntries(out.decisions.map((d) => [d.itemId, d]))
    expect(byId['pogos'].outcome).toBe('rejected')
    expect(byId['pogos'].code).toBe('budget_exhausted')
    expect(byId['calf-raises'].code).toBe('near_free')
    expect(out.nearFreeLoad).toBe(15)
  })

  // Which cheap item gets the allowance before it runs out is a decision, not
  // an accident of iteration order: §9 has the coach *insert* the targeted
  // protocol for a logged niggle, so heel drops do not lose their exemption to a
  // warmup drill that merely got offered first.
  test('the allowance goes to prehab treating a niggle before routine mobility (§9)', () => {
    const routine = (i: number) =>
      candidate({
        id: `mobility-${i}`,
        priority: 'A',
        placement: 'warmup',
        modality: 'stretch',
        cost: { durationMin: 8, srpe: 2, load: 20, hardness: 2 },
      })
    const out = allocateSession(
      input({
        budget: budget({ ceiling: 20 }),
        niggles: [ACHILLES],
        candidates: [
          routine(0),
          routine(1),
          routine(2),
          routine(3),
          candidate({
            id: 'heel-drops',
            priority: 'B',
            placement: 'accessory',
            modality: 'prehab',
            cost: { durationMin: 10, srpe: 2, load: 20, hardness: 2 },
            constraints: { treats: ['achilles'] },
          }),
        ],
      }),
    )
    const byId = Object.fromEntries(out.decisions.map((d) => [d.itemId, d]))
    expect(byId['heel-drops'].outcome).toBe('selected')
    expect(byId['heel-drops'].code).toBe('niggle_targeted')
    // The allowance is still a small dose — the routine drills that fit ride it,
    // the rest compete for a ceiling the targeted work has already eaten into.
    expect(out.nearFreeLoad).toBeLessThanOrEqual(NEAR_FREE_ALLOWANCE)
    expect(out.decisions.filter((d) => d.code === 'near_free' && d.outcome === 'selected').length)
      .toBeGreaterThan(0)
    expect(out.decisions.filter((d) => d.outcome === 'rejected').length).toBeGreaterThan(0)
  })

  test('a zero ceiling means a rest day, and says so', () => {
    const out = allocateSession(
      input({
        band: 'red',
        budget: budget({ ceiling: 0, band: 'red' }),
        candidates: [candidate({ id: 'run', priority: 'A', modality: 'run' })],
      }),
    )
    expect(out.decisions[0].outcome).toBe('rejected')
    expect(out.plannedLoad).toBe(0)
  })
})

// ── Readiness and the hard-day rails ─────────────────────────────────────────

describe('allocateSession — readiness and hard days', () => {
  const hardRun = candidate({
    id: 'vo2',
    priority: 'A',
    modality: 'run',
    cost: { durationMin: 45, srpe: 9, load: 405, hardness: 9 },
  })

  test('red vetoes hard work outright (§7)', () => {
    const out = allocateSession(input({ band: 'red', budget: budget({ band: 'red' }), candidates: [hardRun] }))
    expect(out.decisions[0].outcome).toBe('rejected')
    expect(out.decisions[0].code).toBe('readiness_veto')
  })

  test('amber lets a moderate session through but not the hardest one', () => {
    const moderate = candidate({
      id: 'steady',
      priority: 'A',
      modality: 'run',
      cost: { durationMin: 40, srpe: 6, load: 240, hardness: 6 },
    })
    const out = allocateSession(
      input({ band: 'amber', budget: budget({ band: 'amber' }), candidates: [hardRun, moderate] }),
    )
    const byId = Object.fromEntries(out.decisions.map((d) => [d.itemId, d]))
    expect(byId['vo2'].outcome).toBe('rejected')
    expect(byId['steady'].outcome).toBe('selected')
  })

  test('never two hard days back-to-back (§10)', () => {
    const out = allocateSession(
      input({
        candidates: [hardRun],
        recentDays: [
          { date: new Date('2026-03-14T09:00:00'), load: 420, hard: true },
          { date: new Date('2026-03-13T09:00:00'), load: 200, hard: false },
        ],
      }),
    )
    expect(out.decisions[0].outcome).toBe('rejected')
    expect(out.decisions[0].code).toBe('back_to_back_hard')
  })

  test('an easy day after a hard one is fine', () => {
    const easy = candidate({
      id: 'easy',
      priority: 'A',
      modality: 'run',
      cost: { durationMin: 40, srpe: 4, load: 160, hardness: 4 },
    })
    const out = allocateSession(
      input({
        candidates: [easy],
        recentDays: [{ date: new Date('2026-03-14T09:00:00'), load: 420, hard: true }],
      }),
    )
    expect(out.decisions[0].outcome).toBe('selected')
    expect(out.hardDay).toBe(false)
  })

  test('the session is marked hard when a hard item lands', () => {
    const out = allocateSession(input({ candidates: [hardRun] }))
    expect(out.hardDay).toBe(true)
  })
})

// ── Niggles (§9) ─────────────────────────────────────────────────────────────

describe('allocateSession — niggles', () => {
  const calfWork = candidate({
    id: 'calf-raise',
    priority: 'B',
    modality: 'strength',
    constraints: { tissues: ['calf', 'achilles'] },
    cost: { durationMin: 10, srpe: 6, load: 60, hardness: 6 },
  })

  test('a mild niggle down-weights the tissue rather than banning it', () => {
    const out = allocateSession(input({ candidates: [calfWork], niggles: [ACHILLES] }))
    const d = out.decisions[0]
    expect(d.outcome).toBe('selected')
    expect(d.code).toBe('niggle_downweighted')
    expect(out.flags.some((f) => f.code === 'niggle_active')).toBe(true)
  })

  test('a painful niggle blocks loading that tissue', () => {
    const out = allocateSession(
      input({ candidates: [calfWork], niggles: [{ ...ACHILLES, severity: 7 }] }),
    )
    expect(out.decisions[0].outcome).toBe('rejected')
    expect(out.decisions[0].code).toBe('niggle_contraindicated')
  })

  test('a moderate niggle still blocks hard work on that tissue', () => {
    const hardCalf = { ...calfWork, cost: { durationMin: 20, srpe: 8, load: 160, hardness: 8 } }
    const out = allocateSession(
      input({ candidates: [hardCalf], niggles: [{ ...ACHILLES, severity: 5 }] }),
    )
    expect(out.decisions[0].outcome).toBe('rejected')
    expect(out.decisions[0].code).toBe('niggle_contraindicated')
  })

  test('a niggle running past two weeks stops prescribing into the area and escalates (§15)', () => {
    const out = allocateSession(
      input({ candidates: [calfWork], niggles: [{ ...ACHILLES, severity: 2, daysActive: 20 }] }),
    )
    expect(out.decisions[0].outcome).toBe('rejected')
    expect(out.decisions[0].code).toBe('niggle_escalated')
    expect(out.flags.some((f) => f.code === 'escalate_to_professional')).toBe(true)
    expect(out.flags.find((f) => f.code === 'escalate_to_professional')!.message).toMatch(/professional/i)
  })

  test('prehab that targets the niggle is promoted ahead of the rest (§9)', () => {
    const heelDrops = candidate({
      id: 'heel-drops',
      priority: 'C',
      placement: 'accessory',
      modality: 'prehab',
      constraints: { treats: ['achilles'] },
      cost: { durationMin: 8, srpe: 2, load: 16, hardness: 2 },
    })
    const filler = candidate({
      id: 'filler',
      priority: 'C',
      placement: 'accessory',
      modality: 'strength',
      cost: { durationMin: 40, srpe: 5, load: 200, hardness: 5 },
    })
    const out = allocateSession(
      input({ budget: budget({ ceiling: 100 }), candidates: [filler, heelDrops], niggles: [ACHILLES] }),
    )
    const byId = Object.fromEntries(out.decisions.map((d) => [d.itemId, d]))
    expect(byId['heel-drops'].outcome).toBe('selected')
    expect(byId['heel-drops'].code).toBe('niggle_targeted')
  })
})

// ── Concurrent training (§8) ─────────────────────────────────────────────────

describe('allocateSession — concurrent training', () => {
  const heavyLegs = candidate({
    id: 'back-squat',
    priority: 'B',
    modality: 'strength',
    constraints: { heavyLowerBody: true },
    cost: { durationMin: 30, srpe: 7, load: 210, hardness: 7 },
  })

  test('no heavy legs the day before a quality run', () => {
    const out = allocateSession(
      input({ candidates: [heavyLegs], tomorrow: { runType: 'long', priority: 'A' } }),
    )
    expect(out.decisions[0].outcome).toBe('rejected')
    expect(out.decisions[0].code).toBe('concurrent_next_day')
  })

  test('an easy run tomorrow is not a conflict', () => {
    const out = allocateSession(
      input({ candidates: [heavyLegs], tomorrow: { runType: 'easy', priority: 'C' } }),
    )
    expect(out.decisions[0].outcome).toBe('selected')
  })

  test('heavy legs are kept off the week A-run day entirely', () => {
    const aRun = candidate({
      id: 'threshold',
      priority: 'A',
      modality: 'run',
      cost: { durationMin: 45, srpe: 7, load: 315, hardness: 7 },
    })
    const out = allocateSession(
      input({
        budget: budget({ ceiling: 800 }),
        intent: { primaryModality: 'run', isQualityDay: true, plannedRunType: 'tempo', priority: 'A' },
        candidates: [heavyLegs, aRun],
      }),
    )
    const byId = Object.fromEntries(out.decisions.map((d) => [d.itemId, d]))
    expect(byId['threshold'].outcome).toBe('selected')
    expect(byId['back-squat'].outcome).toBe('rejected')
    expect(byId['back-squat'].code).toBe('concurrent_same_day')
  })

  test('sharing a day with a non-A quality run puts the run first and flags it', () => {
    const bRun = candidate({
      id: 'steady',
      priority: 'B',
      modality: 'run',
      cost: { durationMin: 40, srpe: 6, load: 240, hardness: 6 },
    })
    const out = allocateSession(
      input({
        budget: budget({ ceiling: 800 }),
        intent: { primaryModality: 'run', isQualityDay: true, plannedRunType: 'steady', priority: 'B' },
        candidates: [heavyLegs, bRun],
      }),
    )
    const main = out.blocks.find((b) => b.kind === 'main')!
    expect(main.items.map((i) => i.id)).toEqual(['steady', 'back-squat'])
    expect(out.flags.some((f) => f.code === 'run_before_lift')).toBe(true)
  })

  test('plyos are kept off the day before a long run (§9)', () => {
    const plyos = candidate({
      id: 'bounds',
      priority: 'B',
      modality: 'plyo',
      placement: 'warmup',
      constraints: { notBeforeLongRun: true },
      cost: { durationMin: 12, srpe: 6, load: 90, hardness: 6, contacts: 100 },
    })
    const out = allocateSession(
      input({ candidates: [plyos], tomorrow: { runType: 'long', priority: 'A' } }),
    )
    expect(out.decisions[0].code).toBe('not_before_long_run')
  })

  test('static stretching stays out of a pre-quality warmup (§9)', () => {
    const staticStretch = candidate({
      id: 'hamstring-hold',
      priority: 'C',
      placement: 'warmup',
      modality: 'stretch',
      constraints: { excludeFromWarmupBeforeQuality: true },
      cost: { durationMin: 5, srpe: 1, load: 5, hardness: 1 },
    })
    const quality = input({
      intent: { primaryModality: 'run', isQualityDay: true, plannedRunType: 'vo2', priority: 'A' },
      candidates: [staticStretch],
    })
    expect(allocateSession(quality).decisions[0].code).toBe('static_stretch_pre_quality')

    const cooldown = { ...staticStretch, placement: 'cooldown' as const }
    const out = allocateSession({ ...quality, candidates: [cooldown] })
    expect(out.decisions[0].outcome).toBe('selected')
  })
})

// ── Calibration (§5b) ────────────────────────────────────────────────────────

describe('allocateSession — calibration ramp caps', () => {
  test('work that needs a confirmed anchor waits until the anchor is confirmed', () => {
    const vo2 = candidate({
      id: 'vo2',
      priority: 'A',
      modality: 'run',
      constraints: { minAnchorConfidence: 'confirmed' },
      cost: { durationMin: 40, srpe: 9, load: 360, hardness: 9 },
    })
    const out = allocateSession(
      input({ calibrating: true, anchorConfidence: 'estimate', candidates: [vo2] }),
    )
    expect(out.decisions[0].outcome).toBe('rejected')
    expect(out.decisions[0].code).toBe('calibration_unproven')
  })

  test('the same work goes ahead once the anchor is confirmed', () => {
    const vo2 = candidate({
      id: 'vo2',
      priority: 'A',
      modality: 'run',
      constraints: { minAnchorConfidence: 'confirmed' },
      cost: { durationMin: 40, srpe: 9, load: 360, hardness: 9 },
    })
    const out = allocateSession(input({ anchorConfidence: 'confirmed', candidates: [vo2] }))
    expect(out.decisions[0].outcome).toBe('selected')
  })

  test('anything needing freshness waits for a green day', () => {
    const depthJumps = candidate({
      id: 'depth-jumps',
      priority: 'B',
      modality: 'plyo',
      constraints: { requiresFresh: true },
      cost: { durationMin: 12, srpe: 7, load: 100, hardness: 7, contacts: 80 },
    })
    expect(allocateSession(input({ band: 'amber', candidates: [depthJumps] })).decisions[0].code)
      .toBe('requires_freshness')
    expect(allocateSession(input({ band: 'green', candidates: [depthJumps] })).decisions[0].outcome)
      .toBe('selected')
  })

  test('calibration is flagged so the coach can say it out loud (§5b)', () => {
    const out = allocateSession(input({ calibrating: true, candidates: [candidate({ id: 'x' })] }))
    expect(out.flags.some((f) => f.code === 'calibrating')).toBe(true)
  })
})

// ── Preferences (§13) ────────────────────────────────────────────────────────

describe('allocateSession — preferences', () => {
  const noWeekendLifting: PreferenceRule = {
    id: 'p1',
    label: 'No weights at the weekend',
    source: 'explicit',
    confidence: 1,
    effect: 'exclude',
    match: { modality: 'strength' },
  }

  test('an explicit rule is a hard constraint', () => {
    const out = allocateSession(
      input({ candidates: [candidate({ id: 'squat', modality: 'strength' })], preferences: [noWeekendLifting] }),
    )
    expect(out.decisions[0].outcome).toBe('rejected')
    expect(out.decisions[0].code).toBe('preference_excluded')
    expect(out.decisions[0].reason).toContain('No weights at the weekend')
  })

  test('an inferred pattern only lowers the priority — it never bans anything (§13)', () => {
    const inferred: PreferenceRule = { ...noWeekendLifting, source: 'inferred', confidence: 0.6, effect: 'deprioritize' }
    const out = allocateSession(
      input({
        budget: budget({ ceiling: 250 }),
        candidates: [
          candidate({ id: 'squat', modality: 'strength', priority: 'B', cost: { durationMin: 40, srpe: 5, load: 200, hardness: 5 } }),
          candidate({ id: 'run', modality: 'run', priority: 'B', cost: { durationMin: 40, srpe: 5, load: 200, hardness: 5 } }),
        ],
        preferences: [inferred],
      }),
    )
    const byId = Object.fromEntries(out.decisions.map((d) => [d.itemId, d]))
    expect(byId['run'].outcome).toBe('selected')
    expect(byId['squat'].outcome).toBe('rejected')
    expect(byId['squat'].code).toBe('budget_exhausted')
  })
})

// ── Pushing up, not only down (§21) ──────────────────────────────────────────

describe('allocateSession — the floor', () => {
  test('flags a green day that lands under the floor', () => {
    const out = allocateSession(
      input({
        budget: budget({ floor: 300, ceiling: 600 }),
        candidates: [candidate({ id: 'tiny', cost: { durationMin: 10, srpe: 3, load: 30, hardness: 3 } })],
      }),
    )
    expect(out.flags.some((f) => f.code === 'under_floor')).toBe(true)
  })

  test('does not nag when the day clears the floor', () => {
    const out = allocateSession(
      input({
        budget: budget({ floor: 100, ceiling: 600 }),
        candidates: [candidate({ id: 'real', cost: { durationMin: 40, srpe: 5, load: 200, hardness: 5 } })],
      }),
    )
    expect(out.flags.some((f) => f.code === 'under_floor')).toBe(false)
  })

  test('never nags on a red day — rest is the prescription', () => {
    const out = allocateSession(
      input({
        band: 'red',
        budget: budget({ floor: 300, ceiling: 100, band: 'red' }),
        candidates: [],
      }),
    )
    expect(out.flags.some((f) => f.code === 'under_floor')).toBe(false)
  })
})
