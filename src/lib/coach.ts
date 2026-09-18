// ── The coach layer ───────────────────────────────────────────────────────────
// Framework §10 and §11-A: the half of the system that turns a sentence into a
// structured patch, and the day's numbers into six parts a person can read.
//
// The division of labour is the whole design. Deterministic TypeScript already
// owns every rail — load ceiling, ACWR band, the back-to-back rule, niggle
// contraindications, concurrent training, calibration ramp caps — and it is
// written, tested and green. Nothing here re-implements any of it, softens any
// of it, or is trusted over it. **The coach proposes; the validator disposes.**
//
// That is structural, not aspirational:
//
//   · the model's ops are parsed by `parsePatchBody` — the *same* strict parser
//     the UI's tap goes through (`sessionStore.ts`) — with `actor` forced to
//     'coach', so a model response cannot claim to be the engine and launder
//     itself past the audit trail;
//   · anything the parser or the checks below refuse is **rejected, not
//     coerced** — no repair pass, no "close enough", no retry until the model
//     gets its way;
//   · the resulting patch is handed to `applyPatchToSession` by the route and
//     is subject to every push-back a human tap is. There is no bypass and no
//     elevated-trust path, because there is no second code path at all.
//
// The model's authority is therefore bounded by construction: it can only
// express what the patch schema can express, about items that exist, and only
// what the validator then allows.

import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns'
import { prisma } from './db'
import { acwrZone } from './load'
import { DISCLAIMER, containsDiagnosisLanguage } from './prehabEngine'
import { applySessionPatch, describeParams, validateSessionPatch } from './session'
import { MAX_PATCH_OPS, itemCost, loadDayContext, parsePatchBody } from './sessionStore'
import { evaluateDeloadForDate } from './deload'
import { activePreferenceRules, describePreference, readPreferences } from './preferences'
import type { StatedPreference } from './preferences'
import type { GatheredDay } from './todaySession'
import type { DeloadVerdictDetail } from './deload'
import type { StoredPreference } from './preferences'
import type { ValidationContext } from './session'
import type {
  EditableSession,
  PatchOp,
  SessionDiff,
  SessionPatch,
  ValidationVerdict,
} from '../types/patch'
import type { SessionBlock, SessionItem } from '../types/session'
import type { ReadinessBand } from '../types/readiness'

// ── Wiring ────────────────────────────────────────────────────────────────────
// Matches `src/app/api/ai-summary/route.ts` — same endpoint, same header pair,
// same version string, same "log the detail, return a sanitized line" posture.
// Only the model and the tool surface differ, because this call has to come
// back as structure rather than prose.

// A gateway addresses models as `provider/model` (e.g. `gh/claude-opus-5`),
// which Anthropic itself would reject — hence the override rather than a
// second hardcoded id. Unset = talking to Anthropic directly.
export const COACH_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5'
// ANTHROPIC_BASE_URL lets an Anthropic-compatible gateway stand in for the real
// API (see GARMIN-SETUP.md's sibling note in .env.example). Unset = Anthropic.
const ANTHROPIC_BASE = process.env.ANTHROPIC_BASE_URL?.replace(/\/+$/, '') ?? 'https://api.anthropic.com/v1'
const ANTHROPIC_URL = `${ANTHROPIC_BASE}/messages`
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_TOKENS = 3000
/** A sentence, not an essay. Anything longer is a paste or an attack. */
export const MAX_COACH_TEXT = 1000
/** The tool the model must call. A prose answer is a rejection, not a fallback. */
export const COACH_TOOL_NAME = 'propose_session_patch'
/** Nobody states five standing rules in one sentence; more than this is noise. */
export const MAX_STATED_PREFERENCES = 4

// ── The daily contract — input (§10) ──────────────────────────────────────────

export interface ContractReadiness {
  band: ReadinessBand
  decidingSignals: [string, string]
  plainText: string
  provisional: boolean
  calibration: string
  daysUntilCalibrated: number | null
  hrv: number | null
  rhr: number | null
  sleepHours: number | null
}

export interface ContractYesterday {
  date: string
  load: number
  hard: boolean
}

export interface ContractLoad {
  acwr: number
  acwrCap: number
  zone: string
  ceiling: number
  target: number
  floor: number
  chronicDailyLoad: number
  plannedToday: number
  reasons: string[]
}

export interface ContractWeek {
  phase: string | null
  daysToRace: number | null
  goalRace: string | null
  plannedRunTypes: Array<{ date: string; runType: string; priority: string }>
  lastWeekLoad: number
  thisWeekLoadSoFar: number
}

export interface ContractCandidate {
  itemId: string
  name: string
  modality: string
  outcome: string
  code: string
  reason: string
}

export interface ContractItem {
  itemId: string
  block: string
  kind: string
  name: string
  prescription: string
  why: string | null
}

export interface ContractNiggle {
  bodyRegion: string
  severity: number
  daysActive: number | null
}

export interface ContractPreference {
  label: string
  source: string
  confidence: number
  /** False for an inferred rule awaiting confirmation — visible, not binding (§13). */
  binding: boolean
}

/**
 * Everything §10 says the model gets, and nothing it does not.
 *
 * Assembled by deterministic code from the database, so the model never chooses
 * its own evidence. A plain object on purpose: the whole contract can be
 * snapshotted into a fixture and the rendered prompt asserted against literals.
 */
