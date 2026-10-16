/// <reference path="../pb_data/types.d.ts" />

// mixes: each member's genre mixes (docs/mixes.md), rebuilt every night by
// the web app (apps/web/lib/mixes/job.ts). One row per member and mix.
//
//   user      the member (deleting them deletes their mixes)
//   key       the family or half slug ("rock-metal", "metal", "balkan");
//             unique per member
//   title     "Rock & Metal" (the card shows "MIX" on its own)
//   subtitle  "Gojira, Tool, Metallica and more"
//   position  order on Home, heaviest family first
//   tracks    up to 50 track snapshots (the app's Track shape): one row
//             written a night, not 50 catalog upserts
//   seeds     the songKeys the day's radio was seeded from
//   cover     { artworkUrls: [up to 3], color }
//   built_at  ISO time of the build
//
// A member reads only their own rows (list/view rules). Rows are written
// and deleted only by the web app's admin client: create, update and delete
// stay null.

onAfterBootstrap((e) => {
  const OWN = '@request.auth.id != "" && user = @request.auth.id';
  const dao = $app.dao();
  let existing = null;
  try {
    existing = dao.findCollectionByNameOrId("mixes");
  } catch (_) {
    existing = null;
  }
  if (existing) return;
  let users;
  try {
    users = dao.findCollectionByNameOrId("users");
  } catch (err) {
    console.log("[ensure_mixes] users missing, skipping:", err);
    return;
  }
  try {
    dao.saveCollection(new Collection({
      name: "mixes",
      type: "base",
      listRule: OWN,
      viewRule: OWN,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      indexes: ["CREATE UNIQUE INDEX idx_mixes_user_key ON mixes (user, key)"],
      schema: [
        { name: "user", type: "relation", required: true, options: { collectionId: users.id, maxSelect: 1, cascadeDelete: true } },
        { name: "key", type: "text", required: true, options: { max: 40 } },
        { name: "title", type: "text", options: { max: 100 } },
        { name: "subtitle", type: "text", options: { max: 300 } },
        { name: "position", type: "number", options: { noDecimal: true } },
        { name: "tracks", type: "json", options: { maxSize: 500000 } },
        { name: "seeds", type: "json", options: { maxSize: 5000 } },
        { name: "cover", type: "json", options: { maxSize: 5000 } },
        { name: "built_at", type: "text", options: { max: 40 } },
      ],
    }));
    console.log("[ensure_mixes] created mixes");
  } catch (err) {
    console.warn("[ensure_mixes] could not create mixes: " + err);
  }
});
