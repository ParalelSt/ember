'use client';

import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';
import { cn } from '@/lib/utils';
import { MOCK_PRANK_CATALOGUE, MOCK_PRANK_LOG, MOCK_PRANK_PEOPLE, MOCK_PRANK_SOUNDS, MOCK_PRANK_TARGET } from '@/app/(app)/dizajn/mock';
import type { PrankStateId } from '@/components/library/options/pranks';
import { ComposerCard, GlobalSwitchRow, LogTable, PersonRow, ScheduleBanner, StopEverythingButton } from '@/components/library/options/pranks/parts';

const CATALOGUE = MOCK_PRANK_CATALOGUE.map((t) => ({ id: t.id, title: t.title, artist: t.artist }));

export function ControlRoom({ phone, state }: { phone: boolean; state: PrankStateId }) {
  const off = state === 'off';
  const person = state === 'idle' ? null : MOCK_PRANK_TARGET;

  return (
    <div data-testid="prank-candidate-control-room" className="flex flex-col gap-section">
      <div className="flex items-center justify-between gap-row">
        <PageTitle className="mb-0">Pranks</PageTitle>
        <StopEverythingButton />
      </div>

      <GlobalSwitchRow on={!off} />
      {state === 'repeat' && <ScheduleBanner />}

      <div className={cn('flex gap-stack', phone ? 'flex-col' : 'flex-row items-start')}>
        <div className={cn('flex flex-col gap-block', phone ? 'w-full' : 'w-[280px] shrink-0')}>
          <SectionHeader title="People" />
          <div className="flex flex-col gap-inset">
            {MOCK_PRANK_PEOPLE.map((p) => (
              <PersonRow key={p.id} person={p} selected={person?.id === p.id} />
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <SectionHeader title="Compose" className="mb-block" />
          <ComposerCard person={person} sounds={MOCK_PRANK_SOUNDS} catalogue={CATALOGUE} disabled={off} repeating={state === 'repeat'} />
        </div>
      </div>

      <div>
        <SectionHeader title="Log" className="mb-block" />
        <LogTable entries={MOCK_PRANK_LOG} />
      </div>
    </div>
  );
}
