'use client';

// ── The page edge (the training log) ─────────────────────────────────────────
// Not a floating pill bar: the bottom rule of the page, with the index of the
// book written along it. Words rather than icons, because a diary's index is
// words and because seven stacked icon-plus-label tabs is the crowding this
// replaces.
//
// Six destinations, down from seven. `/preferences` moved to the top of
// `/profile` — it is a thing the app believes about *you*, it lives with the
// other things the app believes about you, and one tap from a tab is a door,
// not a burial. Two routes are reached from a page header rather than here:
// `/exercises` from `/strength`, `/trends` from `/week`.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { useLang } from '@/lib/i18n';

export default function BottomNav() {
  const pathname = usePathname();
  const { t } = useLang();

  const TABS = [
    { href: '/', label: t('nav.home') },
    { href: '/week', label: t('nav.week') },
    { href: '/run', label: t('nav.run') },
    { href: '/strength', label: t('nav.strength') },
    { href: '/niggle', label: t('nav.niggle') },
    { href: '/profile', label: t('nav.profile') },
  ];

  return (
    <nav
      aria-label={t('nav.label')}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-rule bg-paper safe-pb"
    >
      <ul className="mx-auto flex max-w-md">
        {TABS.map(({ href, label }) => {
          const active = pathname === href;
          return (
            <li key={href} className="min-w-0 flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  // The active tab is marked the way a page is marked: a short
                  // rule drawn over the edge, not a coloured chip.
                  '-mt-px block truncate border-t-2 px-1 py-3 text-center text-note leading-none',
                  active
                    ? 'border-ink font-semibold text-ink'
                    : 'border-transparent text-pencil hover:text-ink',
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
