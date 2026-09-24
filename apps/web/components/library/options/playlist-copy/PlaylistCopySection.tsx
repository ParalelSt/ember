'use client';

import type { ComponentType } from 'react';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import { CheckboxColumn } from '@/components/library/options/playlist-copy/CheckboxColumn';
import { TapSelect } from '@/components/library/options/playlist-copy/TapSelect';
import { CopyDialog } from '@/components/library/options/playlist-copy/CopyDialog';
import type { CopyOptionId, CopyStepId } from '@/components/library/options/playlist-copy';

export const COPY_DESKTOP = { width: 1280, height: 800 };
export const COPY_PHONE = { width: 390, height: 844 };

const CANDIDATES: Record<CopyOptionId, ComponentType<{ phone: boolean; step: CopyStepId }>> = {
  'checkbox-bar': CheckboxColumn,
  'tap-select': TapSelect,
  'copy-dialog': CopyDialog,
};

export interface PlaylistCopySectionProps {
  option: CopyOptionId;
  step: CopyStepId;
}

/** The chosen Playlist copy candidate inside the Ember shell, at a 1280
 *  desktop window and a 390 phone, both put at `step` of the flow (keyed on
 *  it, so picking a step starts that frame over there). Every frame stays
 *  clickable from that point on. Mock data only. */
export function PlaylistCopySection({ option, step }: PlaylistCopySectionProps) {
  const Candidate = CANDIDATES[option];
  return (
    <div data-testid="playlist-copy-section" data-option={option} data-step={step} className="flex flex-col gap-stack">
      <div data-testid="copy-frame-desktop" className="min-w-0">
        <div className="text-eyebrow mb-cluster">Desktop (1280px)</div>
        <ScaledFrame width={COPY_DESKTOP.width} height={COPY_DESKTOP.height}>
          <Candidate key={`${option}-${step}-desktop`} phone={false} step={step} />
        </ScaledFrame>
      </div>
      <div data-testid="copy-frame-phone" className="w-full min-w-0 max-w-[390px]">
        <div className="text-eyebrow mb-cluster">Phone (390px)</div>
        <ScaledFrame width={COPY_PHONE.width} height={COPY_PHONE.height}>
          <Candidate key={`${option}-${step}-phone`} phone step={step} />
        </ScaledFrame>
      </div>
    </div>
  );
}
