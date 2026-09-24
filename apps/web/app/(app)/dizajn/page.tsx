'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { PageTitle } from '@/components/page/PageTitle';
import {
  COPY_OPTIONS,
  COPY_RECOMMENDED,
  COPY_RECOMMENDED_REASON,
  COPY_STEPS,
  type CopyOptionId,
  type CopyStepId,
} from '@/components/library/options/playlist-copy';
import { PlaylistCopySection } from '@/components/library/options/playlist-copy/PlaylistCopySection';

const OPTION_KEY = 'dizajn-playlist-copy-option';
const STEP_KEY = 'dizajn-playlist-copy-step';

// Same pattern as /dizajn/sve: a picker's saved choice is read through
// useSyncExternalStore so the server-rendered first option never mismatches
// the client's localStorage pick (React #418).
const choiceListeners = new Set<() => void>();

function subscribeChoices(listener: () => void) {
  choiceListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    choiceListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function readChoice(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function useSavedChoice<T extends string>(key: string, options: { id: T }[], defaultId: T): [T, (id: T) => void] {
  const saved = useSyncExternalStore(
    subscribeChoices,
    () => readChoice(key),
    () => null,
  );
  const value = options.find((o) => o.id === saved)?.id ?? defaultId;
  const set = (id: T) => {
    try {
      window.localStorage.setItem(key, id);
    } catch {
      // Storage off (private window): the choice just is not remembered.
    }
    choiceListeners.forEach((l) => l());
  };
  return [value, set];
}

const PILL_ON = 'rounded-full bg-ember px-row py-inset text-sm font-medium text-ember-foreground';
const PILL_OFF = 'rounded-full border border-border px-row py-inset text-sm hover:bg-card transition-colors';

function Picker<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; name: string; description: string; badge?: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div>
      <div className="text-eyebrow mb-cluster">{label}</div>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-cluster">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={o.id === value}
            onClick={() => onChange(o.id)}
            title={o.description}
            className={o.id === value ? PILL_ON : PILL_OFF}
          >
            {o.name}
            {o.badge && (
              <span className="ml-inset rounded-full bg-background/20 px-inset text-xs font-semibold">{o.badge}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** /dizajn: the open question. Copying songs from one playlist to another
 *  (docs/superpowers/plans/2026-09-24-playlist-copy.md, Task 0): three
 *  shapes for the whole flow, and a step picker that puts every frame at
 *  one point of it. Mock data only; no link in the app points here. */
export default function DizajnPage() {
  const [option, setOption] = useSavedChoice<CopyOptionId>(OPTION_KEY, COPY_OPTIONS, COPY_RECOMMENDED);
  const [step, setStep] = useSavedChoice<CopyStepId>(STEP_KEY, COPY_STEPS, 'select');
  const chosen = COPY_OPTIONS.find((o) => o.id === option)!;
  const recommended = COPY_OPTIONS.find((o) => o.id === COPY_RECOMMENDED)!;

  return (
    <div>
      <PageTitle className="mb-cluster">Design</PageTitle>
      <p className="text-meta mb-stack">
        Copying songs from one playlist to another: not built yet, no link points here. Everything older:{' '}
        <Link href="/dizajn/sve" className="text-foreground underline">
          the full gallery
        </Link>
        .
      </p>

      <section className="mb-section">
        <h2 className="text-section-title mb-block">Copy songs to another playlist</h2>
        <p className="text-meta mb-block">
          Pick songs one by one or all at once, sort the list, and copy them into another playlist, a new
          one, or Liked songs. Songs already there are skipped, using the same rule as the Liked hearts, so
          two different songs that only share a title are both copied. Every frame is clickable: start at
          any step and carry on from there.
        </p>
        <p data-testid="copy-recommended" className="text-meta mb-block">
          <span className="font-semibold text-foreground">Recommended: {recommended.name}.</span> {COPY_RECOMMENDED_REASON}
        </p>

        <div className="mb-stack flex flex-wrap gap-x-section gap-y-block">
          <Picker label="Candidate" options={COPY_OPTIONS} value={option} onChange={setOption} />
          <Picker label="Step" options={COPY_STEPS} value={step} onChange={setStep} />
        </div>
        <p data-testid="copy-option-description" className="text-meta mb-stack">
          <span className="font-semibold text-foreground">{chosen.name}:</span> {chosen.description}
        </p>

        <PlaylistCopySection option={option} step={step} />

        <p className="text-meta mt-stack">
          The mock&apos;s duplicates, all 15 songs into Liked songs: Slow Static is the same track (skipped),
          Harbor Lights is liked as &ldquo;Harbor Lights (Official Video)&rdquo; by Coastline - Topic
          (skipped), Звезда is liked as its official video (skipped). Home by Edward Sharpe is copied even
          though Home by Phillip Phillips is liked, and Northbound is copied next to Northbound (Live): a
          different artist or a different recording is a different song. So: added 12, skipped 3.
        </p>
      </section>
    </div>
  );
}
