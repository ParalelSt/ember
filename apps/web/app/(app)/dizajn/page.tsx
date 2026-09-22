'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageTitle } from '@/components/page/PageTitle';
import { cn } from '@/lib/utils';
import { PlainWordsSection } from '@/components/library/options/plainwords/PlainWordsSection';
import {
  PLAINWORDS_RECOMMENDED_REASON,
  PLAINWORDS_SERVICE_OPTIONS,
  PLAINWORDS_STATES,
  type PlainWordsServiceId,
  type PlainWordsStateId,
} from '@/components/library/options/plainwords';

/** /dizajn: only the question open right now. The full gallery of past
 *  picks and candidates lives at /dizajn/sve. Mock data only; no link in
 *  the app points here. */
export default function DizajnPage() {
  const [service, setService] = useState<PlainWordsServiceId>(PLAINWORDS_SERVICE_OPTIONS[0].id);
  const [state, setState] = useState<PlainWordsStateId>('asking');

  return (
    <div>
      <PageTitle className="mb-cluster">A plain-words Transfer dialog</PageTitle>
      <p className="text-meta mb-block max-w-3xl">
        The shipped Transfer dialog asks in Ember&rsquo;s own terms: a destination, then a tab named
        &ldquo;Upload a file&rdquo; or &ldquo;Paste a link&rdquo;. A friend who is not technical knows
        where their music is, not what a CSV is. Three candidates that all ask &ldquo;Where is your
        music now?&rdquo; first, then show only that service&rsquo;s steps. {PLAINWORDS_RECOMMENDED_REASON}
      </p>

      <div className="mb-stack flex flex-col gap-cluster">
        <div role="radiogroup" aria-label="Service" className="flex flex-wrap gap-cluster">
          {PLAINWORDS_SERVICE_OPTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={service === s.id}
              onClick={() => setService(s.id)}
              title={s.description}
              className={cn(
                'rounded-full border px-row py-inset text-sm',
                service === s.id ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground',
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="State" className="flex flex-wrap gap-cluster">
          {PLAINWORDS_STATES.map((s) => (
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
      </div>

      <PlainWordsSection service={service} state={state} />

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
