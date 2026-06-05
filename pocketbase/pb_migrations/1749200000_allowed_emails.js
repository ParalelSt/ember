/// <reference path="../pb_data/types.d.ts" />

// Invite-only registration. Creates an allowed_emails collection, seeds the
// initial invitees, and gates users.create on membership.
migrate((db) => {
  const dao = new Dao(db);

  const allowed = new Collection({
    name: "allowed_emails",
    type: "base",
    schema: [
      { name: "email", type: "email", required: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_allowed_emails_email` ON `allowed_emails` (`email`)",
    ],
    // Only the PB super-admin reads/writes via the admin UI. Server route
    // handlers query via the admin client, which bypasses rules.
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  dao.saveCollection(allowed);

  const seed = [
    "luka29071@gmail.com",
    "mihajloentertainment@gmail.com",
    "aronddtt@gmail.com",
  ];
  for (const email of seed) {
    const rec = new Record(allowed, { email: email });
    dao.saveRecord(rec);
  }

  // Gate user registration on allow-list membership. PB filter: the `email`
  // identifier on the right resolves to the incoming record's email field.
  // `?=` is the "any-of" operator — true if ANY row in allowed_emails has
  // an email equal to the incoming email. `=` would require ALL rows to
  // match, which is never true for a multi-row collection.
  const users = dao.findCollectionByNameOrId("users");
  users.createRule = "@collection.allowed_emails.email ?= email";
  dao.saveCollection(users);
}, (db) => {
  const dao = new Dao(db);
  const users = dao.findCollectionByNameOrId("users");
  users.createRule = "";
  dao.saveCollection(users);
  const allowed = dao.findCollectionByNameOrId("allowed_emails");
  dao.deleteCollection(allowed);
});
