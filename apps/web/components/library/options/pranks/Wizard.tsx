'use client';

import { useState } from 'react';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';
import { cn } from '@/lib/utils';
import { MOCK_PRANK_CATALOGUE, MOCK_PRANK_LOG, MOCK_PRANK_PEOPLE, MOCK_PRANK_SOUNDS, MOCK_PRANK_TARGET, type MockPrankPerson } from '@/app/(app)/dizajn/mock';
import type { PrankStateId } from '@/components/library/options/pranks';
import { ComposerCard, GlobalSwitchRow, LogTable, PersonRow, ScheduleBanner, StopEverythingButton } from '@/components/library/options/pranks/parts';

const CATALOGUE = MOCK_PRANK_CATALOGUE.map((t) => ({ id: t.id, title: t.title, artist: t.artist }));

type WizardStep = 'pick' | 'compose' | 'confirm';
type WizardTab = 'compose' | 'log';

export function Wizard({ phone, state }: { phone: boolean; state: PrankStateId }) {
  const off = state === 'off';
  const defaultPerson = state === 'idle' ? null : MOCK_PRANK_TARGET;
  const [tab, setTab] = useState<WizardTab>('compose');
  const [step, setStep] = useState<WizardStep>(state === 'idle' ? 'pick' : 'compose');
  const [person, setPerson] = useState<MockPrankPerson | null>(defaultPerson);

  return (
    <div data-testid="prank-candidate-wizard" className="flex flex-col gap-section">
      <div className="flex items-center justify-between gap-row">
        <PageTitle className="mb-0">Pranks</PageTitle>
        <StopEverythingButton />
      </div>

      <GlobalSwitchRow on={!off} />
      {state === 'repeat' && <ScheduleBanner />}

      <div role="tablist" aria-label="Pranks view" className="flex gap-inset border-b border-border">
        {(['compose', 'log'] as WizardTab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn('px-row py-cluster text-sm font-medium', tab === t ? 'border-b-2 border-foreground text-foreground' : 'text-muted-foreground')}
          >
            {t === 'compose' ? 'Compose' : 'Log'}
          </button>
        ))}
      </div>

      {tab === 'log' ? (
        <LogTable entries={MOCK_PRANK_LOG} />
      ) : (
        <div data-testid="prank-wizard-steps" data-step={step} className="flex flex-col gap-block">
          <div className="flex items-center gap-inset text-row-sub">
            <span className={cn(step === 'pick' && 'text-foreground font-medium')}>1. Person</span>
            &rsaquo;
            <span className={cn(step === 'compose' && 'text-foreground font-medium')}>2. Compose</span>
            &rsaquo;
            <span className={cn(step === 'confirm' && 'text-foreground font-medium')}>3. Confirm</span>
          </div>

          {step === 'pick' && (
            <div>
              <SectionHeader title="Who" className="mb-block" />
              <div className={cn('grid gap-block', phone ? 'grid-cols-1' : 'grid-cols-2')}>
                {MOCK_PRANK_PEOPLE.map((p) => (
                  <PersonRow
                    key={p.id}
                    person={p}
                    selected={person?.id === p.id}
                    onSelect={() => {
                      setPerson(p);
                      setStep('compose');
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {step === 'compose' && (
            <ComposerCard person={person} sounds={MOCK_PRANK_SOUNDS} catalogue={CATALOGUE} disabled={off} repeating={state === 'repeat'} />
          )}

          {step === 'confirm' && person && (
            <div data-testid="prank-confirm" className="flex flex-col gap-block rounded-lg border border-border p-row">
              <div className="text-row-title">Send to {person.name}?</div>
              <div className="text-row-sub">This lands within a second or two and is logged either way.</div>
              <div className="flex gap-row">
                <button type="button" className="rounded-full bg-foreground px-row py-inset text-sm font-medium text-background">
                  Confirm and send
                </button>
                <button type="button" onClick={() => setStep('compose')} className="rounded-full border border-border px-row py-inset text-sm font-medium">
                  Back
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-row">
            {step === 'compose' && person && (
              <button type="button" onClick={() => setStep('confirm')} className="rounded-full border border-border px-row py-inset text-sm font-medium">
                Next
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
