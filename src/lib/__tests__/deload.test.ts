// ── Load-triggered deload tests ───────────────────────────────────────────────
// Framework §17. The evaluation is pure, and the patch it builds is asserted by
// putting it through the real `applySessionPatch` — because the claim being
// tested is not "the numbers shrink" but "a deload is an edit like any other".

import {
  ACWR_DANGER_LEVEL,
  AMBER_RUN_DAYS,
  DELOAD_DEEP_FACTOR,
  DELOAD_REASON_PREFIX,
  DELOAD_TRIM_FACTOR,
  HRV_DOWN_DAYS,
  acwrTail,
  buildDeloadPatch,
  evaluateDeload,
  hrvDownDays,
} from '../deload'
import { applySessionPatch } from '../session'
import { estimateItemCost } from '../load'
import type { DeloadSignals } from '../deload'
import type { ValidationContext } from '../session'
import type { EditableSession } from '../../types/patch'
import type { SessionBlock, SessionItem } from '../../types/session'
import type { LoadBudget } from '../load'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function quiet(over: Partial<DeloadSignals> = {}): DeloadSignals {
  return {
    recentAcwr: [1.0, 1.02, 1.05],
    recentRirDeficit: [0, 0.2],
    weeklySetsThisWeek: {},
    weeklySetsLastWeek: {},
    recentHrv: [50, 51, 52, 51],
    recentBands: ['green', 'green', 'green'],
    ...over,
  }
}

function vo2(): SessionItem {
  return {
    id: 'run-vo2',
    ref: { kind: 'run', id: 'vo2', name: 'VO₂ intervals' },
    params: {
      kind: 'run',
      runType: 'vo2',
      durationMin: 50,
      intervals: [{ repeat: 5, workSec: 180, recoverSec: 120 }],
    },
    status: 'prescribed',
  }
}

function squat(): SessionItem {
  return {
    id: 'squat-1',
    ref: { kind: 'exercise', id: 'back-squat', name: 'Back Squat' },
    params: { kind: 'strength', sets: 4, reps: 6, weightKg: 90, targetRir: 1, restSec: 180 },
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
    { id: 'b-main', kind: 'main', label: 'Main', items: [vo2(), squat()] },
    { id: 'b-acc', kind: 'accessory', label: 'Accessory', items: [calfWork()] },
  ]
}

function session(): EditableSession {
  return { id: 1, date: new Date('2026-09-16T00:00:00'), status: 'active', version: 2, blocks: blocks() }
}

function budget(over: Partial<LoadBudget> = {}): LoadBudget {
  return {
    ceiling: 5000,
    target: 4000,
    floor: 0,
    acwr: 1.4,
    acwrCap: 1.3,
    chronicDailyLoad: 300,
    band: 'amber',
    calibrating: false,
    reasons: [],
    ...over,
  }
}

function context(over: Partial<ValidationContext> = {}): ValidationContext {
  return { budget: budget(), band: 'amber', calibrating: false, niggles: [], ...over }
}

// ── The HRV trend ─────────────────────────────────────────────────────────────

describe('hrvDownDays', () => {
  it('counts a run of falling nights from the newest backwards', () => {
    expect(hrvDownDays([55, 54, 52, 48])).toBe(3)
  })

  it('stops at the first night that went up', () => {
    expect(hrvDownDays([55, 50, 52, 48])).toBe(1)
  })

  it('is zero on a flat or rising trend', () => {
    expect(hrvDownDays([48, 50, 52])).toBe(0)
    expect(hrvDownDays([50, 50, 50])).toBe(0)
  })

  it('ignores zeros and gaps rather than reading them as a crash', () => {
    expect(hrvDownDays([55, 0, 54, 53])).toBe(2)
  })

  it('handles an empty history', () => {
    expect(hrvDownDays([])).toBe(0)
  })
})

// ── The verdict ───────────────────────────────────────────────────────────────

