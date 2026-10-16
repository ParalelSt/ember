import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface MixCardProps {
  /** "Rock & Metal": the card says MIX on its own. */
  title: string;
  /** "Linkin Park, System Of A Down, Deftones and more", under the card. */
  subtitle: string;
  href: string;
  /** Up to three artist pictures, the first one in the middle. */
  artworkUrls: readonly string[];
  /** The card's light colour and the text on it (lib/genres/taxonomy). */
  color: string;
  ink: string;
  variant?: 'phone' | 'desktop';
}

/** Where each face sits: the first (the member's top artist) in the middle,
 *  larger and in front, the next two behind it to the left and right. */
const FACES = [
  'left-1/2 top-[22%] z-10 size-[46%] -translate-x-1/2',
  'left-[8%] top-[30%] size-[36%]',
  'right-[8%] top-[30%] size-[36%]',
] as const;

/** Presentational only: one genre mix on Home, the owner's "Spotify Radio
 *  card" pick. A light card in the mix's colour with a small MIX label top
 *  right, three overlapping round artist pictures (each ringed in the card
 *  colour) and the mix's name big and bold bottom left; the artists in
 *  muted text under the card. */
export function MixCard({ title, subtitle, href, artworkUrls, color, ink, variant = 'phone' }: MixCardProps) {
  const faces = artworkUrls.slice(0, 3);
  return (
    <Link href={href} aria-label={`${title} Mix`} data-mix-card className="group block min-w-0">
      <div
        className="relative aspect-square overflow-hidden rounded-[8px] transition-transform group-active:scale-[0.98]"
        style={{ backgroundColor: color, color: ink }}
      >
        <span className="absolute top-row right-row text-[10px] font-bold tracking-[0.12em] opacity-80">MIX</span>
        {faces.map((url, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${i}-${url}`}
            src={url}
            alt=""
            loading="lazy"
            data-mix-face
            className={cn('absolute rounded-full object-cover', FACES[i])}
            style={{ boxShadow: `0 0 0 3px ${color}` }}
          />
        ))}
        <span
          className={cn(
            'absolute right-row bottom-row left-row line-clamp-2 break-words font-extrabold leading-none tracking-tight',
            variant === 'desktop' ? 'text-2xl' : 'text-[22px]',
          )}
        >
          {title}
        </span>
      </div>
      <div className="mt-cluster line-clamp-2 break-words text-[13px] leading-snug text-muted-foreground">{subtitle}</div>
    </Link>
  );
}
