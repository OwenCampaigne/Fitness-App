import { subDays } from 'date-fns'
import {
  COLD_START_CONTACTS,
  COLD_START_WEEKLY_CEILING,
  CONTACT_ACWR_CEILING,
  TIER_SESSION_CONTACTS,
  contactBudget,
  decidePlyoPlacement,
  derivePlyoTierAnchor,
  isPlyoUnlocked,
  prescribePlyos,
  unlockedPlyos,
} from '../plyoEngine'
import { CONTACTS_PER_SET, PLYOS, getPlyo } from '../plyos'
import { listMovementScenarios, movementScenarios } from '../movementScenario'
import { isContactParams } from '../../types/session'
import type {
  ContactBudget,
  PlyoPlacementDecision,
  PlyoSessionHistory,
  PlyoTier,
  PlyoUnlockContext,
} from '../../types/movement'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TODAY = new Date('2026-03-15T08:00:00Z')

function plyoSession(
  daysAgo: number,
  plyoId: string,
  tier: PlyoTier,
  cleanExecution: boolean | null = true,
  sorenessNextDay: number | null = 2,
): PlyoSessionHistory {
  return {
    date: subDays(TODAY, daysAgo),
    plyoId,
    tier,
    contacts: 60,
    cleanExecution,
    sorenessNextDay,
  }
}

const ALL_PLYO_IDS = PLYOS.map((p) => p.id)

function unlockCtx(over: Partial<PlyoUnlockContext> = {}): PlyoUnlockContext {
  return {
    tierAnchor: 1,
    masteredIds: [],
    impactCleared: true,
    blockedRegions: [],
    ...over,
  }
}

function budget(over: Partial<ContactBudget> = {}): ContactBudget {
  return {
    contacts: 80,
    maxTier: 1,
    weeklyCeiling: 300,
    acwr: 1,
    rampCapped: false,
    reason: 'test',
    ...over,
  }
}

function placement(over: Partial<PlyoPlacementDecision> = {}): PlyoPlacementDecision {
  return {
    allowed: true,
    placement: 'standalone',
    block: 'main',
    reason: 'test',
    ...over,
  }
}

// ── Catalog ──────────────────────────────────────────────────────────────────

describe('plyo catalog', () => {
  test('every prerequisite names a plyo that exists', () => {
    for (const plyo of PLYOS) {
      for (const prereq of plyo.prerequisites) {
        expect(getPlyo(prereq)).not.toBeNull()
      }
    }
  })
  test('a prerequisite never sits above the drill that requires it', () => {
    for (const plyo of PLYOS) {
      for (const prereq of plyo.prerequisites) {
        expect(getPlyo(prereq)!.progressionTier).toBeLessThanOrEqual(plyo.progressionTier)
      }
    }
  })
})

// ── Tier anchor ──────────────────────────────────────────────────────────────

