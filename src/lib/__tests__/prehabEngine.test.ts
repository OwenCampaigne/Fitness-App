import { subDays } from 'date-fns'
import {
  DISCLAIMER,
  ESCALATION_DAYS_HARD,
  ESCALATION_DAYS_WATCH,
  assessNiggle,
  assessNiggles,
  combineTissueLoad,
  containsDiagnosisLanguage,
  doseFor,
  matchPrehab,
  prescribePrehab,
  routinePrehabDose,
  tissueLoadAdjustment,
} from '../prehabEngine'
import { getPrehab } from '../prehab'
import { movementScenarios } from '../movementScenario'
import { isHoldParams } from '../../types/session'
import type { BodyRegion, NiggleAssessment, NiggleQuality, NiggleRecord } from '../../types/movement'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TODAY = new Date('2026-03-15T08:00:00Z')

/** Below this a report is still 'just a niggle' on severity alone. */
const SEVERITY_NOT_YET_SEVERE = 7

function report(
  daysAgo: number,
  severity: number,
  over: Partial<NiggleRecord> = {},
): NiggleRecord {
  return {
    date: subDays(TODAY, daysAgo),
    bodyRegion: 'ankle_foot',
    side: 'left',
    severity,
    quality: 'achy' as NiggleQuality,
    status: 'active',
    firstReportedOn: subDays(TODAY, daysAgo),
    ...over,
  }
}

/** An episode: several reports sharing one `firstReportedOn`. */
function episode(
  startedDaysAgo: number,
  severities: Array<[daysAgo: number, severity: number]>,
  over: Partial<NiggleRecord> = {},
): NiggleRecord[] {
  const firstReportedOn = subDays(TODAY, startedDaysAgo)
  return severities.map(([daysAgo, severity]) =>
    report(daysAgo, severity, { firstReportedOn, ...over }),
  )
}

// ── Niggle assessment ────────────────────────────────────────────────────────

describe('assessNiggle', () => {
  test('no reports means no assessment to make', () => {
    expect(assessNiggle([], TODAY)).toBeNull()
  })

  test('a fresh mild niggle is watched, not acted on', () => {
    const a = assessNiggle(episode(0, [[0, 3]]), TODAY)!
    expect(a.level).toBe('monitor')
    expect(a.daysActive).toBe(1)
    expect(a.trend).toBe('stable')
    expect(a.prescribeIntoRegion).toBe(true)
    expect(a.flag).toBeNull()
  })

  test('a moderate niggle down-weights the tissue', () => {
    const a = assessNiggle(
      episode(2, [
        [2, 5],
        [0, 5],
      ]),
      TODAY,
    )!
    expect(a.level).toBe('downweight')
    expect(a.currentSeverity).toBe(5)
  })

  test('sharp escalates immediately, whatever the severity', () => {
    const a = assessNiggle(episode(0, [[0, 2]], { quality: 'sharp' }), TODAY)!
    expect(a.sharp).toBe(true)
    expect(a.level).toBe('stop_and_refer')
    expect(a.prescribeIntoRegion).toBe(false)
    expect(a.flag).toMatch(/professional|physio|doctor/i)
  })

  test('a sharp episode stays escalated even once the latest report is dull', () => {
    const a = assessNiggle(
      [
        ...episode(4, [[4, 3]], { quality: 'sharp' }),
        ...episode(4, [[0, 2]], { quality: 'dull' }),
      ],
      TODAY,
    )!
    expect(a.level).toBe('stop_and_refer')
  })

  test('a worsening trend escalates', () => {
    const a = assessNiggle(
      episode(4, [
        [4, 3],
        [2, 4],
        [0, 5],
      ]),
      TODAY,
    )!
    expect(a.trend).toBe('worsening')
    expect(a.level).toBe('stop_and_refer')
  })

  test('one bad day is not a trend', () => {
    const a = assessNiggle(
      episode(1, [
        [1, 2],
        [0, 4],
      ]),
      TODAY,
    )!
    // Two calendar days in — still inside the window where a spike is noise.
    expect(a.daysActive).toBeLessThan(3)
    expect(a.level).not.toBe('stop_and_refer')
  })

  test('high severity escalates on its own', () => {
    const a = assessNiggle(episode(1, [[0, 8]]), TODAY)!
    expect(a.level).toBe('stop_and_refer')
  })

  test('past two weeks escalates however mild and however steady', () => {
    const a = assessNiggle(
      episode(ESCALATION_DAYS_HARD, [
        [ESCALATION_DAYS_HARD, 3],
        [0, 3],
      ]),
      TODAY,
    )!
    expect(a.daysActive).toBeGreaterThanOrEqual(ESCALATION_DAYS_HARD)
    expect(a.level).toBe('stop_and_refer')
    expect(a.flag).toMatch(/professional|physio|doctor/i)
  })

  test('past ten days without improving escalates too', () => {
    const a = assessNiggle(
      episode(ESCALATION_DAYS_WATCH, [
        [ESCALATION_DAYS_WATCH, 3],
        [0, 3],
      ]),
      TODAY,
    )!
    expect(a.level).toBe('stop_and_refer')
  })

  test('past ten days but clearly improving keeps working, with a warning', () => {
    const a = assessNiggle(
      episode(ESCALATION_DAYS_WATCH, [
        [ESCALATION_DAYS_WATCH, 5],
        [0, 2],
      ]),
      TODAY,
    )!
    expect(a.trend).toBe('improving')
    expect(a.level).toBe('downweight')
    expect(a.prescribeIntoRegion).toBe(true)
    expect(a.flag).toMatch(/two weeks|14/i)
  })

  test('an improving mild niggle drops back to monitoring', () => {
    const a = assessNiggle(
      episode(4, [
        [4, 6],
        [0, 3],
      ]),
      TODAY,
    )!
    expect(a.trend).toBe('improving')
    expect(a.level).toBe('monitor')
  })

  test('a resolved episode stops driving anything', () => {
    const a = assessNiggle(episode(6, [[0, 1]], { status: 'resolved' }), TODAY)!
    expect(a.level).toBe('none')
    expect(a.prescribeIntoRegion).toBe(true)
    expect(a.flag).toBeNull()
  })

  test('an episode already marked escalated stays escalated', () => {
    const a = assessNiggle(episode(2, [[0, 2]], { status: 'escalated' }), TODAY)!
    expect(a.level).toBe('stop_and_refer')
  })

  test('peak severity is remembered even after it eases', () => {
    const a = assessNiggle(
      episode(4, [
        [4, 6],
        [0, 3],
      ]),
      TODAY,
    )!
    expect(a.peakSeverity).toBe(6)
    expect(a.currentSeverity).toBe(3)
  })
})

