/// <reference path="../pb_data/types.d.ts" />

// Carlist live sessions — creates the three session collections on boot if
// they don't exist yet (same zero-manual-setup pattern as ensure_superuser).
//
// Security note: /pb is publicly proxied, so these RULES are the boundary.
// "Any authenticated user" access is an accepted tradeoff on this invite-only
// server; the Next routes add per-session checks on top.

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

  let users, tracks;
  try {
    users = dao.findCollectionByNameOrId("users");
    tracks = dao.findCollectionByNameOrId("tracks");
  } catch (err) {
    console.log("[ensure_sessions] users/tracks collections missing, skipping:", err);
    return;
  }

  if (!exists("sessions")) {
    const sessions = new Collection({
      name: "sessions",
      type: "base",
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != "" && host = @request.auth.id',
      updateRule: "host = @request.auth.id",
      deleteRule: "host = @request.auth.id",
      indexes: ["CREATE UNIQUE INDEX idx_sessions_code ON sessions (code)"],
      schema: [
        { name: "code", type: "text", required: true, options: { min: 4, max: 12 } },
        { name: "name", type: "text", required: true, options: { max: 120 } },
        {
          name: "host",
          type: "relation",
          required: true,
          options: { collectionId: users.id, maxSelect: 1, cascadeDelete: true },
        },
        { name: "active", type: "bool", options: {} },
        { name: "now_index", type: "number", options: { noDecimal: true } },
      ],
    });
    dao.saveCollection(sessions);
    console.log("[ensure_sessions] created sessions");
  }

  const sessionsCol = dao.findCollectionByNameOrId("sessions");

  if (!exists("session_tracks")) {
    const sessionTracks = new Collection({
      name: "session_tracks",
      type: "base",
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != "" && added_by = @request.auth.id',
      updateRule: "session.host = @request.auth.id",
      deleteRule: "session.host = @request.auth.id || added_by = @request.auth.id",
      indexes: ["CREATE INDEX idx_session_tracks_session ON session_tracks (session)"],
      schema: [
        {
          name: "session",
          type: "relation",
          required: true,
          options: { collectionId: sessionsCol.id, maxSelect: 1, cascadeDelete: true },
        },
        {
          name: "track",
          type: "relation",
          required: true,
          options: { collectionId: tracks.id, maxSelect: 1, cascadeDelete: false },
        },
        { name: "position", type: "number", required: true, options: { noDecimal: true } },
        {
          name: "added_by",
          type: "relation",
          required: true,
          options: { collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        },
        { name: "played", type: "bool", options: {} },
      ],
    });
    dao.saveCollection(sessionTracks);
    console.log("[ensure_sessions] created session_tracks");
  }

  if (!exists("session_commands")) {
    const sessionCommands = new Collection({
      name: "session_commands",
      type: "base",
      listRule: "session.host = @request.auth.id",
      viewRule: "session.host = @request.auth.id",
      createRule: '@request.auth.id != "" && issued_by = @request.auth.id',
      updateRule: null,
      deleteRule: "session.host = @request.auth.id",
      indexes: ["CREATE INDEX idx_session_commands_session ON session_commands (session)"],
      schema: [
        {
          name: "session",
          type: "relation",
          required: true,
          options: { collectionId: sessionsCol.id, maxSelect: 1, cascadeDelete: true },
        },
        { name: "type", type: "text", required: true, options: { max: 20 } },
        {
          name: "issued_by",
          type: "relation",
          required: true,
          options: { collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        },
      ],
    });
    dao.saveCollection(sessionCommands);
    console.log("[ensure_sessions] created session_commands");
  }
});
