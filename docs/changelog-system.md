# Changelog system (version tracked)

Plan only. The UI candidates on /dizajn (`components/library/options/changelog/`) sit on top of this.

## 1. What the version is today

| Place | Value | Used for |
|---|---|---|
| `package.json`, `apps/web`, `apps/desktop`, `apps/mobile` `package.json` | `0.1.0` (never bumped) | nothing |
| `apps/desktop/src-tauri/tauri.conf.json:4`, `Cargo.toml:3` | `0.2.4` | desktop updater; bumped by `chore(desktop): 0.2.x` commits, tagged `v0.2.x` |
| `apps/mobile/android/app/build.gradle:16-17` | `versionCode 1`, `versionName "1.0"` (never bumped) | Play/APK metadata |
| `apps/web/next.config.ts:10-20` | `NEXT_PUBLIC_APP_VERSION` = git SHA + build date | settings footer (`settings/layout.tsx:16`), boot log (`VersionLog.tsx:10`), bug reports (`lib/logger/types.ts:46`, `client.ts:220`, `api/bug-report/route.ts:58`) |

The desktop feed (`api/desktop/update/.../route.ts:27`, `lib/desktopUpdate.ts:127-128`) compares the newest GitHub Release tag with the installed binary using `isNewer` (`lib/desktopUpdate.ts:103-112`). So there are several numbers and the web app, the thing users actually see, has no semver at all.

**Recommendation: one number, `apps/web/package.json` `version`, starting at `0.3.0`** (continues the desktop line).

- Web: `next.config.ts` reads it and sets `NEXT_PUBLIC_APP_VERSION` to `0.3.0 (a1b2c3d 2026-09-18)`. Footer and bug reports keep the SHA for free.
- Desktop and phone are shells around the page the host serves, so the version a user sees is the host's. The changelog tracks this number.
- Shell binaries keep their own `version` fields for the updater, but when a shell release is cut those fields are set to the app version of that moment (so `v0.3.5` means "shell built at app 0.3.5"). Gaps are fine: `isNewer` compares numerically.
- Shell-only changes (the Rust seek fix) get a normal entry with `scope: 'desktop'`, under the app version that ships with the tag. Users on the web see it too; that is acceptable and simpler than a second list.

## 2. Where entries live

`apps/web/lib/changelog.ts`: a typed array, newest first. No parsing, no build step, importable by tests and by the UI.

```ts
export interface ChangelogEntry {
  id: string;            // stable, e.g. 'instant-search'
  version: string;       // '0.3.1'
  date: string;          // '2026-09-18'
  title: string;
  summary: string;       // one line: Home banner, popover
  bullets: string[];     // two or three lines: full page
  scope?: 'desktop' | 'android';  // omit for the web app
}

export const CHANGELOG: ChangelogEntry[] = [
  { id: 'instant-search', version: '0.3.1', date: '2026-09-18',
    title: 'Instant search', summary: 'Search opens instantly, even on a slow connection.',
    bullets: ['Search opens the moment you tap it.', 'Recent searches show while results load.'] },
];
export const APP_VERSION = CHANGELOG[0].version;
```

The existing `ChangelogEntry` in `dizajn/mock.ts:160-171` moves here; `unread` is dropped (computed, see 4). `parseVersion`/`isNewer` move from `lib/desktopUpdate.ts` (server-only) to `lib/semver.ts` so the client can use them.

## 3. Where state lives

Per user in PocketBase, not localStorage. The owner's stated goal is "since the version you last opened" across desktop and phone; localStorage would re-show New on every device. Follow the privacy pattern exactly:

| Piece | Where |
|---|---|
| `changelog_seen_version` (text), `changelog_hide_new` (bool) | `users` fields, added on boot by `pocketbase/pb_hooks/ensure_changelog_fields.pb.js` (copy `ensure_privacy_fields.pb.js:21-51`) |
| `GET/PATCH /api/changelog` | `apps/web/app/api/changelog/route.ts`, mirrors `api/privacy/route.ts` |
| `stores/useChangelogStore.ts` | zustand, not persisted (like `usePrivacyStore.ts:7-12`); until loaded assume nothing is New |

No per-entry read state. "Read" is version level: one field, one write. `useSettingsStore.ts` is localStorage and stays for device-local toggles only.

## 4. How New is computed

- `newIds = entries.filter(e => isNewer(e.version, seen)).map(e => e.id)`, empty when `hideNew` is true.
- Mark all as read: `PATCH { seenVersion: APP_VERSION }`.
- Brand new user, or an existing user on the first build with this feature (field empty): the store writes `seenVersion = APP_VERSION` on first load. Nothing is New; history is browsable.
- User who skipped versions: every entry above `seen` is New, regardless of how many versions passed. One click clears them all.
- Opening the page does not clear tags; only the button does. The UI may call `markAllRead` from wherever the chosen placement wants.

What the UI gets: one hook `useChangelog()` returning `{ entries, newIds, hasNew, hideNew, setHideNew, markAllRead, loaded }`. This matches `ChangelogPageProps` (`ChangelogPage.tsx:11-23`) with no redesign.

## 5. Cutting a version

Bump only when there is something to tell users. A merge with nothing user-visible does not bump. Claude does this as part of the merge to main.

1. Add the entry at the top of `lib/changelog.ts` with the new version.
2. Set the same version in `apps/web/package.json` (`npm version patch --no-git-tag-version` in `apps/web`).
3. If the host must do anything, add the `UPDATE_NOTES.md` section as today, with the version in its heading: `# 0.3.1: crash logging ...`. No host action, no section.
4. Commit `chore(release): 0.3.1`. `update.sh:211` already prints the SHA and subject after the pull; add the version from `apps/web/package.json` to that line.
5. Shell release only when `apps/desktop` or `apps/mobile` changed: set `tauri.conf.json`, `Cargo.toml`, `build.gradle` (`versionName`, `versionCode + 1`) to the app version, tag `vX.Y.Z`, push the tag. `native-build.yml:27-30` builds and `:397` publishes the Release.

A unit test (6) fails if step 1 and 2 disagree, so there is no silent drift.

## 6. Tests

| Test | Covers |
|---|---|
| `lib/semver.test.ts` | `isNewer` ordering, gaps, `v` prefix, malformed input sorts lowest |
| `lib/changelog.test.ts` | top entry version equals `apps/web/package.json`; versions non-increasing; ids unique; dates ISO |
| `lib/changelog-new.test.ts` | `computeNewIds`: empty seen, seen equals current, skipped versions, `hideNew` empties the set |
| `stores/useChangelogStore.test.ts` | first load with empty field writes current version; `markAllRead` patches and clears; fetch failure leaves nothing New |
| `app/api/changelog/route.test.ts` | GET reads the two fields, PATCH accepts only a string and a bool, 401 without a user (same shape as `api/privacy`) |
| `components/.../ChangelogPage.test.tsx` | tags render for `newIds`; clicking Mark all as read calls the handler and the tags disappear; the switch hides them without a write to `seen` |
| `dizajn/page.test.tsx` | existing test keeps passing with the moved type |

PocketBase hook: no runner exists for `pb_hooks` (none in the repo today); cover it by the route test plus `./update.sh` on the test host, which restarts PB so the hook runs (`update.sh:216`).

## Decisions for the owner

1. One number for web and shells (`0.3.0` onward, shell fields set to the app version at tag time)? Recommended: yes.
2. Brand new user sees nothing as New (history browsable, no tags)? Recommended: yes; the alternative is "only the newest version is New".
3. Store read state per user in PocketBase (syncs devices) rather than per device? Recommended: PocketBase.
