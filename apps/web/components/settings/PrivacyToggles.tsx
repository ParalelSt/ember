'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { usePrivacyStore } from '@/stores/usePrivacyStore';

/** A labelled switch row. */
function Toggle({
  id,
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch
        id={id}
        variant="outline"
        checked={checked}
        onCheckedChange={onChange}
        aria-label={label}
        disabled={disabled}
        className="mt-0.5"
      />
    </div>
  );
}

/** Two independent switches, because the audiences are different: Discord is
 *  everyone in your servers, the friends section is only people on this
 *  Ember. Someone may well want one and not the other. */
export function PrivacyToggles() {
  const shareDiscord = usePrivacyStore((s) => s.shareDiscord);
  const shareListening = usePrivacyStore((s) => s.shareListening);
  const loaded = usePrivacyStore((s) => s.loaded);
  const failed = usePrivacyStore((s) => s.failed);
  const load = usePrivacyStore((s) => s.load);
  const save = usePrivacyStore((s) => s.set);
  const [busy, setBusy] = useState(false);

  const update = async (patch: { shareDiscord?: boolean; shareListening?: boolean }) => {
    setBusy(true);
    try {
      await save(patch);
    } catch (e) {
      toast.error(`Couldn't save: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-12 pt-6 border-t border-border max-w-xl">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Privacy</h3>
      {failed && (
        <p className="mt-cluster text-xs text-muted-foreground">
          Couldn&apos;t load your privacy settings.{' '}
          <button type="button" className="text-ember underline-offset-2 hover:underline" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      <div className="mt-2 divide-y divide-border">
        <Toggle
          id="share-discord"
          checked={shareDiscord}
          disabled={!loaded || busy}
          onChange={(v) => void update({ shareDiscord: v })}
          label="Show what I'm playing on Discord"
          hint="Rich presence on your Discord profile. Turning this off clears it straight away."
        />
        <Toggle
          id="share-listening"
          checked={shareListening}
          disabled={!loaded || busy}
          onChange={(v) => void update({ shareListening: v })}
          label="Show me in “Friends are listening to”"
          hint="Other members of this server see your current track on their home page."
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Your listening history is still saved either way, it just isn&apos;t shared.
      </p>
    </div>
  );
}
