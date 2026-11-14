import Link from 'next/link';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons';
import { PageTitle } from '@/components/page/PageTitle';
import { cn } from '@/lib/utils';
import { Eyebrow } from '@/components/page/Eyebrow';
import type { ChangelogEntry, ChangelogScope } from '@/lib/changelog';
import { NewBadge } from '@/components/changelog/NewBadge';
import { HideTagsSwitch } from '@/components/changelog/HideTagsSwitch';

export interface ChangelogPageProps {
  entries: ChangelogEntry[];
  /** Ids that currently carry a New tag (already empty when tags are hidden
   *  or everything was marked read). */
  newIds: ReadonlySet<string>;
  hideTags: boolean;
  onHideTagsChange: (hide: boolean) => void;
  onMarkAllRead: () => void;
  /** 1-based page of CHANGELOG_PAGE_SIZE entries (the URL's ?page=). */
  page?: number;
}

export const SCOPE_LABEL: Record<ChangelogScope, string> = {
  desktop: 'Desktop app',
  android: 'Android app',
  ios: 'iPhone app',
  windows: 'Windows app',
  macos: 'Mac app',
  linux: 'Linux app',
};

export const entryHref = (id: string) => `/whats-new/${encodeURIComponent(id)}`;

/** Entries per page of the list, newest first. */
export const CHANGELOG_PAGE_SIZE = 10;
/** How many page numbers the pager shows at once, around the current one. */
const PAGE_WINDOW = 7;

export const pageCount = (entries: number) => Math.max(1, Math.ceil(entries / CHANGELOG_PAGE_SIZE));

/** The URL's ?page= as a page that exists: 1 for anything missing or
 *  unreadable, the last page for one past the end. */
export function clampPage(raw: string | null | undefined, entries: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, pageCount(entries));
}

/** The list's URL at a page; page 1 is the plain /whats-new. */
export const whatsNewHref = (page: number) => (page > 1 ? `/whats-new?page=${page}` : '/whats-new');

/** The page of the list an entry is on (1 for an unknown one). */
export function pageOfEntry(entries: readonly ChangelogEntry[], id: string | undefined): number {
  const index = id ? entries.findIndex((e) => e.id === id) : -1;
  return index < 0 ? 1 : Math.floor(index / CHANGELOG_PAGE_SIZE) + 1;
}

/** Page numbers to show: up to PAGE_WINDOW around the current one. */
function pageWindow(count: number, current: number): number[] {
  const size = Math.min(count, PAGE_WINDOW);
  const start = Math.min(Math.max(current - Math.floor(size / 2), 1), count - size + 1);
  return Array.from({ length: size }, (_, i) => start + i);
}

// The Library and Home filter chips: ember when on, soft grey otherwise.
const CHIP = 'inline-flex min-h-hit min-w-hit items-center justify-center gap-inset rounded-full px-row text-sm font-semibold tabular-nums transition-colors';
const CHIP_ON = 'bg-ember text-ember-foreground';
const CHIP_OFF = 'bg-secondary text-foreground hover:bg-accent';
const CHIP_DISABLED = 'bg-secondary text-muted-foreground opacity-40';

/** Previous, the page numbers and Next, as the app's filter chips. A page
 *  holding an entry with a New tag gets a small ember dot. */
function Pager({ page, count, newPages }: { page: number; count: number; newPages: ReadonlySet<number> }) {
  const step = (to: number, label: string, icon: 'prev' | 'next') => {
    const content =
      icon === 'prev' ? (
        <>
          <ChevronLeftIcon className="size-4" />
          {label}
        </>
      ) : (
        <>
          {label}
          <ChevronRightIcon className="size-4" />
        </>
      );
    return to < 1 || to > count ? (
      <span aria-disabled="true" className={cn(CHIP, CHIP_DISABLED)}>
        {content}
      </span>
    ) : (
      <Link href={whatsNewHref(to)} rel={icon} className={cn(CHIP, CHIP_OFF)}>
        {content}
      </Link>
    );
  };
  return (
    <nav aria-label="What's new pages" data-testid="changelog-pager" className="mt-stack flex flex-wrap items-center justify-center gap-cluster">
      {step(page - 1, 'Previous', 'prev')}
      {pageWindow(count, page).map((n) => {
        const on = n === page;
        const hasNew = newPages.has(n);
        return (
          <Link
            key={n}
            href={whatsNewHref(n)}
            aria-current={on ? 'page' : undefined}
            aria-label={`Page ${n}${hasNew ? ', has new updates' : ''}`}
            className={cn(CHIP, 'relative px-cluster', on ? CHIP_ON : CHIP_OFF)}
          >
            {n}
            {hasNew && !on && (
              <span aria-hidden data-testid="page-new-dot" className="absolute right-inset top-inset size-1.5 rounded-full bg-ember" />
            )}
          </Link>
        );
      })}
      {step(page + 1, 'Next', 'next')}
    </nav>
  );
}

/** Presentational only: the "What's new" list. Compact cards (version and
 *  date, title, one-line summary); each whole card links to its own page,
 *  which marks the entry read. Mark all as read sits on the title row and
 *  the persistent switch right under it. Ten entries a page, with a pager
 *  under them (the page is in the URL, ?page=2). */
export function ChangelogPage({ entries, newIds, hideTags, onHideTagsChange, onMarkAllRead, page = 1 }: ChangelogPageProps) {
  const count = pageCount(entries.length);
  const current = Math.min(Math.max(page, 1), count);
  const shown = entries.slice((current - 1) * CHANGELOG_PAGE_SIZE, current * CHANGELOG_PAGE_SIZE);
  const newPages = new Set(entries.flatMap((e, i) => (newIds.has(e.id) ? [Math.floor(i / CHANGELOG_PAGE_SIZE) + 1] : [])));
  return (
    <div data-testid="changelog-page" className="max-w-xl">
      <div className="flex items-baseline justify-between gap-block">
        <PageTitle>What&apos;s new</PageTitle>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={newIds.size === 0}
          className="shrink-0 text-sm font-medium text-ember transition-opacity disabled:cursor-default disabled:opacity-40"
        >
          Mark all as read
        </button>
      </div>
      <HideTagsSwitch checked={hideTags} onCheckedChange={onHideTagsChange} className="mt-row" />

      <div className="mt-stack flex flex-col gap-row">
        {shown.map((e) => (
          <Link
            key={e.id}
            href={entryHref(e.id)}
            data-testid="changelog-entry"
            data-entry-id={e.id}
            className="block rounded-2xl bg-card p-block shadow-soft transition-colors hover:bg-card/80"
          >
            <div className="flex items-center justify-between gap-row">
              <Eyebrow>{[e.version, e.date].join(' · ')}</Eyebrow>
              {newIds.has(e.id) && <NewBadge />}
            </div>
            <div className="mt-inset truncate font-semibold">{e.title}</div>
            <p className="truncate text-sm text-muted-foreground">{e.summary}</p>
          </Link>
        ))}
      </div>
      {count > 1 && <Pager page={current} count={count} newPages={newPages} />}
    </div>
  );
}
