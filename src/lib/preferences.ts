// ── Preference learning ───────────────────────────────────────────────────────
// Framework §13. Two streams into `preferences`, and the difference between
// them is the whole design:
//
//   · **Explicit rules** — "no weights on weekends", "long run Sunday", "rest
//     Monday", "no doubles" — are hard constraints. You said them; they bind.
//   · **Inferred patterns** — read out of `edit_history` and
//     `decision_log.was_followed` — are *never* applied silently. Each one
//     carries a confidence, the evidence it was drawn from, and a confirmed
//     flag that starts false. An unconfirmed inference cannot produce a binding
//     rule; that is enforced by `bindingEffect` below rather than by anyone
//     remembering to check.
//
// Everything that reasons is pure and takes its rows as arguments, so an
// inference can be asserted against literals. The DB half at the bottom only
// reads and writes.
//
// `activePreferenceRules` is the road into the allocator: `gatherToday` hands
// it the rows and the date, so a day-scoped rule binds on the day it names and
// on no other. `todaySession.toPreferenceRule` — which this file does not own —
// is the date-blind fallback for a structured row this module did not write,
// and it binds only on an `effect` of `exclude` or `deprioritize`. That is what
// makes the §13 invariant structural rather than a flag someone has to
// remember: `bindingEffect` serializes everything day-scoped or unconfirmed
// with the inert `suggest`, so neither path can produce a binding rule out of
// one. It stays visible everywhere and inert in the allocator.
//
// ── The third stream: what you said in passing ────────────────────────────────
//
// A preference is also stated sideways, mid-conversation with the coach — "no
// weights on weekends, by the way" — and the whole difficulty is that **a
// preference stated once is not true forever.** "No weights on weekends" was
// true in March and may be wrong by September, and a library that silently
// overwrote the old rule would have thrown away the only evidence that the
// athlete ever changed their mind.
//
// So supersession is first-class, not an update:
//
//   · `scope` + `subject` are the edges of the graph. Two rules about weekend
//     lifting share the subject `strength:weekends` whichever way they point,
//     so the later one *retires* the earlier rather than stacking beside it.
//   · retiring writes `active = false` and `supersededById`, and keeps the row.
//     History stays queryable and dated; nothing is ever deleted by a new
//     statement.
//   · supersession fires on **confirmation**, never on extraction, because the
//     statement is the athlete's but the reading of it is the model's. The
//     athlete sees what a new rule would retire before it retires anything.
//   · rules whose subjects merely *overlap* — "no lifting at weekends" against
//     "I lift on Saturdays" — are not the same subject, so they are surfaced as
//     a conflict rather than quietly stacked (`findPreferenceConflicts`).
//
// A chat-extracted rule is therefore stored unconfirmed, which `bindingEffect`
// already serializes to the inert `suggest`: the §13 machinery needed nothing
// new to keep it out of the allocator.

import { startOfDay } from 'date-fns'
import { prisma } from './db'
import type { Modality, PreferenceRule } from './allocator'
import type { SessionBlock } from '../types/session'

// ── The vocabulary ────────────────────────────────────────────────────────────

export type PreferenceKind =
  // explicit
  | 'no_modality_on_days'
  | 'no_modality'
  | 'modality_on_day'
  | 'rest_on_day'
  | 'no_doubles'
  // explicit, about one movement rather than a whole modality
  | 'no_exercise'
  // stated but untypeable — visible to the coach, binding on nothing
  | 'note'
  // inferred (§13's three named patterns)
  | 'deprioritize_day_modality'
  | 'tighten_easy_ceiling'
  | 'preempt_after_short_sleep'

export type PreferenceSource = 'explicit' | 'inferred'

/** What the allocator's parser will accept; `suggest` is deliberately inert. */
export type PreferenceEffect = 'exclude' | 'deprioritize' | 'suggest'

/**
 * The coarse half of a graph edge: which part of training the rule speaks about.
 * Grouping on screen, and the first half of the supersession key.
 */
export type PreferenceScope = 'schedule' | 'modality' | 'exercise' | 'intensity' | 'other'

export interface PreferenceDraft {
  kind: PreferenceKind
  source: PreferenceSource
  label: string
  confidence: number
  /** False until the athlete says yes. Inferred rules start here (§13). */
  confirmed: boolean
  /** Days of the week it applies on, 0 = Sunday. Absent means every day. */
  days?: number[]
  modality?: Modality
  runTypes?: string[]
  /** The single movement a `no_exercise` rule refuses, normalized. */
  exercise?: string
  /** What a `note` is about, when nothing else can type it. */
  topic?: string
  /** How much stricter, for `tighten_easy_ceiling` — bpm off the Z2 ceiling. */
  tightenBpm?: number
  /** Hours below which `preempt_after_short_sleep` fires. */
  sleepHoursThreshold?: number
  /** The rows this was drawn from, in words. §13: keep inference legible. */
  evidence?: string[]
  sampleSize?: number
  /** The athlete's own words, verbatim, when this came out of a conversation. */
  sourceQuote?: string
  /** When they said it. The date a retired rule is remembered by. */
  statedOn?: Date | null
}

export interface StoredPreference extends PreferenceDraft {
  id: number
  weight: number
  /**
   * False once something newer on the same subject replaced it. Optional, and
   * absent reads as active — every row `parseStoredPreference` builds sets it,
   * so only a hand-written literal can leave it out, and `false` is the only
   * value any caller is allowed to act on.
   */
  active?: boolean
  /** The rule that retired this one, when one did. */
  supersededById?: number | null
  confirmedAt?: Date | null
  lastAppliedOn?: Date | null
  /** Last write. On a retired row this is the day it stopped being true. */
  updatedAt?: Date | null
}

const MODALITIES: Modality[] = ['run', 'strength', 'plyo', 'prehab', 'stretch']
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ── Explicit rules, from a sentence ───────────────────────────────────────────

const MODALITY_WORDS: Array<[RegExp, Modality]> = [
  [/\b(weights?|lift(ing|s)?|strength|gym|squats?|resistance)\b/i, 'strength'],
  [/\b(plyos?|plyometrics?|jumps?|bounding|hops?)\b/i, 'plyo'],
  [/\b(prehab|rehab|physio|pt work)\b/i, 'prehab'],
  [/\b(stretch(ing|es)?|mobility)\b/i, 'stretch'],
  [/\b(runs?|running|jogs?)\b/i, 'run'],
]

const DAY_WORDS: Array<[RegExp, number[]]> = [
  [/\bweekends?\b/i, [0, 6]],
  [/\bweekdays?\b/i, [1, 2, 3, 4, 5]],
  [/\bsundays?\b/i, [0]],
  [/\bmondays?\b/i, [1]],
  [/\btuesdays?\b/i, [2]],
  [/\bwednesdays?\b/i, [3]],
  [/\bthursdays?\b/i, [4]],
  [/\bfridays?\b/i, [5]],
  [/\bsaturdays?\b/i, [6]],
]

