import { prisma } from '@/lib/db'
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
  }))

  // Parse JSON fields for plyos
  const plyos: PlyoEntry[] = rawPlyos.map((row) => ({
    ...row,
    prerequisites: safeParseArray(row.prerequisites ?? '[]'),
  }))

  // Parse JSON fields for prehab
  const prehab: PrehabEntry[] = rawPrehab.map((row) => ({
    ...row,
    niggleTags: safeParseArray(row.niggleTags),
  }))

  // Stretches have no JSON array fields
  const stretches: StretchEntry[] = rawStretches.map((row) => ({ ...row }))

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
