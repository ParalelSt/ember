/// <reference path="../pb_data/types.d.ts" />

// Carlist live sessions: creates the four session collections on boot if
// they don't exist yet (same zero-manual-setup pattern as ensure_superuser),
// and keeps their rules current on existing installs.
//
// Security note: /pb is publicly proxied, so these RULES are the boundary.
// Every write is server-only (bughunt X2): the Next routes under
// app/api/sessions check host or membership and then write with the server's
// admin client. Reading is limited to the host and the people who joined, so
// nobody can list other carlists' join codes or put themselves on a roster.
//
// session_members used to live in its own hook, which ran before this one and
// so found no sessions collection on a fresh install's first boot. It is
// created here now, after sessions.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  const find = (name) => {
    try {
      return dao.findCollectionByNameOrId(name);
    } catch (_) {
      return null;
    }
  };

  const users = find("users");
  const tracks = find("tracks");
  if (!users || !tracks) {
    console.log("[ensure_sessions] users/tracks collections missing, skipping");
    return;
  }

  if (!find("sessions")) {
    dao.saveCollection(new Collection({
      name: "sessions",
      type: "base",
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
    }));
    console.log("[ensure_sessions] created sessions");
  }

  const sessionsCol = find("sessions");

  if (!find("session_tracks")) {
    dao.saveCollection(new Collection({
      name: "session_tracks",
      type: "base",
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
    }));
    console.log("[ensure_sessions] created session_tracks");
  }

  if (!find("session_commands")) {
    dao.saveCollection(new Collection({
      name: "session_commands",
      type: "base",
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
    }));
    console.log("[ensure_sessions] created session_commands");
  }

  // The roster: who actually joined, so knowing a session id is not
  // membership.
  if (!find("session_members")) {
    dao.saveCollection(new Collection({
      name: "session_members",
      type: "base",
      indexes: ["CREATE UNIQUE INDEX idx_session_members_pair ON session_members (session, user)"],
      schema: [
        {
          name: "session",
          type: "relation",
          required: true,
          options: { collectionId: sessionsCol.id, maxSelect: 1, cascadeDelete: true },
        },
        {
          name: "user",
          type: "relation",
          required: true,
          options: { collectionId: users.id, maxSelect: 1, cascadeDelete: true },
        },
      ],
    }));
    console.log("[ensure_sessions] created session_members");
  }

  const HOST_OR_MEMBER = "host = @request.auth.id || session_members_via_session.user ?= @request.auth.id";
  const IN_SESSION = "session.host = @request.auth.id || session.session_members_via_session.user ?= @request.auth.id";
  const RULES = {
    sessions: HOST_OR_MEMBER,
    session_tracks: IN_SESSION,
    session_commands: "session.host = @request.auth.id",
    session_members: "user = @request.auth.id || session.host = @request.auth.id",
  };

  // Rules come back from Go as string pointers, so compare the JSON form
  // (same as ensure_tabs).
  const rule = (r) => (r === null || r === undefined ? null : JSON.parse(JSON.stringify(r)));
  for (const name in RULES) {
    const col = find(name);
    const read = RULES[name];
    if (
      rule(col.listRule) === read &&
      rule(col.viewRule) === read &&
      rule(col.createRule) === null &&
      rule(col.updateRule) === null &&
      rule(col.deleteRule) === null
    ) continue;
    col.listRule = read;
    col.viewRule = read;
    col.createRule = null;
    col.updateRule = null;
    col.deleteRule = null;
    dao.saveCollection(col);
    console.log(`[ensure_sessions] ${name}: server-written, readable by the carlist only`);
  }
});
