import type { BlockKind, SessionItem } from './session'
import type { ReadinessBand } from './readiness'
import type { AnchorSource } from './strength'
import type { RunType } from './run'

// ── Plyometrics (framework §9) ────────────────────────────────────────────────

export type PlyoIntensity = 'low' | 'medium' | 'high'
export type PlyoContactLoad = 'low' | 'medium' | 'high'
/** 1 = foundational, 2 = moderate, 3 = high. Mirrors plyo_library.progressionTier. */
export type PlyoTier = 1 | 2 | 3

/** A row of src/data/plyos.json, which seeds `plyo_library`. */
export interface Plyo {
  id: string
  name: string
  intensity: PlyoIntensity
  contactLoad: PlyoContactLoad
  progressionTier: PlyoTier
  /** Plyo ids that must already be owned before this one is offered. */
  prerequisites: string[]
  target: string
  videoUrl: string | null
  muscleText: string
  rationale: string
  evidence: string
}

/**
 * One logged plyo exposure. `cleanExecution` is the progression signal: tiers
 * advance on demonstrated quality, not on elapsed weeks (§9, mirroring the
 * evidence-not-calendar rule the run ladder uses).
 */
export interface PlyoSessionHistory {
  date: Date
  plyoId: string
  tier: PlyoTier
  contacts: number
  /** Null when the athlete never answered — treated as neither pass nor fail. */
  cleanExecution: boolean | null
  /** Next-day soreness 0–10, when logged. */
  sorenessNextDay?: number | null
}

/** The plyo-tier anchor of framework §3 — value plus how much it is trusted. */
export interface PlyoTierAnchor {
  value: PlyoTier
  source: AnchorSource
  confidence: number
  /** Clean sessions backing the anchor. */
  sessions: number
  basis: string
}

export type PlyoBlockReason = 'tier' | 'prerequisites' | 'impact' | 'niggle'

export interface PlyoUnlockContext {
  tierAnchor: PlyoTier
  /** Plyo ids already owned — the prerequisite currency. */
  masteredIds: string[]
  /** Impact clearance comes from a clinician, never from the app (§15). */
  impactCleared: boolean
  /** Regions closed off by an escalated niggle (§15). */
  blockedRegions?: BodyRegion[]
}

export interface PlyoUnlockResult {
  plyo: Plyo
  unlocked: boolean
  blockedBy: PlyoBlockReason | null
  missingPrerequisites: string[]
  reason: string
}

export interface ContactBudgetInput {
  tierAnchor: PlyoTier
  /** Ground contacts per completed week, oldest first. */
  weeklyContacts: number[]
  /** Contacts already banked in the current, incomplete week. */
  contactsThisWeek?: number
  band: ReadinessBand
  painFlagged?: boolean
  /** Calibration window still open — ramp tightens (§5b). */
  provisional?: boolean
  /** Set by the prehab engine when a niggle has closed impact work off. */
  blockImpact?: boolean
}

/** Today's ground-contact allowance and the tier ceiling that goes with it. */
export interface ContactBudget {
  contacts: number
  /** 0 means nothing today, whatever the catalog would otherwise allow. */
  maxTier: PlyoTier | 0
  /** Contacts the whole week may reach, from the ACWR ramp. */
  weeklyCeiling: number
  /** Acute:chronic on contacts. Null until there is a chronic week to divide by. */
  acwr: number | null
  /** True when the ramp, not readiness, is what shortened the session. */
  rampCapped: boolean
  reason: string
}

export type PlyoPlacement = 'primer' | 'standalone' | 'none'

export interface PlyoPlacementContext {
  band: ReadinessBand
  todayRunType: RunType | null
  tomorrowRunType: RunType | null
  /** An explicit recovery day, even if no run is scheduled. */
  isRecoveryDay: boolean
  painFlagged?: boolean
}

export interface PlyoPlacementDecision {
  allowed: boolean
  placement: PlyoPlacement
  block: BlockKind
  reason: string
}

export interface PlyoPrescription {
  items: SessionItem[]
  block: BlockKind
  placement: PlyoPlacement
  totalContacts: number
  why: string
  /** One line only when something needs saying, else null (§10). */
  flag: string | null
}

// ── Prehab / PT (framework §9, §15) ───────────────────────────────────────────

