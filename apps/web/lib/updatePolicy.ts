import { isNewer, parseVersion } from '@/lib/semver';

/** What the launch gate of each native shell is told (GET /api/app/update).
 *
 *  Plain functions of the latest release, the caller's platform and version,
 *  and the host's environment, so every answer is tested without GitHub.
 *  No server-only imports: the route (app/api/app/update/route.ts) does the
 *  fetching and the logging.
 *
 *  Policy travels with the release, as markers in its notes, like the
 *  existing `versionCode:` marker (lib/androidUpdate.ts):
 *
 *      mandatory: true            every shell older than this release must update
 *      minVersion: 0.4.20         shells older than this must update
 *      minVersion.windows: 0.4.20 the same, for one platform (wins over the above)
 *
 *  The markers are stripped from the notes the shells show. The host can
 *  pause every feed (EMBER_UPDATES_PAUSED=all, or a list of platforms) and
 *  raise a platform's minimum (EMBER_MIN_VERSION_<PLATFORM>) without a
 *  release. */

export const PLATFORMS = ['windows', 'macos', 'linux', 'android', 'ios', 'web'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** How the shell was installed; decides which file updates it. */
export const INSTALLS = ['nsis', 'msi', 'appimage', 'deb', 'rpm', 'app', 'apk', 'testflight'] as const;
export type InstallKind = (typeof INSTALLS)[number];

export type UpdateAction = 'install' | 'download-page';
export type UpdateReason = 'min-version' | 'flagged' | null;

export interface PolicyAsset {
  id: number;
  name: string;
  size: number;
}

export interface PolicyRelease {
  tag_name: string;
  name?: string;
  body?: string;
  assets?: PolicyAsset[];
}

export interface UpdateOffer {
  version: string;
  mandatory: boolean;
  reason: UpdateReason;
  action: UpdateAction;
  size: number | null;
  notes: string;
  /** For download-page: where the person gets the installer. */
  url: string | null;
}

export interface AppUpdateAnswer {
  platform: Platform;
  current: string;
  latest: string | null;
  minVersion: string | null;
  update: UpdateOffer | null;
  checkAfter: number;
  paused?: true;
  unavailable?: true;
}

/** Seconds until a background check is worth repeating (clients may ignore
 *  it in v1). */
export const CHECK_AFTER_S = 6 * 60 * 60;
export const MAX_NOTES = 300;

export function isPlatform(v: unknown): v is Platform {
  return typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v);
}

export function isInstallKind(v: unknown): v is InstallKind {
  return typeof v === 'string' && (INSTALLS as readonly string[]).includes(v);
}

/** The platform a Tauri updater target names ("darwin", "windows",
 *  "linux", with or without an arch suffix). */
export function platformOfTarget(target: string): Platform | null {
  const t = target.toLowerCase();
  if (t.startsWith('darwin') || t.startsWith('macos')) return 'macos';
  if (t.startsWith('windows')) return 'windows';
  if (t.startsWith('linux')) return 'linux';
  return null;
}

/** EMBER_UPDATES_PAUSED: "all", "1", or a comma list of platforms. While a
 *  platform is paused every feed for it answers "no update". */
export function isPaused(platform: Platform, env: Record<string, string | undefined> = process.env): boolean {
  const raw = (env.EMBER_UPDATES_PAUSED ?? '').trim().toLowerCase();
  if (!raw) return false;
  if (raw === 'all' || raw === '1' || raw === 'true') return true;
  return raw.split(/[\s,]+/).includes(platform);
}

// ── Release-notes markers ───────────────────────────────────────────────

const MANDATORY_RE = /^\s*mandatory\s*[:=]\s*(true|yes|1)\s*$/im;
const MIN_RE = /^\s*minVersion(?:\.([a-z]+))?\s*[:=]\s*v?(\d{1,4}\.\d{1,4}\.\d{1,4})\s*$/gim;
const MARKER_LINE_RE = /^\s*(?:mandatory|minVersion(?:\.[a-z]+)?|versionCode)\s*[:=].*$/gim;

export interface Markers {
  mandatory: boolean;
  /** For every platform, unless one has its own. */
  minVersion: string | null;
  minVersionFor: Partial<Record<Platform, string>>;
}

export function parseMarkers(body: string | undefined): Markers {
  const text = body ?? '';
  const out: Markers = { mandatory: MANDATORY_RE.test(text), minVersion: null, minVersionFor: {} };
  for (const m of text.matchAll(MIN_RE)) {
    const platform = m[1]?.toLowerCase();
    const version = parseVersion(m[2]).join('.');
    if (!platform) out.minVersion = version;
    else if (isPlatform(platform)) out.minVersionFor[platform] = version;
  }
  return out;
}

/** The notes a shell shows: markers gone, Markdown noise trimmed, one
 *  paragraph's worth. */
export function plainNotes(release: Pick<PolicyRelease, 'body' | 'name' | 'tag_name'>): string {
  const text = (release.body ?? '')
    .replace(MARKER_LINE_RE, '')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  const notes = text || release.name || `Ember ${release.tag_name}`;
  return notes.length > MAX_NOTES ? `${notes.slice(0, MAX_NOTES - 3).trimEnd()}...` : notes;
}

