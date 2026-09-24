'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  HeartIcon,
  MinusIcon,
  MusicIcon,
  PlusIcon,
  ShuffleIcon,
  SortIcon,
} from '@/components/icons';
import { Artwork } from '@/components/primitives/Artwork';
import { PlayButton } from '@/components/primitives/PlayButton';
import { CollectionHeader } from '@/components/page/CollectionHeader';
import { CollectionCover } from '@/components/primitives/CollectionCover';
import { Eyebrow } from '@/components/page/Eyebrow';
import { ActionBar } from '@/components/page/ActionBar';
import { TrackList } from '@/components/track/TrackList';
import { formatCount, formatTime } from '@/lib/format';
import { songKey } from '@/lib/songKey';
import { cn } from '@/lib/utils';
import {
  MOCK_COPY_LIKED,
  MOCK_COPY_PLAYLISTS,
  MOCK_COPY_SOURCE_NAME,
  MOCK_LIKED_DESTINATION,
  MOCK_NEW_PLAYLIST_NAME,
  newPlaylistDestination,
  type CopyDestination,
} from '@/components/library/options/playlist-copy/mock';
import {
  SORT_KEYS,
  planCopy,
  resultLine,
  skipLine,
  type CopyPlan,
  type CopyTrack,
  type SortKey,
  type SortState,
} from '@/components/library/options/playlist-copy/model';
import type { CopyResult } from '@/components/library/options/playlist-copy/flow';
import type { Track } from '@/types/track';

const noop = () => {};

/** Ids and song keys of the mock Liked songs, the same set useLikeRule
 *  builds, so the browse list's hearts follow the real rule. */
const LIKED_IDS = new Set(MOCK_COPY_LIKED.flatMap((t) => [t.id, songKey(t)]));

export function addedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** A tick box: role checkbox, `mixed` for "some selected". */
export function Checkbox({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean | 'mixed';
  onChange: () => void;
  label: string;
  className?: string;
}) {
  const on = checked !== false;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={cn('grid size-hit shrink-0 place-items-center rounded-md md:size-8', className)}
    >
      <span
        className={cn(
          'grid size-5 place-items-center rounded-md border-2 transition-colors',
          on ? 'border-ember bg-ember text-ember-foreground' : 'border-muted-foreground/60',
        )}
      >
        {checked === 'mixed' ? <MinusIcon className="size-3.5" /> : checked ? <CheckIcon className="size-3.5" /> : null}
      </span>
    </button>
  );
}

/** The tri-state value of a Select all box. */
export function allState(selected: number, total: number): boolean | 'mixed' {
  if (selected === 0) return false;
  return selected === total ? true : 'mixed';
}

/** The playlist page's header, the real CollectionHeader and ActionBar,
 *  with `actions` after Play and Shuffle. CollectionHeader switches to its
 *  side-by-side shape on the md: breakpoint, which the phone frame (drawn
 *  inside a desktop-wide /dizajn) would hit, so `phone` draws the same
 *  pieces in the phone's stacked shape instead. */
export function CopyPageHeader({ actions, phone = false }: { actions?: ReactNode; phone?: boolean }) {
  const cover = { src: MOCK_COPY_PLAYLISTS[0].cover, icon: null };
  const meta = ['Aron', '15 songs', '58 min'];
  const bar = (
    <ActionBar>
      <PlayButton />
      <Button variant="ghost" size="icon" aria-label="Shuffle play" className="size-12 rounded-full text-muted-foreground">
        <ShuffleIcon className="size-5" />
      </Button>
      {actions}
    </ActionBar>
  );
  if (phone) {
    return (
      <div data-testid="collection-header" className="flex flex-col items-start gap-stack">
        <CollectionCover {...cover} className="size-art-hero rounded-2xl" />
        <div className="w-full min-w-0">
          <Eyebrow>Playlist</Eyebrow>
          <h1 className="mt-cluster text-4xl font-bold leading-tight tracking-tight">{MOCK_COPY_SOURCE_NAME}</h1>
          <div className="text-meta mt-cluster">{meta.join(' · ')}</div>
          <div className="mt-stack">{bar}</div>
        </div>
      </div>
    );
  }
  return (
    <CollectionHeader eyebrow="Playlist" title={MOCK_COPY_SOURCE_NAME} meta={meta} cover={cover}>
      {bar}
    </CollectionHeader>
  );
}

/** The list as it is today, the real TrackList, for the "not selecting"
 *  state. `nowLiked`: songs just copied into Liked songs, whose hearts are
 *  on now. */
