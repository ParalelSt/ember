'use client';

import { useSyncExternalStore } from 'react';
import { canUseDesktopPlugins, subscribeDesktopPlugins } from '@/lib/desktopPlugins';

export function useDesktopPlugins(): boolean {
  return useSyncExternalStore(subscribeDesktopPlugins, canUseDesktopPlugins, () => false);
}
