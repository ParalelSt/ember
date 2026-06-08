'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import {
  ChevronDownIcon, HeartIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, MusicIcon,
} from '@/components/icons';
import { AddToPlaylistMenu } from '@/components/track/AddToPlaylistMenu';
import { LyricsBody } from '@/components/player/LyricsBody';
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
  const focus = useUiStore((s) => s.nowPlayingFocus);
  const setFocus = useUiStore((s) => s.setNowPlayingFocus);
  const { current, isPlaying, position, duration, toggle, next, prev, seek } = usePlayer();
  const { user } = useAuth();
  const { data: liked = [] } = useQueryLikes();
  const toggleLike = useExecuteToggleLike();
  const likedVariant = findLikedVariant(current, liked);
  const isLiked = !!likedVariant;

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

  // When the lyrics button on the mini-bar requests it, scroll to the
  // lyrics section after NowPlaying mounts. Double-RAF to wait for the
  // open transition (translate-y) to finish so scrollIntoView lands.
  useEffect(() => {
    if (!open || focus !== 'lyrics') return;
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
        'md:hidden fixed inset-0 z-60 flex flex-col transition-all duration-300 ease-out',
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

      <div
        ref={scrollerRef}
        className="relative h-full overflow-y-auto px-6"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)',
        }}
      >
      {/* "Player" pane — sized to fill the first viewport so the artwork-
          centered look is preserved. Lyrics live BELOW this wrapper so
          they push the scroller into overflow and become scroll-reachable. */}
      <div className="flex flex-col min-h-full">
        {/* Header — sticky so the close button stays reachable when
            the user has scrolled down into the lyrics card. Without
            this, the chevron sits a full viewport up and the user
            feels stuck. The outer scroller already pads for the
            safe-area inset; the header just needs to span the full
            width via -mx-6 px-6. */}
        <div className="sticky top-0 z-10 flex items-center justify-between py-3 bg-background/70 backdrop-blur-sm -mx-6 px-6">
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close">
            <ChevronDownIcon className="h-6 w-6" />
          </Button>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Now Playing</div>
          {/* Spacer balances the chevron so the label stays centered. */}
          <div className="w-10" />
        </div>

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
            <div className="truncate text-2xl font-bold tracking-tight">{current?.title ?? ''}</div>
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
          />
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>{fmt(displaySec)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        {/* Transport controls */}
        <div className="mt-6 flex items-center justify-center gap-10">
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
