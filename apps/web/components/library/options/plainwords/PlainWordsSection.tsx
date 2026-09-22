'use client';

import { hrefFor } from '@/lib/collections';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import { PlainWordsDialog } from '@/components/library/options/plainwords/PlainWordsDialog';
import {
  PLAINWORDS_CANDIDATES,
  PLAINWORDS_RECOMMENDED,
  type PlainWordsServiceId,
  type PlainWordsStateId,
} from '@/components/library/options/plainwords';

const DESKTOP = { width: 1100, height: 640 };
const PHONE = { width: 390, height: 700 };
const LIKED_HREF = hrefFor({ kind: 'liked' });

export interface PlainWordsSectionProps {
  service: PlainWordsServiceId;
  state: PlainWordsStateId;
}

/** Every plain-words Transfer candidate in context: the whole Ember shell
 *  behind the dialog, at desktop and at 390px, driven by the owner's
 *  service and state pickers on /dizajn. The dialog itself is mock markup
 *  (PlainWordsDialog), same shape as the shipped one
 *  (components/import/TransferDialog.tsx). */
export function PlainWordsSection({ service, state }: PlainWordsSectionProps) {
  return (
    <div data-testid="plainwords-section" className="flex flex-col gap-section">
      {PLAINWORDS_CANDIDATES.map((c) => {
        const recommended = c.id === PLAINWORDS_RECOMMENDED;
        const shell = (phone: boolean) => (
          <ShellPreview
            phone={phone}
            activePath={LIKED_HREF}
            content={<div />}
            modal={<PlainWordsDialog key={`${c.id}:${service}`} candidate={c.id} service={service} state={state} phone={phone} />}
          />
        );
        return (
          <section key={c.id} data-testid="plainwords-candidate" data-candidate={c.id} className="flex flex-col gap-block">
            <div className="flex flex-wrap items-baseline gap-cluster">
              <h3 className="text-sm font-semibold">{c.name}</h3>
              {recommended && (
                <span className="rounded-full bg-ember/15 px-cluster py-inset text-xs font-semibold text-ember uppercase tracking-wide">
                  Recommended
                </span>
              )}
            </div>
            <p className="text-meta">{c.pitch}</p>
            <div className="flex flex-col gap-stack lg:flex-row lg:items-start">
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
          </section>
        );
      })}
    </div>
  );
}
