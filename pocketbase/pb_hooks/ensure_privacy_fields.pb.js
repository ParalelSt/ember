/// <reference path="../pb_data/types.d.ts" />

// Privacy toggles — two independent switches for "don't broadcast what I'm
// playing":
//
//   hide_discord    → Discord rich presence
//   hide_listening  → the "Friends are listening to" section on Home
//
// Stored INVERTED (hide_* rather than share_*) on purpose. PocketBase bool
// fields default to false, and every existing user has no value at all — so
// hide_* = false means everyone keeps their current, visible behaviour with
// no backfill migration. A share_* field would have defaulted everybody to
// hidden the moment this shipped.
//
// Added on boot if missing, same pattern as the other ensure_* hooks.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  let users;
  try {
    users = dao.findCollectionByNameOrId("users");
  } catch (err) {
    console.log("[ensure_privacy_fields] users collection missing, skipping:", err);
    return;
  }

  const wanted = ["hide_discord", "hide_listening"];
  let added = 0;

  for (const name of wanted) {
    if (users.schema.getFieldByName(name)) continue;
    users.schema.addField(
      new SchemaField({
        name: name,
        type: "bool",
        required: false,
        options: {},
      }),
    );
    added++;
  }

  if (added === 0) return;

  dao.saveCollection(users);
  console.log("[ensure_privacy_fields] added " + added + " privacy field(s) to users");
});
