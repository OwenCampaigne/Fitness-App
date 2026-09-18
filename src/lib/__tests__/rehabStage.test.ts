// ── Rehab stage tests ─────────────────────────────────────────────────────────
// Three properties carry the whole design, and they are the first three blocks
// below: `unknown` is unmoved, self-report grants strictly less than a
// clinician's note, and free text cannot reach the engines without a second,
// explicit confirmation (§15, §11).

import {
  CANONICAL_STATEMENTS,
  MAX_SELF_REPORTED_STAGE,
  SELF_REPORT_RUN_CEILING_MIN,
  applyClearanceUpdate,
  applyRehabStage,
  currentStage,
  describeChange,
  historyRowFor,
  proposeClearanceUpdate,
  readStageRecord,
  stageForClearanceEntry,
  stageGrants,
  stagePermits,
} from '../rehabStage'
import type { RehabStageRecord } from '../rehabStage'
import { filterContraindicated } from '../strengthEngine'
import { highestRungWithinCeiling, LADDER_RUNGS } from '../runEngine'
import type { ClearanceEntry, StoredRecoveryContext } from '../clearance'
import type { KeyLift } from '../../types/strength'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const LIFT: KeyLift = {
  id: 'x',
  exerciseLibraryId: null,
  name: 'X',
  pattern: 'squat',
  primaryMuscleGroups: ['quads'],
  attributes: [],
  incrementKg: 5,
  defaultSets: 3,
  defaultReps: 8,
  defaultRepsMin: 6,
  defaultTargetRir: 2,
  bodyweight: false,
  runnerRationale: 'r',
}

const DEEP_SQUAT: KeyLift = { ...LIFT, id: 'squat', name: 'Back Squat', attributes: ['deep_knee_flexion'] }
const LEG_EXT: KeyLift = { ...LIFT, id: 'ext', name: 'Leg Extension', attributes: ['open_chain_knee_extension'] }
const BOX_JUMP: KeyLift = { ...LIFT, id: 'jump', name: 'Box Jump', attributes: ['high_impact'] }
const PIVOT: KeyLift = { ...LIFT, id: 'cut', name: 'Lateral Bound', attributes: ['loaded_pivot'] }
const SAFE: KeyLift = { ...LIFT, id: 'rdl', name: 'RDL', attributes: ['posterior_chain'] }
const ALL = [DEEP_SQUAT, LEG_EXT, BOX_JUMP, PIVOT, SAFE]

const NOW = new Date('2026-09-17T12:00:00Z')

function clinical(over: Partial<ClearanceEntry> = {}): ClearanceEntry {
  return {
    maxKneeFlexionDeg: 100,
    openChainCleared: false,
    impactCleared: false,
    pivotCleared: false,
    notes: null,
    setBy: 'user',
    clearedOn: '2026-08-01',
    clearedBy: 'PT',
    ...over,
  }
}

function athleteStage(stage: RehabStageRecord['stage']): RehabStageRecord {
  return { stage, setBy: 'athlete', recordedOn: '2026-09-17', sourceQuote: 'I am through rehab', notes: null }
}

function allowedIds(ctx: StoredRecoveryContext | null) {
  return filterContraindicated(ALL, applyRehabStage(ctx))
    .allowed.map((l) => l.id)
    .sort()
}

// ── 1. `unknown` is exactly where it was ──────────────────────────────────────