function matchModality(text: string): Modality | null {
  for (const [pattern, modality] of MODALITY_WORDS) if (pattern.test(text)) return modality
  return null
}

function matchDays(text: string): number[] | null {
  for (const [pattern, days] of DAY_WORDS) if (pattern.test(text)) return days
  return null
}

/**
 * The movement named at the end of a refusal — "stop giving me burpees".
 *
 * Anchored to the end of the sentence and capped at a few words, because the
 * alternative is storing half a paragraph as an exercise name and then matching
 * session items against it. Singularized so "burpees" and "burpee" are one
 * subject rather than two rules that never notice each other.
 */
export function matchExercise(text: string): string | null {
  const m = text.match(
    /\b(?:no more|no|stop (?:giving|prescribing) me|stop|never give me|don'?t give me|do not give me|avoid|skip)\s+(?:any\s+|more\s+)?([a-z][a-z' -]{2,40}?)\s*[.!]?$/i,
  )
  if (!m) return null
  const raw = m[1].trim().toLowerCase().replace(/\s+/g, ' ')
  if (raw.length < 3) return null
  // A preposition means the tail is a clause, not a movement name.
  if (/\b(on|in|at|for|until|after|before|when|this|next)\b/.test(raw)) return null
  return raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw
}

export function describeDays(days: number[]): string {
  if (days.length === 7) return 'every day'
  if (days.length === 2 && days.includes(0) && days.includes(6)) return 'weekends'
  if (days.length === 5 && !days.includes(0) && !days.includes(6)) return 'weekdays'
  return days.map((d) => WEEKDAY_NAMES[d] ?? '?').join(' and ')
}

/**
 * A typed rule from the athlete's own words, or nothing.
 *
 * Deliberately narrow. §13's examples are the shapes this understands, and a
 * sentence it cannot parse is returned as `null` rather than approximated — a
 * mis-parsed preference silently deletes work the athlete wanted, which is a
 * worse failure than "I did not understand that, say it another way".
 */
