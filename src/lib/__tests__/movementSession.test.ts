import { subDays } from 'date-fns'
import {
  BODY_REGIONS,
  buildMovementCandidates,
  decodePlyoQuality,
  encodePlyoQuality,
  episodeKey,
  groupPlyoHistory,
  masteredPlyoIds,
  movementItemTissues,
  prehabTreats,
  tissuesForRegion,
  toAllocatorNiggle,
  toAllocatorNiggles,
  toBodyRegion,
  toNiggleQuality,
  toNiggleRecord,
  toNiggleSide,
  toNiggleStatus,
  weeklyContactTotals,
} from '../movementSession'
import type { MovementCandidateInput, MovementSetRow, NiggleRow } from '../movementSession'
import { assessNiggles, DISCLAIMER, containsDiagnosisLanguage } from '../prehabEngine'
import { movementScenarios } from '../movementScenario'
import { REGION_TAGS } from '../prehab'
import type { NiggleAssessment, PlyoSessionHistory, PlyoTierAnchor } from '../../types/movement'
import type { SessionItem } from '../../types/session'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TODAY = new Date('2026-04-15T09:00:00Z')

function niggleRow(over: Partial<NiggleRow> = {}): NiggleRow {
  return {
    id: 1,
    date: TODAY,
    bodyRegion: 'ankle_foot',
    side: 'left',
    severity: 3,
    quality: 'achy',
    notes: null,
    status: 'active',
    firstReportedOn: subDays(TODAY, 2),
    resolvedOn: null,
    escalatedOn: null,
    ...over,
  }
}

function setRow(over: Partial<MovementSetRow> = {}): MovementSetRow {
  return {
    sessionId: 1,
    exerciseId: 'pogo-jumps',
    itemId: 'plyo-pogo-jumps',
    itemKind: 'plyo',
    setNumber: 1,
    contacts: 20,
    holdSec: null,
    reps: null,
    notes: null,
    ...over,
  }
}

function anchor(value: 1 | 2 | 3 = 1): PlyoTierAnchor {
  return { value, source: 'observed', confidence: 0.5, sessions: 2, basis: 'test' }
}

function candidateInput(over: Partial<MovementCandidateInput> = {}): MovementCandidateInput {
  return {
    band: 'green',
    isQualityDay: false,
    isRecoveryDay: false,
    painFlagged: false,
    todayRunType: 'easy',
    tomorrowRunType: 'easy',
    assessments: [],
    tierAnchor: anchor(1),
    masteredIds: ['pogo-jumps', 'ankling', 'a-skips', 'jump-rope-basic'],
    impactCleared: true,
    weeklyContacts: [200, 220, 240, 260],
    contactsThisWeek: 0,
    provisional: false,
    dayIndex: 5,
    ...over,
  }
}

// ── Row mapping ──────────────────────────────────────────────────────────────

