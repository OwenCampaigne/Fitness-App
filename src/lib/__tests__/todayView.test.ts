import {
  BLOCK_ORDER,
  allItems,
  blockTitle,
  catalogKey,
  buildCatalog,
  buildModifyOp,
  buildStatusOp,
  changedCount,
  changedHeadline,
  countItems,
  defaultLogValues,
  describeLoggedSet,
  diffChangedAnything,
  diffHeadline,
  formatPace,
  formatSeconds,
  groupSetsByItem,
  humanizeToken,
  isLoggable,
  itemNeedsDisclaimer,
  itemProgress,
  logFields,
  needsDisclaimer,
  orderBlocks,
  plannedDurationMin,
  plannedSets,
  prescriptionDetails,
  prescriptionLine,
  previewPatch,
  safeCopy,
  srpeAnchor,
  verdictView,
  visibleFindings,
} from '../todayView'
import type {
  ContactParams,
  HoldParams,
  RunParams,
  SessionBlock,
  SessionItem,
  StrengthParams,
} from '../../types/session'
import type { PatchOp, SessionDiff, ValidationVerdict } from '../../types/patch'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const squatParams: StrengthParams = {
  kind: 'strength',
  sets: 3,
  reps: 8,
  repsMin: 6,
  weightKg: 60,
  targetRir: 2,
  restSec: 180,
}

const runParams: RunParams = {
  kind: 'run',
  runType: 'walk_run',
  durationMin: 40,
  distanceKm: 6.5,
  targetPaceSecPerKm: 330,
  targetHrLow: 130,
  targetHrHigh: 145,
  intervals: [{ repeat: 6, workSec: 180, recoverSec: 60, label: 'jog' }],
}

const plyoParams: ContactParams = { kind: 'contacts', sets: 3, contactsPerSet: 20, restSec: 45 }

const prehabParams: HoldParams = { kind: 'hold', sets: 3, reps: 12, holdSec: null, perSide: true }

const stretchParams: HoldParams = { kind: 'hold', sets: 2, reps: null, holdSec: 30, perSide: false }

function item(id: string, kind: SessionItem['ref']['kind'], params: SessionItem['params']): SessionItem {
  return {
    id,
    ref: { kind, id: `${id}-ref`, name: `${id} name` },
    params,
    status: 'prescribed',
  }
}

const squat = item('squat', 'exercise', squatParams)
const run = item('run', 'run', runParams)
const pogo = item('pogo', 'plyo', plyoParams)
const heelDrop = item('heel', 'prehab', prehabParams)
const calfStretch = item('calf', 'stretch', stretchParams)

function block(kind: SessionBlock['kind'], items: SessionItem[], label = ''): SessionBlock {
  return { id: `b-${kind}`, kind, label, items }
}

const fullSession: SessionBlock[] = [
  block('cooldown', [calfStretch], 'Cool-down'),
  block('main', [run, squat], 'Main'),
  block('warmup', [pogo], 'Warm-up'),
  block('accessory', [heelDrop], 'Accessory'),
]

// ── Ordering ──────────────────────────────────────────────────────────────────

describe('orderBlocks', () => {
  test('returns warmup → main → accessory → cooldown whatever order it is given', () => {
    expect(orderBlocks(fullSession).map((b) => b.kind)).toEqual(BLOCK_ORDER)
  })

  test('drops empty blocks rather than rendering a bare heading', () => {
    const withEmpty = [...fullSession, block('cooldown', [], 'Extra')]
    expect(orderBlocks(withEmpty)).toHaveLength(4)
  })

  test('does not mutate the input array', () => {
    const input = [...fullSession]
    orderBlocks(input)
    expect(input[0].kind).toBe('cooldown')
  })

  test('handles an empty session', () => {
    expect(orderBlocks([])).toEqual([])
  })
})

