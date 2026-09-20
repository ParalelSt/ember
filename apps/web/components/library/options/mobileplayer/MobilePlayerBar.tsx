'use client';

import type { ReactNode } from 'react';
import { NextIcon, PauseIcon, PrevIcon, QueueIcon } from '@/components/icons';
import { MarqueeText } from '@/components/player/MarqueeText';
import { Artwork } from '@/components/primitives/Artwork';
import { cn } from '@/lib/utils';
import type { MobilePlayerLayout, MobileTitleOption } from '@/components/library/options/mobileplayer';
import type { Track } from '@/types/track';

// Tap boxes in CSS px -> the size utility that draws them. Named here so
// the numbers quoted in the section copy and the boxes on screen cannot
// drift apart: every candidate below picks its buttons out of this map.
const TAP: Record<40 | 44 | 48 | 56, string> = {
  40: 'size-10',
  44: 'size-11',
  48: 'size-12',
  56: 'size-14',
};

type TapSize = keyof typeof TAP;

/** A ghost icon button at an explicit tap size. Mock only: it renders the
 *  real icons at the real box sizes, but presses nothing. */
function Tap({ size, label, children }: { size: TapSize; label: string; children: ReactNode }) {
  return (
    <span
      role="img"
      aria-label={label}
      data-testid="mp-tap"
      data-tap={size}
      className={cn('grid shrink-0 place-items-center rounded-lg text-foreground', TAP[size])}
    >
      {children}
    </span>
  );
}

/** The play/pause button: the same filled circle the real TransportControls
 *  draws, at the candidate's own size. */
function PlayTap({ size }: { size: TapSize }) {
  return (
    <span
      role="img"
      aria-label="Pause"
      data-testid="mp-tap"
      data-tap={size}
      className={cn('grid shrink-0 place-items-center rounded-full bg-foreground text-background', TAP[size])}
    >
      <PauseIcon className={size >= 56 ? 'h-6 w-6 fill-current' : 'h-5 w-5 fill-current'} />
    </span>
  );
}

/** The song name and artist, in whichever of the three treatments the Title
 *  picker asks for. Scroll is the REAL MarqueeText the full-screen view
 *  uses, so this preview cannot drift from what that component does. */
function TitleBlock({ track, title }: { track: Track; title: MobileTitleOption }) {
  const artist = <div className="truncate text-xs text-muted-foreground">{track.artist}</div>;

  if (title === 'scroll') {
    return (
      <div data-testid="mp-title-block" data-title="scroll" className="min-w-0 flex-1">
        <MarqueeText text={track.title} className="text-sm font-semibold" />
        {artist}
      </div>
    );
  }

  return (
    <div data-testid="mp-title-block" data-title={title} className="min-w-0 flex-1">
      <div
        data-testid="mp-title"
        className={cn('text-sm font-semibold', title === 'two-lines' ? 'line-clamp-2 leading-tight' : 'truncate')}
      >
        {track.title}
      </div>
      {artist}
    </div>
  );
}

/** The thin progress line. `edge` is the Split candidate's version: full
 *  bleed along the very top of the bar, no padding around it. */
function Progress({ edge }: { edge?: boolean }) {
  return (
    <div
      data-testid={edge ? 'mp-progress-top' : 'mp-progress-bottom'}
      className={edge ? undefined : 'px-row pb-cluster'}
    >
      <div className={cn('relative bg-muted', edge ? 'h-0.5' : 'h-1 rounded-full')}>
        <div className={cn('absolute inset-y-0 left-0 w-[35%] bg-primary', !edge && 'rounded-full')} />
      </div>
    </div>
  );
}

export interface MobilePlayerBarProps {
  layout: MobilePlayerLayout;
  title: MobileTitleOption;
  track: Track;
}

/** Mock only, no player: the three candidate phone player bars, drawn with
 *  Ember's own tokens, type utilities and icons so they sit inside the mock
 *  shell exactly as the real footer would. The live PlayerBar is untouched. */
export function MobilePlayerBar({ layout, title, track }: MobilePlayerBarProps) {
  const art = (size: 'xs' | 'sm' | null) => (
    <Artwork
      src={track.artworkUrl}
      size={size ?? undefined}
      className={cn('shrink-0 rounded-md bg-black', size === null && 'size-11')}
    />
  );

  return (
    <footer
      data-testid="mobile-player-bar"
      data-layout={layout}
      className="flex shrink-0 flex-col border-t border-sidebar-border bg-sidebar"
    >
      {layout === 'split' && <Progress edge />}

      {layout === 'one-row' && (
        <div data-testid="mp-single-row" className="flex items-center gap-row px-block pt-row pb-cluster">
          {art('xs')}
          <TitleBlock track={track} title={title} />
          <div className="flex shrink-0 items-center gap-cluster">
            <Tap size={44} label="Previous">
              <PrevIcon className="h-5 w-5" />
            </Tap>
            <PlayTap size={48} />
            <Tap size={44} label="Next">
              <NextIcon className="h-5 w-5" />
            </Tap>
            <Tap size={44} label="Queue">
              <QueueIcon className="h-5 w-5" />
            </Tap>
          </div>
        </div>
      )}

      {layout === 'two-rows' && (
        <div className="flex flex-col gap-cluster px-block pt-row pb-cluster">
          {/* The whole width, nothing beside it: this is the row that gives
              a long name room to be read. */}
          <div data-testid="mp-title-row" className="flex min-w-0">
            <TitleBlock track={track} title={title} />
          </div>
          {/* [1fr auto 1fr] so the transport is centred on the bar whatever
              sits either side of it. */}
          <div data-testid="mp-controls-row" className="grid grid-cols-[1fr_auto_1fr] items-center">
            {art('sm')}
            <div className="flex items-center gap-row">
              <Tap size={48} label="Previous">
                <PrevIcon className="h-6 w-6" />
              </Tap>
              <PlayTap size={56} />
              <Tap size={48} label="Next">
                <NextIcon className="h-6 w-6" />
              </Tap>
            </div>
            <div className="flex justify-end">
              <Tap size={48} label="Queue">
                <QueueIcon className="h-6 w-6" />
              </Tap>
            </div>
          </div>
        </div>
      )}

      {layout === 'split' && (
        <div data-testid="mp-single-row" className="flex items-center gap-row px-block py-cluster">
          {art(null)}
          <TitleBlock track={track} title={title} />
          <div className="flex shrink-0 items-center gap-cluster">
            <PlayTap size={56} />
            <Tap size={48} label="Next">
              <NextIcon className="h-6 w-6" />
            </Tap>
          </div>
        </div>
      )}

      {layout !== 'split' && <Progress />}
    </footer>
  );
}
