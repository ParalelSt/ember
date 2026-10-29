'use client';

import { useSyncExternalStore } from 'react';
import { isHeadUnit, subscribeHeadUnit } from '@/lib/headUnit';
import { useSettingsStore } from '@/stores/useSettingsStore';

/** True on a car head unit (lib/headUnit), whatever the setting. */
export function useIsHeadUnit(): boolean {
  return useSyncExternalStore(subscribeHeadUnit, isHeadUnit, () => false);
}

/** The car layout is on: a head unit, and not switched off in Settings.
 *  Then the shell shows the icon rail (components/nav/CarRail) and the
 *  player its car bar (components/player/CarPlayerBar). */
export function useHeadUnitControls(): boolean {
  const headUnit = useIsHeadUnit();
  const on = useSettingsStore((s) => s.headUnitControls);
  return headUnit && on;
}
