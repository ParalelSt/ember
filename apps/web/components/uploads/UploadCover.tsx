import { MusicIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

/** An upload's cover, or a note on the art colour when it has none. */
export function UploadCover({ src, className }: { src: string | null; className?: string }) {
  return (
    <span
      data-upload-cover
      className={cn('relative grid shrink-0 place-items-center overflow-hidden rounded-md bg-art text-muted-foreground', className)}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <MusicIcon className="size-1/3" />
      )}
    </span>
  );
}
