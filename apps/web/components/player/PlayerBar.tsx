'use client';

import Link from 'next/link';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { HeartIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, VolumeIcon } from '@/components/icons';
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

export function PlayerBar() {
  const { current, isPlaying, position, duration, volume, toggle, next, prev, seek, setVolume } = usePlayer();
  const { user } = useAuth();
  const { data: liked = [] } = useQueryLikes();
  const toggleLike = useExecuteToggleLike();
  const isLiked = current ? liked.some((t) => t.id === current.id) : false;
  const openNowPlaying = usePlayerStore((s) => s.setNowPlayingOpen);

  // Only render the bar once playback has actually started. Avoids the
  // "Nothing playing" placeholder strip and ensures the bar pops in the moment
  // a song is queued.
  if (!current) return null;

  return (
    <footer
      className="shrink-0 bg-sidebar border-t border-sidebar-border px-4 py-3 grid grid-cols-[1fr_auto_1fr] md:grid-cols-[1fr_2fr_1fr] gap-4 items-center"
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
    >
      {/* Now playing — tapping the art/title opens the full-screen view on phones. */}
      <div className="flex items-center gap-3 min-w-0">
        <div
          onClick={() => {
            if (current && window.matchMedia('(max-width: 767px)').matches) openNowPlaying(true);
          }}
          className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer md:cursor-default"
        >
          {current?.artworkUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.artworkUrl} alt="" className="h-12 w-12 rounded-md object-cover bg-black shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{current?.title ?? 'Nothing playing'}</div>
            <div className="truncate text-xs text-muted-foreground">
              {current?.artistId ? (
                <Link
                  href={`/artist/${current.artistId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="hover:underline"
                >
                  {current.artist}
                </Link>
              ) : (
                current?.artist ?? ''
              )}
            </div>
          </div>
        </div>
        {current && user && (
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-8 w-8 text-muted-foreground hover:text-foreground', isLiked && 'text-ember hover:text-ember')}
              onClick={() => toggleLike.mutate({ track: current, wasLiked: isLiked })}
              aria-label={isLiked ? 'Unlike' : 'Like'}
            >
              <HeartIcon className="h-4 w-4" fill={isLiked ? 'currentColor' : 'none'} />
            </Button>
            <AddToPlaylistMenu track={current} />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={prev} aria-label="Previous">
            <PrevIcon className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            onClick={toggle}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="h-10 w-10 rounded-full bg-foreground text-background hover:bg-foreground/90"
          >
            {isPlaying ? <PauseIcon className="h-4 w-4 fill-current" /> : <PlayIcon className="h-4 w-4 fill-current ml-0.5" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={next} aria-label="Next">
            <NextIcon className="h-4 w-4" />
          </Button>
        </div>
        <div className="hidden sm:flex w-full max-w-xl items-center gap-2">
          <span className="text-[10px] text-muted-foreground tabular-nums w-9 text-right">{fmt(position)}</span>
          <Slider
            value={[duration ? (position / duration) * 100 : 0]}
            onValueChange={(v) => {
              const pct = Array.isArray(v) ? (v[0] ?? 0) : v;
              seek((pct / 100) * (duration || 0));
            }}
            max={100}
            step={0.1}
            className="flex-1"
          />
          <span className="text-[10px] text-muted-foreground tabular-nums w-9">{fmt(duration)}</span>
        </div>
      </div>

      {/* Volume */}
      <div className="hidden md:flex justify-end items-center gap-2">
        <VolumeIcon className="h-4 w-4 text-muted-foreground" />
        <Slider
          value={[volume * 100]}
          onValueChange={(v) => {
            const pct = Array.isArray(v) ? (v[0] ?? 0) : v;
            setVolume(pct / 100);
          }}
          max={100}
          step={1}
          className="w-32"
        />
      </div>
    </footer>
  );
}