describe('blockTitle', () => {
  test('prefers the stored label', () => {
    expect(blockTitle({ kind: 'main', label: 'The work' })).toBe('The work')
  })

  test('falls back to a readable name when the label is blank', () => {
    expect(blockTitle({ kind: 'cooldown', label: '   ' })).toBe('Cool-down')
    expect(blockTitle({ kind: 'warmup', label: '' })).toBe('Warm-up')
  })
})

describe('countItems / allItems', () => {
  test('counts across every block', () => {
    expect(countItems(fullSession)).toBe(5)
  })

  test('flattens in training order', () => {
    expect(allItems(fullSession).map((i) => i.id)).toEqual(['pogo', 'run', 'squat', 'heel', 'calf'])
  })
})

// ── Formatting ────────────────────────────────────────────────────────────────

describe('formatPace', () => {
  test('formats seconds per km as a clock', () => {
    expect(formatPace(330)).toBe('5:30 /km')
    expect(formatPace(300)).toBe('5:00 /km')
  })

  test('pads single-digit seconds', () => {
    expect(formatPace(305)).toBe('5:05 /km')
  })

  test('carries rather than printing 5:60', () => {
    expect(formatPace(359.7)).toBe('6:00 /km')
  })

  test('returns null for missing or nonsense values', () => {
    expect(formatPace(null)).toBeNull()
    expect(formatPace(undefined)).toBeNull()
    expect(formatPace(0)).toBeNull()
    expect(formatPace(-10)).toBeNull()
    expect(formatPace(Number.NaN)).toBeNull()
  })
})

describe('formatSeconds', () => {
  test('sub-minute stays in seconds', () => {
    expect(formatSeconds(45)).toBe('45 s')
  })

  test('whole minutes read as minutes', () => {
    expect(formatSeconds(180)).toBe('3 min')
  })

  test('anything else reads as a clock', () => {
    expect(formatSeconds(150)).toBe('2:30')
  })
})

describe('humanizeToken', () => {
  test('turns an engine id into a sentence', () => {
    expect(humanizeToken('walk_run')).toBe('Walk run')
    expect(humanizeToken('long')).toBe('Long')
  })

  test('leaves an empty token alone', () => {
    expect(humanizeToken('')).toBe('')
  })
})

describe('prescriptionLine', () => {
  test('strength shows the rep range, the load and the RIR', () => {
    expect(prescriptionLine(squatParams)).toBe('3 × 6–8 @ 60 kg · RIR 2')
  })

  test('strength collapses the range when there is only one number', () => {
    expect(prescriptionLine({ ...squatParams, repsMin: 8 })).toBe('3 × 8 @ 60 kg · RIR 2')
    expect(prescriptionLine({ ...squatParams, repsMin: undefined })).toBe('3 × 8 @ 60 kg · RIR 2')
  })

  test('a bodyweight lift says so rather than printing a weight', () => {
    expect(prescriptionLine({ ...squatParams, weightKg: null })).toBe(
      '3 × 6–8 bodyweight · RIR 2',
    )
  })

  test('run shows duration, distance and pace', () => {
    expect(prescriptionLine(runParams)).toBe('40 min · 6.5 km · 5:30 /km')
  })

  test('run with nothing concrete falls back to its type', () => {
    expect(prescriptionLine({ kind: 'run', runType: 'easy' })).toBe('Easy')
  })

  test('plyo is dosed in contacts and shows the total', () => {
    expect(prescriptionLine(plyoParams)).toBe('3 × 20 contacts · 60 total')
  })

  test('prehab shows reps and marks per-side work', () => {
    expect(prescriptionLine(prehabParams)).toBe('3 × 12 · each side')
  })

  test('a held stretch shows the hold', () => {
    expect(prescriptionLine(stretchParams)).toBe('2 sets · 30 s hold')
  })

  test('a single set is not pluralised', () => {
    expect(prescriptionLine({ kind: 'hold', sets: 1, reps: null, holdSec: 20 })).toBe(
      '1 set · 20 s hold',
    )
  })
})

