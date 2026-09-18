'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import Link from 'next/link';
import { ArrowLeft, Flame, Scale, Activity, ShieldAlert } from 'lucide-react';
import type { DailyMetrics, TrendPoint } from '@/lib/types';
import StrainCard from '@/components/StrainCard';
import BottomNav from '@/components/BottomNav';
import { formatDuration } from '@/lib/scoring';

// `scoring.ts` still returns the pre-redesign hexes and is off-limits, so the
// same thresholds are restated here against the log's tokens. Strain is a
// quantity (series ramp); recovery is a verdict (ready/caution/stop).
const getStrainColor = (strain: number) =>
  strain <= 8 ? 'var(--chart-1)' : strain <= 14 ? 'var(--chart-4)' : 'var(--stop)';
const getCategoryColor = (score: number) =>
  score >= 67 ? 'var(--ready)' : score >= 34 ? 'var(--caution)' : 'var(--stop)';
import { useLang } from '@/lib/i18n';

const ACTIVITY_ICONS: Record<string, string> = {
  running: '🏃',
  cycling: '🚴',
  swimming: '🏊',
  walking: '🚶',
  strength_training: '🏋️',
  yoga: '🧘',
  other: '⚡',
};

// Activity labels will be set via t() inside the component

// ── ACWR helpers ──────────────────────────────────────────────────────────────
interface ACWRResult {
  acute: number;    // 7-day rolling average strain
  chronic: number;  // 28-day rolling average strain
  ratio: number;
  zone: 'undertrain' | 'optimal' | 'moderate' | 'high' | 'danger';
  label: string;
  color: string;
  desc: string;
  hasData: boolean;
}

function computeACWR(points: TrendPoint[]): ACWRResult {
  const valid = points.filter(p => p.strain > 0);
  const hasData = valid.length >= 14; // need reasonable history

  const last28 = points.slice(-28);
  const last7  = points.slice(-7);

  const chronic = last28.length
    ? last28.reduce((s, p) => s + p.strain, 0) / last28.length
    : 0;
  const acute = last7.length
    ? last7.reduce((s, p) => s + p.strain, 0) / last7.length
    : 0;

  const ratio = chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : 0;

  let zone: ACWRResult['zone'];
  let label: string;
  let color: string;
  let desc: string;

  if (ratio === 0) {
    zone = 'optimal'; label = ''; color = 'var(--faint)'; desc = '';
  } else if (ratio < 0.8) {
    zone = 'undertrain'; label = ''; color = 'var(--chart-1)'; desc = '';
  } else if (ratio <= 1.0) {
    zone = 'optimal'; label = ''; color = 'var(--ready)'; desc = '';
  } else if (ratio <= 1.3) {
    zone = 'moderate'; label = ''; color = 'var(--caution)'; desc = '';
  } else if (ratio <= 1.5) {
    zone = 'high'; label = ''; color = 'var(--chart-4)'; desc = '';
  } else {
    zone = 'danger'; label = ''; color = 'var(--stop)'; desc = '';
  }

  return { acute: Math.round(acute * 10) / 10, chronic: Math.round(chronic * 10) / 10, ratio, zone, label, color, desc, hasData };
}

