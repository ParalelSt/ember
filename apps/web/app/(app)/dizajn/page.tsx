'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { PageTitle } from '@/components/page/PageTitle';
import {
  THEME_LAYOUT_OPTIONS,
  THEME_LAYOUT_RECOMMENDED,
  THEME_LAYOUT_RECOMMENDED_REASON,
  THEME_STATES,
  type ThemeGalleryState,
  type ThemeLayoutId,
} from '@/components/library/options/themes';
import { ThemesSection } from '@/components/library/options/themes/ThemesSection';

const LAYOUT_KEY = 'dizajn-themes-layout';
const STATE_KEY = 'dizajn-themes-state';

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

function useSavedChoice<T extends string>(key: string, options: { id: T }[], defaultId?: T): [T, (id: T) => void] {
  const saved = useSyncExternalStore(
    subscribeChoices,
    () => readChoice(key),
    () => null,
  );
  const fallback = defaultId ?? options[0].id;
  const value = options.find((o) => o.id === saved)?.id ?? fallback;
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

const PILL_ON = 'rounded-full bg-ember px-row py-inset text-sm font-medium text-background';
const PILL_OFF =
  'rounded-full border border-border px-row py-inset text-sm hover:bg-card transition-colors';

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
              <span className="ml-inset rounded-full bg-background/20 px-inset text-[10px] leading-4 font-semibold uppercase tracking-wide">
                {o.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** /dizajn: the open question. Custom themes (docs/superpowers/plans/
 *  2026-09-23-themes.md, Task 0): not separate style questions any more,
 *  after the owner asked for an editor-style Appearance page with a live
 *  preview in the middle, so this is one picker for the page's whole
 *  shape, plus a state picker to see it mid-edit, failing the readability
 *  guard, and showing a theme someone else shared. */
export default function DizajnPage() {
  const [layout, setLayout] = useSavedChoice<ThemeLayoutId>(
    LAYOUT_KEY,
    THEME_LAYOUT_OPTIONS,
    THEME_LAYOUT_RECOMMENDED,
  );
  const [state, setState] = useSavedChoice<ThemeGalleryState>(STATE_KEY, THEME_STATES, 'preset');
  const recommended = THEME_LAYOUT_OPTIONS.find((o) => o.id === THEME_LAYOUT_RECOMMENDED)!;

  return (
    <div>
      <PageTitle className="mb-cluster">Design</PageTitle>
      <p className="text-meta mb-stack">
        Custom themes (five presets, an editor for the eight colours behind them, a readability
        guard, and sharing): what Settings &gt; Appearance should look like. Not built yet, no link
        points here. Everything older:{' '}
        <Link href="/dizajn/sve" className="text-foreground underline">
          the full gallery
        </Link>
        .
      </p>

      <section className="mb-section">
        <h2 className="text-section-title mb-block">Appearance page</h2>
        <p className="text-meta mb-block">
          Every candidate is an editor: a live preview of the app in the middle (a small,
          real-looking shell built from real pieces: a sidebar, a page with rows, a play button, a
          search field, the player bar) that recolours as the theme changes, with panels around it
          for picking a preset or a saved theme, tuning the eight colours, and sharing. The preview
          is recoloured with the plan&apos;s real preset values, set as CSS variables scoped to its
          own wrapper, not on <code>&lt;html&gt;</code>.
        </p>
        <p data-testid="theme-layout-recommended" className="text-meta mb-block">
          <span className="font-semibold text-foreground">Recommended: {recommended.name}.</span>{' '}
          {THEME_LAYOUT_RECOMMENDED_REASON}
        </p>

        <div className="mb-stack flex flex-wrap gap-x-section gap-y-block">
          <Picker label="Layout" options={THEME_LAYOUT_OPTIONS} value={layout} onChange={setLayout} />
          <Picker label="State" options={THEME_STATES} value={state} onChange={setState} />
        </div>

        <ThemesSection layout={layout} state={state} />
      </section>
    </div>
  );
}
