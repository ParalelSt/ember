'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { TrackRow } from '@/components/track/TrackRow';
import { QueueRowMenu } from '@/components/player/QueueRowMenu';
import { QueueHeaderActions } from '@/components/player/QueueHeaderActions';
import { GripIcon } from '@/components/icons';
import { usePlayer } from '@/components/player/PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { isUnavailable } from '@/lib/playback/queueNav';
import { cn } from '@/lib/utils';
import type { Track } from '@/types/track';

/** Where a drag is: the row picked up (`from`) and the slot it would land
 *  in (`over`), both Next up positions. Only a change of slot renders: the
 *  row under the pointer is moved directly, as a queue can be thousands of
 *  rows. */
interface Drag {
  from: number;
  over: number;
}

/** How close to the list's top or bottom edge a dragged row starts it
 *  scrolling, and the most it scrolls a frame. */
const EDGE = 48;
const MAX_STEP = 14;

/** Where `from` lands for a row centred at `center`: the number of other
 *  rows whose middle is above it. `mids` are the rows' middles at the start
 *  of the drag. */
export function dropSlot(mids: readonly number[], from: number, center: number): number {
  let slot = 0;
  mids.forEach((mid, i) => {
    if (i !== from && mid < center) slot++;
  });
  return slot;
}

/** How far a row other than the dragged one slides to make room. */
function shiftFor(i: number, drag: Drag, height: number): number {
  if (i === drag.from) return 0;
  if (drag.from < drag.over && i > drag.from && i <= drag.over) return -height;
  if (drag.over < drag.from && i >= drag.over && i < drag.from) return height;
  return 0;
}

/** Next up (owner's pick "A. Handle and ⋯"): every row has a drag handle at
 *  its left and a ⋯ menu at its right, and still plays on a tap. A drag
 *  (mouse or finger) moves the row under the pointer, the others making
 *  room, and the queue changes once, on release. On the focused handle the
 *  arrow keys move the song one place up or down. The heading carries Clear
 *  and Shuffle. Every change goes to the player's real queue (the store's
 *  Next up edits), so Next, Previous and the native player follow it. */
