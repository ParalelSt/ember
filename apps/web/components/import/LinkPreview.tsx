import { Artwork } from '@/components/primitives/Artwork';
import { AlertIcon, MusicIcon } from '@/components/icons';
import { SourceBadge } from '@/components/import/parts';
import { SPOTIFY_EMBED_LIMIT } from '@/lib/import/embed';
import { formatCount } from '@/lib/format';
import type { ImportSourceKind } from '@/lib/import/types';

export interface LinkPreviewProps {
  kind: ImportSourceKind;
  name: string;
  coverUrl: string | null;
  count: number;
  /** Spotify listed its 100-song maximum, so the playlist may be longer. */
  truncated: boolean;
}

/** What the pasted link points at: cover, name, song count, source, and
 *  the 100-song note when Spotify may have cut the playlist short. */
export function LinkPreview({ kind, name, coverUrl, count, truncated }: LinkPreviewProps) {
  return (
    <div data-testid="link-preview" className="flex flex-col gap-row rounded-lg border border-border bg-card p-row">
      <div className="flex items-start gap-block md:items-center">
        <Artwork
          src={coverUrl}
          className="grid size-20 shrink-0 place-items-center rounded-md bg-black text-foreground/20 shadow-soft md:size-24"
        >
          <MusicIcon className="h-6 w-6" />
        </Artwork>
        <div className="min-w-0 flex-1">
          <SourceBadge kind={kind} />
          <div className="mt-cluster truncate text-lg font-bold tracking-tight">{name}</div>
          <div className="text-meta">{formatCount(count, 'song')}</div>
        </div>
      </div>
      {truncated && (
        <div data-testid="first-100-note" className="flex items-start gap-cluster rounded-md bg-muted/60 px-row py-cluster text-xs text-muted-foreground">
          <AlertIcon className="h-3.5 w-3.5 shrink-0 translate-y-px text-ember" />
          <span>
            <span className="font-medium text-foreground">First {SPOTIFY_EMBED_LIMIT} songs.</span> Spotify only shares the
            first {SPOTIFY_EMBED_LIMIT} songs of a playlist through a link, so any after that stay behind.
          </span>
        </div>
      )}
    </div>
  );
}
