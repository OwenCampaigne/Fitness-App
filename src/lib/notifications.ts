// ─── Notification utilities ──────────────────────────────────────────────────
// Wraps Web Notification API + Service Worker postMessage for PWA alerts.
// All functions are SSR-safe (check typeof window).
// ─────────────────────────────────────────────────────────────────────────────

export interface NotificationSettings {
  enabled:   boolean;
  threshold: number;   // Body Battery level (10–60), default 30
}

const SETTINGS_KEY    = 'garmin_notification_settings';
const LAST_NOTIFY_KEY = 'garmin_last_battery_notification';
const COOLDOWN_MS     = 60 * 60 * 1000; // 1 hour — avoid spam

// ── Settings persistence ─────────────────────────────────────────────────────

export function getNotificationSettings(): NotificationSettings {
  if (typeof window === 'undefined') return { enabled: false, threshold: 30 };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { enabled: false, threshold: 30, ...JSON.parse(raw) };
  } catch { /* ignore corrupt storage */ }
  return { enabled: false, threshold: 30 };
}

export function saveNotificationSettings(settings: NotificationSettings): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ── Permission helpers ───────────────────────────────────────────────────────

export type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export function getPermission(): PermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function requestPermission(): Promise<PermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

// ── Service worker registration ──────────────────────────────────────────────

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.warn('[SW] Registration failed:', err);
  }
}

// ── Send notification ────────────────────────────────────────────────────────
// Prefers SW-delivered notification (works while app is backgrounded).
// Falls back to direct Notification API.

export async function sendNotification(
  title: string,
  body:  string,
  tag = 'garmin-alert',
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (getPermission() !== 'granted') return false;

  // Via service worker (native OS notification even in background)
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'SHOW_NOTIFICATION',
      title,
      body,
      tag,
      icon: '/icon-192x192.png',
    });
    return true;
  }

  // Direct fallback (works only while tab is focused/open)
  try {
    new Notification(title, {
      body,
      icon: '/icon-192x192.png',
      tag,
    });
    return true;
  } catch {
    return false;
  }
}

// ── Body Battery threshold check ─────────────────────────────────────────────
// Called after every data fetch. Fires a notification when:
//  • notifications are enabled
//  • permission is granted
//  • current battery ≤ threshold
//  • last notification was > COOLDOWN_MS ago (prevents spam)

export async function checkAndNotifyBattery(currentBattery: number): Promise<void> {
  if (typeof window === 'undefined') return;

  const settings = getNotificationSettings();
  if (!settings.enabled) return;
  if (getPermission() !== 'granted') return;
  if (currentBattery > settings.threshold) return;

  // Cooldown check
  const lastRaw = localStorage.getItem(LAST_NOTIFY_KEY);
  if (lastRaw && Date.now() - parseInt(lastRaw, 10) < COOLDOWN_MS) return;

  // Severity label
  const level =
    currentBattery <= 10 ? 'crítica' :
    currentBattery <= 20 ? 'muy baja' :
                           'baja';

  const title = `⚡ Body Battery ${level}`;
  const body  =
    `Tu Body Battery está al ${currentBattery}% — ` +
    `por debajo del umbral de ${settings.threshold}%. ` +
    `Considera descansar o reducir la actividad.`;

  const sent = await sendNotification(title, body, 'body-battery-alert');
  if (sent) {
    localStorage.setItem(LAST_NOTIFY_KEY, Date.now().toString());
  }
}
