import Link from 'next/link';
import type { ReactNode } from 'react';
import { PinIcon } from '@/components/icons';
import { LibraryCover } from '@/components/library/LibraryCover';
import type { LibraryItem } from '@/lib/library';
import { DOWNLOADED_MARK } from '@/lib/libraryIcons';
import { cn } from '@/lib/utils';

export interface LibraryItemRowProps {
  item: LibraryItem;
  /** 'row' (default): the 56px list row. 'tile': the two-column grid's big cover. */
  variant?: 'row' | 'tile';
  /** The row was tapped. On the Downloaded row (no href) this is its action. */
  onActivate?: (item: LibraryItem) => void;
}

/** The small green "downloaded" circle with its arrow. */
function DownloadedMark() {
  const Icon = DOWNLOADED_MARK.icon;
  return (
    <span
      role="img"
      aria-label="Downloaded"
      data-downloaded-mark
      className="grid size-[14px] shrink-0 place-items-center rounded-full"
      style={{ background: DOWNLOADED_MARK.color, color: DOWNLOADED_MARK.foreground }}
    >
      <Icon aria-hidden className="size-[10px]" strokeWidth={3.2} />
    </span>
  );
}

/** The marks before the subtitle: pinned, then downloaded. */
function Subtitle({ item, className }: { item: LibraryItem; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-[5px] text-muted-foreground', className)}>
      {item.pinned && <PinIcon aria-label="Pinned" data-pinned-mark className="size-[14px] shrink-0 rotate-45 fill-current text-ember" />}
      {item.downloaded && <DownloadedMark />}
      <span className="min-w-0 truncate">{item.subtitle}</span>
    </div>
  );
}

function Activator({ item, onActivate, className, children }: { item: LibraryItem; onActivate?: LibraryItemRowProps['onActivate']; className: string; children: ReactNode }) {
  if (item.href) {
    return (
      <Link href={item.href} onClick={() => onActivate?.(item)} data-library-item={item.key} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => onActivate?.(item)} data-library-item={item.key} className={cn(className, 'w-full text-left')}>
      {children}
    </button>
  );
}

/** Presentational only: one phone Library item, as the owner's "r56" row
 *  (56px art, a one-line title, "Playlist · 23 songs" with its marks) or as
 *  a grid tile with the same words under a big cover. */
export function LibraryItemRow({ item, variant = 'row', onActivate }: LibraryItemRowProps) {
  if (variant === 'tile') {
    return (
      <Activator item={item} onActivate={onActivate} className="block min-w-0">
        <LibraryCover cover={item.cover} className="w-full rounded-[8px]" />
        <div className="mt-cluster truncate text-sm font-bold leading-[1.3]">{item.title}</div>
        <Subtitle item={item} className="mt-[2px] text-[12.5px] leading-[1.35]" />
      </Activator>
    );
  }
  return (
    <Activator item={item} onActivate={onActivate} className="flex min-w-0 items-center gap-row py-[6px]">
      <LibraryCover cover={item.cover} className="size-14 shrink-0 rounded-[6px]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold leading-[1.3]">{item.title}</div>
        <Subtitle item={item} className="mt-[1px] text-[13px] leading-[1.35]" />
      </div>
    </Activator>
  );
}
