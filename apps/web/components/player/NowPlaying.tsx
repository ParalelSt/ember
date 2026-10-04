'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  ChevronDownIcon, EqualizerIcon, LibraryIcon, MicIcon, MoreIcon, MusicIcon, PlusIcon, QueueIcon,
  RepeatIcon, RepeatOneIcon, ShareIcon, ShuffleIcon, TabsIcon,
} from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Artwork } from '@/components/primitives/Artwork';
import { LikeButton } from '@/components/primitives/LikeButton';
import { AddToPlaylistMenu } from '@/components/track/menus/AddToPlaylistMenu';
import { ShareButton, canShare, shareTrack } from '@/components/track/ShareButton';
import { LyricsBody } from '@/components/player/LyricsBody';
import { NowPlayingSummary } from '@/components/player/NowPlayingSummary';
import { UnplayableMessage, useUnplayableMessage } from '@/components/player/UnplayableMessage';
import { QueueSheet } from '@/components/player/QueueSheet';
import { EqualizerSheet } from '@/components/player/EqualizerSheet';
import { SeekBar } from '@/components/player/SeekBar';
import { TransportControls } from '@/components/player/TransportControls';
import { DevicesButton } from '@/components/player/DevicesButton';
import { PlayerToolButton } from '@/components/player/PlayerToolButton';
import { useBackDismiss } from '@/lib/useBackDismiss';
import { useTrackArtSrc } from '@/lib/offlineNative';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { useLikeToggle } from '@/hooks/useLikeToggle';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUiStore } from '@/stores/useUiStore';
import { useCastStore } from '@/stores/useCastStore';
import { contextTitle } from '@/lib/playback/contextTitle';
import { isUnavailable } from '@/lib/playback/queueNav';
import { cn } from '@/lib/utils';
import { tabsHref } from '@/lib/tabSources';

/** One row of the full-screen player's More menu. */
interface MoreItem {
  key: string;
  label: string;
  Icon: typeof MoreIcon;
  onSelect: () => void;
}

/** Full-screen "Now Playing" view — phones only. Slides up over the app shell
 *  with large artwork up top and transport controls at the bottom, like the
 *  Spotify / YouTube Music expanded player. Opened by tapping the mini player
 *  bar; dismissed with the chevron, Escape, or tapping outside the controls. */