describe('niggle row mapping', () => {
  it('maps a row onto the engine record', () => {
    const record = toNiggleRecord(niggleRow())
    expect(record.bodyRegion).toBe('ankle_foot')
    expect(record.side).toBe('left')
    expect(record.severity).toBe(3)
    expect(record.quality).toBe('achy')
    expect(record.status).toBe('active')
    expect(record.firstReportedOn).toEqual(subDays(TODAY, 2))
  })

  it('accepts ISO strings as well as Dates', () => {
    const record = toNiggleRecord(
      niggleRow({ date: TODAY.toISOString(), firstReportedOn: TODAY.toISOString() }),
    )
    expect(record.date).toBeInstanceOf(Date)
    expect(record.firstReportedOn).toBeInstanceOf(Date)
  })

  it('falls back rather than throwing on values SQLite let through', () => {
    const record = toNiggleRecord(
      niggleRow({ bodyRegion: 'elbow', side: 'port', quality: 'zingy', status: 'weird' }),
    )
    expect(record.bodyRegion).toBe('other')
    expect(record.side).toBeNull()
    expect(record.quality).toBeNull()
    expect(record.status).toBe('active')
  })

  it('clamps a severity outside 0–10', () => {
    expect(toNiggleRecord(niggleRow({ severity: 42 })).severity).toBe(10)
    expect(toNiggleRecord(niggleRow({ severity: -3 })).severity).toBe(0)
  })

  it('preserves resolved and escalated states', () => {
    expect(toNiggleRecord(niggleRow({ status: 'resolved', resolvedOn: TODAY })).status).toBe(
      'resolved',
    )
    expect(toNiggleRecord(niggleRow({ status: 'escalated' })).status).toBe('escalated')
  })

  it('coerces each field independently', () => {
    expect(toBodyRegion('knee')).toBe('knee')
    expect(toBodyRegion(null)).toBe('other')
    expect(toNiggleSide('both')).toBe('both')
    expect(toNiggleQuality('sharp')).toBe('sharp')
    expect(toNiggleStatus(undefined)).toBe('active')
  })

  it('keys left and right as separate episodes', () => {
    expect(episodeKey('knee', 'left')).not.toBe(episodeKey('knee', 'right'))
    expect(episodeKey('knee', null)).toBe('knee|none')
  })
})

// ── The tissue vocabulary ────────────────────────────────────────────────────

describe('tissue vocabulary', () => {
  it('includes the region itself alongside its tags', () => {
    const tissues = tissuesForRegion('ankle_foot')
    expect(tissues).toContain('ankle_foot')
    for (const tag of REGION_TAGS.ankle_foot) expect(tissues).toContain(tag)
  })

  it('covers every region the tracker can log', () => {
    for (const region of BODY_REGIONS) {
      expect(tissuesForRegion(region)).toContain(region)
    }
  })

  it('speaks the same language on both sides of the match', () => {
    // A logged ankle niggle and a pogo-jump candidate have to overlap, or the
    // §9 rail silently never fires.
    const niggle = tissuesForRegion('ankle_foot')
    const item: SessionItem = {
      id: 'plyo-pogo-jumps',
      ref: { kind: 'plyo', id: 'pogo-jumps', name: 'Pogo Jumps' },
      params: { kind: 'contacts', sets: 2, contactsPerSet: 20 },
      status: 'prescribed',
    }
    expect(movementItemTissues(item).some((t) => niggle.includes(t))).toBe(true)
  })

  it('resolves prehab and stretch items from their catalogs', () => {
    const prehab: SessionItem = {
      id: 'prehab-eccentric-heel-drops',
      ref: { kind: 'prehab', id: 'eccentric-heel-drops', name: 'Eccentric Heel Drops' },
      params: { kind: 'hold', sets: 3, reps: 12, holdSec: null, perSide: true },
      status: 'prescribed',
    }
    expect(movementItemTissues(prehab)).toContain('ankle_foot')

    const stretch: SessionItem = {
      id: 'stretch-cooldown-pigeon-pose',
      ref: { kind: 'stretch', id: 'pigeon-pose', name: 'Pigeon Pose' },
      params: { kind: 'hold', sets: 1, reps: null, holdSec: 30, perSide: true },
      status: 'prescribed',
    }
    expect(movementItemTissues(stretch)).toContain('hip')
  })

  it('returns nothing for kinds this module does not own', () => {
    const lift: SessionItem = {
      id: 'x',
      ref: { kind: 'exercise', id: 'back-squat', name: 'Back Squat' },
      params: { kind: 'strength', sets: 3, reps: 5, weightKg: 80, targetRir: 2 },
      status: 'prescribed',
    }
    expect(movementItemTissues(lift)).toEqual([])
  })

  it('reports what a prehab protocol treats, region and tags both', () => {
    const treats = prehabTreats('eccentric-heel-drops')
    expect(treats).toContain('ankle_foot')
    expect(treats.length).toBeGreaterThan(1)
    expect(prehabTreats('not-a-protocol')).toEqual([])
  })
})

