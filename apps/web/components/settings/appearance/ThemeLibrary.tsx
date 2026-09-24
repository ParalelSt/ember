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

/** The Themes tab: the five presets, my saved themes (new, rename,
 *  duplicate, delete, share, with the count against the cap) and everyone
 *  else's shared themes (preview, or copy into mine). Each of mine has its
 *  own share switch (bughunt F3); presets and other people's themes have
 *  none. The one the preview shows is
 *  outlined; the one in use says "In use". Props in, callbacks out. */
export function ThemeLibrary(props: ThemeLibraryProps) {
  const { shownPreset, shownThemeId, inUsePreset, inUseThemeId, mine, shared, cap, loadFailed, looseName } = props;
  const full = mine !== null && mine.length >= cap;

  return (
    <div data-testid="theme-library" className="flex flex-col gap-stack">
      {looseName && (
        <p data-testid="loose-theme" className="text-sm text-muted-foreground">
          In use: <span className="font-medium text-foreground">{looseName}</span>, kept after its original went
          away. Change a colour and apply it to save it to My themes.
        </p>
      )}

      <div role="radiogroup" aria-label="Presets" className="flex flex-col gap-inset">
        <div className="text-eyebrow mb-inset">Presets</div>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={p.id === shownPreset}
            data-preset={p.id}
            onClick={() => props.onPickPreset(p.id)}
            className={cn(ROW, 'text-left transition-colors', rowState(p.id === shownPreset))}
          >
            <ThemeSwatch {...swatch(p.inputs)} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-cluster text-sm font-medium">
                {p.name}
                {p.id === inUsePreset && <InUse />}
              </span>
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
        <p data-testid="share-explainer" className="text-xs text-muted-foreground">
          Shared themes appear for everyone under Shared by others.
        </p>
        {full && (
          <p className="text-xs text-muted-foreground">
            That is the most you can keep ({cap}). Delete one to make room.
          </p>
        )}
        {mine === null ? (
          <p className="text-sm text-muted-foreground">{loadFailed ? 'Could not load your themes.' : 'Loading your themes.'}</p>
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet. Change a colour and apply it, or press New, to make one.</p>
        ) : (
          mine.map((t) => (
            <MyThemeRow
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
          ))
        )}
      </section>

      <section aria-label="Shared by others" className="flex flex-col gap-inset">
        <div className="text-eyebrow mb-inset">Shared by others</div>
        {shared === null ? null : shared.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody has shared a theme yet.</p>
        ) : (
          shared.map((t) => (
            <div key={t.id} data-testid="shared-theme" className={cn(ROW, rowState(t.id === shownThemeId))}>
              <ThemeSwatch {...swatch(t.inputs)} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-cluster text-sm font-medium">
                  <span className="truncate">{t.name}</span>
                  {t.id === inUseThemeId && <InUse />}
                </div>
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
                  disabled={t.id === shownThemeId}
                  aria-label={`Preview ${t.name}`}
                >
                  {t.id === shownThemeId ? 'Showing' : 'Preview'}
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
        aria-label={`Preview ${theme.name}`}
        className="flex min-w-0 flex-1 items-center gap-row text-left"
      >
        <ThemeSwatch {...swatch(theme.inputs)} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-cluster text-sm font-medium">
            <span className="truncate">{theme.name}</span>
            {theme.shared && <SharedTag />}
            {inUse && <InUse />}
          </span>
          <span className="block text-xs text-muted-foreground">
            {theme.shared ? 'Everyone can use it' : 'Only you'}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center">
        <ShareSwitch name={theme.name} checked={theme.shared} busy={sharing} onChange={onShare} />
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

/** The tag on each of my themes that everyone can see. */
function SharedTag() {
  return (
    <span data-testid="shared-tag" className="shrink-0 rounded-full bg-ember/15 px-cluster text-xs font-normal text-ember">
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
    <span data-testid="in-use" className="shrink-0 rounded-full bg-muted px-cluster text-xs font-normal text-muted-foreground">
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
