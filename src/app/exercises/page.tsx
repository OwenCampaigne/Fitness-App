import { prisma } from '@/lib/db'
import { containsDiagnosisLanguage } from '@/lib/prehabEngine'
import type { ExerciseEntry, PlyoEntry, PrehabEntry, StretchEntry } from '@/types/library'
import ExercisesClient from './ExercisesClient'

export default async function ExercisesPage() {
  // Fetch all four catalogs
  const [rawExercises, rawPlyos, rawPrehab, rawStretches] = await Promise.all([
    prisma.exercise_library.findMany({ orderBy: { name: 'asc' } }),
    prisma.plyo_library.findMany({ orderBy: { progressionTier: 'asc' } }),
    prisma.prehab_library.findMany({ orderBy: { name: 'asc' } }),
    prisma.stretch_library.findMany({ orderBy: { name: 'asc' } }),
  ])

  // Parse JSON fields for exercises
  const exercises: ExerciseEntry[] = rawExercises.map((row) => ({
    ...row,
    primaryMuscles: safeParseArray(row.primaryMuscles),
    secondaryMuscles: safeParseArray(row.secondaryMuscles),
    instructions: safeParseArray(row.instructions),
    images: safeParseArray(row.images),
    equipment: safeParseArray(row.equipment),
    rationale: safeRationale(row.rationale),
  }))

  // Parse JSON fields for plyos
  const plyos: PlyoEntry[] = rawPlyos.map((row) => ({
    ...row,
    prerequisites: safeParseArray(row.prerequisites ?? '[]'),
    rationale: safeRationale(row.rationale),
  }))

  // Parse JSON fields for prehab
  const prehab: PrehabEntry[] = rawPrehab.map((row) => ({
    ...row,
    niggleTags: safeParseArray(row.niggleTags),
    rationale: safeRationale(row.rationale),
  }))

  // Stretches have no JSON array fields
  const stretches: StretchEntry[] = rawStretches.map((row) => ({
    ...row,
    rationale: safeRationale(row.rationale),
  }))

  return (
    <ExercisesClient
      exercises={exercises}
      plyos={plyos}
      prehab={prehab}
      stretches={stretches}
    />
  )
}

function safeParseArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Framework §15: no diagnosis language reaches the UI — and authored catalog
 * `rationale` copy is one of the three sources that gate applies to. Dropped
 * here, on the server, so a browsing screen cannot become the hole in the rule
 * and so the client never ships the catalog's medical vocabulary at all. The
 * structured `muscleText` / `targetTissue` fields say the same thing safely,
 * which is why the cards lead with them.
 */
function safeRationale(value: string | null | undefined): string | null {
  if (!value) return null
  return containsDiagnosisLanguage(value) ? null : value
}
