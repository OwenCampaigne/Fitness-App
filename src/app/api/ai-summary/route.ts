import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface WeeklyPayload {
  recovery:   number[];   // 0-100, 7 values
  hrv:        number[];   // ms
  sleepHours: number[];   // h
  rhr:        number[];   // bpm
  strain:     number[];   // 0-21
  profile?: {
    age?:          number;
    sex?:          string;
    fitnessLevel?: string;
    goal?:         string;
  };
}

function avg(arr: number[]): number {
  const v = arr.filter(x => x > 0);
  if (!v.length) return 0;
  return Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10;
}

function minVal(arr: number[]): number {
  const v = arr.filter(x => x > 0);
  return v.length ? Math.round(Math.min(...v) * 10) / 10 : 0;
}

function maxVal(arr: number[]): number {
  const v = arr.filter(x => x > 0);
  return v.length ? Math.round(Math.max(...v) * 10) / 10 : 0;
}

function trendLabel(arr: number[]): string {
  const v = arr.filter(x => x > 0);
  if (v.length < 3) return 'estable';
  const first = v.slice(0, Math.ceil(v.length / 2));
  const last  = v.slice(Math.floor(v.length / 2));
  const aFirst = first.reduce((s, x) => s + x, 0) / first.length;
  const aLast  = last.reduce((s, x) => s + x, 0) / last.length;
  const pct = ((aLast - aFirst) / aFirst) * 100;
  if (pct > 5)  return 'en aumento';
  if (pct < -5) return 'en descenso';
  return 'estable';
}

const FITNESS_ES: Record<string, string> = {
  beginner: 'principiante', intermediate: 'intermedio',
  advanced: 'avanzado', athlete: 'atleta',
};
const GOAL_ES: Record<string, string> = {
  recovery: 'recuperación', performance: 'rendimiento',
  weight_loss: 'pérdida de peso', general_health: 'salud general',
};

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not configured' },
      { status: 503 },
    );
  }

  let body: WeeklyPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { recovery, hrv, sleepHours, rhr, strain, profile } = body;

  const avgRec    = avg(recovery);
  const avgHrv    = avg(hrv);
  const avgSleep  = avg(sleepHours);
  const avgRhr    = avg(rhr);
  const avgStrain = avg(strain);

  const lines: string[] = [
    `Recuperación media: ${avgRec}% (mín ${minVal(recovery)}%, máx ${maxVal(recovery)}%, tendencia ${trendLabel(recovery)})`,
    `HRV media: ${avgHrv} ms (tendencia ${trendLabel(hrv)})`,
    `Sueño: ${avgSleep}h/noche (mín ${minVal(sleepHours)}h, máx ${maxVal(sleepHours)}h)`,
    `FC Reposo media: ${avgRhr} bpm (tendencia ${trendLabel(rhr)})`,
    `Esfuerzo medio: ${avgStrain}/21`,
  ];

  if (profile) {
    const parts: string[] = [];
    if (profile.age)          parts.push(`${profile.age} años`);
    if (profile.sex)          parts.push(profile.sex === 'male' ? 'hombre' : 'mujer');
    if (profile.fitnessLevel) parts.push(`nivel ${FITNESS_ES[profile.fitnessLevel] ?? profile.fitnessLevel}`);
    if (profile.goal)         parts.push(`objetivo ${GOAL_ES[profile.goal] ?? profile.goal}`);
    if (parts.length) lines.push(`Perfil: ${parts.join(', ')}`);
  }

  const prompt = `Eres un coach de salud y bienestar especializado en métricas de recuperación. Analiza los siguientes datos de la última semana de un usuario de Garmin y escribe un resumen personalizado en español. El resumen debe tener exactamente 3-4 oraciones (máximo 110 palabras), ser concreto con los números, positivo pero honesto, y terminar con 1 recomendación práctica y específica para los próximos días. No uses listas ni viñetas, solo párrafo corrido.

Datos de la semana:
${lines.join('\n')}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[ai-summary] Anthropic error:', err);
      return NextResponse.json({ error: 'Anthropic API error' }, { status: 502 });
    }

    const data = await response.json();
    const text: string = data.content?.[0]?.text ?? '';
    return NextResponse.json({ summary: text });
  } catch (err) {
    console.error('[ai-summary] fetch error:', err);
    return NextResponse.json({ error: 'Network error' }, { status: 502 });
  }
}
