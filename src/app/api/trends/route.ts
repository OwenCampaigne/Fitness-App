import { NextResponse } from 'next/server';
import { format } from 'date-fns';
import { fetchTrendData } from '@/lib/garmin';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const range = parseInt(url.searchParams.get('range') ?? '30');
  const date = url.searchParams.get('date') ?? format(new Date(), 'yyyy-MM-dd');

  if (![30, 90].includes(range)) {
    return NextResponse.json({ error: 'Invalid range. Use 30 or 90.' }, { status: 400 });
  }

  const points = await fetchTrendData(range, date);
  return NextResponse.json(points);
}
