import { useState, type FormEvent, type ReactNode } from 'react';
import { CopyIcon, EditIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeSwatch } from '@/components/settings/appearance/ThemeSwatch';
import { cn } from '@/lib/utils';
import { formatOklch } from '@/lib/theme/oklch';
import { THEME_NAME_MAX, type PresetId, type ThemeInputs } from '@/lib/theme/model';
import { PRESETS } from '@/lib/theme/presets';
import type { SavedTheme, SharedTheme } from '@/lib/theme/saved';

const swatch = (inputs: ThemeInputs) => ({ background: formatOklch(inputs.background), accent: formatOklch(inputs.accent) });

const ROW = 'flex items-center gap-row rounded-md border px-row py-inset';
const rowState = (active: boolean) => (active ? 'border-ember bg-card' : 'border-transparent hover:bg-card');

export interface ThemeLibraryProps {
  /** The preset in use, when no saved theme is. */
  activePreset: PresetId | null;
  /** The saved theme in use (mine or shared). */
  activeThemeId: string | null;
  /** Null while the list loads. */
  mine: SavedTheme[] | null;
  shared: SharedTheme[] | null;
  cap: number;
  loadFailed?: boolean;
  /** In use but in no list: a copy kept after its original went away. */
  looseName?: string | null;
  onPickPreset: (id: PresetId) => void;
  onUse: (id: string) => void;
  onNew: () => void;
  /** Resolves to an error line, or null once renamed. */
  onRename: (id: string, name: string) => Promise<string | null>;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onCopyShared: (id: string) => void;
}

/** The Themes tab: the five presets, my saved themes (new, rename,
 *  duplicate, delete, with the count against the cap) and everyone else's
 *  shared themes (use, or copy into mine). Props in, callbacks out. */
export function ThemeLibrary(props: ThemeLibraryProps) {
  const { activePreset, activeThemeId, mine, shared, cap, loadFailed, looseName } = props;
  const full = mine !== null && mine.length >= cap;

  return (
    <div data-testid="theme-library" className="flex flex-col gap-stack">
      {looseName && (
        <p data-testid="loose-theme" className="text-sm text-muted-foreground">
          In use: <span className="font-medium text-foreground">{looseName}</span>, kept after its original went
          away. Change a colour to save it to My themes.
        </p>
      )}

      <div role="radiogroup" aria-label="Presets" className="flex flex-col gap-inset">
        <div className="text-eyebrow mb-inset">Presets</div>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={p.id === activePreset}
            data-preset={p.id}
            onClick={() => props.onPickPreset(p.id)}
            className={cn(ROW, 'text-left transition-colors', rowState(p.id === activePreset))}
          >
            <ThemeSwatch {...swatch(p.inputs)} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{p.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{p.description}</span>
            </span>
          </button>
        ))}
      </div>

      <section aria-label="My themes" className="flex flex-col gap-inset">
        <div className="mb-inset flex items-center justify-between gap-row">
          <div className="text-eyebrow">
            My themes
            {mine && (
              <span data-testid="theme-count" className="ml-cluster normal-case tracking-normal">
                {mine.length} of {cap}
              </span>
            )}
          </div>
          <Button size="xs" variant="outline" onClick={props.onNew} disabled={mine === null || full} className="gap-inset">
            <PlusIcon className="h-3 w-3" />
            New
          </Button>
        </div>
        {full && (
          <p className="text-xs text-muted-foreground">
            That is the most you can keep ({cap}). Delete one to make room.
          </p>
        )}
        {mine === null ? (
          <p className="text-sm text-muted-foreground">{loadFailed ? 'Could not load your themes.' : 'Loading your themes.'}</p>
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet. Change a colour, or press New, to make one.</p>
        ) : (
          mine.map((t) => (
            <MyThemeRow
              key={t.id}
              theme={t}
              active={t.id === activeThemeId}
              onUse={() => props.onUse(t.id)}
              onRename={(name) => props.onRename(t.id, name)}
              onDuplicate={() => props.onDuplicate(t.id)}
              onDelete={() => props.onDelete(t.id)}
              canDuplicate={!full}
            />
          ))
        )}
      </section>

      <section aria-label="Shared by others" className="flex flex-col gap-inset">
        <div className="text-eyebrow mb-inset">Shared by others</div>
        {shared === null ? null : shared.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody has shared a theme yet.</p>
        ) : (
          shared.map((t) => (
            <div key={t.id} data-testid="shared-theme" className={cn(ROW, rowState(t.id === activeThemeId))}>
              <ThemeSwatch {...swatch(t.inputs)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{t.name}</div>
                <div className="truncate text-xs text-muted-foreground">by {t.ownerName}</div>
              </div>
              <div className="flex shrink-0 items-center gap-cluster">
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
                  disabled={t.id === activeThemeId}
                  aria-label={`Use ${t.name}`}
                >
                  {t.id === activeThemeId ? 'In use' : 'Use'}
                </Button>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function MyThemeRow({
  theme,
  active,
  canDuplicate,
  onUse,
  onRename,
  onDuplicate,
  onDelete,
}: {
  theme: SavedTheme;
  active: boolean;
  canDuplicate: boolean;
  onUse: () => void;
  onRename: (name: string) => Promise<string | null>;
  onDuplicate: () => void;
  onDelete: () => void;
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
      <form data-testid="my-theme" onSubmit={submit} className={cn(ROW, 'flex-wrap', rowState(active))}>
        <ThemeSwatch {...swatch(theme.inputs)} />
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
      <div data-testid="my-theme" className={cn(ROW, 'flex-wrap', rowState(active))}>
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
    <div data-testid="my-theme" className={cn(ROW, rowState(active))}>
      <button
        type="button"
        onClick={onUse}
        aria-pressed={active}
        aria-label={`Use ${theme.name}`}
        className="flex min-w-0 flex-1 items-center gap-row text-left"
      >
        <ThemeSwatch {...swatch(theme.inputs)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{theme.name}</span>
          <span className="block text-xs text-muted-foreground">
            {theme.shared ? 'Shared with everyone' : 'Only you'}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center">
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
