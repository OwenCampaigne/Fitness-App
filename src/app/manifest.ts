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
    icons: [
      {
        src: '/icon192',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon512',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
