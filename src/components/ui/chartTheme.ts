// ── Charts on paper ───────────────────────────────────────────────────────────
// Recharts ships a dashboard aesthetic: bright strokes, boxed white tooltips,
// a full grid, drop shadows. All of that fights a paper ground, so every chart
// in this app imports its axes, grid and tooltip from here instead of restating
// recharts' defaults badly in eleven files.
//
// Everything is a CSS custom property rather than a hex string. SVG
// presentation attributes resolve `var()`, so a chart drawn with these tokens
// re-themes itself when `.dark` flips without a single line of JS — which is
// the only way charts stay right in both themes.

/** Ink: something the app measured. */
export const INK = 'var(--ink)';
/** Graphite: something the app worked out and could be wrong about. */
export const PENCIL = 'var(--pencil)';
export const FAINT = 'var(--faint)';
export const RULE = 'var(--rule)';
export const PAPER = 'var(--paper)';

/** Verdicts and safety bands only — never decoration. */
export const READY = 'var(--ready)';
export const CAUTION = 'var(--caution)';
export const STOP = 'var(--stop)';

/**
 * The muted series ramp. Harmonious in both themes, and deliberately quiet
 * enough that a verdict colour still reads as the loudest thing on the page.
 */
export const SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

/** Axis ticks: hairline, small, set in the data face. */
export const TICK = {
  fill: FAINT,
  fontSize: 10,
  fontFamily: 'var(--font-atkinson), system-ui, sans-serif',
} as const;

/** A drawn axis is a ruled line, not a bordered box. */
export const AXIS = {
  tick: TICK,
  axisLine: { stroke: RULE },
  tickLine: false,
} as const;

/** No axis line at all — the ticks carry the scale. */
export const AXIS_BARE = {
  tick: TICK,
  axisLine: false,
  tickLine: false,
} as const;

/**
 * Faint horizontal rules only. A full grid turns a diary page into graph
 * paper, and the vertical lines never carried information here anyway.
 */
export const GRID = {
  stroke: RULE,
  strokeDasharray: '2 4',
  vertical: false,
} as const;

/** Hover cursor over bars: a wash, not a highlight. */
export const BAR_CURSOR = { fill: RULE, fillOpacity: 0.45 } as const;
/** Hover cursor over lines: a single ruled drop. */
export const LINE_CURSOR = { stroke: RULE, strokeWidth: 1 } as const;

/** Paper, one hairline, square corners, no shadow. */
export const TOOLTIP_CLASS =
  'bg-paper border border-rule px-2 py-1.5 text-note leading-snug figures shadow-none';

/**
 * One token per daily signal, fixed here so a metric is the same colour on
 * /trends, /hrv and the legacy cards. Recovery is ink rather than a series
 * colour because it is the composite verdict the rest are inputs to.
 */
export const METRIC = {
  recovery: INK,
  hrv: SERIES[1],
  sleep: SERIES[0],
  rhr: SERIES[2],
  strain: SERIES[3],
  stress: SERIES[4],
  battery: SERIES[2],
} as const;