export default function StrainPage() {
  const { t: translate } = useLang();
  const [data, setData] = useState<DailyMetrics | null>(null);
  const [trends, setTrends] = useState<TrendPoint[] | null>(null);

  const ACTIVITY_LABELS: Record<string, string> = {
    running: translate('strain.activityTypes.running'),
    cycling: translate('strain.activityTypes.cycling'),
    swimming: translate('strain.activityTypes.swimming'),
    walking: translate('strain.activityTypes.walking'),
    strength_training: translate('strain.activityTypes.strength'),
    yoga: translate('strain.activityTypes.yoga'),
    other: translate('strain.activityTypes.other'),
  };

  const ACWR_LABELS: Record<string, { label: string; desc: string }> = {
    undertrain: { label: translate('strain.acwr.zones.detraining'), desc: translate('strain.acwr.zones.detrainingDesc') },
    optimal:    { label: translate('strain.acwr.zones.optimal'),    desc: translate('strain.acwr.zones.optimalDesc') },
    moderate:   { label: translate('strain.acwr.zones.moderate'),   desc: translate('strain.acwr.zones.moderateDesc') },
    high:       { label: translate('strain.acwr.zones.high'),       desc: translate('strain.acwr.zones.highDesc') },
    danger:     { label: translate('strain.acwr.zones.danger'),     desc: translate('strain.acwr.zones.dangerDesc') },
  };

  useEffect(() => {
    const localDate = format(new Date(), 'yyyy-MM-dd');
    fetch(`/api/health?date=${localDate}`).then(r => r.json()).then(setData);
    fetch(`/api/trends?range=30&date=${localDate}`)
      .then(r => r.json())
      .then((pts: TrendPoint[]) => setTrends(pts.length > 0 ? pts : null))
      .catch(() => setTrends(null));
  }, []);

  if (!data) {
    return (
      <div className="min-h-screen bg-paper">
        <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur border-b border-rule">
          <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
            <Link href="/" className="p-1.5 hover:bg-wash text-pencil hover:text-ink transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <Flame size={16} className="text-strain" />
            <h1 className="font-serif text-head text-ink">{translate('strain.detailTitle')}</h1>
          </div>
        </header>
        <main className="max-w-md mx-auto px-4 pb-28 pt-4 flex flex-col gap-4">
          <div className="animate-pulse bg-wash h-32" />
          <div className="animate-pulse bg-wash h-64" />
          <div className="animate-pulse bg-wash h-48" />
          <div className="animate-pulse bg-wash h-40" />
        </main>
        <BottomNav />
      </div>
    );
  }

  const todayStrain = data.strain;
  const acwr = trends ? computeACWR(trends) : null;
  const strainSeries = data.weeklyTrend.strain;
  const recoverySeries = data.weeklyTrend.recovery;
  const dates = data.weeklyTrend.dates;

  // 7-day stats
  const validStrain = strainSeries.filter(s => s > 0);
  const avgStrain = validStrain.length
    ? validStrain.reduce((a, b) => a + b, 0) / validStrain.length
    : 0;

  // Balance: normalize strain to 0-100, compare with recovery
  const strainNorm = Math.round((todayStrain / 21) * 100);
  const todayRecovery = data.recovery.score;
  const balance = todayRecovery - strainNorm;
  const balanceLabel =
    balance >= 20 ? translate('common.low') : balance >= 0 ? translate('common.balance') : translate('common.high');
  const balanceColor =
    balance >= 20 ? 'var(--ready)' : balance >= 0 ? 'var(--caution)' : 'var(--stop)';

  // 7-day bar chart scale
  const maxStrain = Math.max(14, ...strainSeries);

  // Activity type aggregation (today)
  const actByType = data.activities.reduce<
    Record<string, { type: string; strain: number; duration: number; calories: number; count: number }>
  >((acc, act) => {
    const key = act.type;
    if (!acc[key]) acc[key] = { type: key, strain: 0, duration: 0, calories: 0, count: 0 };
    acc[key].strain += act.strain;
    acc[key].duration += act.duration;
    acc[key].calories += act.calories;
    acc[key].count += 1;
    return acc;
  }, {});
  const byType = Object.values(actByType).sort((a, b) => b.strain - a.strain);
  const totalTodayStrain = byType.reduce((s, t) => s + t.strain, 0);

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur border-b border-rule">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="p-1.5 hover:bg-wash text-pencil hover:text-ink transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <Flame size={16} className="text-strain" />
          <h1 className="font-serif text-head text-ink">{translate('strain.detailTitle')}</h1>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-28 pt-4 flex flex-col gap-4">

        {/* ── Stats row ─────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          {/* Hoy */}
          <div className="card text-center">
            <p className="text-xs text-pencil mb-1">{translate('common.today')}</p>
            <p className="text-2xl font-bold leading-none" style={{ color: getStrainColor(todayStrain) }}>
              {todayStrain.toFixed(1)}
            </p>
            <p className="text-xs text-faint mt-1">/ 21</p>
          </div>

          {/* Promedio 7d */}
          <div className="card text-center">
            <p className="text-xs text-pencil mb-1">{translate('common.avg7d')}</p>
            <p className="text-2xl font-bold leading-none" style={{ color: getStrainColor(avgStrain) }}>
              {avgStrain.toFixed(1)}
            </p>
            <p className="text-xs text-faint mt-1">/ 21</p>
          </div>

          {/* Balance */}
          <div className="card text-center">
            <p className="text-xs text-pencil mb-1">{translate('strain.balance.title')}</p>
            <p className="text-sm font-bold leading-none mt-1" style={{ color: balanceColor }}>
              {balanceLabel}
            </p>
            <p className="text-xs text-faint mt-1">{translate('strain.balance.cargaVsRec')}</p>
          </div>
        </div>

        {/* ── Today's strain detail ──────────────────────────────── */}
        <StrainCard activities={data.activities} todayStrain={todayStrain} steps={data.steps} floorsAscended={data.floorsAscended} highlyActiveSeconds={data.highlyActiveSeconds} bodyBatteryDrained={data.bodyBattery.drained} />

        {/* ── 7-day strain bar chart ─────────────────────────────── */}
        <div className="card">
          <div className="card-header mb-4">
            <Flame size={14} className="text-strain" />
            <span>{translate('strain.balance.chartTitle')}</span>
            <span className="ml-auto text-xs text-faint">{translate('strain.balance.avgLabel', { avg: avgStrain.toFixed(1) })}</span>
          </div>

          <div className="flex items-end justify-between gap-1.5 h-28 relative">
            {/* High-zone reference line at 14 */}
            <div
              className="absolute left-0 right-0 border-t border-dashed border-rule"
              style={{ bottom: `${(14 / maxStrain) * 100}%` }}
            />
            {strainSeries.map((s, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs font-medium" style={{ color: s > 0 ? getStrainColor(s) : 'var(--faint)' }}>
                  {s > 0 ? s.toFixed(1) : '—'}
                </span>
                <div
                  className="w-full transition-all"
                  style={{
                    height: `${s > 0 ? (s / maxStrain) * 100 : 0}%`,
                    backgroundColor: s > 0 ? getStrainColor(s) : 'var(--rule)',
                    minHeight: s > 0 ? 4 : 0,
                  }}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-between mt-2">
            {dates.map((d, i) => (
              <span key={i} className="flex-1 text-center text-xs text-faint">{d}</span>
            ))}
          </div>

          {/* Zone legend */}
          <div className="flex gap-3 mt-3 pt-3 border-t border-rule">
            {[
              { label: translate('trends.recovery'), color: 'var(--chart-1)', range: '≤8' },
              { label: translate('common.moderate'), color: 'var(--chart-4)', range: '≤14' },
              { label: translate('common.high'), color: 'var(--stop)', range: '>14' },
            ].map(z => (
              <div key={z.label} className="flex items-center gap-1.5">
                <div className="w-2 h-2" style={{ backgroundColor: z.color }} />
                <span className="text-xs text-faint">{z.label}</span>
                <span className="text-xs text-faint">{z.range}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Balance carga / recuperación (7d) ─────────────────── */}
        <div className="card">
          <div className="card-header mb-4">
            <Scale size={14} className="text-pencil" />
            <span>{translate('strain.balance.title')}</span>
            <span className="ml-auto text-xs text-faint">{translate('strain.balance.period')}</span>
          </div>

          {/* Dual-bar chart: strain (norm 0-100) vs recovery (0-100) */}
          <div className="flex items-end justify-between gap-1 h-32 relative">
            {strainSeries.map((s, i) => {
              const sNorm = Math.round((s / 21) * 100);
              const rec = recoverySeries[i] ?? 0;
              const hasData = s > 0 || rec > 0;
              return (
                <div key={i} className="flex-1 flex items-end gap-0.5 h-full">
                  {/* Strain bar */}
                  <div className="flex-1 flex flex-col justify-end h-full">
                    <div
                      className="w-full"
                      style={{
                        height: `${hasData ? sNorm : 0}%`,
                        backgroundColor: hasData ? 'var(--chart-4)' : 'var(--rule)',
                        minHeight: hasData && sNorm > 0 ? 3 : 0,
                        opacity: 0.85,
                      }}
                    />
                  </div>
                  {/* Recovery bar */}
                  <div className="flex-1 flex flex-col justify-end h-full">
                    <div
                      className="w-full"
                      style={{
                        height: `${hasData ? rec : 0}%`,
                        backgroundColor: hasData ? getCategoryColor(rec) : 'var(--rule)',
                        minHeight: hasData && rec > 0 ? 3 : 0,
                        opacity: 0.85,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-between mt-2">
            {dates.map((d, i) => (
              <span key={i} className="flex-1 text-center text-xs text-faint">{d}</span>
            ))}
          </div>

          {/* Legend */}
          <div className="flex gap-4 mt-3 pt-3 border-t border-rule">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 bg-[var(--chart-4)]" />
              <span className="text-xs text-faint">{translate('strain.balance.strainLabel')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 bg-[var(--chart-1)]" />
              <span className="text-xs text-faint">{translate('strain.balance.recoveryLabel')}</span>
            </div>
          </div>

          {/* Interpretation line */}
          <p className="text-xs text-pencil mt-2">
            {balance >= 20
              ? translate('strain.balance.goodBalance')
              : balance >= 0
              ? translate('strain.balance.evenBalance')
              : translate('strain.balance.badBalance')}
          </p>
        </div>

        {/* ── Actividades por tipo (hoy) ─────────────────────────── */}
        {byType.length > 0 && (
          <div className="card">
            <div className="card-header mb-4">
              <Activity size={14} className="text-pencil" />
              <span>{translate('strain.activitiesTitle')}</span>
            </div>

            <div className="flex flex-col gap-3">
              {byType.map((t) => {
                const pct = totalTodayStrain > 0
                  ? Math.round((t.strain / totalTodayStrain) * 100)
                  : 0;
                const icon = ACTIVITY_ICONS[t.type] ?? ACTIVITY_ICONS.other;
                const label = ACTIVITY_LABELS[t.type] ?? t.type;
                const color = getStrainColor(t.strain);

                return (
                  <div key={t.type}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base">{icon}</span>
                      <span className="text-sm text-ink font-medium flex-1">{label}</span>
                      {t.count > 1 && (
                        <span className="text-xs text-faint">×{t.count}</span>
                      )}
                      <span className="text-xs text-pencil">{formatDuration(t.duration)}</span>
                      {t.calories > 0 && (
                        <span className="text-xs text-faint">· {t.calories} kcal</span>
                      )}
                      <span className="text-sm font-bold ml-1" style={{ color }}>
                        {t.strain.toFixed(1)}
                      </span>
                    </div>
                    {/* Contribution bar */}
                    <div className="w-full h-1.5 bg-muted overflow-hidden">
                      <div
                        className="h-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                    <p className="text-xs text-faint mt-0.5 text-right">{pct}{translate('strain.strainPct')}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── ACWR: Ratio carga aguda / crónica ─────────────────────── */}
        {acwr && (
          <div className="card">
            <div className="card-header mb-4">
              <ShieldAlert size={14} className="text-pencil" />
              <span>{translate('strain.acwr.title')}</span>
            </div>

            {/* Main ratio display */}
            <div className="flex items-center gap-4 mb-4">
              <div
                className="w-16 h-16 flex items-center justify-center flex-shrink-0 border"
                style={{ borderColor: acwr.color }}
              >
                <span className="text-2xl font-black" style={{ color: acwr.color }}>
                  {acwr.ratio > 0 ? acwr.ratio.toFixed(2) : '—'}
                </span>
              </div>
              <div>
                <p className="text-sm font-bold text-ink">{ACWR_LABELS[acwr.zone]?.label ?? ''}</p>
                <p className="text-xs text-pencil mt-0.5 leading-snug">{ACWR_LABELS[acwr.zone]?.desc ?? ''}</p>
              </div>
            </div>

            {/* Acute / Chronic breakdown */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-wash px-3 py-2.5">
                <p className="text-[10px] text-faint tracking-wider mb-1">{translate('strain.acwr.acute')}</p>
                <p className="text-lg font-bold text-ink">{acwr.acute}</p>
                <p className="text-[10px] text-faint">{translate('strain.acwr.acuteDesc')}</p>
              </div>
              <div className="bg-wash px-3 py-2.5">
                <p className="text-[10px] text-faint tracking-wider mb-1">{translate('strain.acwr.chronic')}</p>
                <p className="text-lg font-bold text-ink">{acwr.chronic}</p>
                <p className="text-[10px] text-faint">{translate('strain.acwr.acuteDesc')}</p>
              </div>
            </div>

            {/* Zone scale bar */}
            <div className="mb-3">
              {/* Flat wash with the 0.8–1.3 corridor shaded — no gradient. */}
              <div className="relative h-2.5 bg-wash border border-rule">
                <div
                  className="absolute inset-y-0 bg-ready opacity-25"
                  style={{ left: '20%', width: '33.3%' }}
                />
                {acwr.ratio > 0 && (
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-paper"
                    style={{
                      left: `${Math.min(100, Math.max(0, ((acwr.ratio - 0.5) / 1.5) * 100))}%`,
                      transform: 'translateX(-50%) translateY(-50%)',
                      backgroundColor: acwr.color,
                    }}
                  />
                )}
              </div>
              <div className="flex justify-between text-[9px] text-faint mt-1 px-0.5">
                <span className="text-pencil">0.5</span>
                <span className="text-ready">0.8</span>
                <span>1.0</span>
                <span className="text-caution">1.3</span>
                <span className="text-caution">1.5</span>
                <span className="text-stop">2.0</span>
              </div>
              <div className="flex justify-between text-[9px] text-faint mt-0.5 px-0.5">
                <span className="text-pencil">{translate('common.low')}</span>
                <span className="text-ready">{translate('common.optimal')}</span>
                <span className="text-caution">{translate('common.moderate')}</span>
                <span className="text-caution">{translate('common.high')}</span>
                <span className="text-stop">{translate('common.danger')}</span>
              </div>
            </div>

            <p className="text-[10px] text-faint border-t border-rule pt-3">
              {translate('strain.acwr.ref')}
            </p>
          </div>
        )}

      </main>
      <BottomNav />
    </div>
  );
}
