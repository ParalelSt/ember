import Link from 'next/link';
import { Button } from '@/components/ui/button';

export interface LibraryEmptyCardProps {
  onCreate: () => void;
  /** Where "Import from Spotify or YouTube" goes: the Transfer page. */
  importHref: string;
}

const LEFT_BARS = [8, 14, 22, 30, 22, 14, 8];
const RIGHT_BARS = [10, 22, 16, 30, 12, 26, 14];

/** Two tilted mini covers made of sound bars, a + on the second. Theme tokens only. */
function Illustration() {
  return (
    <svg viewBox="0 0 120 70" width="132" height="77" aria-hidden data-empty-art>
      <g transform="translate(14 14) rotate(-10 30 30)">
        <rect width="56" height="56" rx="10" className="fill-secondary" />
        {LEFT_BARS.map((h, i) => (
          <rect key={i} x={9 + i * 5.6} y={28 - h / 2} width="3.4" height={h} rx="1.7" className="fill-ember" />
        ))}
      </g>
      <g transform="translate(52 6) rotate(8 30 30)">
        <rect width="56" height="56" rx="10" className="fill-accent" />
        {RIGHT_BARS.map((h, i) => (
          <rect key={i} x={9 + i * 5.6} y={28 - h / 2} width="3.4" height={h} rx="1.7" className="fill-muted-foreground" />
        ))}
        <circle cx="52" cy="52" r="13" className="fill-ember" />
        <path d="M52 46v12M46 52h12" strokeWidth="3.4" strokeLinecap="round" className="stroke-ember-foreground" />
      </g>
    </svg>
  );
}

/** Presentational only: the phone Library with no playlists yet (the
 *  owner's "Friendly card" pick). */
export function LibraryEmptyCard({ onCreate, importHref }: LibraryEmptyCardProps) {
  return (
    <section
      data-library-empty
      aria-labelledby="library-empty-title"
      className="mt-row flex flex-col items-center gap-cluster rounded-[18px] border border-border bg-card px-[18px] py-[20px] text-center"
    >
      <Illustration />
      <h2 id="library-empty-title" className="mt-[6px] text-[19px] font-extrabold tracking-[-0.02em]">
        Create your first playlist
      </h2>
      <p className="max-w-[260px] text-[13.5px] leading-[1.45] text-muted-foreground">
        Collect songs you love in one place. Add from search, your likes or the player.
      </p>
      <Button variant="ember" onClick={onCreate} className="mt-cluster h-auto rounded-full px-[22px] py-[11px] text-sm font-bold">
        Create playlist
      </Button>
      <Link href={importHref} className="p-cluster text-[13px] font-semibold text-muted-foreground underline">
        Import from Spotify or YouTube
      </Link>
    </section>
  );
}
