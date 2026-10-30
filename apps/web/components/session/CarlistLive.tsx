'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ActionSheet, ActionSheetItem, type MenuAction } from '@/components/ui/action-sheet';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { Avatar } from '@/components/primitives/Avatar';
import { Artwork } from '@/components/primitives/Artwork';
import { SectionHeader } from '@/components/page/SectionHeader';
import { CheckIcon, ListPlusIcon, MusicIcon, NextIcon, PlusIcon } from '@/components/icons';
import { personLabel, whosePhone, type AddPosition } from '@/lib/carlist';
import { cn } from '@/lib/utils';
import type { PlaylistPerson, SessionQueueItem, SessionState, Track } from '@/types/track';

const AVATAR = 'bg-ember text-ember-foreground';

/** A face and a name: who added a song. */
export function Who({
  person,
  label,
  prefix,
  className,
}: {
  person: PlaylistPerson | null;
  label: string;
  prefix?: string;
  className?: string;
}) {
  return (
    <span data-testid="who" className={cn('inline-flex min-w-0 items-center gap-inset text-xs text-muted-foreground', className)}>
      <Avatar src={person?.avatarUrl} name={label} className={cn('size-5 shrink-0 text-[9px]', AVATAR)} />
      <span className="truncate">
        {prefix}
        {label}
      </span>
    </span>
  );
}

/** Up to four faces, overlapping. */
export function FaceStack({ people, viewerId }: { people: PlaylistPerson[]; viewerId: string }) {
  return (
    <span className="inline-flex shrink-0 items-center" aria-hidden>
      {people.slice(0, 4).map((p, i) => (
        <Avatar
          key={p.id}
          src={p.avatarUrl}
          name={personLabel(p, viewerId)}
          className={cn('size-6 text-[10px] ring-2 ring-background', AVATAR, i > 0 && '-ml-2')}
        />
      ))}
    </span>
  );
}

/** The add control on a search result: a round + that opens a menu with
 *  Play next and Add to end (a dropdown on desktop, a bottom sheet with the
 *  song on top on a phone, like the song's ⋯ menu). */
