'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { SectionHeader } from '@/components/page/SectionHeader';
import { SwitchRow } from '@/components/settings/AutoCacheSettings';
import { bootStartSupported, getBootStart, isAndroidApp, setBootStart, type BootStartSettings } from '@/lib/bootStart';
import { useIsHeadUnit } from '@/hooks/useHeadUnit';
import { useSettingsStore } from '@/stores/useSettingsStore';

export const BOOT_START_UPDATE_APP_TEXT = 'Opening Ember when this device starts needs a newer version of the Ember app.';

const noSubscribe = () => () => {};

/** Settings > Devices, in the Android app only: using Ember on a device that
 *  runs it by itself, like a car head unit. On a head unit (lib/headUnit),
 *  the car controls' switch (on by default there); everywhere in the app,
 *  "Open Ember when this device starts", and with it "and keep playing"
 *  (both off by default), kept by the app (lib/bootStart). Plain on
 *  purpose, like the other switches. */
export function HeadUnitSettings() {
  const android = useSyncExternalStore(noSubscribe, isAndroidApp, () => false);
  const supported = useSyncExternalStore(noSubscribe, bootStartSupported, () => false);
  const [settings, setSettings] = useState<BootStartSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const headUnit = useIsHeadUnit();
  const carControls = useSettingsStore((s) => s.headUnitControls);
  const setCarControls = useSettingsStore((s) => s.setHeadUnitControls);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void getBootStart().then((s) => {
      if (!cancelled) setSettings(s ?? { enabled: false, keepPlaying: false });
    });
    return () => {
      cancelled = true;
    };
  }, [supported]);

  if (!android) return null;

  const change = async (next: BootStartSettings) => {
    const was = settings;
    setSettings(next);
    setSaving(true);
    try {
      setSettings(await setBootStart(next));
    } catch (e) {
      setSettings(was);
      toast.error(`Couldn't save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-section max-w-2xl flex flex-col gap-row" data-testid="head-unit-settings">
      <SectionHeader title="Car head unit" />
      {headUnit && (
        <SwitchRow
          name="Car controls"
          description="This device looks like a car head unit: big previous, play and next buttons in the player bar, and swipe the song's cover left or right to skip."
          on={carControls}
          onToggle={() => setCarControls(!carControls)}
        />
      )}
      {supported ? (
        <>
          <SwitchRow
            name="Open Ember when this device starts"
            description="For a car head unit or a tablet that runs Ember itself: when it starts, Ember picks up your last queue, paused, ready for the play button."
            on={settings?.enabled ?? false}
            disabled={!settings || saving}
            onToggle={() => settings && void change({ ...settings, enabled: !settings.enabled })}
          />
          <SwitchRow
            name="And keep playing"
            description="Plays the last queue straight away when the device starts, instead of waiting paused."
            on={settings?.keepPlaying ?? false}
            disabled={!settings?.enabled || saving}
            onToggle={() => settings && void change({ ...settings, keepPlaying: !settings.keepPlaying })}
          />
        </>
      ) : (
        <p className="text-meta" data-testid="boot-start-update-app">{BOOT_START_UPDATE_APP_TEXT}</p>
      )}
    </section>
  );
}
