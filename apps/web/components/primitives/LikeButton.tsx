import { Button } from '@/components/ui/button';
import { HeartIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

export type LikeButtonSize = 'sm' | 'md';

const BOX: Record<LikeButtonSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
};

const ICON: Record<LikeButtonSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
};

export interface LikeButtonProps {
  liked: boolean;
  onToggle: () => void;
  size?: LikeButtonSize;
  className?: string;
}

/** Presentational only: the heart toggle. Which track counts as "liked"
 *  (the variant rule) stays with the caller. */
export function LikeButton({ liked, onToggle, size = 'sm', className }: LikeButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        BOX[size],
        'text-muted-foreground hover:text-foreground',
        liked && 'text-ember hover:text-ember',
        className,
      )}
      onClick={onToggle}
      aria-pressed={liked}
      aria-label={liked ? 'Unlike' : 'Like'}
    >
      <HeartIcon className={ICON[size]} fill={liked ? 'currentColor' : 'none'} />
    </Button>
  );
}