export function parseExplicitRule(text: string): PreferenceDraft | null {
  const trimmed = text.trim()
  if (trimmed.length === 0 || trimmed.length > 300) return null

  if (/\bno\b[^.]*\bdoubles?\b/i.test(trimmed)) {
    return {
      kind: 'no_doubles',
      source: 'explicit',
      label: 'No doubles — one session a day.',
      confidence: 1,
      confirmed: true,
    }
  }

  const days = matchDays(trimmed)
  const modality = matchModality(trimmed)
  const negated = /\b(no|never|don'?t|do not|avoid|skip)\b/i.test(trimmed)
  const restOnly = /\b(rest|off|nothing|day off)\b/i.test(trimmed)

  if (restOnly && days && !modality) {
    return {
      kind: 'rest_on_day',
      source: 'explicit',
      label: `Rest on ${describeDays(days)}.`,
      confidence: 1,
      confirmed: true,
      days,
    }
  }

  if (negated && modality) {
    if (days) {
      return {
        kind: 'no_modality_on_days',
        source: 'explicit',
        label: `No ${modality} on ${describeDays(days)}.`,
        confidence: 1,
        confirmed: true,
        days,
        modality,
      }
    }
    return {
      kind: 'no_modality',
      source: 'explicit',
      label: `No ${modality}, any day.`,
      confidence: 1,
      confirmed: true,
      modality,
    }
  }

  // "stop giving me burpees" — one movement, not a modality. Deliberately last
  // of the negations and anchored to the end of the sentence, so anything the
  // modality vocabulary above already understands never reaches it.
  // (`matchExercise` carries its own refusal vocabulary — "stop giving me …"
  // is a negation the coarse `negated` test above does not know about.)
  if (!modality && !days) {
    const named = matchExercise(trimmed)
    if (named) {
      return {
        kind: 'no_exercise',
        source: 'explicit',
        label: `No ${named}.`,
        confidence: 1,
        confirmed: true,
        exercise: named,
      }
    }
  }

  // "long run Sunday" — a placement, not an exclusion.
  const longRun = /\blong run\b/i.test(trimmed)
  if (days && (longRun || modality)) {
    const what = longRun ? 'Long run' : `${modality} work`
    return {
      kind: 'modality_on_day',
      source: 'explicit',
      label: `${what} on ${describeDays(days)}.`,
      confidence: 1,
      confirmed: true,
      days,
      modality: longRun ? 'run' : (modality ?? undefined),
      ...(longRun ? { runTypes: ['long'] } : {}),
    }
  }

  return null
}

export function describePreference(pref: PreferenceDraft): string {
  return pref.label
}

// ── Serialization ─────────────────────────────────────────────────────────────

/**
 * What `effect` this rule is stored with — and therefore whether the allocator
 * will act on it at all.
 *
 * `suggest` is the inert value. Everything day-scoped gets it, because the
 * stored row has no idea what day it is and a rule that applies on Saturdays
 * must not quietly apply on Tuesdays. Everything unconfirmed gets it, because
 * §13 says an inference is surfaced for confirmation, not applied.
 */
export function bindingEffect(pref: PreferenceDraft): PreferenceEffect {
  if (!pref.confirmed) return 'suggest'
  if (pref.days && pref.days.length > 0) return 'suggest'
  if (pref.kind === 'no_modality' && pref.modality) return 'exclude'
  return 'suggest'
}

// ── The graph: scope and subject ──────────────────────────────────────────────
// Two rules are about *the same thing* when they share a scope and a subject,
// and that is the only relation supersession needs. Both are derived from the
// rule's own shape rather than read back from the columns, so an old row
// written before the columns existed sits in the graph correctly and a stored
// value can never drift from what the rule actually says.

const SCOPE_OF_KIND: Record<PreferenceKind, PreferenceScope> = {
  no_modality_on_days: 'schedule',
  modality_on_day: 'schedule',
  rest_on_day: 'schedule',
  no_doubles: 'schedule',
  deprioritize_day_modality: 'schedule',
  no_modality: 'modality',
  no_exercise: 'exercise',
  tighten_easy_ceiling: 'intensity',
  preempt_after_short_sleep: 'intensity',
  note: 'other',
}

export function preferenceScope(pref: PreferenceDraft): PreferenceScope {
  return SCOPE_OF_KIND[pref.kind] ?? 'other'
}

/** A stable slug for the days a rule names. `every` when it names none. */
function dayTag(days: number[] | undefined): string {
  if (!days || days.length === 0) return 'every'
  return describeDays(days).toLowerCase().replace(/\s+/g, '_')
}

/**
 * What the rule is about, as one string.
 *
 * Polarity is deliberately *not* part of it: "no weights on weekends" and "I
 * lift at weekends now" are the same subject pointing opposite ways, which is
 * exactly the pair that must supersede rather than coexist.
 */
export function preferenceSubject(pref: PreferenceDraft): string {
  switch (pref.kind) {
    case 'no_modality':
      return `${pref.modality ?? 'unknown'}:every`
    case 'no_modality_on_days':
    case 'modality_on_day':
    case 'deprioritize_day_modality':
      return `${pref.modality ?? 'unknown'}:${dayTag(pref.days)}`
    case 'rest_on_day':
      return `rest:${dayTag(pref.days)}`
    case 'no_doubles':
      return 'doubles'
    case 'no_exercise':
      return `exercise:${pref.exercise ?? 'unknown'}`
    case 'tighten_easy_ceiling':
      return 'easy_ceiling'
    case 'preempt_after_short_sleep':
      return 'quality_after_short_sleep'
    case 'note':
      return `note:${(pref.topic ?? pref.label).toLowerCase().slice(0, 60)}`
  }
}

/** The graph edge, both halves. What supersession compares. */
export function preferenceEdge(pref: PreferenceDraft): string {
  return `${preferenceScope(pref)}/${preferenceSubject(pref)}`
}

export function serializePreference(pref: PreferenceDraft): string {
  return JSON.stringify({
    // The first three keys are the shape `todaySession.toPreferenceRule` reads.
    label: pref.label,
    effect: bindingEffect(pref),
    match: pref.modality ? { modality: pref.modality } : {},
    // Everything below is this module's own vocabulary; that parser ignores it.
    kind: pref.kind,
    confirmed: pref.confirmed,
    ...(pref.days ? { days: pref.days } : {}),
    ...(pref.runTypes ? { runTypes: pref.runTypes } : {}),
    ...(pref.exercise ? { exercise: pref.exercise } : {}),
    ...(pref.topic ? { topic: pref.topic } : {}),
    ...(pref.tightenBpm !== undefined ? { tightenBpm: pref.tightenBpm } : {}),
    ...(pref.sleepHoursThreshold !== undefined
      ? { sleepHoursThreshold: pref.sleepHoursThreshold }
      : {}),
    ...(pref.evidence ? { evidence: pref.evidence } : {}),
    ...(pref.sampleSize !== undefined ? { sampleSize: pref.sampleSize } : {}),
  })
}

export interface PreferenceRow {
  id: number
  rule: string
  source: string
  confidence: number
  weight: number
  // The graph columns. Optional because a row written before they existed is
  // still a valid preference — `active` absent reads as active, and the edge is
  // re-derived from the rule either way.
  active?: boolean | null
  supersededById?: number | null
  sourceQuote?: string | null
  statedOn?: Date | string | null
  confirmedAt?: Date | string | null
  lastAppliedOn?: Date | string | null
  updatedAt?: Date | string | null
}

const KINDS: PreferenceKind[] = [
  'no_modality_on_days',
  'no_modality',
  'modality_on_day',
  'rest_on_day',
  'no_doubles',
  'no_exercise',
  'note',
  'deprioritize_day_modality',
  'tighten_easy_ceiling',
  'preempt_after_short_sleep',
]

function asDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** A row this module did not write parses to `null` rather than a guess. */
export function parseStoredPreference(row: PreferenceRow): StoredPreference | null {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(row.rule) as Record<string, unknown>
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const kind = parsed.kind
  if (typeof kind !== 'string' || !KINDS.includes(kind as PreferenceKind)) return null
  const label = typeof parsed.label === 'string' ? parsed.label : kind

  const modality = MODALITIES.includes(parsed.modality as Modality)
    ? (parsed.modality as Modality)
    : MODALITIES.includes((parsed.match as { modality?: Modality } | undefined)?.modality as Modality)
      ? ((parsed.match as { modality: Modality }).modality)
      : undefined

  const days = Array.isArray(parsed.days)
    ? parsed.days.filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
    : undefined

  return {
    id: row.id,
    kind: kind as PreferenceKind,
    source: row.source === 'explicit' ? 'explicit' : 'inferred',
    label,
    confidence: row.confidence,
    weight: row.weight,
    confirmed: parsed.confirmed === true,
    active: row.active !== false,
    supersededById: row.supersededById ?? null,
    confirmedAt: asDate(row.confirmedAt),
    lastAppliedOn: asDate(row.lastAppliedOn),
    updatedAt: asDate(row.updatedAt),
    ...(typeof row.sourceQuote === 'string' ? { sourceQuote: row.sourceQuote } : {}),
    ...(asDate(row.statedOn) ? { statedOn: asDate(row.statedOn) } : {}),
    ...(typeof parsed.exercise === 'string' ? { exercise: parsed.exercise } : {}),
    ...(typeof parsed.topic === 'string' ? { topic: parsed.topic } : {}),
    ...(days && days.length > 0 ? { days } : {}),
    ...(modality ? { modality } : {}),
    ...(Array.isArray(parsed.runTypes)
      ? { runTypes: parsed.runTypes.filter((r): r is string => typeof r === 'string') }
      : {}),
    ...(typeof parsed.tightenBpm === 'number' ? { tightenBpm: parsed.tightenBpm } : {}),
    ...(typeof parsed.sleepHoursThreshold === 'number'
      ? { sleepHoursThreshold: parsed.sleepHoursThreshold }
      : {}),
    ...(Array.isArray(parsed.evidence)
      ? { evidence: parsed.evidence.filter((e): e is string => typeof e === 'string') }
      : {}),
    ...(typeof parsed.sampleSize === 'number' ? { sampleSize: parsed.sampleSize } : {}),
  }
}

// ── Resolving for a day ───────────────────────────────────────────────────────

/**
 * The rules that bind today, in the allocator's own shape.
 *
 * Three filters, all load-bearing: a retired rule never appears here however it
 * reached this list, an unconfirmed inference never appears here (§13), and a
 * day-scoped rule only appears on the days it names. This is the function a
 * caller with a date should use in preference to reading rows.
 */
export function activePreferenceRules(prefs: StoredPreference[], date: Date): PreferenceRule[] {
  const weekday = startOfDay(date).getDay()
  const out: PreferenceRule[] = []

  for (const pref of prefs) {
    // Superseded means "was true once". The history screen shows it; the day
    // is built as though it had never been said.
    if (pref.active === false) continue
    if (!pref.confirmed) continue
    if (pref.days && pref.days.length > 0 && !pref.days.includes(weekday)) continue

    if (pref.kind === 'rest_on_day') {
      // Rest means every modality is off, not just one.
      for (const modality of MODALITIES) {
        if (modality === 'prehab' || modality === 'stretch') continue
        out.push({
          id: `${pref.id}-${modality}`,
          label: pref.label,
          source: pref.source,
          confidence: pref.confidence,
          effect: 'exclude',
          match: { modality },
        })
      }
      continue
    }

    if (
      (pref.kind === 'no_modality' || pref.kind === 'no_modality_on_days') &&
      pref.modality
    ) {
      out.push({
        id: String(pref.id),
        label: pref.label,
        source: pref.source,
        confidence: pref.confidence,
        effect: 'exclude',
        match: { modality: pref.modality },
      })
      continue
    }

    if (pref.kind === 'deprioritize_day_modality' && pref.modality) {
      out.push({
        id: String(pref.id),
        label: pref.label,
        source: pref.source,
        confidence: pref.confidence,
        effect: 'deprioritize',
        match: { modality: pref.modality },
      })
    }
  }

  return out
}

// ── Hard constraints, checked against a session ───────────────────────────────

export interface PreferenceViolation {
  preferenceId: string
  label: string
  itemId: string
  itemName: string
  message: string
}

/**
 * Does this item's name contain the movement the athlete refused?
 *
 * Word-boundary containment, singular-insensitive: "Burpee box jump" is a
 * burpee. Loose in the safe direction — the cost of a false positive is the
 * coach being asked for something else, the cost of a false negative is the
 * athlete being handed the one thing they said not to.
 */
export function namesExercise(itemName: string, exercise: string): boolean {
  const name = itemName.toLowerCase()
  const term = exercise.toLowerCase()
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}s?\\b`).test(name)
}

/** Item kind → modality. The session carries the kind; the rules speak modality. */
function modalityOfKind(kind: string): Modality | null {
  if (kind === 'run') return 'run'
  if (kind === 'exercise') return 'strength'
  if (kind === 'plyo') return 'plyo'
  if (kind === 'prehab') return 'prehab'
  if (kind === 'stretch') return 'stretch'
  return null
}

/**
 * Explicit rules as a gate on a proposed session (§13: they are constraints).
 *
 * Used on the coach path, where a model that has been *told* the preferences
 * can still propose work that breaks one. Inferred rules never appear here even
 * when confirmed — a learned lean is a lean, and only something the athlete
 * said outright is allowed to refuse work.
 */
export function checkPreferenceViolations(
  prefs: StoredPreference[],
  date: Date,
  blocks: SessionBlock[],
): PreferenceViolation[] {
  const weekday = startOfDay(date).getDay()
  const violations: PreferenceViolation[] = []

  for (const pref of prefs) {
    if (pref.active === false) continue
    if (pref.source !== 'explicit' || !pref.confirmed) continue
    if (pref.days && pref.days.length > 0 && !pref.days.includes(weekday)) continue

    // A named movement is the one rule the allocator cannot express — there is
    // no `PreferenceRule` for "not burpees" — so it is enforced here, on the
    // coach's proposal, where the item names actually exist.
    if (pref.kind === 'no_exercise' && pref.exercise) {
      for (const block of blocks) {
        for (const item of block.items) {
          if (!namesExercise(item.ref.name, pref.exercise)) continue
          violations.push({
            preferenceId: String(pref.id),
            label: pref.label,
            itemId: item.id,
            itemName: item.ref.name,
            message: `${item.ref.name} breaks your own rule: ${pref.label}`,
          })
        }
      }
      continue
    }

    const excluded: Modality[] =
      pref.kind === 'rest_on_day'
        ? ['run', 'strength', 'plyo']
        : (pref.kind === 'no_modality' || pref.kind === 'no_modality_on_days') && pref.modality
          ? [pref.modality]
          : []

    if (excluded.length === 0) continue

    for (const block of blocks) {
      for (const item of block.items) {
        const modality = modalityOfKind(item.ref.kind)
        if (!modality || !excluded.includes(modality)) continue
        violations.push({
          preferenceId: String(pref.id),
          label: pref.label,
          itemId: item.id,
          itemName: item.ref.name,
          message: `${item.ref.name} breaks your own rule: ${pref.label}`,
        })
      }
    }
  }

  return violations
}

// ── Contradictions the graph cannot resolve ───────────────────────────────────
// Supersession handles the clean case: same subject, later statement wins. What
// it cannot handle is a *partial* overlap — "no lifting at weekends" against "I
// lift on Saturdays" are different subjects that disagree about one day, so
// neither retires the other and both are true as written.
//
// The system does not pick a winner. Guessing which of two things the athlete
// said is the real one is precisely the silent overwrite this whole module
// exists to avoid, so the pair is surfaced and the athlete retires one.

export interface PreferenceConflict {
  aId: number
  bId: number
  aLabel: string
  bLabel: string
  /** The days both rules speak to, which is where they actually disagree. */
  overlapDays: number[]
  reason: string
}

/** Positive rules ask for work; negative rules refuse it. Neutral ones neither. */
function polarity(pref: StoredPreference): 'positive' | 'negative' | 'neutral' {
  if (pref.kind === 'modality_on_day') return 'positive'
  if (
    pref.kind === 'no_modality' ||
    pref.kind === 'no_modality_on_days' ||
    pref.kind === 'rest_on_day' ||
    pref.kind === 'no_exercise' ||
    pref.kind === 'no_doubles' ||
    pref.kind === 'deprioritize_day_modality'
  ) {
    return 'negative'
  }
  return 'neutral'
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

function daysOf(pref: StoredPreference): number[] {
  return pref.days && pref.days.length > 0 ? pref.days : EVERY_DAY
}

/** `rest_on_day` speaks for every modality at once; everything else names one. */
function touchesModality(pref: StoredPreference, modality: Modality): boolean {
  if (pref.kind === 'rest_on_day') return modality !== 'prehab' && modality !== 'stretch'
  return pref.modality === modality
}

/**
 * Active rules that disagree, as pairs.
 *
 * Only across-polarity pairs on an overlapping modality and an overlapping set
 * of days — everything else is two rules about different things. Same-subject
 * pairs cannot appear: supersession already retired one of them, so if a pair
 * turns up here it genuinely is a new disagreement.
 */
export function findPreferenceConflicts(prefs: StoredPreference[]): PreferenceConflict[] {
  const live = prefs.filter((p) => p.active !== false && p.confirmed)
  const out: PreferenceConflict[] = []

  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]
      const b = live[j]
      if (polarity(a) === polarity(b)) continue
      if (polarity(a) === 'neutral' || polarity(b) === 'neutral') continue
      if (preferenceEdge(a) === preferenceEdge(b)) continue

      const positive = polarity(a) === 'positive' ? a : b
      const negative = positive === a ? b : a
      if (!positive.modality) continue
      if (!touchesModality(negative, positive.modality)) continue

      const overlapDays = daysOf(a).filter((d) => daysOf(b).includes(d))
      if (overlapDays.length === 0) continue

      out.push({
        aId: a.id,
        bId: b.id,
        aLabel: a.label,
        bLabel: b.label,
        overlapDays,
        reason: `These two disagree about ${describeDays(overlapDays)}. Retire whichever is no longer true.`,
      })
    }
  }

  return out
}

// ── Inference (§13) ───────────────────────────────────────────────────────────
// Three patterns, the three the framework names. Each is a pure function over
// rows, each reports the evidence it used, and none of them writes anything
// that binds — `confirmed` comes back false and only the athlete flips it.

/** Below this there is no pattern, only a coincidence. */
export const MIN_SAMPLE = 3
/** The rate at which "sometimes" becomes "usually". */
export const PATTERN_RATE = 0.6
/** Sample size at which the confidence multiplier reaches 1. */
export const CONFIDENT_SAMPLE = 8
const MAX_CONFIDENCE = 0.95
const MIN_CONFIDENCE = 0.1

/**
 * Confidence as a number the athlete can argue with: how often it happened,
 * damped by how little we have seen. Shown on screen next to the rule (§13).
 */
export function confidenceFrom(hits: number, sample: number): number {
  if (sample <= 0) return 0
  const rate = hits / sample
  const damping = Math.min(1, sample / CONFIDENT_SAMPLE)
  return Math.round(Math.min(MAX_CONFIDENCE, Math.max(MIN_CONFIDENCE, rate * damping)) * 100) / 100
}

export interface EditObservation {
  date: Date
  modality: Modality
  itemName: string
  runType: string | null
  /** True when this edit removed the item or cut it materially. */
  droppedOrSoftened: boolean
  /** Hours slept the night before, when the row exists. */
  sleepHours: number | null
}

export interface DecisionObservation {
  date: Date
  prescribedModalities: Modality[]
  prescribedRunTypes: string[]
  sleepHours: number | null
  wasFollowed: boolean | null
}

export interface EasyRunObservation {
  date: Date
  avgHr: number
  /** The Z2 ceiling that run was prescribed against. */
  z2CeilingHr: number
}

export interface InferenceInput {
  edits: EditObservation[]
  decisions: DecisionObservation[]
  easyRuns: EasyRunObservation[]
  /** Below this, sleep counts as short (§13's "<6h"). */
  shortSleepHours?: number
}

const SHORT_SLEEP_HOURS = 6
const QUALITY_RUN_TYPES = new Set(['vo2', 'intervals', 'tempo', 'threshold', 'hills'])

function dayKey(date: Date): number {
  return startOfDay(date).getTime()
}

function isoDay(date: Date): string {
  return startOfDay(date).toISOString().slice(0, 10)
}

/**
 * "Skipping Friday lifts lowers Friday priority."
 *
 * Counted per weekday and modality: how often the day prescribed it against how
 * often an edit took it away. The denominator comes from `decision_log` rather
 * than from the edits themselves — otherwise a modality that is never
 * prescribed and never skipped would look like a 0/0 pattern.
 */
export function inferSkippedWeekdayModality(input: InferenceInput): PreferenceDraft[] {
  const prescribed = new Map<string, number>()
  const dropped = new Map<string, Set<number>>()
  const drafts: PreferenceDraft[] = []

  for (const decision of input.decisions) {
    const weekday = startOfDay(decision.date).getDay()
    for (const modality of Array.from(new Set(decision.prescribedModalities))) {
      const key = `${weekday}|${modality}`
      prescribed.set(key, (prescribed.get(key) ?? 0) + 1)
    }
  }

  for (const edit of input.edits) {
    if (!edit.droppedOrSoftened) continue
    const weekday = startOfDay(edit.date).getDay()
    const key = `${weekday}|${edit.modality}`
    // A day counts once however many items that day's edit removed.
    const set = dropped.get(key) ?? new Set<number>()
    set.add(dayKey(edit.date))
    dropped.set(key, set)
  }

  for (const [key, total] of Array.from(prescribed.entries())) {
    if (total < MIN_SAMPLE) continue
    const hits = dropped.get(key)?.size ?? 0
    if (hits / total < PATTERN_RATE) continue

    const [weekdayRaw, modalityRaw] = key.split('|')
    const weekday = Number(weekdayRaw)
    const modality = modalityRaw as Modality
    const dayName = WEEKDAY_NAMES[weekday]

    drafts.push({
      kind: 'deprioritize_day_modality',
      source: 'inferred',
      confirmed: false,
      confidence: confidenceFrom(hits, total),
      label: `${dayName} ${modality} work keeps getting dropped — lower its priority on ${dayName}s?`,
      days: [weekday],
      modality,
      sampleSize: total,
      evidence: [
        `${hits} of the last ${total} ${dayName}s that prescribed ${modality} work had it edited away.`,
        ...Array.from(dropped.get(key) ?? [])
          .sort((a, b) => b - a)
          .slice(0, 4)
          .map((t) => `dropped on ${isoDay(new Date(t))}`),
      ],
    })
  }

  return drafts
}

/**
 * "'Easy' runs drifting hot get stricter."
 *
 * The correction is on the *prescription*, not on the athlete: if easy runs
 * keep coming in above the ceiling they were given, the ceiling that gets
 * prescribed comes down, so "easy" starts meaning easy again (§5b, §21's 80/20
 * warning in the other direction).
 */
export function inferEasyRunDrift(input: InferenceInput): PreferenceDraft[] {
  const runs = input.easyRuns.filter((r) => r.avgHr > 0 && r.z2CeilingHr > 0)
  if (runs.length < MIN_SAMPLE) return []

  const hot = runs.filter((r) => r.avgHr > r.z2CeilingHr)
  if (hot.length / runs.length < PATTERN_RATE) return []

  const meanOvershoot =
    hot.reduce((sum, r) => sum + (r.avgHr - r.z2CeilingHr), 0) / hot.length
  const tightenBpm = Math.max(1, Math.round(meanOvershoot))

  return [
    {
      kind: 'tighten_easy_ceiling',
      source: 'inferred',
      confirmed: false,
      confidence: confidenceFrom(hot.length, runs.length),
      label: `Easy runs keep drifting about ${tightenBpm} bpm hot — prescribe them ${tightenBpm} bpm stricter?`,
      runTypes: ['easy', 'recovery'],
      tightenBpm,
      sampleSize: runs.length,
      evidence: [
        `${hot.length} of the last ${runs.length} easy runs finished above their Z2 ceiling.`,
        ...hot
          .slice(-4)
          .map(
            (r) =>
              `${isoDay(r.date)}: ${Math.round(r.avgHr)} bpm against a ${Math.round(r.z2CeilingHr)} bpm ceiling.`,
          ),
      ],
    },
  ]
}

/**
 * "Always swapping VO₂ after <6h sleep — pre-empt it."
 *
 * The most useful of the three, because it is the one that stops a bad session
 * being prescribed at all rather than correcting it after the fact.
 */
export function inferQualitySwapAfterShortSleep(input: InferenceInput): PreferenceDraft[] {
  const threshold = input.shortSleepHours ?? SHORT_SLEEP_HOURS

  const shortSleepQualityDays = input.decisions.filter(
    (d) =>
      d.sleepHours !== null &&
      d.sleepHours < threshold &&
      d.prescribedRunTypes.some((t) => QUALITY_RUN_TYPES.has(t)),
  )
  if (shortSleepQualityDays.length < MIN_SAMPLE) return []

  const swappedDays = new Set<number>()
  for (const edit of input.edits) {
    if (!edit.droppedOrSoftened) continue
    if (edit.modality !== 'run') continue
    if (!edit.runType || !QUALITY_RUN_TYPES.has(edit.runType)) continue
    if (edit.sleepHours === null || edit.sleepHours >= threshold) continue
    swappedDays.add(dayKey(edit.date))
  }

  const hits = shortSleepQualityDays.filter((d) => swappedDays.has(dayKey(d.date))).length
  if (hits / shortSleepQualityDays.length < PATTERN_RATE) return []

  return [
    {
      kind: 'preempt_after_short_sleep',
      source: 'inferred',
      confirmed: false,
      confidence: confidenceFrom(hits, shortSleepQualityDays.length),
      label: `Hard runs get swapped out after a short night — stop prescribing them on under ${threshold} hours?`,
      runTypes: Array.from(QUALITY_RUN_TYPES),
      sleepHoursThreshold: threshold,
      sampleSize: shortSleepQualityDays.length,
      evidence: [
        `${hits} of the last ${shortSleepQualityDays.length} quality runs prescribed after under ${threshold} hours' sleep were edited away.`,
        ...Array.from(swappedDays)
          .sort((a, b) => b - a)
          .slice(0, 4)
          .map((t) => `swapped on ${isoDay(new Date(t))}`),
      ],
    },
  ]
}