describe('derivePlyoTierAnchor', () => {
  test('with no history the anchor is an honest estimate at the foundational tier', () => {
    const anchor = derivePlyoTierAnchor([], TODAY)
    expect(anchor.value).toBe(1)
    expect(anchor.source).toBe('estimate')
    expect(anchor.sessions).toBe(0)
    expect(anchor.confidence).toBeLessThan(0.3)
  })

  test('three clean sessions at a tier confirm it', () => {
    const anchor = derivePlyoTierAnchor(
      [
        plyoSession(20, 'bounding', 2),
        plyoSession(13, 'box-jumps', 2),
        plyoSession(6, 'bounding', 2),
      ],
      TODAY,
    )
    expect(anchor.value).toBe(2)
    expect(anchor.source).toBe('confirmed')
    expect(anchor.sessions).toBe(3)
  })

  test('a single clean session is observed, not confirmed', () => {
    const anchor = derivePlyoTierAnchor([plyoSession(6, 'bounding', 2)], TODAY)
    expect(anchor.value).toBe(2)
    expect(anchor.source).toBe('observed')
  })

  test('two sessions that did not hold cap that tier out', () => {
    const anchor = derivePlyoTierAnchor(
      [
        plyoSession(20, 'depth-jumps', 3, false),
        plyoSession(16, 'depth-jumps', 3, false),
        plyoSession(12, 'bounding', 2),
        plyoSession(8, 'box-jumps', 2),
        plyoSession(4, 'bounding', 2),
      ],
      TODAY,
    )
    expect(anchor.value).toBe(2)
    expect(anchor.source).toBe('confirmed')
  })

  test('high next-day soreness counts against the tier the same way a failed rep does', () => {
    const anchor = derivePlyoTierAnchor(
      [
        plyoSession(20, 'depth-jumps', 3, true, 8),
        plyoSession(16, 'depth-jumps', 3, true, 9),
        plyoSession(12, 'bounding', 2),
      ],
      TODAY,
    )
    expect(anchor.value).toBe(2)
    expect(anchor.source).toBe('observed')
  })

  test('work older than the window does not hold the anchor up', () => {
    const anchor = derivePlyoTierAnchor(
      [
        plyoSession(80, 'bounding', 2),
        plyoSession(75, 'bounding', 2),
        plyoSession(70, 'bounding', 2),
      ],
      TODAY,
    )
    expect(anchor.value).toBe(1)
    expect(anchor.source).toBe('estimate')
  })

  test('logged but never-clean work still does not move the tier', () => {
    const anchor = derivePlyoTierAnchor(
      [plyoSession(10, 'pogo-jumps', 1, null), plyoSession(5, 'pogo-jumps', 1, null)],
      TODAY,
    )
    expect(anchor.value).toBe(1)
    expect(anchor.source).toBe('estimate')
  })
})

// ── Prerequisite / tier / clearance gating ───────────────────────────────────

describe('isPlyoUnlocked', () => {
  test('a foundational drill with no prerequisites is open from day one', () => {
    const r = isPlyoUnlocked(getPlyo('pogo-jumps')!, unlockCtx())
    expect(r.unlocked).toBe(true)
    expect(r.blockedBy).toBeNull()
  })

  test('missing prerequisites block the drill and name what is missing', () => {
    const r = isPlyoUnlocked(getPlyo('bounding')!, unlockCtx({ masteredIds: ['pogo-jumps'] }))
    expect(r.unlocked).toBe(false)
    expect(r.blockedBy).toBe('prerequisites')
    expect(r.missingPrerequisites).toEqual(['a-skips'])
  })

  test('with every prerequisite owned the next tier up is reachable', () => {
    const r = isPlyoUnlocked(
      getPlyo('bounding')!,
      unlockCtx({ masteredIds: ['pogo-jumps', 'a-skips'] }),
    )
    expect(r.unlocked).toBe(true)
  })

  test('the anchor ceiling stops a two-tier jump even with prerequisites owned', () => {
    const r = isPlyoUnlocked(
      getPlyo('depth-jumps')!,
      unlockCtx({ tierAnchor: 1, masteredIds: ALL_PLYO_IDS }),
    )
    expect(r.unlocked).toBe(false)
    expect(r.blockedBy).toBe('tier')
  })

  test('high-impact drills stay hidden until impact clearance is entered', () => {
    const r = isPlyoUnlocked(
      getPlyo('depth-jumps')!,
      unlockCtx({ tierAnchor: 3, masteredIds: ALL_PLYO_IDS, impactCleared: false }),
    )
    expect(r.unlocked).toBe(false)
    expect(r.blockedBy).toBe('impact')
    expect(r.reason).toMatch(/clearance/i)
  })

  test('clearance outranks every other gate', () => {
    // Nothing else would have passed either — impact is still the reason given,
    // because it is the one the athlete cannot work around by training.
    const r = isPlyoUnlocked(
      getPlyo('hurdle-series')!,
      unlockCtx({ tierAnchor: 1, masteredIds: [], impactCleared: false }),
    )
    expect(r.blockedBy).toBe('impact')
  })

  test('an escalated niggle closes the drills that load that region', () => {
    const r = isPlyoUnlocked(
      getPlyo('pogo-jumps')!,
      unlockCtx({ blockedRegions: ['ankle_foot'] }),
    )
    expect(r.unlocked).toBe(false)
    expect(r.blockedBy).toBe('niggle')
  })

  test('unlockedPlyos returns only foundational work for an untrained athlete', () => {
    const list = unlockedPlyos(unlockCtx())
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((p) => p.progressionTier === 1)).toBe(true)
  })

  test('unlockedPlyos opens tier 2 once the foundations are owned', () => {
    const list = unlockedPlyos(
      unlockCtx({ tierAnchor: 1, masteredIds: ['pogo-jumps', 'a-skips', 'bounding'] }),
    )
    expect(list.map((p) => p.id)).toContain('bounding')
    expect(list.map((p) => p.id)).not.toContain('depth-jumps')
  })
})

