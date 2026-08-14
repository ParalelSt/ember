/// <reference path="../pb_data/types.d.ts" />

// Recent searches — the tracks a user played from the search page, stored
// SERVER-SIDE so the list follows them across devices (it used to live in
// localStorage, which is why it didn't sync). Created on boot if missing,
// same zero-manual-setup pattern as ensure_sessions.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  try {
    dao.findCollectionByNameOrId("recent_searches");
    return; // already exists
  } catch (_) {
    // fall through and create it
  }

  let users, tracks;
  try {
    users = dao.findCollectionByNameOrId("users");
    tracks = dao.findCollectionByNameOrId("tracks");
  } catch (err) {
    console.log("[ensure_recent_searches] users/tracks missing, skipping:", err);
    return;
  }

  const collection = new Collection({
    name: "recent_searches",
    type: "base",
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: '@request.auth.id != "" && user = @request.auth.id',
    updateRule: "user = @request.auth.id",
    deleteRule: "user = @request.auth.id",
    indexes: [
      "CREATE UNIQUE INDEX idx_recent_searches_user_track ON recent_searches (user, track)",
      "CREATE INDEX idx_recent_searches_played ON recent_searches (played_at)",
    ],
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
      { name: "played_at", type: "date", required: true, options: {} },
    ],
  });
  dao.saveCollection(collection);
  console.log("[ensure_recent_searches] created recent_searches");
});