describe('unknown stage is unchanged', () => {
  test('an empty context is returned untouched, object identity and all', () => {
    const ctx: StoredRecoveryContext = {}
    expect(applyRehabStage(ctx)).toBe(ctx)
    expect(currentStage(ctx)).toBe('unknown')
  })

  test('null stays null', () => {
    expect(applyRehabStage(null)).toBeNull()
  })

  test('the conservative strength default still applies', () => {
    const result = filterContraindicated(ALL, applyRehabStage({} as StoredRecoveryContext))
    expect(result.usingConservativeDefault).toBe(true)
    expect(result.allowed.map((l) => l.id)).toEqual(['rdl'])
  })

  test('no ladder rung is offered', () => {
    const permits = stagePermits({})
    expect(permits.runSegmentMin).toBeNull()
    expect(highestRungWithinCeiling(permits.runSegmentMin)).toBe(-1)
  })

  test('a malformed stage record reads as no record at all', () => {
    const ctx = { rehabStage: { stage: 'wide_open', setBy: 'athlete' } } as StoredRecoveryContext
    expect(readStageRecord(ctx)).toBeNull()
    expect(currentStage(ctx)).toBe('unknown')
    expect(applyRehabStage(ctx)).toBe(ctx)
  })

  test('a stage nobody can reach through a valid actor is ignored', () => {
    const ctx = { rehabStage: { stage: 'graduated', setBy: 'the_app' } } as StoredRecoveryContext
    expect(readStageRecord(ctx)).toBeNull()
    expect(allowedIds(ctx)).toEqual(['rdl'])
  })

  test('a legacy clearance with no stage record reads as restricted and is untouched', () => {
    const ctx: StoredRecoveryContext = { clearance: clinical(), longestRunSegmentMin: 6 }
    expect(currentStage(ctx)).toBe('restricted')
    expect(applyRehabStage(ctx)).toBe(ctx)
  })
})

// ── 2. Self-report grants strictly less than a clinician's note ───────────────

describe('a self-reported graduation is more conservative than a documented one', () => {
  const selfGraduated: StoredRecoveryContext = { rehabStage: athleteStage('graduated') }
  const documented: StoredRecoveryContext = {
    clearance: clinical({
      maxKneeFlexionDeg: null,
      openChainCleared: true,
      impactCleared: true,
      pivotCleared: true,
    }),
    longestRunSegmentMin: 30,
    rehabStage: {
      stage: 'unrestricted',
      setBy: 'clinician',
      recordedOn: '2026-08-01',
      sourceQuote: null,
      notes: null,
    },
  }

  test('loaded pivot stays shut on a self-report and opens on a clinician note', () => {
    expect(stagePermits(selfGraduated).pivotAllowed).toBe(false)
    expect(stagePermits(documented).pivotAllowed).toBe(true)
    expect(allowedIds(selfGraduated)).not.toContain('cut')
    expect(allowedIds(documented)).toContain('cut')
  })

  test('the run ceiling is capped on a self-report and taken verbatim from a clinician', () => {
    expect(stagePermits(selfGraduated).runSegmentMin).toBe(SELF_REPORT_RUN_CEILING_MIN)
    expect(stagePermits(documented).runSegmentMin).toBe(30)
  })

  test('the self-report cap cannot reach the top of the ladder; 30 clinician minutes can', () => {
    const top = LADDER_RUNGS.length - 1
    expect(highestRungWithinCeiling(SELF_REPORT_RUN_CEILING_MIN)).toBeLessThan(top)
    expect(highestRungWithinCeiling(30)).toBe(top)
  })

  test('the permitted set on a self-report is a strict subset of the documented one', () => {
    const self = allowedIds(selfGraduated)
    const doc = allowedIds(documented)
    self.forEach((id) => expect(doc).toContain(id))
    expect(self.length).toBeLessThan(doc.length)
  })

  test('provenance reaches the caller, so the screen can say which it is', () => {
    expect(stagePermits(selfGraduated).selfReported).toBe(true)
    expect(stagePermits(selfGraduated).setBy).toBe('athlete')
    expect(stagePermits(documented).selfReported).toBe(false)
    expect(stagePermits(documented).setBy).toBe('clinician')
  })

  test('a self-report never raises a ceiling a clinician set higher', () => {
    const ctx: StoredRecoveryContext = { longestRunSegmentMin: 45, rehabStage: athleteStage('graduated') }
    expect(stagePermits(ctx).runSegmentMin).toBe(45)
  })
})

