import * as path from 'path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client'

const EXERCISES_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json'

interface RawExercise {
  id: string
  name: string
  force?: string | null
  level?: string | null
  mechanic?: string | null
  equipment?: string | null
  primaryMuscles: string[]
  secondaryMuscles: string[]
  instructions: string[]
  category?: string | null
  images: string[]
}

async function main() {
  const dbPath = path.resolve(process.cwd(), 'prisma/dev.db')
  const adapter = new PrismaBetterSqlite3({ url: dbPath })
  const prisma = new PrismaClient({ adapter })

  try {
    console.log(`Fetching exercises from ${EXERCISES_URL} ...`)
    const response = await fetch(EXERCISES_URL, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const exercises: RawExercise[] = await response.json()
    console.log(`Fetched ${exercises.length} exercises. Upserting into exercise_library...`)

    let count = 0
    for (const ex of exercises) {
      await prisma.exercise_library.upsert({
        where: { id: ex.id },
        update: {
          name: ex.name,
          primaryMuscles: JSON.stringify(ex.primaryMuscles),
          secondaryMuscles: JSON.stringify(ex.secondaryMuscles),
          equipment: JSON.stringify(ex.equipment != null ? [ex.equipment] : []),
          level: ex.level ?? null,
          mechanic: ex.mechanic ?? null,
          force: ex.force ?? null,
          category: ex.category ?? null,
          instructions: JSON.stringify(ex.instructions),
          images: JSON.stringify(ex.images),
          source: 'free-exercise-db',
        },
        create: {
          id: ex.id,
          name: ex.name,
          primaryMuscles: JSON.stringify(ex.primaryMuscles),
          secondaryMuscles: JSON.stringify(ex.secondaryMuscles),
          equipment: JSON.stringify(ex.equipment != null ? [ex.equipment] : []),
          level: ex.level ?? null,
          mechanic: ex.mechanic ?? null,
          force: ex.force ?? null,
          category: ex.category ?? null,
          instructions: JSON.stringify(ex.instructions),
          images: JSON.stringify(ex.images),
          source: 'free-exercise-db',
        },
      })
      count++
      if (count % 100 === 0) {
        console.log(`  ...upserted ${count} exercises`)
      }
    }

    const total = await prisma.exercise_library.count()
    console.log(`Seeded ${count} exercises.`)
    console.log(`Total exercises in DB: ${total}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
