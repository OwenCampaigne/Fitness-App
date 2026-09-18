// ── Prehab engine ─────────────────────────────────────────────────────────────
// Deterministic niggle handling, protocol matching and load down-weighting
// (RUNNING-ON-AI-Framework.md §9, §15). Pure and DB-free.
//
// This is the most medical-adjacent code in the app, so every safety rule here
// is a deterministic branch with a test rather than a line in a prompt (§10).
// Two rules govern everything below:
//
//   1. **No diagnosis language.** The engine describes regions and general
//      protocols. It never names a condition. `containsDiagnosisLanguage` is
//      the executable form of that promise and the tests assert against it.
//   2. **Escalation is terminal.** Sharp, worsening, or past roughly ten days
//      to two weeks and the app stops prescribing into the area entirely and
//      says to see a professional. It does not soften the dose and carry on.

import { differenceInCalendarDays } from 'date-fns'
import {
  CATEGORY_RANK,
  PREHAB,
  REGION_TAGS,
  ROUTINE_PREHAB_IDS,
  getPrehab,
} from './prehab'
import type { BlockKind, HoldParams, SessionItem } from '../types/session'
import type { ReadinessBand } from '../types/readiness'
import type {
  BodyRegion,
  NiggleAssessment,
  NiggleRecord,
  PrehabCategory,
  PrehabExercise,
  PrehabMatch,
  PrehabMatchKind,
  PrehabPrescription,
  SeverityTrend,
  TissueLoadAdjustment,
} from '../types/movement'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Required wording, visible and not buried (§15). */
export const DISCLAIMER =
  'General training and educational information — not medical advice, diagnosis, or treatment. It does not replace a qualified professional.'

/** The "~10–14 days" of §15, split into a warning line and a hard line. */
export const ESCALATION_DAYS_WATCH = 10
export const ESCALATION_DAYS_HARD = 14

/** Severity at or above this is not a niggle any more. */
const SEVERITY_REFER = 7
/** Severity at or above this earns a load down-weight. */
const SEVERITY_DOWNWEIGHT = 4
/** A spike inside the first couple of days is noise, not a trend. */
const TREND_MIN_DAYS = 3

const MAX_TARGETED_ITEMS = 3
const MAX_ITEMS = 5
const ROUTINE_DOSE_SIZE = 3

/** Plain-English region names. Anatomy, never a condition (§15). */
export const REGION_LABELS: Record<BodyRegion, string> = {
  ankle_foot: 'ankle and foot',
  shin: 'shin',
  knee: 'knee',
  hip: 'hip',
  hamstring: 'hamstring',
  low_back: 'low back',
  other: 'the area you logged',
}

function regionPhrase(region: BodyRegion, side: NiggleAssessment['side']): string {
  const label = REGION_LABELS[region]
  if (!side || side === 'both') return label
  return `${side} ${label}`
}

// ── Niggle assessment ─────────────────────────────────────────────────────────

function severityTrend(sorted: NiggleRecord[]): SeverityTrend {
  if (sorted.length < 2) return 'stable'
  const first = sorted[0].severity
  const last = sorted[sorted.length - 1].severity

  if (last >= first + 2) return 'worsening'
  if (last <= first - 2) return 'improving'

  // Three reports climbing in a row is a trend even when each step is small.
  if (sorted.length >= 3) {
    const tail = sorted.slice(-3).map((r) => r.severity)
    if (tail[0] <= tail[1] && tail[1] <= tail[2] && tail[2] > tail[0]) return 'worsening'
  }

  return 'stable'
}

/**
 * Assess one episode — all reports for a single region and side.
 *
 * Returns the escalation level plus everything a screen needs to explain it.
 * `prescribeIntoRegion` is the flag the rest of the engine reads: once it is
 * false, nothing targets that area again until the athlete clears it.
 */
