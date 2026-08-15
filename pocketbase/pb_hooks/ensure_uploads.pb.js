/// <reference path="../pb_data/types.d.ts" />

// Custom song uploads — songs a member adds from their own files, playable by
// everyone on the server (that's the point: the library grows with things
// YouTube doesn't have). The audio itself lives on disk next to the cached
// YouTube audio (MUSIC_DIR/uploads); this collection is the metadata.
//
// Created on boot if missing — same zero-manual-setup pattern as
// ensure_recent_searches.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  try {
    dao.findCollectionByNameOrId("uploads");
    return; // already exists
  } catch (_) {
    // fall through and create it
  }

  let users;
  try {
    users = dao.findCollectionByNameOrId("users");
  } catch (err) {
    console.log("[ensure_uploads] users missing, skipping:", err);
    return;
  }

  const collection = new Collection({
    name: "uploads",
    type: "base",
    // Anyone signed in can find and play an upload — uploads are a shared
    // library. Only the uploader (or an admin) can change or remove one.
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: null, // server-only: the API route writes with admin creds
    updateRule: "uploader = @request.auth.id",
    deleteRule: "uploader = @request.auth.id",
    indexes: [
      "CREATE INDEX idx_uploads_uploader ON uploads (uploader)",
      "CREATE INDEX idx_uploads_title ON uploads (title)",
      "CREATE INDEX idx_uploads_artist ON uploads (artist)",
    ],
    schema: [
      {
        name: "uploader",
        type: "relation",
        required: true,
        // Keep the song when its uploader leaves — other people's playlists
        // may point at it.
        options: { collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      },
      { name: "title", type: "text", required: true, options: { max: 200 } },
      { name: "artist", type: "text", required: false, options: { max: 200 } },
      { name: "album", type: "text", required: false, options: { max: 200 } },
      { name: "duration_sec", type: "number", required: false, options: { min: 0 } },
      // Relative to MUSIC_DIR/uploads, e.g. "a1b2c3d4.mp3".
      { name: "filename", type: "text", required: true, options: { max: 300 } },
      { name: "mime", type: "text", required: false, options: { max: 100 } },
      { name: "size_bytes", type: "number", required: false, options: { min: 0 } },
    ],
  });
  dao.saveCollection(collection);
  console.log("[ensure_uploads] created uploads");
});
