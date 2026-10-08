'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { CheckIcon, ChevronLeftIcon, HeartIcon, QueueIcon } from '@/components/icons';
import type { TransferService } from '@/lib/import/transferRoutes';
import type { JobKind } from '@/lib/import/types';
import { cn } from '@/lib/utils';

// The Transfer flow's frame, the "wizard" look: a 1 Where, 2 How, 3 Check
// header that says where you are, a bold title, then Back and the next move
// in a bar pinned to the bottom. Also the rows you pick from and the sheet
// that asks where the songs go. Presentational: data in, callbacks out.

export const DESTINATIONS: { id: JobKind; name: string; consequence: string; icon: typeof HeartIcon }[] = [
  {
    id: 'liked',
    name: 'Liked songs',
    consequence: 'These become your likes and shape your mixes and radio.',
    icon: HeartIcon,
  },
  {
    id: 'playlist',
    name: 'A new playlist',
    consequence: 'A playlist you can edit, reorder and share.',
    icon: QueueIcon,
  },
];

const STAGES = ['Where', 'How', 'Check'] as const;

/** Where you are: three bars, the done ones ticked, the current one bold. */
export function WizardProgress({ at }: { at: 0 | 1 | 2 }) {
  return (
    <ol data-testid="transfer-progress" data-at={at} aria-label={`Step ${at + 1} of 3`} className="grid grid-cols-3 gap-cluster">
      {STAGES.map((label, k) => {
        const done = k < at;
        const on = k === at;
        return (
          <li
            key={label}
            data-state={done ? 'done' : on ? 'current' : 'next'}
            aria-current={on ? 'step' : undefined}
            className="flex min-w-0 flex-col gap-inset"
          >
            <span aria-hidden="true" className={cn('h-1 rounded-full', done || on ? 'bg-ember' : 'bg-muted')} />
            <span
              className={cn(
                'inline-flex items-center gap-inset whitespace-nowrap text-[11.5px] font-semibold',
                on ? 'text-foreground' : done ? 'text-muted-foreground' : 'text-muted-foreground/60',
              )}
            >
              {done ? <CheckIcon className="h-3 w-3" /> : `${k + 1}`} {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The screen's question, large. */
export function WizardTitle({ children }: { children: ReactNode }) {
  return <h1 className="mt-cluster text-balance text-[22px] font-bold leading-tight tracking-tight">{children}</h1>;
}

/** Back and the next move, pinned to the bottom of the page. With no next
 *  move, a short line says what moves it on instead. */
export function WizardBar({
  onBack,
  back,
  hint,
  children,
}: {
  onBack?: () => void;
  /** A Back that is a link rather than a button (the review page). */
  back?: ReactNode;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-testid="transfer-bar"
      className={cn(
        'sticky bottom-0 z-10 mt-auto -mx-page flex items-center gap-cluster border-t border-border bg-background/95 px-page pb-block pt-row backdrop-blur',
        'md:mx-0 md:px-0',
      )}
    >
      {back ?? (
        <Button type="button" variant="outline" onClick={onBack} className="h-11">
          <ChevronLeftIcon className="h-4 w-4" />
          Back
        </Button>
      )}
      {children ?? (
        <span data-testid="transfer-bar-hint" className="min-w-0 flex-1 text-right text-xs text-muted-foreground">
          {hint}
        </span>
      )}
    </div>
  );
}

/** A row you pick one of: a picture on the left, a name with a line under
 *  it, and a radio dot. */
export function RadioRow({
  on,
  onClick,
  lead,
  title,
  sub,
  disabled,
  titleTestId,
  ...data
}: {
  on: boolean;
  onClick: () => void;
  lead: ReactNode;
  title: ReactNode;
  sub: ReactNode;
  disabled?: boolean;
  titleTestId?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      {...data}
      className={cn(
        'flex w-full min-w-0 items-center gap-row rounded-2xl border p-row text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        on ? 'border-ember bg-ember/10' : 'border-border bg-card hover:border-foreground/20',
      )}
    >
      {lead}
      <span className="min-w-0 flex-1">
        <span data-testid={titleTestId} className="block text-sm font-semibold">
          {title}
        </span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'size-5 shrink-0 rounded-full border-2',
          on ? 'border-ember bg-[radial-gradient(var(--ember)_40%,transparent_46%)]' : 'border-muted-foreground/50',
        )}
      />
    </button>
  );
}

/** An icon on a soft accent square, the picture of a way in or a place. */
export function IconTile({ children }: { children: ReactNode }) {
  return <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ember/15 text-ember">{children}</span>;
}

/** A stand-in for a service's own mark: its letter on its colour. */
export function ServiceMark({ service, size = 28 }: { service: TransferService; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-lg font-extrabold"
      style={{ width: size, height: size, background: service.mark.bg, color: service.mark.fg, fontSize: Math.round(size / 2) }}
    >
      {service.mark.letter}
    </span>
  );
}

/** Picked a service: a sheet asks where its songs go, Liked songs or a new
 *  playlist, each saying what that means, then Continue. Bottom sheet on a
 *  phone, side sheet on a wide window. */
export function WhereToSheet({
  service,
  open,
  onOpenChange,
  destination,
  onDestination,
  likedOpen,
  onContinue,
  side,
}: {
  service: TransferService | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destination: JobKind;
  onDestination: (d: JobKind) => void;
  /** Whether this service can fill the Liked songs. */
  likedOpen: boolean;
  onContinue: () => void;
  side: 'bottom' | 'right';
}) {
  return (
    <Sheet open={open && !!service} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        data-testid="transfer-where-sheet"
        className={cn('gap-0', side === 'bottom' && 'max-h-[85svh] rounded-t-2xl')}
      >
        {side === 'bottom' && <span aria-hidden="true" className="mx-auto mt-cluster h-1 w-10 shrink-0 rounded-full bg-foreground/20" />}
        {service && (
          <div className="flex min-h-0 flex-col gap-row overflow-y-auto px-block pb-block pt-row">
            <div className="flex items-center gap-row pr-section">
              <ServiceMark service={service} size={32} />
              <div className="min-w-0">
                <SheetTitle className="text-base font-semibold">Where should they go?</SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground">Bringing in from {service.name}</SheetDescription>
              </div>
            </div>
            <div role="radiogroup" aria-label="Where the songs go" className="flex flex-col gap-cluster">
              {DESTINATIONS.map((d) => (
                <RadioRow
                  key={d.id}
                  data-testid="transfer-destination-card"
                  data-destination={d.id}
                  on={destination === d.id}
                  disabled={d.id === 'liked' && !likedOpen}
                  onClick={() => onDestination(d.id)}
                  lead={
                    <IconTile>
                      <d.icon className="h-5 w-5" />
                    </IconTile>
                  }
                  title={d.name}
                  sub={d.consequence}
                />
              ))}
            </div>
            <Button type="button" variant="ember" onClick={onContinue} className="mt-inset h-11 w-full">
              Continue
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