export interface CoachContract {
  date: string
  readiness: ContractReadiness
  yesterday: ContractYesterday | null
  load: ContractLoad
  week: ContractWeek
  calibration: { status: string; provisional: boolean; anchorConfidence: string }
  preferences: ContractPreference[]
  niggles: ContractNiggle[]
  candidates: ContractCandidate[]
  session: ContractItem[]
  deload: { triggered: boolean; reasons: string[] } | null
  flags: Array<{ code: string; message: string }>
  disclaimer: string
}

// ── The daily contract — output (§10) ─────────────────────────────────────────

export interface CoachItemWhy {
  itemId: string
  why: string
}

/**
 * The fixed six-part shape, parsed and typed.
 *
 * §10 specifies READINESS / TODAY / WHY / CHANGED / WEEK / FLAG. Holding it as
 * fields rather than prose is what lets the Today screen render each part in
 * its own place (§14), and lets a test assert that all six actually arrived
 * rather than hoping a paragraph contained them.
 */
export interface CoachReply {
  readiness: { band: ReadinessBand; decidingSignals: [string, string] }
  today: string
  why: string
  /** Per-item "why" (§12). Overwrites the engines' deterministic placeholders. */
  itemWhy: CoachItemWhy[]
  changed: string
  week: string
  flag: string
}

export interface CoachProposal {
  reply: CoachReply
  patch: SessionPatch
  /**
   * Standing preferences the athlete stated in passing (§13). Never part of the
   * patch, never binding, and never a reason to reject the rest of the answer.
   */
  preferences: StatedPreference[]
}

export type CoachRejectionCode =
  | 'no_tool_use'
  | 'malformed'
  | 'missing_section'
  | 'bad_band'
  | 'bad_deciding_signals'
  | 'bad_op'
  | 'unknown_item'
  | 'kind_change'
  | 'duplicate_item_id'
  | 'too_many_ops'
  | 'diagnosis_language'

export interface CoachRejection {
  ok: false
  code: CoachRejectionCode
  /** Written for a person: what was refused and why, never the raw payload. */
  message: string
}

export type CoachParseResult = ({ ok: true } & CoachProposal) | CoachRejection

// ── The tool schema ───────────────────────────────────────────────────────────
// Gate one of four. It cannot be relied on alone — a model can return anything
// — so everything it promises is re-checked below. Its real job is to make the
// right answer the easy one.

const OP_SCHEMA = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: ['remove', 'replace', 'modify', 'reorder', 'add'] },
    itemId: {
      type: 'string',
      description: 'An existing item id from the session. Required for remove, replace and modify.',
    },
    blockKind: { type: 'string', enum: ['warmup', 'main', 'accessory', 'cooldown'] },
    itemIds: {
      type: 'array',
      items: { type: 'string' },
      description: "reorder only: the block's items in their new order. The same set — no additions, no drops.",
    },
    index: { type: 'integer', description: 'add only: position within the block.' },
    item: {
      type: 'object',
      description: 'replace and add only: the whole new item.',
      properties: {
        id: { type: 'string' },
        ref: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['exercise', 'plyo', 'prehab', 'stretch', 'run'] },
            id: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['kind', 'id', 'name'],
        },
        params: {
          type: 'object',
          description: 'Params matching the item kind: strength | run | contacts | hold.',
        },
        why: { type: 'string' },
      },
      required: ['id', 'ref', 'params'],
    },
    params: {
      type: 'object',
      description:
        'modify only: the fields to change. `kind` must match the item being modified — turning a run into a lift is a replace, not a modify.',
    },
    why: { type: 'string', description: 'modify only: a new per-item why.' },
    reason: {
      type: 'string',
      description: 'Why this op. Shown in the diff and stored in edit_history.',
    },
  },
  required: ['op', 'reason'],
} as const

export const COACH_TOOL = {
  name: COACH_TOOL_NAME,
  description:
    'Answer the daily contract and, if the athlete asked for a change, propose it as a structured patch. ' +
    'The patch is checked by deterministic safety code before anything is applied; propose what you believe ' +
    'is right and accept the verdict rather than working around it.',
  input_schema: {
    type: 'object',
    properties: {
      readinessBand: { type: 'string', enum: ['green', 'amber', 'red'] },
      decidingSignals: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 2,
        description: 'Exactly the two numbers that decided the band.',
      },
      today: { type: 'string', description: 'TODAY: the session as ordered blocks, concrete.' },
      why: { type: 'string', description: 'WHY: one sentence for the overall shape.' },
      itemWhy: {
        type: 'array',
        description: 'Per-item why (§12). One entry per item that needs one.',
        items: {
          type: 'object',
          properties: { itemId: { type: 'string' }, why: { type: 'string' } },
          required: ['itemId', 'why'],
        },
      },
      changed: { type: 'string', description: 'CHANGED: versus the plan, or "no change".' },
      week: { type: 'string', description: 'WEEK: the updated skeleton, or "unchanged".' },
      flag: { type: 'string', description: 'FLAG: one line, or "nothing to action".' },
      ops: {
        type: 'array',
        items: OP_SCHEMA,
        description: 'The patch. Empty when nothing should change.',
      },
      observedPreferences: {
        type: 'array',
        description:
          'Standing preferences the athlete stated in this message, if any — "no weights at weekends", ' +
          '"stop giving me burpees", "long run on Sunday", "I would rather run in the mornings". ' +
          'Only a rule about how they want training to work in general, never a one-off request about today ' +
          'and never something you inferred. Leave the array empty when nothing was stated.',
        items: {
          type: 'object',
          properties: {
            quote: {
              type: 'string',
              description:
                "The athlete's own words, copied exactly from their message. Must appear in it verbatim.",
            },
            statement: {
              type: 'string',
              description:
                'The same rule as one short sentence, e.g. "no weights on weekends", "rest Monday", ' +
                '"long run Sunday", "no doubles", "stop giving me burpees".',
            },
            topic: {
              type: 'string',
              description:
                'Two or three words naming what the rule is about, e.g. "time of day". Used only when ' +
                'the rule is not one of the shapes above.',
            },
          },
          required: ['quote', 'statement'],
        },
      },
    },
    required: ['readinessBand', 'decidingSignals', 'today', 'why', 'changed', 'week', 'flag', 'ops'],
  },
} as const