describe('prescriptionDetails', () => {
  test('a run carries its heart-rate window and its intervals', () => {
    expect(prescriptionDetails(runParams)).toEqual([
      'Heart rate 130–145 bpm',
      '6 × 3 min / 1 min recover — jog',
    ])
  })

  test('a one-sided heart-rate target reads as a ceiling', () => {
    expect(
      prescriptionDetails({ kind: 'run', runType: 'easy', targetHrHigh: 145 }),
    ).toEqual(['Heart rate under 145 bpm'])
  })

  test('an interval with no recovery does not invent one', () => {
    const details = prescriptionDetails({
      kind: 'run',
      runType: 'strides',
      intervals: [{ repeat: 4, workSec: 20, recoverSec: 0 }],
    })
    expect(details).toEqual(['4 × 20 s'])
  })

  test('rest shows for strength and plyos', () => {
    expect(prescriptionDetails(squatParams)).toEqual(['Rest 3 min'])
    expect(prescriptionDetails(plyoParams)).toEqual(['Rest 45 s between sets'])
  })

  test('nothing to add returns an empty list', () => {
    expect(prescriptionDetails(prehabParams)).toEqual([])
  })
})

// ── Logging ───────────────────────────────────────────────────────────────────

describe('isLoggable', () => {
  test('a run is not logged set by set', () => {
    expect(isLoggable('run')).toBe(false)
  })

  test('everything else is', () => {
    for (const kind of ['exercise', 'plyo', 'prehab', 'stretch'] as const) {
      expect(isLoggable(kind)).toBe(true)
    }
  })
})

describe('plannedSets', () => {
  test('counts the prescribed sets', () => {
    expect(plannedSets(squatParams)).toBe(3)
    expect(plannedSets(plyoParams)).toBe(3)
  })

  test('a run has none', () => {
    expect(plannedSets(runParams)).toBe(0)
  })
})

describe('logFields', () => {
  test('a loaded lift asks for weight, reps and RIR', () => {
    expect(logFields(squatParams)).toEqual(['weightKg', 'reps', 'rir'])
  })

  test('a bodyweight lift drops the weight stepper', () => {
    expect(logFields({ ...squatParams, weightKg: null })).toEqual(['reps', 'rir'])
  })

  test('a plyo is logged in contacts', () => {
    expect(logFields(plyoParams)).toEqual(['contacts'])
  })

  test('a rep-dosed hold drops the hold stepper', () => {
    expect(logFields(prehabParams)).toEqual(['reps'])
  })

  test('a hold-dosed stretch drops the rep stepper', () => {
    expect(logFields(stretchParams)).toEqual(['holdSec'])
  })

  test('a hold with neither still offers something to log', () => {
    expect(logFields({ kind: 'hold', sets: 2 })).toEqual(['reps'])
  })

  test('a run offers nothing', () => {
    expect(logFields(runParams)).toEqual([])
  })
})

describe('defaultLogValues', () => {
  test('opens on what was prescribed', () => {
    expect(defaultLogValues(squatParams)).toEqual({ weightKg: 60, reps: 8, rir: 2 })
  })

  test('a bodyweight lift has no weight to prefill', () => {
    expect(defaultLogValues({ ...squatParams, weightKg: null })).toEqual({ reps: 8, rir: 2 })
  })

  test('a plyo prefills the contacts per set', () => {
    expect(defaultLogValues(plyoParams)).toEqual({ contacts: 20 })
  })

  test('a hold prefills whichever dose it carries', () => {
    expect(defaultLogValues(prehabParams)).toEqual({ reps: 12 })
    expect(defaultLogValues(stretchParams)).toEqual({ holdSec: 30 })
  })

  test('a dose-free hold still gives the logger a number', () => {
    expect(defaultLogValues({ kind: 'hold', sets: 2 })).toEqual({ reps: 1 })
  })
})

