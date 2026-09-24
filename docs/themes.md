# Themes

How Ember's colours can change: five presets, the person's own themes, a
saved list that can be shared, and the native shells following along.
Shipped in 0.7.0 ("Make Ember yours"). The design history is in the themes
plan (`docs/superpowers/plans/2026-09-23-themes.md`, not committed); this file
describes what is in the tree.

## 1. The model: eight inputs, 34 variables

Every colour in the app is a CSS custom property on `:root` in
`apps/web/app/globals.css`, mapped into Tailwind 4 by `@theme inline`. A
theme does not list those variables. It is eight colours, the **inputs**
(`ThemeInputs` in `lib/theme/model.ts`), stored as OKLCH `[l, c, h]`:

| Input | Ember | Editor group |
| --- | --- | --- |
| `background` | `0.16 0.005 260` | Basics |
| `accent` | `0.68 0.20 25` | Basics |
| `text` | `0.98 0 0` | Basics |
| `surface` | `0.20 0.005 260` | More |
| `mutedText` | `0.70 0.005 260` | More |
| `accentHover` | `0.78 0.13 25` | More |
| `border` | `1 0 0` | More |
| `sidebar` | `0.13 0.005 260` | More |

`derive(inputs)` in `lib/theme/derive.ts` is a pure function that turns them
into the full set, `THEME_VARS`: the 32 colours of the `:root` block plus two
added for themes, `--ember-foreground` (what sits on the accent) and `--art`
(the backdrop behind artwork). It also returns the `scheme`, `dark` when the
background's lightness is under 0.5. The rules, in short (`+0.04` means "add
to L, clamp to 0..1"):

| Variables | Rule |
| --- | --- |
| `--background` | background |
| `--foreground` and every `*-foreground` that is text | text |
| `--surface`, `--card` | surface |
| `--surface-2`, `--muted` | surface +0.04 |
| `--popover` | surface +0.02, chroma x1.2 |
| `--secondary` | surface +0.06 |
| `--accent` (shadcn's hover surface, not the brand colour) | surface +0.10 |
| `--primary-foreground` | background +0.02 |
| `--muted-foreground` | mutedText |
| `--border`, `--input`, `--sidebar-border` | border at 8%, 12%, 6% alpha |
| `--ember`, `--ring`, `--sidebar-primary`, `--sidebar-ring`, `--cover-from` | accent |
| `--ember-soft` | accentHover |
| `--cover-to` | accent at L 0.30, chroma x0.75 |
| `--sidebar` | sidebar |
| `--sidebar-foreground` | text -0.03 |
| `--sidebar-accent` | sidebar +0.09 |
| `--destructive` | fixed `oklch(0.65 0.22 25)`: danger is the same red in every theme |
| `--ember-foreground` | white while white on the accent reads at 3:1 or better, else the darker of text and background |
| `--art` | black for a dark scheme, else background -0.08 |

Naming trap: shadcn's `--accent` is a hover surface. The brand colour is
`--ember`. In the editor, "Accent" means `--ember`.

Ember's inputs reproduce the `:root` block value for value;
`derive.test.ts` parses `globals.css` to hold that. That is why picking
Ember applies **no overrides at all**: the CSS defaults are the theme, and
the page is byte-identical to Ember before themes.

**Auto-fill.** In the editor, the three Basics drive the five More colours
(`autoFill` in `derive.ts`) until the person changes one of them, which pins
it until they press Auto again:

- surface = background +0.04
- sidebar = background -0.03
- mutedText = background's L plus 66% of the way to the text's L, with the
  background's chroma and hue
- accentHover = accent +0.10, chroma x0.65
- border = white for a dark background, black for a light one

So "pick a background and an accent" is already a whole theme.

The colour maths (`lib/theme/oklch.ts`, no dependencies): hex to OKLCH and
back through Ottosson's OKLab matrices, gamut mapping by reducing chroma,
and the WCAG 2.x contrast ratio.

## 2. The five presets

`lib/theme/presets.ts`, all dark:

| Id | Name | Look |
| --- | --- | --- |
| `ember` | Ember | Warm red on near-black. The default, and "no overrides". |
| `midnight` | Midnight | Deep blue with an ice-blue accent. |
| `forest` | Forest | Dark green with an amber accent. Its `--ember-foreground` is the dark background. |
| `nebula` | Nebula | Violet with a magenta accent. |
| `mono` | Mono | Pure black with a white accent, for OLED phones. Accent text is black. |

`presets.test.ts` runs every preset through the readability guard and
expects nothing above `ok`, so a preset cannot ship unreadable.

## 3. Readability guard

`lib/theme/guard.ts` rates six pairs by WCAG contrast:

| Pair | ok | warn | fail |
| --- | --- | --- | --- |
| Text on the background | 7 | 4.5 | under 4.5 |
| Text on highlighted rows | 7 | 4.5 | under 4.5 |
| Muted text on cards | 4.5 | 3 | under 3 |
| Button text on the accent | 3 | (no warn band) | under 3 |
| Accent links on the background | 4.5 | 3 | under 3 |
| Sidebar text | 7 | 4.5 | under 4.5 |

Each finding can offer a fix: one input's lightness moved in 0.02 steps (at
most 20) until the pair goes up a level, chroma and hue untouched. The page
shows the finding with a "Fix it" button. Nothing is adjusted silently. A
`fail` blocks Apply (the draft still shows in the preview); a `warn` never
blocks.

