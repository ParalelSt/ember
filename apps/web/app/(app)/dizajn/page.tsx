'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageTitle } from '@/components/page/PageTitle';
import { cn } from '@/lib/utils';
import { AttachmentsSection } from '@/components/library/options/attachments/AttachmentsSection';
import {
  ATTACH_RECOMMENDED_REASON,
  ATTACH_STATES,
  type AttachState,
} from '@/components/library/options/attachments';

/** /dizajn: only the question open right now. The full gallery of past
 *  picks and candidates lives at /dizajn/sve. Mock data only; no link in
 *  the app points here. */
export default function DizajnPage() {
  const [state, setState] = useState<AttachState>('files');
  return (
    <div>
      <PageTitle className="mb-cluster">Attach screenshots and recordings</PageTitle>
      <p className="text-meta mb-block max-w-3xl">
        For Bug report, New feature and Fix: images and short clips that go to your Discord with the
        message. Three ways to show it, each drawn in both forms. {ATTACH_RECOMMENDED_REASON}
      </p>
      <div role="radiogroup" aria-label="State" className="mb-stack flex flex-wrap gap-cluster">
        {ATTACH_STATES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={state === s.id}
            onClick={() => setState(s.id)}
            className={cn(
              'rounded-full border px-row py-inset text-sm',
              state === s.id ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <AttachmentsSection state={state} />
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
