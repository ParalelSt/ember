'use client';

import { useState } from 'react';
import { SectionHeader } from '@/components/page/SectionHeader';
import { ColourEditor } from '@/components/settings/appearance/ColourEditor';
import { InspectorPanel, InspectorTabStrip, type InspectorTab } from '@/components/settings/appearance/InspectorTabs';
import { ShareTheme, type ShareTarget } from '@/components/settings/appearance/ShareTheme';
import { ThemeLibrary } from '@/components/settings/appearance/ThemeLibrary';
import { ThemePreview } from '@/components/settings/appearance/ThemePreview';
import { useThemeEditor } from '@/hooks/useThemeEditor';
import { cn } from '@/lib/utils';
import { derive } from '@/lib/theme/derive';
import { sameInputs } from '@/lib/theme/model';
import { PRESET_BY_ID } from '@/lib/theme/presets';
import { THEME_CAP } from '@/lib/theme/saved';

/** Settings > Appearance, the "Preview + inspector" layout: a live preview
 *  of the app next to one panel with three tabs (Themes, Colours, Share).
 *  Below xl the panel drops under the preview. Every change shows on the
 *  whole app at once and saves itself. */
export default function SettingsAppearance() {
  const editor = useThemeEditor();
  const [tab, setTab] = useState<InspectorTab>('themes');
  const { selection, list, status } = editor;

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
      ? 'Change a colour and it is saved as a new theme in My themes.'
      : selection.kind === 'loose'
        ? `Change a colour and ${selection.name} is saved to My themes.`
        : null;

  return (
    <section data-testid="appearance" className="flex flex-col gap-block">
      <SectionHeader title="Appearance" />
      <div className="flex flex-col gap-stack xl:flex-row xl:items-start">
        <ThemePreview
          vars={derive(editor.inputs).vars}
          className="h-80 min-w-0 xl:sticky xl:top-0 xl:h-128 xl:flex-1"
        />
        <div className="flex min-w-0 flex-col gap-block xl:w-96 xl:shrink-0">
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

          <InspectorPanel id="themes" active={tab}>
            <ThemeLibrary
              activePreset={selection.kind === 'preset' ? selection.base : null}
              activeThemeId={selection.kind === 'mine' || selection.kind === 'others' ? selection.key : null}
              mine={list?.mine ?? null}
              shared={list?.shared ?? null}
              cap={list?.cap ?? THEME_CAP}
              loadFailed={editor.loadFailed}
              looseName={selection.kind === 'loose' ? selection.name : null}
              onPickPreset={(id) => void editor.pickPreset(id)}
              onUse={(id) => void editor.use(id)}
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
    </section>
  );
}
