/// <reference path="../pb_data/types.d.ts" />

// Nightly database backups, using PocketBase's own backups feature
// (Settings > Backups in the /_/ admin UI). Each backup is a zip of the whole
// pb_data directory (database plus uploaded record files in pb_data/storage)
// written to pb_data/backups. PocketBase deletes the oldest automatic backups
// beyond the "keep" count; manual ones are never deleted automatically.
//
// On boot this hook:
//
//   * EMBER_BACKUP_CRON set: applies it on every boot ("off" turns automatic
//     backups off). EMBER_BACKUP_KEEP (a whole number, 1 or more) likewise.
//     The environment is an explicit choice, so it wins.
//   * env unset, first boot with this hook: turns backups on with the
//     defaults below, unless the host already set a schedule of their own
//     (that one is kept as it is). A marker param then records that the
//     defaults were applied.
//   * env unset, marker present: changes NOTHING, so a host who later edits
//     or turns off the schedule in the admin UI keeps their choice.
//
// A failed save only logs a warning: backups must never stop PocketBase from
// booting. See SETUP.md, "Backups".

onAfterBootstrap((e) => {
  const DEFAULT_CRON = "0 4 * * *"; // 04:00 every night, server time
  const DEFAULT_KEEP = 7;
  const MARKER = "ember_backups_defaults";

  const dao = $app.dao();
  const envCron = ($os.getenv("EMBER_BACKUP_CRON") || "").trim();
  const envKeepRaw = ($os.getenv("EMBER_BACKUP_KEEP") || "").trim();

  let envKeep = 0;
  if (envKeepRaw) {
    if (/^[0-9]+$/.test(envKeepRaw) && parseInt(envKeepRaw, 10) >= 1) {
      envKeep = parseInt(envKeepRaw, 10);
    } else {
      console.warn("[ensure_backups] EMBER_BACKUP_KEEP must be a whole number, 1 or more: ignored (" + envKeepRaw + ")");
    }
  }

  let markerSet = false;
  try {
    dao.findParamByKey(MARKER);
    markerSet = true;
  } catch (err) {
    // Not found: first boot with this hook.
  }

  const current = $app.settings().backups;
  let cron = current.cron;
  let keep = current.cronMaxKeep;

  let applyingDefaults = false;
  if (envCron) {
    cron = envCron.toLowerCase() === "off" ? "" : envCron;
  } else if (!markerSet && !cron) {
    cron = DEFAULT_CRON;
    applyingDefaults = true;
  }
  if (envKeep) {
    keep = envKeep;
  } else if (applyingDefaults || (cron && keep < 1)) {
    // PocketBase's own default is 3; ours is a week. A keep count is also
    // required whenever a schedule is set.
    keep = DEFAULT_KEEP;
  }

  if (cron !== current.cron || keep !== current.cronMaxKeep) {
    const settings = $app.settings().clone();
    settings.backups.cron = cron;
    settings.backups.cronMaxKeep = keep;
    try {
      settings.backups.validate();
      dao.saveSettings(settings);
      // Loads the saved settings into the running app and reschedules the
      // backup job with them.
      $app.refreshSettings();
      console.log(
        "[ensure_backups] automatic backups: " +
          (cron ? "'" + cron + "', keeping the last " + keep : "off")
      );
    } catch (err) {
      console.warn("[ensure_backups] could not save the backup schedule (nothing changed):", err);
      return;
    }
  }

  if (!markerSet) {
    try {
      dao.saveParam(MARKER, { cron: cron, keep: keep, at: new Date().toISOString() });
    } catch (err) {
      console.warn("[ensure_backups] could not save the marker:", err);
    }
  }
});
