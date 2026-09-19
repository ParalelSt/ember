/// <reference path="../pb_data/types.d.ts" />

// The one tab store (docs/tabs-rebuild.md section 3): a row per tab, whether
// someone added a Guitar Pro / MusicXML file or Ember generated one from the
// recording. Files stay on disk in MUSIC_DIR/tabs (generated ones in
// MUSIC_DIR/tabs/generated); the row is the metadata.
//
//   song_key   normalized "title::artist" (apps/web/lib/songKey.ts), the lookup
//   track_key  the app's compound track id it was added for, e.g. youtube:abc
//   kind       "file", "pasted" (a text tab, stored as alphatex beside the
//              original .txt), "fetched" (a text tab Ember found online,
//              docs/tabs-v3.md) or "generated"
//   format     gp3, gp4, gp5, gpx, gp, musicxml, mxl or alphatex
//   shared     visible to every signed-in member; new rows are shared
//   offset_ms  sync nudge against the recording, shared by everyone
//   hints      Songsterr metadata (songId, per-track tuning, difficulty)
//   source_*   where a fetched tab was found: site ("songsterr", "ug"), page
//              URL, the site's id, rating and votes, and source_meta (JSON:
//              part, version, the site's tuning, the parse report)
//   timing     where the tab sits in the recording, as align.py heard it
//              (docs/tabs-v3.md section 3): { offset_ms, bpm, confidence,
//              bars: [{ bar, ms }] }
//
// tab_lookups: one row per song and site that Ember has searched online, so
// a song is searched once and never again on its own (the "Search online
// again" menu item re-runs it). status "found" or "none", results = the
// site's best candidates. Admin only (every rule null): the web app reads and
// writes it with the admin client.
//
// Sharing, and the migration of rows from before it: tabs used to be private
// to their uploader. A bool field added to existing rows reads false, so every
// old row stays private (shared = false) and only its uploader sees it. New
// uploads are written with shared = true by the upload route. Nothing old is
// exposed without the uploader doing it.
//
// song_key, kind and format of old rows are filled in by the web app on first
// use (lib/tabStore.ts backfillTabRows), so the normalization lives in one
// place (lib/songKey.ts) rather than a JS copy here.
//
// Rows are written only by the web app (admin client), so a record can never
// disagree with what is on disk: createRule and updateRule stay null.

