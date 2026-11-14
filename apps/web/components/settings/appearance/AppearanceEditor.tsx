'use client';

import { useState } from 'react';
import { ApplyBar } from '@/components/settings/appearance/ApplyBar';
import { ColourEditor } from '@/components/settings/appearance/ColourEditor';
import { InspectorPanel, InspectorTabStrip, type InspectorTab } from '@/components/settings/appearance/InspectorTabs';
import { ThemeLibrary, type LibraryView } from '@/components/settings/appearance/ThemeLibrary';
import { ThemePreview } from '@/components/settings/appearance/ThemePreview';
import { useThemeEditor } from '@/hooks/useThemeEditor';
import { cn } from '@/lib/utils';
import { derive } from '@/lib/theme/derive';
import { sameInputs } from '@/lib/theme/model';
import { PRESET_BY_ID } from '@/lib/theme/presets';
import { THEME_CAP } from '@/lib/theme/saved';

/** Settings > Appearance, the "Preview + inspector" layout, shared by the
 *  phone page (app/(app)/settings/appearance) and desktop Settings, which
 *  passes `rows`: the Apply bar drawn as a row, without its card, like the
 *  other sections. Neither draws a heading here: the phone page's header
 *  and the desktop menu layout each show one already.
 *  The layout: a live preview of the app next to one panel with four tabs
 *  (Presets, My themes, Shared, Colours), each showing only its own list or
 *  the colour editor. Sharing is per theme, a switch on each card of My
 *  themes (bughunt F3). Below xl the panel drops under the preview. From xl
 *  the two sit side by side and the page scrolls as a whole; the preview
 *  sticks under the top bar, so it stays in sight while a long list
 *  scrolls. Picking a theme or changing a colour shows only in the preview;
 *  Apply makes it the theme of the whole app (and saves it), Back to
 *  current drops it.
 *  Nothing on it moves on its own (layout-shift pass): the Apply bar keeps
 *  one height in every state, the status line keeps its room, every card
 *  keeps a line for its tags, a list still loading shows stand-in cards,
 *  and a tab is never shorter than the window. */
export function AppearanceEditor({ rows }: { rows?: boolean }) {
  const editor = useThemeEditor();
  const [tab, setTab] = useState<InspectorTab>('presets');
  const { selection, active, list, status } = editor;

  const base = PRESET_BY_ID[selection.base];
  const hint =
    selection.kind === 'preset'
      ? 'Change a colour and apply it, and it is saved as a new theme in My themes.'
      : selection.kind === 'loose'
        ? `Change a colour and apply it, and ${selection.name} is saved to My themes.`
        : null;

  const library = (view: LibraryView) => (
    <ThemeLibrary
      view={view}
      shownPreset={selection.kind === 'preset' ? selection.base : null}
      shownThemeId={selection.kind === 'mine' || selection.kind === 'others' ? selection.key : null}
      inUsePreset={active.kind === 'preset' ? active.base : null}
      inUseThemeId={active.kind === 'mine' || active.kind === 'others' ? active.key : null}
      mine={list?.mine ?? null}
      shared={list?.shared ?? null}
      cap={list?.cap ?? THEME_CAP}
      loadFailed={editor.loadFailed}
      looseName={active.kind === 'loose' ? active.name : null}
      onPickPreset={editor.pickPreset}
      onUse={editor.use}
      onNew={() => {
        void editor.create().then((made) => made && setTab('colours'));
      }}
      onRename={editor.rename}
      onDuplicate={(id) => void editor.duplicate(id)}
      onDelete={(id) => void editor.remove(id)}
      onCopyShared={(id) => void editor.copyShared(id)}
      sharing={editor.sharing}
      onShare={(id, shared) => void editor.setShared(id, shared)}
    />
  );

  return (
    <section data-testid="appearance" className="flex flex-col gap-block">
      <div data-testid="appearance-layout" className="flex flex-col gap-stack xl:flex-row xl:items-start">
        <ThemePreview
          vars={derive(editor.inputs).vars}
          className="h-96 min-w-0 xl:sticky xl:top-[calc(var(--ember-topbar-h,0px)+var(--spacing-block))] xl:h-128 xl:max-h-[calc(var(--ember-scroller-h,100svh)-var(--ember-topbar-h,0px)-var(--spacing-stack))] xl:flex-1"
        />
        <div className="flex min-w-0 flex-col gap-block xl:w-96 xl:shrink-0">
          <ApplyBar
            bare={rows}
            dirty={editor.dirty}
            name={selection.name}
            inUseName={active.name}
            edited={editor.edited}
            canApply={editor.canApply}
            applying={editor.applying}
            onApply={() => void editor.apply()}
            onDiscard={editor.discard}
          />
          <div className="flex flex-col gap-cluster">
            <InspectorTabStrip active={tab} onChange={setTab} />
            {/* One line kept for what the last action did, so a line arriving
                (or going) does not push the tab under it. */}
            <div data-testid="status-line" className="flex min-h-5 flex-col gap-inset">
              <p
                role="status"
                data-testid="save-status"
                data-tone={status.tone}
                className={cn(
                  'text-sm',
                  status.tone === 'blocked' || status.tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {status.text}
              </p>
              {editor.notice && (
                <p role="alert" data-testid="appearance-notice" className="text-sm text-muted-foreground">
                  {editor.notice}
                </p>
              )}
            </div>
          </div>

          <div data-testid="inspector-panels">
            <InspectorPanel id="presets" active={tab}>
              {library('presets')}
            </InspectorPanel>
            <InspectorPanel id="mine" active={tab}>
              {library('mine')}
            </InspectorPanel>
            <InspectorPanel id="shared" active={tab}>
              {library('shared')}
            </InspectorPanel>

            <InspectorPanel id="colours" active={tab}>
              <ColourEditor
                inputs={editor.inputs}
                pinned={editor.pinned}
                findings={editor.findings}
                owner={selection.kind === 'others' ? selection.theme.ownerName : null}
                readOnly={!editor.editable}
                hint={hint}
                baseName={base.name}
                canReset={editor.editable && !sameInputs(editor.inputs, base.inputs)}
                onChange={editor.change}
                onUnpin={editor.unpin}
                onFix={editor.fix}
                onReset={editor.reset}
                onCopy={selection.kind === 'others' ? () => void editor.copyShared(selection.key) : undefined}
              />
            </InspectorPanel>
          </div>
        </div>
      </div>
    </section>
  );
}