describe('assessments → allocator niggles', () => {
  const assessment: NiggleAssessment = {
    bodyRegion: 'knee',
    side: 'right',
    level: 'downweight',
    daysActive: 4,
    currentSeverity: 5,
    peakSeverity: 5,
    trend: 'stable',
    sharp: false,
    reports: 2,
    prescribeIntoRegion: true,
    reason: 'test',
    flag: null,
  }

  it('carries severity, days and the tissue list across', () => {
    const niggle = toAllocatorNiggle(assessment)
    expect(niggle.bodyRegion).toBe('knee')
    expect(niggle.severity).toBe(5)
    expect(niggle.daysActive).toBe(4)
    expect(niggle.tissues).toContain('knee')
  })

  it('drops resolved episodes', () => {
    const resolved: NiggleAssessment = { ...assessment, level: 'none' }
    expect(toAllocatorNiggles([assessment, resolved])).toHaveLength(1)
  })
})

// ── The set_logs notes codec (schema workaround) ─────────────────────────────

describe('plyo execution quality codec', () => {
  it('round-trips a clean session', () => {
    const encoded = encodePlyoQuality({ cleanExecution: true, sorenessNextDay: 2 })
    expect(decodePlyoQuality(encoded)).toEqual({
      cleanExecution: true,
      sorenessNextDay: 2,
      notes: null,
    })
  })

  it('round-trips a failed session with free text intact', () => {
    const encoded = encodePlyoQuality(
      { cleanExecution: false, sorenessNextDay: 8 },
      'knees caved on the last two',
    )
    expect(decodePlyoQuality(encoded)).toEqual({
      cleanExecution: false,
      sorenessNextDay: 8,
      notes: 'knees caved on the last two',
    })
  })

  it('round-trips an unanswered session', () => {
    const encoded = encodePlyoQuality({ cleanExecution: null, sorenessNextDay: null })
    expect(decodePlyoQuality(encoded)).toEqual({
      cleanExecution: null,
      sorenessNextDay: null,
      notes: null,
    })
  })

  it('leaves untagged notes alone', () => {
    expect(decodePlyoQuality('felt great')).toEqual({
      cleanExecution: null,
      sorenessNextDay: null,
      notes: 'felt great',
    })
    expect(decodePlyoQuality(null).notes).toBeNull()
  })

  it('clamps a soreness rating outside 0–10', () => {
    expect(decodePlyoQuality(encodePlyoQuality({ cleanExecution: true, sorenessNextDay: 99 }))
      .sorenessNextDay).toBe(10)
  })
})

// ── Plyo history from the set log ────────────────────────────────────────────

describe('groupPlyoHistory', () => {
  const dates = { 1: subDays(TODAY, 7), 2: subDays(TODAY, 3) }

  it('sums contacts per drill per session', () => {
    const history = groupPlyoHistory(
      [setRow({ setNumber: 1 }), setRow({ setNumber: 2 }), setRow({ setNumber: 3 })],
      dates,
    )
    expect(history).toHaveLength(1)
    expect(history[0].contacts).toBe(60)
    expect(history[0].tier).toBe(1)
  })

  it('keeps sessions and drills apart', () => {
    const history = groupPlyoHistory(
      [
        setRow({ sessionId: 1 }),
        setRow({ sessionId: 2 }),
        setRow({ sessionId: 2, exerciseId: 'bounding', itemId: 'plyo-bounding' }),
      ],
      dates,
    )
    expect(history).toHaveLength(3)
  })

  it('ignores rows that are not plyos', () => {
    const history = groupPlyoHistory(
      [setRow({ itemKind: 'exercise' }), setRow({ itemKind: null }), setRow()],
      dates,
    )
    expect(history).toHaveLength(1)
  })

  it('ignores a drill the catalog does not know', () => {
    expect(groupPlyoHistory([setRow({ exerciseId: 'moon-jumps' })], dates)).toHaveLength(0)
  })

  it('lets one ugly set decide the whole session', () => {
    const history = groupPlyoHistory(
      [
        setRow({
          setNumber: 1,
          notes: encodePlyoQuality({ cleanExecution: true, sorenessNextDay: 1 }),
        }),
        setRow({
          setNumber: 2,
          notes: encodePlyoQuality({ cleanExecution: false, sorenessNextDay: 6 }),
        }),
      ],
      dates,
    )
    expect(history[0].cleanExecution).toBe(false)
    expect(history[0].sorenessNextDay).toBe(6)
  })

  it('returns exposures oldest first', () => {
    const history = groupPlyoHistory([setRow({ sessionId: 2 }), setRow({ sessionId: 1 })], dates)
    expect(history[0].date.getTime()).toBeLessThan(history[1].date.getTime())
  })
})