export function assessNiggle(
  reports: NiggleRecord[],
  today: Date = new Date(),
): NiggleAssessment | null {
  if (reports.length === 0) return null

  const sorted = [...reports].sort((a, b) => a.date.getTime() - b.date.getTime())
  const latest = sorted[sorted.length - 1]
  const bodyRegion = latest.bodyRegion
  const side = latest.side
  const where = regionPhrase(bodyRegion, side)

  const firstReportedOn = sorted.reduce(
    (min, r) => (r.firstReportedOn < min ? r.firstReportedOn : min),
    sorted[0].firstReportedOn,
  )
  const daysActive = differenceInCalendarDays(today, firstReportedOn) + 1
  const currentSeverity = latest.severity
  const peakSeverity = Math.max(...sorted.map((r) => r.severity))
  const trend = severityTrend(sorted)
  const sharp = sorted.some((r) => r.quality === 'sharp')

  const base = {
    bodyRegion,
    side,
    daysActive,
    currentSeverity,
    peakSeverity,
    trend,
    sharp,
    reports: sorted.length,
  }

  if (latest.status === 'resolved') {
    return {
      ...base,
      level: 'none',
      prescribeIntoRegion: true,
      reason: `The ${where} is marked resolved — back to normal programming.`,
      flag: null,
    }
  }

  const refer = (reason: string): NiggleAssessment => ({
    ...base,
    level: 'stop_and_refer',
    prescribeIntoRegion: false,
    reason,
    flag: `${reason} This app is not going to keep prescribing into your ${where} — please get it looked at by a physio or doctor.`,
  })

  if (latest.status === 'escalated') {
    return refer(`Your ${where} is already flagged for a professional opinion.`)
  }

  if (sharp) {
    return refer(`You described the ${where} as sharp, and sharp is where this app stops.`)
  }

  if (currentSeverity >= SEVERITY_REFER) {
    return refer(`The ${where} is at ${currentSeverity} out of 10, which is past a niggle.`)
  }

  if (trend === 'worsening' && daysActive >= TREND_MIN_DAYS) {
    return refer(
      `The ${where} has gone from ${sorted[0].severity} to ${currentSeverity} out of 10 over ${daysActive} days — it is heading the wrong way.`,
    )
  }

  if (daysActive >= ESCALATION_DAYS_HARD) {
    return refer(`The ${where} has been going ${daysActive} days without settling.`)
  }

  if (daysActive >= ESCALATION_DAYS_WATCH && trend !== 'improving') {
    return refer(
      `The ${where} has been going ${daysActive} days and is not easing off on its own.`,
    )
  }

  if (daysActive >= ESCALATION_DAYS_WATCH) {
    return {
      ...base,
      level: 'downweight',
      prescribeIntoRegion: true,
      reason: `The ${where} is easing — ${sorted[0].severity} down to ${currentSeverity} out of 10 — but it has been ${daysActive} days.`,
      flag: `Your ${where} is easing, so this keeps going for now. If it is still there at two weeks, that is the point to see someone.`,
    }
  }

  if (currentSeverity >= SEVERITY_DOWNWEIGHT) {
    return {
      ...base,
      level: 'downweight',
      prescribeIntoRegion: true,
      reason: `The ${where} is at ${currentSeverity} out of 10 — enough to take load off it while the targeted work goes in.`,
      flag: null,
    }
  }

  return {
    ...base,
    level: 'monitor',
    prescribeIntoRegion: true,
    reason: `The ${where} is at ${currentSeverity} out of 10 and steady — worth a targeted dose and a couple of days of watching.`,
    flag: null,
  }
}

/**
 * Assess every open episode. Left and right of the same region are separate
 * episodes because they are separate tissues with separate histories.
 */
