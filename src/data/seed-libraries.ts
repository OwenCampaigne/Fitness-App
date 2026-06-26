import * as path from 'path'
import * as fs from 'fs'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../generated/prisma/client'

interface PlyoEntry {
  id: string
  name: string
  intensity: string
  contactLoad: string
  progressionTier: number
  prerequisites: string[]
  target: string
  videoUrl: string | null
  muscleText: string
  rationale: string
  evidence?: string
}

interface PrehabEntry {
  id: string
  name: string
  bodyRegion: string
  category: string
  niggleTags: string[]
  targetTissue: string
  videoUrl: string | null
  muscleText: string
  rationale: string
  evidence?: string
}

interface StretchEntry {
  id: string
  name: string
  type: string
  target: string
  whenToUse: string
  durationSec?: number
  reps?: number
  muscleText: string
  rationale: string
}

async function main() {
  const dbPath = path.resolve(process.cwd(), 'prisma/dev.db')
  const adapter = new PrismaBetterSqlite3({ url: dbPath })
  const prisma = new PrismaClient({ adapter })

  try {
    // ── Plyos ──────────────────────────────────────────────────────────────────
    const plyosPath = path.resolve(__dirname, 'plyos.json')
    const plyos: PlyoEntry[] = JSON.parse(fs.readFileSync(plyosPath, 'utf-8'))
    console.log(`Upserting ${plyos.length} plyo exercises...`)

    for (const p of plyos) {
      await prisma.plyo_library.upsert({
        where: { id: p.id },
        update: {
          name: p.name,
          intensity: p.intensity,
          contactLoad: p.contactLoad,
          progressionTier: p.progressionTier,
          prerequisites: JSON.stringify(p.prerequisites),
          target: p.target,
          videoUrl: p.videoUrl ?? null,
          muscleText: p.muscleText,
          rationale: p.rationale,
          evidence: p.evidence ?? null,
        },
        create: {
          id: p.id,
          name: p.name,
          intensity: p.intensity,
          contactLoad: p.contactLoad,
          progressionTier: p.progressionTier,
          prerequisites: JSON.stringify(p.prerequisites),
          target: p.target,
          videoUrl: p.videoUrl ?? null,
          muscleText: p.muscleText,
          rationale: p.rationale,
          evidence: p.evidence ?? null,
        },
      })
    }
    console.log(`  Done. Total plyo rows: ${await prisma.plyo_library.count()}`)

    // ── Prehab ─────────────────────────────────────────────────────────────────
    const prehabPath = path.resolve(__dirname, 'prehab.json')
    const prehab: PrehabEntry[] = JSON.parse(fs.readFileSync(prehabPath, 'utf-8'))
    console.log(`Upserting ${prehab.length} prehab exercises...`)

    for (const h of prehab) {
      await prisma.prehab_library.upsert({
        where: { id: h.id },
        update: {
          name: h.name,
          bodyRegion: h.bodyRegion,
          category: h.category,
          niggleTags: JSON.stringify(h.niggleTags),
          targetTissue: h.targetTissue,
          videoUrl: h.videoUrl ?? null,
          muscleText: h.muscleText,
          rationale: h.rationale,
          evidence: h.evidence ?? null,
        },
        create: {
          id: h.id,
          name: h.name,
          bodyRegion: h.bodyRegion,
          category: h.category,
          niggleTags: JSON.stringify(h.niggleTags),
          targetTissue: h.targetTissue,
          videoUrl: h.videoUrl ?? null,
          muscleText: h.muscleText,
          rationale: h.rationale,
          evidence: h.evidence ?? null,
        },
      })
    }
    console.log(`  Done. Total prehab rows: ${await prisma.prehab_library.count()}`)

    // ── Stretches ──────────────────────────────────────────────────────────────
    const stretchesPath = path.resolve(__dirname, 'stretches.json')
    const stretches: StretchEntry[] = JSON.parse(fs.readFileSync(stretchesPath, 'utf-8'))
    console.log(`Upserting ${stretches.length} stretches...`)

    for (const s of stretches) {
      await prisma.stretch_library.upsert({
        where: { id: s.id },
        update: {
          name: s.name,
          type: s.type,
          target: s.target,
          whenToUse: s.whenToUse,
          durationSec: s.durationSec ?? null,
          reps: s.reps ?? null,
          muscleText: s.muscleText,
          rationale: s.rationale,
        },
        create: {
          id: s.id,
          name: s.name,
          type: s.type,
          target: s.target,
          whenToUse: s.whenToUse,
          durationSec: s.durationSec ?? null,
          reps: s.reps ?? null,
          muscleText: s.muscleText,
          rationale: s.rationale,
        },
      })
    }
    console.log(`  Done. Total stretch rows: ${await prisma.stretch_library.count()}`)

    console.log('\nLibrary seed complete.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('Library seed failed:', err)
  process.exit(1)
})
