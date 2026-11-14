import { useState, type FormEvent, type ReactNode } from 'react';
import { CheckIcon, CopyIcon, EditIcon, TrashIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeSwatch } from '@/components/settings/appearance/ThemeSwatch';
import { cn } from '@/lib/utils';
import { formatOklch } from '@/lib/theme/oklch';
import { THEME_NAME_MAX, type PresetId, type ThemeInputs } from '@/lib/theme/model';
import { PRESETS } from '@/lib/theme/presets';
import type { SavedTheme, SharedTheme } from '@/lib/theme/saved';

const swatch = (inputs: ThemeInputs) => ({
  background: formatOklch(inputs.background),
  accent: formatOklch(inputs.accent),
  surface: formatOklch(inputs.surface),
});

/** Two columns of cards at every width. A card keeps its own minimum width at
 *  0, so a long name truncates inside it instead of widening its column. */
const GRID = 'grid grid-cols-2 gap-cluster';
/** Presets and other people's themes never change shape, so every row of
 *  them is as tall as the tallest one: no card is shorter than its
 *  neighbour in the next row, and nothing moves when a tag lands on one. */
const EVEN_GRID = `${GRID} auto-rows-fr`;
const CARD = 'relative flex min-w-0 flex-col gap-cluster rounded-[14px] border p-cluster transition-colors';
const cardState = (active: boolean) =>
  active ? 'border-ember bg-ember/10 ring-1 ring-ember' : 'border-transparent bg-card hover:bg-accent';
/** A card being renamed or asked about deleting needs the room: the whole row. */
const WIDE = 'col-span-2 flex-row flex-wrap items-center';
const FOCUS = 'outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

/** The three lists, one per tab of the inspector (the fourth is Colours). */
export type LibraryView = 'presets' | 'mine' | 'shared';

export interface ThemeLibraryProps {
  /** Which list this tab shows. */
  view: LibraryView;
  /** The preset the preview shows, when no saved theme is. */
  shownPreset: PresetId | null;
  /** The saved theme the preview shows (mine or shared). */
  shownThemeId: string | null;
  /** The preset in use on the app, when no saved theme is. */
  inUsePreset: PresetId | null;
  /** The saved theme in use on the app (mine or shared). */
  inUseThemeId: string | null;
  /** Null while the list loads. */
  mine: SavedTheme[] | null;
  shared: SharedTheme[] | null;
  cap: number;
  loadFailed?: boolean;
  /** In use but in no list: a copy kept after its original went away. */
  looseName?: string | null;
  /** Show a preset in the preview (nothing is applied). */
  onPickPreset: (id: PresetId) => void;
  /** Show a saved theme in the preview (nothing is applied). */
  onUse: (id: string) => void;
  onNew: () => void;
  /** Resolves to an error line, or null once renamed. */
  onRename: (id: string, name: string) => Promise<string | null>;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onCopyShared: (id: string) => void;
  /** My themes with a share change on its way. */
  sharing?: ReadonlySet<string>;
  /** Share one of mine with everyone, or stop. Saves at once. */
  onShare: (id: string, shared: boolean) => void;
}

/** One list of themes, as cards: the five presets, my saved themes (new,
 *  rename, duplicate, delete, share, with the count against the cap) or
 *  everyone else's shared themes (preview, or copy into mine). Each of mine
 *  has its own share switch (bughunt F3); presets and other people's themes
 *  have none. Each card has a preview of its colours; the one the preview
 *  shows is ember; the one in use says "In use". Every card keeps a corner
 *  of its swatch for its tags whether it has any or not, and a list still loading shows
 *  stand-in cards of the same size, so nothing moves when a tag moves to
 *  another card or the list arrives (layout-shift pass). Props in,
 *  callbacks out. */
export function ThemeLibrary(props: ThemeLibraryProps) {
  return (
    <div data-testid="theme-library" data-view={props.view} className="flex flex-col gap-stack">
      {props.view === 'presets' ? <PresetList {...props} /> : props.view === 'mine' ? <MyThemes {...props} /> : <SharedThemes {...props} />}
    </div>
  );
}

