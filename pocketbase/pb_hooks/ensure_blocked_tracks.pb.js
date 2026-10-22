/// <reference path="../pb_data/types.d.ts" />

// Blocked songs: a song a user never wants in radio, mixes or
// recommendations again (owner request 2026-10-22). Per user, listed in
// Settings > Library so it can be unblocked. Created on boot if missing,
// same zero-manual-setup pattern as ensure_recent_searches.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  try {
    dao.findCollectionByNameOrId("blocked_tracks");
    return; // already exists
  } catch (_) {
    // fall through and create it
  }

  let users, tracks;
  try {
    users = dao.findCollectionByNameOrId("users");
    tracks = dao.findCollectionByNameOrId("tracks");
  } catch (err) {
    console.log("[ensure_blocked_tracks] users/tracks missing, skipping:", err);
    return;
  }

  const collection = new Collection({
    name: "blocked_tracks",
    type: "base",
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: '@request.auth.id != "" && user = @request.auth.id',
    // An update may not hand the row to someone else (ensure_owner_rules).
    updateRule: "user = @request.auth.id && (@request.data.user:isset = false || @request.data.user = @request.auth.id)",
    deleteRule: "user = @request.auth.id",
    indexes: ["CREATE UNIQUE INDEX idx_blocked_tracks_user_track ON blocked_tracks (user, track)"],
    schema: [
      {
        name: "user",
        type: "relation",
        required: true,
        options: { collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      },
      {
        name: "track",
        type: "relation",
        required: true,
        options: { collectionId: tracks.id, maxSelect: 1, cascadeDelete: true },
      },
      { name: "blocked_at", type: "date", required: true, options: {} },
    ],
  });
  try {
    dao.saveCollection(collection);
    console.log("[ensure_blocked_tracks] created blocked_tracks");
  } catch (err) {
    console.warn("[ensure_blocked_tracks] could not create blocked_tracks: " + err);
  }
});
