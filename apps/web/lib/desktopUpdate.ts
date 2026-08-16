import 'server-only';
import { serverLogger } from '@/lib/logger/server';

/** Desktop auto-update feed, backed by the GitHub Release.
 *
 *  The repo is private, so release assets need a token. That token lives HERE,
 *  on the host — never in the shipped app, where anyone could pull it out of
 *  the binary. The desktop app asks this server "is there something newer?",
 *  and downloads through /api/desktop/asset/<id>, which streams the bytes with
 *  the token attached server-side.
 *
 *  Set GITHUB_RELEASES_TOKEN (a fine-grained PAT with read-only Contents on
 *  this repo). Without it the feed simply reports "no update" — the desktop
 *  app keeps working, it just never self-updates. */

const API_BASE = (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
const REPO = process.env.GITHUB_RELEASES_REPO || 'ParalelSt/ember';
const TOKEN = process.env.GITHUB_RELEASES_TOKEN || '';
// Briefly cached so a fleet of desktop apps checking at once doesn't burn the
// API rate limit. Overridable mainly so tests can exercise the failure paths,
// which a warm cache would otherwise hide.
const CACHE_MS = Number(process.env.UPDATE_CACHE_MS ?? 5 * 60 * 1000);

export interface UpdateManifest {
  version: string;
  pub_date?: string;
  url: string;
  signature: string;
  notes?: string;
}

interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
}
interface Release {
  tag_name: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  assets?: ReleaseAsset[];
}

let cache: { at: number; release: Release | null } | null = null;

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

/** Latest published (non-draft, non-prerelease) release. */
async function latestRelease(): Promise<Release | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.release;
  if (!TOKEN) return null;

  try {
    const res = await fetch(`${API_BASE}/repos/${REPO}/releases?per_page=10`, {
      headers: ghHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      serverLogger.error('update', `GitHub releases ${res.status}`, { repo: REPO });
      cache = { at: Date.now(), release: null };
      return null;
    }
    const all = (await res.json()) as Release[];
    const release = all.find((r) => !r.draft && !r.prerelease) ?? null;
    cache = { at: Date.now(), release };
    return release;
  } catch (e) {
    serverLogger.error('update', 'could not reach GitHub', undefined, e);
    cache = { at: Date.now(), release: null };
    return null;
  }
}

/** Which asset a given platform updates FROM. Note these are not the files a
 *  human downloads: macOS updates from the .app.tar.gz, not the .dmg. */
function assetPattern(target: string, arch: string): RegExp | null {
  const t = target.toLowerCase();
  const a = arch.toLowerCase();
  if (t.startsWith('darwin') || t.startsWith('macos')) return /macos-.*\.app\.tar\.gz$/;
  if (t.startsWith('windows')) return a.includes('aarch64') ? /windows-arm64-setup\.exe$/ : /windows-x64-setup\.exe$/;
  if (t.startsWith('linux')) return /linux-.*\.AppImage$/;
  return null;
}

/** "v0.2.0" / "0.2.0" → [0,2,0]. Anything unparseable sorts lowest, so a
 *  malformed tag can never look newer than a real version. */
function parseVersion(v: string): number[] {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

/** The manifest Tauri's updater expects, or null when there's nothing newer
 *  (the route turns that into a 204). */
export async function updateFor(
  target: string,
  arch: string,
  currentVersion: string,
  origin: string,
): Promise<UpdateManifest | null> {
  const release = await latestRelease();
  if (!release) return null;

  const version = release.tag_name.replace(/^v/, '');
  if (!isNewer(version, currentVersion)) return null;

  const pattern = assetPattern(target, arch);
  if (!pattern) return null;

  const assets = release.assets ?? [];
  const asset = assets.find((x) => pattern.test(x.name));
  if (!asset) {
    serverLogger.error('update', 'no asset for platform', { target, arch, tag: release.tag_name });
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
 *  (for .sig files) and by the asset-proxy route (for installers). */
export async function fetchAsset(id: number): Promise<Response | null> {
  if (!TOKEN) return null;
  try {
    return await fetch(`${API_BASE}/repos/${REPO}/releases/assets/${id}`, {
      headers: { ...ghHeaders(), accept: 'application/octet-stream' },
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    serverLogger.error('update', 'asset fetch failed', { id }, e);
    return null;
  }
}