// ── Contact budget ───────────────────────────────────────────────────────────

describe('contactBudget', () => {
  test('a cold start gets a small foundational dose, whatever the anchor says', () => {
    const b = contactBudget({ tierAnchor: 3, weeklyContacts: [], band: 'green' })
    expect(b.contacts).toBe(COLD_START_CONTACTS)
    expect(b.maxTier).toBe(1)
    expect(b.weeklyCeiling).toBe(COLD_START_WEEKLY_CEILING)
    expect(b.acwr).toBeNull()
  })

  test('an established athlete gets the full session dose for their tier', () => {
    const b = contactBudget({
      tierAnchor: 2,
      weeklyContacts: [200, 220, 240, 260],
      band: 'green',
    })
    expect(b.contacts).toBe(TIER_SESSION_CONTACTS[2])
    expect(b.maxTier).toBe(2)
    expect(b.rampCapped).toBe(false)
  })

  test('the weekly ceiling is a 10% ramp on the chronic load', () => {
    const b = contactBudget({ tierAnchor: 2, weeklyContacts: [100, 100, 100, 100], band: 'green' })
    expect(b.weeklyCeiling).toBe(110)
  })

  test('calibration tightens the ramp to 5%', () => {
    const b = contactBudget({
      tierAnchor: 2,
      weeklyContacts: [100, 100, 100, 100],
      band: 'green',
      provisional: true,
    })
    expect(b.weeklyCeiling).toBe(105)
  })

  test('contacts already banked this week come off the session dose', () => {
    const b = contactBudget({
      tierAnchor: 2,
      weeklyContacts: [100, 100, 100, 100],
      contactsThisWeek: 90,
      band: 'green',
    })
    expect(b.contacts).toBe(20)
    expect(b.rampCapped).toBe(true)
  })

  test('an acute spike over the ACWR ceiling stops plyos outright', () => {
    const b = contactBudget({ tierAnchor: 2, weeklyContacts: [100, 100, 100, 200], band: 'green' })
    expect(b.acwr).toBeGreaterThan(CONTACT_ACWR_CEILING)
    expect(b.contacts).toBe(0)
    expect(b.maxTier).toBe(0)
    expect(b.reason).toMatch(/1\.3/)
  })

  test('amber halves the dose and caps the tier at foundational', () => {
    const b = contactBudget({
      tierAnchor: 3,
      weeklyContacts: [200, 220, 240, 260],
      band: 'amber',
    })
    expect(b.contacts).toBe(TIER_SESSION_CONTACTS[3] / 2)
    expect(b.maxTier).toBe(1)
  })

  test('red days have no ground-contact budget at all', () => {
    const b = contactBudget({
      tierAnchor: 2,
      weeklyContacts: [200, 220, 240, 260],
      band: 'red',
    })
    expect(b.contacts).toBe(0)
    expect(b.maxTier).toBe(0)
  })

  test('flagged pain removes the budget regardless of readiness', () => {
    const b = contactBudget({
      tierAnchor: 2,
      weeklyContacts: [200, 220, 240, 260],
      band: 'green',
      painFlagged: true,
    })
    expect(b.contacts).toBe(0)
  })

  test('a niggle that blocks impact removes the budget too', () => {
    const b = contactBudget({
      tierAnchor: 2,
      weeklyContacts: [200, 220, 240, 260],
      band: 'green',
      blockImpact: true,
    })
    expect(b.contacts).toBe(0)
    expect(b.reason).toMatch(/niggle/i)
  })

  test('a week of zeros reads as a cold start, not as a chronic load of zero', () => {
    const b = contactBudget({ tierAnchor: 1, weeklyContacts: [0, 0, 0, 0], band: 'green' })
    expect(b.contacts).toBe(COLD_START_CONTACTS)
    expect(b.acwr).toBeNull()
  })
})

