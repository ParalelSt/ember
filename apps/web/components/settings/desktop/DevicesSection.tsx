'use client';

import { CameraIcon, ScanQrIcon, ShieldWarningIcon } from '@/components/icons';
import { SCAN_QR_LABEL } from '@/components/auth/ScanQrButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DeviceIcon, Pill, SignOutEverywhereConfirm, useDevices } from '@/components/settings/DevicesPanel';
import {
  BOOT_START_TEXT,
  BOOT_START_UPDATE_APP_TEXT,
  CAR_LAYOUT_TEXT,
  HeadUnitHelp,
  KEEP_PLAYING_TEXT,
  useHeadUnitSettings,
} from '@/components/settings/HeadUnitSettings';
import { formatSince } from '@/lib/format';
import { describeDevice, deviceTitle } from '@/lib/qrLogin/deviceName';
import { cn } from '@/lib/utils';
import { SettingsGroup, SettingsRow, SettingsSwitchRow } from './rows';

const ICON_TILE = 'grid size-10 shrink-0 place-items-center rounded-md';

/** The head unit switches as rows, in the Android app only. */
function HeadUnitRows() {
  const { android, supported, settings, saving, headUnit, origin, carControls, setCarControls, change } = useHeadUnitSettings();
  if (!android) return null;
  return (
    <SettingsGroup title="Car head unit" testId="head-unit-settings">
      <HeadUnitHelp origin={origin} bare />
      {headUnit && (
        <SettingsSwitchRow title="Car layout" description={CAR_LAYOUT_TEXT} checked={carControls} onCheckedChange={() => setCarControls(!carControls)} />
      )}
      {supported ? (
        <>
          <SettingsSwitchRow
            title="Open Ember when this device starts"
            description={BOOT_START_TEXT}
            checked={settings?.enabled ?? false}
            disabled={!settings || saving}
            onCheckedChange={() => settings && void change({ ...settings, enabled: !settings.enabled })}
          />
          <SettingsSwitchRow
            title="And keep playing"
            description={KEEP_PLAYING_TEXT}
            checked={settings?.keepPlaying ?? false}
            disabled={!settings?.enabled || saving}
            onCheckedChange={() => settings && void change({ ...settings, keepPlaying: !settings.keepPlaying })}
          />
        </>
      ) : (
        <SettingsRow title="Open Ember when this device starts" description={<span data-testid="boot-start-update-app">{BOOT_START_UPDATE_APP_TEXT}</span>} />
      )}
    </SettingsGroup>
  );
}

/** Desktop Settings > Devices as rows: the same sign-in, device list and
 *  Sign out everywhere as the phone panel (components/settings/DevicesPanel). */
