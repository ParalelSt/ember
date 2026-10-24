'use client';

import { useSyncExternalStore } from 'react';
import { isHeadUnit, subscribeHeadUnit } from '@/lib/headUnit';
import { useSettingsStore } from '@/stores/useSettingsStore';

/** True on a car head unit (lib/headUnit), whatever the setting. */
export function useIsHeadUnit(): boolean {
  return useSyncExternalStore(subscribeHeadUnit, isHeadUnit, () => false);
}

/** The car controls are on: a head unit, and not switched off in Settings. */
export function useHeadUnitControls(): boolean {
  const headUnit = useIsHeadUnit();
  const on = useSettingsStore((s) => s.headUnitControls);
  return headUnit && on;
}
