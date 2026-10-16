'use client';

import { usePathname } from 'next/navigation';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { SettingsPicker } from './SettingsPicker';

export function SettingsTabs() {
  const path = usePathname();
  const desktop = useIsDesktop();
  return (
    <nav aria-label="Settings" className="hidden md:block md:w-72 lg:w-80 shrink-0 self-start sticky top-[calc(var(--ember-topbar-h,0px)+var(--spacing-block))] max-h-[calc(var(--ember-scroller-h,100dvh)-var(--ember-topbar-h,0px)-var(--spacing-section))] overflow-y-auto">
      {desktop && <SettingsPicker activePath={path === '/settings' ? '/settings/profile' : path} />}
    </nav>
  );
}
