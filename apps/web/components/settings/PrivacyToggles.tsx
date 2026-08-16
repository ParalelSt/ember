'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { usePrivacyStore } from '@/stores/usePrivacyStore';

/** A plain accessible switch — the UI kit has no Switch component and this is
 *  the only place that needs one. */
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
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          checked ? 'bg-ember' : 'bg-card border border-border'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
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
        Your listening history is still saved either way — it just isn&apos;t shared.
      </p>
    </div>
  );
}
