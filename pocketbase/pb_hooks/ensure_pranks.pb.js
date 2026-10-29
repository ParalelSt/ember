/// <reference path="../pb_data/types.d.ts" />

// Admin pranks: creates the prank collections on boot if they don't exist
// yet, same zero-setup pattern as ensure_sessions.
//
//   prank_sounds     the admin library (short sounds and swap songs)
//   prank_schedules  repeating pranks, turned into pranks rows by a server tick
//   pranks           command queue AND audit log: one row per prank sent
//   app_settings     key/value switches; key "pranks" holds { enabled }
//
// Security: /pb is publicly proxied, so these rules are the boundary. No
// client writes anything here: every create/update/delete rule is null and
// the Next routes write with the admin client. A target can read only its
// own PENDING rows (that is what its realtime subscription needs); once a
// row is acknowledged it drops out of the target's view, so the history of
// pranks is visible to admins only.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  const find = (name) => {
    try {
      return dao.findCollectionByNameOrId(name);
    } catch (_) {
      return null;
    }
  };

  // A failed first-time create must not stop PocketBase from booting: warn
  // and carry on (bughunt X11). A collection whose relation target could not
  // be made is skipped too, and the next boot tries again.
  const create = (def) => {
    try {
      dao.saveCollection(new Collection(def));
      console.log(`[ensure_pranks] created ${def.name}`);
    } catch (err) {
      console.warn(`[ensure_pranks] could not create ${def.name}: ` + err);
    }
  };

  let users;
  try {
    users = dao.findCollectionByNameOrId("users");
  } catch (err) {
    console.log("[ensure_pranks] users collection missing, skipping:", err);
    return;
  }

  const ADMIN = "@request.auth.is_admin = true";

  if (!find("prank_sounds")) {
    create({
      name: "prank_sounds",
      type: "base",
      listRule: ADMIN,
      viewRule: ADMIN,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      indexes: ["CREATE INDEX idx_prank_sounds_kind ON prank_sounds (kind)"],
      schema: [
        { name: "kind", type: "select", required: true, options: { maxSelect: 1, values: ["sound", "song"] } },
        { name: "name", type: "text", required: true, options: { max: 120 } },
        { name: "filename", type: "text", required: true, options: { max: 200 } },
        { name: "mime", type: "text", options: { max: 60 } },
        { name: "duration_sec", type: "number", options: { min: 0 } },
        { name: "size_bytes", type: "number", options: { min: 0, noDecimal: true } },
        {
          name: "uploaded_by",
          type: "relation",
          options: { collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        },
      ],
    });
  }

  const sounds = find("prank_sounds");
  const KINDS = ["swap", "sound", "ping"];

  if (sounds && !find("prank_schedules")) {
    create({
      name: "prank_schedules",
      type: "base",
      listRule: ADMIN,
      viewRule: ADMIN,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      indexes: ["CREATE INDEX idx_prank_schedules_active ON prank_schedules (active, next_fire_at)"],
      schema: [
        {
          name: "target",
          type: "relation",
          required: true,
          options: { collectionId: users.id, maxSelect: 1, cascadeDelete: true },
        },
        {
          name: "issued_by",
          type: "relation",
          options: { collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        },
        { name: "kind", type: "select", required: true, options: { maxSelect: 1, values: KINDS } },
        {
          name: "sound",
          type: "relation",
          options: { collectionId: sounds.id, maxSelect: 1, cascadeDelete: false },
        },
        { name: "params", type: "json", options: { maxSize: 4000 } },
        { name: "interval_sec", type: "number", required: true, options: { min: 1, noDecimal: true } },
        { name: "ends_at", type: "date", required: true, options: {} },
        { name: "next_fire_at", type: "date", options: {} },
        { name: "active", type: "bool", options: {} },
        { name: "fired", type: "number", options: { min: 0, noDecimal: true } },
      ],
    });
  }

  const schedules = find("prank_schedules");

  if (sounds && schedules && !find("pranks")) {
    create({
      name: "pranks",
      type: "base",
      listRule: '(target = @request.auth.id && status = "pending") || ' + ADMIN,
      viewRule: '(target = @request.auth.id && status = "pending") || ' + ADMIN,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      indexes: [
        "CREATE INDEX idx_pranks_target_status ON pranks (target, status)",
        "CREATE INDEX idx_pranks_created ON pranks (created)",
      ],
      schema: [
        {
          name: "target",
          type: "relation",
          required: true,
          options: { collectionId: users.id, maxSelect: 1, cascadeDelete: true },
        },
        {
          name: "issued_by",
          type: "relation",
          options: { collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        },
        {
          name: "schedule",
          type: "relation",
          options: { collectionId: schedules.id, maxSelect: 1, cascadeDelete: false },
        },
        { name: "kind", type: "select", required: true, options: { maxSelect: 1, values: KINDS } },
        {
          name: "sound",
          type: "relation",
          options: { collectionId: sounds.id, maxSelect: 1, cascadeDelete: false },
        },
        { name: "params", type: "json", options: { maxSize: 4000 } },
        {
          name: "status",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: ["pending", "delivered", "skipped", "done", "expired", "cancelled"],
          },
        },
        { name: "reason", type: "text", options: { max: 120 } },
        { name: "engine", type: "text", options: { max: 20 } },
        { name: "app_version", type: "text", options: { max: 80 } },
        { name: "expires_at", type: "date", required: true, options: {} },
        { name: "delivered_at", type: "date", options: {} },
        { name: "done_at", type: "date", options: {} },
        { name: "played_sec", type: "number", options: { min: 0 } },
      ],
    });
  }

  if (!find("app_settings")) {
    create({
      name: "app_settings",
      type: "base",
      listRule: ADMIN,
      viewRule: ADMIN,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      indexes: ["CREATE UNIQUE INDEX idx_app_settings_key ON app_settings (key)"],
      schema: [
        { name: "key", type: "text", required: true, options: { max: 60 } },
        { name: "value", type: "json", options: { maxSize: 20000 } },
      ],
    });
  }

  const settings = find("app_settings");
  if (!settings) return;
  try {
    dao.findFirstRecordByFilter("app_settings", 'key = "pranks"');
  } catch (_) {
    try {
      const rec = new Record(settings);
      rec.set("key", "pranks");
      rec.set("value", { enabled: true });
      dao.saveRecord(rec);
      console.log("[ensure_pranks] created the pranks switch (on)");
    } catch (err) {
      console.warn("[ensure_pranks] could not create the pranks switch: " + err);
    }
  }
});