function PresetList({ shownPreset, inUsePreset, onPickPreset }: ThemeLibraryProps) {
  return (
    <div role="radiogroup" aria-label="Presets" className={EVEN_GRID}>
      {PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={p.id === shownPreset}
          data-preset={p.id}
          title={p.description}
          onClick={() => onPickPreset(p.id)}
          className={cn(CARD, FOCUS, 'text-left', cardState(p.id === shownPreset))}
        >
          <Preview inputs={p.inputs} selected={p.id === shownPreset} />
          <CardName name={p.name} selected={p.id === shownPreset} />
          <Tags>{p.id === inUsePreset && <InUse />}</Tags>
          {/* Two lines kept for every description, so a one-line one does not
              make its card the short one in the row. */}
          <span className="line-clamp-2 min-h-8 text-xs text-muted-foreground">{p.description}</span>
        </button>
      ))}
    </div>
  );
}

function MyThemes(props: ThemeLibraryProps) {
  const { mine, cap, loadFailed, looseName, shownThemeId, inUseThemeId } = props;
  const full = mine !== null && mine.length >= cap;
  return (
    <section aria-label="My themes" className="flex flex-col gap-block">
      <div className="flex min-h-hit items-center justify-between gap-row">
        {/* The count's line is there while the list loads, empty. */}
        <p className="text-sm text-muted-foreground">
          {mine && (
            <span data-testid="theme-count">
              {mine.length} of {cap}
            </span>
          )}
        </p>
        <Button variant="outline" onClick={props.onNew} disabled={mine === null || full}>
          New theme
        </Button>
      </div>
      {looseName && (
        <p data-testid="loose-theme" className="text-sm text-muted-foreground">
          In use: <span className="font-medium text-foreground">{looseName}</span>, kept after its original went
          away. Change a colour and apply it to save it to My themes.
        </p>
      )}
      <p data-testid="share-explainer" className="text-xs text-muted-foreground">
        Switch Share on and a theme shows for everyone under Shared.
      </p>
      {full && (
        <p className="text-xs text-muted-foreground">
          That is the most you can keep ({cap}). Delete one to make room.
        </p>
      )}
      {mine === null ? (
        loadFailed ? (
          <p className="text-sm text-muted-foreground">Could not load your themes.</p>
        ) : (
          <Loading what="your themes" kind="mine" />
        )
      ) : mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet. Change a colour and apply it, or press New theme, to make one.</p>
      ) : (
        <div className={GRID}>
          {mine.map((t) => (
            <MyThemeCard
              key={t.id}
              theme={t}
              active={t.id === shownThemeId}
              inUse={t.id === inUseThemeId}
              onUse={() => props.onUse(t.id)}
              onRename={(name) => props.onRename(t.id, name)}
              onDuplicate={() => props.onDuplicate(t.id)}
              onDelete={() => props.onDelete(t.id)}
              canDuplicate={!full}
              sharing={props.sharing?.has(t.id) ?? false}
              onShare={(on) => props.onShare(t.id, on)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SharedThemes(props: ThemeLibraryProps) {
  const { mine, shared, cap, loadFailed, shownThemeId, inUseThemeId } = props;
  const full = mine !== null && mine.length >= cap;
  return (
    <section aria-label="Shared by others" className="flex flex-col gap-block">
      <p className="text-xs text-muted-foreground">
        Themes other people shared. Preview one, or copy it to My themes to change its colours.
      </p>
      {shared === null ? (
        loadFailed ? (
          <p className="text-sm text-muted-foreground">Could not load shared themes.</p>
        ) : (
          <Loading what="shared themes" kind="shared" />
        )
      ) : shared.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody has shared a theme yet.</p>
      ) : (
        <div className={EVEN_GRID}>
          {shared.map((t) => (
            <div key={t.id} data-testid="shared-theme" className={cn(CARD, cardState(t.id === shownThemeId))}>
              <Preview inputs={t.inputs} selected={t.id === shownThemeId} />
              <CardName name={t.name} selected={t.id === shownThemeId} />
              <Tags>{t.id === inUseThemeId && <InUse />}</Tags>
              <div className="truncate text-xs text-muted-foreground">by {t.ownerName}</div>
              <div className="mt-auto flex flex-wrap items-center gap-inset">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => props.onCopyShared(t.id)}
                  disabled={full}
                  aria-label={`Copy ${t.name} to my themes`}
                >
                  Copy
                </Button>
                <Button
                  size="xs"
                  onClick={() => props.onUse(t.id)}
                  disabled={t.id === shownThemeId}
                  aria-label={`Preview ${t.name}`}
                >
                  {t.id === shownThemeId ? 'Showing' : 'Preview'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** A list on its way: a row of stand-in cards built like the real ones
 *  (swatch, name, one line under it, the actions), so the cards
 *  that replace them land where they stand. */
function Loading({ what, kind }: { what: string; kind: 'mine' | 'shared' }) {
  return (
    <div role="status" aria-label={`Loading ${what}`} className={GRID}>
      {[0, 1].map((i) => (
        <div key={i} aria-hidden data-testid="theme-skeleton" className={cn(CARD, 'animate-pulse border-transparent bg-card')}>
          <span className="flex min-w-0 flex-col gap-cluster">
            <span className="block h-14 w-full rounded-[10px] bg-muted" />
            <span className="block h-5 w-2/3 rounded-full bg-muted" />
            <span className="block h-4 w-1/2 rounded-full bg-muted" />
          </span>
          {kind === 'mine' ? (
            // A phone stacks the share switch over the three icon buttons.
            <span className="mt-auto block h-[calc(var(--spacing-hit)*2)] md:h-8" />
          ) : (
            <span className="mt-auto block h-6" />
          )}
        </div>
      ))}
    </div>
  );
}

/** A card's preview, with an ember tick on the one the preview shows. */
function Preview({ inputs, selected }: { inputs: ThemeInputs; selected: boolean }) {
  return (
    <span className="relative block">
      <ThemeSwatch {...swatch(inputs)} />
      {selected && (
        <span
          data-testid="theme-selected"
          aria-hidden
          className="absolute right-inset top-inset grid size-5 place-items-center rounded-full bg-ember text-ember-foreground"
        >
          <CheckIcon className="size-3" />
        </span>
      )}
    </span>
  );
}

/** A card's tags (In use, Shared), drawn in the top corner of its swatch.
 *  Every card has this corner, empty or not, and it sits over the swatch
 *  rather than in the card's flow: a tag landing on a card (or leaving it)
 *  never changes its height, so its row never jumps (layout-shift pass). In
 *  the markup it comes after the name, so the name is read first. */
function Tags({ children }: { children?: ReactNode }) {
  return (
    <span
      data-testid="tag-slot"
      className="absolute left-[calc(var(--spacing-cluster)+var(--spacing-inset))] top-[calc(var(--spacing-cluster)+var(--spacing-inset))] flex max-w-[calc(100%-3rem)] gap-inset overflow-hidden"
    >
      {children}
    </span>
  );
}

/** The name under the preview, truncated. */
function CardName({ name, selected }: { name: string; selected: boolean }) {
  return (
    <span title={name} className={cn('block w-full min-w-0 truncate text-sm font-medium', selected && 'text-ember')}>
      {name}
    </span>
  );
}

function MyThemeCard({
  theme,
  active,
  inUse,
  canDuplicate,
  onUse,
  onRename,
  onDuplicate,
  onDelete,
  sharing,
  onShare,
}: {
  theme: SavedTheme;
  /** The preview shows it. */
  active: boolean;
  /** The app uses it. */
  inUse: boolean;
  canDuplicate: boolean;
  onUse: () => void;
  onRename: (name: string) => Promise<string | null>;
  onDuplicate: () => void;
  onDelete: () => void;
  /** A share change is on its way. */
  sharing: boolean;
  onShare: (shared: boolean) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'rename' | 'delete'>('idle');
  const [name, setName] = useState(theme.name);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = await onRename(name);
    if (problem) setError(problem);
    else {
      setError(null);
      setMode('idle');
    }
  };

  if (mode === 'rename') {
    return (
      <form data-testid="my-theme" onSubmit={submit} className={cn(CARD, WIDE, cardState(active))}>
        <ThemeSwatch {...swatch(theme.inputs)} className="h-8 w-14 items-center p-inset" />
        <Input
          autoFocus
          aria-label={`New name for ${theme.name}`}
          value={name}
          maxLength={THEME_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          className="h-8 min-w-0 flex-1"
        />
        <div className="flex shrink-0 items-center gap-cluster">
          <Button size="xs" type="submit">
            Save
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setMode('idle');
              setName(theme.name);
              setError(null);
            }}
          >
            Cancel
          </Button>
        </div>
        {error && <p className="w-full text-xs text-destructive">{error}</p>}
      </form>
    );
  }

  if (mode === 'delete') {
    return (
      <div data-testid="my-theme" className={cn(CARD, WIDE, cardState(active))}>
        <p className="min-w-0 flex-1 text-sm">Delete {theme.name}?</p>
        <div className="flex shrink-0 items-center gap-cluster">
          <Button
            size="xs"
            variant="destructive"
            onClick={() => {
              setMode('idle');
              onDelete();
            }}
          >
            Delete
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setMode('idle')}>
            Keep
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="my-theme" className={cn(CARD, cardState(active))}>
      <button
        type="button"
        onClick={onUse}
        aria-pressed={active}
        aria-label={`Preview ${theme.name}`}
        className={cn(FOCUS, 'flex min-w-0 flex-col gap-cluster rounded-[10px] text-left')}
      >
        <Preview inputs={theme.inputs} selected={active} />
        <CardName name={theme.name} selected={active} />
        <Tags>
          {theme.shared && <SharedTag />}
          {inUse && <InUse />}
        </Tags>
        <span className="block text-xs text-muted-foreground">
          {theme.shared ? 'Everyone can use it' : 'Only you'}
        </span>
      </button>
      {/* Four hit boxes do not fit a phone's column: the switch gets a line of its own there. */}
      <div className="mt-auto flex flex-wrap items-center justify-between md:flex-nowrap">
        <div className="flex w-full items-center justify-between md:w-auto">
          <span aria-hidden className="text-xs text-muted-foreground md:hidden">
            Share
          </span>
          <ShareSwitch name={theme.name} checked={theme.shared} busy={sharing} onChange={onShare} />
        </div>
        <div className="flex w-full items-center justify-between md:w-auto">
          <IconAction label={`Rename ${theme.name}`} onClick={() => {
              setName(theme.name);
              setMode('rename');
            }}
          >
            <EditIcon className="h-3.5 w-3.5" />
          </IconAction>
          <IconAction label={`Duplicate ${theme.name}`} onClick={onDuplicate} disabled={!canDuplicate}>
            <CopyIcon className="h-3.5 w-3.5" />
          </IconAction>
          <IconAction label={`Delete ${theme.name}`} onClick={() => setMode('delete')}>
            <TrashIcon className="h-3.5 w-3.5" />
          </IconAction>
        </div>
      </div>
    </div>
  );
}

/** The tag on each of my themes that everyone can see. */
function SharedTag() {
  return (
    <span data-testid="shared-tag" className="shrink-0 rounded-full bg-ember px-cluster text-xs font-medium text-ember-foreground">
      Shared
    </span>
  );
}

/** One of my themes' share switch: on, everyone on this server sees it
 *  under Shared by others. A small track in a full-size hit box. */
function ShareSwitch({
  name,
  checked,
  busy,
  onChange,
}: {
  name: string;
  checked: boolean;
  busy: boolean;
  onChange: (shared: boolean) => void;
}) {
  const label = `Share ${name} with everyone`;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={() => onChange(!checked)}
      className="grid size-hit place-items-center rounded-full disabled:opacity-50 md:size-8"
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative block h-4 w-7 rounded-full transition-colors',
          checked ? 'bg-ember' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'absolute left-0 top-0.5 size-3 rounded-full transition-transform',
            checked ? 'translate-x-3.5 bg-ember-foreground' : 'translate-x-0.5 bg-foreground',
          )}
        />
      </span>
    </button>
  );
}

/** The tag on the theme the app uses now. */
function InUse() {
  return (
    <span data-testid="in-use" className="shrink-0 rounded-full bg-foreground px-cluster text-xs font-medium text-background">
      In use
    </span>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-hit place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 md:size-8"
    >
      {children}
    </button>
  );
}
