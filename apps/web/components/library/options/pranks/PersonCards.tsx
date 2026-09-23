'use client';

import { useState } from 'react';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';
import { cn } from '@/lib/utils';
import { MOCK_PRANK_CATALOGUE, MOCK_PRANK_LOG, MOCK_PRANK_PEOPLE, MOCK_PRANK_SOUNDS, MOCK_PRANK_TARGET, type MockPrankPerson } from '@/app/(app)/dizajn/mock';
import type { PrankStateId } from '@/components/library/options/pranks';
import { ComposerCard, GlobalSwitchRow, LogTable, PersonDot, ScheduleBanner, StopEverythingButton, personLine } from '@/components/library/options/pranks/parts';

const CATALOGUE = MOCK_PRANK_CATALOGUE.map((t) => ({ id: t.id, title: t.title, artist: t.artist }));

function PersonCard({ person, onOpen, off }: { person: MockPrankPerson; onOpen: () => void; off: boolean }) {
  return (
    <div data-testid="prank-person-card" data-person={person.id} className="flex flex-col gap-cluster rounded-lg border border-border p-row">
      <div className="flex items-center gap-inset">
        <PersonDot status={person.status} />
        <span className="text-row-title">{person.name}</span>
      </div>
      <div className="text-row-sub">{personLine(person)}</div>
      <div className="flex flex-wrap gap-inset">
        <button type="button" onClick={onOpen} disabled={off} className="rounded-full border border-border px-row py-inset text-sm disabled:opacity-40">
          Sound
        </button>
        <button type="button" onClick={onOpen} disabled={off} className="rounded-full border border-border px-row py-inset text-sm disabled:opacity-40">
          Swap
        </button>
        <button type="button" onClick={onOpen} disabled={off} className="rounded-full border border-border px-row py-inset text-sm disabled:opacity-40">
          Repeat
        </button>
      </div>
    </div>
  );
}

export function PersonCards({ phone, state }: { phone: boolean; state: PrankStateId }) {
  const off = state === 'off';
  const defaultPerson = state === 'idle' ? null : MOCK_PRANK_TARGET;
  const [sheetPerson, setSheetPerson] = useState<MockPrankPerson | null>(defaultPerson);
  const [sheetOpen, setSheetOpen] = useState(state !== 'idle');
  const person = sheetOpen ? sheetPerson : null;

  return (
    <div data-testid="prank-candidate-card-per-person" className="relative flex flex-col gap-section">
      <div className="flex items-center justify-between gap-row">
        <PageTitle className="mb-0">Pranks</PageTitle>
        <StopEverythingButton />
      </div>

      <GlobalSwitchRow on={!off} />
      {state === 'repeat' && <ScheduleBanner />}

      <div>
        <SectionHeader title="People" className="mb-block" />
        <div className={cn('grid gap-block', phone ? 'grid-cols-1' : 'grid-cols-2')}>
          {MOCK_PRANK_PEOPLE.map((p) => (
            <PersonCard
              key={p.id}
              person={p}
              off={off}
              onOpen={() => {
                setSheetPerson(p);
                setSheetOpen(true);
              }}
            />
          ))}
        </div>
      </div>

      <div>
        <SectionHeader title="Log" className="mb-block" />
        <div data-testid="prank-log-feed" className="flex flex-col gap-block">
          <LogTable entries={MOCK_PRANK_LOG} />
        </div>
      </div>

      {sheetOpen && (
        <div data-testid="prank-compose-sheet" className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-border bg-background p-row shadow-soft">
          <div className="mb-block flex items-center justify-between gap-row">
            <div className="text-row-title">{sheetPerson ? `Compose for ${sheetPerson.name}` : 'Compose'}</div>
            <button type="button" onClick={() => setSheetOpen(false)} className="text-row-sub">
              Close
            </button>
          </div>
          <ComposerCard person={person} sounds={MOCK_PRANK_SOUNDS} catalogue={CATALOGUE} disabled={off} repeating={state === 'repeat'} />
        </div>
      )}
    </div>
  );
}
