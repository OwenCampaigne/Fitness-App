import { NextRequest, NextResponse } from 'next/server'
import { format } from 'date-fns'
import { syncGarmin } from '@/lib/syncGarmin'

export async function GET(req: NextRequest) {
  return handler(req)
}

export async function POST(req: NextRequest) {
  return handler(req)
}

async function handler(req: NextRequest) {
  const secret =
    req.nextUrl.searchParams.get('secret') ?? req.headers.get('x-cron-secret')

  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dateStr =
    req.nextUrl.searchParams.get('date') ?? format(new Date(), 'yyyy-MM-dd')

  try {
    const result = await syncGarmin(dateStr)
    if (!result.ok) {
      return NextResponse.json(result, { status: 503 })
    }
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/sync] error:', msg)
    return NextResponse.json({ error: msg }, { status: 503 })
  }
}
