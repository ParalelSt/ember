import { Button } from '@/components/ui/button';
import { Artwork } from '@/components/primitives/Artwork';
import { CollectionCover } from '@/components/primitives/CollectionCover';
import { Eyebrow } from '@/components/page/Eyebrow';
import { FaceStack } from '@/components/library/FaceStack';
import { formatCount } from '@/lib/format';
import type { InvitePreview } from '@/lib/collab';

export interface InvitePreviewCardProps {
  preview: InvitePreview;
  busy: boolean;
  onJoin: () => void;
  onDecline: () => void;
}

/** "Olga", "Olga and Marko", "Olga, Marko and 5 more". */
export function peopleLine(names: string[], total: number): string {
  if (total <= 1 || names.length <= 1) return names[0] ?? '';
  if (total === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${total - 2} more`;
}

/** Presentational only: what an invite link leads to, before joining. The
 *  cover, whose it is, who is on it, the first songs, and Not now / Join. */
export function InvitePreviewCard({ preview, busy, onJoin, onDecline }: InvitePreviewCardProps) {
  const more = preview.songCount - preview.songs.length;
  return (
    <div data-testid="invite-preview" className="mx-auto flex max-w-sm flex-col items-center gap-stack py-section text-center">
      <CollectionCover src={preview.artworkUrl} icon={null} className="size-art-hero rounded-2xl" />
      <div className="flex flex-col items-center gap-cluster">
        <Eyebrow>{preview.owner.name} invited you to edit</Eyebrow>
        <h1 className="text-3xl font-bold tracking-tight break-words">{preview.name}</h1>
        <div className="flex items-center justify-center gap-cluster text-sm text-muted-foreground">
          <FaceStack people={preview.people} total={preview.peopleCount} className="size-5 text-[10px]" />
          <span>
            {formatCount(preview.songCount, 'song')} · {peopleLine(preview.people.map((p) => p.name), preview.peopleCount)}
          </span>
        </div>
      </div>
      {preview.songs.length > 0 && (
        <div className="flex w-full flex-col gap-inset rounded-lg border border-border p-cluster text-left">
          {preview.songs.map((s, i) => (
            <div key={i} data-testid="invite-song" className="flex min-h-12 items-center gap-row px-cluster">
              <Artwork src={s.artworkUrl} size="xs" className="shrink-0 rounded bg-art" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.title}</div>
                <div className="truncate text-xs text-muted-foreground">{s.artist}</div>
              </div>
            </div>
          ))}
          {more > 0 && <div className="px-cluster pb-inset text-xs text-muted-foreground">and {more} more</div>}
        </div>
      )}
      <p className="text-xs text-muted-foreground">You can add, remove and reorder songs. You can leave any time.</p>
      <div className="grid w-full grid-cols-2 gap-cluster">
        <Button variant="outline" className="h-10" disabled={busy} onClick={onDecline}>
          Not now
        </Button>
        <Button variant="ember" className="h-10" disabled={busy} onClick={onJoin}>
          Join
        </Button>
      </div>
    </div>
  );
}
