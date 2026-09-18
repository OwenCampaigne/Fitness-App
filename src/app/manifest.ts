import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Garmin Health Dashboard',
    short_name: 'GarminHealth',
    description: 'Tu dashboard de salud personal conectado a Garmin',
    start_url: '/',
    display: 'standalone',
    background_color: '#080808',
    theme_color: '#080808',
    orientation: 'portrait',
    categories: ['health', 'fitness'],
    // Static files under public/, built by `npx tsx scripts/generate-icons.ts`.
    // They used to be `next/og` routes, which cannot even be imported on
    // Windows and so broke the build for anyone developing locally.
    icons: [
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
