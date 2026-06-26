#!/usr/bin/env node
/**
 * Creates the GitHub repo (if needed), adds the remote, pushes, and
 * creates all roadmap labels + issues.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node scripts/create-github-issues.js
 *
 * Get a token at https://github.com/settings/tokens/new
 * Required scopes: repo (all), workflow
 */

const { execSync } = require('child_process');
const https = require('https');

// ── Config ─────────────────────────────────────────────────────────────────
const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = 'cggmx';
const REPO  = 'garmin-health-dashboard';

if (!TOKEN) {
  console.error('❌  Falta GITHUB_TOKEN. Ejecútalo así:\n   GITHUB_TOKEN=ghp_xxx node scripts/create-github-issues.js');
  process.exit(1);
}

// ── HTTP helper ────────────────────────────────────────────────────────────
function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Accept':        'application/vnd.github+json',
        'User-Agent':    'garmin-health-setup',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        const json = data ? JSON.parse(data) : {};
        if (res.statusCode >= 400 && res.statusCode !== 422) {
          reject(new Error(`${method} ${path} → ${res.statusCode}: ${JSON.stringify(json)}`));
        } else {
          resolve({ status: res.statusCode, body: json });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Labels ─────────────────────────────────────────────────────────────────
const LABELS = [
  { name: 'fase-4',     color: '7c3aed', description: 'Motor de Insights' },
  { name: 'fase-5',     color: '2563eb', description: 'UI de Insights' },
  { name: 'fase-6',     color: '0891b2', description: 'Resumen IA con Claude' },
  { name: 'bug',        color: 'd73a4a', description: 'Error o dato incorrecto' },
  { name: 'mejora',     color: '0075ca', description: 'Mejora de feature existente' },
  { name: 'infra',      color: 'e4e669', description: 'API, auth, rendimiento' },
];

// ── Issues ─────────────────────────────────────────────────────────────────
const ISSUES = [
  // ── FASE 4 ──────────────────────────────────────────────────────────────
  {
    title: '[Fase 4] Motor de Insights — detección de patrones rule-based',
    labels: ['fase-4'],
    body: `## Objetivo
Construir un motor de reglas que analice los datos diarios del usuario y genere **insights accionables** contextualizados con su perfil y benchmarks.

## Entregables

### \`src/lib/insights.ts\`
Tipos y funciones puras:
\`\`\`typescript
export type Severity = 'info' | 'warning' | 'alert' | 'positive';

export interface Insight {
  id: string;
  metric: 'hrv' | 'rhr' | 'sleep' | 'strain' | 'battery' | 'stress' | 'steps';
  severity: Severity;
  headline: string;          // ej. "HRV 18% por debajo de tu media"
  body: string;              // explicación breve (1-2 frases)
  recommendation: string;    // acción concreta
  value?: number;            // valor medido
  delta?: number;            // cambio vs baseline
}

export function generateInsights(
  data: DailyMetrics,
  profile: UserProfile,
  benchmarks: ProfileBenchmarks,
): Insight[]
\`\`\`

### Reglas a implementar (mínimo)
- [ ] HRV lastNight < 85% de weeklyAverage → \`warning\`
- [ ] HRV lastNight < 70% de weeklyAverage → \`alert\`
- [ ] HRV percentil < 25 para grupo de edad → \`warning\`
- [ ] RHR > baseline + 5 bpm → \`warning\`
- [ ] Sueño total < 6h → \`alert\`
- [ ] Sueño total < 7h → \`warning\`
- [ ] Sueño percentil < 25 para grupo de edad → \`warning\`
- [ ] Strain > 16 dos días consecutivos → \`warning\`
- [ ] Body Battery < 20 al final del día → \`alert\`
- [ ] Estrés alto > 40% del día → \`warning\`
- [ ] Pasos < 3.000 → \`info\`
- [ ] HRV en racha positiva 3+ días → \`positive\`
- [ ] Sueño > 8h con buen % profundo → \`positive\`

### Integrar en \`/api/health\`
\`\`\`diff
+ insights: Insight[];
\`\`\`

## Criterios de aceptación
- [ ] Genera 0-5 insights por sesión (prioridad por severity)
- [ ] No genera insights si el dato no está disponible (0 o null)
- [ ] Funciones puras 100% testeables sin API calls
- [ ] Tipos añadidos a \`DailyMetrics\` en \`types.ts\`
`,
  },

  // ── FASE 5 ──────────────────────────────────────────────────────────────
  {
    title: '[Fase 5] UI de Insights — tarjetas de alerta y recomendación',
    labels: ['fase-5'],
    body: `## Objetivo
Mostrar los insights del motor (Fase 4) en el dashboard con un diseño visual claro y jerarquía por severidad.

## Entregables

### \`src/components/InsightsCard.tsx\`
Tarjeta que recibe \`Insight[]\` y los renderiza:

\`\`\`
┌─────────────────────────────────────────┐
│ ⚡ Insights del día        2 alertas    │
│─────────────────────────────────────────│
│ 🔴 HRV 22% por debajo de tu media       │
│    "Prioriza descanso y reduce carga    │
│     de entrenamiento hoy."              │
│─────────────────────────────────────────│
│ 🟡 Solo 6h 10m de sueño                 │
│    "Intenta acostarte 45 min antes      │
│     mañana para recuperar el déficit."  │
│─────────────────────────────────────────│
│ 🟢 FC reposo 3 bpm por debajo de media  │
│    "Buena señal de recuperación         │
│     cardiovascular esta semana."        │
└─────────────────────────────────────────┘
\`\`\`

### Iconos por severidad
| Severity  | Icono   | Color          |
|-----------|---------|----------------|
| alert     | ⚠️ / 🔴 | recovery-red   |
| warning   | 🟡      | recovery-yellow|
| positive  | ✅ / 🟢 | recovery-green |
| info      | ℹ️      | secondary      |

### Integración en Dashboard
- Mostrar \`InsightsCard\` entre \`RecoveryScore\` y \`SleepCard\`
- Solo visible si hay ≥ 1 insight
- Collapsable si hay > 3 insights

### Página \`/insights\` (opcional)
- Lista completa de todos los insights con historial (7 días)

## Criterios de aceptación
- [ ] Cada insight muestra: headline + body + recommendation
- [ ] Color-coded por severity
- [ ] Sin perfil → no se muestra (graceful degradation)
- [ ] Sin insights generados → no ocupa espacio en el dashboard
`,
  },

  // ── FASE 6 ──────────────────────────────────────────────────────────────
  {
    title: '[Fase 6] Resumen semanal con IA — integración Claude API',
    labels: ['fase-6'],
    body: `## Objetivo
Generar un resumen narrativo semanal personalizado usando la API de Anthropic Claude, que interprete las tendencias del usuario en lenguaje natural.

## Entregables

### \`/api/summary\` (nuevo endpoint)
\`\`\`typescript
// Recibe:
{
  weeklyTrend: WeeklyTrend,
  profile: UserProfile,
  benchmarks: ProfileBenchmarks,
  latestMetrics: DailyMetrics,
}

// Devuelve:
{
  summary: string,   // 200-300 palabras en español
  generatedAt: string,
}
\`\`\`

### Prompt engineering
Construir un prompt detallado que:
- Incluya el perfil del usuario (edad, sexo, nivel, objetivo)
- Proporcione los percentiles vs. su grupo de edad
- Incluya los 7 días de HRV, sueño, FC reposo y esfuerzo
- Pida un resumen en tono de coach/médico, en español
- Incluya: puntos destacados, tendencias, 1-2 recomendaciones

### \`src/app/summary/page.tsx\`
- Botón "Generar resumen" (llama a \`/api/summary\` on demand)
- Loading state con skeleton
- Muestra el resumen con tipografía legible
- Badge "Generado el [fecha] · Modelo Claude"
- Accesible desde BottomNav o desde el dashboard

### Variable de entorno necesaria
\`\`\`
ANTHROPIC_API_KEY=sk-ant-xxx
\`\`\`

## Criterios de aceptación
- [ ] Respuesta < 10 segundos (usar streaming si es necesario)
- [ ] Sin \`ANTHROPIC_API_KEY\` → UI muestra aviso de configuración
- [ ] El resumen menciona métricas reales del usuario (no genérico)
- [ ] Solo accesible si hay perfil configurado
`,
  },

  // ── BUGS ─────────────────────────────────────────────────────────────────
  {
    title: '[Bug] HRV real de Garmin devuelve 404 — endpoint correcto pendiente',
    labels: ['bug', 'infra'],
    body: `## Descripción
El endpoint de HRV de Garmin Connect devuelve 404 al llamar desde la API de producción. El HRV se muestra actualmente con datos simulados generados por \`buildHrvTrend()\`.

## Contexto
En \`src/lib/garmin.ts\` se intenta:
\`\`\`typescript
gc.get(\`https://connectapi.garmin.com/hrv-service/hrv/\${date}\`)
\`\`\`
Resultado: **404 Not Found**. Se probó también \`/hrv-service/hrv/daily/\${date}\` con el mismo resultado.

## Investigación necesaria
- [ ] Revisar el endpoint correcto en la documentación no oficial de Garmin Connect API
- [ ] Probar: \`/wellness-service/wellness/dailyHeartRate/\${userDisplayName}?date=\${date}\`
- [ ] Probar con el debug endpoint \`/api/debug\` para ver respuesta raw
- [ ] Verificar si requiere parámetros adicionales de autenticación

## Impacto
- Sin datos reales de HRV no se puede mostrar tendencia de 7 días precisa
- El cálculo de Recovery Score usa valores simulados para el componente HRV

## Referencias
- [Garmin Connect API (no oficial)](https://github.com/tcgoetz/GarminDB)
- Paquete usado: \`garmin-connect@1.6.2\`
`,
  },
  {
    title: '[Bug] Body Battery real de Garmin devuelve 404 — endpoint correcto pendiente',
    labels: ['bug', 'infra'],
    body: `## Descripción
El endpoint de Body Battery de Garmin Connect devuelve 404. Se muestra actualmente con valor por defecto de 50.

## Contexto
En \`src/lib/garmin.ts\` se intenta:
\`\`\`typescript
gc.get(\`https://connectapi.garmin.com/wellness-service/wellness/bodyBattery/event/\${date}/\${date}\`)
\`\`\`
Resultado: **404 Not Found**.

## Investigación necesaria
- [ ] Probar: \`/wellness-service/wellness/bodyBattery/reading/\${date}\`
- [ ] Probar: \`/wellness-service/wellness/dailyBodyBattery/\${userDisplayName}?date=\${date}\`
- [ ] Probar con debug endpoint para ver la respuesta raw
- [ ] Verificar el userDisplayName del usuario autenticado

## Impacto
- La tarjeta de Body Battery siempre muestra 50 (valor por defecto)
- La barra de cargado/drenado no refleja datos reales
- No hay datos para el gráfico de área

## Referencias
- [garmin-connect npm package](https://www.npmjs.com/package/garmin-connect)
`,
  },

  // ── MEJORAS ──────────────────────────────────────────────────────────────
  {
    title: '[Mejora] Página de Sueño — eficiencia, tendencia 7 días y comparativa',
    labels: ['mejora'],
    body: `## Objetivo
Enriquecer la página \`/sleep\` con métricas de eficiencia, tendencia semanal y comparativa con benchmarks de edad.

## Features propuestas
- [ ] **Eficiencia del sueño** = tiempo dormido / tiempo en cama × 100
  - Mostrar como valor y barra (referencia: ≥ 85% = bueno)
- [ ] **Tendencia 7 días** de duración total (sparkline o bar chart)
- [ ] **Comparativa de fases** con distribución recomendada
  - Profundo: meta 20%, REM: meta 25%
  - Indicador de déficit/superávit por fase
- [ ] **Deuda de sueño acumulada** = diferencia vs. 8h × 7 días
- [ ] **Benchmark de duración** (ya existe \`BenchmarkBadge\`, integrar aquí también)
- [ ] **Calidad del sueño** en gráfico histórico (7 noches)
`,
  },
  {
    title: '[Mejora] Página de Tendencias — líneas de referencia y ranking por benchmarks',
    labels: ['mejora'],
    body: `## Objetivo
Añadir líneas de referencia (p50 de edad) en los gráficos de tendencias y mostrar ranking de percentil en el contexto histórico.

## Features propuestas
- [ ] **Línea de referencia p50** en cada gráfico de Recharts
  - HRV: línea punteada en la mediana del grupo de edad
  - FC reposo: línea punteada en p50
  - Sueño: línea punteada en 7.3h (mediana 35-44 años)
- [ ] **Zona verde/amarilla** en el fondo del gráfico (rangos saludables)
- [ ] **Percentil promedio de la semana** mostrado como chip encima del gráfico
  - ej. "Tu HRV esta semana: percentil 37 (Normal)"
- [ ] **Selector de rango**: 7 días / 30 días / 90 días
- [ ] **Exportar datos** como CSV (opcional)

## Dependencias
- Requiere Fase 3 (benchmarks) — ✅ ya implementada
- Los datos de tendencias de 30/90 días requieren nuevo endpoint Garmin
`,
  },
];

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  try {
    // 1. Create repo
    console.log(`\n📦 Creando repositorio ${OWNER}/${REPO}…`);
    const createRes = await api('POST', '/user/repos', {
      name: REPO,
      description: 'Dashboard de salud personal conectado a Garmin — Next.js + TypeScript',
      private: false,
      auto_init: false,
    });
    if (createRes.status === 422) {
      console.log('   → Repositorio ya existe, continuando…');
    } else {
      console.log(`   ✅ Repositorio creado: ${createRes.body.html_url}`);
    }

    // 2. Add remote & push
    console.log('\n🔗 Añadiendo remote y haciendo push…');
    const remoteUrl = `https://${TOKEN}@github.com/${OWNER}/${REPO}.git`;
    try {
      execSync('git remote remove origin 2>/dev/null || true', { stdio: 'pipe' });
      execSync(`git remote add origin ${remoteUrl}`, { stdio: 'pipe' });
      execSync('git push -u origin main', { stdio: 'inherit' });
      console.log('   ✅ Push completado');
    } catch (e) {
      console.error('   ❌ Error en push:', e.message);
    }

    // 3. Create labels
    console.log('\n🏷️  Creando etiquetas…');
    for (const label of LABELS) {
      const res = await api('POST', `/repos/${OWNER}/${REPO}/labels`, label);
      const status = res.status === 422 ? 'ya existe' : '✅';
      console.log(`   ${status}  ${label.name}`);
    }

    // 4. Create issues
    console.log('\n📋 Creando issues…');
    for (const issue of ISSUES) {
      const res = await api('POST', `/repos/${OWNER}/${REPO}/issues`, issue);
      console.log(`   ✅ #${res.body.number} — ${issue.title}`);
      await new Promise(r => setTimeout(r, 300)); // small delay to avoid rate limit
    }

    console.log(`\n🎉 Todo listo: https://github.com/${OWNER}/${REPO}/issues\n`);
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
})();