/** All three, newest evidence first. Nothing here binds until confirmed (§13). */
export function inferPreferences(input: InferenceInput): PreferenceDraft[] {
  return [
    ...inferSkippedWeekdayModality(input),
    ...inferEasyRunDrift(input),
    ...inferQualitySwapAfterShortSleep(input),
  ]
}

/**
 * The stable identity of a rule, so re-running inference updates the pending
 * suggestion rather than piling up a new one every night.
 */
export function preferenceKey(pref: PreferenceDraft): string {
  return [
    pref.kind,
    pref.modality ?? '',
    (pref.days ?? []).join('.'),
    (pref.runTypes ?? []).join('.'),
  ].join('|')
}

// ── Turning stored rows into observations ─────────────────────────────────────
// The inference functions above take clean, typed observations. These build
// them, and they are pure too — the DB reads are the four `findMany` calls in
// `gatherInferenceInput` and nothing else.

/** The blocks `decision_log.recommendedSessionJson` wraps. */
export interface DecisionLogRow {
  date: Date | string
  recommendedSessionJson: string
  wasFollowed: boolean | null
}

export interface RecommendedItem {
  itemId: string
  kind: string
  name: string
  runType: string | null
  targetHrHigh: number | null
}

/** What the engine proposed that day, flattened. A corrupt blob yields nothing. */
export function parseRecommendedItems(json: string): RecommendedItem[] {
  try {
    const parsed = JSON.parse(json) as {
      blocks?: Array<{
        items?: Array<{
          id?: string
          ref?: { kind?: string; name?: string }
          params?: { kind?: string; runType?: string; targetHrHigh?: number | null }
        }>
      }>
    }
    const out: RecommendedItem[] = []
    for (const block of parsed.blocks ?? []) {
      for (const item of block.items ?? []) {
        if (!item?.id || !item.ref?.kind) continue
        out.push({
          itemId: item.id,
          kind: item.ref.kind,
          name: item.ref.name ?? item.id,
          runType: item.params?.kind === 'run' ? (item.params.runType ?? null) : null,
          targetHrHigh: item.params?.kind === 'run' ? (item.params.targetHrHigh ?? null) : null,
        })
      }
    }
    return out
  } catch {
    return []
  }
}

