import Link from 'next/link';
import { cn } from '@/lib/utils';
import { fullTitleOf, KIND_LABEL, type MixKind } from '@/lib/mixes/kinds';

export interface MixCardProps {
  /** "Rock & Metal", "Gojira", "New to you": the card adds its own label. */
  title: string;
  /** "Linkin Park, System Of A Down, Deftones and more", under the card. */
  subtitle: string;
  href: string;
  /** Up to three covers, the first one in front. */
  artworkUrls: readonly string[];
  /** The card's light colour and the text on it (lib/mixes/kinds kindLook). */
  color: string;
  ink: string;
  /** Which kind of mix: its label and how the covers sit. Style by default. */
  kind?: MixKind;
  variant?: 'phone' | 'desktop';
}

/** Where each cover sits, per kind. The first is always the one in front.
 *  - style: three round artist faces, the top artist big in the middle;
 *  - artist: the artist big and round, two similar artists small in front
 *    of its lower edge;
 *  - discover: three square covers fanned out like new records;
 *  - on repeat: three square covers stacked, the most played on top;
 *  - throwback: the style faces, faded to sepia. */
const FACES: Record<MixKind, readonly string[]> = {
  style: [
    'left-1/2 top-[22%] z-10 size-[46%] -translate-x-1/2 rounded-full',
    'left-[8%] top-[30%] size-[36%] rounded-full',
    'right-[8%] top-[30%] size-[36%] rounded-full',
  ],
  artist: [
    'left-1/2 top-[12%] size-[56%] -translate-x-1/2 rounded-full',
    'left-[12%] top-[46%] z-10 size-[24%] rounded-full',
    'right-[12%] top-[46%] z-10 size-[24%] rounded-full',
  ],
  discover: [
    'left-1/2 top-[18%] z-10 size-[44%] -translate-x-1/2 rounded-[6px]',
    'left-[9%] top-[26%] size-[36%] -rotate-6 rounded-[6px]',
    'right-[9%] top-[26%] size-[36%] rotate-6 rounded-[6px]',
  ],
  'on-repeat': [
    'left-[40%] top-[26%] z-20 size-[42%] rounded-[6px]',
    'left-[28%] top-[19%] z-10 size-[42%] rounded-[6px]',
    'left-[16%] top-[12%] size-[42%] rounded-[6px]',
  ],
  throwback: [
    'left-1/2 top-[22%] z-10 size-[46%] -translate-x-1/2 rounded-full sepia',
    'left-[8%] top-[30%] size-[36%] rounded-full sepia',
    'right-[8%] top-[30%] size-[36%] rounded-full sepia',
  ],
};

/** Presentational only: one mix on Home, the owner's "Spotify Radio card"
 *  pick. A light card in the mix's colour with a small label top right
 *  (MIX, ARTIST MIX, DISCOVER, ON REPEAT, THROWBACK), up to three covers
 *  laid out by kind (each ringed in the card colour) and the mix's name big
 *  and bold bottom left; the artists in muted text under the card. */
export function MixCard({ title, subtitle, href, artworkUrls, color, ink, kind = 'style', variant = 'phone' }: MixCardProps) {
  const faces = artworkUrls.slice(0, 3);
  const spots = FACES[kind] ?? FACES.style;
  return (
    <Link href={href} aria-label={fullTitleOf(kind, title)} data-mix-card data-mix-kind={kind} className="group block min-w-0">
      <div
        className="relative aspect-square overflow-hidden rounded-[8px] transition-transform group-active:scale-[0.98]"
        style={{ backgroundColor: color, color: ink }}
      >
        <span data-mix-label className="absolute top-row right-row text-[10px] font-bold tracking-[0.12em] opacity-80">{KIND_LABEL[kind] ?? KIND_LABEL.style}</span>
        {faces.map((url, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${i}-${url}`}
            src={url}
            alt=""
            loading="lazy"
            data-mix-face
            className={cn('absolute object-cover', spots[i])}
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
