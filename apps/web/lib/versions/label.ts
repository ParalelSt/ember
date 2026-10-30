/** What a device runs, as a person reads it: "Android app 0.4.28, web 0.7.34"
 *  or "Browser, web 0.7.34". Plain functions shared by the device, the routes
 *  and the admin page: no React, no Next, no server-only imports. */

export const DEVICE_PLATFORMS = ['android', 'ios', 'windows', 'macos', 'linux', 'browser'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

const PLATFORM_NAMES: Record<DevicePlatform, string> = {
  android: 'Android app',
  ios: 'iOS app',
  windows: 'Windows app',
  macos: 'macOS app',
  linux: 'Linux app',
  browser: 'Browser',
};

export function platformName(platform: DevicePlatform): string {
  return PLATFORM_NAMES[platform];
}

export const MAX_VERSION_LEN = 40;

/** A version number and nothing else, out of whatever a client sent: "0.7.34"
 *  from the build stamp "0.7.34 (a1b2c3d 2026-10-22)", null for anything that
 *  is not one. These strings end up in Discord and on the admin page, so only
 *  digits, dots and a short suffix get through. */
export function sanitizeVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^v?(\d{1,6}(?:\.\d{1,6}){0,3}(?:-[0-9A-Za-z.]{1,20})?)(?:\s|$)/.exec(value.trim().slice(0, 200));
  return m ? m[1] : null;
}

export function sanitizePlatform(value: unknown): DevicePlatform | null {
  return (DEVICE_PLATFORMS as readonly unknown[]).includes(value) ? (value as DevicePlatform) : null;
}

/** "Android app 0.4.28, web 0.7.34", "Android app (version unknown), web
 *  0.7.34" (a phone app too old to say), "Browser, web 0.7.34". Anything
 *  unknown says so: a report must never read as if it had no version by
 *  accident. */
export function versionLabel({
  name,
  browser,
  shellVersion,
  webVersion,
}: {
  name: string;
  browser?: boolean;
  shellVersion?: string | null;
  webVersion?: string | null;
}): string {
  const shell = browser ? name : `${name} ${shellVersion ?? '(version unknown)'}`;
  return `${shell}, web ${webVersion ?? 'unknown'}`;
}

/** The version fields of a report's client context, as the client sent them. */
export interface VersionContext {
  /** The web build stamp. */
  appVersion?: unknown;
  shell?: unknown;
  shellVersion?: unknown;
  shellPlatform?: unknown;
}

/** The line a report shows. Sanitizes everything itself, and copes with a
 *  client from before shellPlatform existed by falling back on its shell. */
export function reportVersionLabel(ctx: VersionContext | null | undefined): string {
  if (!ctx || typeof ctx !== 'object') return 'Version unknown';
  const webVersion = sanitizeVersion(ctx.appVersion);
  const shellVersion = sanitizeVersion(ctx.shellVersion);
  const platform = sanitizePlatform(ctx.shellPlatform);
  if (platform) {
    return versionLabel({ name: platformName(platform), browser: platform === 'browser', shellVersion, webVersion });
  }
  if (ctx.shell === 'capacitor') return versionLabel({ name: 'Phone app', shellVersion, webVersion });
  if (ctx.shell === 'tauri') return versionLabel({ name: 'Desktop app', shellVersion, webVersion });
  if (ctx.shell === 'web') return versionLabel({ name: 'Browser', browser: true, webVersion });
  return webVersion ? `web ${webVersion}` : 'Version unknown';
}

/** A report's context with its shell fields reduced to what they may be, and
 *  left out when they are not (the rest of the context is the route's). */
export function cleanShellFields<T extends object>(ctx: T): T {
  const out = { ...ctx } as T & { shellVersion?: unknown; shellPlatform?: unknown };
  const shellVersion = sanitizeVersion(out.shellVersion);
  const shellPlatform = sanitizePlatform(out.shellPlatform);
  delete out.shellVersion;
  delete out.shellPlatform;
  if (shellVersion) out.shellVersion = shellVersion;
  if (shellPlatform) out.shellPlatform = shellPlatform;
  return out;
}
