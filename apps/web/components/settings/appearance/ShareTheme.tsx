import { cn } from '@/lib/utils';

export type ShareTarget =
  | { kind: 'mine'; name: string; shared: boolean }
  | { kind: 'preset'; name: string }
  | { kind: 'others'; name: string; owner: string }
  | { kind: 'loose'; name: string };

/** The Share tab: "Share with everyone" for one of my themes, with a plain
 *  line about who sees it. Off (and explained) for a preset, for someone
 *  else's theme and for a theme not saved to my list. */
export function ShareTheme({
  target,
  busy,
  onChange,
}: {
  target: ShareTarget;
  busy?: boolean;
  onChange: (shared: boolean) => void;
}) {
  const checked = target.kind === 'mine' && target.shared;
  const enabled = target.kind === 'mine' && !busy;

  let line: string;
  switch (target.kind) {
    case 'mine':
      line = target.shared
        ? `Everyone on this Ember server sees ${target.name} under Shared by others, labelled with your name. They can use it or copy it; only you can change it. Turning this off hides it again, and anyone using it keeps its colours.`
        : `Only you see ${target.name}. Turn this on and everyone on this Ember server can use it or copy it, labelled with your name. Only you can change it.`;
      break;
    case 'preset':
      line = `${target.name} is a preset, so everyone has it already. Change a colour and apply it to make a theme of your own, then share that.`;
      break;
    case 'others':
      line = `${target.name} is shared by ${target.owner}. Only ${target.owner} can change who sees it.`;
      break;
    case 'loose':
      line = `${target.name} is not in My themes. Change a colour and apply it to save it there, then share it.`;
      break;
  }

  return (
    <div data-testid="share-theme" className="flex flex-col gap-block">
      <div className="flex items-start justify-between gap-row">
        <div className="min-w-0">
          <div className="text-sm font-medium">Share with everyone</div>
          <div className="truncate text-xs text-muted-foreground">{target.name}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label="Share with everyone"
          disabled={!enabled}
          onClick={() => onChange(!checked)}
          className={cn(
            'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
            checked ? 'bg-ember' : 'border border-border bg-card',
          )}
        >
          <span
            className={cn(
              'absolute left-0 top-0.5 h-5 w-5 rounded-full transition-transform',
              checked ? 'translate-x-5.5 bg-ember-foreground' : 'translate-x-0.5 bg-foreground',
            )}
          />
        </button>
      </div>
      <p data-testid="share-line" className="text-sm text-muted-foreground">
        {line}
      </p>
    </div>
  );
}
