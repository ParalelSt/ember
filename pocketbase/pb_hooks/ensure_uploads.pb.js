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

  let existing = null;
  try {
    existing = dao.findCollectionByNameOrId("uploads");
  } catch (_) {
    // fall through and create it
  }
  if (existing) {
    // Installs from before updates went server-only still let the uploader
    // edit the row, filename included (bughunt W08). Installs from before
    // deletes went server-only still let the uploader delete their own row
    // through /pb directly, orphaning the audio and cover files on disk
    // (bughunt L2): the delete route already removes those files, a raw PB
    // delete does not.
    // Rules come back from Go as string pointers, so compare the JSON form
    // (same as ensure_tabs).
    const asJson = (rule) => (rule === null || rule === undefined ? null : JSON.parse(JSON.stringify(rule)));
    let changed = false;
    if (asJson(existing.updateRule) !== null) {
      existing.updateRule = null;
      changed = true;
      console.log("[ensure_uploads] uploads updates are server-only now");
    }
    if (asJson(existing.deleteRule) !== null) {
      existing.deleteRule = null;
      changed = true;
      console.log("[ensure_uploads] uploads deletes are server-only now");
    }
    // A required uploader made deleting that member fail (bughunt X4).
    const uploader = existing.schema.getFieldByName("uploader");
    if (uploader && uploader.required) {
      uploader.required = false;
      changed = true;
      console.log("[ensure_uploads] uploader is optional now");
    }
    if (changed) dao.saveCollection(existing);
    return;
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
    // library. Only the uploader (or an admin) can remove one, but even they
    // must go through the delete route: it also removes the audio and cover
    // files on disk, which a raw PB delete would leave orphaned. Nobody
    // edits one directly either: filename and artwork_ext name files on
    // disk, so only the server may set them.
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: null, // server-only: the API route writes with admin creds
    updateRule: null,
    deleteRule: null, // server-only: the API route deletes with admin creds
    indexes: [
      "CREATE INDEX idx_uploads_uploader ON uploads (uploader)",
      "CREATE INDEX idx_uploads_title ON uploads (title)",
      "CREATE INDEX idx_uploads_artist ON uploads (artist)",
    ],
    schema: [
      {
        name: "uploader",
        type: "relation",
        // Keep the song when its uploader leaves (other people's playlists
        // may point at it): the link is emptied, so it can't be required.
        required: false,
        options: { collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      },
      { name: "title", type: "text", required: true, options: { max: 200 } },
      { name: "artist", type: "text", required: false, options: { max: 200 } },
      { name: "album", type: "text", required: false, options: { max: 200 } },
      { name: "duration_sec", type: "number", required: false, options: { min: 0 } },
      // Relative to MUSIC_DIR/uploads, e.g. "a1b2c3d4.mp3".
      { name: "filename", type: "text", required: true, options: { max: 300 } },
      { name: "mime", type: "text", required: false, options: { max: 100 } },
      // "jpg" / "png" when the file carried an embedded cover we extracted to
      // MUSIC_DIR/uploads/<id>.<ext>; empty when it did not. Existing
      // installs get this from ensure_uploads_artwork instead.
      { name: "artwork_ext", type: "text", required: false, options: { max: 4 } },
      { name: "size_bytes", type: "number", required: false, options: { min: 0 } },
    ],
  });
  dao.saveCollection(collection);
  console.log("[ensure_uploads] created uploads");
});