// ── The prompt ────────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = [
  'You are the coach in a recovery-driven training app. You own judgement, synthesis, the per-item',
  '"why", and turning the athlete\'s sentence into a structured patch.',
  '',
  'You do NOT own safety. Deterministic code already decided the load ceiling, the ACWR band, the',
  '"never two hard days back-to-back" rule, niggle contraindications, concurrent-training spacing and',
  'the calibration ramp caps, and it re-checks everything you propose. If it pushes back, that is the',
  'answer — say so plainly and offer the safer version it returned. Never argue with it, never try a',
  'variation to get around it, and never tell the athlete a refused change was made.',
  '',
  'Rules you must keep:',
  '· Answer only by calling the tool. Every one of its parts is required.',
  "· Only reference item ids that appear in TODAY'S SESSION below. Never invent one.",
  "· A \"modify\" keeps the item's kind. Changing what an item *is* is a \"replace\".",
  '· Never name a medical condition or offer a diagnosis. Describe the area and the general protocol.',
  '  Anything that reads as a diagnosis gets the whole response rejected.',
  '· A preference marked "awaiting confirmation" is a guess about the athlete, not an instruction.',
  '· When the numbers are still estimates, say so. Conservative beats confident.',
  '· Every op needs a reason the athlete will read in the diff.',
  '· If nothing should change, return an empty ops array and say "no change".',
  '· If the athlete stated a standing preference in passing, report it in observedPreferences with',
  '  their exact words. Quote, never paraphrase — a quote that is not in their message is discarded.',
  '  Nothing you report there takes effect; they are asked to confirm it. Do not act on it today.',
].join('\n')

function line(label: string, value: string | number | null | undefined): string {
  return `${label}: ${value ?? '—'}`
}

/** The contract as the model sees it. Pure, so the prompt is assertable. */
export function renderContract(contract: CoachContract, text: string): string {
  const parts: string[] = [`DATE: ${contract.date}`]

  parts.push(
    '',
    'READINESS',
    line('  band', contract.readiness.band.toUpperCase()),
    line('  deciding', contract.readiness.decidingSignals.join(' · ')),
    line('  plain', contract.readiness.plainText),
    line('  hrv', contract.readiness.hrv),
    line('  resting hr', contract.readiness.rhr),
    line('  sleep hours', contract.readiness.sleepHours),
    line('  provisional', String(contract.readiness.provisional)),
  )

  parts.push(
    '',
    'YESTERDAY',
    contract.yesterday
      ? `  ${contract.yesterday.date} — load ${Math.round(contract.yesterday.load)}${contract.yesterday.hard ? ' (hard)' : ''}`
      : '  no session recorded',
  )

  parts.push(
    '',
    'LOAD',
    line('  acwr', `${contract.load.acwr} (cap ${contract.load.acwrCap}, ${contract.load.zone})`),
    line('  ceiling', Math.round(contract.load.ceiling)),
    line('  target', Math.round(contract.load.target)),
    line('  floor', Math.round(contract.load.floor)),
    line('  planned today', Math.round(contract.load.plannedToday)),
    ...contract.load.reasons.map((r) => `  · ${r}`),
  )

  parts.push(
    '',
    'WEEK',
    line('  phase', contract.week.phase),
    line('  goal race', contract.week.goalRace),
    line('  days to race', contract.week.daysToRace),
    line('  last week load', Math.round(contract.week.lastWeekLoad)),
    line('  this week so far', Math.round(contract.week.thisWeekLoadSoFar)),
    ...contract.week.plannedRunTypes.map((p) => `  · ${p.date} ${p.runType} (${p.priority})`),
  )

  parts.push(
    '',
    'CALIBRATION',
    line('  status', contract.calibration.status),
    line('  weakest anchor', contract.calibration.anchorConfidence),
  )

  parts.push('', 'PREFERENCES')
  if (contract.preferences.length === 0) parts.push('  none recorded')
  else {
    for (const p of contract.preferences) {
      parts.push(
        `  · ${p.label} [${p.source}, confidence ${p.confidence.toFixed(2)}${
          p.binding ? '' : ', awaiting confirmation — do not act on it'
        }]`,
      )
    }
  }

  parts.push('', 'NIGGLES')
  if (contract.niggles.length === 0) parts.push('  none logged')
  else {
    for (const n of contract.niggles) {
      parts.push(
        `  · ${n.bodyRegion} ${n.severity}/10${n.daysActive != null ? `, ${n.daysActive} days` : ''}`,
      )
    }
  }

  parts.push('', 'ALLOCATOR CANDIDATES (what the day was built from, and what became of each)')
  if (contract.candidates.length === 0) parts.push('  none')
  else {
    for (const c of contract.candidates) {
      parts.push(`  · ${c.name} [${c.modality}] → ${c.outcome} (${c.code}): ${c.reason}`)
    }
  }

  parts.push('', "TODAY'S SESSION (the only item ids that exist)")
  if (contract.session.length === 0) parts.push('  empty')
  else {
    for (const i of contract.session) {
      parts.push(`  · [${i.itemId}] ${i.block}/${i.kind} — ${i.name}: ${i.prescription}`)
      if (i.why) parts.push(`      current why: ${i.why}`)
    }
  }

  if (contract.deload) {
    parts.push(
      '',
      'DELOAD',
      contract.deload.triggered
        ? `  fired — ${contract.deload.reasons.join(' ')}`
        : '  not warranted by the load',
    )
  }

  if (contract.flags.length > 0) {
    parts.push('', 'ENGINE FLAGS')
    for (const f of contract.flags) parts.push(`  · ${f.message}`)
  }

  parts.push('', `DISCLAIMER (must hold for every word you write): ${contract.disclaimer}`)
  parts.push(
    '',
    'THE ATHLETE SAYS:',
    text.trim().length > 0 ? text.trim() : '(nothing — just compose today and explain it)',
  )

  return parts.join('\n')
}

