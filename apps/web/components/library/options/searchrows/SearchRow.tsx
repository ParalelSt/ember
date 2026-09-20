'use client';

import { Artwork } from '@/components/primitives/Artwork';
import { Button } from '@/components/ui/button';
import { CloseIcon, MusicIcon, PauseIcon, PlayIcon, VolumeIcon } from '@/components/icons';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Track } from '@/types/track';
import type { RowControl, RowIndicator } from '@/components/library/options/searchrows';

// Presentational only, mock data only: one candidate search-overlay row.
// The geometry is TrackRow's, class for class (the same compact flex line
// for recents and the same container-query grid for results), with the
// spacing moved onto the tokens; only the play control and the
// now-playing indicator differ per candidate. The live TrackRow is
// untouched, so nothing here can reach the real overlay.

/** Shown on hover or keyboard focus, and on the playing row without
 *  either. Written once because all three control styles use it. */
const REVEAL =
  'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100';

/** Three bars in the ember accent. Animated by the `.ember-eq-bar` rules in
 *  globals.css, whose prefers-reduced-motion block switches the animation
 *  off, so a reader who asked for less motion gets the same still bars the
 *  paused state shows. Drawn as one SVG rather than three spans so the
 *  gaps are geometry rather than a raw spacing class. */
function EqBars({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <svg
      data-testid="row-eq-bars"
      data-playing={playing ? 'true' : 'false'}
      viewBox="0 0 14 14"
      aria-hidden
      className={cn('size-3.5 text-ember', className)}
    >
      <g fill="currentColor">
        {[0, 5.5, 11].map((x, i) => (
          <rect
            key={x}
            x={x}
            y={2}
            width={3}
            height={12}
            rx={1.5}
            className={playing ? `ember-eq-bar ember-eq-bar-${i + 1}` : 'ember-eq-still'}
          />
        ))}
      </g>
    </svg>
  );
}

export interface SearchRowProps {
  track: Track;
  /** `compact` is the recents line, `list` the results row, the same two
   *  densities TrackRow has. */
  density: 'compact' | 'list';
  control: RowControl;
  indicator: RowIndicator;
  /** This row is the one the player is on. */
  active: boolean;
  /** The player is running: only meaningful together with `active`. */
  playing: boolean;
  /** Pressing the row's control: start this row, or pause/resume it when it
   *  is already the current one. */
  onActivate: () => void;
}