describe('itemProgress', () => {
  test('nothing logged is set 1 next', () => {
    expect(itemProgress(squatParams, [])).toEqual({
      done: 0,
      total: 3,
      complete: false,
      nextSetNumber: 1,
    })
  })

  test('counts distinct set numbers, so a correction is not a second set', () => {
    const progress = itemProgress(squatParams, [
      { setNumber: 1 },
      { setNumber: 2 },
      { setNumber: 2 },
    ])
    expect(progress.done).toBe(2)
    expect(progress.nextSetNumber).toBe(3)
    expect(progress.complete).toBe(false)
  })

  test('is complete once every prescribed set is in', () => {
    const progress = itemProgress(squatParams, [
      { setNumber: 1 },
      { setNumber: 2 },
      { setNumber: 3 },
    ])
    expect(progress.complete).toBe(true)
  })

  test('fills a gap before appending', () => {
    expect(itemProgress(squatParams, [{ setNumber: 1 }, { setNumber: 3 }]).nextSetNumber).toBe(2)
  })

  test('a run is never complete by set count', () => {
    expect(itemProgress(runParams, []).complete).toBe(false)
  })
})

describe('describeLoggedSet', () => {
  test('a lift reads back weight, reps and RIR', () => {
    expect(describeLoggedSet(squatParams, { setNumber: 1, weightKg: 60, reps: 8, rir: 2 })).toBe(
      '60 kg × 8 RIR 2',
    )
  })

  test('a plyo reads back contacts', () => {
    expect(describeLoggedSet(plyoParams, { setNumber: 1, contacts: 20 })).toBe('20 contacts')
  })

  test('a hold reads back whichever dose was logged', () => {
    expect(describeLoggedSet(stretchParams, { setNumber: 1, holdSec: 30 })).toBe('30 s')
    expect(describeLoggedSet(prehabParams, { setNumber: 1, reps: 12 })).toBe('12 reps')
  })

  test('an empty set still says something', () => {
    expect(describeLoggedSet(prehabParams, { setNumber: 1 })).toBe('done')
  })
})

