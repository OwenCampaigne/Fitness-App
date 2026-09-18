'use client';

// ── /profile — everything the app believes about you ──────────────────────────
// Ordered by how much each thing changes what gets prescribed: where you are in
// rehab, what a clinician cleared, then the numbers, then the settings. The
// preference library lives here too — it is the same kind of thing (a belief
// about you, correctable by you), and since the nav no longer carries a tab for
// it, this row is its door.

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { ArrowLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useProfile } from '@/lib/useProfile';
import ProfileForm from '@/components/ProfileForm';
import WeightLog from '@/components/WeightLog';
import BottomNav from '@/components/BottomNav';
import NotificationSettings from '@/components/NotificationSettings';
import ClearanceForm from '@/components/intake/ClearanceForm';
import RehabStageCard from '@/components/intake/RehabStageCard';
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
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-rule border-t-ink" />
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

  const section = 'mt-8 border-t border-rule pt-6';

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
          <Link
            href="/"
            aria-label={t('nav.home')}
            className="rounded-sm p-1 text-pencil transition-colors hover:text-ink"
          >
            <ArrowLeft size={18} />
          </Link>
          <h1 className="font-serif text-head text-ink">{t('profile.title')}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 pb-28 pt-5">
        {/* ── Who the app thinks you are ── */}
        {profile && (
          <div className="border-b border-rule pb-4">
            <p className="font-sans text-entry text-ink">
              {profile.name ?? (profile.sex === 'male' ? t('profile.male') : t('profile.female'))},{' '}
              <span className="figures">{profile.age}</span> {t('common.units.years')}
            </p>
            <p className="mt-0.5 font-serif text-note italic text-pencil">
              {FITNESS_LABEL[profile.fitnessLevel]} · {GOAL_LABEL[profile.goal]}
              {profile.weight ? ` · ${profile.weight} kg` : ''}
            </p>
          </div>
        )}

        {/* ── The preference library (§13) ── */}
        <Link
          href="/preferences"
          className="group flex items-baseline justify-between gap-3 border-b border-rule py-4"
        >
          <span>
            <span className="font-sans text-entry text-ink group-hover:underline">
              {t('profile.rulesLink')}
            </span>
            <span className="mt-0.5 block font-serif text-note italic text-pencil">
              {t('profile.rulesLinkNote')}
            </span>
          </span>
          <ChevronRight size={16} className="flex-shrink-0 self-center text-pencil" />
        </Link>

        {/* ── Rehab progression ───────────────────────────────────────────────
            Above the clearance form on purpose. Most of the time the honest
            answer to "where am I" has moved since the last clinic visit, and the
            athlete should reach the thing they can update before the thing only
            a surgeon can (§15). */}
        <div className={section}>
          <RehabStageCard />
        </div>

        {/* ── Surgical clearance ──────────────────────────────────────────────
            High on the page, above the cosmetic settings: it is the one input
            that changes what the strength and run engines will prescribe, and
            the one the app refuses to fill in on the user's behalf. */}
        <div className={section}>
          <ClearanceForm />
        </div>

        {/* ── Weight history ── */}
        <div className={section}>
          <WeightLog profile={profile} />
        </div>

        {/* ── Fitness metrics — only when profile + HR data are both there ── */}
        {profile && lastRHR > 0 && (
          <div className={section}>
            <p className="block-label">{t('profile.fitnessSection')}</p>
            <div className="flex flex-col gap-4">
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
            </div>
          </div>
        )}

        {profile && lastRHR === 0 && (
          <div className={section}>
            <p className="block-label">{t('profile.vo2maxSection')}</p>
            <p className="prose-log text-entry">{t('profile.vo2maxNote')}</p>
          </div>
        )}

        {/* ── Notifications ── */}
        <div className={section}>
          <NotificationSettings />
        </div>

        {/* ── The profile itself ── */}
        <div className={section}>
          <h2 className="font-serif text-head text-ink">
            {profile ? t('profile.update') : t('profile.create')}
          </h2>
          <div className="mt-4">
            <ProfileForm
              initial={profile ?? undefined}
              onSave={handleSave}
              ctaLabel={profile ? t('profile.update') : t('profile.save')}
            />
          </div>
        </div>

        {profile && (
          <button
            onClick={handleClear}
            className="mx-auto mt-8 flex items-center gap-2 py-2 font-sans text-note text-pencil transition-colors hover:text-stop"
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