describe('what each stage permits', () => {
  test('progressing opens strength work but not impact', () => {
    const ctx: StoredRecoveryContext = { rehabStage: athleteStage('progressing') }
    const p = stagePermits(ctx)
    expect(p.deepFlexionAllowed).toBe(true)
    expect(p.openChainAllowed).toBe(true)
    expect(p.impactAllowed).toBe(false)
    expect(p.pivotAllowed).toBe(false)
    expect(p.runSegmentMin).toBeNull()
    expect(allowedIds(ctx).sort()).toEqual(['ext', 'rdl', 'squat'])
  })

  test('graduated adds impact and the capped ladder', () => {
    const ctx: StoredRecoveryContext = { rehabStage: athleteStage('graduated') }
    expect(allowedIds(ctx).sort()).toEqual(['ext', 'jump', 'rdl', 'squat'])
  })

  test('an athlete walking their report back writes no clearance object at all', () => {
    // The sharp edge in `filterContraindicated`: an all-false clearance would
    // read as permission, not as caution. Nothing to add means nothing written.
    const ctx: StoredRecoveryContext = { rehabStage: athleteStage('restricted') }
    const folded = applyRehabStage(ctx)
    expect(folded?.clearance).toBeUndefined()
    expect(filterContraindicated(ALL, folded).usingConservativeDefault).toBe(true)
  })

  test('self-report ORs onto a clinical clearance without erasing it', () => {
    const ctx: StoredRecoveryContext = {
      clearance: clinical({ openChainCleared: true }),
      rehabStage: athleteStage('graduated'),
    }
    const folded = applyRehabStage(ctx)
    // The column is unchanged; only the derived view moved.
    expect(ctx.clearance?.impactCleared).toBe(false)
    expect(folded?.clearance?.impactCleared).toBe(true)
    expect(folded?.clearance?.pivotCleared).toBe(false)
  })

  test('a clinician record supersedes: the stored clearance is used verbatim', () => {
    const ctx: StoredRecoveryContext = {
      clearance: clinical({ impactCleared: false }),
      rehabStage: {
        stage: 'restricted',
        setBy: 'clinician',
        recordedOn: '2026-08-01',
        sourceQuote: null,
        notes: null,
      },
    }
    expect(applyRehabStage(ctx)).toBe(ctx)
    expect(stagePermits(ctx).impactAllowed).toBe(false)
  })
})

// ── 3. Free text cannot unlock impact on its own ──────────────────────────────

