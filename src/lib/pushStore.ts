/**
 * Push subscription store — module-level singleton.
 *
 * Why no database?
 *  This is a single-user app. The client re-registers its subscription on every
 *  page load when notifications are enabled (via PushNotificationManager), so
 *  the store is always fresh while the user has the app open.
 *
 *  Cold-start gap: if Vercel cold-starts the function before the user has visited,
 *  the cron check will find no subscription and skip silently. The subscription
 *  is restored the next time the user opens the app (usually within minutes).
 *
 *  To make it fully persistent add @vercel/kv and replace saveSubscription /
 *  getStoredSubscription with KV reads/writes — the rest of the code stays the same.
 */

import type { PushSubscription as WebPushSubscription } from 'web-push';

export interface StoredPushData {
  subscription: WebPushSubscription;
  threshold:    number;   // battery % that triggers an alert (user-configurable)
  lastSentAt:   number;   // unix timestamp (ms) of last push, for cooldown
}

/** In-memory store — survives across requests in the same serverless instance. */
let store: StoredPushData | null = null;

/** Cooldown: don't send another notification within this window (ms). */
const COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours

export function saveSubscription(sub: WebPushSubscription, threshold: number): void {
  store = {
    subscription: sub,
    threshold,
    lastSentAt: store?.lastSentAt ?? 0, // preserve existing cooldown on re-register
  };
}

export function getStoredSubscription(): StoredPushData | null {
  return store;
}

export function markSent(): void {
  if (store) store.lastSentAt = Date.now();
}

export function isCoolingDown(): boolean {
  if (!store) return false;
  return Date.now() - store.lastSentAt < COOLDOWN_MS;
}

export function clearSubscription(): void {
  store = null;
}