describe('groupSetsByItem', () => {
  test('groups by the session item id', () => {
    const grouped = groupSetsByItem([
      { itemId: 'a', setNumber: 1 },
      { itemId: 'a', setNumber: 2 },
      { itemId: 'b', setNumber: 1 },
    ])
    expect(grouped.a).toHaveLength(2)
    expect(grouped.b).toHaveLength(1)
  })

  test('ignores rows with no item id and nothing to match them to', () => {
    expect(groupSetsByItem([{ itemId: null, setNumber: 1 }])).toEqual({})
  })

  test('orders a card’s sets by set number whatever order the rows arrive in', () => {
    const grouped = groupSetsByItem([
      { itemId: 'a', setNumber: 3 },
      { itemId: 'a', setNumber: 1 },
      { itemId: 'a', setNumber: 2 },
    ])
    expect(grouped.a.map((s) => s.setNumber)).toEqual([1, 2, 3])
  })

  // The itemId column post-dates the strength logger. A session with rows must
  // never render as a session with none, so older rows are matched on the
  // library id they do carry.
  test('falls back to exerciseId for rows written before itemId existed', () => {
    const grouped = groupSetsByItem(
      [
        { itemId: null, exerciseId: 'squat-ref', setNumber: 1, weightKg: 60, reps: 8 },
        { itemId: null, exerciseId: 'squat-ref', setNumber: 2, weightKg: 60, reps: 8 },
      ],
      fullSession,
    )
    expect(grouped.squat).toHaveLength(2)
  })

  test('drops a legacy row whose exercise is no longer in the session', () => {
    expect(
      groupSetsByItem([{ itemId: null, exerciseId: 'deadlift-ref', setNumber: 1 }], fullSession),
    ).toEqual({})
  })

  test('prefers the item id when a row has both', () => {
    const grouped = groupSetsByItem(
      [{ itemId: 'heel', exerciseId: 'squat-ref', setNumber: 1 }],
      fullSession,
    )
    expect(grouped.heel).toHaveLength(1)
    expect(grouped.squat).toBeUndefined()
  })

  test('keeps all four loggable kinds apart, and reads each one back in its own units', () => {
    const grouped = groupSetsByItem(
      [
        { itemId: 'squat', exerciseId: 'squat-ref', setNumber: 1, weightKg: 60, reps: 8, rir: 2 },
        { itemId: 'pogo', exerciseId: 'pogo-ref', setNumber: 1, contacts: 20 },
        { itemId: 'heel', exerciseId: 'heel-ref', setNumber: 1, reps: 12 },
        { itemId: 'calf', exerciseId: 'calf-ref', setNumber: 1, holdSec: 30 },
      ],
      fullSession,
    )
    expect(Object.keys(grouped).sort()).toEqual(['calf', 'heel', 'pogo', 'squat'])
    expect(describeLoggedSet(squatParams, grouped.squat[0])).toBe('60 kg × 8 RIR 2')
    expect(describeLoggedSet(plyoParams, grouped.pogo[0])).toBe('20 contacts')
    expect(describeLoggedSet(prehabParams, grouped.heel[0])).toBe('12 reps')
    expect(describeLoggedSet(stretchParams, grouped.calf[0])).toBe('30 s')
    // A run is never grouped here — it has no sets to log (§14 step 6).
    expect(grouped.run).toBeUndefined()
  })

  test('the reload path lands on the same progress as the logging path', () => {
    const rows = [
      { itemId: 'squat', exerciseId: 'squat-ref', setNumber: 1 },
      { itemId: 'squat', exerciseId: 'squat-ref', setNumber: 2 },
    ]
    const grouped = groupSetsByItem(rows, fullSession)
    expect(itemProgress(squatParams, grouped.squat)).toEqual(
      itemProgress(squatParams, rows),
    )
    expect(itemProgress(squatParams, grouped.squat).nextSetNumber).toBe(3)
  })
})

// ── Safety ────────────────────────────────────────────────────────────────────

describe('needsDisclaimer', () => {
  test('prehab on screen means the §15 line has to be on screen', () => {
    expect(needsDisclaimer(fullSession)).toBe(true)
    expect(itemNeedsDisclaimer('prehab')).toBe(true)
  })

  test('a session without prehab does not force it', () => {
    expect(needsDisclaimer([block('main', [squat, run])])).toBe(false)
  })

  test('a stretch is not prehab', () => {
    expect(itemNeedsDisclaimer('stretch')).toBe(false)
  })
})

describe('safeCopy', () => {
  test('passes anatomy through', () => {
    expect(safeCopy('Loads the calf complex through a slow lowering phase.')).toBe(
      'Loads the calf complex through a slow lowering phase.',
    )
  })

  test('drops authored copy that names a condition (§15)', () => {
    expect(safeCopy('The standard protocol for Achilles tendinopathy.')).toBeNull()
    expect(safeCopy('Helps with shin splints.')).toBeNull()
  })

  test('treats blank and missing copy as nothing', () => {
    expect(safeCopy('')).toBeNull()
    expect(safeCopy('   ')).toBeNull()
    expect(safeCopy(null)).toBeNull()
    expect(safeCopy(undefined)).toBeNull()
  })
})

// ── Verdicts ──────────────────────────────────────────────────────────────────

function verdict(over: Partial<ValidationVerdict> = {}): ValidationVerdict {
  return { kind: 'ok', message: 'Applied.', findings: [], ...over }
}

