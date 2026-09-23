/// <reference path="../pb_data/types.d.ts" />

// Admin pranks (docs/superpowers/plans/2026-09-23-admin-pranks.md): creates
// the prank collections on boot if they don't exist yet, same zero-setup
// pattern as ensure_sessions.
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

  const exists = (name) => {
    try {
      dao.findCollectionByNameOrId(name);
      return true;
    } catch (_) {
      return false;
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

  if (!exists("prank_sounds")) {
    dao.saveCollection(
      new Collection({
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
      }),
    );
    console.log("[ensure_pranks] created prank_sounds");
  }

  const sounds = dao.findCollectionByNameOrId("prank_sounds");
  const KINDS = ["swap", "sound", "ping"];

  if (!exists("prank_schedules")) {
    dao.saveCollection(
      new Collection({
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
      }),
    );
    console.log("[ensure_pranks] created prank_schedules");
  }

  const schedules = dao.findCollectionByNameOrId("prank_schedules");

  if (!exists("pranks")) {
    dao.saveCollection(
      new Collection({
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
      }),
    );
    console.log("[ensure_pranks] created pranks");
  }

  if (!exists("app_settings")) {
    dao.saveCollection(
      new Collection({
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
      }),
    );
    console.log("[ensure_pranks] created app_settings");
  }

  try {
    dao.findFirstRecordByFilter("app_settings", 'key = "pranks"');
  } catch (_) {
    const rec = new Record(dao.findCollectionByNameOrId("app_settings"));
    rec.set("key", "pranks");
    rec.set("value", { enabled: true });
    dao.saveRecord(rec);
    console.log("[ensure_pranks] created the pranks switch (on)");
  }
});
