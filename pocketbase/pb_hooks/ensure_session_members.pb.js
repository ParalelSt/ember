/// <reference path="../pb_data/types.d.ts" />

// Carlist membership roster — records who actually joined a session, so the
// Next routes can tell a passenger apart from a member who merely knows the
// session id (before this, any logged-in user could queue tracks and skip
// songs on somebody else's carlist).
//
// Security note: /pb is publicly proxied and these rules are "any authenticated
// user", the same accepted tradeoff as ensure_sessions — the per-session checks
// live in the Next routes on top.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  try {
    dao.findCollectionByNameOrId("session_members");
    return; // already created
  } catch (_) {
    // fall through and create it
  }

  let users, sessions;
  try {
    users = dao.findCollectionByNameOrId("users");
    sessions = dao.findCollectionByNameOrId("sessions");
  } catch (err) {
    console.log("[ensure_session_members] users/sessions missing, skipping:", err);
    return;
  }

  const members = new Collection({
    name: "session_members",
    type: "base",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != "" && user = @request.auth.id',
    updateRule: null,
    deleteRule: "user = @request.auth.id || session.host = @request.auth.id",
    indexes: [
      "CREATE UNIQUE INDEX idx_session_members_pair ON session_members (session, user)",
    ],
    schema: [
      {
        name: "session",
        type: "relation",
        required: true,
        options: { collectionId: sessions.id, maxSelect: 1, cascadeDelete: true },
      },
      {
        name: "user",
        type: "relation",
        required: true,
        options: { collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      },
    ],
  });
  dao.saveCollection(members);
  console.log("[ensure_session_members] created session_members");
});
