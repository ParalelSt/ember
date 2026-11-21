# Classic look

The redesign is Ember's default UI. A device can switch to the **Classic
look**: the UI as it was on `main` at `24318b38`, before the redesign. One
build carries both; the Classic look is a frozen copy of the old UI that is
loaded only on a device that picked it.

## How a device picks a look

- The per-device cookie `ember_ui` (`new` or `legacy`), one year, `Path=/`,
  `SameSite=Lax`. Only the server sets it (`apps/web/lib/uiMode.ts`).
- Settings > Appearance > **Classic look** (new UI, phone and desktop) and
  the **Try the new look** card at the top of the Classic look's Settings call
  `POST /api/ui-mode` with `{ "mode": "legacy" | "new" }`, then reload.
- `?ui=legacy` or `?ui=new` on any page sets the cookie and redirects to the
  same URL without the parameter (`apps/web/proxy.ts`). It works signed out,
  so it is also the way back if a switch ever breaks.
- No cookie: `EMBER_DEFAULT_UI` (`new` or `legacy`), read at request time,
  so a host can change the default with a restart. Unset means `new`.

The root layout puts the mode on `<html data-ui>` and in `UiModeProvider`
(`useUiMode()`). A page restored from the back/forward cache reloads when the
cookie now names the other look. Device check-ins (`DeviceVersionReporter`)
send the mode along; it is stored in `user_devices.ui_mode`
(`pocketbase/pb_migrations/1793100000_user_devices_ui_mode.js`).

## Where the code is

- `apps/web/legacy/`: the frozen tree. `legacy/components/` is the old
  `components/`, `legacy/app/` the old `app/(app)/` routes,
  `legacy/legacy.css` the few rules the redesign took out of `globals.css`
  (scoped to `html[data-ui=legacy]`). It imports itself through `@legacy/*`
  and shares the engine with the new UI: `@/lib`, `@/hooks`, `@/stores`, the
  providers, `PlayerProvider`, `SessionHostBridge`, `DeviceVersionReporter`,
  the API routes and everything in the root layout.
- The switch points, the only files that may import `@legacy/*`:
  `app/(app)/layout.tsx` (the shell) and the route files under `app/(app)/`
  that both looks have. Client files use `uiSwitch(New, dynamic(...))`
  (`components/providers/uiSwitch.tsx`); server files read the cookie
  (`components/providers/serverUiMode.ts`) and import the legacy file only
  then. A server file's legacy page reaches its client views through
  `legacy/app/lazy.tsx` (next/dynamic loaders): the bundler adds every client
  component a server route can reach to that route's chunk, so without them
  the new look would download the old views too. Either way the new look
  never downloads the old one.
- Routes only the redesign has (`/chart/[slug]`, `/mix/[key]`,
  `/whats-new/[id]`, `/settings/uploads`, `/dizajn`) show their new page in
  both looks, inside the legacy shell on a Classic device. The list is
  `NEW_ONLY` in `app/(app)/routes.uiMode.test.tsx`; a new route file must go
  there or get a legacy page, or that test fails.
- ESLint enforces the boundary (`eslint.config.mjs`, tested by
  `legacy/boundary.test.ts`): nothing outside `app/(app)/` imports
  `@legacy/*`, and `legacy/` imports no redesign component.

## Freeze policy

`legacy/` changes only for:

1. compile fixes (a shared module's API changed: adapt minimally in legacy),
2. security fixes,
3. breakage in sign-in, playback, or the way back to the new look.

New features, design changes and polish go to the new UI only. The "Try the
new look" card is the one thing added to the old UI on purpose. When the
Classic look is retired, delete `legacy/`, the switch points' legacy halves,
`legacy.css`, the Settings row and the `@legacy` alias.