export function DevicesSection() {
  const d = useDevices();
  const {
    canScan,
    setQrScan,
    typed,
    setTyped,
    codeOpen,
    setCodeOpen,
    codeError,
    setCodeError,
    submitCode,
    showCode,
    recent,
    rows,
    fresh,
    freshRef,
    here,
    hereKind,
    appVersion,
    webVersion,
    setConfirming,
    setRevokeError,
  } = d;

  return (
    <div className="flex flex-col gap-section">
      <SettingsGroup title="This device" testId="this-device">
        <SettingsRow
          leading={
            <span aria-hidden className={cn(ICON_TILE, 'bg-ember/15 text-ember')}>
              <DeviceIcon kind={hereKind} className="size-5" />
            </span>
          }
          title={here ? deviceTitle(here) : 'This browser'}
          control={
            <>
              <Pill tone="ember">Active now</Pill>
              {webVersion && webVersion !== 'unknown' && <Pill>Web {webVersion}</Pill>}
              {appVersion && <Pill>App {appVersion}</Pill>}
            </>
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Sign in another device" testId="signin-card">
        <SettingsRow
          leading={
            <span aria-hidden className={cn(ICON_TILE, 'bg-secondary text-foreground')}>
              <ScanQrIcon className="size-5" />
            </span>
          }
          title={canScan ? 'Scan the code on the new device' : 'Type the code from the new device'}
          description={
            canScan
              ? 'Open Ember on the new device, then scan the QR code it shows.'
              : 'Open Ember on the new device, then type the code it shows here.'
          }
          control={
            canScan ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  aria-expanded={codeOpen}
                  onClick={() => {
                    setCodeOpen((o) => !o);
                    setCodeError('');
                  }}
                >
                  {codeOpen ? 'Hide code entry' : 'Type the code instead'}
                </Button>
                <Button type="button" variant="ember" data-testid="scan-qr" onClick={() => setQrScan('native')}>
                  <CameraIcon className="size-4" />
                  {SCAN_QR_LABEL}
                </Button>
              </>
            ) : undefined
          }
        >
          {showCode && (
            <form onSubmit={submitCode} className="mt-cluster flex max-w-sm gap-cluster">
              <Label htmlFor="qr-code-input" className="sr-only">
                Code
              </Label>
              <Input
                id="qr-code-input"
                value={typed}
                onChange={(e) => setTyped(e.target.value.toUpperCase())}
                placeholder="ABCD-EFGH"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={12}
                aria-invalid={codeError ? true : undefined}
                className="min-w-0 flex-1 font-mono tracking-widest"
              />
              <Button type="submit" variant="outline">
                Continue
              </Button>
            </form>
          )}
          {codeError && (
            <div role="alert" className="mt-cluster text-sm font-semibold text-destructive">
              {codeError}
            </div>
          )}
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Other devices"
        testId="other-devices"
        aside={
          recent !== null && (
            <span data-testid="other-count" className="text-xs text-muted-foreground">
              {rows.length}
            </span>
          )
        }
        footer="Signed in with a code in the last 30 days."
      >
        {rows.length > 0 ? (
          <ul className="flex flex-col gap-cluster">
            {rows.map((s) => {
              const isNew = s.id === fresh?.id;
              return (
                <li
                  key={s.id}
                  ref={isNew ? freshRef : undefined}
                  data-testid={isNew ? 'device-new' : 'device-row'}
                  className={cn(isNew && 'ember-just-approved -mx-row rounded-lg bg-ember/10 px-row')}
                >
                  <SettingsRow
                    leading={
                      <span aria-hidden className={cn(ICON_TILE, isNew ? 'bg-ember/15 text-ember' : 'bg-secondary text-muted-foreground')}>
                        <DeviceIcon kind={describeDevice(s.device).kind} className="size-5" />
                      </span>
                    }
                    title={
                      <span className="flex min-w-0 items-center gap-cluster">
                        <span className="truncate">{deviceTitle(s.device)}</span>
                        {isNew && <Pill tone="solid">New</Pill>}
                      </span>
                    }
                    description={
                      <>
                        Signed in {isNew ? 'just now' : formatSince(s.at) || 'recently'}
                        {' · '}
                        <span className={s.sameNetwork ? undefined : 'text-destructive'}>
                          {s.sameNetwork ? 'Same network' : 'Different network'}
                        </span>
                      </>
                    }
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <SettingsRow
            title={
              <span className="font-normal text-muted-foreground">
                {recent === null ? 'Loading...' : 'No other devices signed in with a code yet.'}
              </span>
            }
          />
        )}
      </SettingsGroup>

      <SettingsGroup title="Danger zone" testId="danger-zone">
        <SettingsRow
          leading={
            <span aria-hidden className={cn(ICON_TILE, 'bg-destructive/10 text-destructive')}>
              <ShieldWarningIcon className="size-5" />
            </span>
          }
          title="Sign out everywhere"
          description="Lost a phone, or signed in somewhere you no longer use? End every session of your account."
          control={
            <Button
              variant="outline"
              className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                setRevokeError('');
                setConfirming(true);
              }}
            >
              Sign out everywhere
            </Button>
          }
        />
      </SettingsGroup>

      <HeadUnitRows />

      <SignOutEverywhereConfirm d={d} />
    </div>
  );
}
