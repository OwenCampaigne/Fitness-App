import {
  STATIC_PRE_HOLD_CAP_SEC,
  cooldownStretches,
  filterWarmupStretches,
  prescribeStretches,
  staticPreVerdict,
  stretchItem,
  warmupStretches,
} from '../stretchEngine'
import { STRETCHES, getStretch, stretchesByType } from '../stretches'
import { isHoldParams } from '../../types/session'
import type { StretchContext } from '../../types/movement'

// ── Fixtures ─────────────────────────────────────────────────────────────────

function ctx(over: Partial<StretchContext> = {}): StretchContext {
  return {
    band: 'green',
    isQualityDay: false,
    isRecoveryDay: false,
    painFlagged: false,
    blockedRegions: [],
    ...over,
  }
}

// ── Catalog ──────────────────────────────────────────────────────────────────

describe('stretch catalog', () => {
  test('every dynamic entry is authored for the warmup', () => {
    for (const s of stretchesByType('dynamic')) {
      expect(s.whenToUse).toBe('pre')
    }
  })
  test('no static entry is authored for the warmup', () => {
    for (const s of stretchesByType('static')) {
      expect(s.whenToUse).not.toBe('pre')
    }
  })
  test('every entry carries either reps or a duration', () => {
    for (const s of STRETCHES) {
      expect((s.reps ?? 0) > 0 || (s.durationSec ?? 0) > 0).toBe(true)
    }
  })
})

// ── The static-before-quality rule (§9) ──────────────────────────────────────

describe('staticPreVerdict', () => {
  test('static holds are out of a pre-quality warmup entirely', () => {
    const v = staticPreVerdict(true)
    expect(v.allowed).toBe(false)
    expect(v.maxHoldSec).toBe(0)
    expect(v.reason).toMatch(/power|force|output/i)
  })

  test('on an ordinary day a short hold is tolerated', () => {
    const v = staticPreVerdict(false)
    expect(v.allowed).toBe(true)
    expect(v.maxHoldSec).toBe(STATIC_PRE_HOLD_CAP_SEC)
  })

  test('even the tolerated hold is short — the effect is dose-dependent', () => {
    expect(STATIC_PRE_HOLD_CAP_SEC).toBeLessThanOrEqual(20)
  })
})

describe('filterWarmupStretches', () => {
  const mixed = [
    getStretch('leg-swings-forward')!,
    getStretch('standing-quad-stretch')!,
    getStretch('hip-circles')!,
  ]

  test('strips static work out of a pre-quality warmup and says why', () => {
    const { kept, removed } = filterWarmupStretches(mixed, true)
    expect(kept.map((s) => s.id)).toEqual(['leg-swings-forward', 'hip-circles'])
    expect(removed).toHaveLength(1)
    expect(removed[0].stretch.id).toBe('standing-quad-stretch')
    expect(removed[0].reason).toMatch(/quality/i)
  })

  test('leaves static work alone on an ordinary day', () => {
    const { kept, removed } = filterWarmupStretches(mixed, false)
    expect(kept).toHaveLength(3)
    expect(removed).toHaveLength(0)
  })

  test('dynamic work is never removed', () => {
    const { removed } = filterWarmupStretches(stretchesByType('dynamic'), true)
    expect(removed).toHaveLength(0)
  })
})

// ── Selection ────────────────────────────────────────────────────────────────

describe('warmupStretches', () => {
  test('is dynamic, always', () => {
    for (const quality of [true, false]) {
      const picked = warmupStretches(ctx({ isQualityDay: quality }))
      expect(picked.length).toBeGreaterThan(0)
      expect(picked.every((s) => s.type === 'dynamic')).toBe(true)
    }
  })

  test('skips anything that pulls through a closed-off region', () => {
    const picked = warmupStretches(ctx({ blockedRegions: ['ankle_foot'] }), 20)
    expect(picked.map((s) => s.id)).not.toContain('ankle-circles')
    expect(picked.map((s) => s.id)).not.toContain('lateral-shuffles')
  })

  test('is shorter when pain is flagged', () => {
    const normal = warmupStretches(ctx())
    const painful = warmupStretches(ctx({ painFlagged: true }))
    expect(painful.length).toBeLessThan(normal.length)
  })
})

describe('cooldownStretches', () => {
  test('is static, always', () => {
    const picked = cooldownStretches(ctx())
    expect(picked.length).toBeGreaterThan(0)
    expect(picked.every((s) => s.type === 'static')).toBe(true)
  })

  test('an ordinary day gets the post-run set', () => {
    const picked = cooldownStretches(ctx())
    expect(picked.every((s) => s.whenToUse === 'post')).toBe(true)
  })

  test('a recovery day leads with the recovery mobility set', () => {
    const picked = cooldownStretches(ctx({ isRecoveryDay: true }))
    expect(picked[0].whenToUse).toBe('recovery')
    expect(picked.map((s) => s.id)).toContain('lying-knee-to-chest')
  })

  test('a red day is treated as a recovery day', () => {
    const picked = cooldownStretches(ctx({ band: 'red' }))
    expect(picked[0].whenToUse).toBe('recovery')
  })

  test('skips anything that pulls through a closed-off region', () => {
    const picked = cooldownStretches(ctx({ blockedRegions: ['ankle_foot'] }), 20)
    expect(picked.map((s) => s.id)).not.toContain('standing-calf-stretch')
  })
})

// ── Items ────────────────────────────────────────────────────────────────────

