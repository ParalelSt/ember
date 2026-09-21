'use client';

import { CloseIcon, MicIcon, MusicIcon, PauseIcon, SearchIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Artwork } from '@/components/primitives/Artwork';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';
import { TrackCard } from '@/components/track/TrackCard';
import { TrackList } from '@/components/track/TrackList';
import { TrackRow } from '@/components/track/TrackRow';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { AndroidNavStrip } from '@/components/library/options/mobileplayer/AndroidNavStrip';
import { ANDROID_NAV_PX } from '@/components/library/options/mobileplayer';
import { KEYBOARD_PX, MockKeyboard } from '@/components/library/options/phonesearch/MockKeyboard';
import {
  PHONE_SEARCH_OPTIONS,
  type PhoneSearchOption,
  type PhoneSearchState,
} from '@/components/library/options/phonesearch';
import { PhonePlayerBar, PLAYER_BAR_CHROME } from '@/components/player/PhonePlayerBar';
import { cn } from '@/lib/utils';
import type { Track } from '@/types/track';
import {
  MOCK_HOME_TRACKS,
  MOCK_MOBILE_NOW_PLAYING,
  MOCK_PHONE_SEARCH_PLAYING,
  MOCK_PHONE_SEARCH_QUERY,
  MOCK_PHONE_SEARCH_RECENTS,
  MOCK_PHONE_SEARCH_RESULTS,
} from '@/app/(app)/dizajn/mock';

const FRAME_H = 760;
const NOOP = () => {};
const RECENTS_FALLBACK = <MusicIcon className="h-4 w-4" />;
const NOTHING_LIKED = new Set<string>();
const SUGGESTIONS = ['harbour', 'harbours', 'harbour lights'];

/** The same three frames as the Mobile player section: a clean phone, the
 *  same phone with Android's navigation strip over it, and a small phone
 *  with the strip. The Android frames publish the strip's height as the
 *  bottom inset, the way MainActivity does on a real phone. */
const FRAMES: { id: string; label: string; width: number; systemNav: boolean }[] = [
  { id: 'clean-390', label: 'Phone (390px)', width: 390, systemNav: false },
  { id: 'android-390', label: 'Phone (390px), Android nav', width: 390, systemNav: true },
  { id: 'android-360', label: 'Small phone (360px), Android nav', width: 360, systemNav: true },
];

/** What the player is on in each state: the result just tapped, or a song
 *  picked before search was opened. */
function nowPlaying(state: PhoneSearchState): { track: Track; position: number } {
  return state === 'playing'
    ? { track: MOCK_PHONE_SEARCH_PLAYING, position: 11 }
    : { track: MOCK_MOBILE_NOW_PLAYING, position: 92 };
}

/** The page behind a sheet: Home, with two real TrackCards. */
function MockHome() {
  return (
    <div>
      <PageTitle className="mb-stack text-3xl!">Home</PageTitle>
      <SectionHeader title="Recently played" className="mb-row" />
      <div className="grid grid-cols-2 gap-block">
        {MOCK_HOME_TRACKS.slice(0, 2).map((t) => (
          <TrackCard key={t.id} track={t} onActivate={NOOP} artworkFallback={<MusicIcon className="h-6 w-6" />} />
        ))}
      </div>
    </div>
  );
}

/** The search box: SearchOverlay's own field markup (a read-only copy, the
 *  real one is not exported), with the focus ring the keyboard-up look
 *  needs. `closable` adds the sheet's X; a page has nothing to close. */