export function modalityOfItemKind(kind: string): Modality | null {
  return modalityOfKind(kind)
}

/** An edit diff entry, as `edit_history.diffJson` stores it. */
export interface DiffEntryRow {
  op: string
  itemId: string
  name: string
  before: string | null
  after: string | null
}

/**
 * Did this entry take the work away?
 *
 * A removal obviously did. A modify counts only when the prescription actually
 * shrank — trading three sets for four is an adjustment, not a dodge — which is
 * read off the rendered `before`/`after` rather than re-deriving the cost,
 * because the cost function is not what `edit_history` stored.
 */
export function entryDroppedOrSoftened(entry: DiffEntryRow): boolean {
  if (entry.op === 'remove') return true
  if (entry.op === 'replace') return true
  if (entry.op !== 'modify') return false
  if (entry.before === null || entry.after === null) return false
  const beforeTotal = numericTotal(entry.before)
  const afterTotal = numericTotal(entry.after)
  if (beforeTotal === null || afterTotal === null) return false
  return afterTotal < beforeTotal
}

/** Every number in a prescription string, summed. Crude, but comparable. */
function numericTotal(text: string): number | null {
  const matches = text.match(/\d+(\.\d+)?/g)
  if (!matches) return null
  return matches.reduce((sum, m) => sum + Number(m), 0)
}

