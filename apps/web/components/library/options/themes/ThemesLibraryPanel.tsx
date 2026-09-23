import { CopyIcon, EditIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  MOCK_MY_THEMES,
  MOCK_SHARED_THEMES,
  THEME_PRESETS,
  type MockSavedTheme,
  type MockSharedTheme,
  type PresetId,
} from '@/components/library/options/themes/mock';

function Swatch({ vars, className }: { vars: Record<string, string>; className?: string }) {
  // The fill goes through a scoped custom property (`bg-(--swatch-bg)`,
  // Tailwind 4's var() shorthand) rather than a literal `backgroundColor`
  // style: a browser accepts any colour function as a custom property
  // unconditionally, the same reason LiveThemePreview never sets a real
  // colour property directly either.
  return (
    <span
      aria-hidden
      data-testid="swatch"
      className={cn('inline-block size-hit shrink-0 rounded-full border border-border bg-(--swatch-bg)', className)}
      style={{ ['--swatch-bg' as string]: vars['--background'], boxShadow: `inset 0 0 0 3px ${vars['--ember']}` }}
    />
  );
}

/** The five ready-made presets (plan section 2), drawn with their own real
 *  token values so the swatches are honest: the ring colour IS that
 *  preset's `--ember`, the fill IS its `--background`. */
function PresetsGrid({ activeId }: { activeId: PresetId | null }) {
  return (
    <div data-testid="presets-grid" role="radiogroup" aria-label="Presets" className="flex flex-col gap-row">
      {THEME_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={p.id === activeId}
          data-testid="preset-option"
          data-preset={p.id}
          className={cn(
            'flex items-center gap-row rounded-md border px-row py-inset text-left transition-colors',
            p.id === activeId ? 'border-ember bg-card' : 'border-transparent hover:bg-card',
          )}
        >
          <Swatch vars={p.vars} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{p.name}</div>
            <div className="truncate text-xs text-muted-foreground">{p.blurb}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

/** "My themes" (owner decision 4): a saved, named list, not one slot,
 *  each with new / rename / duplicate / delete. Inert buttons: nothing
 *  here writes anywhere. */
function MyThemesList({ activeId, themes = MOCK_MY_THEMES }: { activeId: string | null; themes?: MockSavedTheme[] }) {
  return (
    <div data-testid="my-themes-list" className="flex flex-col gap-row">
      <div className="flex items-center justify-between gap-row">
        <div className="text-eyebrow">My themes</div>
        <Button size="xs" variant="outline" className="gap-inset">
          <PlusIcon className="h-3 w-3" />
          New
        </Button>
      </div>
      {themes.map((t) => (
        <div
          key={t.id}
          data-testid="my-theme-row"
          data-theme={t.id}
          className={cn(
            'flex items-center gap-row rounded-md border px-row py-inset',
            t.id === activeId ? 'border-ember bg-card' : 'border-transparent hover:bg-card',
          )}
        >
          <Swatch vars={t.vars} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{t.name}</div>
            <div className="text-xs text-muted-foreground">{t.shared ? 'Shared with everyone' : 'Not shared'}</div>
          </div>
          <div className="flex shrink-0 items-center gap-inset">
            <span className="grid size-hit place-items-center rounded-full text-muted-foreground">
              <EditIcon className="h-3.5 w-3.5" />
            </span>
            <span className="grid size-hit place-items-center rounded-full text-muted-foreground">
              <CopyIcon className="h-3.5 w-3.5" />
            </span>
            <span className="grid size-hit place-items-center rounded-full text-muted-foreground">
              <TrashIcon className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** "Shared by others" (owner decision 3): everyone else's themes that have
 *  "Share with everyone" on, each labelled "by <name>". */
function SharedByOthersList({ themes = MOCK_SHARED_THEMES }: { themes?: MockSharedTheme[] }) {
  return (
    <div data-testid="shared-themes-list" className="flex flex-col gap-row">
      <div className="text-eyebrow">Shared by others</div>
      {themes.map((t) => (
        <div key={t.id} data-testid="shared-theme-row" className="flex items-center gap-row rounded-md px-row py-inset">
          <Swatch vars={t.vars} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{t.name}</div>
            <div className="text-xs text-muted-foreground">by {t.ownerName}</div>
          </div>
          <div className="flex shrink-0 items-center gap-cluster">
            <Button size="xs" variant="outline">
              Copy
            </Button>
            <Button size="xs">Use</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface ThemesLibraryPanelProps {
  activePresetId: PresetId | null;
  activeMyThemeId?: string | null;
  className?: string;
}

/** The three lists that make up "pick a theme": the five presets, the
 *  account's own saved list, and what everyone else has shared. The same
 *  three sections in every layout candidate, just arranged differently
 *  around it. */
export function ThemesLibraryPanel({ activePresetId, activeMyThemeId = null, className }: ThemesLibraryPanelProps) {
  return (
    <div data-testid="themes-library-panel" className={cn('flex flex-col gap-stack', className)}>
      <PresetsGrid activeId={activePresetId} />
      <MyThemesList activeId={activeMyThemeId} />
      <SharedByOthersList />
    </div>
  );
}