export function NowPlaying() {
  const open = usePlayerStore((s) => s.nowPlayingOpen);
  const setOpen = usePlayerStore((s) => s.setNowPlayingOpen);
  // Android/browser Back closes the full-screen player instead of leaving
  // the site while it's open. setOpen from Zustand is stable, so close is too.
  const close = useCallback(() => setOpen(false), [setOpen]);
  useBackDismiss(open, close);
  const focus = useUiStore((s) => s.nowPlayingFocus);
  const setFocus = useUiStore((s) => s.setNowPlayingFocus);
  const { current, isPlaying, position, duration, toggle, next, prev, seek, retry } = usePlayer();
  const { user } = useAuth();
  // A song that could not play: the title area says so, as the bar does.
  const unplayable = useUnplayableMessage();
  const { liked: isLiked, toggle: toggleLike } = useLikeToggle(current);
  const loopMode = usePlayerStore((s) => s.loopMode);
  const cycleLoopMode = usePlayerStore((s) => s.cycleLoopMode);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const context = usePlayerStore((s) => s.context);
  const isPlaylist = context?.type === 'playlist';
  const title = contextTitle(context);
  const tabsEnabled = useSettingsStore((s) => s.tabsEnabled);
  // The queue: the phone bar has no queue button of its own any more, so
  // this is where phones reach it. The sheet portals above this view.
  const [queueOpen, setQueueOpen] = useState(false);
  // The equalizer, lit while it is on.
  const [eqOpen, setEqOpen] = useState(false);
  const eqOn = useSettingsStore((s) => s.equalizer.enabled);
  // A Cast receiver plays the stream itself, with no equalizer: the EQ tool
  // goes while casting (AirPlay keeps this page's audio, and its filters).
  const eqAvailable = useCastStore((s) => !(s.connection === 'connected' && s.path !== 'airplay'));
  // The More menu, and the like row's add-to-playlist menu it can open.
  const [moreOpen, setMoreOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const router = useRouter();
  // Leaving for another page (the tab page, the artist, the album). Closing
  // this view pops the history entry useBackDismiss pushed, and a
  // navigation issued before that back lands is undone by it. So close
  // first and navigate once the pop has happened (or shortly after, if the
  // entry was already gone).
  const closeThenGo = (href: string) => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      window.removeEventListener('popstate', go);
      router.push(href);
    };
    window.addEventListener('popstate', go);
    setOpen(false);
    window.setTimeout(go, 400);
  };
  // The tab page for this song, full screen on phones like everything else.
  const openTabs = () => {
    if (current) closeThenGo(tabsHref(current.id));
  };

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const lyricsRef = useRef<HTMLDivElement | null>(null);

  // The playlist menu opens from the like row's +, in the player pane above
  // the lyrics: bring it into view when More opens it from further down.
  useEffect(() => {
    if (addOpen) scrollerRef.current?.scrollTo?.({ top: 0 });
  }, [addOpen]);

  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, setOpen]);

  // More and the playlist menu belong to the song they were opened on, in
  // the open player. They portal above this view, so closing it any way
  // other than through them (Back, Escape, the chevron, playback stopping)
  // would leave them floating over the app, and a new song starting would
  // turn "Add to playlist" or "Go to artist" into actions on that song.
  // Reset while rendering when either changes (React's "adjusting state
  // when a prop changes" pattern), so they are never painted open on the
  // wrong song even for a frame.
  const menusKey = `${open ? 1 : 0}:${current?.id ?? ''}`;
  const [menusFor, setMenusFor] = useState(menusKey);
  if (menusFor !== menusKey) {
    setMenusFor(menusKey);
    setMoreOpen(false);
    setAddOpen(false);
  }

  // Auto-close if playback stops entirely (queue cleared).
  useEffect(() => {
    if (open && !current) setOpen(false);
  }, [open, current, setOpen]);

  // On every fresh open: reset scroll to the top. Without this the scroller
  // keeps its previous scrollTop (the dialog isn't unmounted, just hidden
  // via translate-y) — so reopening after a Lyrics-focused open would
  // dump you mid-page inside the lyrics card. If focus IS 'lyrics' we
  // immediately scroll back down to the card after the open transition.
  useEffect(() => {
    if (!open) return;
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
    if (focus !== 'lyrics') return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        lyricsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setFocus(null);
      });
    });
    return () => {
      cancelAnimationFrame(r1);
      if (r2) cancelAnimationFrame(r2);
    };
  }, [open, focus, setFocus]);

  // A downloaded copy's own local art wins over the remote artworkUrl, shared
  // with NowPlayingSummary's player-bar thumbnail.
  const art = useTrackArtSrc(current);

  // The More menu: what fits no button on the player. Add to playlist also
  // has the like row's +, which is where its menu opens; share joins here
  // only when the like row (signed-in only) is not there to carry it.
  const moreItems: MoreItem[] = [];
  if (current && user && !isUnavailable(current)) {
    moreItems.push({
      key: 'add',
      label: 'Add to playlist',
      Icon: PlusIcon,
      onSelect: () => setAddOpen(true),
    });
  }
  if (current?.artistId) {
    const href = `/artist/${encodeURIComponent(current.artistId)}`;
    moreItems.push({ key: 'artist', label: 'Go to artist', Icon: MicIcon, onSelect: () => closeThenGo(href) });
  }
  if (current?.albumId) {
    const href = `/album/${encodeURIComponent(current.albumId)}`;
    moreItems.push({ key: 'album', label: 'Go to album', Icon: LibraryIcon, onSelect: () => closeThenGo(href) });
  }
  if (current && !user && canShare(current)) {
    const track = current;
    moreItems.push({ key: 'share', label: 'Share', Icon: ShareIcon, onSelect: () => void shareTrack(track) });
  }

  // Pinned left, mirroring the loop button on the right: keeping both OUT of
  // the flex flow is what keeps prev/play/next centered. Playlists only:
  // shuffling a search/radio queue makes no sense.
  const shuffleButton = isPlaylist ? (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleShuffle}
      aria-label={shuffle ? 'Shuffle off' : 'Shuffle'}
      aria-pressed={shuffle}
      className={cn(
        'absolute left-0 h-10 w-10',
        shuffle ? 'text-ember hover:text-ember' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <ShuffleIcon className="h-5 w-5" />
    </Button>
  ) : null;

  const loopButton = (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycleLoopMode}
      aria-label={loopMode === 'one' ? 'Loop one' : loopMode === 'all' ? 'Loop off' : 'Loop playlist'}
      aria-pressed={loopMode !== 'off'}
      className={cn(
        'absolute right-0 h-10 w-10',
        loopMode !== 'off' ? 'text-ember hover:text-ember' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {loopMode === 'one' ? <RepeatOneIcon className="h-5 w-5" /> : <RepeatIcon className="h-5 w-5" />}
    </Button>
  );

  return (
    <div
      data-testid="now-playing"
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
      className={cn(
        // z-45: above the app shell + BackToTop (z-40) but BELOW the portal
        // overlays (dropdown/dialog/sheet at z-50) so the add-to-playlist menu
        // and its New-playlist dialog open ON TOP of this full-screen view
        // instead of behind it.
        'md:hidden fixed inset-0 z-45 flex flex-col transition-all duration-300 ease-out',
        // Opacity-0 in addition to the slide-down so iOS Safari can't leak a
        // sliver of the blurred-artwork backdrop over the PlayerBar.
        open ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none',
      )}
    >
      {/* Backdrop: blurred artwork + dark gradient for legibility. */}
      <div className="absolute inset-0 -z-10 bg-background">
        {art && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art} alt="" className="h-full w-full object-cover scale-125 blur-3xl opacity-40" />
        )}
        <div className="absolute inset-0 bg-linear-to-b from-background/40 via-background/70 to-background" />
      </div>

      {/* The top row floats: anchored to the dialog (not the scroller) so
          the close chevron and the More menu stay at the very top of the
          viewport regardless of scroll position, and are still reachable
          from the lyrics card below. The "Playing from" title between them
          sits in the scroller and scrolls away with the player. */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(false)}
        aria-label="Close"
        className="absolute z-20 left-3 h-10 w-10 text-foreground/80 hover:text-foreground"
        style={{ top: 'calc(var(--safe-top) + 1rem)' }}
      >
        <ChevronDownIcon className="h-6 w-6" />
      </Button>
      {moreItems.length > 0 && (
        <div className="absolute z-20 right-3" style={{ top: 'calc(var(--safe-top) + 1rem)' }}>
          <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
            <DropdownMenuTrigger
              aria-label="More"
              title="More"
              data-testid="now-playing-more"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
            >
              <MoreIcon className="h-5 w-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              {moreItems.map(({ key, label, Icon, onSelect }) => (
                <DropdownMenuItem
                  key={key}
                  onClick={() => {
                    setMoreOpen(false);
                    onSelect();
                  }}
                  className="gap-row py-cluster"
                >
                  <Icon className="h-4 w-4" /> {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <QueueSheet open={queueOpen} onOpenChange={setQueueOpen} />
      <EqualizerSheet open={eqOpen} onOpenChange={setEqOpen} />

      <div
        ref={scrollerRef}
        className="relative h-full overflow-y-auto px-6"
        style={{
          // Padding-top lines the title up with the floating buttons.
          paddingTop: 'calc(var(--safe-top) + 1rem)',
          paddingBottom: 'calc(var(--safe-bottom) + 1.5rem)',
        }}
      >
      {/* "Player" pane — sized to fill the first viewport so the artwork-
          centered look is preserved. Lyrics live BELOW this wrapper so
          they push the scroller into overflow and become scroll-reachable. */}
      <div className="flex flex-col min-h-full">

        {/* "Playing from playlist / Road trip", between the chevron and More. */}
        <div data-testid="context-title" className="mx-hit flex h-10 min-w-0 flex-col items-center justify-center text-center">
          <div className="max-w-full truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {title.kicker}
          </div>
          {title.name && <div className="max-w-full truncate text-sm font-semibold">{title.name}</div>}
        </div>

        {/* Artwork — fills the upper space, centered. */}
        <div className="flex-1 grid place-items-center py-4">
          <Artwork
            src={art}
            className="w-full max-w-sm aspect-square rounded-2xl bg-art shadow-2xl ring-1 ring-foreground/10"
          >
            <div className="h-full w-full grid place-items-center text-foreground/20">
              <MusicIcon className="h-20 w-20" />
            </div>
          </Artwork>
        </div>

        {/* Title + artist + like */}
        <div className="flex items-end justify-between gap-4">
          {/* A song that could not play: said here too, as in the bar. */}
          {unplayable ? (
            <UnplayableMessage size="player" onRetry={retry} onOpenQueue={() => setQueueOpen(true)} />
          ) : (
            <NowPlayingSummary
              track={current}
              size="lg"
              marquee={open}
              onArtistNavigate={() => setOpen(false)}
            />
          )}
          {current && user && (
            <div className="flex items-center gap-1 shrink-0">
              <LikeButton size="md" liked={isLiked} onToggle={toggleLike} />
              <AddToPlaylistMenu track={current} open={addOpen} onOpenChange={setAddOpen} />
              <ShareButton track={current} className="h-10 w-10" />
            </div>
          )}
        </div>

        {/* Progress */}
        <SeekBar position={position} duration={duration} onSeek={seek} labels="below" className="mt-6" />

        {/* Transport controls — prev/play/next centered; loop pinned right. */}
        <TransportControls
          playing={isPlaying}
          onToggle={toggle}
          onNext={next}
          onPrev={prev}
          size="lg"
          className="mt-6"
          left={shuffleButton}
          right={loopButton}
        />

        {/* The tools, each an icon over a label: where the music plays (the
            label names the output when it is not the phone), guitar tabs
            (when the plugin is on), the equalizer (not while casting) and
            the queue. Equal columns, however many there are. */}
        <div data-testid="tool-row" className="mt-block grid grid-flow-col auto-cols-fr gap-inset">
          <DevicesButton variant="full" iconClassName="h-5 w-5" />
          {tabsEnabled && (
            <PlayerToolButton label="Tabs" ariaLabel="Guitar tabs" onClick={openTabs}>
              <TabsIcon className="h-5 w-5" />
            </PlayerToolButton>
          )}
          {eqAvailable && (
            <PlayerToolButton label="EQ" ariaLabel="Equalizer" lit={eqOn} onClick={() => setEqOpen(true)}>
              <EqualizerIcon className="h-5 w-5" />
            </PlayerToolButton>
          )}
          <PlayerToolButton label="Queue" onClick={() => setQueueOpen(true)}>
            <QueueIcon className="h-5 w-5" />
          </PlayerToolButton>
        </div>
      </div>

      {/* Lyrics card — sits BELOW the min-h-full player pane so the
          scroller actually overflows and scrollIntoView lands at the
          top of this block. Tapping Lyrics in the mini-bar opens
          NowPlaying with nowPlayingFocus='lyrics' and we smooth-scroll
          here. Height is 70vh (NOT 100vh) so the user can see they're
          inside a card — and the page can be swiped down past the card
          to get back to the player pane without feeling stuck. The
          card's inner LyricsBody owns its own overflow-y-auto, so
          synced-lyrics auto-scroll happens inside the card; the outer
          page scroll only fires on intentional swipes past the card's
          top/bottom. Left margin is a touch less negative than the
          right so the block looks centered against the scrollbar
          gutter. Bottom margin keeps the card from butting up against
          the safe-area inset. */}
      <div
        ref={lyricsRef}
        className="mt-8 mb-6 -mr-6 -ml-3.5 h-[70vh] rounded-t-2xl bg-sidebar/90 text-sidebar-foreground backdrop-blur-sm flex flex-col"
      >
        <LyricsBody active={open} showHeader={false} />
      </div>
      </div>
    </div>
  );
}
