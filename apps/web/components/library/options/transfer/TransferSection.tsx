'use client';

import { useState, type ReactNode } from 'react';
import { hrefFor } from '@/lib/collections';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import { EntryPointBehind, EntryPointDialog } from '@/components/library/options/transfer/EntryPoints';
import type { SourceTab } from '@/components/library/options/transfer/DestinationStep';
import { LikedPageStates } from '@/components/library/options/transfer/LikedPageStates';
import {
  TRANSFER_DESTINATION_OPTIONS,
  TRANSFER_DESTINATION_RECOMMENDED,
  TRANSFER_ENTRY_OPTIONS,
  TRANSFER_ENTRY_RECOMMENDED,
  type TransferDestinationId,
  type TransferEntryId,
  type TransferStateId,
} from '@/components/library/options/transfer';

const DESKTOP = { width: 1100, height: 640 };
const PHONE = { width: 390, height: 700 };
const LIKED_HREF = hrefFor({ kind: 'liked' });

/** Desktop scaled frame next to a phone scaled frame, the two widths every
 *  candidate is drawn at (plan 2.7). */
function TwoFrames({ desktop, phone }: { desktop: ReactNode; phone: ReactNode }) {
  return (
    <div className="flex flex-col gap-stack lg:flex-row lg:items-start">
      <div className="min-w-0 lg:flex-[1100_1_0%]">
        <div className="text-eyebrow mb-cluster">Desktop</div>
        <ScaledFrame width={DESKTOP.width} height={DESKTOP.height}>
          {desktop}
        </ScaledFrame>
      </div>
      <div className="w-full min-w-0 max-w-[390px] lg:flex-[390_1_0%]">
        <div className="text-eyebrow mb-cluster">Phone (390px)</div>
        <ScaledFrame width={PHONE.width} height={PHONE.height}>
          {phone}
        </ScaledFrame>
      </div>
    </div>
  );
}

function EntryCandidate({ entry, destination, sourceTab, onSourceTab }: { entry: TransferEntryId; destination: TransferDestinationId; sourceTab: SourceTab; onSourceTab: (t: SourceTab) => void }) {
  const option = TRANSFER_ENTRY_OPTIONS.find((o) => o.id === entry)!;
  const recommended = entry === TRANSFER_ENTRY_RECOMMENDED;
  const shell = (phone: boolean) => (
    <ShellPreview
      phone={phone}
      activePath={entry === 'settings-row' ? '' : LIKED_HREF}
      content={<EntryPointBehind entry={entry} />}
      modal={<EntryPointDialog entry={entry} phone={phone} destination={destination} sourceTab={sourceTab} onSourceTab={onSourceTab} />}
    />
  );
  return (
    <div data-testid="transfer-entry-candidate" data-entry={entry} className="flex flex-col gap-block">
      <div className="flex flex-wrap items-baseline gap-cluster">
        <h3 className="text-sm font-semibold">{option.name}</h3>
        {recommended && (
          <span className="rounded-full bg-ember/15 px-cluster py-inset text-xs font-semibold text-ember uppercase tracking-wide">
            Recommended
          </span>
        )}
      </div>
      <p className="text-meta">{option.description}</p>
      <TwoFrames desktop={shell(false)} phone={shell(true)} />
    </div>
  );
}

function DestinationCandidate({ destination, entry, sourceTab, onSourceTab }: { destination: TransferDestinationId; entry: TransferEntryId; sourceTab: SourceTab; onSourceTab: (t: SourceTab) => void }) {
  const option = TRANSFER_DESTINATION_OPTIONS.find((o) => o.id === destination)!;
  const shell = (phone: boolean) => (
    <ShellPreview
      phone={phone}
      activePath={LIKED_HREF}
      content={<EntryPointBehind entry={entry} />}
      modal={<EntryPointDialog entry={entry} phone={phone} destination={destination} sourceTab={sourceTab} onSourceTab={onSourceTab} />}
    />
  );
  return (
    <div data-testid="transfer-destination-candidate" data-destination={destination} className="flex flex-col gap-block">
      <h3 className="text-sm font-semibold">{option.name}</h3>
      <p className="text-meta">{option.description}</p>
      <TwoFrames desktop={shell(false)} phone={shell(true)} />
    </div>
  );
}

export interface TransferSectionProps {
  state: TransferStateId;
}

/** The Transfer candidates in context (plan 2.7): where it starts, how the
 *  destination is said, and the Liked page while a transfer runs. Every
 *  frame is the real Ember shell (ShellPreview) on mock data; the source
 *  step's link input, drop zone and paste box are mock markup, same as the
 *  playlist import's own dialog candidates were before they shipped. */
export function TransferSection({ state }: TransferSectionProps) {
  const [sourceTab, setSourceTab] = useState<SourceTab>('link');

  return (
    <div data-testid="transfer-section" className="flex flex-col gap-section">
      <section className="flex flex-col gap-block">
        <h2 className="text-section-title">Where Transfer starts</h2>
        <div className="flex flex-col gap-stack">
          {TRANSFER_ENTRY_OPTIONS.map((o) => (
            <EntryCandidate
              key={o.id}
              entry={o.id}
              destination={TRANSFER_DESTINATION_RECOMMENDED}
              sourceTab={sourceTab}
              onSourceTab={setSourceTab}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-block">
        <h2 className="text-section-title">Where the songs land</h2>
        <div className="flex flex-col gap-stack">
          {TRANSFER_DESTINATION_OPTIONS.map((o) => (
            <DestinationCandidate
              key={o.id}
              destination={o.id}
              entry={TRANSFER_ENTRY_RECOMMENDED}
              sourceTab={sourceTab}
              onSourceTab={setSourceTab}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-block" data-testid="transfer-liked-states">
        <h2 className="text-section-title">The Liked page while a transfer runs</h2>
        <TwoFrames
          desktop={
            <ShellPreview phone={false} activePath={LIKED_HREF} content={<LikedPageStates state={state} />} />
          }
          phone={<ShellPreview phone activePath={LIKED_HREF} content={<LikedPageStates state={state} />} />}
        />
      </section>
    </div>
  );
}