export type BodyRegion =
  | 'ankle_foot'
  | 'shin'
  | 'knee'
  | 'hip'
  | 'hamstring'
  | 'low_back'
  | 'other'

export type PrehabCategory = 'strengthen' | 'stretch' | 'mobility' | 'stability'

/** A row of src/data/prehab.json, which seeds `prehab_library`. */
export interface PrehabExercise {
  id: string
  name: string
  bodyRegion: BodyRegion
  category: PrehabCategory
  niggleTags: string[]
  targetTissue: string
  videoUrl: string | null
  muscleText: string
  rationale: string
  evidence: string
}

export type NiggleSide = 'left' | 'right' | 'both'
/**
 * How the athlete describes the sensation. `sharp` is the only value that
 * carries a hard rule: it escalates immediately (§15). The rest are colour.
 */
export type NiggleQuality = 'dull' | 'achy' | 'tight' | 'stiff' | 'sharp' | 'burning'
export type NiggleStatus = 'active' | 'resolved' | 'escalated'

/** Mirrors the `niggle_log` row without importing Prisma. */
export interface NiggleRecord {
  id?: number
  date: Date
  bodyRegion: BodyRegion
  side: NiggleSide | null
  /** 0–10 as the athlete reported it. */
  severity: number
  quality: NiggleQuality | null
  notes?: string | null
  status: NiggleStatus
  firstReportedOn: Date
  resolvedOn?: Date | null
  escalatedOn?: Date | null
}

export type SeverityTrend = 'improving' | 'stable' | 'worsening'

/**
 * Escalation ladder. `stop_and_refer` is terminal for the app: nothing more is
 * prescribed into that area and the screen says to see a professional (§15).
 */
export type EscalationLevel = 'none' | 'monitor' | 'downweight' | 'stop_and_refer'

export interface NiggleAssessment {
  bodyRegion: BodyRegion
  side: NiggleSide | null
  level: EscalationLevel
  /** Calendar days since it was first reported, inclusive of today. */
  daysActive: number
  currentSeverity: number
  peakSeverity: number
  trend: SeverityTrend
  sharp: boolean
  reports: number
  /** False once escalated — the engine stops prescribing into the area. */
  prescribeIntoRegion: boolean
  reason: string
  flag: string | null
}

/** How a niggle down-weights the rest of the week's load (§9). */
export interface TissueLoadAdjustment {
  /** Multiplier on planned running duration. */
  runDurationFactor: number
  /** Swap the week's hard day for something easier. */
  swapHardDay: boolean
  /** Days to keep watching before anything gets added back. */
  watchDays: number
  /** Impact work — plyos, hills, speed — comes off. */
  blockImpact: boolean
  /** Regions no exercise may be prescribed into. */
  blockedRegions: BodyRegion[]
  summary: string
}

export type PrehabMatchKind = 'region_and_tag' | 'tag' | 'region'

export interface PrehabMatch {
  protocol: PrehabExercise
  score: number
  matchedOn: PrehabMatchKind
}

export interface PrehabPrescription {
  items: SessionItem[]
  block: BlockKind
  /** True when the dose is aimed at a logged niggle rather than routine. */
  targeted: boolean
  adjustment: TissueLoadAdjustment | null
  why: string
  flag: string | null
  /** Persistent footer text required in prehab areas (§15). */
  disclaimer: string
}

// ── Stretching (framework §9) ─────────────────────────────────────────────────

export type StretchType = 'dynamic' | 'static'
export type StretchWhen = 'pre' | 'post' | 'recovery'

/** A row of src/data/stretches.json, which seeds `stretch_library`. */
export interface Stretch {
  id: string
  name: string
  type: StretchType
  target: string
  whenToUse: StretchWhen
  durationSec?: number
  reps?: number
  muscleText: string
  rationale: string
}

export interface StretchContext {
  band: ReadinessBand
  /** Quality run or heavy lifting today — the case static work must stay out of. */
  isQualityDay: boolean
  isRecoveryDay: boolean
  painFlagged?: boolean
  blockedRegions?: BodyRegion[]
}

export interface StaticPreVerdict {
  allowed: boolean
  maxHoldSec: number
  reason: string
}

export interface StretchPrescription {
  warmup: SessionItem[]
  cooldown: SessionItem[]
  /** True only when a short static hold survived into the warmup block. */
  staticInWarmup: boolean
  why: string
  flag: string | null
}
