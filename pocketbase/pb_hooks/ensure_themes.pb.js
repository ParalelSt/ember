/// <reference path="../pb_data/types.d.ts" />

// Themes (docs/superpowers/plans/2026-09-23-themes.md, with the owner's
// decisions): a saved list of named custom themes per person, any of which
// can be shared with everyone on this server, plus the ACTIVE theme on the
// user row.
//
//   users.theme  (json)  the active theme, colours copied in, e.g.
//                        { "v": 1, "preset": "midnight" } or
//                        { "v": 1, "preset": "forest", "custom": {...},
//                          "name": "Late shift", "themeId": "<themes id>" }
//                        It rides in the pb_auth cookie, so the root layout
//                        paints the theme into the first HTML byte. Only the
//                        owner reads or writes it (the users rules already
//                        say "id = @request.auth.id").
//
//   themes       owner (relation), name, base (the preset it started from),
//                inputs (json, the eight colours), shared (bool)
//
// Security: /pb is publicly proxied, so these rules are the boundary. Anyone
// signed in sees their own rows plus rows shared with everyone. Nobody
// writes from the client: create, update and delete are null and the Next
// routes (app/api/themes) write with the admin client after checking the
// owner, validating the colours and running the readability guard. The cap
// of 20 themes per person is checked by the route and again below.
//
// Added on boot if missing, same pattern as the other ensure_* hooks.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  let users;
  try {
    users = dao.findCollectionByNameOrId("users");
  } catch (err) {
    console.log("[ensure_themes] users collection missing, skipping:", err);
    return;
  }

  if (!users.schema.getFieldByName("theme")) {
    users.schema.addField(
      new SchemaField({
        name: "theme",
        type: "json",
        required: false,
        options: { maxSize: 4000 },
      }),
    );
    dao.saveCollection(users);
    console.log("[ensure_themes] added the theme field to users");
  }

  try {
    dao.findCollectionByNameOrId("themes");
    return;
  } catch (_) {
    // Missing: create it below.
  }

  const VISIBLE = '@request.auth.id != "" && (owner = @request.auth.id || shared = true)';
  dao.saveCollection(
    new Collection({
      name: "themes",
      type: "base",
      listRule: VISIBLE,
      viewRule: VISIBLE,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      indexes: [
        "CREATE INDEX idx_themes_owner ON themes (owner)",
        "CREATE INDEX idx_themes_shared ON themes (shared)",
      ],
      schema: [
        {
          name: "owner",
          type: "relation",
          required: true,
          options: { collectionId: users.id, maxSelect: 1, cascadeDelete: true },
        },
        { name: "name", type: "text", required: true, options: { min: 1, max: 40 } },
        {
          name: "base",
          type: "select",
          required: true,
          options: { maxSelect: 1, values: ["ember", "midnight", "forest", "nebula", "mono"] },
        },
        { name: "inputs", type: "json", required: true, options: { maxSize: 2000 } },
        { name: "shared", type: "bool", options: {} },
      ],
    }),
  );
  console.log("[ensure_themes] created themes");
});

// The cap, enforced where no client can get round it. The route says the
// same thing first with a friendlier status; this catches anything else
// that creates rows (a second route, the admin UI).
onRecordBeforeCreateRequest((e) => {
  const CAP = 20;
  const owner = e.record.getString("owner");
  const rows = $app.dao().findRecordsByFilter("themes", "owner = {:owner}", "", CAP + 1, 0, { owner: owner });
  if (rows.length >= CAP) {
    throw new BadRequestError("You can keep up to " + CAP + " themes. Delete one to make room.");
  }
}, "themes");