describe('proposeClearanceUpdate proposes, and only proposes', () => {
  test('a graduation statement is read but changes nothing by itself', () => {
    const ctx: StoredRecoveryContext = {}
    const p = proposeClearanceUpdate('I am well through all of my rehab at this point', ctx, NOW)
    expect(p).not.toBeNull()
    expect(p!.to).toBe('graduated')
    expect(p!.setBy).toBe('athlete')
    expect(p!.sourceQuote).toBe('I am well through all of my rehab at this point')
    // The context handed in is untouched — proposing is not applying.
    expect(ctx).toEqual({})
    expect(allowedIds(ctx)).toEqual(['rdl'])
  })

  test('only applying moves the engines', () => {
    const ctx: StoredRecoveryContext = {}
    const p = proposeClearanceUpdate('my rehab is done', ctx, NOW)!
    const applied = applyClearanceUpdate(p, 'athlete', ctx, NOW)
    expect(allowedIds(applied.context)).toContain('jump')
    expect(allowedIds(ctx)).toEqual(['rdl'])
  })

  test('no phrasing reaches unrestricted', () => {
    for (const text of [
      'I have no restrictions at all, fully unrestricted, discharged from rehab',
      'my surgeon cleared me for everything, I am through rehab',
      'graduated from PT with no limits whatsoever',
    ]) {
      const p = proposeClearanceUpdate(text, {}, NOW)
      expect(p?.to).toBe(MAX_SELF_REPORTED_STAGE)
      expect(p?.to).not.toBe('unrestricted')
    }
  })

  test('applying a tampered proposal that claims unrestricted is refused', () => {
    const p = proposeClearanceUpdate('I am through rehab', {}, NOW)!
    expect(() =>
      applyClearanceUpdate({ ...p, to: 'unrestricted' }, 'athlete', {}, NOW),
    ).toThrow(/cannot exceed graduated/)
  })

  test('applying under the wrong actor is refused', () => {
    const p = proposeClearanceUpdate('I am through rehab', {}, NOW)!
    expect(() => applyClearanceUpdate(p, 'clinician', {}, NOW)).toThrow(/actor mismatch/)
  })

  test('applying a refused proposal throws rather than half-applying', () => {
    const p = proposeClearanceUpdate('I am through rehab', {}, NOW)!
    expect(() =>
      applyClearanceUpdate({ ...p, applicable: false, blockedReason: 'nope' }, 'athlete', {}, NOW),
    ).toThrow('nope')
  })

  test('ordinary training chatter proposes nothing', () => {
    for (const text of [
      'make today easier',
      'my knee felt a bit sore on the last rep',
      'swap back squats for something gentler on my knee',
      'move the long run to Sunday',
      '',
    ]) {
      expect(proposeClearanceUpdate(text, {}, NOW)).toBeNull()
    }
  })

  test('negation does not read as graduation', () => {
    for (const text of [
      'I am not through rehab yet',
      "I haven't finished rehab",
      'I am still in rehab',
    ]) {
      const p = proposeClearanceUpdate(text, {}, NOW)
      expect(p === null || p.to === 'restricted').toBe(true)
    }
  })

  test('a statement that changes nothing proposes nothing', () => {
    const ctx: StoredRecoveryContext = { rehabStage: athleteStage('graduated') }
    expect(proposeClearanceUpdate('I am through rehab', ctx, NOW)).toBeNull()
  })

  test('a downgrade is proposable and drops the self-report', () => {
    const ctx: StoredRecoveryContext = { rehabStage: athleteStage('graduated') }
    const p = proposeClearanceUpdate('I am back in rehab', ctx, NOW)!
    expect(p.to).toBe('restricted')
    const applied = applyClearanceUpdate(p, 'athlete', ctx, NOW)
    expect(allowedIds(applied.context)).toEqual(['rdl'])
  })
})

// ── The §15 safety floor: a fresh clinical "no" outranks a sentence ───────────

describe('a fresh clinical restriction is not overridable from chat', () => {
  const fresh: StoredRecoveryContext = {
    clearance: clinical({ clearedOn: '2026-08-01', impactCleared: false }),
    longestRunSegmentMin: 0,
    rehabStage: {
      stage: 'restricted',
      setBy: 'clinician',
      recordedOn: '2026-08-01',
      sourceQuote: null,
      notes: null,
    },
  }

  test('the proposal comes back refused, with the reason', () => {
    const p = proposeClearanceUpdate('I am through rehab', fresh, NOW)!
    expect(p.applicable).toBe(false)
    expect(p.blockedReason).toMatch(/impact/)
    expect(p.blockedReason).toMatch(/2026-08-01/)
  })

  test('a clearance past the staleness line lets the athlete report take over', () => {
    const stale: StoredRecoveryContext = {
      ...fresh,
      clearance: clinical({ clearedOn: '2025-06-01', impactCleared: false }),
    }
    const p = proposeClearanceUpdate('I am through rehab', stale, NOW)!
    expect(p.applicable).toBe(true)
    const applied = applyClearanceUpdate(p, 'athlete', stale, NOW)
    expect(stagePermits(applied.context).impactAllowed).toBe(true)
  })

  test('a downgrade is never blocked', () => {
    const p = proposeClearanceUpdate('I am still in rehab', fresh, NOW)
    expect(p === null || p.applicable).toBe(true)
  })
})

// ── History, provenance and the profile view ─────────────────────────────────

