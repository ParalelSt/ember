import { cn } from '@/lib/utils';
import type { HomeFilter } from '@/lib/home';

export interface HomeChipsProps {
  chips: { id: HomeFilter; label: string }[];
  active: HomeFilter;
  onChange: (id: HomeFilter) => void;
  /** 'phone' (default): small pills stuck to the top while the page
   *  scrolls. 'desktop': bigger pills that scroll away with the page. */
  variant?: 'phone' | 'desktop';
}

/** Presentational only: the phone Home's filter pills (All, Playlists, and
 *  Mixes and Charts once those rows exist), the active one filled ember.
 *  They stay at the top while the page scrolls, and the row scrolls
 *  sideways if they ever outgrow the screen, starting on the page gutter. */
export function HomeChips({ chips, active, onChange, variant = 'phone' }: HomeChipsProps) {
  if (variant === 'desktop') {
    return (
      <div role="toolbar" aria-label="Filter Home" data-home-chips="desktop" className="mb-stack flex flex-wrap gap-cluster">
        {chips.map((c) => {
          const on = c.id === active;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(c.id)}
              className={cn(
                'whitespace-nowrap rounded-full px-block py-cluster text-sm font-semibold transition-colors',
                on ? 'bg-ember text-ember-foreground' : 'bg-foreground/10 text-foreground hover:bg-foreground/20',
              )}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div
      role="toolbar"
      aria-label="Filter Home"
      data-home-chips
      className="sticky top-0 z-10 -mx-page -mt-cluster mb-cluster flex gap-cluster overflow-x-auto bg-background px-page pt-cluster pb-row scrollbar-none"
    >
      {chips.map((c) => {
        const on = c.id === active;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(c.id)}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-full px-[14px] py-[7px] text-[13px] font-semibold transition-colors',
              on ? 'bg-ember text-ember-foreground' : 'bg-secondary text-foreground hover:bg-accent',
            )}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