export interface EditHistoryJoinedRow {
  date: Date | string
  actor: string
  entries: DiffEntryRow[]
}

export interface SleepRow {
  date: Date | string
  sleepHours: number | null
}

export interface ActivityRow {
  date: Date | string
  type: string
  avgHr: number | null
}

export interface RawSignals {
  decisions: DecisionLogRow[]
  edits: EditHistoryJoinedRow[]
  sleep: SleepRow[]
  activities: ActivityRow[]
}

/**
 * Rows → observations, with no database in sight.
 *
 * Deliberately the only place that knows how the three tables relate, so the
 * inference functions stay assertable against literals and this join is itself
 * testable against literals.
 */
export function buildInferenceInput(raw: RawSignals): InferenceInput {
  const sleepByDay = new Map<number, number | null>()
  for (const row of raw.sleep) {
    sleepByDay.set(dayKey(new Date(row.date)), row.sleepHours)
  }

  const itemsByDay = new Map<number, RecommendedItem[]>()
  const decisions: DecisionObservation[] = raw.decisions.map((row) => {
    const date = startOfDay(new Date(row.date))
    const items = parseRecommendedItems(row.recommendedSessionJson)
    itemsByDay.set(dayKey(date), items)
    const modalities = items
      .map((i) => modalityOfKind(i.kind))
      .filter((m): m is Modality => m !== null)
    return {
      date,
      prescribedModalities: modalities,
      prescribedRunTypes: items.map((i) => i.runType).filter((t): t is string => t !== null),
      sleepHours: sleepByDay.get(dayKey(date)) ?? null,
      wasFollowed: row.wasFollowed,
    }
  })

  const edits: EditObservation[] = []
  for (const row of raw.edits) {
    // The engine's own changes are not the athlete's preference (§13 learns
    // from *your* edits), so only user and coach edits count as signal.
    if (row.actor !== 'user' && row.actor !== 'coach') continue
    const date = startOfDay(new Date(row.date))
    const items = itemsByDay.get(dayKey(date)) ?? []
    const byId = new Map(items.map((i) => [i.itemId, i]))

    for (const entry of row.entries) {
      const item = byId.get(entry.itemId)
      const modality = item ? modalityOfKind(item.kind) : null
      if (!modality) continue
      edits.push({
        date,
        modality,
        itemName: entry.name,
        runType: item?.runType ?? null,
        droppedOrSoftened: entryDroppedOrSoftened(entry),
        sleepHours: sleepByDay.get(dayKey(date)) ?? null,
      })
    }
  }

  const easyRuns: EasyRunObservation[] = []
  for (const activity of raw.activities) {
    const date = startOfDay(new Date(activity.date))
    if (activity.avgHr == null || activity.avgHr <= 0) continue
    const prescribed = (itemsByDay.get(dayKey(date)) ?? []).find(
      (i) => i.runType === 'easy' || i.runType === 'recovery',
    )
    // No prescribed ceiling means no drift to measure — an unprescribed run is
    // not evidence that "easy" is being prescribed too fast.
    if (!prescribed?.targetHrHigh) continue
    easyRuns.push({ date, avgHr: activity.avgHr, z2CeilingHr: prescribed.targetHrHigh })
  }

  return { decisions, edits, easyRuns }
}

