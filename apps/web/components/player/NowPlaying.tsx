'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import {
  ChevronDownIcon, HeartIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, MusicIcon,
  RepeatIcon, RepeatOneIcon, ShuffleIcon,
} from '@/components/icons';
import { AddToPlaylistMenu } from '@/components/track/AddToPlaylistMenu';
import { ShareButton } from '@/components/track/ShareButton';
import { LyricsBody } from '@/components/player/LyricsBody';
import { MarqueeText } from '@/components/player/MarqueeText';
import { useBackDismiss } from '@/lib/useBackDismiss';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { useExecuteToggleLike, useQueryLikes } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useUiStore } from '@/stores/useUiStore';
import { findLikedVariant } from '@/lib/songKey';
import { cn } from '@/lib/utils';

function fmt(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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
  const { current, isPlaying, position, duration, toggle, next, prev, seek } = usePlayer();
  const { user } = useAuth();
  const { data: liked = [] } = useQueryLikes();
  const toggleLike = useExecuteToggleLike();
  const likedVariant = findLikedVariant(current, liked);
  const isLiked = !!likedVariant;
  const loopMode = usePlayerStore((s) => s.loopMode);
  const cycleLoopMode = usePlayerStore((s) => s.cycleLoopMode);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const lyricsRef = useRef<HTMLDivElement | null>(null);

  // Scrubbing: slider follows the user's finger without seeking on every
  // intermediate value — audio keeps playing from `position` until release.
  const [scrubPct, setScrubPct] = useState<number | null>(null);
  const playbackPct = duration ? (position / duration) * 100 : 0;
  const displayPct = scrubPct ?? playbackPct;
  const displaySec = (displayPct / 100) * (duration || 0);
  const onSliderChange = (v: number | readonly number[]) => {
    setScrubPct(Array.isArray(v) ? v[0] ?? 0 : (v as number));
  };
  const onSliderCommit = (v: number | readonly number[]) => {
    const pct = Array.isArray(v) ? v[0] ?? 0 : (v as number);
    seek((pct / 100) * (duration || 0));
    setScrubPct(null);
  };

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

  const art = current?.artworkUrl ?? null;

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
          <div className="w-full max-w-sm aspect-square rounded-2xl overflow-hidden bg-black shadow-2xl ring-1 ring-white/10">
            {art ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={art} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full grid place-items-center text-foreground/20">
                <MusicIcon className="h-20 w-20" />
              </div>
            )}
          </div>
        </div>

        {/* Title + artist + like */}
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <MarqueeText text={current?.title ?? ''} active={open} className="text-2xl font-bold tracking-tight" />
            <div className="mt-1 truncate text-sm text-muted-foreground">
              {current?.artistId ? (
                <Link href={`/artist/${current.artistId}`} onClick={() => setOpen(false)} className="hover:underline">
                  {current.artist}
                </Link>
              ) : (
                current?.artist ?? ''
              )}
            </div>
          </div>
          {current && user && (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-10 w-10 text-muted-foreground hover:text-foreground', isLiked && 'text-ember hover:text-ember')}
                onClick={() => current && toggleLike.mutate({ track: likedVariant ?? current, wasLiked: isLiked })}
                aria-label={isLiked ? 'Unlike' : 'Like'}
              >
                <HeartIcon className="h-6 w-6" fill={isLiked ? 'currentColor' : 'none'} />
              </Button>
              <AddToPlaylistMenu track={current} />
              <ShareButton track={current} className="h-10 w-10" />
            </div>
          )}
        </div>

        {/* Progress */}
        <div className="mt-6">
          <Slider
            value={[displayPct]}
            onValueChange={onSliderChange}
            onValueCommitted={onSliderCommit}
            max={100}
            step={0.1}
            smooth
          />
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>{fmt(displaySec)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        {/* Transport controls — prev/play/next centered; loop pinned right. */}
        <div className="relative mt-6 flex items-center justify-center gap-10">
          <Button variant="ghost" size="icon" className="h-12 w-12" onClick={prev} aria-label="Previous">
            <PrevIcon className="h-7 w-7" />
          </Button>
          <Button
            size="icon"
            onClick={toggle}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="h-16 w-16 rounded-full bg-foreground text-background hover:bg-foreground/90"
          >
            {isPlaying ? <PauseIcon className="h-7 w-7 fill-current" /> : <PlayIcon className="h-7 w-7 fill-current ml-0.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-12 w-12" onClick={next} aria-label="Next">
            <NextIcon className="h-7 w-7" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleShuffle}
            aria-label={shuffle ? 'Shuffle off' : 'Shuffle'}
            aria-pressed={shuffle}
            className={cn(
              'h-10 w-10',
              shuffle ? 'text-ember hover:text-ember' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <ShuffleIcon className="h-5 w-5" />
          </Button>
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