export function assessNiggles(
  all: NiggleRecord[],
  today: Date = new Date(),
): NiggleAssessment[] {
  const groups = new Map<string, NiggleRecord[]>()
  for (const record of all) {
    const key = `${record.bodyRegion}|${record.side ?? 'none'}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(record)
    else groups.set(key, [record])
  }

  const out: NiggleAssessment[] = []
  // `Array.from` rather than iterating the map directly: the project targets
  // ES5, where a bare `for…of` over a Map iterator needs downlevelIteration.
  for (const reports of Array.from(groups.values())) {
    const assessed = assessNiggle(reports, today)
    if (assessed && assessed.level !== 'none') out.push(assessed)
  }
  return out
}

// ── Matching a niggle to a protocol (§9) ──────────────────────────────────────

const REGION_WEIGHT = 1
const TAG_WEIGHT = 1.5
/** Strengthening is the intervention; the rest support it. */
const CATEGORY_BONUS: Record<PrehabCategory, number> = {
  strengthen: 1,
  stability: 0.5,
  mobility: 0,
  stretch: 0,
}

/**
 * Match a logged region to catalog protocols.
 *
 * Tags weigh more than the region on purpose. The knee is the framework's own
 * example (§9): a knee complaint is answered with hip-abductor work, and a
 * region-first score would never find that. Tags carry the mechanism; the
 * region only says where it hurts.
 */
export function matchPrehab(
  region: BodyRegion,
  tags: string[] = REGION_TAGS[region] ?? [],
  catalog: PrehabExercise[] = PREHAB,
): PrehabMatch[] {
  const tagSet = new Set(tags)
  const catalogIndex = new Map(catalog.map((p, i) => [p.id, i]))
  const matches: PrehabMatch[] = []

  for (const protocol of catalog) {
    const regionHit = protocol.bodyRegion === region
    const tagHits = protocol.niggleTags.filter((t) => tagSet.has(t)).length
    if (!regionHit && tagHits === 0) continue

    const score =
      (regionHit ? REGION_WEIGHT : 0) + tagHits * TAG_WEIGHT + CATEGORY_BONUS[protocol.category]

    const matchedOn: PrehabMatchKind =
      regionHit && tagHits > 0 ? 'region_and_tag' : tagHits > 0 ? 'tag' : 'region'

    matches.push({ protocol, score, matchedOn })
  }

  return matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const rank = CATEGORY_RANK[a.protocol.category] - CATEGORY_RANK[b.protocol.category]
    if (rank !== 0) return rank
    return (catalogIndex.get(a.protocol.id) ?? 0) - (catalogIndex.get(b.protocol.id) ?? 0)
  })
}

// ── Tissue load down-weighting (§9) ───────────────────────────────────────────

const NO_ADJUSTMENT: TissueLoadAdjustment = {
  runDurationFactor: 1,
  swapHardDay: false,
  watchDays: 0,
  blockImpact: false,
  blockedRegions: [],
  summary: 'Nothing logged — the week stands as planned.',
}

/**
 * What a niggle costs the rest of the week. The framework's three levers, in
 * order of how much they hurt: cap running, swap a hard day, watch 2–3 days.
 */
export function tissueLoadAdjustment(
  assessment: NiggleAssessment | null,
): TissueLoadAdjustment {
  if (!assessment || assessment.level === 'none') return { ...NO_ADJUSTMENT }

  const where = regionPhrase(assessment.bodyRegion, assessment.side)

  if (assessment.level === 'stop_and_refer') {
    return {
      runDurationFactor: 0.5,
      swapHardDay: true,
      watchDays: 0,
      blockImpact: true,
      blockedRegions: [assessment.bodyRegion],
      summary: `Running halved and impact work off while your ${where} gets a professional opinion.`,
    }
  }

  if (assessment.level === 'downweight') {
    return {
      runDurationFactor: 0.75,
      swapHardDay: true,
      watchDays: 3,
      blockImpact: true,
      blockedRegions: [],
      summary: `Running capped at 75%, this week's hard day swapped out, and impact work off for 2–3 days while the ${where} settles.`,
    }
  }

  return {
    runDurationFactor: 1,
    swapHardDay: false,
    watchDays: 3,
    blockImpact: false,
    blockedRegions: [],
    summary: `Load stands, but the ${where} gets watched for the next 2–3 days.`,
  }
}