describe('verdictView', () => {
  test('a clean apply is quiet', () => {
    const view = verdictView(verdict(), true)
    expect(view.tone).toBe('ok')
    expect(view.canOverride).toBe(false)
  })

  test('a flag is shown, not swallowed', () => {
    const view = verdictView(
      verdict({
        kind: 'applied_with_flag',
        message: 'That stacks two hard days.',
        findings: [{ rule: 'back_to_back_hard', severity: 'flag', message: 'Two hard days.' }],
      }),
      true,
    )
    expect(view.tone).toBe('flag')
    expect(view.message).toBe('That stacks two hard days.')
    expect(view.findings).toHaveLength(1)
  })

  test('a push-back keeps the override', () => {
    const view = verdictView(
      verdict({
        kind: 'pushed_back',
        message: 'Here is a safer version.',
        findings: [{ rule: 'load_ceiling', severity: 'block', message: 'Over the ceiling.' }],
        counterProposal: { actor: 'coach', ops: [] },
      }),
      false,
    )
    expect(view.tone).toBe('blocked')
    expect(view.canOverride).toBe(true)
    expect(view.hasCounterProposal).toBe(true)
  })

  test('a hard floor offers no override button at all (§15)', () => {
    const view = verdictView(
      verdict({
        kind: 'pushed_back',
        message: 'Not into that tissue.',
        findings: [
          {
            rule: 'niggle_contraindicated',
            severity: 'block',
            message: 'That area is closed.',
            hardFloor: true,
          },
        ],
      }),
      false,
    )
    expect(view.canOverride).toBe(false)
  })
})

describe('visibleFindings', () => {
  test('drops info records, keeps what a person should see', () => {
    const findings = visibleFindings(
      verdict({
        findings: [
          { rule: 'load_ceiling', severity: 'info', message: 'noted' },
          { rule: 'quality_dodging', severity: 'flag', message: 'shown' },
        ],
      }),
    )
    expect(findings.map((f) => f.message)).toEqual(['shown'])
  })
})

// ── Diffs ─────────────────────────────────────────────────────────────────────

function diff(over: Partial<SessionDiff> = {}): SessionDiff {
  return { entries: [], loadBefore: 0, loadAfter: 0, summary: 'nothing to action', ...over }
}

describe('diffHeadline', () => {
  test('an empty diff says nothing to action', () => {
    expect(diffHeadline(diff())).toBe('nothing to action')
    expect(diffChangedAnything(diff())).toBe(false)
  })

  test('counts the changes and shows the load move', () => {
    const d = diff({
      loadBefore: 210,
      loadAfter: 168,
      summary: '2 changed',
      entries: [
        { op: 'modify', itemId: 'a', name: 'A', blockKind: 'main', before: 'x', after: 'y', reason: 'r' },
        { op: 'remove', itemId: 'b', name: 'B', blockKind: 'main', before: 'x', after: null, reason: 'r' },
      ],
    })
    expect(diffHeadline(d)).toBe('2 changes · load 210 → 168')
    expect(diffChangedAnything(d)).toBe(true)
  })

  test('a single change is singular, and an unchanged load is not printed', () => {
    const d = diff({
      loadBefore: 100,
      loadAfter: 100,
      entries: [
        { op: 'modify', itemId: 'a', name: 'A', blockKind: 'main', before: 'x', after: 'y', reason: 'r' },
      ],
    })
    expect(diffHeadline(d)).toBe('1 change')
  })
})