/** The minimum version for a platform: host env over the release's
 *  per-platform marker over its general one. A minimum above the release
 *  itself is a mistake (nothing could satisfy it) and is ignored; `errors`
 *  says so for the logs. */
export function minVersionFor(
  platform: Platform,
  markers: Markers,
  latest: string,
  env: Record<string, string | undefined> = process.env,
  errors: string[] = [],
): string | null {
  const fromEnv = (env[`EMBER_MIN_VERSION_${platform.toUpperCase()}`] ?? '').trim().replace(/^v/, '');
  const candidates: Array<[string, string | null | undefined]> = [
    ['env', /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(fromEnv) ? fromEnv : null],
    ['release', markers.minVersionFor[platform]],
    ['release', markers.minVersion],
  ];
  for (const [source, v] of candidates) {
    if (!v) continue;
    if (isNewer(v, latest)) {
      errors.push(`minVersion ${v} (${source}) is above the latest release ${latest}, ignored`);
      continue;
    }
    return parseVersion(v).join('.');
  }
  return null;
}

// ── Which file updates which install ────────────────────────────────────

/** The release asset a shell installs from, by platform and install kind.
 *  Mirrors the names the release job gives them (.github/workflows). */
export function installAssetPattern(platform: Platform, install: InstallKind | null, arch: string | null): RegExp | null {
  switch (platform) {
    case 'macos':
      return /macos-[\w.-]+\.app\.tar\.gz$/;
    case 'windows':
      if (install === 'msi') return /windows-x64\.msi$/;
      return (arch ?? '').includes('aarch64') ? /windows-arm64-setup\.exe$/ : /windows-x64-setup\.exe$/;
    case 'linux':
      if (install === 'deb') return /linux-amd64\.deb$/;
      if (install === 'rpm') return /linux-x86_64\.rpm$/;
      return /linux-[\w.-]+\.AppImage$/;
    case 'android':
      return /^Ember-v?\d+\.\d+\.\d+-android\.apk$/;
    default:
      return null;
  }
}

/** Whether the asset can be installed by the shell itself: desktop bundles
 *  need their signature next to them (Tauri refuses anything unsigned); the
 *  phone checks the APK's own signing key, so it needs none. */
function hasSignature(platform: Platform, asset: PolicyAsset, assets: PolicyAsset[]): boolean {
  if (platform === 'android') return true;
  return assets.some((a) => a.name === `${asset.name}.sig`);
}

export interface DecideInput {
  release: PolicyRelease | null;
  platform: Platform;
  install: InstallKind | null;
  arch: string | null;
  current: string;
  env?: Record<string, string | undefined>;
  /** For download-page offers that point at the server's own asset proxy. */
  origin?: string;
  /** Problems worth an error line in the server log (a bad minVersion, a
   *  release with nothing for this platform). */
  errors?: string[];
}

/** The whole answer for one shell. Never throws; anything it cannot work
 *  out is "no update". */
export function decideUpdate(input: DecideInput): AppUpdateAnswer {
  const { release, platform, install, arch, current } = input;
  const env = input.env ?? process.env;
  const errors = input.errors ?? [];
  const base: AppUpdateAnswer = { platform, current, latest: null, minVersion: null, update: null, checkAfter: CHECK_AFTER_S };

  if (isPaused(platform, env)) return { ...base, paused: true };
  if (!release) return { ...base, unavailable: true };

  const latest = release.tag_name.replace(/^v/, '');
  const markers = parseMarkers(release.body);
  const minVersion = minVersionFor(platform, markers, latest, env, errors);
  const answer: AppUpdateAnswer = { ...base, latest, minVersion };

  // iOS cannot install anything itself and has no TestFlight yet (owner
  // decision D5), and a browser is always on the current web build.
  if (platform === 'ios' || platform === 'web') return answer;
  if (!isNewer(latest, current)) return answer;

  const pattern = installAssetPattern(platform, install, arch);
  const assets = release.assets ?? [];
  const asset = pattern ? assets.find((a) => pattern.test(a.name)) : undefined;

  const belowMin = minVersion !== null && isNewer(minVersion, current);
  const mandatory = belowMin || markers.mandatory;
  const reason: UpdateReason = belowMin ? 'min-version' : markers.mandatory ? 'flagged' : null;
  const offer = (action: UpdateAction, url: string | null, size: number | null): AppUpdateAnswer => ({
    ...answer,
    update: { version: latest, mandatory, reason, action, size, notes: plainNotes(release), url },
  });

  if (asset && hasSignature(platform, asset, assets)) return offer('install', null, asset.size);

  // A .deb or .rpm the shell cannot install itself (no signature on the
  // release) is still worth a notice with a way to get it.
  if (platform === 'linux' && (install === 'deb' || install === 'rpm')) {
    const page = (env.LINUX_DOWNLOAD_URL ?? '').trim();
    if (page) return offer('download-page', page, asset?.size ?? null);
    if (asset && input.origin) return offer('download-page', `${input.origin}/api/desktop/asset/${asset.id}`, asset.size);
  }
  errors.push(`release ${release.tag_name} has nothing ${platform}/${install ?? 'default'} can install`);
  return answer;
}
