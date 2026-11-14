import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type InspectorTab = 'presets' | 'mine' | 'shared' | 'colours';

/** One tab per list (the presets, my themes, other people's shared themes)
 *  and Colours, the editor. Each shows only its own content. */
export const INSPECTOR_TABS: { id: InspectorTab; label: string }[] = [
  { id: 'presets', label: 'Presets' },
  { id: 'mine', label: 'My themes' },
  { id: 'shared', label: 'Shared' },
  { id: 'colours', label: 'Colours' },
];

/** The inspector's tabs as pills. Sharing is not a tab of its own: each of
 *  my themes has its own switch in My themes (bughunt F3); Shared lists
 *  what other people shared. */
export function InspectorTabStrip({ active, onChange }: { active: InspectorTab; onChange: (id: InspectorTab) => void }) {
  return (
    <div role="tablist" aria-label="Appearance" className="flex gap-inset overflow-x-auto">
      {INSPECTOR_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`appearance-tab-${t.id}`}
          aria-selected={t.id === active}
          aria-controls={`appearance-panel-${t.id}`}
          onClick={() => onChange(t.id)}
          className={cn(
            'shrink-0 rounded-full px-row py-inset text-sm font-medium transition-colors',
            t.id === active ? 'bg-ember text-ember-foreground' : 'text-muted-foreground hover:bg-card',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** A tab's content, only while its tab is the open one. */
export function InspectorPanel({ id, active, children }: { id: InspectorTab; active: InspectorTab; children: ReactNode }) {
  if (id !== active) return null;
  return (
    <div role="tabpanel" id={`appearance-panel-${id}`} aria-labelledby={`appearance-tab-${id}`}>
      {children}
    </div>
  );
}
