'use client';

import { useCoverColor } from '@/hooks/useCoverColor';
import { LIBRARY_BADGES, LIKED_GRADIENT, NEUTRAL_COVER } from '@/components/library/libraryIcons';
import type { CollectionCoverProps } from '@/components/primitives/CollectionCover';
import { readableArtUrl } from '@/lib/artProxy';

/** The desktop header's soft band in the cover's own color: it runs to the
 *  content column's edges and a gutter above the header, then fades out by
 *  the header's bottom edge, so it never tints the Play row below. */
export function CoverColorBand({ cover }: { cover: CollectionCoverProps }) {
  const fallback = cover.icon === 'heart' ? LIKED_GRADIENT.from
    : cover.icon === 'clock' ? LIBRARY_BADGES.recent.tile.match(/#[0-9a-f]{6}/i)?.[0]
    : cover.icon === 'upload' ? LIBRARY_BADGES.uploads.tile.match(/#[0-9a-f]{6}/i)?.[0]
    : NEUTRAL_COVER.background;
  const image = cover.icon ? null : cover.mosaic && cover.mosaic.length >= 4 ? cover.mosaic[0] : cover.src;
  const color = useCoverColor(image ? readableArtUrl(image) : null, fallback);
  return <div
    data-testid="cover-color-band"
    aria-hidden="true"
    className="pointer-events-none absolute -inset-x-page-lg -top-page-lg bottom-0 -z-10 hidden md:block"
    style={{ background: `linear-gradient(to bottom, ${color}, transparent)` }}
  />;
}
