'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { RowsVariant } from './DesignPreview';

/** How desktop Settings draws its rows (owner picks one, see DesignPreview):
 *  A: plain rows with thin lines between them, like the song lists.
 *  B: each group in one soft rounded card.
 *  C: no lines, more room between rows. */
const RowsContext = createContext<RowsVariant>('C');

export function SettingsRowsProvider({ value, children }: { value: RowsVariant; children: ReactNode }) {
  return <RowsContext.Provider value={value}>{children}</RowsContext.Provider>;
}

export const useRowsVariant = () => useContext(RowsContext);

/** A group of rows under a small grey title. */
export function SettingsGroup({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  const rows = useRowsVariant();
  return (
    <section className={cn('flex flex-col', rows === 'C' ? 'gap-cluster' : 'gap-inset')}>
      {title && <h3 className="text-eyebrow font-semibold">{title}</h3>}
      <div
        data-settings-group
        data-rows-style={rows}
        className={cn(
          rows === 'A' && 'divide-y divide-border border-b border-border',
          rows === 'B' && 'divide-y divide-border rounded-lg bg-card px-block',
          rows === 'C' && 'flex flex-col gap-cluster',
        )}
      >
        {children}
      </div>
      {footer && <p className="text-xs text-muted-foreground">{footer}</p>}
    </section>
  );
}

/** One setting: its name and a grey line on the left, its control on the
 *  right. `children` sit under the text (an input, a list). */
export function SettingsRow({
  title,
  description,
  control,
  leading,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  leading?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const rows = useRowsVariant();
  return (
    <div data-settings-row className={cn('flex items-center gap-block', rows === 'C' ? 'py-block' : 'py-row', className)}>
      {leading}
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{title}</div>
        {description && <div className="text-meta">{description}</div>}
        {children}
      </div>
      {control && <div className="flex shrink-0 items-center gap-cluster">{control}</div>}
    </div>
  );
}

/** A row whose control is the Ember switch. */
export function SettingsSwitchRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
  tag,
  id,
}: {
  title: string;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  tag?: string;
  id?: string;
}) {
  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-cluster">
          {title}
          {tag && (
            <span className="shrink-0 rounded-full bg-ember/15 px-cluster py-inset text-[10px] font-semibold uppercase tracking-widest text-foreground">
              {tag}
            </span>
          )}
        </span>
      }
      description={description}
      control={
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          aria-label={checked ? `Turn off ${title}` : `Turn on ${title}`}
        />
      }
    />
  );
}