describe('assessNiggles', () => {
  test('groups by region and side', () => {
    const all = [
      ...episode(3, [[0, 3]], { bodyRegion: 'ankle_foot', side: 'left' }),
      ...episode(3, [[0, 4]], { bodyRegion: 'knee', side: 'right' }),
    ]
    const out = assessNiggles(all, TODAY)
    expect(out).toHaveLength(2)
    expect(out.map((a) => a.bodyRegion).sort()).toEqual(['ankle_foot', 'knee'])
  })

  test('left and right of the same region are separate episodes', () => {
    const all = [
      ...episode(3, [[0, 3]], { bodyRegion: 'knee', side: 'left' }),
      ...episode(3, [[0, 3]], { bodyRegion: 'knee', side: 'right' }),
    ]
    expect(assessNiggles(all, TODAY)).toHaveLength(2)
  })

  test('resolved episodes are left out', () => {
    const all = [
      ...episode(3, [[0, 3]], { bodyRegion: 'ankle_foot', status: 'resolved' }),
      ...episode(3, [[0, 3]], { bodyRegion: 'knee', side: 'right' }),
    ]
    const out = assessNiggles(all, TODAY)
    expect(out).toHaveLength(1)
    expect(out[0].bodyRegion).toBe('knee')
  })
})

// ── Matching ─────────────────────────────────────────────────────────────────

describe('matchPrehab', () => {
  test('an ankle niggle leads with eccentric loading', () => {
    const matches = matchPrehab('ankle_foot')
    expect(matches[0].protocol.id).toBe('eccentric-heel-drops')
    expect(matches[0].matchedOn).toBe('region_and_tag')
  })

  test('a knee niggle leads with hip-abductor work, not with the knee itself', () => {
    // The framework's own example (§9): the knee complains, the hip is treated.
    const matches = matchPrehab('knee')
    expect(matches[0].protocol.id).toBe('hip-abductor-strengthening')
  })

  test('a shin niggle leads with tibialis work', () => {
    expect(matchPrehab('shin')[0].protocol.id).toBe('tibialis-anterior-raises')
  })

  test('a hip niggle stays in the hip', () => {
    const matches = matchPrehab('hip')
    expect(matches[0].protocol.bodyRegion).toBe('hip')
  })

  test('strengthening outranks mobility at equal relevance', () => {
    const matches = matchPrehab('low_back')
    const categories = matches.map((m) => m.protocol.category)
    expect(categories.indexOf('stability')).toBeLessThan(categories.indexOf('mobility'))
  })

  test('a region the catalog does not cover still matches on tags', () => {
    const matches = matchPrehab('hamstring')
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((m) => m.matchedOn === 'tag')).toBe(true)
  })

  test('an unclassifiable region with no tags matches nothing rather than guessing', () => {
    expect(matchPrehab('other')).toEqual([])
  })

  test('explicit tags override the region defaults', () => {
    const matches = matchPrehab('other', ['low_back'])
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((m) => m.protocol.niggleTags.includes('low_back'))).toBe(true)
  })

  test('results are ordered by score, descending', () => {
    const scores = matchPrehab('ankle_foot').map((m) => m.score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })
})