// ── The DB half ───────────────────────────────────────────────────────────────

/** How far back inference looks. Long enough for a weekday pattern to exist. */
export const INFERENCE_WINDOW_DAYS = 56

/** Read the four tables §13 learns from, and reduce them to observations. */
export async function gatherInferenceInput(today = new Date()): Promise<InferenceInput> {
  const start = startOfDay(today)
  const since = new Date(start.getTime() - INFERENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const [decisions, sessions, sleep, activities] = await Promise.all([
    prisma.decision_log.findMany({ where: { date: { gte: since } }, orderBy: { date: 'asc' } }),
    prisma.session.findMany({ where: { date: { gte: since } } }),
    prisma.readiness_daily.findMany({ where: { date: { gte: since } } }),
    prisma.activities.findMany({ where: { date: { gte: since }, type: 'running' } }),
  ])

  const sessionDateById = new Map<number, Date>(
    sessions.map((s) => [s.id, startOfDay(new Date(s.date))]),
  )

  const historyRows = await prisma.edit_history.findMany({
    where: { sessionId: { in: Array.from(sessionDateById.keys()) } },
    orderBy: { id: 'asc' },
  })

  const edits: EditHistoryJoinedRow[] = historyRows.map((row) => {
    let entries: DiffEntryRow[] = []
    try {
      const record = JSON.parse(row.diffJson) as { diff?: { entries?: DiffEntryRow[] } }
      entries = Array.isArray(record.diff?.entries) ? record.diff!.entries! : []
    } catch {
      entries = []
    }
    return {
      date: sessionDateById.get(row.sessionId) ?? new Date(row.timestamp),
      actor: row.actor,
      entries,
    }
  })

  return buildInferenceInput({
    decisions: decisions as DecisionLogRow[],
    edits,
    sleep: sleep as SleepRow[],
    activities: activities as ActivityRow[],
  })
}

/** Every row, retired ones included. The history screen and de-duplication. */
export async function readAllPreferences(): Promise<StoredPreference[]> {
  const rows = await prisma.preferences.findMany({ orderBy: { id: 'asc' } })
  return (rows as PreferenceRow[])
    .map(parseStoredPreference)
    .filter((p): p is StoredPreference => p !== null)
}

/**
 * The live rules. Filtered in the query, not after it, so a caller that forgets
 * `active` cannot accidentally hand a retired rule to the allocator.
 */
export async function readPreferences(): Promise<StoredPreference[]> {
  const rows = await prisma.preferences.findMany({
    where: { active: true },
    orderBy: { id: 'asc' },
  })
  return (rows as PreferenceRow[])
    .map(parseStoredPreference)
    .filter((p): p is StoredPreference => p !== null)
}

/** Retired rules, newest first — what you used to believe, and when. */
export async function readPreferenceHistory(): Promise<StoredPreference[]> {
  const rows = await prisma.preferences.findMany({
    where: { active: false },
    orderBy: { updatedAt: 'desc' },
  })
  return (rows as PreferenceRow[])
    .map(parseStoredPreference)
    .filter((p): p is StoredPreference => p !== null)
}

/**
 * Retire every live rule that speaks to the same subject as `pref`.
 *
 * The heart of the graph. It runs at the moment a rule becomes binding — never
 * at the moment one is merely proposed — and it *retires* rather than deletes:
 * the row keeps its text, its quote and its date, and gains a pointer to what
 * replaced it. Asked in six months why weekend lifting came back, the answer is
 * still in the table.
 */
export async function supersedeSameSubject(pref: StoredPreference): Promise<StoredPreference[]> {
  const edge = preferenceEdge(pref)
  const live = await readPreferences()
  const retired: StoredPreference[] = []

  for (const other of live) {
    if (other.id === pref.id) continue
    if (preferenceEdge(other) !== edge) continue
    const row = await prisma.preferences.update({
      where: { id: other.id },
      data: { active: false, supersededById: pref.id, weight: 0 },
    })
    const parsed = parseStoredPreference(row as PreferenceRow)
    if (parsed) retired.push(parsed)
  }

  return retired
}

export interface PreferenceWrite {
  preference: StoredPreference
  superseded: StoredPreference[]
}

export async function addExplicitPreference(
  text: string,
  statedOn: Date = new Date(),
): Promise<PreferenceWrite | null> {
  const draft = parseExplicitRule(text)
  if (!draft) return null

  const existing = await readPreferences()
  const key = preferenceKey(draft)
  const match = existing.find((p) => preferenceKey(p) === key)
  if (match) return { preference: match, superseded: [] }

  const row = await prisma.preferences.create({
    data: {
      rule: serializePreference(draft),
      source: 'explicit',
      confidence: draft.confidence,
      weight: 1,
      scope: preferenceScope(draft),
      subject: preferenceSubject(draft),
      statedOn: startOfDay(statedOn),
      confirmedAt: new Date(),
      active: true,
    },
  })
  const created = parseStoredPreference(row as PreferenceRow)
  if (!created) return null
  // Typed by hand into the rule box, so it binds at once (§13) — and binding is
  // exactly when anything it contradicts has to step aside.
  return { preference: created, superseded: await supersedeSameSubject(created) }
}

// ── Stated in conversation ────────────────────────────────────────────────────

export interface StatedPreference {
  /** The rule in one sentence, as the model normalized it. */
  statement: string
  /** The athlete's own words, verbatim. Never paraphrased. */
  quote: string
  /** Only used when `statement` is not a rule this app can type. */
  topic?: string
}

export type StatedOutcome =
  | { status: 'stored'; preference: StoredPreference; wouldSupersede: StoredPreference[] }
  | { status: 'restated'; preference: StoredPreference }
  | { status: 'unparsed'; statement: string }

/**
 * A preference the athlete stated mid-conversation, stored but **not binding**.
 *
 * The deliberate choice (§13). A rule typed into the rule box binds at once,
 * because the athlete chose the words *and* chose to make them a rule. A rule
 * pulled out of a sentence aimed at something else was only half chosen: the
 * words are theirs, the reading of them as a standing rule is the model's. Two
 * things follow from letting the model's half bind immediately, and both are
 * bad — a passing remark starts refusing work, and, worse, it silently retires
 * a rule the athlete *did* choose, because supersession fires on binding.
 *
 * So it is stored unconfirmed, and the §13 machinery needs nothing new to keep
 * it inert: `bindingEffect` sees `confirmed: false` and serializes the inert
 * `suggest`, which `toPreferenceRule` parses to `null`, and
 * `activePreferenceRules` drops it before that ever matters. The guarantee is
 * in the parsers, not in remembering to pass a flag.
 *
 * What it is *not* is invisible. It appears on `/preferences` the moment it is
 * said, with the quote it came from and a note of what confirming it would
 * retire, and it goes into the coach's contract as a non-binding preference —
 * so the coach reads it back on the very next turn.
 */
export async function recordStatedPreference(
  stated: StatedPreference,
  statedOn: Date = new Date(),
): Promise<StatedOutcome> {
  const parsed = parseExplicitRule(stated.statement)
  const draft: PreferenceDraft | null = parsed
    ? { ...parsed, confirmed: false }
    : stated.topic
      ? {
          kind: 'note',
          source: 'explicit',
          label: stated.statement,
          confidence: 1,
          confirmed: false,
          topic: stated.topic,
        }
      : null

  // Never coerced. A statement this app cannot type is reported as unparsed and
  // nothing is written — a mis-typed preference deletes work the athlete wanted.
  if (!draft) return { status: 'unparsed', statement: stated.statement }

  draft.sourceQuote = stated.quote
  draft.statedOn = startOfDay(statedOn)

  const edge = preferenceEdge(draft)
  const live = await readPreferences()
  const key = preferenceKey(draft)

  // Saying the same thing twice is one preference said twice. Re-stating it
  // refreshes the date and the quote rather than queueing a second question.
  const same = live.find((p) => preferenceKey(p) === key)
  if (same) {
    const row = await prisma.preferences.update({
      where: { id: same.id },
      data: { sourceQuote: stated.quote, statedOn: startOfDay(statedOn) },
    })
    const refreshed = parseStoredPreference(row as PreferenceRow)
    return { status: 'restated', preference: refreshed ?? same }
  }

  const row = await prisma.preferences.create({
    data: {
      rule: serializePreference(draft),
      source: 'explicit',
      confidence: draft.confidence,
      // Worth nothing until confirmed — visible in the list, inert in the day.
      weight: 0,
      scope: preferenceScope(draft),
      subject: preferenceSubject(draft),
      sourceQuote: stated.quote,
      statedOn: startOfDay(statedOn),
      active: true,
    },
  })
  const created = parseStoredPreference(row as PreferenceRow)
  if (!created) return { status: 'unparsed', statement: stated.statement }

  return {
    status: 'stored',
    preference: created,
    // What confirming this would retire, shown before it retires anything.
    wouldSupersede: live.filter((p) => p.confirmed && preferenceEdge(p) === edge),
  }
}

/**
 * Persist what the coach heard, and never let that failure reach the athlete.
 *
 * The extraction rides along on the edit request (§11-A), so it has to be
 * incapable of breaking one: the whole write is swallowed here, and a caller
 * that gets `[]` back cannot tell a silent database failure from a turn in
 * which nobody stated a preference. That is the correct trade — an edit that
 * would otherwise apply must not be lost because a side-channel write failed.
 */
export async function captureStatedPreferences(
  stated: StatedPreference[],
  statedOn: Date = new Date(),
): Promise<StatedOutcome[]> {
  const out: StatedOutcome[] = []
  for (const one of stated) {
    try {
      out.push(await recordStatedPreference(one, statedOn))
    } catch (err) {
      console.error('[preferences] capture failed:', err instanceof Error ? err.message : String(err))
    }
  }
  return out
}

/** Retire a rule the athlete says is no longer true. Kept, not deleted. */
export async function retirePreference(id: number): Promise<StoredPreference | null> {
  const row = await prisma.preferences.findUnique({ where: { id } })
  if (!row) return null
  const updated = await prisma.preferences.update({
    where: { id },
    data: { active: false, weight: 0 },
  })
  return parseStoredPreference(updated as PreferenceRow)
}

/**
 * Persist the pending inferences, without ever letting one bind.
 *
 * A draft comes back from `inferPreferences` with `confirmed: false`, which
 * `bindingEffect` turns into the inert `suggest` effect, which the allocator's
 * parser drops. So the worst case of a bad inference is a suggestion the
 * athlete says no to — never a session that quietly changed shape.
 */
export async function syncInferredPreferences(
  drafts: PreferenceDraft[],
): Promise<StoredPreference[]> {
  // Every row, retired ones included: an inference whose rule the athlete
  // already retired must not be quietly re-created by tonight's job.
  const existing = await readAllPreferences()
  const byKey = new Map(existing.map((p) => [preferenceKey(p), p]))
  const out: StoredPreference[] = []

  for (const draft of drafts) {
    const match = byKey.get(preferenceKey(draft))
    // Retired is an answer too. Re-running the job must not resurrect a rule
    // the athlete has since replaced or retired by hand.
    if (match && match.active === false) continue
    // An inference the athlete already answered stays answered; re-running the
    // job must not re-ask a question that was settled.
    if (match?.confirmed) {
      out.push(match)
      continue
    }
    if (match) {
      const row = await prisma.preferences.update({
        where: { id: match.id },
        data: { rule: serializePreference(draft), confidence: draft.confidence, weight: 0 },
      })
      const parsed = parseStoredPreference(row as PreferenceRow)
      if (parsed) out.push(parsed)
      continue
    }
    const row = await prisma.preferences.create({
      data: {
        rule: serializePreference(draft),
        source: 'inferred',
        confidence: draft.confidence,
        // Weight zero until confirmed: visible in the list, worth nothing.
        weight: 0,
      },
    })
    const parsed = parseStoredPreference(row as PreferenceRow)
    if (parsed) out.push(parsed)
  }

  return out
}

/**
 * Say yes — and, in the same breath, retire what this replaces.
 *
 * Confirmation is the only moment a rule starts binding, so it is also the only
 * moment supersession may fire. Doing it here rather than at extraction is what
 * makes "the old one is never silently overwritten" true: the athlete was shown
 * `wouldSupersede` before they tapped, and the row that steps aside keeps its
 * words, its quote and its date.
 */
export async function confirmPreference(id: number): Promise<PreferenceWrite | null> {
  const row = await prisma.preferences.findUnique({ where: { id } })
  if (!row) return null
  const parsed = parseStoredPreference(row as PreferenceRow)
  if (!parsed) return null

  const confirmed: PreferenceDraft = { ...parsed, confirmed: true }
  const updated = await prisma.preferences.update({
    where: { id },
    data: {
      rule: serializePreference(confirmed),
      weight: 1,
      active: true,
      confirmedAt: new Date(),
      scope: preferenceScope(confirmed),
      subject: preferenceSubject(confirmed),
    },
  })
  const preference = parseStoredPreference(updated as PreferenceRow)
  if (!preference) return null

  return { preference, superseded: await supersedeSameSubject(preference) }
}

export async function dismissPreference(id: number): Promise<boolean> {
  const row = await prisma.preferences.findUnique({ where: { id } })
  if (!row) return false
  await prisma.preferences.delete({ where: { id } })
  return true
}