describe('weeklyContactTotals', () => {
  function exposure(daysAgo: number, contacts: number): PlyoSessionHistory {
    return {
      date: subDays(TODAY, daysAgo),
      plyoId: 'pogo-jumps',
      tier: 1,
      contacts,
      cleanExecution: true,
      sorenessNextDay: 1,
    }
  }

  it('separates the incomplete week from the completed ones', () => {
    const { weeklyContacts, contactsThisWeek } = weeklyContactTotals(
      [exposure(1, 40), exposure(8, 60), exposure(15, 80)],
      TODAY,
    )
    expect(contactsThisWeek).toBe(40)
    // Oldest first: index 3 is the most recent completed week.
    expect(weeklyContacts).toHaveLength(4)
    expect(weeklyContacts[3]).toBe(60)
    expect(weeklyContacts[2]).toBe(80)
  })

  it('drops anything past the window', () => {
    const { weeklyContacts } = weeklyContactTotals([exposure(90, 500)], TODAY)
    expect(weeklyContacts.reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('returns zeros rather than an empty array with no history', () => {
    expect(weeklyContactTotals([], TODAY).weeklyContacts).toEqual([0, 0, 0, 0])
  })
})

describe('masteredPlyoIds', () => {
  function exposure(daysAgo: number, plyoId: string, clean: boolean | null): PlyoSessionHistory {
    return {
      date: subDays(TODAY, daysAgo),
      plyoId,
      tier: 1,
      contacts: 40,
      cleanExecution: clean,
      sorenessNextDay: 1,
    }
  }

  it('counts a drill logged cleanly', () => {
    expect(masteredPlyoIds([exposure(10, 'pogo-jumps', true)], TODAY)).toEqual(['pogo-jumps'])
  })

  it('does not count one that did not hold', () => {
    expect(masteredPlyoIds([exposure(10, 'depth-jumps', false)], TODAY)).toEqual([])
  })

  it('forgets a drill outside the window', () => {
    expect(masteredPlyoIds([exposure(200, 'pogo-jumps', true)], TODAY)).toEqual([])
  })
})

// ── Candidate production ─────────────────────────────────────────────────────

describe('buildMovementCandidates', () => {
  it('produces priced candidates from all three engines', () => {
    const built = buildMovementCandidates(candidateInput())
    expect(built.candidates.length).toBeGreaterThan(0)
    const modalities = new Set(built.candidates.map((c) => c.modality))
    expect(modalities.has('prehab')).toBe(true)
    expect(modalities.has('stretch')).toBe(true)
    for (const candidate of built.candidates) {
      expect(candidate.cost.load).toBeGreaterThanOrEqual(0)
      expect(candidate.cost.durationMin).toBeGreaterThan(0)
    }
  })

  it('places each modality in the block the engine chose', () => {
    const built = buildMovementCandidates(candidateInput())
    for (const candidate of built.candidates) {
      if (candidate.modality === 'stretch') {
        expect(['warmup', 'cooldown']).toContain(candidate.placement)
      }
      if (candidate.modality === 'prehab') expect(candidate.placement).toBe('accessory')
    }
  })

  it('tags every candidate with the tissues it loads', () => {
    const built = buildMovementCandidates(candidateInput())
    const plyos = built.candidates.filter((c) => c.modality === 'plyo')
    expect(plyos.length).toBeGreaterThan(0)
    for (const candidate of plyos) {
      expect(candidate.constraints?.tissues?.length).toBeGreaterThan(0)
      expect(candidate.constraints?.notBeforeLongRun).toBe(true)
    }
  })

  it('marks routine prehab untrimmable — half a calf raise is not a dose', () => {
    const built = buildMovementCandidates(candidateInput())
    for (const candidate of built.candidates.filter((c) => c.modality === 'prehab')) {
      expect(candidate.constraints?.trimmable).toBe(false)
      expect(candidate.constraints?.treats?.length).toBeGreaterThan(0)
    }
  })

  it('offers no plyos the day before a long run (§9)', () => {
    const built = buildMovementCandidates(candidateInput({ tomorrowRunType: 'long' }))
    expect(built.candidates.filter((c) => c.modality === 'plyo')).toHaveLength(0)
    expect(built.plyo.placement).toBe('none')
  })

  it('offers no plyos on a red day', () => {
    const built = buildMovementCandidates(candidateInput({ band: 'red' }))
    expect(built.candidates.filter((c) => c.modality === 'plyo')).toHaveLength(0)
  })

  it('flags a static hold that tried to enter a quality warmup', () => {
    const built = buildMovementCandidates(candidateInput({ isQualityDay: true }))
    const warmupStatics = built.candidates.filter(
      (c) => c.placement === 'warmup' && c.constraints?.excludeFromWarmupBeforeQuality,
    )
    expect(warmupStatics).toHaveLength(0)
  })

  it('targets a logged region and says so', () => {
    const assessments = assessNiggles(movementScenarios().niggle_achilles.niggles, new Date())
    const built = buildMovementCandidates(candidateInput({ assessments }))
    expect(built.prehab.targeted).toBe(true)
    const treated = built.candidates.filter((c) =>
      c.constraints?.treats?.includes('ankle_foot'),
    )
    expect(treated.length).toBeGreaterThan(0)
  })

  it('stops prescribing into an escalated region entirely (§15)', () => {
    const assessments = assessNiggles(movementScenarios().niggle_sharp.niggles, new Date())
    expect(assessments[0].level).toBe('stop_and_refer')
    const built = buildMovementCandidates(candidateInput({ assessments }))
    expect(built.adjustment.blockImpact).toBe(true)
    expect(built.candidates.filter((c) => c.modality === 'plyo')).toHaveLength(0)
    for (const candidate of built.candidates) {
      expect(candidate.constraints?.tissues ?? []).not.toContain('knee')
    }
  })

  it('carries the §15 disclaimer on every build', () => {
    expect(buildMovementCandidates(candidateInput()).disclaimer).toBe(DISCLAIMER)
  })

  it('never names a condition in anything it produces', () => {
    for (const scenario of Object.values(movementScenarios())) {
      const assessments = assessNiggles(scenario.niggles, new Date())
      const built = buildMovementCandidates(candidateInput({ assessments }))
      const text = [
        built.plyo.why,
        built.prehab.why,
        built.stretch.why,
        built.adjustment.summary,
        ...built.candidates.map((c) => c.item.why ?? ''),
      ].join(' ')
      expect(containsDiagnosisLanguage(text)).toBe(false)
    }
  })

  it('still produces a session when everything hard is off the table', () => {
    const built = buildMovementCandidates(
      candidateInput({ band: 'red', painFlagged: true, isRecoveryDay: true }),
    )
    // Routine prehab and mobility are near-free and are the point of a red day.
    expect(built.candidates.length).toBeGreaterThan(0)
  })
})