// ── Placement ────────────────────────────────────────────────────────────────

describe('decidePlyoPlacement', () => {
  test('a quality day makes plyos a primer in the warmup', () => {
    const d = decidePlyoPlacement({
      band: 'green',
      todayRunType: 'strides',
      tomorrowRunType: 'easy',
      isRecoveryDay: false,
    })
    expect(d.allowed).toBe(true)
    expect(d.placement).toBe('primer')
    expect(d.block).toBe('warmup')
  })

  test('VO2 day is a primer day too', () => {
    const d = decidePlyoPlacement({
      band: 'green',
      todayRunType: 'vo2',
      tomorrowRunType: 'easy',
      isRecoveryDay: false,
    })
    expect(d.placement).toBe('primer')
  })

  test('never the day before a long run', () => {
    const d = decidePlyoPlacement({
      band: 'green',
      todayRunType: 'easy',
      tomorrowRunType: 'long',
      isRecoveryDay: false,
    })
    expect(d.allowed).toBe(false)
    expect(d.placement).toBe('none')
    expect(d.reason).toMatch(/long run/i)
  })

  test('the long-run rule beats an otherwise perfect quality day', () => {
    const d = decidePlyoPlacement({
      band: 'green',
      todayRunType: 'strides',
      tomorrowRunType: 'long',
      isRecoveryDay: false,
    })
    expect(d.allowed).toBe(false)
  })

  test('never on a recovery day', () => {
    const d = decidePlyoPlacement({
      band: 'green',
      todayRunType: 'recovery',
      tomorrowRunType: 'easy',
      isRecoveryDay: false,
    })
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/recovery/i)
  })

  test('an explicit recovery day blocks plyos even with no run scheduled', () => {
    const d = decidePlyoPlacement({
      band: 'green',
      todayRunType: null,
      tomorrowRunType: 'easy',
      isRecoveryDay: true,
    })
    expect(d.allowed).toBe(false)
  })

  test('not on long-run day either — the long run needs the fresh legs', () => {
    const d = decidePlyoPlacement({
      band: 'green',
      todayRunType: 'long',
      tomorrowRunType: 'easy',
      isRecoveryDay: false,
    })
    expect(d.allowed).toBe(false)
  })

  test('red days are out', () => {
    const d = decidePlyoPlacement({
      band: 'red',
      todayRunType: 'easy',
      tomorrowRunType: 'easy',
      isRecoveryDay: false,
    })
    expect(d.allowed).toBe(false)
  })

  test('amber still allows foundational work — the budget is what trims it', () => {
    const d = decidePlyoPlacement({
      band: 'amber',
      todayRunType: 'easy',
      tomorrowRunType: 'easy',
      isRecoveryDay: false,
    })
    expect(d.allowed).toBe(true)
    expect(d.placement).toBe('standalone')
  })

  test('flagged pain outranks everything', () => {
    const d = decidePlyoPlacement({
      band: 'green',
      todayRunType: 'strides',
      tomorrowRunType: 'easy',
      isRecoveryDay: false,
      painFlagged: true,
    })
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/pain/i)
  })

  test('an easy day on green is a standalone session in the main block', () => {
    const d = decidePlyoPlacement({
      band: 'green',
      todayRunType: 'easy',
      tomorrowRunType: 'easy',
      isRecoveryDay: false,
    })
    expect(d.placement).toBe('standalone')
    expect(d.block).toBe('main')
  })
})

