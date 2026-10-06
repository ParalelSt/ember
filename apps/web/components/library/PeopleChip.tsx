import { AddPersonIcon } from '@/components/icons';
import { FaceStack } from '@/components/library/FaceStack';
import type { PlaylistPerson } from '@/types/track';

export interface PeopleChipProps {
  /** Everyone on the playlist, the owner first. */
  people: Pick<PlaylistPerson, 'name' | 'avatarUrl'>[];
  onOpen: () => void;
}

/** Presentational only: the owner's people chip under a playlist's title.
 *  The faces of everyone on it and "Invite"; "+ Invite" while it is only
 *  the owner. A tap opens the share sheet. */
export function PeopleChip({ people, onOpen }: PeopleChipProps) {
  const alone = people.length <= 1;
  return (
    <button
      type="button"
      data-testid="people-chip"
      onClick={onOpen}
      className="inline-flex h-9 max-w-full items-center gap-cluster rounded-full border border-border bg-card/60 py-inset pr-row pl-inset text-sm transition-colors hover:bg-card"
    >
      <FaceStack people={people} max={4} className="size-7 text-xs" />
      {alone ? (
        <span className="flex items-center gap-inset font-medium">
          <AddPersonIcon className="size-4" /> Invite
        </span>
      ) : (
        <span className="truncate font-medium">
          {people.length} people <span className="text-muted-foreground">· Invite</span>
        </span>
      )}
    </button>
  );
}