export function AddChoice({
  track,
  isAdded,
  busy,
  onAdd,
}: {
  track: Track;
  isAdded: boolean;
  busy?: boolean;
  onAdd: (position: AddPosition) => void;
}) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  if (isAdded) {
    return (
      <span className="inline-flex h-8 shrink-0 items-center gap-inset px-cluster text-sm text-muted-foreground">
        <CheckIcon className="size-3.5" /> Added
      </span>
    );
  }
  const actions: MenuAction[] = [
    {
      key: 'next',
      label: 'Play next',
      description: 'Right after the current song',
      ariaLabel: `Play ${track.title} next`,
      icon: NextIcon,
      onSelect: () => onAdd('next'),
    },
    {
      key: 'end',
      label: 'Add to end',
      description: 'After everything in the list',
      ariaLabel: `Add ${track.title} to the end`,
      icon: ListPlusIcon,
      onSelect: () => onAdd('end'),
    },
  ];
  // 44px hit area around a 32px round button.
  const triggerClass = 'group grid size-11 shrink-0 place-items-center rounded-full outline-none disabled:opacity-50';
  const plus = (
    <span className="grid size-8 place-items-center rounded-full border border-border text-foreground transition-colors group-hover:bg-accent group-focus-visible:ring-2 group-focus-visible:ring-ring">
      <PlusIcon className="size-4" />
    </span>
  );

  if (!isDesktop) {
    const header = (
      <div className="flex min-w-0 items-center gap-row text-left">
        <Artwork src={track.artworkUrl} className="size-12 shrink-0 rounded-md bg-art">
          <div className="grid h-full w-full place-items-center text-foreground/30">
            <MusicIcon className="h-5 w-5" />
          </div>
        </Artwork>
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{track.title}</div>
          <div className="truncate text-sm text-muted-foreground">{track.artist}</div>
        </div>
      </div>
    );
    return (
      <>
        <button
          type="button"
          className={triggerClass}
          aria-label={`Add ${track.title}`}
          aria-haspopup="dialog"
          disabled={busy}
          onClick={() => setOpen(true)}
        >
          {plus}
        </button>
        <ActionSheet open={open} onOpenChange={setOpen} title={`Add ${track.title}`} header={header}>
          <span data-testid="add-choice" className="flex flex-col">
            {actions.map((a) => (
              <ActionSheetItem
                key={a.key}
                icon={a.icon}
                description={a.description}
                ariaLabel={a.ariaLabel}
                disabled={busy}
                onSelect={() => {
                  setOpen(false);
                  a.onSelect();
                }}
              >
                {a.label}
              </ActionSheetItem>
            ))}
          </span>
        </ActionSheet>
      </>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className={triggerClass} aria-label={`Add ${track.title}`} disabled={busy}>
        {plus}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" data-testid="add-choice">
        {actions.map((a) => (
          <DropdownMenuItem
            key={a.key}
            aria-label={a.ariaLabel}
            disabled={busy}
            onClick={a.onSelect}
            className="items-start gap-row px-row py-cluster"
          >
            <a.icon className="size-4 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-sm">{a.label}</span>
              <span className="block text-xs text-muted-foreground">{a.description}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The big now-playing card: art, the song, who added it, progress, Skip. */
function NowCard({
  item,
  viewerId,
  progress,
  onSkip,
  skipping,
}: {
  item: SessionQueueItem | undefined;
  viewerId: string;
  progress: number | null;
  onSkip?: () => void;
  skipping?: boolean;
}) {
  if (!item) {
    return (
      <div data-testid="now-card" className="rounded-2xl bg-card px-block py-section text-center text-sm text-muted-foreground">
        Nothing queued yet. Add the first song below.
      </div>
    );
  }
  return (
    <div data-testid="now-card" className="flex flex-col gap-block rounded-2xl bg-card p-block md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-end gap-block md:items-center">
        <Artwork
          src={item.track.artworkUrl}
          className="grid size-28 shrink-0 place-items-center rounded-xl bg-art shadow-soft md:size-36"
        >
          <MusicIcon className="size-8 text-foreground/20" />
        </Artwork>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-inset text-[10px] font-semibold uppercase tracking-widest text-ember">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-ember" /> Now playing
          </div>
          <div data-testid="now-title" className="mt-inset truncate text-xl font-bold tracking-tight md:text-3xl">
            {item.track.title}
          </div>
          <div className="truncate text-sm text-muted-foreground">{item.track.artist}</div>
          <Who
            person={item.addedBy}
            label={item.addedBy ? personLabel(item.addedBy, viewerId) : item.addedByName}
            prefix="Added by "
            className="mt-cluster max-w-full"
          />
        </div>
      </div>
      <div className="flex items-center gap-row md:w-64 md:shrink-0">
        <div
          className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Song progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress == null ? undefined : Math.round(progress * 100)}
        >
          <div
            className="h-full rounded-full bg-foreground/70 transition-[width] duration-1000 ease-linear"
            style={{ width: `${Math.round((progress ?? 0) * 1000) / 10}%` }}
          />
        </div>
        {onSkip && (
          <Button
            variant="outline"
            className="h-10 shrink-0 gap-inset rounded-full px-block"
            onClick={onSkip}
            disabled={skipping}
            data-testid="skip"
          >
            <NextIcon className="size-4" /> Skip
          </Button>
        )}
      </div>
    </div>
  );
}

export interface CarlistLiveProps {
  state: SessionState;
  /** 0 to 1, or null when unknown. */
  progress: number | null;
  saved: boolean;
  saving?: boolean;
  skipping?: boolean;
  onSkip: () => void;
  onEnd: () => void;
  onSave: () => void;
  onShare: () => void;
  /** The add-a-song search (rendered at the bottom while live). */
  addSlot?: ReactNode;
}

/** The live carlist: the head and big now-playing card on top, the numbered
 *  queue under it (played rows dimmed, the current one highlighted, who
 *  added each), search to add at the bottom. */
export function CarlistLive({
  state,
  progress,
  saved,
  saving,
  skipping,
  onSkip,
  onEnd,
  onSave,
  onShare,
  addSlot,
}: CarlistLiveProps) {
  const { session, queue, members } = state;
  const nowItem = queue[session.nowIndex];
  const inCar = Math.max(1, members.length);

  return (
    <div className="flex max-w-2xl flex-col gap-stack pt-block md:pt-0" data-testid="carlist-live-page">
      <div className="flex flex-col gap-block">
        <div className="flex items-start justify-between gap-row">
          <div className="min-w-0">
            <div className="text-eyebrow">Carlist</div>
            <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">{session.name}</h1>
            <div className="mt-cluster flex min-w-0 items-center gap-cluster text-xs text-muted-foreground">
              <FaceStack people={members} viewerId={session.viewerId} />
              <span className="truncate" data-testid="in-the-car">
                {inCar} in the car · {whosePhone(session.hostName, session.isHost)}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-cluster">
            <button
              type="button"
              onClick={onShare}
              data-testid="code-chip"
              aria-label={`Invite: code ${session.code}`}
              className="rounded-full border border-border px-row py-inset font-mono text-xs font-bold tracking-widest transition-colors hover:bg-card"
            >
              {session.code}
            </button>
            {session.isHost && session.active && (
              <Button variant="ghost" size="sm" onClick={onEnd} className="text-muted-foreground hover:text-foreground">
                End carlist
              </Button>
            )}
          </div>
        </div>

        {!session.active && (
          <div className="rounded-md bg-card px-block py-row text-sm text-muted-foreground" data-testid="ended">
            This carlist has ended.{!saved && ' You can still save the queue as a playlist.'}
          </div>
        )}

        <NowCard
          item={nowItem}
          viewerId={session.viewerId}
          progress={progress}
          onSkip={session.active ? onSkip : undefined}
          skipping={skipping}
        />
      </div>

      <section>
        <SectionHeader
          title="Queue"
          className="mb-cluster"
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={onSave}
              disabled={saving || saved || queue.length === 0}
              className="text-muted-foreground hover:text-foreground"
              data-testid="save-playlist"
            >
              {saved ? 'Saved ✓' : 'Save as playlist'}
            </Button>
          }
        />
        {queue.length === 0 ? (
          <div className="py-stack text-center text-sm text-muted-foreground">Empty queue</div>
        ) : (
          <ol className="flex flex-col" data-testid="queue">
            {queue.map((item, i) => {
              const isNow = i === session.nowIndex;
              const isPast = i < session.nowIndex;
              const label = item.addedBy ? personLabel(item.addedBy, session.viewerId) : item.addedByName;
              return (
                <li
                  key={item.id}
                  data-testid="queue-row"
                  data-state={isNow ? 'now' : isPast ? 'played' : 'next'}
                  aria-current={isNow ? 'true' : undefined}
                  className={cn('flex items-center gap-row rounded-md px-row py-cluster', isNow && 'bg-card', isPast && 'opacity-40')}
                >
                  <span
                    className={cn('w-6 shrink-0 text-right text-sm tabular-nums', isNow ? 'text-ember' : 'text-muted-foreground')}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={cn('truncate text-sm font-medium', isNow && 'text-ember')}>{item.track.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{item.track.artist}</div>
                  </div>
                  <span className="max-w-28 shrink-0 truncate text-xs text-muted-foreground" data-testid="added-by">
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {session.active && addSlot && (
        <section>
          <SectionHeader title="Add songs" className="mb-row" />
          {addSlot}
        </section>
      )}
    </div>
  );
}