// ── Parsing the response ──────────────────────────────────────────────────────

interface AnthropicContentBlock {
  type?: string
  name?: string
  input?: unknown
  text?: string
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[]
  stop_reason?: string
}

function reject(code: CoachRejectionCode, message: string): CoachRejection {
  return { ok: false, code, message }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Pull the tool call out of an Anthropic response.
 *
 * A prose answer is not a partial success to be salvaged — it means the model
 * did not produce a patch, so there is no patch. Split out so the whole parse
 * path can be exercised against recorded JSON with no network and no key.
 */
export function extractToolInput(raw: unknown): { input: unknown } | CoachRejection {
  if (!isRecord(raw)) {
    return reject('malformed', 'The coach returned something that was not a response.')
  }
  const response = raw as AnthropicResponse
  if (response.stop_reason === 'max_tokens') {
    return reject(
      'malformed',
      "The coach's answer was cut off mid-proposal, so it was discarded rather than half-applied.",
    )
  }
  const blocks = Array.isArray(response.content) ? response.content : []
  const tool = blocks.find((b) => b?.type === 'tool_use' && b.name === COACH_TOOL_NAME)
  if (!tool) {
    return reject(
      'no_tool_use',
      'The coach answered in prose instead of a structured proposal, so there is nothing to apply. Nothing was changed.',
    )
  }
  return { input: tool.input }
}

function textField(v: unknown, max = 2000): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (t.length === 0) return null
  return t.slice(0, max)
}

/** Every item id the session actually holds. Anything else is invented (§11). */
export function sessionItemIds(blocks: SessionBlock[]): Set<string> {
  const ids = new Set<string>()
  for (const block of blocks) for (const item of block.items) ids.add(item.id)
  return ids
}

function findItem(blocks: SessionBlock[], itemId: string): SessionItem | null {
  for (const block of blocks) {
    const found = block.items.find((i) => i.id === itemId)
    if (found) return found
  }
  return null
}

/**
 * Model-authored strings, all of them, in one place.
 *
 * §15 is not "the prehab text must be clean" — it is that nothing the model
 * wrote reaches the screen carrying a diagnosis. Op reasons and swapped-in
 * exercise names are model-authored too, so they are screened alongside the six
 * parts rather than trusted because they happen to look structural.
 */
export function modelAuthoredStrings(reply: CoachReply, ops: PatchOp[]): string[] {
  const out: string[] = [
    reply.today,
    reply.why,
    reply.changed,
    reply.week,
    reply.flag,
    ...reply.readiness.decidingSignals,
    ...reply.itemWhy.map((w) => w.why),
  ]
  for (const op of ops) {
    out.push(op.reason)
    if (op.op === 'modify' && op.why) out.push(op.why)
    if (op.op === 'add' || op.op === 'replace') {
      out.push(op.item.ref.name)
      if (op.item.why) out.push(op.item.why)
    }
  }
  return out
}

// ── Preferences stated in passing (§13) ───────────────────────────────────────

/** Punctuation and spacing differ between a quote and its source; words do not. */
function normalizeQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * What the athlete said about how they want to train, extracted from the same
 * answer as the patch — and structurally unable to spoil it.
 *
 * Two rules make that true. This function has no rejection path: every failure
 * mode drops the offending candidate and returns the rest, so a malformed
 * extraction costs a preference, never an edit. And it is the *only* part of
 * the response allowed to fail softly — everything in `parseCoachOutput` still
 * rejects the whole answer, because a patch is applied to a real training day
 * and a preference is only ever a question the athlete is asked.
 *
 * The one hard check is the quote. A candidate whose words do not actually
 * appear in the athlete's message is discarded, which is what stops the model
 * attributing a rule to someone who never stated one — the failure that would
 * quietly retire a rule they *did* state. The statement is not parsed here at
 * all: `recordStatedPreference` runs it through `parseExplicitRule`, the same
 * deterministic parser the rule box uses, so the model chooses *which words*
 * are a preference and typed code alone decides what they mean.
 */
