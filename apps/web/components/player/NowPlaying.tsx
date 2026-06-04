'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import {
  ChevronDownIcon, HeartIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, MusicIcon,
} from '@/components/icons';
import { AddToPlaylistMenu } from '@/components/track/AddToPlaylistMenu';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { useExecuteToggleLike, useQueryLikes } from '@/hooks/useLibrary';
import { usePlayerStore } from '@/stores/usePlayerStore';
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
  const { current, isPlaying, position, duration, toggle, next, prev, seek } = usePlayer();
  const { user } = useAuth();
  const { data: liked = [] } = useQueryLikes();
  const toggleLike = useExecuteToggleLike();
  const isLiked = current ? liked.some((t) => t.id === current.id) : false;

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
        className="relative flex flex-col h-full px-6"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between py-3">
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
                onClick={() => toggleLike.mutate({ track: current, wasLiked: isLiked })}
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
            value={[duration ? (position / duration) * 100 : 0]}
            onValueChange={(v) => {
              const pct = Array.isArray(v) ? (v[0] ?? 0) : v;
              seek((pct / 100) * (duration || 0));
            }}
            max={100}
            step={0.1}
          />
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>{fmt(position)}</span>
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
    </div>
  );
}