// ── Prescription ─────────────────────────────────────────────────────────────

describe('prescribePlyos', () => {
  const tier1 = PLYOS.filter((p) => p.progressionTier === 1)

  test('spends the budget without ever exceeding it', () => {
    const p = prescribePlyos({
      budget: budget({ contacts: 80, maxTier: 1 }),
      placement: placement(),
      unlocked: tier1,
    })
    expect(p.totalContacts).toBe(80)
    expect(p.items.length).toBeGreaterThan(0)
  })

  test('every item is a ContactParams SessionItem', () => {
    const p = prescribePlyos({
      budget: budget({ contacts: 80, maxTier: 1 }),
      placement: placement(),
      unlocked: tier1,
    })
    for (const item of p.items) {
      expect(item.ref.kind).toBe('plyo')
      expect(item.status).toBe('prescribed')
      expect(isContactParams(item.params)).toBe(true)
      if (isContactParams(item.params)) {
        expect(item.params.sets).toBeGreaterThan(0)
        expect(item.params.contactsPerSet).toBeGreaterThan(0)
      }
    }
  })

  test('contacts per set follow the tier, not the drill', () => {
    const p = prescribePlyos({
      budget: budget({ contacts: 80, maxTier: 1 }),
      placement: placement(),
      unlocked: tier1,
    })
    for (const item of p.items) {
      if (!isContactParams(item.params)) continue
      const plyo = getPlyo(item.ref.id)!
      expect(item.params.contactsPerSet).toBe(CONTACTS_PER_SET[plyo.progressionTier])
    }
  })

  test('drills above the budget tier ceiling are never selected', () => {
    const p = prescribePlyos({
      budget: budget({ contacts: 80, maxTier: 1 }),
      placement: placement(),
      unlocked: PLYOS,
    })
    for (const item of p.items) {
      expect(getPlyo(item.ref.id)!.progressionTier).toBe(1)
    }
  })

  test('a zero budget produces nothing and says why', () => {
    const p = prescribePlyos({
      budget: budget({ contacts: 0, maxTier: 0, reason: 'Red day — no contacts today.' }),
      placement: placement(),
      unlocked: tier1,
    })
    expect(p.items).toHaveLength(0)
    expect(p.totalContacts).toBe(0)
    expect(p.why).toMatch(/Red day/)
  })

  test('a placement veto produces nothing and repeats the placement reason', () => {
    const p = prescribePlyos({
      budget: budget({ contacts: 80, maxTier: 1 }),
      placement: placement({
        allowed: false,
        placement: 'none',
        reason: 'Long run tomorrow — no plyos today.',
      }),
      unlocked: tier1,
    })
    expect(p.items).toHaveLength(0)
    expect(p.why).toMatch(/Long run tomorrow/)
  })

  test('a primer is a shorter menu than a standalone session', () => {
    const primer = prescribePlyos({
      budget: budget({ contacts: 80, maxTier: 1 }),
      placement: placement({ placement: 'primer', block: 'warmup' }),
      unlocked: tier1,
    })
    const standalone = prescribePlyos({
      budget: budget({ contacts: 80, maxTier: 1 }),
      placement: placement(),
      unlocked: tier1,
    })
    expect(primer.items.length).toBeLessThanOrEqual(standalone.items.length)
    expect(primer.block).toBe('warmup')
  })

  test('rest between sets grows with the tier', () => {
    const t1 = prescribePlyos({
      budget: budget({ contacts: 80, maxTier: 1 }),
      placement: placement(),
      unlocked: tier1,
    })
    const t3 = prescribePlyos({
      budget: budget({ contacts: 40, maxTier: 3 }),
      placement: placement(),
      unlocked: PLYOS.filter((p) => p.progressionTier === 3),
    })
    const rest = (items: typeof t1.items) =>
      items.map((i) => (isContactParams(i.params) ? (i.params.restSec ?? 0) : 0))
    expect(Math.max(...rest(t3.items))).toBeGreaterThan(Math.max(...rest(t1.items)))
  })

  test('an empty unlocked list is handled rather than crashing', () => {
    const p = prescribePlyos({
      budget: budget({ contacts: 80, maxTier: 1 }),
      placement: placement(),
      unlocked: [],
    })
    expect(p.items).toHaveLength(0)
    expect(p.flag).not.toBeNull()
  })

  test('item ids are deterministic so a re-render is not a new session', () => {
    const args = {
      budget: budget({ contacts: 80, maxTier: 1 }),
      placement: placement(),
      unlocked: tier1,
    }
    expect(prescribePlyos(args).items.map((i) => i.id)).toEqual(
      prescribePlyos(args).items.map((i) => i.id),
    )
  })
})

