'use client';

import { useId, type ReactNode } from 'react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/** Desktop Settings rows (owner pick: rows C): no lines and no cards, more
 *  room between rows. */

/** A group of rows under a small grey title. `aside` sits at the title's
 *  right (a count, a small button). */
export function SettingsGroup({
  title,
  aside,
  children,
  footer,
  testId,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}) {
  const id = useId();
  return (
    <section className="flex flex-col gap-cluster" data-testid={testId} aria-labelledby={title ? id : undefined}>
      {title && (
        <div className="flex items-baseline justify-between gap-row">
          <h3 id={id} className="text-eyebrow font-semibold">
            {title}
          </h3>
          {aside}
        </div>
      )}
      <div data-settings-group className="flex flex-col gap-cluster">
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
  return (
    <div data-settings-row className={cn('flex items-center gap-block py-block', className)}>
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