export function parseObservedPreferences(raw: unknown, athleteText: string): StatedPreference[] {
  if (!Array.isArray(raw)) return []
  const haystack = normalizeQuote(athleteText)
  if (haystack.length === 0) return []

  const out: StatedPreference[] = []
  for (const entry of raw.slice(0, MAX_STATED_PREFERENCES)) {
    if (!isRecord(entry)) continue
    const quote = textField(entry.quote, 300)
    const statement = textField(entry.statement, 300)
    if (!quote || !statement) continue

    const needle = normalizeQuote(quote)
    if (needle.length < 4 || !haystack.includes(needle)) continue

    // §15 holds here too, but a dirty candidate is dropped rather than taking
    // the edit down with it.
    if (containsDiagnosisLanguage(quote) || containsDiagnosisLanguage(statement)) continue

    const topic = textField(entry.topic, 60)
    out.push({ statement, quote, ...(topic ? { topic } : {}) })
  }
  return out
}

/**
 * Turn a tool input into a proposal, or refuse it.
 *
 * Nothing here repairs. A response that is out of contract in any way is
 * rejected whole: a half-understood patch applied to a real training day is
 * worse than a coach that says it could not answer.
 */
export function parseCoachOutput(
  rawInput: unknown,
  session: EditableSession,
  sourceText: string,
): CoachParseResult {
  if (!isRecord(rawInput)) {
    return reject('malformed', "The coach's proposal was not a structured object, so it was discarded.")
  }

  // ── The six parts (§10) ────────────────────────────────────────────────────
  const band = rawInput.readinessBand
  if (band !== 'green' && band !== 'amber' && band !== 'red') {
    return reject('bad_band', 'The coach did not return a readiness band the system recognises.')
  }

  const signals = rawInput.decidingSignals
  if (!Array.isArray(signals) || signals.length !== 2) {
    return reject(
      'bad_deciding_signals',
      'READINESS has to name exactly the two numbers that decided the band, and it did not.',
    )
  }
  const decidingSignals = signals.map((s) => textField(s, 200))
  if (decidingSignals.some((s) => s === null)) {
    return reject('bad_deciding_signals', 'The two deciding numbers came back empty.')
  }

  const sections: Array<[string, unknown]> = [
    ['today', rawInput.today],
    ['why', rawInput.why],
    ['changed', rawInput.changed],
    ['week', rawInput.week],
    ['flag', rawInput.flag],
  ]
  const parsed: Record<string, string> = {}
  for (const [key, value] of sections) {
    const text = textField(value)
    if (text === null) {
      return reject(
        'missing_section',
        `The coach's answer left out ${key.toUpperCase()}, so it is not a complete daily contract.`,
      )
    }
    parsed[key] = text
  }

  // ── Per-item why (§12) ─────────────────────────────────────────────────────
  const known = sessionItemIds(session.blocks)
  const itemWhy: CoachItemWhy[] = []
  if (rawInput.itemWhy !== undefined) {
    if (!Array.isArray(rawInput.itemWhy)) {
      return reject('malformed', 'The per-item explanations were not a list.')
    }
    for (const entry of rawInput.itemWhy) {
      if (!isRecord(entry)) return reject('malformed', 'A per-item explanation was not an object.')
      const itemId = textField(entry.itemId, 120)
      const why = textField(entry.why, 500)
      if (!itemId || !why) {
        return reject('malformed', 'A per-item explanation was missing its item or its text.')
      }
      if (!known.has(itemId)) {
        return reject(
          'unknown_item',
          `The coach explained an item "${itemId}" that is not in today's session. Refusing rather than guessing which one it meant.`,
        )
      }
      itemWhy.push({ itemId, why })
    }
  }

  // ── The patch ──────────────────────────────────────────────────────────────
  const rawOps = rawInput.ops
  if (rawOps !== undefined && !Array.isArray(rawOps)) {
    return reject('malformed', 'The proposed changes were not a list of operations.')
  }
  const opsArray = (rawOps ?? []) as unknown[]
  if (opsArray.length > MAX_PATCH_OPS) {
    return reject('too_many_ops', 'The coach proposed more changes than one edit may carry.')
  }

  let ops: PatchOp[] = []
  if (opsArray.length > 0) {
    // Gate two: the identical parser the UI's tap goes through. Forcing the
    // actor here is what stops a model response claiming to be the engine.
    const { patch: parsedPatch, error } = parsePatchBody({
      actor: 'coach',
      patch: { ops: opsArray },
    })
    if (!parsedPatch) {
      return reject('bad_op', `The coach proposed a change the edit format does not allow: ${error}`)
    }
    ops = parsedPatch.ops
  }

  // ── Gate three: what the schema cannot express ─────────────────────────────
  // Unknown ids, kind changes and colliding ids are refused *here* so they never
  // reach the validator. The validator would refuse them too — it has
  // `unknown_item` and `kind_change` rules — but a rejection the athlete can
  // read beats a structural push-back, and the model gets no opportunity to
  // discover which of its inventions the validator happens to tolerate.
  const ids = new Set(known)
  for (const op of ops) {
    if (op.op === 'reorder') {
      for (const id of op.itemIds) {
        if (!ids.has(id)) {
          return reject(
            'unknown_item',
            `The coach tried to reorder around an item "${id}" that does not exist.`,
          )
        }
      }
      continue
    }
    if (op.op === 'add') {
      if (ids.has(op.item.id)) {
        return reject(
          'duplicate_item_id',
          `The coach tried to add an item using the id "${op.item.id}", which is already taken.`,
        )
      }
      ids.add(op.item.id)
      continue
    }
    if (!ids.has(op.itemId)) {
      return reject(
        'unknown_item',
        `The coach referred to an item "${op.itemId}" that is not in today's session. Refusing rather than guessing which one it meant.`,
      )
    }
    if (op.op === 'replace') {
      if (op.item.id !== op.itemId && ids.has(op.item.id)) {
        return reject(
          'duplicate_item_id',
          `The replacement for "${op.itemId}" reuses an id that is already taken.`,
        )
      }
      ids.delete(op.itemId)
      ids.add(op.item.id)
      continue
    }
    if (op.op === 'remove') {
      ids.delete(op.itemId)
      continue
    }
    if (op.op === 'modify' && op.params) {
      const target = findItem(session.blocks, op.itemId)
      const incoming = op.params as { kind?: string }
      if (target && incoming.kind && incoming.kind !== target.params.kind) {
        return reject(
          'kind_change',
          `The coach tried to modify ${target.ref.name} from a ${target.params.kind} prescription into a ${incoming.kind} one. That is a swap, not an edit, and it was refused.`,
        )
      }
    }
  }

  const reply: CoachReply = {
    readiness: { band, decidingSignals: decidingSignals as [string, string] },
    today: parsed.today,
    why: parsed.why,
    itemWhy,
    changed: parsed.changed,
    week: parsed.week,
    flag: parsed.flag,
  }

  // ── Gate four: §15 ─────────────────────────────────────────────────────────
  for (const candidate of modelAuthoredStrings(reply, ops)) {
    if (containsDiagnosisLanguage(candidate)) {
      return reject(
        'diagnosis_language',
        'The coach named a condition rather than describing an area, which this app does not do. ' +
          `The whole response was discarded and nothing was changed. ${DISCLAIMER}`,
      )
    }
  }

  // Per-item whys become ops so they travel the same funnel as everything else
  // — auditable, reversible, and subject to the same verdict.
  const whyOps = buildWhyOps(reply.itemWhy, session, ops)

  return {
    ok: true,
    reply,
    patch: {
      actor: 'coach',
      ops: [...ops, ...whyOps],
      source: sourceText.slice(0, MAX_COACH_TEXT),
    },
    // Last, and deliberately after every gate above: an extraction can only
    // ever be dropped, never a reason the patch does not reach the athlete.
    preferences: parseObservedPreferences(rawInput.observedPreferences, sourceText),
  }
}

