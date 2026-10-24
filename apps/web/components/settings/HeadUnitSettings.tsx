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
/** This server's address as the app reaches it: where /apk lives. */
const pageOrigin = () => window.location.origin;
const noOrigin = () => '';

/** "Use Ember on a car head unit": how to get the app onto one (the /apk
 *  address, route app/api/android/latest-apk) and what it needs. */
export function HeadUnitHelp({ origin }: { origin: string }) {
  const apk = `${origin}/apk`;
  return (
    <div className="rounded-2xl bg-card p-block shadow-soft" data-testid="head-unit-help">
      <div className="font-semibold">Use Ember on a car head unit</div>
      <p className="mt-inset text-sm text-muted-foreground">
        A head unit that runs Android apps can run Ember itself, so the music plays without your phone.
      </p>
      <ul className="mt-cluster flex list-disc flex-col gap-inset pl-block text-sm text-muted-foreground">
        <li>
          Get the app at <span className="font-mono text-foreground break-all" data-testid="head-unit-apk">{apk}</span>: open it in
          the head unit&apos;s browser, or download it on a computer, copy the file to a USB stick and open it in the head
          unit&apos;s file manager. Allow installing apps from that source when Android asks.
        </li>
        <li>
          Ember needs internet in the car: share your phone&apos;s hotspot with the head unit, or use one with a SIM
          card. Songs you have downloaded, and the ones Ember has cached, play without it.
        </li>
        <li>
          Sign in with your email and password, or, when the head unit shows a sign-in code, scan or type it on your
          phone in Settings &gt; Devices.
        </li>
        <li>
          On the head unit, turn on &quot;Open Ember when this device starts&quot; below. If the head unit has its own
          setting for apps to start with it (often called auto-start or start on boot), pick Ember there too: then the
          app opens for sure, not only the music.
        </li>
      </ul>
    </div>
  );
}

/** Settings > Devices, in the Android app only: using Ember on a device that
 *  runs it by itself, like a car head unit. On a head unit (lib/headUnit),
 *  the car layout's switch (on by default there); everywhere in the app,
 *  "Open Ember when this device starts", and with it "and keep playing"
 *  (both off by default), kept by the app (lib/bootStart). Plain on
 *  purpose, like the other switches. */
export function HeadUnitSettings() {
  const android = useSyncExternalStore(noSubscribe, isAndroidApp, () => false);
  const supported = useSyncExternalStore(noSubscribe, bootStartSupported, () => false);
  const [settings, setSettings] = useState<BootStartSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const headUnit = useIsHeadUnit();
  const origin = useSyncExternalStore(noSubscribe, pageOrigin, noOrigin);
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
      <HeadUnitHelp origin={origin} />
      {headUnit && (
        <SwitchRow
          name="Car layout"
          description="This device looks like a car head unit: a rail of big buttons on the left, big previous, play and next buttons in the player bar, and swipe the song's cover left or right to skip. Off: the normal layout, with a sidebar of big rows and playlist covers."
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