## 4. Where a theme lives

**The active theme** is `users.theme`, a JSON `ThemeDoc`
(`{ v: 1, preset, custom?, name?, themeId? }`) with the colours copied in.
It rides in the `pb_auth` cookie, which carries the whole user record, so
the root layout (`app/layout.tsx`) reads it on every request and renders it
as inline variables on `<html>` (`htmlProps` in `lib/theme/css.ts`), with
`theme-color` from `generateViewport`. The first HTML byte carries the
theme: no theme script, nothing to race, no flash. `parseThemeDoc` never
throws: anything unreadable falls back per field, or to Ember.

On the client, `stores/useThemeStore.ts` (zustand, persisted as
`ember.theme.v1`) mirrors the account the way the plugin switches do: an
optimistic `select`, rolled back on failure unless something newer replaced
it, and the cookie rewritten after every change so a hard reload is already
right. `components/providers/ThemeApplier.tsx` is the only writer of the
theme on the live page after first paint, and it paints the active theme
only: Appearance's unapplied draft lives in the store too, but only the
page's preview pane shows it. Signed-out pages (`/auth`,
`/privacy`, `/terms`) are always Ember, whatever the device cached, so one
friend's theme never colours the sign-in page on a shared computer.

**Saved themes** are rows in the `themes` collection
(`pocketbase/pb_hooks/ensure_themes.pb.js`): owner, name (up to 40
characters), base preset, the eight inputs, and a `shared` flag.

