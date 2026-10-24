import 'server-only';
import { serverLogger } from '@/lib/logger/server';
import { isNewer } from '@/lib/semver';
import {
  installAssetPattern,
  isInstallKind,
  parseReleaseTag,
  platformOfTarget,
  RELEASE_PLATFORMS,
  type Platform,
} from '@/lib/updatePolicy';

export { parseReleaseTag };

/** Desktop auto-update feed, backed by the GitHub Release.
 *
 *  The repo is private, so release assets need a token. That token lives HERE,
 *  on the host, never in the shipped app, where anyone could pull it out of
 *  the binary. The desktop app asks this server "is there something newer?",
 *  and downloads through /api/desktop/asset/<id>, which streams the bytes with
 *  the token attached server-side.
 *
 *  Set GITHUB_RELEASES_TOKEN (a fine-grained PAT with read-only Contents on
 *  this repo). Without it the feed simply reports "no update", the desktop
 *  app keeps working, it just never self-updates. */

const API_BASE = (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
const REPO = process.env.GITHUB_RELEASES_REPO || 'ParalelSt/ember';
const TOKEN = process.env.GITHUB_RELEASES_TOKEN || '';
// Briefly cached so a fleet of desktop apps checking at once doesn't burn the
// API rate limit. Overridable mainly so tests can exercise the failure paths,
// which a warm cache would otherwise hide.
const CACHE_MS = Number(process.env.UPDATE_CACHE_MS ?? 5 * 60 * 1000);
/** How long GitHub may take to start answering an asset download. */
export const ASSET_HEADERS_TIMEOUT_MS = 60_000;

export interface UpdateManifest {
  version: string;
  pub_date?: string;
  url: string;
  signature: string;
  notes?: string;
}

export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
  /** "sha256:<hex>", which GitHub reports for assets uploaded since mid 2025
   *  (absent on older ones). */
  digest?: string | null;
}
export interface Release {
  tag_name: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  assets?: ReleaseAsset[];
}

/** Every platform's releases come from one list: each shell has its own
 *  version and tag (windows-v0.4.26, android-v0.4.25, ...), and the shells
 *  from before that read the bare v0.4.x tags. Cached as a whole, so one
 *  GitHub request answers every platform. */
let cache: { at: number; releases: Release[] | null } | null = null;
/** The lookup under way, shared by every caller that needs it meanwhile. */
let inflight: Promise<Release[] | null> | null = null;

/** How long a good answer may still be served while a fresh one is fetched
 *  (stale-while-revalidate): a fleet of shells launching at once, or a
 *  GitHub hiccup, never makes a launch wait on GitHub. Off when the cache is
 *  (tests set UPDATE_CACHE_MS=0 to see every failure). */
const STALE_MS = CACHE_MS > 0 ? 6 * 60 * 60 * 1000 : 0;

export function isUpdateConfigured(): boolean {
  return TOKEN.length > 0;
}

function ghHeaders(): HeadersInit {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
  };
}

/** The release a platform updates to: published (not a draft or a
 *  pre-release), tagged for this platform or for everyone (a legacy bare
 *  vX.Y.Z), and the highest version among those. On a tie the platform's own
 *  tag wins. A platform never sees another platform's release. */
export function pickRelease(releases: readonly Release[], platform: Platform): Release | null {
  let best: { release: Release; version: string; own: boolean } | null = null;
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const tag = parseReleaseTag(release.tag_name);
    if (!tag || (tag.platform !== null && tag.platform !== platform)) continue;
    const own = tag.platform !== null;
    if (!best || isNewer(tag.version, best.version) || (!isNewer(best.version, tag.version) && own && !best.own)) {
      best = { release, version: tag.version, own };
    }
  }
  return best?.release ?? null;
}

/** The version a release tag stands for ("windows-v0.4.26" -> "0.4.26"). */
export function releaseVersion(release: Pick<Release, 'tag_name'>): string {
  return parseReleaseTag(release.tag_name)?.version ?? release.tag_name.replace(/^v/, '');
}

