'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  LyricsIcon,
  TabsIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
} from '@/components/icons';
import { LikeButton } from '@/components/primitives/LikeButton';
import { AddToPlaylistMenu } from '@/components/track/AddToPlaylistMenu';
import { ShareButton } from '@/components/track/ShareButton';
import { QueueSheet } from '@/components/player/QueueSheet';
import { NowPlayingSummary } from '@/components/player/NowPlayingSummary';
import { SeekBar } from '@/components/player/SeekBar';
import { TransportControls } from '@/components/player/TransportControls';
import { VolumeControl } from '@/components/player/VolumeControl';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { useLikeToggle } from '@/hooks/useLikeToggle';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { TabsDialog } from '@/components/player/TabsDialog';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUiStore } from '@/stores/useUiStore';
import { cn } from '@/lib/utils';

export function PlayerBar() {
  const { current, isPlaying, position, duration, volume, toggle, next, prev, seek, setVolume } = usePlayer();
  const { user } = useAuth();
  const { liked: isLiked, toggle: toggleLike } = useLikeToggle(current);
  const openNowPlaying = usePlayerStore((s) => s.setNowPlayingOpen);
  const partyVolume = useSettingsStore((s) => s.partyVolume);
  const [queueOpen, setQueueOpen] = useState(false);
  const lyricsOpen = useUiStore((s) => s.lyricsOpen);
  const setLyricsOpen = useUiStore((s) => s.setLyricsOpen);
  const loopMode = usePlayerStore((s) => s.loopMode);
  const cycleLoopMode = usePlayerStore((s) => s.cycleLoopMode);
  const muted = usePlayerStore((s) => s.muted);
  const toggleMuted = usePlayerStore((s) => s.toggleMuted);

  // Desktop only — the button is hidden on phones (md:inline-flex), where
  // lyrics live inside the full-screen NowPlaying view instead.
  const onLyricsClick = () => setLyricsOpen(!lyricsOpen);
  const [tabsOpen, setTabsOpen] = useState(false);

  // Only render the bar once playback has actually started. Avoids the
  // "Nothing playing" placeholder strip and ensures the bar pops in the moment
  // a song is queued.
  if (!current) return null;

  // Loop toggle: cycles off, loop playlist (wrap queue, radio suppressed),
  // loop one song. Desktop only; phones get the same control in the
  // full-screen NowPlaying transport row.
  const loopButton = (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycleLoopMode}
      aria-label={
        loopMode === 'one' ? 'Loop one' : loopMode === 'all' ? 'Loop off' : 'Loop playlist'
      }
      aria-pressed={loopMode !== 'off'}
      title={
        loopMode === 'one' ? 'Looping current song' : loopMode === 'all' ? 'Looping playlist' : 'Loop off'
      }
      className={cn(
        'hidden md:inline-flex h-8 w-8',
        loopMode !== 'off'
          ? 'text-ember hover:text-ember'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {loopMode === 'one'
        ? <RepeatOneIcon className="h-4 w-4" />
        : <RepeatIcon className="h-4 w-4" />}
    </Button>
  );

  return (
    <footer
      className="shrink-0 bg-sidebar border-t border-sidebar-border flex flex-col"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
    <div className="px-4 pt-3 pb-2 grid grid-cols-[1fr_auto_1fr] md:grid-cols-[1fr_2fr_1fr] gap-4 items-center">
      {/* Now playing — tapping the art/title opens the full-screen view on phones. */}
      <div className="flex items-center gap-3 min-w-0">
        <NowPlayingSummary
          track={current}
          size="sm"
          onOpen={() => {
            if (current && window.matchMedia('(max-width: 767px)').matches) openNowPlaying(true);
          }}
        />
        {current && user && (
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            <LikeButton liked={isLiked} onToggle={toggleLike} />
            <AddToPlaylistMenu track={current} />
            <ShareButton track={current} />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-col items-center gap-1">
        <TransportControls
          playing={isPlaying}
          onToggle={toggle}
          onNext={next}
          onPrev={prev}
          size="sm"
          left={loopButton}
        />
        <SeekBar
          position={position}
          duration={duration}
          onSeek={seek}
          labels="inline"
          className="hidden md:flex w-full max-w-xl"
        />
      </div>

      {/* Right column — Queue always visible; Volume desktop only. */}
      <div className="flex justify-end items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'hidden md:inline-flex h-8 w-8 hover:text-foreground',
            lyricsOpen ? 'text-ember hover:text-ember' : 'text-muted-foreground',
          )}
          onClick={onLyricsClick}
          aria-label={lyricsOpen ? 'Close lyrics' : 'Lyrics'}
          aria-pressed={lyricsOpen}
          title="Lyrics"
        >
          <LyricsIcon className="h-4 w-4" />
        </Button>
        {/* Guitar tabs — opens Songsterr in the browser (they block embedding
            with X-Frame-Options, so an in-app viewer isn't possible). */}
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:inline-flex h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => setTabsOpen(true)}
          disabled={!current}
          aria-label="Guitar tabs"
          title="Guitar tabs"
        >
          <TabsIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 md:h-8 md:w-8 text-muted-foreground hover:text-foreground"
          onClick={() => setQueueOpen(true)}
          aria-label="Queue"
          title="Queue"
        >
          <QueueIcon className="h-5 w-5 md:h-4 md:w-4" />
        </Button>
        <VolumeControl
          volume={volume}
          muted={muted}
          max={partyVolume ? 1 : 0.85}
          onChange={setVolume}
          onToggleMute={toggleMuted}
          className="hidden md:flex"
          sliderClassName={partyVolume ? 'w-40' : 'w-29.5'}
        />
      </div>
    </div>

    {/* Mobile-only thin progress slider at the bottom edge of the bar.
        Spotify-style: visible, draggable, no labels. md+ uses the inline
        slider inside the controls column instead. */}
    <SeekBar position={position} duration={duration} onSeek={seek} className="md:hidden px-3 -mt-1" />

    <QueueSheet open={queueOpen} onOpenChange={setQueueOpen} />
      <TabsDialog track={current} open={tabsOpen} onOpenChange={setTabsOpen} />
    </footer>
  );
}