/**
 * Per-item "why" as patch ops (§12).
 *
 * The Phase 4/5 engines write deterministic placeholder whys and expect this
 * layer to overwrite them — but an overwrite is still an edit, so it goes
 * through `applySessionPatch` like any other. Two details matter: only a why
 * that actually changed produces an op, otherwise every coach turn writes a
 * twenty-entry diff that says nothing; and each op restates the item's current
 * status, so explaining a card does not mark it as edited.
 */
export function buildWhyOps(
  itemWhy: CoachItemWhy[],
  session: EditableSession,
  existingOps: PatchOp[],
): PatchOp[] {
  const touched = new Set<string>()
  for (const op of existingOps) {
    if (op.op === 'reorder') continue
    if (op.op === 'add') touched.add(op.item.id)
    else touched.add(op.itemId)
  }

  const ops: PatchOp[] = []
  for (const entry of itemWhy) {
    if (touched.has(entry.itemId)) continue
    const item = findItem(session.blocks, entry.itemId)
    if (!item) continue
    if ((item.why ?? '') === entry.why) continue
    ops.push({
      op: 'modify',
      itemId: entry.itemId,
      why: entry.why,
      status: item.status,
      reason: 'Explanation for today, from the coach.',
    })
  }
  return ops
}

// ── The diff you confirm (§11-A) ──────────────────────────────────────────────

export interface CoachPreview {
  patch: SessionPatch
  verdict: ValidationVerdict
  diff: SessionDiff
  /** The safer version, when the rails would rather you took it (§21). */
  counterProposal: SessionPatch | null
  /** Always false. A preview that could apply would not be a preview. */
  applied: false
}

/**
 * Judge the coach's patch and describe what it would do — without doing it.
 *
 * §11-A is "shows a diff; you confirm; it applies", in that order, and the
 * athlete's own taps have always worked that way. This is what lets the coach
 * path match them: the sentence comes back as a patch the athlete has not yet
 * agreed to, complete with the verdict the rails will reach and the
 * counter-proposal they would rather have.
 *
 * `validateSessionPatch` is the export that means "judge this without touching
 * anything", so the verdict comes from there. `applySessionPatch` is run only
 * for its diff: it is pure, its proposed session is discarded right here, and
 * it reaches the same verdict through the same rule pass — so a preview cannot
 * describe one edit while the apply path judges another.
 *
 * What this deliberately does not produce is a token. Nothing here is recorded,
 * so nothing a later apply could present in place of being validated again; the
 * confirmation goes to `/api/session/patch` and is judged afresh against the
 * session as it is at that moment.
 */
