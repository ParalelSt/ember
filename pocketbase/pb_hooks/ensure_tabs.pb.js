/// <reference path="../pb_data/types.d.ts" />

// Guitar Pro tab files — metadata for the files stored in MUSIC_DIR/tabs.
// A tab is private to whoever uploaded it (unlike the shared music library):
// it is that person's own copy of a file they got elsewhere.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  try {
    dao.findCollectionByNameOrId("tabs");
    return;
  } catch (_) {
    // create it below
  }

  let users, tracks;
  try {
    users = dao.findCollectionByNameOrId("users");
    tracks = dao.findCollectionByNameOrId("tracks");
  } catch (err) {
    console.log("[ensure_tabs] users/tracks missing, skipping:", err);
    return;
  }

  const tabs = new Collection({
    name: "tabs",
    type: "base",
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    // Rows are written only by the upload route (through the admin client), so
    // a record can never disagree with what is actually on disk.
    createRule: null,
    updateRule: null,
    deleteRule: "user = @request.auth.id",
    indexes: ["CREATE INDEX idx_tabs_user ON tabs (user)"],
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
        required: false,
        options: { collectionId: tracks.id, maxSelect: 1, cascadeDelete: false },
      },
      { name: "title", type: "text", required: true, options: { max: 200 } },
      { name: "artist", type: "text", options: { max: 200 } },
      { name: "instrument", type: "text", options: { max: 60 } },
      { name: "file", type: "text", required: true, options: { max: 120 } },
      { name: "size_bytes", type: "number", options: { noDecimal: true } },
    ],
  });
  dao.saveCollection(tabs);
  console.log("[ensure_tabs] created tabs");
});
