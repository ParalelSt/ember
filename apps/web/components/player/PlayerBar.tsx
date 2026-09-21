'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  LyricsIcon,
  TabsIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
} from '@/components/icons';
import { LikeButton } from '@/components/primitives/LikeButton';
import { AddToPlaylistMenu } from '@/components/track/menus/AddToPlaylistMenu';
import { ShareButton } from '@/components/track/ShareButton';
import { QueueSheet } from '@/components/player/QueueSheet';
import { NowPlayingSummary } from '@/components/player/NowPlayingSummary';
import { PhonePlayerBar, PLAYER_BAR_CHROME } from '@/components/player/PhonePlayerBar';
import { SeekBar } from '@/components/player/SeekBar';
import { TransportControls } from '@/components/player/TransportControls';
import { VolumeControl } from '@/components/player/VolumeControl';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useLikeToggle } from '@/hooks/useLikeToggle';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUiStore } from '@/stores/useUiStore';
import { cn } from '@/lib/utils';
import { isTabsPathFor, tabsHref } from '@/lib/tabSources';

export function PlayerBar() {
  const { current, isPlaying, position, duration, volume, toggle, next, prev, seek, setVolume } = usePlayer();
  const { user } = useAuth();
  // A real media query, not `md:` classes: the two bars share almost no
  // geometry, and rendering both with one hidden would put two transports,
  // two queue buttons and two copies of the song name in the page at once
  // (same reason as the search overlay, see hooks/useIsDesktop).
  const isDesktop = useIsDesktop();
  const { liked: isLiked, toggle: toggleLike } = useLikeToggle(current);
  const openNowPlaying = usePlayerStore((s) => s.setNowPlayingOpen);
  const partyVolume = useSettingsStore((s) => s.partyVolume);
  const tabsEnabled = useSettingsStore((s) => s.tabsEnabled);
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
  const router = useRouter();
  const pathname = usePathname();

  // Only render the bar once playback has actually started. Avoids the
  // "Nothing playing" placeholder strip and ensures the bar pops in the moment
  // a song is queued.
  if (!current) return null;
  const tabsOpen = isTabsPathFor(pathname, current.id);

  // Phones get their own bar: artwork, the scrolling song name, play and
  // next. Previous and the queue live on the full-screen view the bar opens.
  if (!isDesktop) {
    return (
      <footer data-testid="player-bar" className={PLAYER_BAR_CHROME}>
        <PhonePlayerBar
          track={current}
          playing={isPlaying}
          position={position}
          duration={duration}
          onToggle={toggle}
          onSeek={seek}
          onNext={next}
          onOpen={() => openNowPlaying(true)}
        />
      </footer>
    );
  }

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

  // MobileNav stays mounted but `md:hidden` on this breakpoint, so it
  // contributes no height and no safe-area lift here: this footer is the
  // bottom-most visible element on a desktop-width window and must carry
  // the inset itself (a phone-sized window never reaches this branch — the
  // phone bar above leaves the inset to MobileNav instead).
  return (
    <footer data-testid="player-bar" className={cn(PLAYER_BAR_CHROME, 'safe-area-bottom')}>
    <div className="px-4 pt-3 pb-2 grid grid-cols-[1fr_auto_1fr] md:grid-cols-[1fr_2fr_1fr] gap-4 items-center">
      {/* Now playing. No tap-to-open here: this bar only renders on an md
          and wider window, and the phone bar owns that gesture. */}
      <div className="flex items-center gap-3 min-w-0">
        <NowPlayingSummary track={current} size="sm" />
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
        {/* Guitar tabs: the tab page for the playing song. Phones reach it
            from the full-screen NowPlaying view. Hidden entirely when the
            Songsterr integration plugin is switched off in Settings. */}
        {tabsEnabled && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'hidden md:inline-flex h-8 w-8 hover:text-foreground',
              tabsOpen ? 'text-ember hover:text-ember' : 'text-muted-foreground',
            )}
            onClick={() => router.push(tabsHref(current.id))}
            aria-label="Guitar tabs"
            aria-pressed={tabsOpen}
            title="Guitar tabs"
          >
            <TabsIcon className="h-4 w-4" />
          </Button>
        )}
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

    <QueueSheet open={queueOpen} onOpenChange={setQueueOpen} />
    </footer>
  );
}