export function previewCoachPatch(
  session: EditableSession,
  patch: SessionPatch,
  context: ValidationContext,
): CoachPreview {
  const verdict = validateSessionPatch(session, patch, context)
  const { diff } = applySessionPatch(session, patch, context)

  return {
    patch,
    verdict,
    diff,
    counterProposal: verdict.counterProposal ?? null,
    applied: false,
  }
}

// ── Rendering the six parts ───────────────────────────────────────────────────

/** §10's output shape, as text, for anywhere that wants it in one block. */
export function formatCoachReply(reply: CoachReply): string {
  return [
    `READINESS: ${reply.readiness.band.toUpperCase()} — ${reply.readiness.decidingSignals.join('; ')}`,
    `TODAY: ${reply.today}`,
    `WHY: ${reply.why}`,
    `CHANGED: ${reply.changed}`,
    `WEEK: ${reply.week}`,
    `FLAG: ${reply.flag}`,
  ].join('\n')
}

// ── The call ──────────────────────────────────────────────────────────────────

export type CoachUnavailableCode = 'no_api_key' | 'api_error' | 'network_error'

export interface CoachUnavailable {
  ok: false
  code: CoachUnavailableCode
  message: string
}

export type CoachCallResult = { ok: true; raw: unknown } | CoachUnavailable

/** Swappable so the whole path can be tested against fixtures with no network. */
export type FetchLike = (
  url: string,
  init: Record<string, unknown>,
) => Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
  json: () => Promise<unknown>
}>

export interface CoachCallOptions {
  apiKey?: string | null
  fetchImpl?: FetchLike
}

/**
 * Honest degradation is the whole point of the no-key branch.
 *
 * With no `ANTHROPIC_API_KEY` this says so and stops. It does not fall back to
 * a canned reply and it does not quietly return "nothing to change" — either
 * would be the app pretending to an opinion it does not have, which is the one
 * thing §21's Outsider says destroys trust in the parts you cannot check.
 * Manual editing (§11-B) keeps working the entire time, so the honest message
 * says so rather than leaving the athlete stuck.
 */
export const NO_KEY_MESSAGE =
  'The coach is unavailable — no ANTHROPIC_API_KEY is configured, so there is nothing to ask. ' +
  'Nothing was changed. You can still edit today by hand: every rail the coach works behind applies to your taps too.'

const UNREACHABLE_MESSAGE =
  'The coach could not be reached just now. Nothing was changed — try again, or edit today by hand.'

export async function callCoach(
  contract: CoachContract,
  text: string,
  opts: CoachCallOptions = {},
): Promise<CoachCallResult> {
  const apiKey = opts.apiKey !== undefined ? opts.apiKey : process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { ok: false, code: 'no_api_key', message: NO_KEY_MESSAGE }

  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)

  try {
    const response = await doFetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: COACH_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: [COACH_TOOL],
        tool_choice: { type: 'tool', name: COACH_TOOL_NAME },
        messages: [{ role: 'user', content: renderContract(contract, text) }],
      }),
    })

    if (!response.ok) {
      // An auth error can echo the key back in its body, so the detail is
      // logged server-side and never returned (§20).
      const detail = await response.text().catch(() => '')
      console.error('[coach] Anthropic error:', response.status, detail.slice(0, 500))
      return { ok: false, code: 'api_error', message: UNREACHABLE_MESSAGE }
    }

    return { ok: true, raw: await response.json() }
  } catch (err) {
    console.error('[coach] fetch error:', err instanceof Error ? err.message : String(err))
    return { ok: false, code: 'network_error', message: UNREACHABLE_MESSAGE }
  }
}

/** The whole model round-trip: call, extract, parse, refuse. No DB, no apply. */
export async function proposeFromText(
  contract: CoachContract,
  session: EditableSession,
  text: string,
  opts: CoachCallOptions = {},
): Promise<CoachParseResult | CoachUnavailable> {
  const called = await callCoach(contract, text, opts)
  if (!called.ok) return called

  const extracted = extractToolInput(called.raw)
  if ('ok' in extracted) return extracted

  return parseCoachOutput(extracted.input, session, text)
}

// ── Assembling the contract ───────────────────────────────────────────────────

function itemsOf(blocks: SessionBlock[]): ContractItem[] {
  const out: ContractItem[] = []
  for (const block of blocks) {
    for (const item of block.items) {
      out.push({
        itemId: item.id,
        block: block.kind,
        kind: item.ref.kind,
        name: item.ref.name,
        prescription: describeParams(item.params),
        why: item.why ?? null,
      })
    }
  }
  return out
}

export interface ContractInput {
  date: Date
  gathered: GatheredDay
  session: EditableSession
  preferences: StoredPreference[]
  deload: DeloadVerdictDetail | null
  goalRace: string | null
  goalRaceDate: Date | null
  plannedRunTypes: ContractWeek['plannedRunTypes']
  yesterday: ContractYesterday | null
  lastWeekLoad: number
  thisWeekLoadSoFar: number
  phase: string | null
}

