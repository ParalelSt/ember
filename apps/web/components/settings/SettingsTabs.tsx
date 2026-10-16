'use client';

import { usePathname } from 'next/navigation';
import { useSettingsDesktop } from './useSettingsDesktop';
import { SettingsPicker } from './SettingsPicker';

export function SettingsTabs() {
  const path = usePathname();
  const desktop = useSettingsDesktop();
  // Scrolls with the page (owner pick settings3): no sticky column, so no
  // second scrollbar.
  return (
    <nav aria-label="Settings" className="hidden lg:block lg:w-80 shrink-0 self-start">
      {desktop && <SettingsPicker activePath={path === '/settings' ? '/settings/profile' : path} />}
    </nav>
  );
}
