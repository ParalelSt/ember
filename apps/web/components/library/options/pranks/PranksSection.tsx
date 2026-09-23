'use client';

import type { ComponentType } from 'react';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import { ControlRoom } from '@/components/library/options/pranks/ControlRoom';
import { PersonCards } from '@/components/library/options/pranks/PersonCards';
import { Wizard } from '@/components/library/options/pranks/Wizard';
import type { PrankOptionId, PrankStateId } from '@/components/library/options/pranks';

const DESKTOP = { width: 1100, height: 720 };
const PHONE = { width: 390, height: 780 };

const CANDIDATES: Record<PrankOptionId, ComponentType<{ phone: boolean; state: PrankStateId }>> = {
  'control-room': ControlRoom,
  'card-per-person': PersonCards,
  wizard: Wizard,
};

export interface PranksSectionProps {
  option: PrankOptionId;
  state: PrankStateId;
}

/** The chosen Pranks candidate, drawn inside the real Ember admin shell at
 *  desktop and phone widths (plan Task 0). Mock data only: the People,
 *  Compose, Library and Log regions all render from ./mock.ts, and the
 *  state picker on /dizajn switches every frame at once. */
export function PranksSection({ option, state }: PranksSectionProps) {
  const Candidate = CANDIDATES[option];

  const shell = (phone: boolean) => (
    <ShellPreview phone={phone} activePath="/admin/pranks" content={<Candidate phone={phone} state={state} />} />
  );

  return (
    <div data-testid="pranks-section" data-option={option} data-state={state} className="flex flex-col gap-stack lg:flex-row lg:items-start">
      <div className="min-w-0 lg:flex-[1100_1_0%]">
        <div className="text-eyebrow mb-cluster">Desktop</div>
        <ScaledFrame width={DESKTOP.width} height={DESKTOP.height}>
          {shell(false)}
        </ScaledFrame>
      </div>
      <div className="w-full min-w-0 max-w-[390px] lg:flex-[390_1_0%]">
        <div className="text-eyebrow mb-cluster">Phone (390px)</div>
        <ScaledFrame width={PHONE.width} height={PHONE.height}>
          {shell(true)}
        </ScaledFrame>
      </div>
    </div>
  );
}
