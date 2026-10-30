import { AddPersonIcon } from '@/components/icons';
import { FaceStack } from '@/components/library/FaceStack';
import type { PlaylistPerson } from '@/types/track';

export interface PeopleChipProps {
  /** Everyone on the playlist, the owner first. */
  people: Pick<PlaylistPerson, 'name' | 'avatarUrl'>[];
  onOpen: () => void;
}

/** Presentational only: the owner's people chip under a playlist's title
 *  (the owner's "Faces only" pick): the overlapping faces and a small round
 *  plus, no outline, pill or words. With nobody else yet, the plus alone.
 *  A tap opens the share sheet. The button is 44px tall and wide at least,
 *  phone sized, while only the faces and the plus are drawn. */
export function PeopleChip({ people, onOpen }: PeopleChipProps) {
  const alone = people.length <= 1;
  return (
    <button
      type="button"
      data-testid="people-chip"
      aria-label={alone ? 'Invite' : `${people.length} people, invite`}
      onClick={onOpen}
      className="inline-flex min-h-11 min-w-11 max-w-full items-center gap-cluster rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {!alone && <FaceStack people={people} max={4} className="size-7 text-xs" />}
      <span
        data-testid="people-chip-plus"
        className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-foreground"
      >
        <AddPersonIcon className="size-4" />
      </span>
    </button>
  );
}
