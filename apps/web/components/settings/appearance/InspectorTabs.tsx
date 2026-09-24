import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type InspectorTab = 'themes' | 'colours' | 'share';

export const INSPECTOR_TABS: { id: InspectorTab; label: string }[] = [
  { id: 'themes', label: 'Themes' },
  { id: 'colours', label: 'Colours' },
  { id: 'share', label: 'Share' },
];

/** The inspector's three tabs as pills. */
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

export function InspectorPanel({ id, active, children }: { id: InspectorTab; active: InspectorTab; children: ReactNode }) {
  if (id !== active) return null;
  return (
    <div role="tabpanel" id={`appearance-panel-${id}`} aria-labelledby={`appearance-tab-${id}`}>
      {children}
    </div>
  );
}
