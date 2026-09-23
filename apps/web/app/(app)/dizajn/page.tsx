'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { PageTitle } from '@/components/page/PageTitle';
import { cn } from '@/lib/utils';
import { PranksSection } from '@/components/library/options/pranks/PranksSection';
import {
  PRANK_OPTIONS,
  PRANK_RECOMMENDED,
  PRANK_RECOMMENDED_REASON,
  PRANK_STATES,
  type PrankOptionId,
  type PrankStateId,
} from '@/components/library/options/pranks';

const STORAGE_KEY = 'dizajn-pranks-option';

// Saved picker choice. The page is server-rendered with the first option,
// so the saved one must not be read during the first (hydrating) render or
// React reports a mismatch (#418). A store read through
// useSyncExternalStore does exactly that: the server snapshot (nothing
// saved) during hydration, then the saved id straight after. Same pattern
// as the shelf and trending pickers before they shipped.
const choiceListeners = new Set<() => void>();

function subscribeChoice(listener: () => void) {
  choiceListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    choiceListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function readChoice(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function useSavedOption(): [PrankOptionId, (id: PrankOptionId) => void] {
  const saved = useSyncExternalStore(subscribeChoice, readChoice, () => null);
  const value = PRANK_OPTIONS.find((o) => o.id === saved)?.id ?? PRANK_OPTIONS[0].id;
  const set = (id: PrankOptionId) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Storage off (private window): the choice just is not remembered.
    }
    choiceListeners.forEach((l) => l());
  };
  return [value, set];
}

/** /dizajn: only the question open right now. The full gallery of past
 *  picks and candidates lives at /dizajn/sve. Mock data only; no link in
 *  the app points here. */
export default function DizajnPage() {
  const [option, setOption] = useSavedOption();
  const [state, setState] = useState<PrankStateId>('idle');

  return (
    <div>
      <PageTitle className="mb-cluster">The admin Pranks tab</PageTitle>
      <p className="text-meta mb-block max-w-3xl">
        Pick a friend, see in plain words what they are playing, play a sound over it or swap the
        song, repeat it until a time, and keep the log and the off switch close by. Three shapes for
        the same job. {PRANK_RECOMMENDED_REASON}
      </p>

      <div role="radiogroup" aria-label="Candidate" className="mb-block flex flex-wrap gap-cluster">
        {PRANK_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={option === o.id}
            onClick={() => setOption(o.id)}
            title={o.description}
            className={cn(
              'rounded-full border px-row py-inset text-sm',
              option === o.id ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground',
            )}
          >
            {o.name}
            {o.id === PRANK_RECOMMENDED && (
              <span className="ml-cluster rounded-full bg-white/20 px-cluster text-xs font-semibold uppercase tracking-wide">
                Recommended
              </span>
            )}
          </button>
        ))}
      </div>

      <div role="radiogroup" aria-label="State" className="mb-stack flex flex-wrap gap-cluster">
        {PRANK_STATES.map((s) => (
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

      <PranksSection option={option} state={state} />

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
