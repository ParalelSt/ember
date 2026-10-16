'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { SettingsPicker } from './SettingsPicker';

/** Keep the grouped phone home and open Profile on desktop. */
export function SettingsHome() {
  const desktop = useIsDesktop();
  const router = useRouter();
  useEffect(() => { if (desktop) router.replace('/settings/profile'); }, [desktop, router]);
  return desktop ? null : <div className="md:hidden"><SettingsPicker /></div>;
}