// ── Tissue load down-weighting ───────────────────────────────────────────────

function assessment(over: Partial<NiggleAssessment>): NiggleAssessment {
  return {
    bodyRegion: 'ankle_foot',
    side: 'left',
    level: 'monitor',
    daysActive: 2,
    currentSeverity: 3,
    peakSeverity: 3,
    trend: 'stable',
    sharp: false,
    reports: 1,
    prescribeIntoRegion: true,
    reason: 'test',
    flag: null,
    ...over,
  }
}

describe('tissueLoadAdjustment', () => {
  test('no niggle changes nothing', () => {
    const adj = tissueLoadAdjustment(null)
    expect(adj.runDurationFactor).toBe(1)
    expect(adj.swapHardDay).toBe(false)
    expect(adj.blockImpact).toBe(false)
    expect(adj.blockedRegions).toEqual([])
  })

  test('monitoring keeps the load but starts the 2–3 day watch', () => {
    const adj = tissueLoadAdjustment(assessment({ level: 'monitor' }))
    expect(adj.runDurationFactor).toBe(1)
    expect(adj.watchDays).toBeGreaterThanOrEqual(2)
    expect(adj.blockImpact).toBe(false)
  })

  test('down-weighting caps running, swaps the hard day and pulls impact', () => {
    const adj = tissueLoadAdjustment(assessment({ level: 'downweight' }))
    expect(adj.runDurationFactor).toBeLessThan(1)
    expect(adj.swapHardDay).toBe(true)
    expect(adj.blockImpact).toBe(true)
    expect(adj.blockedRegions).toEqual([])
  })

  test('escalation closes the region off entirely', () => {
    const adj = tissueLoadAdjustment(
      assessment({ level: 'stop_and_refer', prescribeIntoRegion: false }),
    )
    expect(adj.blockedRegions).toEqual(['ankle_foot'])
    expect(adj.blockImpact).toBe(true)
    expect(adj.runDurationFactor).toBeLessThanOrEqual(0.5)
  })

  test('combining takes the most conservative of several niggles', () => {
    const adj = combineTissueLoad([
      assessment({ level: 'monitor', bodyRegion: 'hip' }),
      assessment({ level: 'stop_and_refer', bodyRegion: 'shin', prescribeIntoRegion: false }),
    ])
    expect(adj.blockedRegions).toEqual(['shin'])
    expect(adj.runDurationFactor).toBeLessThanOrEqual(0.5)
    expect(adj.swapHardDay).toBe(true)
  })

  test('combining nothing is the same as having nothing', () => {
    expect(combineTissueLoad([]).runDurationFactor).toBe(1)
  })
})

// ── Routine dosing ───────────────────────────────────────────────────────────

describe('routinePrehabDose', () => {
  test('returns a small dose, not the whole catalog', () => {
    expect(routinePrehabDose(0)).toHaveLength(3)
  })

  test('rotates so the same tissue is not hit every single day', () => {
    expect(routinePrehabDose(0).map((p) => p.id)).not.toEqual(
      routinePrehabDose(1).map((p) => p.id),
    )
  })

  test('the rotation wraps rather than running out', () => {
    expect(routinePrehabDose(99)).toHaveLength(3)
  })

  test('never reaches into a blocked region', () => {
    const dose = routinePrehabDose(0, ['hip'])
    expect(dose.every((p) => p.bodyRegion !== 'hip')).toBe(true)
  })
})

describe('doseFor', () => {
  test('strengthening gets sets and reps per side', () => {
    const params = doseFor(getPrehab('eccentric-heel-drops')!)
    expect(params.kind).toBe('hold')
    expect(params.reps).toBeGreaterThan(0)
    expect(params.perSide).toBe(true)
    expect(params.holdSec).toBeNull()
  })

  test('stretching gets a hold, not reps', () => {
    const params = doseFor(getPrehab('soleus-stretch')!)
    expect(params.holdSec).toBeGreaterThan(0)
    expect(params.reps).toBeNull()
  })

  test('alternating core work is not dosed per side', () => {
    expect(doseFor(getPrehab('dead-bug')!).perSide).toBe(false)
  })

  test('the whole routine dose stays small enough to be near-free', () => {
    for (const protocol of routinePrehabDose(0)) {
      expect(doseFor(protocol).sets).toBeLessThanOrEqual(3)
    }
  })
})

