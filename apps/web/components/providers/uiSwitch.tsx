'use client';

import type { ComponentType } from 'react';
import { useUiMode } from '@/components/providers/UiModeProvider';

/** A client route file under app/(app) that exists in both looks: renders
 *  the new page, or on a device on the Classic look the frozen one
 *  (`Legacy`, a next/dynamic import of @legacy/app/..., so the new look
 *  never downloads it). `variants` lets the route table test check the
 *  wiring without rendering whole pages. */
export function uiSwitch<P extends object>(NewView: ComponentType<P>, Legacy: ComponentType<P>) {
  function UiSwitch(props: P) {
    const { mode } = useUiMode();
    return mode === 'legacy' ? <Legacy {...props} /> : <NewView {...props} />;
  }
  UiSwitch.displayName = `UiSwitch(${NewView.displayName ?? NewView.name ?? 'Page'})`;
  UiSwitch.variants = { new: NewView, legacy: Legacy };
  return UiSwitch;
}