async function fetchReleases(): Promise<Release[] | null> {
  // A failure keeps the last good answer while it is fresh enough to serve
  // stale, so one bad minute at GitHub does not read as "no update".
  const keepGood = (): Release[] | null => {
    const good = cache?.releases && Date.now() - cache.at < STALE_MS ? cache.releases : null;
    cache = good ? { at: cache!.at, releases: good } : { at: Date.now(), releases: null };
    return good;
  };
  try {
    // 30: five platforms releasing on their own push a platform's newest
    // release further down the list than one shared release did.
    const res = await fetch(`${API_BASE}/repos/${REPO}/releases?per_page=30`, {
      headers: ghHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      serverLogger.error('update', `GitHub releases ${res.status}`, { repo: REPO });
      return keepGood();
    }
    const body: unknown = await res.json();
    const releases = Array.isArray(body) ? (body as Release[]) : [];
    cache = { at: Date.now(), releases };
    return releases;
  } catch (e) {
    serverLogger.error('update', 'could not reach GitHub', undefined, e);
    return keepGood();
  }
}

function refresh(): Promise<Release[] | null> {
  if (inflight) return inflight;
  const p: Promise<Release[] | null> = fetchReleases().finally(() => {
    if (inflight === p) inflight = null;
  });
  inflight = p;
  return p;
}

/** The cached release list (stale-while-revalidate), null when unknown. */
async function releaseList(): Promise<Release[] | null> {
  if (!TOKEN) return null;
  const age = cache ? Date.now() - cache.at : Infinity;
  if (cache && age < CACHE_MS) return cache.releases;
  if (cache?.releases && age < STALE_MS) {
    void refresh();
    return cache.releases;
  }
  return refresh();
}

/** The release `platform` updates to (pickRelease). Shared with the Android
 *  app's feed (lib/androidUpdate.ts) and the launch gate's
 *  (app/api/app/update), so all of them read one cached copy. */
export async function latestRelease(platform: Platform): Promise<Release | null> {
  const releases = await releaseList();
  return releases ? pickRelease(releases, platform) : null;
}

/** latestRelease(), but never waiting longer than `ms`: the launch gate has
 *  a budget of about a second and a half, so a cold cache answers
 *  `undefined` ("could not tell in time") while the lookup carries on and
 *  warms the cache for the next launch. */
export async function latestReleaseWithin(ms: number, platform: Platform): Promise<Release | null | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([latestRelease(platform), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Fill the cache at server start, so the first launch after a restart is
 *  answered from memory. One request covers every platform. */
export function warmReleaseCache(): void {
  if (!TOKEN) return;
  void releaseList().catch(() => {});
}

/** The current release of each of `platforms`, once each (a legacy
 *  release can be current for several). The asset proxies serve files of
 *  these and of nothing else. */
export async function currentReleases(platforms: readonly Platform[] = RELEASE_PLATFORMS): Promise<Release[]> {
  const releases = await releaseList();
  if (!releases) return [];
  const current = new Set<Release>();
  for (const platform of platforms) {
    const release = pickRelease(releases, platform);
    if (release) current.add(release);
  }
  return [...current];
}

/** The asset with this id when it belongs to the current release of one of
 *  `platforms` and `accept` says it is a file that proxy serves, else null. */
export async function currentAsset(
  id: number,
  accept: (name: string) => boolean,
  platforms: readonly Platform[],
): Promise<ReleaseAsset | null> {
  for (const release of await currentReleases(platforms)) {
    const asset = release.assets?.find((a) => a.id === id);
    if (asset) return accept(asset.name) ? asset : null;
  }
  return null;
}

/** Tests only. */
export function _resetReleaseCache(): void {
  cache = null;
  inflight = null;
}

/** The files of a release the updater itself ever needs: each platform's
 *  update bundle, its signature, and a latest.json manifest. Since the launch
 *  gate, a shell installed from the .msi, .deb or .rpm updates from its own
 *  kind of package (a per-user setup.exe over a per-machine .msi would make a
 *  second copy; an AppImage over a .deb would not install at all), so those
 *  count too. The .dmg and the APK are not among them. */
const UPDATER_ASSET_NAMES: RegExp[] = [
  /macos-[\w.-]+\.app\.tar\.gz(\.sig)?$/,
  /windows-(x64|arm64)-setup\.exe(\.sig)?$/,
  /windows-x64\.msi(\.sig)?$/,
  /linux-[\w.-]+\.AppImage(\.sig)?$/,
  /linux-amd64\.deb(\.sig)?$/,
  /linux-x86_64\.rpm(\.sig)?$/,
  /^latest\.json$/,
];

const DESKTOP_PLATFORMS: readonly Platform[] = ['windows', 'macos', 'linux'];

export function isUpdaterAssetName(name: string): boolean {
  return UPDATER_ASSET_NAMES.some((re) => re.test(name));
}

/** The asset with this id when it belongs to a desktop platform's current
 *  release AND is one the updater needs, else null. The asset proxy asks this first,
 *  so the host's token only ever fetches the current updates' own files,
 *  never an arbitrary id from the repo (security audit 2026-09-25, M3). */
export async function updaterAsset(id: number): Promise<ReleaseAsset | null> {
  return currentAsset(id, isUpdaterAssetName, DESKTOP_PLATFORMS);
}

/** Which asset a given platform updates FROM. Note these are not the files a
 *  human downloads: macOS updates from the .app.tar.gz, not the .dmg.
 *  `bundle` is the install kind the shell reports ({{bundle_type}} in the
 *  updater endpoint); shells from before it send none and get what they
 *  always got. */
function assetPattern(target: string, arch: string, bundle: string | null): RegExp | null {
  const platform = platformOfTarget(target);
  if (!platform) return null;
  const install = isInstallKind(bundle) ? bundle : null;
  return installAssetPattern(platform, install, arch.toLowerCase());
}

/** The manifest Tauri's updater expects, or null when there's nothing newer
 *  (the route turns that into a 204). */
export async function updateFor(
  target: string,
  arch: string,
  currentVersion: string,
  origin: string,
  bundle: string | null = null,
): Promise<UpdateManifest | null> {
  const platform = platformOfTarget(target);
  if (!platform) return null;
  const release = await latestRelease(platform);
  if (!release) return null;

  const version = releaseVersion(release);
  if (!isNewer(version, currentVersion)) return null;

  const pattern = assetPattern(target, arch, bundle);
  if (!pattern) return null;

  const assets = release.assets ?? [];
  const asset = assets.find((x) => pattern.test(x.name));
  if (!asset) {
    serverLogger.error('update', 'no asset for platform', { target, arch, bundle, tag: release.tag_name });
    return null;
  }

  // Tauri verifies this signature against the pubkey compiled into the app.
  // Without it the update is refused, so a missing .sig means no update rather
  // than an unverifiable one.
  const sigAsset = assets.find((x) => x.name === `${asset.name}.sig`);
  if (!sigAsset) {
    serverLogger.error('update', 'asset has no .sig', { asset: asset.name });
    return null;
  }
  const signature = await fetchAssetText(sigAsset.id);
  if (!signature) return null;

  return {
    version,
    pub_date: release.published_at,
    url: `${origin}/api/desktop/asset/${asset.id}`,
    signature: signature.trim(),
    notes: release.body?.slice(0, 2000) || release.name || `Ember ${release.tag_name}`,
  };
}

async function fetchAssetText(id: number): Promise<string | null> {
  const res = await fetchAsset(id);
  if (!res || !res.ok) return null;
  return res.text();
}

/** Raw asset bytes from GitHub, with the host's token. Used by the manifest
 *  (for .sig files) and by the asset-proxy route (for installers), which
 *  checks the id with updaterAsset first. */
export async function fetchAsset(id: number): Promise<Response | null> {
  if (!TOKEN) return null;
  // The timeout covers GitHub answering, not the transfer: a signal that
  // stays armed also cuts the body, and an APK over a phone's mobile data
  // (or an installer on a slow line) can take longer than a minute.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSET_HEADERS_TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE}/repos/${REPO}/releases/assets/${id}`, {
      headers: { ...ghHeaders(), accept: 'application/octet-stream' },
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (e) {
    serverLogger.error('update', 'asset fetch failed', { id }, e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
