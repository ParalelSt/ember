import 'server-only';
import { latestRelease, type ReleaseAsset } from '@/lib/desktopUpdate';
import { serverLogger } from '@/lib/logger/server';
import { isNewer, parseVersion } from '@/lib/semver';

/** The Android app's update feed, from the same GitHub Release (and the same
 *  cached lookup) as the desktop feed in lib/desktopUpdate.ts.
 *
 *  The phone app (AppUpdater.kt) asks GET /api/android/update?version=0.4.18
 *  and downloads the APK through /api/android/apk/<id>, which streams it with
 *  the host's token attached. Nothing here is trusted by the phone: it
 *  installs only an APK for app.ember.music, with a higher versionCode,
 *  signed with the key the installed app was signed with (UpdateRules.kt),
 *  and Android refuses a different key on its own as well. */

/** The release asset the phone updates from: Ember-v0.4.19-android.apk. */
export const ANDROID_APK_NAME = /^Ember-v?\d+\.\d+\.\d+-android\.apk$/;

export function isAndroidApkName(name: string): boolean {
  return ANDROID_APK_NAME.test(name);
}

export interface AndroidUpdate {
  /** "0.4.19": the release tag without its v, the APK's versionName. */
  version: string;
  /** Android's versionCode when the release says it; null otherwise. The
   *  phone reads the real one from the downloaded APK before installing. */
  versionCode: number | null;
  /** A path on this server (the APK proxy). The phone resolves it against
   *  the server URL it was built for, which is the one it can reach. */
  url: string;
  size: number;
  /** Lowercase hex, when GitHub reported a digest for the asset. */
  sha256: string | null;
  notes?: string;
  publishedAt?: string;
}

/** The hex half of GitHub's "sha256:<hex>" asset digest, or null. */
export function sha256Of(asset: Pick<ReleaseAsset, 'digest'>): string | null {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? '');
  return m ? m[1].toLowerCase() : null;
}

/** "versionCode: 24" (or "versionCode=24") anywhere in the release notes.
 *  The release workflow does not write one today, so this is usually null;
 *  it is here so a release can state it without a server change. */
export function versionCodeFrom(notes: string | undefined): number | null {
  const m = /\bversionCode\s*[:=]\s*(\d{1,9})\b/i.exec(notes ?? '');
  return m ? Number(m[1]) : null;
}

/** A plain x.y.z version from the query, or null when it is not one. */
export function cleanVersion(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().replace(/^v/, '');
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(s)) return null;
  return parseVersion(s).join('.');
}

/** The update for a phone on `currentVersion`, or null when there is nothing
 *  newer, no release, or no APK on the latest one (the route says 204). */
export async function androidUpdateFor(currentVersion: string): Promise<AndroidUpdate | null> {
  const release = await latestRelease();
  if (!release) return null;

  const version = release.tag_name.replace(/^v/, '');
  if (!isNewer(version, currentVersion)) return null;

  const asset = (release.assets ?? []).find((a) => isAndroidApkName(a.name));
  if (!asset) {
    serverLogger.error('update', 'latest release has no android apk', { tag: release.tag_name });
    return null;
  }

  return {
    version,
    versionCode: versionCodeFrom(release.body),
    url: `/api/android/apk/${asset.id}`,
    size: asset.size,
    sha256: sha256Of(asset),
    notes: release.body?.slice(0, 2000) || release.name || `Ember ${release.tag_name}`,
    publishedAt: release.published_at,
  };
}

/** The asset with this id when it is the latest published release's APK,
 *  else null: the APK proxy serves that one file and nothing else, so the
 *  host's token never fetches an arbitrary asset of the repo. */
export async function androidApkAsset(id: number): Promise<ReleaseAsset | null> {
  const release = await latestRelease();
  const asset = release?.assets?.find((a) => a.id === id);
  return asset && isAndroidApkName(asset.name) ? asset : null;
}
