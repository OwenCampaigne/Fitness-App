'use client';

/**
 * PushNotificationManager
 *
 * Three-layer notification strategy:
 *
 * 1. Periodic Background Sync (Chrome/Android PWA)
 *    — Service worker wakes periodically even when app is closed.
 *    — Calls /api/push/status, shows local notification if battery is low.
 *    — No VAPID / server-side push needed.
 *
 * 2. Client-side polling (app is open)
 *    — setInterval every 15 min checks currentBattery prop.
 *    — Posts SHOW_NOTIFICATION to SW if below threshold.
 *    — Works on all browsers.
 *
 * 3. Server-sent VAPID push (optional, for /api/push/check cron at 8 AM)
 *    — Requires NEXT_PUBLIC_VAPID_PUBLIC_KEY env var.
 *    — Registers a PushManager subscription and saves it to the server.
 *    — Falls back gracefully if key is missing.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, BellOff, Check, Loader2, AlertCircle, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';

const VAPID_PUBLIC_KEY   = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const LS_ENABLED         = 'push_notifications_enabled';
const LS_THRESHOLD       = 'push_battery_threshold';
const LS_LAST_SENT       = 'push_last_sent_ts';
const DEFAULT_THRESHOLD  = 30;
const POLL_INTERVAL_MS   = 15 * 60 * 1000; // 15 min
const COOLDOWN_MS        = 3  * 60 * 60 * 1000; // 3 h

type Status = 'idle' | 'requesting' | 'subscribing' | 'active' | 'error' | 'unsupported';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  const bytes   = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isCoolingDown(): boolean {
  const last = parseInt(localStorage.getItem(LS_LAST_SENT) ?? '0');
  return Date.now() - last < COOLDOWN_MS;
}

function markClientSent(): void {
  localStorage.setItem(LS_LAST_SENT, String(Date.now()));
}

interface Props {
  currentBattery: number; // live body battery from dashboard data
}

export default function PushNotificationManager({ currentBattery }: Props) {
  const [status,        setStatus]        = useState<Status>('idle');
  const [threshold,     setThreshold]     = useState<number>(DEFAULT_THRESHOLD);
  const [expanded,      setExpanded]      = useState(false);
  const [errorMsg,      setErrorMsg]      = useState('');
  const [testing,       setTesting]       = useState(false);
  const [hasPeriodic,   setHasPeriodic]   = useState(false); // supports periodicSync
  const [hasVapid,      setHasVapid]      = useState(false); // VAPID key present
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load persisted state on mount ─────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      setStatus('unsupported');
      return;
    }

    setHasVapid(!!VAPID_PUBLIC_KEY);

    const savedThreshold = parseInt(localStorage.getItem(LS_THRESHOLD) ?? String(DEFAULT_THRESHOLD));
    const thresh = isNaN(savedThreshold) ? DEFAULT_THRESHOLD : savedThreshold;
    setThreshold(thresh);

    const savedEnabled = localStorage.getItem(LS_ENABLED) === 'true';
    if (savedEnabled && Notification.permission === 'granted') {
      setStatus('active');
      reRegisterSilently(thresh);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Client-side polling when app is open ──────────────────────────────────
  useEffect(() => {
    if (status !== 'active') {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    const check = () => {
      if (currentBattery <= 0 || currentBattery > threshold) return;
      if (isCoolingDown()) return;

      const urgency = currentBattery <= 15 ? '¡Muy baja!' : 'Baja';
      navigator.serviceWorker.controller?.postMessage({
        type:  'SHOW_NOTIFICATION',
        title: `🔋 Batería Corporal ${urgency}`,
        body:  `Tu batería corporal está al ${currentBattery}% — es momento de descansar.`,
        tag:   'battery-alert',
      });
      markClientSent();
    };

    // Check immediately on mount/threshold change, then on interval
    check();
    pollRef.current = setInterval(check, POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [status, currentBattery, threshold]);

  // ── Register Periodic Background Sync ────────────────────────────────────
  const registerPeriodicSync = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!('periodicSync' in reg)) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ps = (reg as any).periodicSync;
      await ps.register('battery-check', { minInterval: 30 * 60 * 1000 }); // 30 min hint
      setHasPeriodic(true);
    } catch {
      // periodicSync requires user permission on some browsers — fail silently
    }
  }, []);

  // ── Unregister Periodic Background Sync ──────────────────────────────────
  const unregisterPeriodicSync = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!('periodicSync' in reg)) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ps = (reg as any).periodicSync;
      await ps.unregister('battery-check');
      setHasPeriodic(false);
    } catch { /* best-effort */ }
  }, []);

  // ── Re-register silently on page load ────────────────────────────────────
  const reRegisterSilently = useCallback(async (thresh: number) => {
    try {
      await registerPeriodicSync();

      if (!VAPID_PUBLIC_KEY) return; // skip push subscription if no VAPID key

      const reg = await navigator.serviceWorker.ready;
      if (!('pushManager' in reg)) return;
      const sub = await reg.pushManager.getSubscription() ??
                  await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
                  });
      await fetch('/api/push/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ subscription: sub.toJSON(), threshold: thresh }),
      });
    } catch {
      // Silently fail — polling still works
    }
  }, [registerPeriodicSync]);

  // ── Enable notifications ──────────────────────────────────────────────────
  const handleEnable = async () => {
    setStatus('requesting');
    setErrorMsg('');

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setStatus('error');
      setErrorMsg('Permiso denegado. Actívalo en Ajustes → Notificaciones de tu dispositivo.');
      return;
    }

    setStatus('subscribing');

    try {
      // Layer 1: Periodic Background Sync (no VAPID needed)
      await registerPeriodicSync();

      // Layer 2: VAPID Push subscription (only if key is configured)
      if (VAPID_PUBLIC_KEY) {
        const reg = await navigator.serviceWorker.ready;
        if ('pushManager' in reg) {
          const sub = await reg.pushManager.getSubscription() ??
                      await reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
                      });
          const res = await fetch('/api/push/subscribe', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ subscription: sub.toJSON(), threshold }),
          });
          if (!res.ok) throw new Error(await res.text());
        }
      }

      localStorage.setItem(LS_ENABLED,   'true');
      localStorage.setItem(LS_THRESHOLD, String(threshold));
      setStatus('active');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Error desconocido');
    }
  };

  // ── Disable notifications ─────────────────────────────────────────────────
  const handleDisable = async () => {
    await unregisterPeriodicSync();

    try {
      const reg = await navigator.serviceWorker.ready;
      if ('pushManager' in reg) {
        const sub = await reg.pushManager.getSubscription();
        await sub?.unsubscribe();
      }
    } catch { /* best-effort */ }

    await fetch('/api/push/subscribe', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ unsubscribe: true }),
    }).catch(() => {});

    localStorage.setItem(LS_ENABLED, 'false');
    setStatus('idle');
  };

  // ── Save threshold change ─────────────────────────────────────────────────
  const handleThresholdChange = async (value: number) => {
    setThreshold(value);
    localStorage.setItem(LS_THRESHOLD, String(value));
    if (status === 'active') await reRegisterSilently(value);
  };

  // ── Test notification ─────────────────────────────────────────────────────
  const handleTest = async () => {
    setTesting(true);
    try {
      // Try server-sent push first (if VAPID configured and battery is low)
      if (VAPID_PUBLIC_KEY) {
        const res  = await fetch('/api/push/check?force=1');
        const data = await res.json();
        if (data.sent) { setTesting(false); return; }
      }
      // Fall back to local SW notification
      navigator.serviceWorker.controller?.postMessage({
        type:  'SHOW_NOTIFICATION',
        title: '🔋 Test de notificación',
        body:  `Batería actual: ${currentBattery}% (umbral: ${threshold}%)`,
        tag:   'battery-test',
      });
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'desconocido'}`);
    } finally {
      setTesting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const willAlert  = currentBattery > 0 && currentBattery <= threshold;
  const battColor  = willAlert ? '#f87171' : '#4ade80';

  if (status === 'unsupported') return null;

  return (
    <div className="card">
      {/* Header */}
      <button
        className="w-full card-header cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <Bell size={14} className={status === 'active' ? 'text-green-400' : 'text-secondary'} />
        <span>Notificaciones de Batería</span>

        {status === 'active' && (
          <span className="ml-2 flex items-center gap-1 text-[10px] font-semibold text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded-full">
            <Check size={9} /> Activas
          </span>
        )}
        {status === 'error' && (
          <span className="ml-2 flex items-center gap-1 text-[10px] font-semibold text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-full">
            <AlertCircle size={9} /> Error
          </span>
        )}

        {currentBattery > 0 && (
          <span className="ml-auto mr-2 text-[11px] font-bold" style={{ color: battColor }}>
            {currentBattery}%
          </span>
        )}
        {expanded ? <ChevronUp size={13} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="mt-3 flex flex-col gap-4">

          {/* Coverage badges */}
          <div className="flex flex-wrap gap-1.5">
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${status === 'active' ? 'bg-green-400/10 text-green-400' : 'bg-surface text-muted'}`}>
              📱 App abierta (15 min)
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${hasPeriodic ? 'bg-green-400/10 text-green-400' : 'bg-surface text-muted'}`}>
              {hasPeriodic ? '✓' : '○'} Background Sync
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${hasVapid && status === 'active' ? 'bg-green-400/10 text-green-400' : 'bg-surface text-muted'}`}>
              {hasVapid ? '✓' : '○'} Push servidor (8 AM)
            </span>
          </div>

          {/* Error */}
          {status === 'error' && errorMsg && (
            <div className="text-[11px] text-red-400 bg-red-400/10 rounded-lg p-2 leading-relaxed">
              {errorMsg}
            </div>
          )}

          {/* Threshold slider */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-secondary">Alertar cuando batería &lt;</span>
              <span className="text-sm font-bold text-primary">{threshold}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={60}
              step={5}
              value={threshold}
              onChange={e => handleThresholdChange(parseInt(e.target.value))}
              className="w-full accent-[#38bdf8] h-1 rounded-full bg-muted"
            />
            <div className="flex justify-between text-[9px] text-muted">
              <span>10%</span>
              <span>30%</span>
              <span>60%</span>
            </div>
          </div>

          {/* Live status */}
          {currentBattery > 0 && (
            <div className={`flex items-center justify-between text-[11px] rounded-lg px-3 py-2 ${
              willAlert ? 'bg-red-400/10 text-red-400' : 'bg-surface text-secondary'
            }`}>
              <span>Batería actual</span>
              <span className="font-bold" style={{ color: battColor }}>
                {currentBattery}% — {willAlert ? '🔔 alertaría ahora' : '✓ sobre umbral'}
              </span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            {status !== 'active' ? (
              <button
                onClick={handleEnable}
                disabled={status === 'requesting' || status === 'subscribing'}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold bg-[#38bdf8] text-[#080808] disabled:opacity-50 transition-opacity"
              >
                {(status === 'requesting' || status === 'subscribing') ? (
                  <><Loader2 size={13} className="animate-spin" /> Activando…</>
                ) : (
                  <><Bell size={13} /> Activar notificaciones</>
                )}
              </button>
            ) : (
              <>
                <button
                  onClick={handleTest}
                  disabled={testing}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold border border-[#1f1f1f] text-secondary hover:text-primary transition-colors disabled:opacity-50"
                >
                  {testing
                    ? <><Loader2 size={13} className="animate-spin" /> Enviando…</>
                    : <><RefreshCw size={13} /> Probar</>
                  }
                </button>
                <button
                  onClick={handleDisable}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold border border-[#1f1f1f] text-secondary hover:text-red-400 transition-colors"
                >
                  <BellOff size={13} /> Desactivar
                </button>
              </>
            )}
          </div>

          {status === 'active' && (
            <p className="text-[10px] text-muted text-center leading-relaxed">
              Revisión cada 15 min (app abierta) · Background sync · Cooldown 3h
            </p>
          )}
        </div>
      )}
    </div>
  );
}
