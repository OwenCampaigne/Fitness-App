'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Detect iOS (Safari doesn't fire beforeinstallprompt)
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream;
    const standaloneMode = ('standalone' in navigator) && (navigator as Navigator & { standalone?: boolean }).standalone;

    if (ios && !standaloneMode) {
      // Show iOS-specific instructions after a brief delay
      const timer = setTimeout(() => setShow(true), 3000);
      setIsIOS(true);
      return () => clearTimeout(timer);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShow(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Don't show if already dismissed (persisted in sessionStorage)
  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('pwa-dismissed')) {
      setShow(false);
    }
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setShow(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShow(false);
    sessionStorage.setItem('pwa-dismissed', '1');
  };

  if (!show) return null;

  return (
    <div
      className="fixed bottom-20 left-4 right-4 z-50 max-w-sm mx-auto"
      style={{ animation: 'slideUp 0.35s ease-out' }}
    >
      <style>{`@keyframes slideUp { from { transform: translateY(20px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>

      <div
        className="rounded-2xl border border-border p-4 shadow-2xl"
        style={{ background: '#111111' }}
      >
        <div className="flex items-start gap-3">
          {/* App icon preview */}
          <div
            className="flex-shrink-0 rounded-xl flex items-center justify-center gap-0.5"
            style={{ width: 48, height: 48, background: '#080808', border: '1px solid #1f1f1f' }}
          >
            {/* Mini EKG bars */}
            {[3, 3, 18, 2, 10, 3, 3].map((h, i) => (
              <div
                key={i}
                style={{
                  width: 2,
                  height: h,
                  background: i === 2 ? '#4ade80' : 'rgba(74,222,128,0.5)',
                  borderRadius: 1,
                }}
              />
            ))}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-primary">Instalar Garmin Health</p>
            {isIOS ? (
              <p className="text-[11px] text-secondary mt-0.5 leading-relaxed">
                Toca <span className="text-primary font-semibold">Compartir</span>{' '}
                <span style={{ fontSize: 13 }}>⬆</span> y luego{' '}
                <span className="text-primary font-semibold">&quot;Añadir a inicio&quot;</span> para
                acceso rápido
              </p>
            ) : (
              <p className="text-[11px] text-secondary mt-0.5">
                Accede a tus métricas de salud en un toque, sin abrir el navegador
              </p>
            )}
          </div>

          <button
            onClick={handleDismiss}
            className="flex-shrink-0 p-0.5 text-muted hover:text-secondary transition-colors"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {!isIOS && (
          <button
            onClick={handleInstall}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 active:opacity-75"
            style={{ background: '#4ade80', color: '#080808' }}
          >
            <Download size={15} />
            Instalar app
          </button>
        )}
      </div>
    </div>
  );
}
