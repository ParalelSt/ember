'use client';

/* TEMPORARY: the desktop Settings "Design preview" switcher.
 *
 * The owner flips between the desktop Settings variants live (layout A-D,
 * rows A-C, edit A-C) and picks one. Once he has picked:
 *   1. delete this file (and DesignPreview.test.tsx),
 *   2. replace each `useSettingsDesign()` call with the picked constants,
 *   3. remove the losing variants from DesktopSettings, rows and
 *      AccountSection.
 * Nothing else in the app reads the stored choice. */

import { useState, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';

export type LayoutVariant = 'A' | 'B' | 'C' | 'D';
export type RowsVariant = 'A' | 'B' | 'C';
export type EditVariant = 'A' | 'B' | 'C';
export interface SettingsDesign {
  layout: LayoutVariant;
  rows: RowsVariant;
  edit: EditVariant;
}

// The owner's picks from the mockup picker (layout A, rows C, edit A); the
// other variants stay switchable until he confirms on the real page.
export const DEFAULT_DESIGN: SettingsDesign = { layout: 'A', rows: 'C', edit: 'A' };
export const DESIGN_STORAGE_KEY = 'ember:settings-design-preview';
const CHANGE_EVENT = 'ember:settings-design-preview';

const LAYOUTS: readonly LayoutVariant[] = ['A', 'B', 'C', 'D'];
const ROWS: readonly RowsVariant[] = ['A', 'B', 'C'];
const EDITS: readonly EditVariant[] = ['A', 'B', 'C'];

function pick<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(DESIGN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): SettingsDesign {
  if (!raw) return DEFAULT_DESIGN;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof SettingsDesign, unknown>>;
    return {
      layout: pick(LAYOUTS, v.layout) ?? DEFAULT_DESIGN.layout,
      rows: pick(ROWS, v.rows) ?? DEFAULT_DESIGN.rows,
      edit: pick(EDITS, v.edit) ?? DEFAULT_DESIGN.edit,
    };
  } catch {
    return DEFAULT_DESIGN;
  }
}

// useSyncExternalStore needs the same object back while nothing changed.
let cached: { raw: string | null; value: SettingsDesign } = { raw: null, value: DEFAULT_DESIGN };
function getSnapshot(): SettingsDesign {
  const raw = readRaw();
  if (raw !== cached.raw) cached = { raw, value: parse(raw) };
  return cached.value;
}
const getServerSnapshot = () => DEFAULT_DESIGN;

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function setSettingsDesign(patch: Partial<SettingsDesign>) {
  const next = { ...getSnapshot(), ...patch };
  try {
    window.localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or blocked storage: the switch still works for this page.
    cached = { raw: JSON.stringify(next), value: next };
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** `?settings=B&rows=C&edit=A`: any valid one is stored, so a shared link
 *  opens that variant and it sticks while moving between sections. */
export function designFromSearch(search: string): Partial<SettingsDesign> {
  const params = new URLSearchParams(search);
  const out: Partial<SettingsDesign> = {};
  const layout = pick(LAYOUTS, params.get('settings') ?? params.get('layout'));
  const rows = pick(ROWS, params.get('rows'));
  const edit = pick(EDITS, params.get('edit'));
  if (layout) out.layout = layout;
  if (rows) out.rows = rows;
  if (edit) out.edit = edit;
  return out;
}

/** The variant picks for desktop Settings (A/C/A until changed). */
export function useSettingsDesign(): SettingsDesign {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Reads the URL's variant params once when desktop Settings opens. Done
 *  in the first render (storage only, before anything reads it), not in an
 *  effect: otherwise the first render would act on the stored layout, and
 *  layout A or C would already have sent /settings on to a section. */
export function useDesignFromUrl() {
  useState(() => {
    if (typeof window === 'undefined') return null;
    const fromUrl = designFromSearch(window.location.search);
    if (Object.keys(fromUrl).length === 0) return null;
    try {
      window.localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify({ ...getSnapshot(), ...fromUrl }));
    } catch {
      // Blocked storage: the URL simply does not stick.
    }
    return null;
  });
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-cluster">
      <span className="w-12 text-muted-foreground">{label}</span>
      <div className="flex rounded-full bg-secondary p-inset">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={o === value}
            aria-label={`${label} ${o}`}
            onClick={() => onChange(o)}
            className={cn(
              'min-w-7 rounded-full px-cluster py-inset font-semibold transition-colors',
              o === value ? 'bg-ember text-ember-foreground' : 'text-foreground/70 hover:text-foreground',
            )}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The floating switcher, bottom left of desktop Settings, above the player
 *  bar. It sticks to the bottom of the scrolling page and folds down to a
 *  small pill. */
export function DesignPreviewSwitcher() {
  const design = useSettingsDesign();
  const [open, setOpen] = useState(true);
  const summary = `${design.layout}/${design.rows}/${design.edit}`;
  return (
    <div data-testid="design-preview" className="pointer-events-none sticky bottom-block z-30 h-0">
      <div className="pointer-events-auto absolute bottom-0 left-0 rounded-xl border border-border bg-popover/95 p-cluster text-xs text-popover-foreground shadow-lg backdrop-blur">
        <div className="flex items-center justify-between gap-block">
          <span className="font-semibold">Design preview</span>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="rounded-full px-cluster py-inset text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            {open ? 'Hide' : summary}
          </button>
        </div>
        {open && (
          <div className="mt-cluster flex flex-col gap-inset">
            <Segmented label="Layout" options={LAYOUTS} value={design.layout} onChange={(layout) => setSettingsDesign({ layout })} />
            <Segmented label="Rows" options={ROWS} value={design.rows} onChange={(rows) => setSettingsDesign({ rows })} />
            <Segmented label="Edit" options={EDITS} value={design.edit} onChange={(edit) => setSettingsDesign({ edit })} />
          </div>
        )}
      </div>
    </div>
  );
}