describe('previewPatch', () => {
  test('a modify shows the prescription before and after', () => {
    const ops: PatchOp[] = [
      { op: 'modify', itemId: 'squat', params: { kind: 'strength', sets: 2 }, reason: 'Feeling flat' },
    ]
    expect(previewPatch(fullSession, ops)).toEqual([
      {
        op: 'modify',
        itemId: 'squat',
        name: 'squat name',
        before: '3 × 6–8 @ 60 kg · RIR 2',
        after: '2 × 6–8 @ 60 kg · RIR 2',
        reason: 'Feeling flat',
      },
    ])
  })

  test('a remove has a before and no after', () => {
    const [entry] = previewPatch(fullSession, [
      { op: 'remove', itemId: 'pogo', reason: 'Calf is sore' },
    ])
    expect(entry.before).toBe('3 × 20 contacts · 60 total')
    expect(entry.after).toBeNull()
  })

  test('an add has an after and no before', () => {
    const [entry] = previewPatch(fullSession, [
      { op: 'add', blockKind: 'accessory', item: calfStretch, reason: 'Extra mobility' },
    ])
    expect(entry.before).toBeNull()
    expect(entry.after).toBe('2 sets · 30 s hold')
  })

  test('a replace names both sides of the swap', () => {
    const [entry] = previewPatch(fullSession, [
      { op: 'replace', itemId: 'squat', item: calfStretch, reason: 'Gentler on the knee' },
    ])
    expect(entry.name).toBe('squat name → calf name')
    expect(entry.before).toBe('3 × 6–8 @ 60 kg · RIR 2')
    expect(entry.after).toBe('2 sets · 30 s hold')
  })

  test('a reorder describes the block, not an item', () => {
    const [entry] = previewPatch(fullSession, [
      { op: 'reorder', blockKind: 'main', itemIds: ['squat', 'run'], reason: 'Lift first' },
    ])
    expect(entry.op).toBe('reorder')
    expect(entry.after).toBe('squat name → run name')
  })

  test('an op against an item that is no longer there still renders', () => {
    const [entry] = previewPatch(fullSession, [{ op: 'remove', itemId: 'ghost', reason: 'r' }])
    expect(entry.name).toBe('ghost')
    expect(entry.before).toBeNull()
  })
})

// ── Building ops ──────────────────────────────────────────────────────────────

describe('buildModifyOp', () => {
  test('sends only the fields that actually moved', () => {
    const op = buildModifyOp(squat, { kind: 'strength', sets: 2, reps: 8 } as never, 'Shorter today')
    expect(op).toEqual({
      op: 'modify',
      itemId: 'squat',
      params: { kind: 'strength', sets: 2 },
      reason: 'Shorter today',
    })
  })

  test('returns null when nothing changed, so no empty patch is posted', () => {
    expect(buildModifyOp(squat, { kind: 'strength', sets: 3 } as never, 'r')).toBeNull()
  })

  test('keeps the kind so the validator can refuse a kind change', () => {
    const op = buildModifyOp(pogo, { kind: 'contacts', contactsPerSet: 10 } as never, 'r')
    expect(op?.params).toEqual({ kind: 'contacts', contactsPerSet: 10 })
  })

  test('a null weight is a real change, not an absent one', () => {
    const op = buildModifyOp(squat, { kind: 'strength', weightKg: null } as never, 'r')
    expect(op?.params).toEqual({ kind: 'strength', weightKg: null })
  })
})

describe('buildStatusOp', () => {
  test('builds a reversible skip', () => {
    expect(buildStatusOp(squat, 'skipped', 'Knee grumbled')).toEqual({
      op: 'modify',
      itemId: 'squat',
      status: 'skipped',
      reason: 'Knee grumbled',
    })
  })

  test('is a no-op when it is already in that state', () => {
    expect(buildStatusOp({ ...squat, status: 'skipped' }, 'skipped', 'r')).toBeNull()
  })
})

// ── Changed vs plan ───────────────────────────────────────────────────────────

describe('changedHeadline', () => {
  test('nothing changed says exactly that (§14)', () => {
    expect(changedHeadline(null)).toBe('nothing to action')
    expect(changedHeadline({ changed: false, summary: '', entries: [] })).toBe('nothing to action')
    expect(changedCount(null)).toBe(0)
  })

  test('a change carries the engine summary', () => {
    const changed = {
      changed: true,
      summary: '1 dropped, 1 trimmed',
      entries: [
        { itemId: 'a', name: 'A', reason: 'r', outcome: 'rejected', code: 'load_ceiling' },
        { itemId: 'b', name: 'B', reason: 'r', outcome: 'trimmed', code: 'budget' },
      ],
    }
    expect(changedHeadline(changed)).toBe('1 dropped, 1 trimmed')
    expect(changedCount(changed)).toBe(2)
  })

  test('a change with no summary still says how many', () => {
    expect(
      changedHeadline({
        changed: true,
        summary: '',
        entries: [{ itemId: 'a', name: 'A', reason: 'r', outcome: 'rejected', code: 'c' }],
      }),
    ).toBe('1 changed')
  })
})