/** Pure: everything the model is told, assembled from arguments only. */
export function buildCoachContract(input: ContractInput): CoachContract {
  const { gathered } = input
  const binding = new Set(activePreferenceRules(input.preferences, input.date).map((r) => r.id))
  const plannedToday = input.session.blocks.reduce(
    (sum, b) => sum + b.items.reduce((s, i) => s + itemCost(i).load, 0),
    0,
  )

  return {
    date: startOfDay(input.date).toISOString().slice(0, 10),
    readiness: {
      band: gathered.readiness.band,
      decidingSignals: gathered.readiness.decidingSignals,
      plainText: gathered.readiness.plainText,
      provisional: gathered.readiness.provisional,
      calibration: gathered.readiness.calibration,
      daysUntilCalibrated: gathered.readiness.daysUntilCalibrated,
      hrv: gathered.readiness.hrv,
      rhr: gathered.readiness.rhr,
      sleepHours: gathered.readiness.sleepHours,
    },
    yesterday: input.yesterday,
    load: {
      acwr: gathered.budget.acwr,
      acwrCap: gathered.budget.acwrCap,
      zone: acwrZone(gathered.budget.acwr),
      ceiling: gathered.budget.ceiling,
      target: gathered.budget.target,
      floor: gathered.budget.floor,
      chronicDailyLoad: gathered.budget.chronicDailyLoad,
      plannedToday: Math.round(plannedToday * 10) / 10,
      reasons: gathered.budget.reasons,
    },
    week: {
      phase: input.phase,
      daysToRace:
        input.goalRaceDate != null
          ? differenceInCalendarDays(input.goalRaceDate, startOfDay(input.date))
          : null,
      goalRace: input.goalRace,
      plannedRunTypes: input.plannedRunTypes,
      lastWeekLoad: input.lastWeekLoad,
      thisWeekLoadSoFar: input.thisWeekLoadSoFar,
    },
    calibration: {
      status: gathered.readiness.calibration,
      provisional: gathered.readiness.provisional,
      anchorConfidence:
        gathered.readiness.calibration === 'graduated'
          ? 'confirmed'
          : gathered.readiness.calibration === 'baseline_ready'
            ? 'observed'
            : 'estimate',
    },
    preferences: input.preferences.map((p) => ({
      label: describePreference(p),
      source: p.source,
      confidence: p.confidence,
      binding: binding.has(String(p.id)) || binding.has(`${p.id}-run`),
    })),
    niggles: gathered.movement.input.assessments.map((a) => ({
      bodyRegion: a.bodyRegion,
      severity: a.currentSeverity,
      daysActive: a.daysActive ?? null,
    })),
    candidates: gathered.allocation.decisions.map((d) => ({
      itemId: d.itemId,
      name: d.name,
      modality: d.modality,
      outcome: d.outcome,
      code: d.code,
      reason: d.reason,
    })),
    session: itemsOf(input.session.blocks),
    deload: input.deload
      ? { triggered: input.deload.triggered, reasons: input.deload.reasons }
      : null,
    flags: gathered.verdictFlags.map((f) => ({ code: f.code, message: f.message })),
    disclaimer: DISCLAIMER,
  }
}

/** Read everything §10 names, in one pass. The only DB-touching export here. */
export async function gatherCoachContract(
  today: Date,
  session: EditableSession,
  gathered: GatheredDay,
): Promise<CoachContract> {
  const date = startOfDay(today)

  const [profile, plan, planned, preferences, deload, yesterdayRow, dayContext] = await Promise.all([
    prisma.athlete_profile.findFirst({ orderBy: { id: 'desc' } }),
    prisma.plan.findFirst({ orderBy: { id: 'desc' } }),
    prisma.planned_session.findMany({
      where: { date: { gte: date, lt: addDays(date, 7) }, modality: 'run' },
      orderBy: { date: 'asc' },
    }),
    readPreferences(),
    evaluateDeloadForDate(date),
    prisma.session.findUnique({ where: { date: addDays(date, -1) } }),
    loadDayContext(today),
  ])

  const plannedRunTypes = planned.map((p) => {
    let runType = 'unknown'
    try {
      const spec = JSON.parse(p.targetSpecJson ?? '{}') as { runType?: string }
      if (spec.runType) runType = spec.runType
    } catch {
      // A malformed spec is a plan-generation bug, not a reason to fail the day.
    }
    return {
      date: startOfDay(new Date(p.date)).toISOString().slice(0, 10),
      runType,
      priority: p.priority ?? 'B',
    }
  })

  const yesterday: ContractYesterday | null = yesterdayRow
    ? {
        date: startOfDay(new Date(yesterdayRow.date)).toISOString().slice(0, 10),
        load: yesterdayRow.actualLoad ?? yesterdayRow.plannedLoad ?? 0,
        hard: (yesterdayRow.srpe ?? 0) >= 7,
      }
    : null

  return buildCoachContract({
    date,
    gathered,
    session,
    preferences,
    deload,
    goalRace: profile?.goalRace ?? null,
    goalRaceDate: profile?.goalRaceDate ? new Date(profile.goalRaceDate) : null,
    plannedRunTypes,
    yesterday,
    lastWeekLoad: dayContext.lastWeekLoad,
    thisWeekLoadSoFar: dayContext.thisWeekLoadSoFar,
    phase: plan?.phase ?? null,
  })
}
