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
   runs every test suite and commits. New phone and desktop apps are
   included by themselves when their code changed. Nothing is sent anywhere.
3. `npm run release -- push` shows everything that goes out and pushes to
   main only after you type `push`. App releases also get their tag, so
   GitHub builds the apps, and you can watch it build.

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
