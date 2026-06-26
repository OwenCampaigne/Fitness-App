import path from 'path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../generated/prisma/client'

function createPrismaClient(): PrismaClient {
  // DATABASE_URL is "file:./dev.db"; strip the "file:" prefix for the adapter
  const dbUrl = (process.env.DATABASE_URL ?? 'file:./prisma/dev.db').replace(
    /^file:/,
    ''
  )
  // Resolve relative to the project root (cwd), not this file
  const dbPath = path.isAbsolute(dbUrl) ? dbUrl : path.resolve(process.cwd(), dbUrl)
  const adapter = new PrismaBetterSqlite3({ url: dbPath })
  return new PrismaClient({ adapter })
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