onAfterBootstrap((e) => {
  // Everything lives inside the handler: PocketBase runs each handler in an
  // isolated context, so top-level constants and functions are not visible.
  const LIST_RULE = '@request.auth.id != "" && (shared = true || user = @request.auth.id)';
  const DELETE_RULE = '@request.auth.id != "" && (user = @request.auth.id || @request.auth.is_admin = true)';

  function createBase(dao) {
    let users, tracks;
    try {
      users = dao.findCollectionByNameOrId("users");
      tracks = dao.findCollectionByNameOrId("tracks");
    } catch (err) {
      console.log("[ensure_tabs] users/tracks missing, skipping:", err);
      return null;
    }

    const tabs = new Collection({
      name: "tabs",
      type: "base",
      listRule: LIST_RULE,
      viewRule: LIST_RULE,
      createRule: null,
      updateRule: null,
      deleteRule: DELETE_RULE,
      indexes: ["CREATE INDEX idx_tabs_user ON tabs (user)"],
      schema: [
        {
          name: "user",
          type: "relation",
          required: false,
          options: { collectionId: users.id, maxSelect: 1, cascadeDelete: true },
        },
        {
          name: "track",
          type: "relation",
          required: false,
          options: { collectionId: tracks.id, maxSelect: 1, cascadeDelete: false },
        },
        { name: "title", type: "text", required: true, options: { max: 200 } },
        { name: "artist", type: "text", options: { max: 200 } },
        { name: "instrument", type: "text", options: { max: 60 } },
        { name: "file", type: "text", required: true, options: { max: 120 } },
        { name: "size_bytes", type: "number", options: { noDecimal: true } },
      ],
    });
    dao.saveCollection(tabs);
    console.log("[ensure_tabs] created tabs");
    return dao.findCollectionByNameOrId("tabs");
  }

  const NEW_FIELDS = [
    { name: "song_key", type: "text", options: { max: 500 } },
    { name: "track_key", type: "text", options: { max: 80 } },
    { name: "kind", type: "select", options: { maxSelect: 1, values: ["file", "pasted", "fetched", "generated"] } },
    { name: "format", type: "text", options: { max: 12 } },
    { name: "shared", type: "bool", options: {} },
    { name: "offset_ms", type: "number", options: { noDecimal: true } },
    { name: "hints", type: "json", options: { maxSize: 20000 } },
    { name: "source_site", type: "text", options: { max: 20 } },
    { name: "source_url", type: "text", options: { max: 500 } },
    { name: "source_id", type: "text", options: { max: 40 } },
    { name: "source_rating", type: "number", options: {} },
    { name: "source_votes", type: "number", options: { noDecimal: true } },
    { name: "source_meta", type: "json", options: { maxSize: 20000 } },
    { name: "timing", type: "json", options: { maxSize: 50000 } },
  ];

  const NEW_INDEXES = [
    "CREATE INDEX idx_tabs_song_key ON tabs (song_key)",
    "CREATE INDEX idx_tabs_track_key ON tabs (track_key)",
  ];

  const dao = $app.dao();

  let tabs;
  try {
    tabs = dao.findCollectionByNameOrId("tabs");
  } catch (_) {
    tabs = createBase(dao);
    if (!tabs) return;
  }

  let changed = false;

  for (const f of NEW_FIELDS) {
    if (tabs.schema.getFieldByName(f.name)) continue;
    tabs.schema.addField(new SchemaField({ name: f.name, type: f.type, required: false, options: f.options }));
    changed = true;
  }

  // Pasted text tabs (docs/tab-sources.md) and fetched ones (docs/tabs-v3.md)
  // arrived after the select did: add the values to an older collection.
  const kind = tabs.schema.getFieldByName("kind");
  if (kind) {
    const values = (kind.options && kind.options.values) || [];
    if (values.indexOf("pasted") < 0 || values.indexOf("fetched") < 0) {
      kind.options.values = ["file", "pasted", "fetched", "generated"];
      changed = true;
    }
  }

  // Generated tabs belong to no uploader (a lazily recorded one has nobody
  // to name), so the relation is optional now.
  const user = tabs.schema.getFieldByName("user");
  if (user && user.required) {
    user.required = false;
    changed = true;
  }

  // Rules come back from Go as string pointers (objects), so compare their
  // JSON form rather than the values themselves.
  const rule = (r) => (r === null || r === undefined ? null : JSON.parse(JSON.stringify(r)));
  if (rule(tabs.listRule) !== LIST_RULE || rule(tabs.viewRule) !== LIST_RULE || rule(tabs.deleteRule) !== DELETE_RULE) {
    tabs.listRule = LIST_RULE;
    tabs.viewRule = LIST_RULE;
    tabs.deleteRule = DELETE_RULE;
    changed = true;
  }

  const indexes = tabs.indexes || [];
  for (const idx of NEW_INDEXES) {
    if (indexes.indexOf(idx) >= 0) continue;
    indexes.push(idx);
    changed = true;
  }
  tabs.indexes = indexes;

  if (changed) {
    dao.saveCollection(tabs);
    console.log("[ensure_tabs] tabs store up to date (song_key, kind, shared, hints, pasted, fetched, timing)");
  }

  let lookups = null;
  try {
    lookups = dao.findCollectionByNameOrId("tab_lookups");
  } catch (_) {
    lookups = null;
  }
  if (!lookups) {
    dao.saveCollection(new Collection({
      name: "tab_lookups",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      indexes: ["CREATE UNIQUE INDEX idx_tab_lookups_song_site ON tab_lookups (song_key, site)"],
      schema: [
        { name: "song_key", type: "text", required: true, options: { max: 500 } },
        { name: "site", type: "text", required: true, options: { max: 20 } },
        { name: "status", type: "select", required: true, options: { maxSelect: 1, values: ["found", "none"] } },
        { name: "query", type: "text", options: { max: 300 } },
        { name: "searched_at", type: "text", options: { max: 40 } },
        { name: "results", type: "json", options: { maxSize: 50000 } },
      ],
    }));
    console.log("[ensure_tabs] created tab_lookups");
  }
});
