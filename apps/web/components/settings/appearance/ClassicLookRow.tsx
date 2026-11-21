'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useUiMode } from '@/components/providers/UiModeProvider';
import { SwitchRow } from '@/components/settings/AutoCacheSettings';
import { SettingsSwitchRow } from '@/components/settings/desktop/rows';
import { CLASSIC_LOOK_LABEL, CLASSIC_LOOK_TEXT } from '@/lib/uiMode';

export const CLASSIC_LOOK_FAILED = "Couldn't switch the look. Check your connection and try again.";

/** Settings > Appearance > Classic look: this device shows the previous
 *  design (legacy/, docs/classic-look.md) after a reload. Per device,
 *  like the cookie behind it (lib/uiMode). Phone: a card like the other
 *  switches; desktop (`rows`): a settings row. */
export function ClassicLookRow({ rows }: { rows?: boolean }) {
  const { mode, setMode } = useUiMode();
  const [busy, setBusy] = useState(false);
  const on = mode === 'legacy';

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      // Reloads the page on success: nothing to reset after it.
      await setMode(next ? 'legacy' : 'new');
    } catch {
      toast.error(CLASSIC_LOOK_FAILED);
      setBusy(false);
    }
  };

  return (
    <div data-testid="classic-look">
      {rows ? (
        <SettingsSwitchRow
          title={CLASSIC_LOOK_LABEL}
          description={CLASSIC_LOOK_TEXT}
          checked={on}
          disabled={busy}
          onCheckedChange={(v) => void toggle(v)}
        />
      ) : (
        <SwitchRow
          name={CLASSIC_LOOK_LABEL}
          description={CLASSIC_LOOK_TEXT}
          on={on}
          disabled={busy}
          onToggle={() => void toggle(!on)}
        />
      )}
    </div>
  );
}
