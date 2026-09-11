import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Decoupling rules (docs/DESLOP.md section b): the presentational component
// folders below take data as props and hand events back as callbacks; they
// do not reach into hooks, stores, react-query or the player context on
// their own. `components/player/**` is the one folder excluded from this
// restriction, since PlayerBar/NowPlaying and friends are where player
// state gets composed for everything downstream.
//
// The file globs use `**` (every nested file, not just direct children),
// so a genuinely data-aware file below one of these folders needs an
// explicit override with a comment (for example components/track/menus/**
// below) rather than silently escaping the rule by living one directory
// deeper.
const presentationalRestrictions = [
  {
    group: ["@/hooks/*", "@/hooks"],
    message:
      "Presentational components take data as props; compose hooks in the page or a hook, not here.",
  },
  {
    group: ["@/stores/*", "@/stores"],
    message:
      "Presentational components take data as props; read stores in the page or components/player/**, not here.",
  },
  {
    group: ["@tanstack/react-query"],
    message:
      "Presentational components take data as props; fetch in the page or a hook, not here.",
  },
  {
    group: ["@/components/player/PlayerProvider"],
    message:
      "Presentational components take data as props; call usePlayer() in the page or a hook, not here.",
  },
];

// lib/ is framework-free so its functions stay trivially unit-testable
// outside a component tree: no React, no Next, no component imports.
const libRestrictions = [
  {
    group: ["react", "react-dom", "react/*", "react-dom/*"],
    message: "lib/ is framework-free: no React imports.",
  },
  {
    group: ["next", "next/*"],
    message: "lib/ is framework-free: no Next imports.",
  },
  {
    group: ["@/components/*"],
    message: "lib/ is framework-free: no component imports.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "components/primitives/**/*.{ts,tsx}",
      "components/page/**/*.{ts,tsx}",
      "components/track/**/*.{ts,tsx}",
      "components/library/**/*.{ts,tsx}",
      "components/nav/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": ["error", { patterns: presentationalRestrictions }],
    },
  },
  {
    // Composition roots that stayed data-aware after the step 9 sweep, the
    // same way PlayerBar composes player state for components/player/**:
    // Sidebar/Drawer own the playlists query and the create-playlist flow,
    // and TrackPageClient is the track detail page's client half (it fetches
    // its own track and drives playback), not a reusable row/card
    // primitive. Moving any of the three out of nav/ or track/ would just
    // relocate the composition root, not remove it. components/track/menus/**
    // is the one folder-wide override: AddToPlaylistMenu and
    // CreatePlaylistDialog fetch and mutate playlists on their own, so the
    // whole folder needs hooks/react-query rather than taking data as props.
    files: [
      "components/nav/Sidebar.tsx",
      "components/nav/Drawer.tsx",
      "components/track/TrackPageClient.tsx",
      "components/track/menus/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: libRestrictions }],
    },
  },
  {
    // Pre-existing lib/ files that are hook-shaped (useEffect/useState) or
    // server-only (next/headers). Out of scope for the step 9 cleanup;
    // documented here rather than silently exempted.
    files: [
      "lib/useBackDismiss.ts",
      "lib/useOnline.ts",
      "lib/offlineNative.ts",
      "lib/pocketbase/server.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
