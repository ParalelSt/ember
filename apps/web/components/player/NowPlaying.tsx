'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { LikeButton } from '@/components/primitives/LikeButton';
import {
  AlbumIcon, ArtistIcon, ChevronDownIcon, DevicesIcon, EqualizerIcon, FlagIcon, LinkIcon, ListPlusIcon,
  LyricsIcon, MoreIcon, MusicIcon, QueueIcon, RepeatIcon, RepeatOneIcon, ShareIcon, ShuffleIcon, TabsIcon,
} from '@/components/icons';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Artwork } from '@/components/primitives/Artwork';
import { AddToPlaylistMenu } from '@/components/track/menus/AddToPlaylistMenu';
import { canShare, shareTrack } from '@/components/track/ShareButton';
import { LyricsBody } from '@/components/player/LyricsBody';
import { NowPlayingSummary } from '@/components/player/NowPlayingSummary';
import { UnplayableMessage, useUnplayableMessage } from '@/components/player/UnplayableMessage';
import { QueueSheet } from '@/components/player/QueueSheet';
import { EqualizerSheet } from '@/components/player/EqualizerSheet';
import { SeekBar } from '@/components/player/SeekBar';
import { TransportControls } from '@/components/player/TransportControls';
import { DevicesSheet, useDevicesEntry } from '@/components/player/DevicesButton';
import { useBackDismiss } from '@/lib/useBackDismiss';
import { useTrackArtSrc } from '@/lib/offlineNative';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { useLikeToggle } from '@/hooks/useLikeToggle';
import { useQueryLyrics } from '@/hooks/useLyrics';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUiStore } from '@/stores/useUiStore';
import { useCastStore } from '@/stores/useCastStore';
import { contextTitle } from '@/lib/playback/contextTitle';
import { isUnavailable } from '@/lib/playback/queueNav';
import { cn } from '@/lib/utils';
import { tabsHref } from '@/lib/tabSources';

/** One row of the full-screen player's More sheet. */
interface MoreItem {
  key: string;
  label: string;
  /** A second line: the speaker it plays on, the equalizer On/Off. */
  detail?: string;
  Icon: typeof MoreIcon;
  /** Ember: the equalizer on. */
  lit?: boolean;
  onSelect: () => void;
}

/** Full-screen "Now Playing" view, phones only. Slides up over the app shell
 *  with large artwork up top and transport controls at the bottom, like the
 *  Spotify / YouTube Music expanded player. Opened by tapping the mini player
 *  bar; dismissed with the chevron, Escape, or tapping outside the controls. */