export function QueueUpNext({
  upcoming,
  index,
  labelClassName,
  artworkSrcFor,
  outOfReach,
  scrollerRef,
  onGoToArtist,
}: {
  upcoming: Track[];
  /** The playing entry's queue position: row `i` is queue entry index + 1 + i. */
  index: number;
  labelClassName: string;
  artworkSrcFor: (t: Track) => string | null;
  outOfReach: (t: Track) => boolean;
  scrollerRef: RefObject<HTMLDivElement | null>;
  onGoToArtist: (href: string) => void;
}) {
  const { playAt } = usePlayer();
  const moveUpcoming = usePlayerStore((s) => s.moveUpcoming);
  const removeUpcoming = usePlayerStore((s) => s.removeUpcoming);
  const playNextUpcoming = usePlayerStore((s) => s.playNextUpcoming);
  const clearUpcoming = usePlayerStore((s) => s.clearUpcoming);
  const shuffleUpcoming = usePlayerStore((s) => s.shuffleUpcoming);

  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const handles = useRef<(HTMLButtonElement | null)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [height, setHeight] = useState(0);
  // What the window listeners need, without re-subscribing on every move.
  const live = useRef<{
    from: number;
    pointerId: number;
    /** The song picked up: a release lands only if it is still there. */
    trackId: string;
    el: HTMLDivElement;
    startY: number;
    startScroll: number;
    mids: number[];
    fromTop: number;
    fromHeight: number;
    pointerY: number;
    over: number;
    moved: boolean;
    index: number;
  } | null>(null);
  // A drag released over a row must not also count as a tap on it.
  const swallowClick = useRef(false);
  // After a keyboard move, the handle to focus at the song's new place.
  const focusAt = useRef<number | null>(null);
  const [said, setSaid] = useState('');
  const hintId = useId();

  // A song ending (or the queue changing some other way) mid-drag: the
  // positions picked up no longer mean the same songs. Drop the drag. Songs
  // only added at the end (radio) leave them as they were.
  useEffect(() => {
    const d = live.current;
    if (!d) return;
    if (d.index !== index || upcoming[d.from]?.id !== d.trackId) {
      d.el.style.transform = '';
      live.current = null;
      setDrag(null);
    }
  }, [index, upcoming]);

  useLayoutEffect(() => {
    if (focusAt.current === null) return;
    handles.current[focusAt.current]?.focus();
    focusAt.current = null;
  }, [upcoming]);

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const update = () => {
      const d = live.current;
      if (!d) return;
      const sc = scrollerRef.current;
      const scrolled = (sc?.scrollTop ?? 0) - d.startScroll;
      const dy = d.pointerY - d.startY + scrolled;
      if (Math.abs(dy) > 3) d.moved = true;
      d.el.style.transform = `translateY(${dy}px)`;
      // The rows' middles were measured before any scroll; `dy` counts the
      // scroll in, so this is the dragged row's middle in that same frame.
      const over = dropSlot(d.mids, d.from, d.fromTop + d.fromHeight / 2 + dy);
      d.over = over;
      setDrag((prev) => (prev && prev.over !== over ? { ...prev, over } : prev));
    };
    // Near the list's top or bottom edge, the list scrolls under the row.
    const tick = () => {
      const d = live.current;
      const sc = scrollerRef.current;
      if (d && sc) {
        const box = sc.getBoundingClientRect();
        let step = 0;
        if (d.pointerY < box.top + EDGE) step = -Math.ceil(((box.top + EDGE - d.pointerY) / EDGE) * MAX_STEP);
        else if (d.pointerY > box.bottom - EDGE) step = Math.ceil(((d.pointerY - (box.bottom - EDGE)) / EDGE) * MAX_STEP);
        if (step) {
          const before = sc.scrollTop;
          sc.scrollTop = before + Math.sign(step) * Math.min(MAX_STEP, Math.abs(step));
          if (sc.scrollTop !== before) update();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const move = (ev: PointerEvent) => {
      // A second finger on the screen is not this drag.
      if (live.current?.pointerId !== ev.pointerId) return;
      live.current.pointerY = ev.clientY;
      update();
    };
    const end = (commit: boolean) => (ev: PointerEvent) => {
      const d = live.current;
      if (d && d.pointerId !== ev.pointerId) return;
      live.current = null;
      setDrag(null);
      if (d) d.el.style.transform = '';
      // Read at the release itself: the song may have changed a moment ago,
      // before this component has heard of it.
      const st = usePlayerStore.getState();
      const same = !!d && st.index === d.index && st.queue[d.index + 1 + d.from]?.id === d.trackId;
      if (commit && d && same && d.over !== d.from) moveUpcoming(d.index + 1 + d.from, d.index + 1 + d.over);
      if (d?.moved) {
        swallowClick.current = true;
        // No click follows a release off every row: forget it then.
        setTimeout(() => {
          swallowClick.current = false;
        }, 0);
      }
    };
    const up = end(true);
    const cancel = end(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [dragging, moveUpcoming, scrollerRef]);

  const startDrag = (i: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || live.current) return;
    e.preventDefault();
    e.stopPropagation();
    const boxes = rows.current.slice(0, upcoming.length).map((el) => el?.getBoundingClientRect());
    const box = boxes[i];
    const el = rows.current[i];
    if (!box || !el) return;
    live.current = {
      from: i,
      pointerId: e.pointerId,
      trackId: upcoming[i].id,
      el,
      startY: e.clientY,
      startScroll: scrollerRef.current?.scrollTop ?? 0,
      mids: boxes.map((b) => (b ? b.top + b.height / 2 : 0)),
      fromTop: box.top,
      fromHeight: box.height,
      pointerY: e.clientY,
      over: i,
      moved: false,
      index,
    };
    setHeight(box.height);
    setDrag({ from: i, over: i });
  };

  const moveByKey = (i: number) => (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? upcoming.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (to < 0 || to >= upcoming.length || to === i) return;
    focusAt.current = to;
    moveUpcoming(index + 1 + i, index + 1 + to);
    setSaid(`${upcoming[i].title} moved to ${to + 1} of ${upcoming.length}`);
  };

  if (upcoming.length === 0) return null;

  return (
    <section data-testid="next-up">
      <div className="mb-cluster flex items-center justify-between gap-cluster pr-row">
        <div className={cn(labelClassName, 'mb-0')}>Next up · {upcoming.length}</div>
        <QueueHeaderActions count={upcoming.length} onClear={clearUpcoming} onShuffle={shuffleUpcoming} />
      </div>
      <div
        className="flex flex-col"
        onClickCapture={(e) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        {upcoming.map((t, i) => {
          const at = index + 1 + i;
          const lifted = drag?.from === i;
          const shift = drag ? shiftFor(i, drag, height) : 0;
          return (
            <div
              key={`${t.id}-${at}`}
              ref={(el) => {
                rows.current[i] = el;
              }}
              data-testid="next-up-row"
              data-dragging={lifted ? 'true' : undefined}
              className={cn(
                'relative rounded-md',
                lifted ? 'z-10 bg-sidebar-accent shadow-lg' : drag && 'transition-transform duration-150 motion-reduce:transition-none',
              )}
              // The lifted row's own transform is set by the drag itself.
              style={drag && !lifted ? { transform: `translateY(${shift}px)` } : undefined}
            >
              <TrackRow
                track={t}
                density="compact"
                tone="sidebar"
                showDuration
                // Greyed with its reason, not dropped: a song that could
                // not play stays where it was, and says why.
                unavailable={isUnavailable(t)}
                artworkFallback={null}
                artworkSrc={artworkSrcFor(t)}
                className={cn('gap-cluster pl-0 hover:bg-sidebar-accent/60', outOfReach(t) && 'opacity-50')}
                // A jump inside the queue, not a new queue: playTrack
                // would collapse a search-started queue to one song, turn
                // shuffle off and move the loop point.
                onPlay={() => playAt(at)}
                // A real Play button too: the row's own click is a
                // mouse-only handler on a div that Tab never reaches.
                trailingPlayControl
                leading={
                  <button
                    type="button"
                    ref={(el) => {
                      handles.current[i] = el;
                    }}
                    data-testid="queue-drag-handle"
                    aria-label={`Reorder ${t.title}`}
                    aria-describedby={hintId}
                    title="Drag to reorder"
                    onPointerDown={startDrag(i)}
                    onKeyDown={moveByKey(i)}
                    onClick={(e) => e.stopPropagation()}
                    className="grid h-hit w-6 shrink-0 cursor-grab touch-none select-none place-items-center rounded text-sidebar-foreground/40 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing md:h-8"
                  >
                    <GripIcon className="size-4" />
                  </button>
                }
                trailing={
                  <QueueRowMenu
                    track={t}
                    isNext={i === 0}
                    onPlayNext={() => playNextUpcoming(at)}
                    onRemove={() => {
                      // Focus would be lost with the row: the next one takes it.
                      focusAt.current = upcoming.length > 1 ? Math.min(i, upcoming.length - 2) : null;
                      removeUpcoming(at);
                    }}
                    onGoToArtist={onGoToArtist}
                  />
                }
              />
            </div>
          );
        })}
      </div>
      <span id={hintId} className="sr-only">
        Drag, or use the up and down arrow keys, to move the song in the queue.
      </span>
      <div role="status" aria-live="polite" className="sr-only">{said}</div>
    </section>
  );
}
