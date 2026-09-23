import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface Tab {
  id: string;
  label: string;
}

/** A small local tab strip for the Inspector and Stacked layout candidates.
 *  State lives in the component (`useState`), not a store: this is a
 *  design gallery, not the real page. */
export function useTabStrip(tabs: Tab[], defaultId = tabs[0].id) {
  return useState(defaultId);
}

export function TabStrip({
  tabs,
  activeId,
  onChange,
  className,
}: {
  tabs: Tab[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('flex gap-inset overflow-x-auto', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === activeId}
          onClick={() => onChange(t.id)}
          className={cn(
            'shrink-0 rounded-full px-row py-inset text-sm font-medium transition-colors',
            t.id === activeId ? 'bg-ember text-background' : 'text-muted-foreground hover:bg-card',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ id, activeId, children }: { id: string; activeId: string; children: ReactNode }) {
  if (id !== activeId) return null;
  return (
    <div role="tabpanel" data-testid={`tabpanel-${id}`}>
      {children}
    </div>
  );
}