describe('every transition leaves a dated, attributed row', () => {
  test('applying writes a row with the date, the actor and the verbatim quote', () => {
    const p = proposeClearanceUpdate('I am well through all of my rehab', {}, NOW)!
    const { history, context } = applyClearanceUpdate(p, 'athlete', {}, NOW)
    expect(history.recordedOn).toEqual(NOW)
    expect(history.stage).toBe('graduated')
    expect(history.setBy).toBe('athlete')
    expect(history.sourceQuote).toBe('I am well through all of my rehab')
    // The row records what the engines would actually allow at that moment.
    const snapshot = JSON.parse(history.clearanceJson)
    expect(snapshot.clearance.impactCleared).toBe(true)
    expect(snapshot.clearance.pivotCleared).toBe(false)
    expect(snapshot.longestRunSegmentMin).toBe(SELF_REPORT_RUN_CEILING_MIN)
    expect(readStageRecord(context)?.recordedOn).toBe('2026-09-17')
  })

  test('a clearance form save is attributed to the clinician, not the athlete', () => {
    const entry = clinical()
    const record = stageForClearanceEntry(entry, 6)!
    expect(record.setBy).toBe('clinician')
    expect(record.stage).toBe('restricted')
    expect(historyRowFor(record, { clearance: entry, rehabStage: record }, NOW).setBy).toBe('clinician')
  })

  test('a full discharge reads as unrestricted', () => {
    const entry = clinical({
      maxKneeFlexionDeg: null,
      openChainCleared: true,
      impactCleared: true,
      pivotCleared: true,
    })
    expect(stageForClearanceEntry(entry, 30)?.stage).toBe('unrestricted')
    // …but only with a run ceiling: no ceiling means running is still not cleared.
    expect(stageForClearanceEntry(entry, 0)?.stage).toBe('restricted')
  })

  test('removing the clearance removes the stage', () => {
    expect(stageForClearanceEntry(null, null)).toBeNull()
  })
})

describe('describeChange speaks in the engine’s terms', () => {
  test('it names impact and the ladder cap, and says what stays shut', () => {
    const lines = describeChange('unknown', 'graduated', {})
    expect(lines.join(' ')).toMatch(/Impact work becomes available/)
    expect(lines.join(' ')).toMatch(new RegExp(`capped at ${SELF_REPORT_RUN_CEILING_MIN} min`))
    expect(lines.join(' ')).toMatch(/pivoting stays closed/i)
  })

  test('an existing clinician ceiling is described as moving, not as opening', () => {
    const lines = describeChange('unknown', 'graduated', { longestRunSegmentMin: 6 })
    expect(lines.join(' ')).toMatch(/ceiling moves from 6 to 10 min/)
  })

  test('a no-op change says so rather than implying movement', () => {
    expect(describeChange('unknown', 'restricted', {})).toEqual([
      'Nothing the engines prescribe changes.',
    ])
  })
})

describe('stageGrants is the single table the rest reads from', () => {
  test('unknown and restricted grant nothing', () => {
    for (const s of ['unknown', 'restricted'] as const) {
      const g = stageGrants(s)
      expect([g.deepFlexion, g.openChain, g.impact, g.pivot]).toEqual([false, false, false, false])
      expect(g.runCeilingMin).toBeNull()
    }
  })

  test('graduated grants strictly less than unrestricted', () => {
    const g = stageGrants('graduated')
    const u = stageGrants('unrestricted')
    expect(g.pivot).toBe(false)
    expect(u.pivot).toBe(true)
    expect(g.runCeilingMin).toBe(SELF_REPORT_RUN_CEILING_MIN)
  })
})

describe('the card’s buttons and the matcher cannot drift apart', () => {
  test('every canonical statement round-trips to the stage it names', () => {
    const start: StoredRecoveryContext = { rehabStage: athleteStage('graduated') }
    for (const [stage, text] of Object.entries(CANONICAL_STATEMENTS)) {
      const from: StoredRecoveryContext = stage === 'restricted' ? start : {}
      const p = proposeClearanceUpdate(text, from, NOW)
      expect(p).not.toBeNull()
      expect(p!.to).toBe(stage)
    }
  })
})