const SCROLLED_MASK =
  'linear-gradient(to bottom, transparent calc(var(--safe-top) + 3.5rem), #000 calc(var(--safe-top) + 4.5rem))';

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
  // The queue ("Up next" under the controls): the phone bar has no queue
  // button of its own, so this is where phones reach it. The sheet portals
  // above this view.
  const [queueOpen, setQueueOpen] = useState(false);
  // The equalizer, lit while it is on.
  const [eqOpen, setEqOpen] = useState(false);
  const eqOn = useSettingsStore((s) => s.equalizer.enabled);
  // A Cast receiver plays the stream itself, with no equalizer: the EQ tool
  // goes while casting (AirPlay keeps this page's audio, and its filters).
  const eqAvailable = useCastStore((s) => !(s.connection === 'connected' && s.path !== 'airplay'));
  // The More sheet, and what it opens that is not a sheet of its own: the
  // add-to-playlist menu, the devices sheet, the lyrics report form.
  const [moreOpen, setMoreOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  // Devices shows only with somewhere else to play, named when it plays there.
  const devices = useDevicesEntry();
  // Whether the song has lyrics to report (the same cached query the
  // lyrics card below reads; PlayerProvider prefetches it).
  const { data: lyricsData } = useQueryLyrics(current, open);
  const hasLyrics = !!lyricsData?.lyrics;

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
  // Scrolled at all: the band under the floating buttons fades out.
  const [scrolled, setScrolled] = useState(false);
  const lyricsRef = useRef<HTMLDivElement | null>(null);
  // Lyrics scrolls down to the lyrics card (counted, so asking twice
  // scrolls twice).
  const [lyricsAsked, setLyricsAsked] = useState(0);
  useEffect(() => {
    if (lyricsAsked) lyricsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [lyricsAsked]);

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
    setReportOpen(false);
  }

  // Auto-close if playback stops entirely (queue cleared).
  useEffect(() => {
    if (open && !current) setOpen(false);
  }, [open, current, setOpen]);

  // On every fresh open: reset scroll to the top. Without this the scroller
  // keeps its previous scrollTop (the dialog isn't unmounted, just hidden
  // via translate-y), so reopening after a Lyrics-focused open would
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

  // The More sheet: one plain list of what has no button on the player. Like,
  // Lyrics and Devices stay on the player itself. Each row opens the sheet or
  // page it always did.
  const canAdd = !!(current && user && !isUnavailable(current));
  const items: MoreItem[] = [];
  if (canAdd) items.push({ key: 'add', label: 'Add to playlist', Icon: ListPlusIcon, onSelect: () => setAddOpen(true) });
  if (current) items.push({ key: 'queue', label: 'Up next', Icon: QueueIcon, onSelect: () => setQueueOpen(true) });
  if (current && tabsEnabled) items.push({ key: 'tabs', label: 'Guitar tabs', Icon: TabsIcon, onSelect: openTabs });
  if (eqAvailable) {
    items.push({ key: 'eq', label: 'Equalizer', detail: eqOn ? 'On' : 'Off', Icon: EqualizerIcon, lit: eqOn, onSelect: () => setEqOpen(true) });
  }
  if (current && canShare(current)) {
    const track = current;
    const sheet = typeof navigator !== 'undefined' && !!navigator.share;
    items.push({
      key: 'share',
      label: sheet ? 'Share' : 'Copy link',
      Icon: sheet ? ShareIcon : LinkIcon,
      onSelect: () => void shareTrack(track),
    });
  }
  if (current?.artistId) {
    const href = `/artist/${encodeURIComponent(current.artistId)}`;
    items.push({ key: 'artist', label: 'Go to artist', Icon: ArtistIcon, onSelect: () => closeThenGo(href) });
  }
  if (current?.albumId) {
    const href = `/album/${encodeURIComponent(current.albumId)}`;
    items.push({ key: 'album', label: 'Go to album', Icon: AlbumIcon, onSelect: () => closeThenGo(href) });
  }
  if (current && hasLyrics) {
    items.push({ key: 'report', label: 'Report wrong lyrics', Icon: FlagIcon, onSelect: () => setReportOpen(true) });
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
      {/* The one options button, floating with the chevron. The playlist
          menu hangs from an invisible anchor beside it. */}
      {current && items.length > 0 && (
        <div className="absolute z-20 right-3 flex items-center" style={{ top: 'calc(var(--safe-top) + 1rem)' }}>
          {canAdd && (
            <div className="absolute inset-y-0 right-0">
              <AddToPlaylistMenu track={current} open={addOpen} onOpenChange={setAddOpen} hiddenTrigger />
            </div>
          )}
          <button
            type="button"
            aria-label="More"
            title="More"
            data-testid="now-playing-more"
            onClick={() => setMoreOpen(true)}
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
          >
            <MoreIcon className="h-5 w-5" />
          </button>
        </div>
      )}
      {current && (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl p-0" data-testid="now-playing-more-sheet">
            <SheetHeader className="px-block pt-block pb-cluster">
              <div className="flex min-w-0 items-center gap-row">
                <Artwork src={art} className="size-12 shrink-0 rounded-md bg-art">
                  <div className="grid h-full w-full place-items-center text-foreground/30">
                    <MusicIcon className="h-5 w-5" />
                  </div>
                </Artwork>
                <div className="min-w-0 text-left">
                  <SheetTitle className="truncate text-base">{current.title}</SheetTitle>
                  <div className="truncate text-sm text-muted-foreground">{current.artist}</div>
                </div>
              </div>
            </SheetHeader>
            <div className="flex flex-col px-cluster pb-stack">
              {items.map(({ key, label, detail, Icon, lit, onSelect }) => (
                <button
                  key={key}
                  type="button"
                  data-testid={`more-${key}`}
                  onClick={() => {
                    setMoreOpen(false);
                    onSelect();
                  }}
                  className="flex min-h-12 items-center gap-row rounded-lg px-row py-cluster text-left text-[15px] outline-none hover:bg-accent focus-visible:bg-accent"
                >
                  <Icon className={cn('h-5 w-5 shrink-0', lit ? 'text-ember' : 'text-muted-foreground')} />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {detail && <span className={cn('max-w-40 truncate text-xs', lit ? 'text-ember' : 'text-muted-foreground')}>{detail}</span>}
                </button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      )}
      <DevicesSheet open={devicesOpen} onOpenChange={setDevicesOpen} />
      <QueueSheet open={queueOpen} onOpenChange={setQueueOpen} />
      <EqualizerSheet open={eqOpen} onOpenChange={setEqOpen} />

      <div
        ref={scrollerRef}
        data-testid="now-playing-scroller"
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
        className="relative h-full overflow-y-auto px-6"
        style={{
          // Padding-top lines the title up with the floating buttons.
          paddingTop: 'calc(var(--safe-top) + 1rem)',
          paddingBottom: 'calc(var(--safe-bottom) + 1.5rem)',
          // The buttons float with no background, so scrolled content slid
          // under them and read through them (bughunt V6). Once scrolled,
          // it fades out under the buttons (their bottom edge is the safe
          // area + 1rem + 2.5rem). At the top nothing is masked: the
          // "Playing from" title sits in that band.
          ...(scrolled ? { maskImage: SCROLLED_MASK, WebkitMaskImage: SCROLLED_MASK } : null),
        }}
      >
      {/* "Player" pane, sized to fill the first viewport so the artwork-
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

        {/* Artwork, fills the upper space, centered. */}
        <div className="flex-1 grid place-items-center py-4">
          <Artwork
            src={art}
            className="w-full max-w-md aspect-square rounded-2xl bg-art shadow-2xl ring-1 ring-foreground/10"
          >
            <div className="h-full w-full grid place-items-center text-foreground/20">
              <MusicIcon className="h-20 w-20" />
            </div>
          </Artwork>
        </div>

        {/* Title + artist */}
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
            <LikeButton size="md" liked={isLiked} onToggle={toggleLike} className="shrink-0" />
          )}
        </div>

        {/* Progress */}
        <SeekBar position={position} duration={duration} onSeek={seek} labels="below" className="mt-6" />

        {/* Transport controls, prev/play/next centered; loop pinned right. */}
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

        {/* Devices bottom-left (named when it plays elsewhere), Lyrics
            bottom-right, under the transport. */}
        {current && (
          <div className="mt-block flex items-center justify-between gap-block">
            {devices.visible ? (
              <button
                type="button"
                aria-label="Devices"
                title="Devices"
                data-testid="player-devices"
                onClick={() => setDevicesOpen(true)}
                className={cn(
                  'inline-flex h-10 min-w-0 items-center gap-cluster rounded-md pr-cluster transition-colors hover:text-foreground',
                  devices.lit ? 'text-ember' : 'text-muted-foreground',
                )}
              >
                <DevicesIcon className="h-5 w-5 shrink-0" />
                {devices.on && <span className="max-w-32 truncate text-xs">{devices.on}</span>}
              </button>
            ) : <span />}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLyricsAsked((n) => n + 1)}
              aria-label="Lyrics"
              title="Lyrics"
              data-testid="player-lyrics"
              className="h-10 w-10 text-muted-foreground hover:text-foreground"
            >
              <LyricsIcon className="h-5 w-5" />
            </Button>
          </div>
        )}

      </div>

      {/* Lyrics card, sits BELOW the min-h-full player pane so the
          scroller actually overflows and scrollIntoView lands at the
          top of this block. Tapping Lyrics in the mini-bar opens
          NowPlaying with nowPlayingFocus='lyrics' and we smooth-scroll
          here. Height is 70vh (NOT 100vh) so the user can see they're
          inside a card, and the page can be swiped down past the card
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
        <LyricsBody active={open} showHeader={false} reportOpen={reportOpen} onReportOpenChange={setReportOpen} />
      </div>
      </div>
    </div>
  );
}
