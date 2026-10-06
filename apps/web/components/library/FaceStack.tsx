import { Avatar } from '@/components/primitives/Avatar';
import { cn } from '@/lib/utils';
import type { PlaylistPerson } from '@/types/track';

export interface FaceStackProps {
  people: Pick<PlaylistPerson, 'name' | 'avatarUrl'>[];
  /** Faces shown; the rest become a "+N" circle. */
  max?: number;
  /** Everyone, when `people` is only the first few (the invite preview). */
  total?: number;
  /** Size and text classes for every circle. */
  className?: string;
}

/** Presentational only: a row of overlapping faces (picture or initial),
 *  for the people chip, the "Shared by" badge and the invite card. */
export function FaceStack({ people, max = 3, total, className = 'size-7 text-xs' }: FaceStackProps) {
  const shown = people.slice(0, max);
  const extra = (total ?? people.length) - shown.length;
  return (
    <span data-testid="face-stack" className="flex shrink-0 items-center" aria-hidden>
      {shown.map((p, i) => (
        <Avatar
          key={i}
          src={p.avatarUrl}
          name={p.name}
          className={cn('bg-ember text-ember-foreground ring-2 ring-background', i > 0 && '-ml-2', className)}
        />
      ))}
      {extra > 0 && (
        <span
          className={cn(
            'relative -ml-2 grid shrink-0 place-items-center rounded-full bg-muted font-semibold text-foreground ring-2 ring-background',
            className,
          )}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