// ── Scenario mode (§16) ──────────────────────────────────────────────────────

describe('MOVEMENT_SCENARIO presets drive the plyo engine', () => {
  const scenarios = movementScenarios()

  test('every preset is listed', () => {
    expect(listMovementScenarios().sort()).toEqual(Object.keys(scenarios).sort())
  })

  test('plyo_untrained: nothing anchored, a cold-start dose, foundations only', () => {
    const s = scenarios.plyo_untrained
    const anchor = derivePlyoTierAnchor(s.plyoHistory)
    expect(anchor.source).toBe('estimate')
    expect(anchor.value).toBe(1)

    const b = contactBudget({
      tierAnchor: anchor.value,
      weeklyContacts: s.weeklyContacts,
      band: 'green',
    })
    expect(b.contacts).toBe(COLD_START_CONTACTS)

    const open = unlockedPlyos({
      tierAnchor: anchor.value,
      masteredIds: s.masteredPlyoIds,
      impactCleared: s.impactCleared,
    })
    expect(open.every((p) => p.progressionTier === 1)).toBe(true)
  })

  test('plyo_progressing: foundations confirmed and tier 2 now reachable', () => {
    const s = scenarios.plyo_progressing
    const anchor = derivePlyoTierAnchor(s.plyoHistory)
    expect(anchor.source).toBe('confirmed')
    expect(anchor.value).toBe(1)

    const open = unlockedPlyos({
      tierAnchor: anchor.value,
      masteredIds: s.masteredPlyoIds,
      impactCleared: s.impactCleared,
    })
    expect(open.map((p) => p.id)).toContain('bounding')
    expect(open.map((p) => p.id)).not.toContain('depth-jumps')
  })

  test('movement_clear: tier 2 confirmed and a full session budget', () => {
    const s = scenarios.movement_clear
    const anchor = derivePlyoTierAnchor(s.plyoHistory)
    expect(anchor.value).toBe(2)
    expect(anchor.source).toBe('confirmed')

    const b = contactBudget({
      tierAnchor: anchor.value,
      weeklyContacts: s.weeklyContacts,
      contactsThisWeek: s.contactsThisWeek,
      band: 'green',
    })
    expect(b.contacts).toBe(TIER_SESSION_CONTACTS[2])
  })

  test('plyo_overreached: the tier falls back and the spike stops the session', () => {
    const s = scenarios.plyo_overreached
    const anchor = derivePlyoTierAnchor(s.plyoHistory)
    expect(anchor.value).toBe(2)

    const b = contactBudget({
      tierAnchor: anchor.value,
      weeklyContacts: s.weeklyContacts,
      band: 'green',
    })
    expect(b.acwr).toBeGreaterThan(CONTACT_ACWR_CEILING)
    expect(b.contacts).toBe(0)
  })
})