export function BrowseList({ tracks, nowLiked = [] }: { tracks: Track[]; nowLiked?: Track[] }) {
  const likedIds = nowLiked.length ? new Set([...LIKED_IDS, ...nowLiked.flatMap((t) => [t.id, songKey(t)])]) : LIKED_IDS;
  return (
    <TrackList
      tracks={tracks}
      currentId={null}
      isPlaying={false}
      likedIds={likedIds}
      onPlay={noop}
      onToggle={noop}
      onLike={noop}
      trailing={() => (
        <span className="grid size-8 place-items-center text-muted-foreground">
          <PlusIcon className="size-4" />
        </span>
      )}
    />
  );
}

/** A pill-shaped secondary button, the size of the action bar's own. */
export function PillButton({
  children,
  onClick,
  active,
  className,
  label,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  label?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        'inline-flex h-10 items-center gap-cluster rounded-full border px-block text-sm font-medium transition-colors',
        active ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-card',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** "Sort: Date added ↑", the button that opens the sort choices. */
export function SortButton({
  sort,
  open,
  onClick,
  iconOnly = false,
}: {
  sort: SortState;
  open: boolean;
  onClick: () => void;
  iconOnly?: boolean;
}) {
  const key = SORT_KEYS.find((k) => k.key === sort.key)!;
  const Arrow = sort.dir === 'asc' ? ArrowUpIcon : ArrowDownIcon;
  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Sort (${key.label})`}
        aria-expanded={open}
        data-testid="copy-sort"
        className="grid size-hit place-items-center rounded-lg hover:bg-muted"
      >
        <SortIcon className="size-5" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={`Sort (${key.label})`}
      data-testid="copy-sort"
      className="inline-flex h-10 shrink-0 items-center gap-inset whitespace-nowrap rounded-full px-row text-sm font-medium text-muted-foreground hover:bg-card hover:text-foreground"
    >
      <SortIcon className="size-4" />
      {key.label}
      <Arrow className="size-3.5" />
    </button>
  );
}

/** The sort choices: four keys, each both ways. */
export function SortChoices({ sort, onChange }: { sort: SortState; onChange: (s: SortState) => void }) {
  return (
    <div data-testid="copy-sort-menu" role="group" aria-label="Sort by" className="flex flex-col gap-inset">
      {SORT_KEYS.map((k) => {
        const current = sort.key === k.key;
        return (
          <div key={k.key} className="flex items-center justify-between gap-row rounded-md px-cluster py-inset">
            <span className={cn('text-sm', current ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{k.label}</span>
            <div className="flex gap-inset">
              {(['asc', 'desc'] as const).map((dir) => {
                const on = current && sort.dir === dir;
                return (
                  <button
                    key={dir}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${k.label}, ${dir === 'asc' ? k.asc : k.desc}`}
                    onClick={() => onChange({ key: k.key, dir })}
                    className={cn(
                      'rounded-full border px-cluster py-inset text-xs font-medium whitespace-nowrap transition-colors',
                      on ? 'border-ember bg-ember text-ember-foreground' : 'border-border text-muted-foreground hover:bg-card',
                    )}
                  >
                    {dir === 'asc' ? k.asc : k.desc}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A clickable column heading that sorts by its key (desktop only). */
export function SortHeading({
  label,
  sortKey,
  sort,
  onChange,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onChange: (s: SortState) => void;
  className?: string;
}) {
  const current = sort.key === sortKey;
  const Arrow = sort.dir === 'asc' ? ArrowUpIcon : ArrowDownIcon;
  return (
    <button
      type="button"
      onClick={() => onChange({ key: sortKey, dir: current && sort.dir === 'asc' ? 'desc' : 'asc' })}
      aria-label={`Sort by ${label}`}
      className={cn(
        'inline-flex min-w-0 items-center gap-inset text-xs tracking-widest uppercase transition-colors hover:text-foreground',
        current ? 'text-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      {label}
      {current && <Arrow className="size-3" />}
    </button>
  );
}

// Lead, title, album, date added, time: the list row's own columns, with
// "Date added" in the actions' place while selecting.
const SELECT_GRID_DESKTOP = 'grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)_88px_60px]';
const SELECT_GRID_PHONE = 'grid-cols-[40px_minmax(0,1fr)_auto]';

export function selectGrid(phone: boolean) {
  return phone ? SELECT_GRID_PHONE : SELECT_GRID_DESKTOP;
}

function TitleCell({ track, check, onArt }: { track: Track; check?: boolean; onArt?: () => void }) {
  return (
    <div className="flex min-w-0 items-center gap-row">
      <Artwork
        src={check ? null : track.artworkUrl}
        size="xs"
        onClick={
          onArt
            ? (e) => {
                e.stopPropagation();
                onArt();
              }
            : undefined
        }
        className={cn(
          'shrink-0 rounded',
          check ? 'grid place-items-center rounded-full bg-ember text-ember-foreground' : 'bg-art',
          !check && !track.artworkUrl && 'grid place-items-center text-foreground/20',
        )}
      >
        {check ? <CheckIcon className="size-5" /> : <MusicIcon className="size-4" />}
      </Artwork>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{track.title}</div>
        <div className="truncate text-xs text-muted-foreground">{track.artist}</div>
      </div>
    </div>
  );
}

/** One row while selecting, candidate (a)'s shape: a checkbox where the play
 *  button was, the row itself toggles too. */
export function CheckboxRow({
  track,
  selected,
  onToggle,
  phone,
}: {
  track: CopyTrack;
  selected: boolean;
  onToggle: () => void;
  phone: boolean;
}) {
  return (
    <div
      data-testid="copy-row"
      data-selected={selected}
      onClick={onToggle}
      className={cn(
        'grid cursor-pointer items-center gap-row rounded-md px-row py-cluster transition-colors',
        selectGrid(phone),
        selected ? 'bg-ember/10' : 'hover:bg-card',
      )}
    >
      <Checkbox checked={selected} onChange={onToggle} label={`Select ${track.title}`} className="justify-self-center" />
      <TitleCell track={track} />
      {phone ? (
        <div className="text-xs tabular-nums text-muted-foreground">{formatTime(track.durationSec)}</div>
      ) : (
        <>
          <div className="truncate text-sm text-muted-foreground">{track.album}</div>
          <div className="text-sm text-muted-foreground">{addedLabel(track.addedAt)}</div>
          <div className="text-right text-sm tabular-nums text-muted-foreground">{formatTime(track.durationSec)}</div>
        </>
      )}
    </div>
  );
}

/** One row in candidate (b): the cover turns into a tick when picked, the
 *  whole row is the toggle once selecting, and the cover alone starts it. */
export function TapRow({
  track,
  selected,
  selecting,
  onToggle,
  phone,
}: {
  track: CopyTrack;
  selected: boolean;
  selecting: boolean;
  onToggle: () => void;
  phone: boolean;
}) {
  return (
    <div
      data-testid="copy-row"
      data-selected={selected}
      role={selecting ? 'checkbox' : undefined}
      aria-checked={selecting ? selected : undefined}
      aria-label={selecting ? `Select ${track.title}` : undefined}
      onClick={selecting ? onToggle : undefined}
      onContextMenu={(e) => {
        // A long press on a phone arrives as a contextmenu event.
        e.preventDefault();
        onToggle();
      }}
      className={cn(
        'grid cursor-pointer items-center gap-row rounded-md px-row py-cluster transition-colors',
        phone ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_88px_60px]',
        selected ? 'bg-ember/15' : 'hover:bg-card',
      )}
    >
      <TitleCell track={track} check={selected} onArt={onToggle} />
      {phone ? (
        <div className="text-xs tabular-nums text-muted-foreground">{formatTime(track.durationSec)}</div>
      ) : (
        <>
          <div className="truncate text-sm text-muted-foreground">{track.album}</div>
          <div className="text-sm text-muted-foreground">{addedLabel(track.addedAt)}</div>
          <div className="text-right text-sm tabular-nums text-muted-foreground">{formatTime(track.durationSec)}</div>
        </>
      )}
    </div>
  );
}

/** One compact row inside candidate (c)'s dialog. */
export function DialogRow({ track, selected, onToggle }: { track: CopyTrack; selected: boolean; onToggle: () => void }) {
  return (
    <div
      data-testid="copy-row"
      data-selected={selected}
      onClick={onToggle}
      className={cn(
        'flex cursor-pointer items-center gap-row rounded-md px-cluster py-inset transition-colors',
        selected ? 'bg-ember/10' : 'hover:bg-card',
      )}
    >
      <Checkbox checked={selected} onChange={onToggle} label={`Select ${track.title}`} />
      <div className="min-w-0 flex-1">
        <TitleCell track={track} />
      </div>
      <div className="text-xs text-muted-foreground">{addedLabel(track.addedAt)}</div>
      <div className="w-10 text-right text-xs tabular-nums text-muted-foreground">{formatTime(track.durationSec)}</div>
    </div>
  );
}

function DestinationCover({ destination }: { destination: CopyDestination }) {
  if (destination.kind === 'liked') {
    return (
      <div className="cover-placeholder grid size-art-xs shrink-0 place-items-center rounded">
        <HeartIcon className="size-4 fill-current text-ember-foreground" />
      </div>
    );
  }
  if (destination.kind === 'new') {
    return (
      <div className="grid size-art-xs shrink-0 place-items-center rounded bg-card text-ember">
        <PlusIcon className="size-5" />
      </div>
    );
  }
  return (
    <Artwork src={destination.cover} size="xs" fallback="gradient" className="shrink-0 rounded">
      {null}
    </Artwork>
  );
}

/** How many of the picked songs a destination already has. */
export function alreadyCount(picked: Track[], destination: CopyDestination): number {
  return planCopy(picked, destination.tracks).skipped.filter((s) => s.reason !== 'picked-twice').length;
}

function DestinationRow({
  destination,
  picked,
  onChoose,
  sub,
}: {
  destination: CopyDestination;
  picked: Track[];
  onChoose: () => void;
  sub?: string;
}) {
  const already = destination.kind === 'new' ? 0 : alreadyCount(picked, destination);
  const all = picked.length > 0 && already === picked.length;
  const note =
    sub ??
    (all
      ? 'All already there'
      : already > 0
        ? `${already} already ${destination.kind === 'liked' ? 'liked' : 'there'}, ${picked.length - already} to add`
        : `${formatCount(destination.tracks.length, 'song')}`);
  return (
    <button
      type="button"
      data-testid="copy-destination"
      data-destination={destination.id}
      onClick={onChoose}
      disabled={all}
      className="flex w-full min-w-0 items-center gap-row rounded-md px-cluster py-cluster text-left transition-colors hover:bg-card disabled:opacity-50"
    >
      <DestinationCover destination={destination} />
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-sm font-semibold', destination.kind === 'new' && 'text-ember')}>{destination.name}</div>
        <div className="truncate text-xs text-muted-foreground">{note}</div>
      </div>
      {destination.kind === 'liked' && <HeartIcon className="size-4 shrink-0 text-muted-foreground" />}
    </button>
  );
}

/** Where to: New playlist (named inline), Liked songs, then the member's
 *  playlists, each saying how many of the picked songs it already has. */
export function DestinationList({
  picked,
  onChoose,
}: {
  picked: Track[];
  onChoose: (d: CopyDestination) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(MOCK_NEW_PLAYLIST_NAME);
  return (
    <div data-testid="copy-destinations" className="flex flex-col gap-inset">
      {naming ? (
        <form
          className="flex items-center gap-cluster px-cluster py-cluster"
          onSubmit={(e) => {
            e.preventDefault();
            onChoose(newPlaylistDestination(name.trim() || MOCK_NEW_PLAYLIST_NAME));
          }}
        >
          <input
            aria-label="New playlist name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-row text-sm"
          />
          <Button type="submit" variant="ember" className="h-10 rounded-full px-block">
            Create
          </Button>
        </form>
      ) : (
        <DestinationRow
          destination={newPlaylistDestination('New playlist')}
          picked={picked}
          onChoose={() => setNaming(true)}
          sub={`With these ${formatCount(picked.length, 'song')}`}
        />
      )}
      <DestinationRow destination={MOCK_LIKED_DESTINATION} picked={picked} onChoose={() => onChoose(MOCK_LIKED_DESTINATION)} />
      <div className="text-eyebrow px-cluster pt-cluster">Playlists</div>
      {MOCK_COPY_PLAYLISTS.map((d) => (
        <DestinationRow key={d.id} destination={d} picked={picked} onChoose={() => onChoose(d)} />
      ))}
    </div>
  );
}

/** The Liked songs warning: copying there likes every song, said before it
 *  happens, with the counts. */
export function LikedWarning({
  picked,
  plan,
  onConfirm,
  onCancel,
  stacked = false,
}: {
  picked: Track[];
  plan: CopyPlan;
  onConfirm: () => void;
  onCancel: () => void;
  /** Buttons full width, one per line (a phone sheet). */
  stacked?: boolean;
}) {
  const already = plan.skipped.length;
  return (
    <div data-testid="copy-liked-confirm" className="flex flex-col gap-block">
      <div className="flex items-start gap-row">
        <div className="cover-placeholder grid size-art-xs shrink-0 place-items-center rounded-full">
          <HeartIcon className="size-5 fill-current text-ember-foreground" />
        </div>
        <div className="min-w-0">
          <div className="text-section-title">Like {formatCount(picked.length, 'song')}?</div>
          <p className="text-meta mt-cluster">
            Adding songs to Liked songs <span className="font-semibold text-foreground">likes every one of them</span>: each
            one gets its heart, everywhere in Ember, the same as tapping it yourself.
          </p>
          {already > 0 && (
            <p className="text-meta mt-cluster">
              {already} {already === 1 ? 'is' : 'are'} already liked, so {formatCount(plan.add.length, 'song')} get a new like.
            </p>
          )}
        </div>
      </div>
      <div className={cn('flex gap-cluster', stacked ? 'flex-col-reverse' : 'justify-end')}>
        <Button variant="ghost" onClick={onCancel} className={cn('h-10 rounded-full px-block', stacked && 'w-full')}>
          Cancel
        </Button>
        <Button
          variant="ember"
          onClick={onConfirm}
          data-testid="copy-liked-yes"
          className={cn('h-10 rounded-full px-block', stacked && 'w-full')}
        >
          <HeartIcon className="size-4 fill-current" />
          Like {formatCount(plan.add.length, 'song')}
        </Button>
      </div>
    </div>
  );
}

/** What happened: "Added 12, skipped 3 already there", where, and which
 *  were skipped and why. */
export function ResultPanel({
  result,
  onDone,
  compact = false,
}: {
  result: CopyResult;
  onDone: () => void;
  /** One line with a Show toggle (a bar or snackbar), not the full list. */
  compact?: boolean;
}) {
  const { plan, destination } = result;
  const [open, setOpen] = useState(!compact);
  return (
    <div data-testid="copy-result" className="flex min-w-0 flex-col gap-cluster">
      <div className="flex min-w-0 items-start gap-row">
        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-ember text-ember-foreground">
          <CheckIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div data-testid="copy-result-line" className="text-sm font-semibold">
            {resultLine(plan)}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {destination.kind === 'liked' ? 'Liked songs: every added song now has its heart' : `In ${destination.name}`}
          </div>
        </div>
        {compact && plan.skipped.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="inline-flex shrink-0 items-center gap-inset text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {open ? 'Hide' : 'Which?'}
            <ChevronDownIcon className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {open && plan.skipped.length > 0 && (
        <ul data-testid="copy-skipped" className="flex flex-col gap-inset rounded-md bg-card px-row py-cluster">
          {plan.skipped.map((s) => (
            <li key={s.track.id} className="min-w-0 break-words text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{s.track.title}</span> · {s.track.artist}: {skipLine(s)}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-cluster">
        <Button variant="ghost" onClick={onDone} className="h-9 rounded-full px-block">
          Done
        </Button>
        <Button variant="outline" onClick={onDone} className="h-9 rounded-full px-block">
          Open {destination.name}
        </Button>
      </div>
    </div>
  );
}

/** A dim layer behind a sheet or dialog, inside the frame. Clicking it
 *  closes. */
export function Backdrop({ onClose }: { onClose?: () => void }) {
  return <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />;
}

/** A sheet sliding up from the bottom of the phone frame. */
export function BottomSheet({
  title,
  onClose,
  children,
  testId,
  tall = false,
}: {
  title?: string;
  onClose?: () => void;
  children: ReactNode;
  testId?: string;
  tall?: boolean;
}) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end" data-testid={testId}>
      <Backdrop onClose={onClose} />
      <div
        role="dialog"
        aria-label={title}
        className={cn(
          'relative flex flex-col gap-block rounded-t-2xl border-t border-border bg-popover px-block pt-cluster pb-stack text-popover-foreground shadow-soft',
          tall && 'max-h-[85%]',
        )}
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-muted-foreground/40" />
        {title && (
          <div className="flex items-center justify-between gap-row">
            <div className="text-base font-semibold">{title}</div>
            {onClose && (
              <button type="button" aria-label="Close" onClick={onClose} className="grid size-8 place-items-center rounded-lg hover:bg-muted">
                <CloseIcon className="size-4" />
              </button>
            )}
          </div>
        )}
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/** A dialog centred in the frame (desktop). */
export function CenterDialog({
  title,
  onClose,
  children,
  testId,
  className,
}: {
  title?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div className="absolute inset-0 z-40 grid place-items-center" data-testid={testId}>
      <Backdrop onClose={onClose} />
      <div
        role="dialog"
        className={cn(
          'relative flex max-h-[88%] w-md max-w-[92%] flex-col gap-block rounded-xl border border-border bg-popover p-stack text-popover-foreground shadow-soft',
          className,
        )}
      >
        {title && (
          <div className="flex items-center justify-between gap-row">
            <div className="min-w-0 text-base font-semibold">{title}</div>
            {onClose && (
              <button type="button" aria-label="Close" onClick={onClose} className="grid size-8 place-items-center rounded-lg hover:bg-muted">
                <CloseIcon className="size-4" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
