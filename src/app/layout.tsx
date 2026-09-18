import type { Metadata, Viewport } from 'next';
import { Literata, Atkinson_Hyperlegible } from 'next/font/google';
import './globals.css';
import InstallPrompt from '@/components/InstallPrompt';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';
import { LangProvider } from '@/lib/i18n';

// ── Two hands ─────────────────────────────────────────────────────────────
// Literata is the coach's voice: headings, prose, the per-item "why". A
// screen-first serif, low contrast, warm without being decorative.
const literata = Literata({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-literata',
  style: ['normal', 'italic'],
});

// Atkinson is your entries: sets, paces, loads. Drawn for low-vision
// legibility, which is the right call for a screen read at 6am, one-handed,
// outdoors, in whatever light there is.
const atkinson = Atkinson_Hyperlegible({
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-atkinson',
});

export const metadata: Metadata = {
  title: 'Garmin Health',
  description: 'Tu dashboard de salud personal conectado a Garmin',
  // manifest auto-registered by src/app/manifest.ts → /manifest.webmanifest
  // Icons are declared by hand rather than through the app/icon file
  // convention, because that convention rendered them with `next/og`, which
  // throws on import under Windows and took the whole build down with it.
  // They are now committed PNGs in public/ — see scripts/generate-icons.ts.
  icons: {
    icon: [
      { url: '/icon.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Garmin Health',
  },
};

export const viewport: Viewport = {
  // Paper by day, the same log under a headlamp by night.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e8e9e3' },
    { media: '(prefers-color-scheme: dark)', color: '#14181a' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${literata.variable} ${atkinson.variable}`}>
      <body className="bg-paper text-ink min-h-screen">
        <LangProvider>
          {children}
          <InstallPrompt />
          <ServiceWorkerRegistrar />
        </LangProvider>
      </body>
    </html>
  );
}