function SearchField({ state, closable }: { state: PhoneSearchState; closable: boolean }) {
  const q = state === 'empty' ? '' : MOCK_PHONE_SEARCH_QUERY;
  return (
    <div className="relative shrink-0">
      <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        readOnly
        value={q}
        onChange={NOOP}
        aria-label="Search"
        data-focused={state === 'typing'}
        placeholder="What do you want to listen to?"
        className={cn(
          'h-12 rounded-full border-0 bg-card pl-11',
          closable ? 'pr-20' : 'pr-12',
          state === 'typing' && 'ring-2 ring-ember/70',
        )}
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Search by voice"
        className={cn(
          'absolute top-1/2 h-9 w-9 -translate-y-1/2 rounded-full text-muted-foreground',
          closable ? 'right-10' : 'right-1',
        )}
      >
        <MicIcon className="h-4 w-4" />
      </Button>
      {closable && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close search"
          className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full text-muted-foreground"
        >
          <CloseIcon className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

/** Recents or results: the REAL rows the live overlay renders (compact
 *  TrackRow for recents, TrackList for results, both with
 *  `trailingPlayControl`), on mock data with inert handlers. */
function SearchBody({ state }: { state: PhoneSearchState }) {
  if (state === 'empty') {
    return (
      <div data-testid="phonesearch-recents">
        <SectionHeader title="Recent searches" className="mb-row" />
        <div className="flex flex-col">
          {MOCK_PHONE_SEARCH_RECENTS.map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              density="compact"
              trailingPlayControl
              playing
              artworkFallback={RECENTS_FALLBACK}
              onPlay={NOOP}
              onToggle={NOOP}
              onRemove={NOOP}
              removeLabel={`Remove "${t.title}" from recent searches`}
            />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div data-testid="phonesearch-results">
      <SectionHeader title={`Results for "${MOCK_PHONE_SEARCH_QUERY}"`} className="mb-row" />
      <TrackList
        tracks={MOCK_PHONE_SEARCH_RESULTS}
        trailingPlayControl
        currentId={state === 'playing' ? MOCK_PHONE_SEARCH_PLAYING.id : null}
        isPlaying
        likedIds={NOTHING_LIKED}
        onPlay={NOOP}
        onToggle={NOOP}
      />
    </div>
  );
}

/** Candidate 1's sheet: flat, full-bleed, from the top of the screen down
 *  to the player bar's top edge (the shell's `sheet` layer is exactly that
 *  box), so the bar and the nav under it stay uncovered. */
function SheetAbove({ state }: { state: PhoneSearchState }) {
  return (
    <div
      data-testid="phonesearch-sheet"
      data-covers-player="false"
      className="flex min-h-0 flex-1 flex-col bg-background"
    >
      <div className="px-block pb-row pt-block">
        <SearchField state={state} closable />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-block pb-block">
        <SearchBody state={state} />
      </div>
    </div>
  );
}

/** Candidate 2: /search as an ordinary page in the content column. */
function SearchPage({ state }: { state: PhoneSearchState }) {
  return (
    <div data-testid="phonesearch-page">
      <PageTitle className="mb-block text-3xl!">Search</PageTitle>
      <div className="mb-stack">
        <SearchField state={state} closable={false} />
      </div>
      <SearchBody state={state} />
    </div>
  );
}

/** Candidate 3's now-playing strip: artwork, name and artist, play/pause,
 *  and a hairline of progress that cannot be dragged. A mock: the real bar
 *  is not built to be this small. */
function MiniStrip({ track, position }: { track: Track; position: number }) {
  const pct = Math.min(100, (position / (track.durationSec ?? 200)) * 100);
  return (
    <div
      data-testid="phonesearch-mini-strip"
      className="relative mx-cluster mb-cluster flex items-center gap-row overflow-hidden rounded-lg bg-surface-2 py-inset pl-cluster pr-inset shadow-soft ring-1 ring-foreground/10"
    >
      <Artwork src={track.artworkUrl} size="xs" className="shrink-0 rounded-md bg-black" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{track.title}</div>
        <div className="truncate text-xs text-muted-foreground">{track.artist}</div>
      </div>
      <button
        type="button"
        aria-label="Pause"
        className="grid size-hit shrink-0 place-items-center rounded-full text-foreground"
      >
        <PauseIcon className="h-5 w-5 fill-current" />
      </button>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground/10">
        <div className="h-full bg-foreground/80" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Candidate 3's sheet: the whole screen, bar and nav included, shrunk to
 *  the space above the keyboard while it is up, with the strip pinned to
 *  its bottom edge. With the keyboard down its bottom clears the system
 *  strip through the same `safe-area-bottom` the real bars use. */
function MiniPlayerSheet({ state, keyboardTop }: { state: PhoneSearchState; keyboardTop: number | null }) {
  const { track, position } = nowPlaying(state);
  return (
    <div
      data-testid="phonesearch-sheet"
      data-covers-player="true"
      className={cn(
        'absolute inset-x-0 top-0 z-30 flex flex-col bg-background',
        keyboardTop === null && 'safe-area-bottom',
      )}
      style={{ bottom: keyboardTop ?? 0 }}
    >
      <div className="px-block pb-row pt-block">
        <SearchField state={state} closable />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-block pb-block">
        <SearchBody state={state} />
      </div>
      <MiniStrip track={track} position={position} />
    </div>
  );
}

function PhoneFrame({
  option,
  state,
  systemNav,
}: {
  option: PhoneSearchOption;
  state: PhoneSearchState;
  systemNav: boolean;
}) {
  const inset = systemNav ? ANDROID_NAV_PX : 0;
  const typing = state === 'typing';
  // The keyboard sits on top of the system strip, never under it.
  const keyboard = typing ? <MockKeyboard bottom={inset} suggestions={SUGGESTIONS} /> : null;
  const { track, position } = nowPlaying(state);

  const playerBar = (
    <footer data-testid="player-bar" className={PLAYER_BAR_CHROME}>
      <PhonePlayerBar
        track={track}
        playing
        position={position}
        duration={track.durationSec ?? 200}
        onToggle={NOOP}
        onSeek={NOOP}
        onOpen={NOOP}
      />
    </footer>
  );

  return (
    <ShellPreview
      phone
      activePath={option === 'mini-player' ? '/' : '/search'}
      content={option === 'search-page' ? <SearchPage state={state} /> : <MockHome />}
      sheet={option === 'sheet-above' ? <SheetAbove state={state} /> : undefined}
      modal={
        <>
          {option === 'mini-player' && (
            <MiniPlayerSheet state={state} keyboardTop={typing ? inset + KEYBOARD_PX : null} />
          )}
          {keyboard}
        </>
      }
      playerBar={playerBar}
      bottomInset={inset}
      systemNav={systemNav ? <AndroidNavStrip /> : undefined}
    />
  );
}

export interface PhoneSearchSectionProps {
  option: PhoneSearchOption;
  state: PhoneSearchState;
}

/** Three candidates for search on a phone, each inside the mock app shell
 *  in the same three phone frames as the Mobile player section. The rows
 *  are the REAL TrackRow / TrackList the overlay renders and the bar is the
 *  REAL PhonePlayerBar, on mock data with inert handlers; the sheets, the
 *  page, the mini strip and the keyboard are mock markup. The live search is
 *  unchanged. */
export function PhoneSearchSection({ option, state }: PhoneSearchSectionProps) {
  const candidate = PHONE_SEARCH_OPTIONS.find((o) => o.id === option) ?? PHONE_SEARCH_OPTIONS[0];
  return (
    <div data-testid="phonesearch-section" data-option={option} data-state={state}>
      <div data-testid="phonesearch-copy" className="mb-stack flex max-w-3xl flex-col gap-cluster">
        <div className="text-2xl font-bold tracking-tight">{candidate.name}</div>
        <p className="text-meta">{candidate.description}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-block gap-y-cluster text-sm">
          <dt className="font-semibold">Keyboard</dt>
          <dd data-testid="phonesearch-keyboard" className="text-muted-foreground">
            {candidate.keyboard}
          </dd>
          <dt className="font-semibold">Back gesture</dt>
          <dd data-testid="phonesearch-back" className="text-muted-foreground">
            {candidate.back}
          </dd>
          <dt className="font-semibold">Closing</dt>
          <dd data-testid="phonesearch-close" className="text-muted-foreground">
            {candidate.close}
          </dd>
        </dl>
      </div>

      <div className="flex flex-wrap items-start gap-stack">
        {FRAMES.map((frame) => (
          <div
            key={frame.id}
            data-testid="phonesearch-frame"
            data-frame={frame.id}
            className="w-full min-w-0 max-w-[390px] flex-[390_1_0%]"
          >
            <div className="mb-cluster flex min-h-7 items-center">
              <div className="text-eyebrow">{frame.label}</div>
            </div>
            <ScaledFrame width={frame.width} height={FRAME_H}>
              <PhoneFrame option={option} state={state} systemNav={frame.systemNav} />
            </ScaledFrame>
          </div>
        ))}
      </div>
    </div>
  );
}
