'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSettingsDesktop } from './useSettingsDesktop';
import { SettingsPicker } from './SettingsPicker';

/** Keep the grouped phone home and open Profile on desktop. */
export function SettingsHome() {
  const desktop = useSettingsDesktop();
  const router = useRouter();
  useEffect(() => { if (desktop) router.replace('/settings/profile'); }, [desktop, router]);
  return desktop ? null : <div className="lg:hidden"><SettingsPicker /></div>;
}
