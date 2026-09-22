'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageTitle } from '@/components/page/PageTitle';
import { cn } from '@/lib/utils';
import { TransferSection } from '@/components/library/options/transfer/TransferSection';
import {
  TRANSFER_RECOMMENDED_REASON,
  TRANSFER_STATES,
  type TransferStateId,
} from '@/components/library/options/transfer';

/** /dizajn: only the question open right now. The full gallery of past
 *  picks and candidates lives at /dizajn/sve. Mock data only; no link in
 *  the app points here. */
export default function DizajnPage() {
  const [state, setState] = useState<TransferStateId>('idle');
  return (
    <div>
      <PageTitle className="mb-cluster">Transfer liked songs from another app</PageTitle>
      <p className="text-meta mb-block max-w-3xl">
        Bring in songs liked on Spotify, YouTube Music or anywhere else: a pasted link, an uploaded
        export file or pasted text. Where it starts, how it says &ldquo;these go to my likes&rdquo;,
        and the Liked page while it runs. {TRANSFER_RECOMMENDED_REASON}
      </p>
      <div role="radiogroup" aria-label="State" className="mb-stack flex flex-wrap gap-cluster">
        {TRANSFER_STATES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={state === s.id}
            onClick={() => setState(s.id)}
            title={s.description}
            className={cn(
              'rounded-full border px-row py-inset text-sm',
              state === s.id ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground',
            )}
          >
            {s.name}
          </button>
        ))}
      </div>
      <TransferSection state={state} />
      <p className="text-meta mt-section">
        Everything else that used to be here:{' '}
        <Link href="/dizajn/sve" className="text-foreground underline">
          the full gallery
        </Link>
        .
      </p>
    </div>
  );
}
