# Ember tools

One command each. Run them from any Ember folder. Don't remember the names?
`npm run ember` lists them all: pick a number and it asks for the rest.

## Everyday

| To | Run |
|---|---|
| See everything | `npm run ember` |
| Start a new branch | `npm run branch -- fix/search-crash` |
| Try a branch in the browser | `npm run sandbox` (this branch) or `npm run sandbox -- ui/info-changes` |
| See or stop test copies | `npm run sandbox -- list` / `npm run sandbox -- stop 3072` / `stop all` |
| Try a branch on your phone | `npm run test-apk` then open the link it prints on the phone |
| Screenshots of pages | `npm run shots -- /library /settings` (add `--phone` or `--desktop` for one size) |
| New bug reports and requests | `npm run reports` |
| Keep the #tracker list (Claude does this) | `npm run tracker -- list` / `scan` / `fixed <link> "summary"` (see below) |
| Does the host need updating? | `npm run host-check` |
| Message the owner | `npm run notify -- "Ready to check on 3072"` |

## Making a release

1. `npm run notes-draft` writes `.release-notes.md` from the commits. Fix the
   wording (one line each for `id`, `title`, `summary`, one `- ` line per
   bullet).
2. `npm run release` bumps the versions, adds What's new and the host notes,
   runs every test suite and commits. Each app is included by itself when
   its own code changed since its last release. Nothing is sent anywhere.
3. `npm run release -- push` shows everything that goes out and pushes to
   main only after you type `push`. Each new app gets its own tag, so
   GitHub builds that app, and you can watch it build.

### App versions and tags

Every app has its own version, so a fix for one does not make the others
download an update:

| App | Version lives in | Tag |
|---|---|---|
| Android | `apps/mobile/android/app/build.gradle` (`versionName`, `versionCode`) | `android-v0.4.25` |
| iPhone | `apps/mobile/ios/App/App.xcodeproj/project.pbxproj` (`MARKETING_VERSION`) | `ios-v0.4.25` |
| Windows | `apps/desktop/src-tauri/tauri.windows.conf.json` | `windows-v0.4.25` |
| Mac | `apps/desktop/src-tauri/tauri.macos.conf.json` | `macos-v0.4.25` |
| Linux | `apps/desktop/src-tauri/tauri.linux.conf.json` | `linux-v0.4.25` |

- A change under `apps/mobile/android` releases Android, `apps/mobile/ios`
  iPhone, the rest of `apps/mobile` both. A change under `apps/desktop`
  releases all three desktop apps, unless every changed file is built by
  one OS only (`speech/windows.rs`, `speech/macos.rs`, or that OS's
  version file): then just that one.
- "Changed" means since that app's last tag (`<app>-v*`, or the last old
  `vX` tag before there were any).
- `--os=android,windows` picks the apps by hand, `--shells` takes all five,
  `--no-shells` none.
- `versionCode` only goes up on an Android release.
- Each tag is pushed on its own (GitHub starts nothing for a push of more
  than three tags). The build checks that the tag matches the app's version
  file and stops at once if not. Its GitHub release is called
  "Ember Windows 0.4.25" and its files keep the usual names
  (`Ember-v0.4.25-windows-x64-setup.exe`).
- The server offers each app the newest release for it: its own tag, or an
  old `v0.4.x` one (those were for every app). A Windows release is never
  offered to a Mac or a phone.
- The old `v0.4.x` tags still build every app, but the tools never make
  them again.

`npm run release -- preview` shows the release at any time.
`npm run release:check` runs every test suite on its own (add `-- --shells`
for the Rust and Android ones too).

## The tracker

One list in the private Discord channel #tracker of what was fixed, made and
rejected, plus what is accepted but not done. Claude keeps it; the owner only
reads it. State: `~/.ember-tools/tracker.json`.

- `npm run tracker -- scan [--days 30]` shows messages (bug reports,
  recommendations, fix-recommendations, suggestions, ideas) not tracked yet.
- `tracker seen <link>...` marks duplicates and chatter as not worth tracking.
- `tracker fixed|made|rejected <link> "summary" [--version 0.7.31] [--reason "..."]`
  and `tracker open <link> "summary"`. The link is Discord's Copy Message Link.
- `tracker release 0.7.31` stamps the version on every fixed/made item
  without one; `npm run release -- push` does it after a successful push.
- `tracker post` rewrites #tracker in place, `tracker list` shows it here.
  Every change posts by itself; `--no-post` skips that. If #tracker does not
  exist yet, the list is kept locally and the tool says so.

Automatic: `tracker sync` adds new messages as "new" (bugs, or requests not
sorted yet) and posts only when the list changed. Repeated bug reports are
grouped by a fingerprint of their first line and counted (x12); more than 5
new bug groups from one author in an hour fold into one "held" line; the bugs
section shows 15 lines at most. The first sync only sets the starting point
(use `scan` for older messages). `tracker install` runs sync every 5 minutes
through launchd (log: `~/.ember-tools/tracker.log`), `tracker status` shows
whether it is loaded and the last sync, `tracker uninstall` removes it. A lock
file keeps two runs from overlapping.

## Once

- `npm run hooks`: every push is then checked for secrets, em dashes and
  pranks in What's new.
- `~/.ember-tools/sandbox.env` holds the sandbox's admin login (already set
  up on this Mac) and, optionally, `EMBER_HOST_URL` for host-check.

## Cleaning up

`npm run tidy-branches` lists branches already merged into main and deletes
them, with their folders, after you say yes. Unsaved work is always kept.

## Safety built in

- Sandboxes never use port 3000 or 8090 or the live `pocketbase/pb_data`, and
  their bug reports never reach Discord.
- Nothing reaches main without a typed `push` (or the owner's yes, below).
- New branches link `node_modules`; nothing runs `npm install` in a branch folder.
