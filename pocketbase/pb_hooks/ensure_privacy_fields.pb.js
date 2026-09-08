/// <reference path="../pb_data/types.d.ts" />

// Privacy toggles — two independent switches for "don't broadcast what I'm
// playing":
//
//   share_discord    → Discord rich presence
//   share_listening  → the "Friends are listening to" section on Home
//
// Stored as share_* so that OFF is the default. PocketBase bool fields default
// to false and existing users have no value at all, so everybody starts not
// sharing and opts in deliberately — which is the right default for a switch
// about broadcasting what you listen to.
//
// This replaces an earlier inverted pair (hide_discord / hide_listening) that
// defaulted everyone to visible. Those columns are left in place and ignored;
// dropping them would buy nothing and risks a destructive migration. Anyone
// who had sharing on by default is now off, which is the safe direction.
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

  const wanted = ["share_discord", "share_listening"];
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