describe('stretchItem', () => {
  test('a dynamic stretch is dosed in reps', () => {
    const item = stretchItem(getStretch('leg-swings-forward')!, 'warmup')
    expect(item.ref.kind).toBe('stretch')
    expect(isHoldParams(item.params)).toBe(true)
    if (isHoldParams(item.params)) {
      expect(item.params.reps).toBeGreaterThan(0)
      expect(item.params.holdSec).toBeNull()
    }
  })

  test('a static stretch is dosed in a hold', () => {
    const item = stretchItem(getStretch('pigeon-pose')!, 'cooldown')
    if (isHoldParams(item.params)) {
      expect(item.params.holdSec).toBe(60)
      expect(item.params.reps).toBeNull()
    }
  })

  test('a hold cap actually shortens the hold', () => {
    const item = stretchItem(getStretch('pigeon-pose')!, 'warmup', STATIC_PRE_HOLD_CAP_SEC)
    if (isHoldParams(item.params)) {
      expect(item.params.holdSec).toBe(STATIC_PRE_HOLD_CAP_SEC)
    }
  })

  test('the block is part of the id, so one stretch can appear in both', () => {
    expect(stretchItem(getStretch('pigeon-pose')!, 'warmup').id).not.toBe(
      stretchItem(getStretch('pigeon-pose')!, 'cooldown').id,
    )
  })
})

// ── Prescription ─────────────────────────────────────────────────────────────

describe('prescribeStretches', () => {
  test('a quality day gets a dynamic warmup and a static cooldown, in that order', () => {
    const p = prescribeStretches(ctx({ isQualityDay: true }))
    expect(p.warmup.length).toBeGreaterThan(0)
    expect(p.cooldown.length).toBeGreaterThan(0)
    for (const item of p.warmup) expect(getStretch(item.ref.id)!.type).toBe('dynamic')
    for (const item of p.cooldown) expect(getStretch(item.ref.id)!.type).toBe('static')
    expect(p.staticInWarmup).toBe(false)
  })

  test('every item slots into the Session object as a HoldParams item', () => {
    const p = prescribeStretches(ctx())
    for (const item of [...p.warmup, ...p.cooldown]) {
      expect(item.ref.kind).toBe('stretch')
      expect(item.status).toBe('prescribed')
      expect(isHoldParams(item.params)).toBe(true)
    }
  })

  test('a static stretch dropped into a pre-quality warmup is refused and flagged', () => {
    const p = prescribeStretches(ctx({ isQualityDay: true }), {
      extraWarmupIds: ['standing-quad-stretch'],
    })
    expect(p.warmup.map((i) => i.ref.id)).not.toContain('standing-quad-stretch')
    expect(p.staticInWarmup).toBe(false)
    expect(p.flag).toMatch(/quality/i)
  })

  test('the same stretch on an ordinary day is allowed, but capped short', () => {
    const p = prescribeStretches(ctx({ isQualityDay: false }), {
      extraWarmupIds: ['standing-quad-stretch'],
    })
    const item = p.warmup.find((i) => i.ref.id === 'standing-quad-stretch')
    expect(item).toBeDefined()
    expect(p.staticInWarmup).toBe(true)
    if (item && isHoldParams(item.params)) {
      expect(item.params.holdSec).toBe(STATIC_PRE_HOLD_CAP_SEC)
    }
  })

  test('a recovery day turns the cooldown into a mobility block', () => {
    const p = prescribeStretches(ctx({ isRecoveryDay: true }))
    expect(p.cooldown.map((i) => i.ref.id)).toContain('lying-knee-to-chest')
    expect(p.why).toMatch(/mobility|recovery/i)
  })

  test('a closed-off region is honoured in both blocks', () => {
    const p = prescribeStretches(ctx({ blockedRegions: ['hip'] }))
    const ids = [...p.warmup, ...p.cooldown].map((i) => i.ref.id)
    expect(ids).not.toContain('pigeon-pose')
    expect(ids).not.toContain('hip-circles')
    expect(ids).not.toContain('seated-figure-4')
  })

  test('blocking every region leaves empty blocks rather than throwing', () => {
    const p = prescribeStretches(
      ctx({ blockedRegions: ['ankle_foot', 'shin', 'knee', 'hip', 'hamstring', 'low_back'] }),
    )
    expect(Array.isArray(p.warmup)).toBe(true)
    expect(p.warmup.every((i) => i.ref.id !== 'hip-circles')).toBe(true)
  })

  test('an unknown extra warmup id is ignored, not crashed on', () => {
    const p = prescribeStretches(ctx(), { extraWarmupIds: ['not-a-stretch'] })
    expect(p.warmup.length).toBeGreaterThan(0)
  })

  test('nothing appears in both the warmup and the cooldown', () => {
    const p = prescribeStretches(ctx())
    const warm = new Set(p.warmup.map((i) => i.ref.id))
    expect(p.cooldown.every((i) => !warm.has(i.ref.id))).toBe(true)
  })

  test('item ids are deterministic', () => {
    const a = prescribeStretches(ctx())
    const b = prescribeStretches(ctx())
    expect(a.warmup.map((i) => i.id)).toEqual(b.warmup.map((i) => i.id))
    expect(a.cooldown.map((i) => i.id)).toEqual(b.cooldown.map((i) => i.id))
  })

  test('flagged pain keeps the cooldown gentle and the warmup short', () => {
    const p = prescribeStretches(ctx({ painFlagged: true }))
    expect(p.warmup.length).toBeLessThanOrEqual(3)
    expect(p.cooldown.length).toBeGreaterThan(0)
  })
})
