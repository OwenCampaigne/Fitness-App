export interface ExerciseEntry {
  id: string
  name: string
  primaryMuscles: string[]     // parsed from JSON string
  secondaryMuscles: string[]
  equipment: string[]
  level?: string | null
  mechanic?: string | null
  force?: string | null
  category?: string | null
  instructions: string[]       // parsed from JSON string
  images: string[]             // parsed from JSON string
  muscleText?: string | null
  rationale?: string | null
  evidence?: string | null
  source: string
}

export interface PlyoEntry {
  id: string
  name: string
  intensity?: string | null
  contactLoad?: string | null
  progressionTier: number
  prerequisites: string[]      // parsed from JSON string
  target?: string | null
  videoUrl?: string | null
  muscleText?: string | null
  rationale?: string | null
  evidence?: string | null
}

export interface PrehabEntry {
  id: string
  name: string
  bodyRegion: string
  category: string
  niggleTags: string[]         // parsed from JSON string
  targetTissue?: string | null
  videoUrl?: string | null
  muscleText?: string | null
  rationale?: string | null
  evidence?: string | null
}

export interface StretchEntry {
  id: string
  name: string
  type: string                 // "dynamic" | "static"
  target?: string | null
  whenToUse: string            // "pre" | "post" | "recovery"
  durationSec?: number | null
  reps?: number | null
  muscleText?: string | null
  rationale?: string | null
}
