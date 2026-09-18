import type { Config } from 'tailwindcss';

// ── The training log ──────────────────────────────────────────────────────────
// A runner's diary, not a dashboard (framework §14: "not a dashboard — one
// screen, one answer"). The load-bearing idea is that **ink is measured and
// pencil is estimated**: this app's whole personality is refusing to dress an
// estimate as a fact, so the palette encodes it rather than leaving it to copy.
//
// Colour appears in exactly two places — the readiness verdict and a safety
// flag. Everywhere else is ink on paper, because a page where six things are
// coloured is a page where nothing is emphasised.

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // The ground. Cool grey-green stock — a legal pad's cousin, kept off
        // warm cream on purpose.
        paper: 'var(--paper)',
        wash: 'var(--wash)',
        rule: 'var(--rule)',
        // Blue-black fountain-pen ink rather than a tinted near-black.
        ink: 'var(--ink)',
        // Graphite. Everything provisional is set in it.
        pencil: 'var(--pencil)',
        faint: 'var(--faint)',
        // Stamps. Muted enough to read as pressed ink, not as UI chrome.
        ready: 'var(--ready)',
        caution: 'var(--caution)',
        stop: 'var(--stop)',

        // ── Compatibility aliases ──────────────────────────────────────────
        // The old dashboard names, remapped onto the log. Pages migrate at
        // their own pace instead of all breaking at once; delete an alias once
        // nothing references it.
        bg: 'var(--paper)',
        surface: 'var(--wash)',
        border: 'var(--rule)',
        primary: 'var(--ink)',
        secondary: 'var(--pencil)',
        muted: 'var(--faint)',
        recovery: {
          green: 'var(--ready)',
          yellow: 'var(--caution)',
          red: 'var(--stop)',
        },
        sleep: 'var(--chart-1)',
        hrv: 'var(--chart-2)',
        battery: 'var(--chart-3)',
        strain: 'var(--chart-4)',
        stress: 'var(--chart-5)',
      },
      fontFamily: {
        // The coach's voice.
        serif: ['var(--font-literata)', 'Georgia', 'serif'],
        // Your entries. Atkinson was drawn for low-vision legibility, which is
        // the right call for a screen read at 6am, one-handed, outdoors.
        sans: ['var(--font-atkinson)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // A modest scale: a log is read, not scanned from across the room.
        note: ['0.75rem', { lineHeight: '1.5' }],
        entry: ['0.9375rem', { lineHeight: '1.45' }],
        prose: ['1rem', { lineHeight: '1.65' }],
        head: ['1.375rem', { lineHeight: '1.25', letterSpacing: '-0.01em' }],
        verdict: ['2.75rem', { lineHeight: '1', letterSpacing: '-0.03em' }],
      },
      borderRadius: {
        // Paper does not have a 16px corner radius.
        none: '0',
        sm: '2px',
        DEFAULT: '3px',
      },
      animation: {
        'gauge-fill': 'gaugeFill 1.2s cubic-bezier(0.4,0,0.2,1) forwards',
      },
      keyframes: {
        gaugeFill: {
          '0%': { strokeDashoffset: 'var(--full-dash)' },
          '100%': { strokeDashoffset: 'var(--target-dash)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
