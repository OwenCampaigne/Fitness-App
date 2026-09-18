'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import Link from 'next/link';
import { ArrowLeft, Brain, Zap, TrendingUp } from 'lucide-react';
import type { DailyMetrics } from '@/lib/types';
import BottomNav from '@/components/BottomNav';
import {
  ResponsiveContainer, AreaChart, Area, Tooltip,
  ReferenceLine, XAxis, YAxis,
} from 'recharts';
import { useLang } from '@/lib/i18n';

function stressColor(v: number) {
  if (v <= 25) return 'var(--ready)';
  if (v <= 50) return 'var(--caution)';
  if (v <= 75) return 'var(--chart-4)';
  return 'var(--stop)';
}

function computeZones(data: Array<{ time: string; value: number }>) {
  if (!data.length) return { rest: 0, low: 0, moderate: 0, high: 0 };
  const n = data.length;
  return {
    rest:     Math.round(data.filter(d => d.value <= 25).length / n * 100),
    low:      Math.round(data.filter(d => d.value > 25 && d.value <= 50).length / n * 100),
    moderate: Math.round(data.filter(d => d.value > 50 && d.value <= 75).length / n * 100),
    high:     Math.round(data.filter(d => d.value > 75).length / n * 100),
  };
}

export default function StressPage() {
  const { t } = useLang();
  const [data, setData] = useState<DailyMetrics | null>(null);

  const ZONES = [
    { key: 'rest'     as const, label: t('stress.levels.rest'),     color: 'var(--ready)', range: '0–25'   },
    { key: 'low'      as const, label: t('common.low'),              color: 'var(--caution)', range: '26–50'  },
    { key: 'moderate' as const, label: t('common.moderate'),         color: 'var(--chart-4)', range: '51–75'  },
    { key: 'high'     as const, label: t('common.high'),             color: 'var(--stop)', range: '76–100' },
  ];

  function stressLabel(avg: number) {
    if (avg <= 25) return t('stress.levels.veryLow');
    if (avg <= 40) return t('stress.levels.low');
    if (avg <= 55) return t('stress.levels.moderate');
    if (avg <= 70) return t('stress.levels.elevated');
    return t('stress.levels.high');
  }

  useEffect(() => {
    const localDate = format(new Date(), 'yyyy-MM-dd');
    fetch(`/api/health?date=${localDate}`).then(r => r.json()).then(setData);
  }, []);

  if (!data) {
    return (
      <div className="min-h-screen bg-paper">
        <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur border-b border-rule">
          <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
            <Link href="/" className="p-1.5 hover:bg-wash text-pencil hover:text-ink transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <Brain size={16} className="text-stress" />
            <h1 className="font-serif text-head text-ink">{t('stress.title')}</h1>
          </div>
        </header>
        <main className="max-w-md mx-auto px-4 pb-28 pt-4 flex flex-col gap-4">
          <div className="animate-pulse bg-wash h-48" />
          <div className="animate-pulse bg-wash h-40" />
          <div className="animate-pulse bg-wash h-36" />
          <div className="animate-pulse bg-wash h-32" />
        </main>
        <BottomNav />
      </div>
    );
  }

  const { stress, weeklyTrend } = data;
  const avgColor = stressColor(stress.average);
  const zones = computeZones(stress.data);
  const peak = stress.data.length ? Math.max(...stress.data.map(d => d.value)) : stress.average;
  const tensionPct = zones.moderate + zones.high;

  // Weekly stress proxy: 100 − recovery (lower recovery ≈ higher stress load)
  const weeklyProxy = weeklyTrend.recovery.map(r => (r > 0 ? Math.max(0, 100 - r) : 0));

  const tickInterval = stress.data.length > 12
    ? Math.floor(stress.data.length / 6)
    : 0;

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur border-b border-rule">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="p-1.5 hover:bg-wash text-pencil hover:text-ink transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <Brain size={16} className="text-stress" />
          <h1 className="font-serif text-head text-ink">{t('stress.title')}</h1>
          <span
            className="ml-auto font-serif text-note italic"
            style={{ color: avgColor }}
          >
            {stressLabel(stress.average)}
          </span>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-28 pt-4 flex flex-col gap-4">

        {/* ── Hero ─────────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header mb-4">
            <Brain size={14} className="text-stress" />
            <span>{t('stress.todayLevel')}</span>
          </div>

          <div className="flex items-end gap-4 mb-5">
            <span className="text-6xl font-black leading-none" style={{ color: avgColor }}>
              {stress.average}
            </span>
            <div className="mb-1">
              <p className="text-sm font-semibold" style={{ color: avgColor }}>
                {stressLabel(stress.average)}
              </p>
              <p className="text-xs text-faint">{t('stress.scale')}</p>
            </div>
          </div>

          {/* Gauge bar */}
          {/* Flat wash, ruled at the band boundaries — no gradient. */}
          <div className="relative h-2.5 bg-wash border border-rule mb-4">
            {[25, 50, 75].map(q => (
              <div key={q} className="absolute inset-y-0 w-px bg-rule" style={{ left: `${q}%` }} />
            ))}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-paper"
              style={{
                left: `${stress.average}%`,
                transform: 'translateX(-50%) translateY(-50%)',
                backgroundColor: avgColor,
              }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-faint mb-4">
            <span className="text-ready">{t('stress.levels.rest')}</span>
            <span className="text-caution">{t('common.low')}</span>
            <span className="text-caution">{t('common.moderate')}</span>
            <span className="text-stop">{t('common.high')}</span>
          </div>

          {/* Mini stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-paper p-2 text-center border border-rule">
              <p className="text-[10px] text-faint mb-0.5">{t('stress.levels.peak')}</p>
              <p className="text-sm font-bold" style={{ color: stressColor(peak) }}>{peak}</p>
            </div>
            <div className="bg-paper p-2 text-center border border-rule">
              <p className="text-[10px] text-faint mb-0.5">{t('stress.levels.atRest')}</p>
              <p className="text-sm font-bold text-ready">{stress.restingPercentage}%</p>
            </div>
            <div className="bg-paper p-2 text-center border border-rule">
              <p className="text-[10px] text-faint mb-0.5">{t('stress.levels.tension')}</p>
              <p className="text-sm font-bold" style={{ color: tensionPct > 40 ? 'var(--stop)' : 'var(--caution)' }}>
                {tensionPct}%
              </p>
            </div>
          </div>
        </div>

        {/* ── Timeline ─────────────────────────────────────────────── */}
        {stress.data.length > 0 && (
          <div className="card">
            <div className="card-header mb-4">
              <Zap size={14} className="text-pencil" />
              <span>{t('stress.timeline')}</span>
              <span className="ml-auto text-xs text-faint">{t('stress.measurements', { count: stress.data.length })}</span>
            </div>

            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={stress.data} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 9, fill: 'var(--faint)' }}
                  tickLine={false}
                  axisLine={false}
                  interval={tickInterval}
                />
                <YAxis domain={[0, 100]} hide />
                <ReferenceLine y={25} stroke="var(--ready)" strokeDasharray="3 3" strokeOpacity={0.4} />
                <ReferenceLine y={50} stroke="var(--caution)" strokeDasharray="3 3" strokeOpacity={0.4} />
                <ReferenceLine y={75} stroke="var(--chart-4)" strokeDasharray="3 3" strokeOpacity={0.4} />
                <Tooltip
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="bg-paper border border-rule px-2 py-1.5 text-note leading-snug figures">
                        <span className="text-pencil mr-1">{payload[0].payload.time}</span>
                        <span style={{ color: stressColor(Number(payload[0].value)) }}>
                          {payload[0].value} · {stressLabel(Number(payload[0].value))}
                        </span>
                      </div>
                    ) : null
                  }
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={avgColor}
                  strokeWidth={1.5}
                  fill={avgColor}
                  fillOpacity={0.1}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>

            {/* Zone legend */}
            <div className="flex flex-wrap justify-end gap-3 mt-2">
              {ZONES.map(z => (
                <span key={z.key} className="text-[9px] flex items-center gap-1" style={{ color: z.color }}>
                  <span className="inline-block w-4 border-t border-dashed" style={{ borderColor: z.color }} />
                  {z.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Zone distribution ─────────────────────────────────────── */}
        <div className="card">
          <div className="card-header mb-4">
            <Brain size={14} className="text-pencil" />
            <span>{t('stress.distribution')}</span>
          </div>

          {/* Stacked bar */}
          <div className="flex h-4 overflow-hidden mb-4">
            {ZONES.map(z =>
              zones[z.key] > 0 ? (
                <div
                  key={z.key}
                  style={{ width: `${zones[z.key]}%`, backgroundColor: z.color }}
                  title={`${z.label}: ${zones[z.key]}%`}
                />
              ) : null
            )}
          </div>

          {/* Legend grid */}
          <div className="grid grid-cols-2 gap-2">
            {ZONES.map(z => (
              <div key={z.key} className="flex items-center gap-2 py-2 px-3 bg-paper border border-rule">
                <div className="w-2.5 h-2.5 flex-shrink-0" style={{ backgroundColor: z.color }} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold leading-none" style={{ color: z.color }}>{z.label}</p>
                  <p className="text-[9px] text-faint mt-0.5">{z.range}</p>
                </div>
                <p className="text-sm font-bold text-ink">{zones[z.key]}%</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Weekly stress indicator ────────────────────────────────── */}
        <div className="card">
          <div className="card-header mb-4">
            <TrendingUp size={14} className="text-pencil" />
            <span>{t('stress.weeklyIndicator')}</span>
            <span className="ml-auto text-[10px] text-faint">{t('stress.weeklyFormula')}</span>
          </div>

          <div className="flex items-end justify-between gap-1.5 h-24">
            {weeklyProxy.map((v, i) => {
              const c = stressColor(v);
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-medium" style={{ color: c }}>
                    {v > 0 ? v : '—'}
                  </span>
                  <div
                    className="w-full transition-all duration-700"
                    style={{
                      height: `${(v / 100) * 80}%`,
                      backgroundColor: v > 0 ? c : 'var(--rule)',
                      minHeight: v > 0 ? 4 : 0,
                    }}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex justify-between mt-2">
            {weeklyTrend.dates.map((d, i) => (
              <span key={i} className="flex-1 text-center text-xs text-faint">{d}</span>
            ))}
          </div>

          <p className="text-[10px] text-faint mt-3 pt-3 border-t border-rule">
            {t('stress.weeklyNote')}
          </p>
        </div>

        {/* ── Educational ──────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header mb-4">
            <Brain size={14} className="text-stress" />
            <span>{t('stress.info.title')}</span>
          </div>

          <div className="space-y-3">
            <div className="p-3 bg-paper border border-rule">
              <p className="text-xs font-semibold text-ink mb-1">{t('stress.info.hrvTitle')}</p>
              <p className="text-[11px] text-pencil leading-relaxed">
                {t('stress.info.hrvDesc')}
              </p>
            </div>

            <div className="p-3 bg-paper border border-rule">
              <p className="text-xs font-semibold text-ink mb-2">{t('stress.info.zonesTitle')}</p>
              <div className="space-y-2">
                {[
                  { label: t('stress.info.zone1'), color: 'var(--ready)', desc: t('stress.info.zone1Desc') },
                  { label: t('stress.info.zone2'), color: 'var(--caution)', desc: t('stress.info.zone2Desc') },
                  { label: t('stress.info.zone3'), color: 'var(--chart-4)', desc: t('stress.info.zone3Desc') },
                  { label: t('stress.info.zone4'), color: 'var(--stop)', desc: t('stress.info.zone4Desc') },
                ].map(z => (
                  <div key={z.label} className="flex items-start gap-2">
                    <div className="w-2 h-2 mt-0.5 flex-shrink-0" style={{ backgroundColor: z.color }} />
                    <div>
                      <span className="text-[11px] font-semibold" style={{ color: z.color }}>{z.label}</span>
                      <span className="text-[11px] text-faint ml-2">{z.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3 bg-paper border border-rule">
              <p className="text-xs font-semibold text-ink mb-2">{t('stress.info.tipsTitle')}</p>
              <ul className="space-y-1.5">
                {[
                  t('stress.info.tip1'),
                  t('stress.info.tip2'),
                  t('stress.info.tip3'),
                  t('stress.info.tip4'),
                ].map((tip, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] text-pencil">
                    <span className="text-stress mt-0.5 flex-shrink-0">·</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-[10px] text-faint text-center pt-1">
              {t('stress.info.ref')}
            </p>
          </div>
        </div>

      </main>
      <BottomNav />
    </div>
  );
}