- **The cap is 20** themes per person (`THEME_CAP` in `lib/theme/saved.ts`),
  checked by `POST /api/themes` (409 with "You can keep up to 20 themes.
  Delete one to make room.") and again in the PocketBase hook. The New
  button is disabled at the cap.
- **Sharing**: a theme with "Share with everyone" on is listed for everyone
  on this server, labelled with its creator ("by Luka"). Anyone can use it
  as it is or copy it into their own list; only its creator can edit,
  rename, unshare or delete it.
- **Security**: `/pb` is publicly proxied, so the collection rules are the
  boundary. Anyone signed in reads their own rows plus shared ones; nobody
  writes from the client. The Next routes (`app/api/themes/**`) write with
  the admin client after checking the owner, validating the colours and
  running the guard.
- **Nothing breaks under anyone.** Using a saved or shared theme copies its
  colours onto `users.theme`. If the original is deleted or unshared, the
  people using it keep a copy: `GET /api/theme` drops the link on their next
  load and the colours stay. The owner deleting their own active theme goes
  back to that theme's base preset straight away (bughunt V10): they chose
  to delete it, so there is nothing to keep.

## 5. Settings > Appearance

`app/(app)/settings/appearance/page.tsx`, composed from presentational
pieces in `components/settings/appearance/` and the `useThemeEditor` hook: a
live preview of real app pieces on mock data next to an inspector with three
tabs, Themes, Colours and Share.

**Try in the preview, then Apply** (feature F1, the owner's call). Picking a
preset, one of my themes or a shared theme, and changing colours, all change
only the preview pane. The rest of the app, the page around the preview
included, keeps the theme in use, and nothing is saved. While what the
preview shows differs from the theme in use, the bar at the top of the
inspector (`ApplyBar`) says what is showing and offers **Apply** and **Back
to current**; it sticks to the top of the page so it stays in reach while
the colours scroll. With nothing to apply the same bar says which theme is
in use, at the same height, so the list under it does not jump when a pick
brings the buttons in.

- **Apply** makes it the theme of the whole app and saves it through the
  same routes as before. What it saves depends on what is showing:
  - a preset or a saved theme as it is: `PATCH /api/theme` selects it;
  - one of mine with changed colours: `PATCH /api/themes/:id` saves the
    colours first, then it is selected (or, when it was already in use, the
    server's `active` copy is adopted);
  - a preset (or a kept copy) with changed colours: `POST /api/themes`
    saves a new theme named "My <preset>" ("My Midnight", then "My Midnight
    2" if taken), which is then selected. Nothing is made before Apply.
- **Back to current** drops the draft; the preview shows the theme in use
  again.

The draft is the store's `draft` (`{ target, edit }`, see
`stores/useThemeStore.ts`): the theme picked and, once a colour changes, the
edit, tied to the selection it was made on. It is in memory only: leaving
Appearance applies and saves **nothing** (there is no flush on unmount or
on `pagehide` any more, bughunt N1 as changed by F1), and coming back to
Appearance in the same session shows the draft again with Apply. A reload
or sign-out drops it.

In the Themes tab the theme the preview shows is outlined (a checked radio
for a preset, a pressed row for one of mine, "Showing" for a shared one),
and the one the app uses carries an **In use** tag.

The other flows:

- **Someone else's shared theme**: read-only. "Copy to my themes" makes an
  editable copy.
- **New**: a copy of whatever the preview shows (preset, mine, shared, a
  kept copy, or the draft's changed colours), saved to My themes as "New
  theme" and shown in the preview, then the Colours tab opens. Apply puts it
  in use.
- **Duplicate, rename, delete** on each of mine act at once; they are list
  changes, not a theme change. Deleting the theme in use goes back to its
  base preset (bughunt V10); a draft of the deleted theme goes with it.
- **A kept copy** ("In use: X, kept after its original went away") is what
  is left when someone else's theme in use was deleted or unshared. It is
  not in any list; changing a colour and applying saves it to My themes
  under its own name.
- **Reset** puts the base preset's colours back into the draft.
- **Share tab**: the "Share with everyone" switch, for one of mine only
  (the one the preview shows). It saves at once.

**Unreadable colours.** A pair at `fail` turns Apply off and shows "Not
saved: <pair> is hard to read." Fix it changes the draft (not the saved
theme), so the preview shows the fix and Apply comes back on.

**One apply at a time.** Every apply (and every delete) runs through one
queue in the hook, so an apply that saves colours and then selects always
lands before a later one selects something else. With the per-account lock
on the server (`lib/theme/serverActive.ts`), a late save can never put back
a theme the person just moved off (bughunt N2).

## 6. Lint: the colour ratchet and the inline-block rule

Both live in `apps/web/lib/lintRules.test.ts`.

**Colour ratchet.** A component never names a colour; it names a token
(`bg-ember`, `text-ember-foreground`, `bg-art`, `bg-foreground`,
`text-muted-foreground`). A theme swaps the tokens, so a raw `text-white` on
the accent vanishes the moment someone picks Mono. The test counts raw
Tailwind palette classes (`text-white`, `bg-black/40`, `from-slate-500`,
`bg-amber-500`, with any variant prefix) in `app/` and `components/`,
shadcn's `components/ui` included, against `COLOUR_BASELINE`:

- a file over its baseline fails, a file under it fails until the number is
  lowered, and an unlisted file must have none;
- each entry says why the colour must stay fixed: scrims over photos (a
  black veil keeps a label readable over any cover), danger red, bug-report
  severity, and mock chrome on `/dizajn`;
- `text-white` next to `bg-ember` is banned outright (use
  `text-ember-foreground` or `<Button variant="ember">`);
- hex, `rgb()` and `hsl()` literals are allowed only in the files named in
  `LITERAL_COLOUR_ALLOWED` (brand dots, mock covers, the hex field's hint).

**The inline-block rule.** `globals.css` resets `.inline-block { inline-size:
auto; }` (see `lib/themeCollisions.test.ts`), and that rule comes after every
width utility at the same specificity, so it wins: `inline-block w-5` or
`inline-block size-4` renders 0 px wide when the element is empty. That is
how the switch thumbs vanished during the sweep. The test fails on any line
that pairs `inline-block` with a `w-*` or `size-*` class; give a sized
element `block` (a flex child needs nothing) or `inline-flex` instead.

## 7. Native shells

Both shells load the server's page, so the page is themed with nothing
native. What the shells paint is the chrome around it. `ThemeApplier`
calls `notifyShell` (`lib/theme/native.ts`) 150 ms after the active theme
settles, so the shells change only when a theme is applied (or arrives from
the account), never for a draft in the Appearance preview. It sends the background as
hex, the scheme, and on Android every derived variable. A plain browser, an
APK from before themes (no `EmberTheme` plugin) and a desktop build without
the command are all no-ops, and a rejected call is swallowed. Signed out,
the shells get Ember, like the page.

**Android** (`apps/mobile/android/app/src/main/java/app/ember/music/`):

- `EmberThemePlugin` (`EmberTheme.apply({ background, scheme, vars })`)
  keeps the values in `SharedPreferences("ember_theme")` and has
  `MainActivity.applyTheme` paint the chrome.
- `ThemeColors.applyToWindow` sets the WebView's and the window's own
  background (what shows between the splash and the first byte, and behind a
  loading page), the bar icon lightness, and below SDK 35 the status and
  navigation bar colours. On 35 the bars are transparent over the page, so
  the page's own background is their colour and only the icons are set. Bar
  icons turn dark only for a light background (relative luminance over
  0.4), which no v1 theme has.
- `MainActivity.applyStoredTheme` applies the stored theme right after
  `onCreate`, before the page loads, so a cold start opens on the theme's
  colour; a phone that never reported one opens on Ember's `#0c0d0f`. The
  splash itself stays the brand red on black.
- The bundled `offline.html` lives on another origin and never sees the
  account, so `MainActivity` registers `ThemeColors.script(vars)` as a
  document-start script for that origin only. The page's styles read
  `var(--background, #0a0a0a)` and friends, so with nothing published it
  looks as it always did. `parseVars` keeps only `--name` keys and plain
  colour values before anything goes into the script.

**Desktop** (`apps/desktop/src-tauri/src/theme.rs`):

- `theme_apply(background, scheme)` sets the main window's background colour
  and its theme (`Dark` unless the scheme is `light`; the macOS and Windows
  title bars follow it), then writes `{ background, scheme }` to
  `theme.json` in the app config dir.
- `lib.rs` `.setup` calls `theme::apply_stored` so the window has the last
  theme's colour before the remote page arrives.
- `theme_apply` is in `permissions/app-commands.toml`: a remote origin is
  denied every command not named there.

The browser's own bars follow through `<meta name="theme-color">`, rendered
from the cookie by `generateViewport` and kept current by
`applyToDocument`. The PWA manifest colours stay static.

## 8. Tests

- Unit (`apps/web`, vitest): `lib/theme/*.test.ts` (colour maths,
  derivation against `globals.css`, presets, guard, model, saved themes,
  the applier's CSS, `native.test.ts` for both shells and the no-op cases),
  `stores/useThemeStore.test.ts` (including the draft), the theme routes,
  `ThemeApplier.test.tsx` (including the 150 ms shell notify, and that a
  draft never reaches the page or the shell), `hooks/useThemeEditor.test.tsx`
  (the draft, Apply, Back to current, leaving, the readability block, N2,
  V10), the Appearance page and `lib/lintRules.test.ts`.
- Android (JVM, Robolectric): `ThemeColorsTest.kt`, run with
  `cd apps/mobile/android && ./gradlew testDebugUnitTest --tests 'app.ember.music.Theme*'`
  (needs JDK 21).
- Desktop: `cd apps/desktop/src-tauri && cargo test --lib theme`.
- Browser: `tests/themes-ui.test.mjs` (two devices, sharing, first paint
  with JavaScript off, a picked preset staying in the preview until Apply,
  `SHOT_DIR` screenshots of every preset) and
  `tests/offline-page.test.mjs` (the offline page keeps its fallbacks and
  takes the exact script `ThemeColorsTest` pins).