// ── Prescription ─────────────────────────────────────────────────────────────

describe('prescribePrehab', () => {
  test('with nothing logged it still fits a routine dose', () => {
    const p = prescribePrehab({ assessments: [], band: 'green' })
    expect(p.targeted).toBe(false)
    expect(p.items.length).toBeGreaterThan(0)
    expect(p.flag).toBeNull()
    expect(p.block).toBe('accessory')
  })

  test('a logged ankle niggle inserts the targeted protocol', () => {
    const p = prescribePrehab({
      assessments: [assessment({ level: 'monitor' })],
      band: 'green',
    })
    expect(p.targeted).toBe(true)
    expect(p.items.map((i) => i.ref.id)).toContain('eccentric-heel-drops')
  })

  test('every item slots into the Session object as a HoldParams item', () => {
    const p = prescribePrehab({
      assessments: [assessment({ level: 'downweight' })],
      band: 'green',
    })
    for (const item of p.items) {
      expect(item.ref.kind).toBe('prehab')
      expect(item.status).toBe('prescribed')
      expect(isHoldParams(item.params)).toBe(true)
    }
  })

  test('an escalated niggle stops the app prescribing into that area', () => {
    const p = prescribePrehab({
      assessments: [
        assessment({
          level: 'stop_and_refer',
          prescribeIntoRegion: false,
          flag: 'Please see a professional.',
        }),
      ],
      band: 'green',
    })
    expect(p.targeted).toBe(false)
    expect(p.flag).toMatch(/professional|physio|doctor/i)
    for (const item of p.items) {
      expect(getPrehab(item.ref.id)!.bodyRegion).not.toBe('ankle_foot')
    }
  })

  test('an escalated niggle still leaves the rest of the body trainable', () => {
    const p = prescribePrehab({
      assessments: [
        assessment({ level: 'stop_and_refer', prescribeIntoRegion: false, flag: 'see someone' }),
      ],
      band: 'green',
    })
    expect(p.items.length).toBeGreaterThan(0)
  })

  test('a red day is exactly when prehab is the session', () => {
    const p = prescribePrehab({ assessments: [], band: 'red' })
    expect(p.items.length).toBeGreaterThan(0)
  })

  test('flagged pain takes new strengthening load off the routine dose', () => {
    const p = prescribePrehab({ assessments: [], band: 'amber', painFlagged: true })
    for (const item of p.items) {
      expect(getPrehab(item.ref.id)!.category).not.toBe('strengthen')
    }
  })

  test('the §15 disclaimer is always attached', () => {
    const p = prescribePrehab({ assessments: [], band: 'green' })
    expect(p.disclaimer).toBe(DISCLAIMER)
    expect(p.disclaimer).toMatch(/not medical advice/i)
  })

  test('the adjustment rides along so the run and plyo engines can read it', () => {
    const p = prescribePrehab({
      assessments: [assessment({ level: 'downweight' })],
      band: 'green',
    })
    expect(p.adjustment!.blockImpact).toBe(true)
    expect(p.adjustment!.runDurationFactor).toBeLessThan(1)
  })

  test('the session does not balloon — it is a side dish, not the meal', () => {
    const p = prescribePrehab({
      assessments: [
        assessment({ level: 'downweight', bodyRegion: 'ankle_foot' }),
        assessment({ level: 'monitor', bodyRegion: 'hip' }),
      ],
      band: 'green',
    })
    expect(p.items.length).toBeLessThanOrEqual(5)
  })

  test('no item is repeated', () => {
    const p = prescribePrehab({
      assessments: [assessment({ level: 'monitor' })],
      band: 'green',
    })
    const ids = p.items.map((i) => i.ref.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('item ids are deterministic', () => {
    const args = { assessments: [assessment({ level: 'monitor' })], band: 'green' as const }
    expect(prescribePrehab(args).items.map((i) => i.id)).toEqual(
      prescribePrehab(args).items.map((i) => i.id),
    )
  })
})

// ── No diagnosis language (§15) ──────────────────────────────────────────────

describe('containsDiagnosisLanguage', () => {
  test('catches a named condition', () => {
    expect(containsDiagnosisLanguage('This looks like Achilles tendinopathy.')).toBe(true)
    expect(containsDiagnosisLanguage('Probably shin splints.')).toBe(true)
    expect(containsDiagnosisLanguage('a grade 1 hamstring strain')).toBe(true)
  })

  test('leaves plain anatomical description alone', () => {
    expect(containsDiagnosisLanguage('Your left ankle and foot area has been sore.')).toBe(false)
  })

  test('leaves the required disclaimer alone', () => {
    expect(containsDiagnosisLanguage(DISCLAIMER)).toBe(false)
  })

  test('no engine-generated sentence names a condition', () => {
    const regions: BodyRegion[] = ['ankle_foot', 'shin', 'knee', 'hip', 'hamstring', 'low_back']
    const strings: string[] = [DISCLAIMER]

    for (const region of regions) {
      for (const severity of [2, 5, 8]) {
        for (const days of [0, 5, 12, 20]) {
          for (const quality of ['achy', 'sharp'] as NiggleQuality[]) {
            const a = assessNiggle(
              episode(days, [[0, severity]], { bodyRegion: region, quality }),
              TODAY,
            )
            if (!a) continue
            strings.push(a.reason)
            if (a.flag) strings.push(a.flag)
            strings.push(tissueLoadAdjustment(a).summary)

            const p = prescribePrehab({ assessments: [a], band: 'green' })
            strings.push(p.why)
            if (p.flag) strings.push(p.flag)
            for (const item of p.items) if (item.why) strings.push(item.why)
          }
        }
      }
    }

    const offenders = strings.filter(containsDiagnosisLanguage)
    expect(offenders).toEqual([])
  })
})

// ── Scenario mode (§16) ──────────────────────────────────────────────────────

describe('MOVEMENT_SCENARIO presets drive the prehab engine', () => {
  const scenarios = movementScenarios()

  test('movement_clear: nothing open, nothing to down-weight', () => {
    const assessed = assessNiggles(scenarios.movement_clear.niggles)
    expect(assessed).toEqual([])
    expect(combineTissueLoad(assessed).runDurationFactor).toBe(1)
  })

  test('niggle_achilles: the framework worked example — match, dose, watch', () => {
    const assessed = assessNiggles(scenarios.niggle_achilles.niggles)
    expect(assessed).toHaveLength(1)
    expect(assessed[0].level).toBe('monitor')
    expect(assessed[0].bodyRegion).toBe('ankle_foot')

    const p = prescribePrehab({ assessments: assessed, band: 'green' })
    expect(p.targeted).toBe(true)
    expect(p.items.map((i) => i.ref.id)).toContain('eccentric-heel-drops')
    expect(p.adjustment!.watchDays).toBeGreaterThanOrEqual(2)
  })

  test('niggle_escalating: the trend escalates before the calendar does', () => {
    const assessed = assessNiggles(scenarios.niggle_escalating.niggles)
    expect(assessed[0].trend).toBe('worsening')
    expect(assessed[0].level).toBe('stop_and_refer')
    expect(assessed[0].daysActive).toBeLessThan(ESCALATION_DAYS_WATCH)

    const p = prescribePrehab({ assessments: assessed, band: 'green' })
    expect(p.targeted).toBe(false)
    expect(p.flag).toMatch(/physio|doctor/i)
  })

  test('niggle_lingering: mild and steady, but past the ten-day line', () => {
    const assessed = assessNiggles(scenarios.niggle_lingering.niggles)
    expect(assessed[0].currentSeverity).toBeLessThan(4)
    expect(assessed[0].daysActive).toBeGreaterThanOrEqual(ESCALATION_DAYS_WATCH)
    expect(assessed[0].level).toBe('stop_and_refer')
  })

  test('niggle_sharp: sharp refers immediately whatever the number beside it', () => {
    const assessed = assessNiggles(scenarios.niggle_sharp.niggles)
    expect(assessed[0].currentSeverity).toBeLessThan(SEVERITY_NOT_YET_SEVERE)
    expect(assessed[0].level).toBe('stop_and_refer')
  })

  test('niggle_two_regions: the milder one keeps working, the worse one closes', () => {
    const assessed = assessNiggles(scenarios.niggle_two_regions.niggles)
    expect(assessed).toHaveLength(2)

    const adj = combineTissueLoad(assessed)
    expect(adj.blockedRegions).toEqual(['shin'])
    expect(adj.blockImpact).toBe(true)

    const p = prescribePrehab({ assessments: assessed, band: 'green' })
    expect(p.targeted).toBe(true)
    expect(p.flag).not.toBeNull()
    for (const item of p.items) {
      expect(getPrehab(item.ref.id)!.bodyRegion).not.toBe('shin')
    }
  })
})
