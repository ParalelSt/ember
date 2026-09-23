/// <reference path="../pb_data/types.d.ts" />

// The shared `tracks` catalog is written by the server only.
//
// Every member sees the same row for a song, so a member who could write it
// could rename or retitle a song for everyone. The first schema let any
// signed-in member create and update rows; the app now writes them with the
// server's admin credentials (upsertCatalogTrack in lib/upsertTrack.ts, the
// admin track editor, the import runner, lib/trackAvailability.ts), so the
// member-facing create and update rules are closed. Reading stays open to
// members: playlists, likes and history expand these rows.
//
// Applied on boot, same pattern as the other ensure_* hooks, so existing
// installs pick it up on their next PocketBase restart.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  let tracks;
  try {
    tracks = dao.findCollectionByNameOrId("tracks");
  } catch (err) {
    console.log("[ensure_tracks_rules] tracks collection missing, skipping:", err);
    return;
  }

  // Rules come back from Go as string pointers, so compare the JSON form
  // (same as ensure_tabs).
  const rule = (r) => (r === null || r === undefined ? null : JSON.parse(JSON.stringify(r)));
  if (rule(tracks.createRule) === null && rule(tracks.updateRule) === null) return;

  tracks.createRule = null;
  tracks.updateRule = null;
  dao.saveCollection(tracks);
  console.log("[ensure_tracks_rules] tracks are server-written only now");
});