describe('evaluateDeload', () => {
  it('does not fire on a healthy week (§17: no calendar cadence)', () => {
    const verdict = evaluateDeload(quiet())
    expect(verdict).toMatchObject({ triggered: false, severity: 'none', factor: 1 })
    expect(verdict.reasons).toEqual([])
  })

  it('fires on ACWR above 1.3 for three days running', () => {
    const verdict = evaluateDeload(quiet({ recentAcwr: [1.35, 1.38, 1.42] }))
    expect(verdict.triggered).toBe(true)
    expect(verdict.triggers.map((t) => t.code)).toContain('acwr_sustained')
  })

  it('fires on an ACWR past the danger line even without a run of days', () => {
    const verdict = evaluateDeload(quiet({ recentAcwr: [1.0, 1.1, ACWR_DANGER_LEVEL + 0.1] }))
    expect(verdict.triggers.map((t) => t.code)).toContain('acwr_danger')
  })

  it('fires on RIR drifting below target two sessions running', () => {
    const verdict = evaluateDeload(quiet({ recentRirDeficit: [-1.8, -2.1] }))
    expect(verdict.triggers.map((t) => t.code)).toContain('rir_drift')
  })

  it('fires on volume above MRV two weeks running', () => {
    const verdict = evaluateDeload(
      quiet({ weeklySetsThisWeek: { quads: 40 }, weeklySetsLastWeek: { quads: 42 } }),
    )
    expect(verdict.triggers.map((t) => t.code)).toContain('strength_landmarks')
  })

  it('fires on an HRV downtrend — the signal the lifting engine cannot see', () => {
    const verdict = evaluateDeload(quiet({ recentHrv: [55, 53, 51, 48] }))
    expect(verdict.triggers.map((t) => t.code)).toContain('hrv_downtrend')
    expect(verdict.reasons[0]).toContain(`${HRV_DOWN_DAYS} days running`)
  })

  it('fires on a run of non-green days', () => {
    const verdict = evaluateDeload(quiet({ recentBands: ['amber', 'amber', 'red'] }))
    expect(verdict.triggers.map((t) => t.code)).toContain('readiness_trend')
  })

  it('does not fire on a single amber day', () => {
    expect(evaluateDeload(quiet({ recentBands: ['green', 'green', 'amber'] })).triggered).toBe(false)
  })

  it('one trigger trims; two are a real deload', () => {
    const one = evaluateDeload(quiet({ recentHrv: [55, 53, 51, 48] }))
    expect(one).toMatchObject({ severity: 'trim', factor: DELOAD_TRIM_FACTOR })

    const two = evaluateDeload(
      quiet({ recentHrv: [55, 53, 51, 48], recentBands: ['amber', 'amber', 'amber'] }),
    )
    expect(two).toMatchObject({ severity: 'deload', factor: DELOAD_DEEP_FACTOR })
  })

  it('always says why (§17)', () => {
    const verdict = evaluateDeload(quiet({ recentAcwr: [1.4, 1.5, 1.6] }))
    expect(verdict.reasons.length).toBeGreaterThan(0)
    for (const reason of verdict.reasons) expect(reason.length).toBeGreaterThan(20)
  })

  it('needs a full window before calling a readiness trend', () => {
    expect(
      evaluateDeload(quiet({ recentBands: Array(AMBER_RUN_DAYS - 1).fill('red') })).triggered,
    ).toBe(false)
  })
})

// ── ACWR over a tail of days ──────────────────────────────────────────────────

describe('acwrTail', () => {
  it('reports one value per day, oldest first', () => {
    const loads = Array.from({ length: 28 }, (_, i) => 100 + i)
    expect(acwrTail(loads, 3)).toHaveLength(3)
  })

  it('rises as the recent days get heavier', () => {
    const loads = [...Array(25).fill(100), 400, 500, 600]
    const tail = acwrTail(loads, 3)
    expect(tail[2]).toBeGreaterThan(tail[0])
  })

  it('survives an empty history', () => {
    expect(acwrTail([], 3)).toEqual([])
  })
})

// ── The patch ─────────────────────────────────────────────────────────────────