export function SearchRow({ track, density, control, indicator, active, playing, onActivate }: SearchRowProps) {
  const compact = density === 'compact';
  const showPause = active && playing;
  const ControlIcon = showPause ? PauseIcon : PlayIcon;
  const controlLabel = active ? (playing ? `Pause ${track.title}` : `Resume ${track.title}`) : `Play ${track.title}`;

  // Where the bars go: the lead slot owns them when there is one, otherwise
  // they sit over the artwork.
  const barsInLead = indicator === 'bars' && control === 'leading';
  const barsOnArt = indicator === 'bars' && control !== 'leading';
  const showBars = active && indicator === 'bars';

  // The speaker / pause glyph the two non-bar indicators put beside the
  // title. Nothing playing means no glyph at all.
  const glyph =
    active && indicator !== 'bars' ? (
      playing ? (
        <VolumeIcon data-testid="row-glyph" className="size-3.5 shrink-0 text-ember" />
      ) : (
        <PauseIcon data-testid="row-glyph" className="size-3.5 shrink-0 text-ember" />
      )
    ) : null;

  const press = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onActivate();
  };

  const artwork = (
    <div className="relative shrink-0">
      <Artwork src={track.artworkUrl} size="xs" className="rounded bg-black">
        <span className="grid h-full w-full place-items-center text-foreground/20">
          <MusicIcon className="h-4 w-4" />
        </span>
      </Artwork>
      {showBars && barsOnArt && (
        <span
          aria-hidden
          className={cn(
            'absolute inset-0 grid place-items-center rounded bg-black/55',
            // With the control on the art, a hover swaps the bars for the
            // pause glyph: one target, two jobs.
            control === 'on-art' && 'transition-opacity group-hover:opacity-0 group-focus-within:opacity-0',
          )}
        >
          <EqBars playing={playing} />
        </span>
      )}
      {control === 'on-art' && (
        <button
          type="button"
          data-testid="row-art-control"
          onClick={press}
          aria-label={controlLabel}
          className={cn(
            'absolute inset-0 grid place-items-center rounded bg-black/55 text-white outline-none focus-visible:ring-2 focus-visible:ring-ember',
            active && !showBars ? 'opacity-100 transition-opacity' : REVEAL,
          )}
        >
          <ControlIcon className="h-3.5 w-3.5 fill-current" />
        </button>
      )}
    </div>
  );

  const leadSlot =
    control === 'leading' ? (
      <div data-testid="row-lead-slot" className="relative grid size-8 place-items-center justify-self-center">
        {showBars && barsInLead && <EqBars playing={playing} className="absolute" />}
        <Button
          variant="ghost"
          size="icon"
          data-testid="row-lead-control"
          onClick={press}
          aria-label={controlLabel}
          className={cn('size-8', active && !showBars ? 'text-ember hover:text-ember' : REVEAL)}
        >
          <ControlIcon className="h-3.5 w-3.5 fill-current" />
        </Button>
      </div>
    ) : null;

  const trailingControl =
    control === 'trailing' ? (
      <Button
        variant="ghost"
        size="icon"
        data-testid="row-trailing-control"
        onClick={press}
        aria-label={controlLabel}
        className={cn(
          'size-8',
          active ? 'text-ember hover:text-ember' : cn('text-muted-foreground hover:text-foreground', REVEAL),
        )}
      >
        <ControlIcon className="h-3.5 w-3.5 fill-current" />
      </Button>
    ) : null;

  const title = (
    <div
      data-testid={indicator === 'ember-title' && active ? 'row-ember-title' : undefined}
      className={cn(
        'flex min-w-0 items-center gap-inset',
        compact ? 'text-sm font-medium' : 'text-sm font-semibold',
        indicator === 'ember-title' && active && 'text-ember',
      )}
    >
      {glyph}
      <span className="truncate">{track.title}</span>
    </div>
  );

  const artist = <div className="truncate text-xs text-muted-foreground">{track.artist}</div>;

  const tintEdge =
    indicator === 'tinted' && active ? (
      <span data-testid="row-tint-edge" aria-hidden className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-ember" />
    ) : null;

  const shared = cn(
    'group relative cursor-pointer rounded-md px-row py-cluster transition-colors hover:bg-card',
    indicator === 'tinted' && active && 'bg-ember/10 hover:bg-ember/15',
  );

  const flags = {
    'data-testid': 'search-row',
    'data-control': control,
    'data-indicator': indicator,
    'data-active': active ? 'true' : 'false',
    'data-playing': showPause ? 'true' : 'false',
  } as const;

  if (compact) {
    return (
      <div {...flags} className={cn(shared, 'flex items-center gap-row')}>
        {tintEdge}
        {leadSlot}
        {artwork}
        <div className="min-w-0 flex-1">
          {title}
          {artist}
        </div>
        {trailingControl}
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Remove "${track.title}" from recent searches`}
          className={cn('h-7 w-7 text-muted-foreground hover:text-foreground', REVEAL, 'max-md:opacity-100')}
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    // The same container-query grid the live results rows use: the album
    // and duration columns appear once the row's OWN box is wide enough,
    // not once the window is, because the overlay caps at max-w-xl. The
    // leading 40px column exists only for the Leading slot candidate; the
    // other two put their control somewhere that costs no column.
    <div
      {...flags}
      className={cn(
        shared,
        'grid items-center gap-row',
        control === 'leading'
          ? 'grid-cols-[40px_minmax(0,1fr)_auto] @3xl:grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)_60px_auto]'
          : 'grid-cols-[minmax(0,1fr)_auto] @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_60px_auto]',
      )}
    >
      {tintEdge}
      {leadSlot}
      <div className="flex min-w-0 items-center gap-row">
        {artwork}
        <div className="min-w-0">
          {title}
          {artist}
        </div>
      </div>
      <div className="hidden truncate text-sm text-muted-foreground @3xl:block">{track.album}</div>
      <div className="hidden text-right text-sm tabular-nums text-muted-foreground @3xl:block">
        {formatTime(track.durationSec, { empty: '--:--' })}
      </div>
      <div className="flex items-center gap-inset">{trailingControl}</div>
    </div>
  );
}
