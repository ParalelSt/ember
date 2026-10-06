/// <reference path="../pb_data/types.d.ts" />

// Background playlist imports (docs/imports.md, section 5).
//
//   import_jobs   one pasted link being imported into one new playlist:
//                 where it came from, how far the runner got (cursor), its
//                 status and the running counts.
//   import_items  one row per source track, kept for every track (accepted
//                 or not) with all its scored candidates, so any song can be
//                 re-picked later.
//
// Both are written only by the server (lib/import/store.ts, admin client):
// the runner owns the loop, and a client-writable status or cursor would let
// a page fight it. A user reads only their own jobs and items; an Ember
// admin (users.is_admin) reads all of them.
//
// A job with `kind: 'liked'` is a transfer: it has no playlist, its accepted
// songs become likes instead, its items carry the `liked_at` those likes get,
// and `existing` counts the ones the person had already liked. An item's
// `like_id` is the like it made (empty when the song was already liked), so
// re-matching it removes only that like.
//
// Playlists get `source_url` and `import_job`, so a later re-sync knows
// where a playlist came from.
//
// Created on boot if missing, same pattern as the other ensure_* hooks.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  // Every value import_jobs.source can take: the three pasted-link sources
  // and the transfer ones (uploads, pastes, free public APIs). New values
  // are added to the existing select below, so an install created before a
  // source existed learns about it. Declared in here because a pb_hooks
  // handler runs in its own context and cannot see the file's own scope.
  const SOURCE_VALUES = [
    "spotify",
    "ytmusic",
    "youtube",
    "spotify-export",
    "csv",
    "paste",
    "lastfm",
    "deezer",
    "apple-export",
  ];

  let users, playlists;
  try {
    users = dao.findCollectionByNameOrId("users");
    playlists = dao.findCollectionByNameOrId("playlists");
  } catch (err) {
    console.log("[ensure_imports] users/playlists missing, skipping:", err);
    return;
  }

  const OWN = "user = @request.auth.id || @request.auth.is_admin = true";
  const OWN_JOB = "job.user = @request.auth.id || @request.auth.is_admin = true";

  let jobs;
  try {
    jobs = dao.findCollectionByNameOrId("import_jobs");
  } catch (_) {
    jobs = new Collection({
      name: "import_jobs",
      type: "base",
      listRule: OWN,
      viewRule: OWN,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      indexes: [
        "CREATE INDEX idx_import_jobs_user ON import_jobs (user)",
        "CREATE INDEX idx_import_jobs_status ON import_jobs (status)",
      ],
      schema: [
        {
          name: "user",
          type: "relation",
          required: true,
          options: { collectionId: users.id, maxSelect: 1, cascadeDelete: true },
        },
        {
          name: "source",
          type: "select",
          required: true,
          options: { maxSelect: 1, values: SOURCE_VALUES },
        },
        { name: "kind", type: "select", required: true, options: { maxSelect: 1, values: ["playlist", "liked"] } },
        { name: "source_id", type: "text", options: { max: 120 } },
        { name: "source_url", type: "text", options: { max: 500 } },
        { name: "name", type: "text", options: { max: 200 } },
        { name: "cover_url", type: "text", options: { max: 500 } },
        { name: "total", type: "number", options: { min: 0, noDecimal: true } },
        // Source position of the next item to match (0-based).
        { name: "cursor", type: "number", options: { min: 0, noDecimal: true } },
        {
          name: "status",
          type: "select",
          required: true,
          options: { maxSelect: 1, values: ["queued", "running", "paused", "done", "failed", "cancelled"] },
        },
        { name: "accepted", type: "number", options: { min: 0, noDecimal: true } },
        { name: "review", type: "number", options: { min: 0, noDecimal: true } },
        { name: "missing", type: "number", options: { min: 0, noDecimal: true } },
        // A transfer only: accepted songs the person had already liked.
        { name: "existing", type: "number", options: { min: 0, noDecimal: true } },
        {
          name: "playlist",
          type: "relation",
          // Deleting the playlist ends its import.
          options: { collectionId: playlists.id, maxSelect: 1, cascadeDelete: true },
        },
        { name: "error", type: "text", options: { max: 300 } },
        // Paused by a backoff: when the runner tries again. Empty on a pause
        // that waits for the Retry button.
        { name: "retry_at", type: "date", options: {} },
        // The runner that holds the job and when it last said so. A running
        // job whose heartbeat is stale belonged to a server that stopped.
        { name: "runner", type: "text", options: { max: 60 } },
        { name: "heartbeat", type: "date", options: {} },
        // The Done summary was closed.
        { name: "dismissed", type: "bool", options: {} },
      ],
    });
    dao.saveCollection(jobs);
    console.log("[ensure_imports] created import_jobs");
  }

  try {
    dao.findCollectionByNameOrId("import_items");
  } catch (_) {
    const items = new Collection({
      name: "import_items",
      type: "base",
      listRule: OWN_JOB,
      viewRule: OWN_JOB,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      indexes: ["CREATE UNIQUE INDEX idx_import_items_job_position ON import_items (job, position)"],
      schema: [
        {
          name: "job",
          type: "relation",
          required: true,
          options: { collectionId: jobs.id, maxSelect: 1, cascadeDelete: true },
        },
        // 0-based position in the source playlist.
        { name: "position", type: "number", options: { min: 0, noDecimal: true } },
        // A transfer only: when the like this song becomes is dated.
        { name: "liked_at", type: "date", options: {} },
        { name: "source_title", type: "text", options: { max: 300 } },
        { name: "source_artists", type: "json", options: { maxSize: 20000 } },
        { name: "source_duration_ms", type: "number", options: { min: 0, noDecimal: true } },
        // true, false, or null when the source does not say.
        { name: "source_explicit", type: "json", options: { maxSize: 20 } },
        { name: "source_uri", type: "text", options: { max: 200 } },
        {
          name: "status",
          type: "select",
          required: true,
          options: {
            maxSelect: 1,
            values: ["pending", "accepted", "review", "missing", "resolved", "skipped"],
          },
        },
        { name: "video_id", type: "text", options: { max: 20 } },
        { name: "confidence", type: "number", options: {} },
        // Every scored candidate, best first (ImportCandidate[]).
        { name: "candidates", type: "json", options: { maxSize: 200000 } },
        // A transfer only: the likes record this item created.
        { name: "like_id", type: "text", options: { max: 30 } },
      ],
    });
    dao.saveCollection(items);
    console.log("[ensure_imports] created import_items");
  }

  // Fields and select values added after the collections first shipped.
  let itemsColl;
  try {
    jobs = dao.findCollectionByNameOrId("import_jobs");
    itemsColl = dao.findCollectionByNameOrId("import_items");
  } catch (err) {
    console.log("[ensure_imports] import collections missing, skipping the field pass:", err);
    return;
  }

  let jobFields = 0;
  if (!jobs.schema.getFieldByName("existing")) {
    jobs.schema.addField(
      new SchemaField({ name: "existing", type: "number", required: false, options: { min: 0, noDecimal: true } }),
    );
    jobFields++;
  }
  const sourceField = jobs.schema.getFieldByName("source");
  if (sourceField) {
    const have = sourceField.options.values || [];
    const merged = have.slice();
    for (const v of SOURCE_VALUES) if (merged.indexOf(v) === -1) merged.push(v);
    if (merged.length !== have.length) {
      sourceField.options.values = merged;
      jobFields++;
    }
  }
  if (jobFields) {
    dao.saveCollection(jobs);
    console.log("[ensure_imports] updated " + jobFields + " import_jobs field(s)");
  }

  let itemFields = 0;
  if (!itemsColl.schema.getFieldByName("liked_at")) {
    itemsColl.schema.addField(new SchemaField({ name: "liked_at", type: "date", required: false, options: {} }));
    itemFields++;
  }
  // Items saved before this field existed stay empty, and an empty one
  // never unlikes anything.
  if (!itemsColl.schema.getFieldByName("like_id")) {
    itemsColl.schema.addField(new SchemaField({ name: "like_id", type: "text", required: false, options: { max: 30 } }));
    itemFields++;
  }
  if (itemFields) {
    dao.saveCollection(itemsColl);
    console.log("[ensure_imports] updated " + itemFields + " import_items field(s)");
  }

  let added = 0;
  if (!playlists.schema.getFieldByName("source_url")) {
    playlists.schema.addField(new SchemaField({ name: "source_url", type: "text", required: false, options: { max: 500 } }));
    added++;
  }
  if (!playlists.schema.getFieldByName("import_job")) {
    // The job's id as text, not a relation: the job already points at its
    // playlist (cascading), and a relation both ways would make deleting a
    // playlist fight over which record goes first.
    playlists.schema.addField(new SchemaField({ name: "import_job", type: "text", required: false, options: { max: 30 } }));
    added++;
  }
  if (added) {
    dao.saveCollection(playlists);
    console.log("[ensure_imports] added " + added + " playlist field(s)");
  }
});