/** Several niggles collapse to the single most conservative posture. */
export function combineTissueLoad(assessments: NiggleAssessment[]): TissueLoadAdjustment {
  if (assessments.length === 0) return { ...NO_ADJUSTMENT }

  const parts = assessments.map(tissueLoadAdjustment)
  const blocked = new Set<BodyRegion>()
  for (const part of parts) for (const r of part.blockedRegions) blocked.add(r)

  const worst = parts.reduce((a, b) => (b.runDurationFactor < a.runDurationFactor ? b : a))

  return {
    runDurationFactor: Math.min(...parts.map((p) => p.runDurationFactor)),
    swapHardDay: parts.some((p) => p.swapHardDay),
    watchDays: Math.max(...parts.map((p) => p.watchDays)),
    blockImpact: parts.some((p) => p.blockImpact),
    blockedRegions: Array.from(blocked),
    summary: worst.summary,
  }
}

// ── Routine prehab — near-free in load terms (§9) ─────────────────────────────

/**
 * A rotating three. Routine prehab earns its place by being cheap enough to fit
 * on almost any day, so the rotation matters more than the selection: the same
 * three every day is how a prehab habit turns into an overuse habit.
 */
export function routinePrehabDose(
  dayIndex = 0,
  blockedRegions: BodyRegion[] = [],
  count = ROUTINE_DOSE_SIZE,
): PrehabExercise[] {
  const pool = ROUTINE_PREHAB_IDS.map((id) => getPrehab(id)).filter(
    (p): p is PrehabExercise => p !== null && !blockedRegions.includes(p.bodyRegion),
  )
  if (pool.length === 0) return []

  const offset = ((dayIndex % pool.length) + pool.length) % pool.length
  const rotated = [...pool.slice(offset), ...pool.slice(0, offset)]
  return rotated.slice(0, Math.min(count, pool.length))
}

// ── Dosing ────────────────────────────────────────────────────────────────────

/** Alternating or bilateral by nature — dosing them "per side" is wrong. */
const BILATERAL_IDS = new Set(['dead-bug', 'bird-dog', 'cat-cow'])

/** Turn a protocol into concrete `HoldParams`, by category. */
export function doseFor(protocol: PrehabExercise): HoldParams {
  const perSide = !BILATERAL_IDS.has(protocol.id)

  switch (protocol.category) {
    case 'strengthen':
      return { kind: 'hold', sets: 3, reps: 12, holdSec: null, perSide }
    case 'stability':
      return { kind: 'hold', sets: 2, reps: 10, holdSec: null, perSide }
    case 'mobility':
      return { kind: 'hold', sets: 1, reps: 10, holdSec: null, perSide }
    case 'stretch':
    default:
      return { kind: 'hold', sets: 2, reps: null, holdSec: 30, perSide }
  }
}

function prehabItem(protocol: PrehabExercise, why: string): SessionItem {
  return {
    id: `prehab-${protocol.id}`,
    ref: { kind: 'prehab', id: protocol.id, name: protocol.name },
    params: doseFor(protocol),
    why,
    status: 'prescribed',
  }
}

// ── Assembling the prescription ───────────────────────────────────────────────

export interface PrescribePrehabInput {
  /** Open episodes, from `assessNiggles`. */
  assessments: NiggleAssessment[]
  band: ReadinessBand
  painFlagged?: boolean
  /** Rotates the routine dose. Day-of-year works; so does a session counter. */
  dayIndex?: number
  maxItems?: number
}

/**
 * Build the prehab block.
 *
 * Targeted work goes in first, routine work fills whatever is left. An escalated
 * region contributes nothing at all — not a gentler version, nothing — and the
 * flag says why. The rest of the body stays trainable, which is the difference
 * between a safety rule and a shutdown.
 */
