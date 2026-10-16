'use client';

import { useEffect, useRef, type TouchEvent } from 'react';
import Link from 'next/link';
import { ChevronLeftIcon } from '@/components/icons';
import { Eyebrow } from '@/components/page/Eyebrow';
import type { ChangelogEntry } from '@/lib/changelog';
import { SCOPE_LABEL } from '@/components/changelog/ChangelogPage';

const DOT_WINDOW = 7;
const SWIPE_MIN = 60;

/** Indexes of the dots to show: up to DOT_WINDOW around the current one. */
export function dotWindow(count: number, current: number, size = DOT_WINDOW): number[] {
  if (count <= size) return Array.from({ length: count }, (_, i) => i);
  const start = Math.min(Math.max(current - Math.floor(size / 2), 0), count - size);
  return Array.from({ length: size }, (_, i) => start + i);
}

const isCoarse = () => typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);

/** True when the touch began inside something that scrolls sideways. */
function inHorizontalScroller(start: EventTarget | null, stop: HTMLElement | null): boolean {
  let el = start instanceof HTMLElement ? start : null;
  while (el && el !== stop) {
    const ox = getComputedStyle(el).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth) return true;
    el = el.parentElement;
  }
  return false;
}

interface Props {
  /** undefined for an unknown id. */
  entry: ChangelogEntry | undefined;
  /** Every entry, newest first, for the dots and neighbour navigation. */
  entries?: ChangelogEntry[];
  /** Go to another entry (the page uses router.replace). */
  onGo?: (id: string) => void;
  /** "Got it": mark read and return to the list. */
  onGotIt?: () => void;
}

/** One full changelog entry: sticky back bar, bullets, swipe/arrow-key and dot
 *  navigation, and a "Got it" card. */
export function ChangelogEntryPage({ entry, entries = [], onGo, onGotIt }: Props) {
  const index = entry ? entries.findIndex((e) => e.id === entry.id) : -1;
  const newer = index > 0 ? entries[index - 1] : undefined;
  const older = index >= 0 ? entries[index + 1] : undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number; skip: boolean } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const to = e.key === 'ArrowLeft' ? newer : e.key === 'ArrowRight' ? older : undefined;
      if (to) onGo?.(to.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newer, older, onGo]);

  const onTouchStart = (e: TouchEvent) => {
    const p = e.touches[0];
    if (!p) return;
    touch.current = { x: p.clientX, y: p.clientY, skip: inHorizontalScroller(e.target, rootRef.current) };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    const p = e.changedTouches[0];
    if (!s || s.skip || !p) return;
    const dx = p.clientX - s.x;
    const dy = p.clientY - s.y;
    if (Math.abs(dx) <= SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return;
    const to = dx < 0 ? older : newer;
    if (to) onGo?.(to.id);
  };

  const back = (
    <Link
      href="/whats-new"
      aria-label="Back to What's new"
      data-testid="changelog-back"
      className="inline-flex size-hit items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground md:size-8"
    >
      <ChevronLeftIcon className="h-5 w-5" />
    </Link>
  );

  if (!entry) {
    return (
      <div data-testid="changelog-entry-page" className="max-w-2xl">
        {back}
        <p data-testid="changelog-missing" className="text-muted-foreground">
          That update could not be found. It may be from an older version.
        </p>
      </div>
    );
  }

  const dots = dotWindow(entries.length, index);

  return (
    <div
      ref={rootRef}
      data-testid="changelog-entry-page"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="max-w-2xl"
    >
      <div
        data-testid="changelog-bar"
        className="sticky top-0 z-10 -mx-page flex items-center gap-cluster border-b border-border bg-background/90 px-row py-inset backdrop-blur-md md:-mx-page-lg md:px-page-lg"
      >
        {back}
        <b className="flex-1 text-sm font-semibold">What&apos;s new</b>
        <span data-testid="changelog-version" className="rounded-full bg-ember px-cluster py-inset text-xs font-bold text-ember-foreground">
          {entry.version}
        </span>
      </div>

      <Eyebrow className="mt-stack">{[entry.date, entry.scope && SCOPE_LABEL[entry.scope]].filter(Boolean).join(' · ')}</Eyebrow>
      <h1 className="mt-inset text-2xl font-bold leading-tight tracking-tight md:text-3xl">{entry.title}</h1>
      <p className="mt-cluster max-w-prose text-muted-foreground">{entry.summary}</p>

      <ul className="mt-stack flex list-disc flex-col gap-row pl-stack text-muted-foreground marker:text-muted-foreground/50">
        {entry.bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>

      <div
        data-testid="changelog-gotit"
        className="mt-stack flex items-center gap-row rounded-2xl border border-border bg-card p-row"
      >
        <p className="flex-1 text-sm text-muted-foreground">Seen everything in this update?</p>
        <button
          type="button"
          onClick={() => onGotIt?.()}
          className="min-h-hit rounded-full bg-ember px-block font-bold text-ember-foreground"
        >
          Got it
        </button>
      </div>

      {entries.length > 1 && (
        <div data-testid="changelog-nav" className="mt-section text-center text-xs text-muted-foreground">
          <div className="mb-cluster flex items-center justify-center">
            {dots.map((i) => {
              const on = i === index;
              return (
                <button
                  key={entries[i].id}
                  type="button"
                  aria-label={`Go to ${entries[i].version} ${entries[i].title}`}
                  aria-current={on ? 'true' : undefined}
                  data-testid="changelog-dot"
                  data-current={on ? 'true' : 'false'}
                  onClick={() => !on && onGo?.(entries[i].id)}
                  className="flex h-6 items-center px-inset"
                >
                  <i className={`block h-2 rounded-full motion-safe:transition-all ${on ? 'w-4.5 bg-ember' : 'w-2 bg-muted-foreground/40'}`} />
                </button>
              );
            })}
          </div>
          <p>{isCoarse() ? 'Swipe for newer or older' : 'Use the left and right arrow keys'}</p>
        </div>
      )}
    </div>
  );
}
