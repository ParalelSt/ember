/// <reference path="../pb_data/types.d.ts" />

// Changelog read state, per user so it follows them across devices:
//
//   changelog_seen_version  (text) the app version they last marked read
//   changelog_hide_new      (bool) "Don't show New tags"
//
// An empty seen version means "never loaded": the web app then writes the
// current version, so a brand new user sees nothing as New. See
// docs/changelog-system.md.
//
// Added on boot if missing, same pattern as ensure_privacy_fields.pb.js.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  let users;
  try {
    users = dao.findCollectionByNameOrId("users");
  } catch (err) {
    console.log("[ensure_changelog_fields] users collection missing, skipping:", err);
    return;
  }

  const wanted = [
    { name: "changelog_seen_version", type: "text" },
    { name: "changelog_hide_new", type: "bool" },
  ];
  let added = 0;

  for (const f of wanted) {
    if (users.schema.getFieldByName(f.name)) continue;
    users.schema.addField(
      new SchemaField({
        name: f.name,
        type: f.type,
        required: false,
        options: {},
      }),
    );
    added++;
  }

  if (added === 0) return;

  dao.saveCollection(users);
  console.log("[ensure_changelog_fields] added " + added + " changelog field(s) to users");
});
