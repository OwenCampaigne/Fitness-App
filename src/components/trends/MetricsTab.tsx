'use client';

// ── Metrics tab ───────────────────────────────────────────────────────────────
// The daily-metric view /trends has carried since Phase 1, lifted out of the
// page file unchanged so the weekly review can take the front tab without
// costing anyone the 30/90-day sparklines, the AI summary or the PDF export.

import { useEffect, useState } from 'react';
import { format, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { enUS } from 'date-fns/locale';
import { Loader2, FileDown } from 'lucide-react';
import type { DailyMetrics, TrendPoint } from '@/lib/types';
import TrendSparkline from '@/components/ui/TrendSparkline';
import LogSection from '@/components/ui/LogSection';
import { METRIC } from '@/components/ui/chartTheme';
import WeeklySummaryCard from '@/components/WeeklySummaryCard';
import { calculateMedian } from '@/lib/scoring';
import { useProfile } from '@/lib/useProfile';
import { useLang } from '@/lib/i18n';

type Range = 7 | 30 | 90;

// ── PDF export ─────────────────────────────────────────────────────────────────
async function exportWeeklyPDF(data: DailyMetrics, translate: (k: string) => string, locale: string) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const W = 210;
  const pad = 14;
  const col = (W - pad * 2) / 2;
  let y = 20;

  // The printed log: paper stock, ink, and the same muted series ramp the
  // screen uses (light values — a PDF is always read on white).
  const BG   = [232, 233, 227] as [number, number, number]; // --paper
  const SURF = [223, 225, 217] as [number, number, number]; // --wash
  const PRIM = [28,  42,  51]  as [number, number, number]; // --ink
  const SEC  = [107, 115, 120] as [number, number, number]; // --pencil
  const RULE = [201, 204, 194] as [number, number, number]; // --rule
  const GRN  = [69,  96,  122] as [number, number, number]; // --chart-1
  const PRP  = [107, 91,  127] as [number, number, number]; // --chart-2
  const SKY  = [63,  111, 120] as [number, number, number]; // --chart-3
  const IND  = [122, 106, 52]  as [number, number, number]; // --chart-5

  doc.setFillColor(...BG);
  doc.rect(0, 0, W, 297, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...PRIM);
  doc.text(translate('trends.weeklySummary'), pad, y);
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...SEC);
  const today = new Date();
  const from  = new Date(today); from.setDate(today.getDate() - 6);
  const fmt = (d: Date) => d.toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-US', { day: 'numeric', month: 'short' });
  doc.text(`${fmt(from)} – ${fmt(today)} · Garmin Health Dashboard`, pad, y);
  y += 2;

  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.4);
  doc.line(pad, y + 4, W - pad, y + 4);
  y += 10;

  const card = (
    x: number, cy: number, w: number, h: number,
    label: string, value: string, unit: string,
    color: [number, number, number], series: number[],
  ) => {
    doc.setFillColor(...SURF);
    doc.rect(x, cy, w, h, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...SEC);
    doc.text(label, x + 4, cy + 7);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(...color);
    doc.text(value, x + 4, cy + 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...SEC);
    doc.text(unit, x + 4 + doc.getTextWidth(value) + 1.5, cy + 17);

    const valid = series.filter(v => v > 0);
    if (valid.length > 1) {
      const sx = x + 4; const sy = cy + h - 10;
      const sw = w - 8; const sh = 8;
      const mn = Math.min(...valid); const mx = Math.max(...valid);
      const range = mx - mn || 1;
      const pts = series.map((v, i) => [
        sx + (i / (series.length - 1)) * sw,
        sy + sh - ((v - mn) / range) * sh,
      ]);
      doc.setDrawColor(...color);
      doc.setLineWidth(0.6);
      for (let i = 1; i < pts.length; i++) {
        doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      }
    }
  };

  const t = data.weeklyTrend;
  const avgArr = (arr: number[]) => {
    const v = arr.filter(x => x > 0);
    return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : 0;
  };

  const cw = col - 2; const ch = 38;
  const ORG: [number, number, number] = [138, 90, 60]; // --chart-4

  card(pad,       y, cw, ch, translate('trends.recovery'), String(avgArr(t.recovery)),       '%',    GRN, t.recovery);
  card(pad + col, y, cw, ch, translate('trends.hrv'),      String(avgArr(t.hrv)),            'ms',   PRP, t.hrv);
  y += ch + 4;
  card(pad,       y, cw, ch, translate('trends.sleep'),    avgArr(t.sleepHours).toFixed(1),  'h',    IND, t.sleepHours);
  card(pad + col, y, cw, ch, translate('trends.rhr'),      String(avgArr(t.rhr)),            'bpm',  SKY, t.rhr);
  y += ch + 4;
  card(pad, y, W - pad * 2, ch, translate('trends.strain'), avgArr(t.strain).toFixed(1), '/ 21', ORG, t.strain);
  y += ch + 10;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PRIM);
  doc.text(translate('trends.dailyBreakdown'), pad, y);
  y += 6;

  const days = [translate('trends.days.mon'), translate('trends.days.tue'), translate('trends.days.wed'), translate('trends.days.thu'), translate('trends.days.fri'), translate('trends.days.sat'), translate('trends.days.sun')];
  const colW = (W - pad * 2) / 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...SEC);
  days.forEach((d, i) => doc.text(d, pad + i * colW + colW / 2, y, { align: 'center' }));
  y += 5;

  const rows = [
    { label: translate('trends.cols.recovery'), data: t.recovery,   color: GRN, fmt: (v: number) => String(Math.round(v)) },
    { label: translate('trends.cols.hrv'),      data: t.hrv,         color: PRP, fmt: (v: number) => String(Math.round(v)) },
    { label: translate('trends.cols.sleep'),    data: t.sleepHours,  color: IND, fmt: (v: number) => v.toFixed(1) },
    { label: translate('trends.cols.rhr'),      data: t.rhr,         color: SKY, fmt: (v: number) => String(Math.round(v)) },
    { label: translate('trends.cols.strain'),   data: t.strain,      color: ORG, fmt: (v: number) => v.toFixed(1) },
  ];

  rows.forEach(row => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...SEC);
    doc.text(row.label, pad - 1, y, { align: 'right' });
    row.data.slice(0, 7).forEach((v, i) => {
      doc.setTextColor(...(v > 0 ? row.color : SEC));
      doc.text(v > 0 ? row.fmt(v) : '–', pad + i * colW + colW / 2, y, { align: 'center' });
    });
    y += 6;
  });

  y += 6;
  doc.setDrawColor(...RULE);
  doc.line(pad, y, W - pad, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...SEC);
  doc.text(translate('trends.pdfFooter'), pad, y);
  doc.text(new Date().toLocaleString(locale === 'es' ? 'es-ES' : 'en-US'), W - pad, y, { align: 'right' });

  const fileName = locale === 'es' ? `resumen-semanal-${today.toISOString().slice(0, 10)}.pdf` : `weekly-summary-${today.toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildDateLabels(days: number, locale: string): string[] {
  const today = new Date();
  const dateFnsLocale = locale === 'es' ? es : enUS;
  return Array.from({ length: days }, (_, i) => {
    const d = subDays(today, days - 1 - i);
    return days === 7 ? format(d, 'EEE', { locale: dateFnsLocale }) : format(d, 'd/M');
  });
}

function computeStats(series: number[]) {
  const v = series.filter(x => x > 0);
  if (!v.length) return { avg: 0, min: 0, max: 0, delta: 0 };
  const avg = v.reduce((s, x) => s + x, 0) / v.length;
  const min = Math.min(...v);
  const max = Math.max(...v);
  // delta: first half avg vs second half avg
  const mid = Math.ceil(v.length / 2);
  const first = v.slice(0, mid);
  const last  = v.slice(mid);
  const aFirst = first.reduce((s, x) => s + x, 0) / first.length;
  const aLast  = last.length ? last.reduce((s, x) => s + x, 0) / last.length : aFirst;
  const delta  = ((aLast - aFirst) / (aFirst || 1)) * 100;
  return { avg, min, max, delta };
}

const RANGE_OPTIONS: Range[] = [7, 30, 90];

interface RowData {
  label: string;
  unit: string;
  color: string;
  series: number[];
  decimals: number;
  higherIsBetter: boolean; // true for recovery/hrv/sleep; false for rhr
}

// ── The tab ───────────────────────────────────────────────────────────────────
export default function MetricsTab() {
  const { t, locale } = useLang();
  const { profile } = useProfile();
  const [data,         setData]         = useState<DailyMetrics | null>(null);
  const [range,        setRange]        = useState<Range>(7);
  const [trendPoints,  setTrendPoints]  = useState<TrendPoint[] | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [pdfLoading,   setPdfLoading]   = useState(false);

  useEffect(() => {
    const localDate = format(new Date(), 'yyyy-MM-dd');
    fetch(`/api/health?date=${localDate}`).then(r => r.json()).then(setData);
  }, []);

  useEffect(() => {
    if (range === 7) { setTrendPoints(null); return; }
    setTrendLoading(true);
    setTrendPoints(null);
    const localDate = format(new Date(), 'yyyy-MM-dd');
    fetch(`/api/trends?range=${range}&date=${localDate}`)
      .then(r => r.json())
      .then((pts: TrendPoint[]) => { setTrendPoints(pts); setTrendLoading(false); })
      .catch(() => setTrendLoading(false));
  }, [range]);

  const buildRows = (): RowData[] => {
    if (range === 7 && data) {
      return [
        { label: t('trends.recovery'), unit: '%',   color: METRIC.recovery, series: data.weeklyTrend.recovery,  decimals: 0, higherIsBetter: true  },
        { label: t('trends.hrv'),      unit: 'ms',  color: METRIC.hrv,      series: data.weeklyTrend.hrv,        decimals: 0, higherIsBetter: true  },
        { label: t('trends.sleep'),    unit: 'h',   color: METRIC.sleep,    series: data.weeklyTrend.sleepHours, decimals: 1, higherIsBetter: true  },
        { label: t('trends.rhr'),      unit: 'bpm', color: METRIC.rhr,      series: data.weeklyTrend.rhr,        decimals: 0, higherIsBetter: false },
        { label: t('trends.strain'),   unit: '/21', color: METRIC.strain,   series: data.weeklyTrend.strain,     decimals: 1, higherIsBetter: false },
      ];
    }
    if (trendPoints && trendPoints.length > 0) {
      return [
        { label: t('trends.recovery'), unit: '%',   color: METRIC.recovery, series: trendPoints.map(p => p.recovery),   decimals: 0, higherIsBetter: true  },
        { label: t('trends.hrv'),      unit: 'ms',  color: METRIC.hrv,      series: trendPoints.map(p => p.hrv),        decimals: 0, higherIsBetter: true  },
        { label: t('trends.sleep'),    unit: 'h',   color: METRIC.sleep,    series: trendPoints.map(p => p.sleepHours), decimals: 1, higherIsBetter: true  },
        { label: t('trends.rhr'),      unit: 'bpm', color: METRIC.rhr,      series: trendPoints.map(p => p.rhr),        decimals: 0, higherIsBetter: false },
        { label: t('trends.strain'),   unit: '/21', color: METRIC.strain,   series: trendPoints.map(p => p.strain),     decimals: 1, higherIsBetter: false },
      ];
    }
    return [];
  };

  const rows  = buildRows();
  const dates = buildDateLabels(range, locale);
  const isLoading = range === 7 ? !data : trendLoading;

  return (
    <div className="flex flex-col gap-5">

      {/* ── Range, and the export, on one ruled line ───────────────── */}
      <div className="flex items-baseline gap-5 border-b border-rule pb-1">
        {RANGE_OPTIONS.map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            aria-pressed={range === r}
            className={`font-serif text-entry pb-1 -mb-1 border-b-2 transition-colors ${
              range === r
                ? 'border-ink text-ink'
                : 'border-transparent text-pencil hover:text-ink'
            }`}
          >
            {r}d
          </button>
        ))}

        {data && (
          <button
            onClick={async () => {
              setPdfLoading(true);
              try { await exportWeeklyPDF(data, t, locale); } finally { setPdfLoading(false); }
            }}
            disabled={pdfLoading}
            className="ml-auto flex items-center gap-1.5 font-serif text-note italic text-pencil hover:text-ink transition-colors disabled:opacity-50"
          >
            {pdfLoading ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
            {t('trends.pdf')}
          </button>
        )}
      </div>

      {/* ── AI Summary — only for 7d ───────────────────────────────── */}
      {range === 7 && data && (
        <WeeklySummaryCard trend={data.weeklyTrend} profile={profile} />
      )}

      {/* ── Loading: ruled blanks, the shape of the entries to come ─── */}
      {isLoading && (
        <div className="flex flex-col">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="entry">
              <div className="flex items-baseline justify-between mb-2">
                <div className="h-2.5 w-24 bg-rule animate-pulse" />
                <div className="h-2.5 w-12 bg-rule animate-pulse" />
              </div>
              <div className="h-12 bg-rule opacity-60 animate-pulse" />
            </div>
          ))}
          {range > 7 && (
            <p className="flex items-center justify-center gap-2 pt-4 font-serif text-note italic text-pencil">
              <Loader2 size={12} className="animate-spin" />
              {t('trends.fetchingData', { range })}
            </p>
          )}
        </div>
      )}

      {/* ── One entry per signal ───────────────────────────────────── */}
      {!isLoading && rows.length > 0 && (
        <div className="flex flex-col">
          {rows.map((row) => {
            const p50 = calculateMedian(row.series);
            const { avg, min, max, delta } = computeStats(row.series);
            const fmt = (v: number) => (row.decimals === 1 ? v.toFixed(1) : String(Math.round(v)));
            const deltaAbs = Math.abs(Math.round(delta));
            const rising = delta > 0;

            return (
              <LogSection
                key={row.label}
                className="entry border-t-0 pt-0"
                label={row.label}
                figure={
                  <span className="measured text-head" style={{ color: row.color }}>
                    {fmt(avg)}
                    <span className="text-note font-normal text-faint ml-1">{row.unit}</span>
                  </span>
                }
              >
                {/* Direction in words, so it does not depend on a colour */}
                {deltaAbs >= 3 && (
                  <p className="font-serif text-note italic text-pencil mb-1">
                    {rising ? '▲' : '▼'} {deltaAbs}%{' '}
                    {t(rising ? 'trends.delta.increasing' : 'trends.delta.decreasing')}
                  </p>
                )}

                <dl className="flex gap-4 mb-2 text-note">
                  {([
                    [t('trends.min'), fmt(min)],
                    [t('trends.max'), fmt(max)],
                    [t('trends.p50'), row.decimals === 1 ? p50.toFixed(1) : String(p50)],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="flex items-baseline gap-1">
                      <dt className="font-serif italic text-faint">{label}</dt>
                      <dd className="measured">{value}{row.unit}</dd>
                    </div>
                  ))}
                </dl>

                <TrendSparkline
                  data={row.series}
                  labels={dates}
                  color={row.color}
                  height={52}
                  referenceValue={p50}
                  referenceLabel="p50"
                />

                <div className="flex justify-between mt-1 text-note text-faint figures">
                  <span>{dates[0]}</span>
                  <span>{dates[dates.length - 1]}</span>
                </div>
              </LogSection>
            );
          })}
        </div>
      )}
    </div>
  );
}
