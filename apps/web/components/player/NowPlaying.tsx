'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  ChevronDownIcon, MusicIcon,
  RepeatIcon, RepeatOneIcon, ShuffleIcon,
} from '@/components/icons';
import { Artwork } from '@/components/primitives/Artwork';
import { LikeButton } from '@/components/primitives/LikeButton';
import { AddToPlaylistMenu } from '@/components/track/menus/AddToPlaylistMenu';
import { ShareButton } from '@/components/track/ShareButton';
import { LyricsBody } from '@/components/player/LyricsBody';
import { NowPlayingSummary } from '@/components/player/NowPlayingSummary';
import { SeekBar } from '@/components/player/SeekBar';
import { TransportControls } from '@/components/player/TransportControls';
import { useBackDismiss } from '@/lib/useBackDismiss';
import { useTrackArtSrc } from '@/lib/offlineNative';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { useLikeToggle } from '@/hooks/useLikeToggle';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useUiStore } from '@/stores/useUiStore';
import { cn } from '@/lib/utils';

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
  const { current, isPlaying, position, duration, toggle, next, prev, seek } = usePlayer();
  const { user } = useAuth();
  const { liked: isLiked, toggle: toggleLike } = useLikeToggle(current);
  const loopMode = usePlayerStore((s) => s.loopMode);
  const cycleLoopMode = usePlayerStore((s) => s.cycleLoopMode);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const isPlaylist = usePlayerStore((s) => s.context?.type === 'playlist');

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const lyricsRef = useRef<HTMLDivElement | null>(null);

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

      {/* Floating close affordance. Anchored to the dialog (not the
          scroller) so it stays at the very top of the viewport regardless
          of scroll position — no boxy sticky-header bar above the artwork,
          and still reachable when the user has scrolled into the lyrics
          card below. Sits flush against the safe-area inset on iOS. */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(false)}
        aria-label="Close"
        className="absolute z-20 left-3 h-10 w-10 text-foreground/80 hover:text-foreground"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
      >
        <ChevronDownIcon className="h-6 w-6" />
      </Button>

      <div
        ref={scrollerRef}
        className="relative h-full overflow-y-auto px-6"
        style={{
          // Padding-top clears the floating close button (its top offset
          // + button height) so artwork doesn't slide under the chevron.
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)',
        }}
      >
      {/* "Player" pane — sized to fill the first viewport so the artwork-
          centered look is preserved. Lyrics live BELOW this wrapper so
          they push the scroller into overflow and become scroll-reachable. */}
      <div className="flex flex-col min-h-full">

        {/* Artwork — fills the upper space, centered. */}
        <div className="flex-1 grid place-items-center py-4">
          <Artwork
            src={art}
            className="w-full max-w-sm aspect-square rounded-2xl bg-black shadow-2xl ring-1 ring-white/10"
          >
            <div className="h-full w-full grid place-items-center text-foreground/20">
              <MusicIcon className="h-20 w-20" />
            </div>
          </Artwork>
        </div>

        {/* Title + artist + like */}
        <div className="flex items-end justify-between gap-4">
          <NowPlayingSummary
            track={current}
            size="lg"
            marquee={open}
            onArtistNavigate={() => setOpen(false)}
          />
          {current && user && (
            <div className="flex items-center gap-1 shrink-0">
              <LikeButton size="md" liked={isLiked} onToggle={toggleLike} />
              <AddToPlaylistMenu track={current} />
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