describe('buildDeloadPatch', () => {
  const verdict = evaluateDeload(
    quiet({ recentHrv: [55, 53, 51, 48], recentBands: ['amber', 'amber', 'amber'] }),
  )

  it('is an engine-authored patch, not a rewrite', () => {
    const patch = buildDeloadPatch(blocks(), verdict)
    expect(patch.actor).toBe('engine')
    expect(patch.ops.length).toBeGreaterThan(0)
  })

  it('touches only the hard work and leaves prehab alone (§9)', () => {
    const patch = buildDeloadPatch(blocks(), verdict)
    const touched = patch.ops.map((op) =>
      op.op === 'reorder' ? '' : op.op === 'add' ? op.item.id : op.itemId,
    )
    expect(touched).not.toContain('calf-1')
    expect(touched).toContain('run-vo2')
  })

  it('says why on every op — the diff has to read (§11)', () => {
    const patch = buildDeloadPatch(blocks(), verdict)
    for (const op of patch.ops) {
      expect(op.reason.startsWith(DELOAD_REASON_PREFIX)).toBe(true)
      expect(op.reason).toContain('%')
    }
  })

  it('preserves item status so a deload does not mark cards as hand-edited', () => {
    const patch = buildDeloadPatch(blocks(), verdict)
    for (const op of patch.ops) {
      if (op.op === 'modify') expect(op.status).toBe('prescribed')
    }
  })

  it('does nothing to a session with no hard work in it', () => {
    const easy: SessionBlock[] = [
      { id: 'b', kind: 'accessory', label: 'Accessory', items: [calfWork()] },
    ]
    expect(buildDeloadPatch(easy, verdict).ops).toHaveLength(0)
  })
})

describe('a deload goes through the one funnel (§11, §17)', () => {
  const verdict = evaluateDeload(
    quiet({ recentHrv: [55, 53, 51, 48], recentBands: ['amber', 'amber', 'amber'] }),
  )

  it('applies, versions and produces an inverse like any other edit', () => {
    const patch = buildDeloadPatch(blocks(), verdict)
    const outcome = applySessionPatch(session(), patch, context())

    expect(outcome.applied).toBe(true)
    expect(outcome.session.version).toBe(3)
    expect(outcome.session.sourceOfLastEdit).toBe('engine')
    // Reversible: §10's "every auto-change visible and reversible".
    expect(outcome.inverse).not.toBeNull()
    expect(outcome.inverse!.ops.length).toBe(patch.ops.length)
  })

  it('actually reduces the day', () => {
    const before = blocks()
    const patch = buildDeloadPatch(before, verdict)
    const outcome = applySessionPatch(session(), patch, context())
    expect(outcome.diff.loadAfter).toBeLessThan(outcome.diff.loadBefore)
  })

  it('is undoable — the inverse restores the original prescription', () => {
    const patch = buildDeloadPatch(blocks(), verdict)
    const applied = applySessionPatch(session(), patch, context())
    const undone = applySessionPatch(applied.session, applied.inverse!, context())

    const original = estimateItemCost(vo2()).load
    const restored = estimateItemCost(
      undone.session.blocks[0].items.find((i) => i.id === 'run-vo2')!,
    ).load
    expect(restored).toBeCloseTo(original, 5)
  })

  it('produces a diff a person can read', () => {
    const patch = buildDeloadPatch(blocks(), verdict)
    const outcome = applySessionPatch(session(), patch, context())
    expect(outcome.diff.summary).not.toBe('nothing to action')
    for (const entry of outcome.diff.entries) {
      expect(entry.before).not.toBeNull()
      expect(entry.reason).toContain('Deload')
    }
  })

  it('is subject to the validator, not exempt from it', () => {
    // A zero ceiling refuses even a deload's own additions; nothing here adds
    // load, so the trim is allowed through — but it went through the rules to
    // find that out rather than around them.
    const patch = buildDeloadPatch(blocks(), verdict)
    const outcome = applySessionPatch(session(), patch, context({ budget: budget({ ceiling: 1 }) }))
    expect(outcome.verdict.findings.some((f) => f.rule === 'load_ceiling')).toBe(true)
  })
})