// ── Completion ────────────────────────────────────────────────────────────────

describe('plannedDurationMin', () => {
  test('a run contributes its own minutes', () => {
    expect(plannedDurationMin([block('main', [run])])).toBe(40)
  })

  test('sets are estimated rather than left at zero', () => {
    expect(plannedDurationMin([block('main', [squat])])).toBe(6)
  })

  test('an empty session is zero, not NaN', () => {
    expect(plannedDurationMin([])).toBe(0)
  })
})

// ── The catalog ───────────────────────────────────────────────────────────────

describe('buildCatalog', () => {
  const catalog = buildCatalog({
    lifts: [
      {
        id: 'back-squat',
        name: 'Back squat',
        runnerRationale: 'Builds the single-leg strength a stride is made of.',
        microStepKg: 1.25,
        bodyweight: false,
      },
    ],
    plyos: [{ id: 'pogo-jumps', name: 'Pogo jumps', target: 'ankle stiffness', muscleText: 'calves' }],
    prehab: [
      {
        id: 'heel-drops',
        name: 'Eccentric heel drops',
        targetTissue: 'calf and Achilles tendon',
        muscleText: 'gastrocnemius, soleus',
        rationale: 'The standard loading protocol for Achilles tendinopathy.',
      },
      {
        id: 'glute-bridge',
        name: 'Glute bridge',
        targetTissue: 'gluteus maximus',
        rationale: 'Loads the hip extensors through a short range.',
      },
    ],
    stretches: [{ id: 'calf-stretch', name: 'Calf stretch', target: 'calves' }],
  })

  test('keys by kind and library id so two libraries cannot collide', () => {
    expect(catalog[catalogKey('exercise', 'back-squat')].name).toBe('Back squat')
    expect(catalog[catalogKey('plyo', 'pogo-jumps')].name).toBe('Pogo jumps')
    expect(catalog[catalogKey('prehab', 'heel-drops')].name).toBe('Eccentric heel drops')
    expect(catalog[catalogKey('stretch', 'calf-stretch')].name).toBe('Calf stretch')
  })

  test('carries the load step a lift needs for its stepper', () => {
    expect(catalog[catalogKey('exercise', 'back-squat')].stepKg).toBe(1.25)
  })

  test('defaults the load step rather than leaving it undefined', () => {
    const minimal = buildCatalog({ lifts: [{ id: 'x', name: 'X' }] })
    expect(minimal[catalogKey('exercise', 'x')].stepKg).toBe(2.5)
  })

  test('drops prehab copy that names a condition, keeping the anatomy (§15)', () => {
    const entry = catalog[catalogKey('prehab', 'heel-drops')]
    expect(entry.note).toBeNull()
    expect(entry.targetTissue).toBe('calf and Achilles tendon')
    expect(entry.muscleText).toBe('gastrocnemius, soleus')
  })

  test('keeps prehab copy that does not', () => {
    expect(catalog[catalogKey('prehab', 'glute-bridge')].note).toBe(
      'Loads the hip extensors through a short range.',
    )
  })

  test('an empty source set builds an empty catalog rather than throwing', () => {
    expect(buildCatalog({})).toEqual({})
  })
})

describe('srpeAnchor', () => {
  test('names each rung of the scale', () => {
    expect(srpeAnchor(0)).toBe('nothing')
    expect(srpeAnchor(3)).toBe('very easy')
    expect(srpeAnchor(4)).toBe('moderate')
    expect(srpeAnchor(7)).toBe('hard')
    expect(srpeAnchor(10)).toBe('maximal')
  })
})
