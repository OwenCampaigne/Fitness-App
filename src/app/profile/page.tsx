'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { ArrowLeft, User, Trash2, ChevronRight } from 'lucide-react';
import { useProfile } from '@/lib/useProfile';
import ProfileForm from '@/components/ProfileForm';
import WeightLog from '@/components/WeightLog';
import BottomNav from '@/components/BottomNav';
import NotificationSettings from '@/components/NotificationSettings';
import VO2maxCard from '@/components/VO2maxCard';
import TrainingZonesCard from '@/components/TrainingZonesCard';
import type { UserProfile } from '@/lib/types';
import { useLang } from '@/lib/i18n';

export default function ProfilePage() {
  const router = useRouter();
  const { t } = useLang();
  const { profile, saveProfile, clearProfile, loaded } = useProfile();

  const FITNESS_LABEL: Record<string, string> = {
    beginner:     t('profile.fitnessLevels.beginner'),
    intermediate: t('profile.fitnessLevels.intermediate'),
    advanced:     t('profile.fitnessLevels.advanced'),
    athlete:      t('profile.fitnessLevels.athlete'),
  };

  const GOAL_LABEL: Record<string, string> = {
    recovery:       t('profile.goals.recovery'),
    performance:    t('profile.goals.performance'),
    weight_loss:    t('profile.goals.weight_loss'),
    general_health: t('profile.goals.general_health'),
  };


  const [lastRHR, setLastRHR] = useState(0);
  const [observedMaxHR, setObservedMaxHR] = useState<number | undefined>(undefined);
  useEffect(() => {
    const rhr = parseInt(localStorage.getItem('garmin_last_rhr') ?? '0', 10);
    const maxHR = parseInt(localStorage.getItem('garmin_observed_max_hr') ?? '0', 10);
    if (rhr > 0) setLastRHR(rhr);
    if (maxHR > 100) setObservedMaxHR(maxHR);
  }, []);

  if (!loaded) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-border border-t-primary animate-spin" />
      </div>
    );
  }

  const handleSave = (p: UserProfile) => {
    saveProfile(p);
    router.push('/');
  };

  const handleClear = () => {
    if (confirm(t('profile.deleteConfirm'))) {
      clearProfile();
    }
  };


  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 bg-bg/95 backdrop-blur border-b border-border">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="p-1.5 rounded-lg hover:bg-surface text-secondary hover:text-primary transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <User size={16} className="text-secondary" />
          <h1 className="text-sm font-bold text-primary">{t('profile.title')}</h1>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-28 pt-4 flex flex-col gap-4">

        {/* Summary card if profile exists */}
        {profile && (
          <div className="card flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
              <User size={22} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-primary truncate">
                {profile.name ?? (profile.sex === 'male' ? t('profile.male') : t('profile.female'))}, {profile.age} {t('common.units.years')}
              </p>
              <p className="text-xs text-secondary">
                {FITNESS_LABEL[profile.fitnessLevel]} · {GOAL_LABEL[profile.goal]}
              </p>
              {profile.weight && (
                <p className="text-xs mt-0.5 text-muted">
                  {profile.weight} kg
                </p>
              )}
            </div>
            <ChevronRight size={16} className="text-muted flex-shrink-0" />
          </div>
        )}


        {/* Weight history log */}
        <WeightLog profile={profile} />

        {/* ── Fitness metrics (VO2max + Training Zones) — only when profile + HR data available ── */}
        {profile && lastRHR > 0 && (
          <>
            <div className="mt-2 mb-1">
              <p className="text-xs font-semibold text-secondary uppercase tracking-widest">
                {t('profile.fitnessSection')}
              </p>
            </div>
            <VO2maxCard
              restingHR={lastRHR}
              age={profile.age}
              sex={profile.sex}
              observedMaxHR={observedMaxHR}
            />
            <TrainingZonesCard
              restingHR={lastRHR}
              age={profile.age}
              observedMaxHR={observedMaxHR}
            />
          </>
        )}

        {/* Hint when no HR data yet */}
        {profile && lastRHR === 0 && (
          <div className="card border-dashed">
            <div className="flex items-center gap-3">
              <User size={16} className="text-muted" />
              <div>
                <p className="text-sm text-secondary font-medium">{t('profile.vo2maxSection')}</p>
                <p className="text-xs text-muted">{t('profile.vo2maxNote')}</p>
              </div>
            </div>
          </div>
        )}

        {/* Notification settings */}
        <NotificationSettings />

        {/* Form */}
        <div className="card">
          <h2 className="text-xs font-semibold text-secondary uppercase tracking-widest mb-4">
            {profile ? t('profile.update') : t('profile.create')}
          </h2>
          <ProfileForm
            initial={profile ?? undefined}
            onSave={handleSave}
            ctaLabel={profile ? t('profile.update') : t('profile.save')}
          />
        </div>

        {/* Danger zone */}
        {profile && (
          <button
            onClick={handleClear}
            className="flex items-center gap-2 text-xs text-muted hover:text-recovery-red transition-colors mx-auto py-2"
          >
            <Trash2 size={13} />
            {t('profile.delete')}
          </button>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