export function prescribePrehab(input: PrescribePrehabInput): PrehabPrescription {
  const {
    assessments,
    band,
    painFlagged = false,
    dayIndex = 0,
    maxItems = MAX_ITEMS,
  } = input

  const block: BlockKind = 'accessory'
  const adjustment = combineTissueLoad(assessments)
  const blockedRegions = adjustment.blockedRegions

  const chosen: Array<{ protocol: PrehabExercise; why: string }> = []
  const seen = new Set<string>()

  const treatable = assessments.filter((a) => a.prescribeIntoRegion && a.level !== 'none')

  for (const assessed of treatable) {
    const where = regionPhrase(assessed.bodyRegion, assessed.side)
    const matches = matchPrehab(assessed.bodyRegion).filter(
      (m) => !blockedRegions.includes(m.protocol.bodyRegion),
    )
    for (const match of matches.slice(0, MAX_TARGETED_ITEMS)) {
      if (seen.has(match.protocol.id) || chosen.length >= maxItems) continue
      seen.add(match.protocol.id)
      chosen.push({
        protocol: match.protocol,
        why: `Targeted at the ${where} you logged.`,
      })
    }
  }

  const targeted = chosen.length > 0

  if (chosen.length < maxItems) {
    let routine = routinePrehabDose(dayIndex, blockedRegions, PREHAB.length)
    // Flagged pain means no new strengthening load on top of it — the targeted
    // protocol is the exception, because that is the response to the pain.
    if (painFlagged) routine = routine.filter((p) => p.category !== 'strengthen')

    for (const protocol of routine) {
      if (chosen.length >= Math.min(maxItems, targeted ? maxItems : ROUTINE_DOSE_SIZE)) break
      if (seen.has(protocol.id)) continue
      seen.add(protocol.id)
      chosen.push({
        protocol,
        why: 'Routine prehab — cheap enough in load terms to fit on almost any day.',
      })
    }
  }

  const escalated = assessments.filter((a) => a.level === 'stop_and_refer')
  const flag = escalated.length > 0 ? (escalated[0].flag ?? null) : null

  const why = targeted
    ? `${treatable.map((a) => a.reason).join(' ')} ${adjustment.summary}`
    : escalated.length > 0
      ? `${adjustment.summary} Routine work elsewhere carries on as normal.`
      : band === 'red'
        ? 'Red day — routine prehab is the session. It costs almost nothing in recovery terms and still moves something forward.'
        : 'Routine prehab dose — small, rotating, and cheap enough to sit alongside everything else.'

  return {
    items: chosen.map((c) => prehabItem(c.protocol, c.why)),
    block,
    targeted,
    adjustment,
    why,
    flag,
    disclaimer: DISCLAIMER,
  }
}

// ── The no-diagnosis guard (§15) ──────────────────────────────────────────────

/**
 * Condition names the app must never produce. This is a test fixture with a
 * job: the engine's own output is asserted against it, so the rule cannot rot
 * into a comment nobody reads.
 *
 * Note it does *not* include the word "diagnosis" — the required disclaimer
 * uses it, and forbidding it would fail the very text §15 mandates.
 */
const DIAGNOSIS_TERMS = [
  'tendinitis',
  'tendonitis',
  'tendinopathy',
  'tendinosis',
  'fasciitis',
  'shin splints',
  'stress fracture',
  'stress reaction',
  'bursitis',
  'itbs',
  'iliotibial band syndrome',
  "runner's knee",
  "jumper's knee",
  'chondromalacia',
  'patellofemoral',
  'compartment syndrome',
  'neuroma',
  'sprain',
  'strain',
  'tear',
  'rupture',
  'impingement',
  'sciatica',
  'arthritis',
  'bulging disc',
  'herniation',
]

const DIAGNOSIS_PATTERN = new RegExp(
  `\\b(${DIAGNOSIS_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(s|ed|ing)?\\b`,
  'i',
)

export function containsDiagnosisLanguage(text: string): boolean {
  return DIAGNOSIS_PATTERN.test(text)
}
