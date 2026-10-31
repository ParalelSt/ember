import { Artwork } from '@/components/primitives/Artwork';
import { AlertIcon, MusicIcon } from '@/components/icons';
import { SPOTIFY_EMBED_LIMIT } from '@/lib/import/embed';
import { formatCount } from '@/lib/format';

export interface LinkPreviewProps {
  name: string;
  coverUrl: string | null;
  count: number;
  /** Spotify listed its 100-song maximum, so the playlist may be longer. */
  truncated: boolean;
}

/** What the pasted link points at, big and centred: the cover, the name, the
 *  song count and how long it takes, plus the 100-song note when Spotify may
 *  have cut the playlist short. */
export function LinkPreview({ name, coverUrl, count, truncated }: LinkPreviewProps) {
  return (
    <div data-testid="link-preview" className="flex flex-col items-center gap-row text-center">
      <Artwork
        src={coverUrl}
        className="grid size-art-hero-sm shrink-0 place-items-center rounded-xl bg-art text-foreground/20 shadow-soft md:size-art-hero"
      >
        <MusicIcon className="size-12" />
      </Artwork>
      <div className="flex w-full min-w-0 flex-col gap-inset">
        <div className="line-clamp-2 break-words text-lg font-bold tracking-tight">{name}</div>
        <div className="text-meta">{formatCount(count, 'song')}</div>
        <div data-testid="link-preview-note" className="text-xs text-muted-foreground">
          Fills in over a few minutes
        </div>
      </div>
      {truncated && (
        <div data-testid="first-100-note" className="flex w-full items-start gap-cluster rounded-md bg-muted/60 px-row py-cluster text-left text-xs text-muted-foreground">
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
