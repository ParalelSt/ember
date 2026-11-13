'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { BlockIcon, BugIcon, MusicIcon, RequestIcon, UploadIcon } from '@/components/icons';
import { Artwork } from '@/components/primitives/Artwork';
import { EqualizerPanel } from '@/components/settings/EqualizerPanel';
import { RequestDialog } from '@/components/RequestDialog';
import { useBlockedTracks } from '@/hooks/useBlockedTracks';
import { useDesktopPlugins } from '@/hooks/useDesktopPlugins';
import { usePartyEligible } from '@/hooks/usePartyEligible';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUiStore } from '@/stores/useUiStore';
import { cn } from '@/lib/utils';
import { SettingsGroup, SettingsRow, SettingsSwitchRow, useRowsVariant } from './rows';

/* The desktop row versions of Plugins, Help and Library: the same settings,
 * stores and actions as their pages under app/(app)/settings, drawn as
 * rows. The phone keeps those pages. */

export function PluginsSection() {
  const desktopPlugins = useDesktopPlugins();
  const partyEligible = usePartyEligible();
  const rows = useRowsVariant();
  const s = useSettingsStore();
  return (
    <SettingsGroup title="Plugins" footer="Optional add-ons that layer on top of the player. More to come.">
      <SettingsSwitchRow
        title="Normalize volume"
        description="Evens out the loudness between songs without making the app quieter: extra-loud songs come down a little, quiet ones come up where they can."
        checked={s.normalizeVolume}
        onCheckedChange={(v) => void s.setNormalizeVolume(v)}
      />
      <EqualizerPanel className={rows === 'C' ? 'py-block' : 'py-row'} />
      {desktopPlugins && partyEligible && (
        <SettingsSwitchRow
          title="Party-size volume slider"
          tag="PC only"
          description="A wider slider in the player bar that can go above 100% for parties."
          checked={s.partyVolume}
          onCheckedChange={(v) => void s.setPartyVolume(v)}
        />
      )}
      {desktopPlugins && (
        <SettingsSwitchRow
          title="Songsterr integration"
          tag="Work in progress"
          description="Guitar tabs and guitar mode for the currently-playing track."
          checked={s.tabsEnabled}
          onCheckedChange={(v) => void s.setTabsEnabled(v)}
        />
      )}
      {desktopPlugins && (
        <SettingsRow
          className="opacity-60"
          title={<span className="line-through">TikTok window</span>}
          description={<span className="line-through">Pinned side panel for TikTok while you listen.</span>}
          control={<span className="text-eyebrow">Coming soon</span>}
        />
      )}
    </SettingsGroup>
  );
}

export function HelpSection() {
  const openBugReport = useUiStore((s) => s.setBugReportOpen);
  const [requestOpen, setRequestOpen] = useState(false);
  const autoReportEnabled = useSettingsStore((s) => s.autoReportEnabled);
  const setAutoReportEnabled = useSettingsStore((s) => s.setAutoReportEnabled);
  return (
    <SettingsGroup title="Help">
      <SettingsRow
        title="Report a bug"
        description="Send your last session's diagnostics with an optional note. Goes straight to the project's Discord."
        control={
          <Button variant="outline" onClick={() => openBugReport(true)}>
            <BugIcon className="size-4" />
            Report a bug
          </Button>
        }
      />
      <SettingsRow
        title="Send a request"
        description="Suggest a new feature or a fix. Goes straight to the project's Discord."
        control={
          <Button variant="outline" onClick={() => setRequestOpen(true)}>
            <RequestIcon className="size-4" />
            Send a request
          </Button>
        }
      />
      <SettingsSwitchRow
        title="Send crash reports automatically"
        description="When something crashes, quietly send the same diagnostics as a bug report (no note), a few per session at most."
        checked={autoReportEnabled}
        onCheckedChange={setAutoReportEnabled}
      />
      <RequestDialog open={requestOpen} onOpenChange={setRequestOpen} />
    </SettingsGroup>
  );
}

const TRANSFER_HREF = `/transfer?from=${encodeURIComponent('/settings/library')}`;

export function LibrarySection() {
  const { blocked, unblock } = useBlockedTracks();
  return (
    <div className="flex flex-col gap-section">
      <SettingsGroup title="Transfer">
        <SettingsRow
          title="Transfer from another app"
          description="Bring the songs you liked on Spotify, Apple Music or anywhere else into Ember: a data export, a CSV, a list of songs or a public playlist link."
          control={
            <Link href={TRANSFER_HREF} className={cn(buttonVariants({ variant: 'outline' }))} data-testid="settings-transfer-button">
              <UploadIcon className="size-4" />
              Transfer
            </Link>
          }
        />
      </SettingsGroup>
      <SettingsGroup
        title="Blocked songs"
        footer="These never come up in radio, mixes or suggestions. You can still play them yourself. Block a song from its ⋯ menu."
      >
        {blocked.length === 0 ? (
          <SettingsRow
            title={
              <span className="flex items-center gap-cluster font-normal text-muted-foreground">
                <BlockIcon className="size-4" /> No blocked songs.
              </span>
            }
          />
        ) : (
          blocked.map((t) => (
            <SettingsRow
              key={t.id}
              leading={
                <Artwork src={t.artworkUrl} className="size-10 shrink-0 rounded-md bg-art">
                  <div className="grid size-full place-items-center text-foreground/30">
                    <MusicIcon className="size-4" />
                  </div>
                </Artwork>
              }
              title={<span className="block truncate text-sm">{t.title}</span>}
              description={<span className="block truncate text-xs">{t.artist}</span>}
              control={
                <Button variant="outline" size="sm" onClick={() => void unblock(t)} aria-label={`Unblock ${t.title}`}>
                  Unblock
                </Button>
              }
            />
          ))
        )}
      </SettingsGroup>
    </div>
  );
}
