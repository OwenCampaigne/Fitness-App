'use client';

import { useEffect } from 'react';
import { registerServiceWorker } from '@/lib/notifications';

/**
 * Invisible component — registers /sw.js once the page mounts.
 * Included in the root layout so every page benefits.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return null;
}
