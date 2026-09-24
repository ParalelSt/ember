'use client';

import { useState, type CSSProperties } from 'react';
import { SectionHeader } from '@/components/page/SectionHeader';
import { ApplyBar } from '@/components/settings/appearance/ApplyBar';
import { ColourEditor } from '@/components/settings/appearance/ColourEditor';
import { InspectorPanel, InspectorTabStrip, type InspectorTab } from '@/components/settings/appearance/InspectorTabs';
import { ShareTheme, type ShareTarget } from '@/components/settings/appearance/ShareTheme';
import { ThemeLibrary } from '@/components/settings/appearance/ThemeLibrary';
import { ThemePreview } from '@/components/settings/appearance/ThemePreview';
import { useScrollerOffset } from '@/hooks/useScrollerOffset';
import { useThemeEditor } from '@/hooks/useThemeEditor';
import { cn } from '@/lib/utils';
import { derive } from '@/lib/theme/derive';
import { sameInputs } from '@/lib/theme/model';
import { PRESET_BY_ID } from '@/lib/theme/presets';
import { THEME_CAP } from '@/lib/theme/saved';

/** Settings > Appearance, the "Preview + inspector" layout: a live preview
 *  of the app next to one panel with three tabs (Themes, Colours, Share).
 *  Below xl the panel drops under the preview. From xl the two fill what
 *  is left of the window under the heading (bughunt F2: at 1512x830 the
 *  preview's player row and the inspector ran past the player bar): the
 *  preview shrinks to fit (its rows give way, its player row stays), and
 *  the inspector keeps the Apply bar and tabs on top with its list
 *  scrolling on its own. Picking a theme or changing a colour shows only
 *  in the preview; Apply makes it the theme of the whole app (and saves
 *  it), Back to current drops it. */
export default function SettingsAppearance() {
  const editor = useThemeEditor();
  const [tab, setTab] = useState<InspectorTab>('themes');
  const { selection, active, list, status } = editor;
  const [fitRef, fitTop] = useScrollerOffset<HTMLDivElement>();

  const shareTarget: ShareTarget =
    selection.kind === 'mine'
      ? { kind: 'mine', name: selection.name, shared: selection.theme.shared }
      : selection.kind === 'others'
        ? { kind: 'others', name: selection.name, owner: selection.theme.ownerName }
        : selection.kind === 'preset'
          ? { kind: 'preset', name: selection.name }
          : { kind: 'loose', name: selection.name };

  const base = PRESET_BY_ID[selection.base];
  const hint =
    selection.kind === 'preset'
      ? 'Change a colour and apply it, and it is saved as a new theme in My themes.'
      : selection.kind === 'loose'
        ? `Change a colour and apply it, and ${selection.name} is saved to My themes.`
        : null;

  return (
    <section data-testid="appearance" className="flex flex-col gap-block">
      <SectionHeader title="Appearance" />
      {/* --appearance-top: this row's distance from the scroller's top, so
          from xl its height is the scroller's visible height minus that and
          a block of air above the player bar. A floor keeps it usable on a
          very short window (the page scrolls then, as before). */}
      <div
        ref={fitRef}
        data-testid="appearance-fit"
        style={fitTop === null ? undefined : ({ '--appearance-top': `${fitTop}px` } as CSSProperties)}
        className="flex flex-col gap-stack xl:h-[calc(var(--ember-scroller-h)-var(--appearance-top)-var(--spacing-block))] xl:min-h-96 xl:flex-row xl:items-start"
      >
        <ThemePreview
          vars={derive(editor.inputs).vars}
          className="h-96 min-w-0 xl:sticky xl:top-0 xl:h-full xl:max-h-128 xl:flex-1"
        />
        <div className="flex min-w-0 flex-col gap-block xl:h-full xl:w-96 xl:shrink-0">
          <ApplyBar
            dirty={editor.dirty}
            name={selection.name}
            inUseName={active.name}
            edited={editor.edited}
            canApply={editor.canApply}
            applying={editor.applying}
            onApply={() => void editor.apply()}
            onDiscard={editor.discard}
          />
          <InspectorTabStrip active={tab} onChange={setTab} />
          <p
            role="status"
            data-testid="save-status"
            data-tone={status.tone}
            className={cn(
              'min-h-5 text-sm',
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

          {/* From xl the list scrolls here, under the bar and tabs. The
              inset padding keeps focus rings clear of the clipped edge.
              Keyed on the tab, so each tab opens at its top rather than at
              wherever the last one was scrolled to. */}
          <div
            key={tab}
            data-testid="inspector-scroll"
            className="xl:-mx-inset xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:p-inset"
          >
            <InspectorPanel id="themes" active={tab}>
              <ThemeLibrary
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
              />
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

            <InspectorPanel id="share" active={tab}>
              <ShareTheme target={shareTarget} busy={editor.sharing} onChange={(shared) => void editor.setShared(shared)} />
            </InspectorPanel>
          </div>
        </div>
      </div>
    </section>
  );
}
