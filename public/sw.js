// ─── Garmin Health PWA — Service Worker ─────────────────────────────────────
// Handles:
//  • Server-sent Push notifications (Web Push API / VAPID)
//  • Page-initiated notifications via postMessage
//  • Notification click to open / focus the app
// ─────────────────────────────────────────────────────────────────────────────

const SW_VERSION = 'garmin-health-sw-v3';

self.addEventListener('install', () => {
  // Take control immediately without waiting for old SW to expire
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// ── Notification requests from the page ──────────────────────────────────────
// The page posts { type: 'SHOW_NOTIFICATION', title, body, tag, icon }
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'SHOW_NOTIFICATION') return;

  const {
    title  = 'Garmin Health',
    body   = '',
    tag    = 'garmin-alert',
    icon   = '/icon-192x192.png',
  } = event.data;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge:    icon,
      tag,
      renotify: false,           // don't vibrate again for the same tag
      vibrate:  [200, 100, 200],
      silent:   false,
      data:     { url: '/' },
    })
  );
});

// ── Server-sent Push notifications (Web Push / VAPID) ────────────────────────
// Fired when the server sends a push to our subscription endpoint.
// Payload JSON: { title, body, icon?, badge?, url?, tag? }
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}

  const title   = data.title  ?? 'Garmin Health';
  const options = {
    body:     data.body   ?? '',
    icon:     data.icon   ?? '/icon-192x192.png',
    badge:    data.badge  ?? '/icon-96x96.png',
    tag:      data.tag    ?? 'garmin-push',
    renotify: false,
    vibrate:  [200, 100, 200],
    silent:   false,
    data:     { url: data.url ?? '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Periodic Background Sync — battery check when app is closed ──────────────
// Chrome on Android PWA fires this periodically (typically every 12-24h based
// on site engagement; can be as frequent as ~15 min on high-engagement sites).
// Falls back gracefully on browsers that don't support periodicSync.
//
// Registration is done in PushNotificationManager.tsx when notifications are enabled.
// Tag: 'battery-check'
self.addEventListener('periodicsync', (event) => {
  if (event.tag !== 'battery-check') return;
  event.waitUntil(backgroundBatteryCheck());
});

async function backgroundBatteryCheck() {
  try {
    const res  = await fetch('/api/push/status');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.shouldAlert || data.isDemo) return;

    const battery = data.battery;
    const urgency = battery <= 15 ? '¡Muy baja!' : 'Baja';

    await self.registration.showNotification(`🔋 Batería Corporal ${urgency}`, {
      body:     `Tu batería corporal está al ${battery}% — es momento de descansar.`,
      icon:     '/icon-192x192.png',
      badge:    '/icon-96x96.png',
      tag:      'battery-alert',
      renotify: false,
      vibrate:  [200, 100, 200],
      data:     { url: '/' },
    });
  } catch (err) {
    // Silently fail — not critical, will retry next sync cycle
    console.warn('[SW] backgroundBatteryCheck failed:', err);
  }
}

// ── Open / focus the app when notification is clicked ────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url ?? '/';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If the app is already open — focus it
        for (const client of clientList) {
          if ('focus' in client) return client.focus();
        }
        // Otherwise open a new window
        if (clients.openWindow) return clients.openWindow(targetUrl);
      })
  );
});
