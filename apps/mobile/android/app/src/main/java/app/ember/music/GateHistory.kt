package app.ember.music

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/** The launch gate's memory between launches (GateRules.History), in
 *  SharedPreferences: how far the last launches got, so two that died after
 *  the gate make a recovery launch and two that died in it skip it once. The
 *  gate writes STARTING and GATED; EmberActivity writes READY on its first
 *  page load. Also when the gate last handed an APK to Android, for the
 *  "Ember updated" notification. */
object GateHistory {
    private const val PREFS = "ember.launch"
    private const val KEY_STAGE = "stage"
    private const val KEY_IN_GATE = "failedInGate"
    private const val KEY_AFTER_GATE = "failedAfterGate"
    private const val KEY_LAST_VERSION = "lastVersion"
    private const val KEY_INSTALL_AT = "gateInstallAt"

    private fun prefs(c: Context) = c.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun load(c: Context): GateRules.History {
        val p = prefs(c)
        val stage = runCatching { GateRules.Stage.valueOf(p.getString(KEY_STAGE, null) ?: "CLEAN") }.getOrDefault(GateRules.Stage.CLEAN)
        return GateRules.History(stage, p.getInt(KEY_IN_GATE, 0), p.getInt(KEY_AFTER_GATE, 0), p.getString(KEY_LAST_VERSION, null))
    }

    fun store(c: Context, h: GateRules.History) {
        // commit, not apply: the point is to survive the process dying.
        prefs(c).edit()
            .putString(KEY_STAGE, h.stage.name)
            .putInt(KEY_IN_GATE, h.failedInGate)
            .putInt(KEY_AFTER_GATE, h.failedAfterGate)
            .putString(KEY_LAST_VERSION, h.lastVersion)
            .commit()
    }

    /** A gated launch begins. */
    fun start(c: Context): GateRules.Launch {
        val launch = GateRules.onLaunch(load(c), AppVersion.name(c))
        store(c, launch.history)
        return launch
    }

    @JvmStatic
    fun mark(c: Context, stage: GateRules.Stage) {
        runCatching { store(c, GateRules.reached(load(c), stage)) }
    }

    fun installStarted(c: Context, now: Long = System.currentTimeMillis()) {
        prefs(c).edit().putLong(KEY_INSTALL_AT, now).commit()
    }

    /** When the gate last started an install, and forget it. */
    fun takeInstallAt(c: Context): Long {
        val p = prefs(c)
        val at = p.getLong(KEY_INSTALL_AT, 0L)
        p.edit().remove(KEY_INSTALL_AT).apply()
        return at
    }

    /** Whether an update that just went in came from the gate, recently
     *  enough that the person is waiting for Ember to come back. */
    fun relaunchNoticeDue(now: Long, installAt: Long): Boolean =
        installAt > 0 && now >= installAt && now - installAt <= 10 * 60 * 1000L
}

/** Android does not reopen an app that updated itself, and an app may not
 *  open its own window from the background. So after an update started from
 *  the launch gate, the new version posts "Ember updated, tap to open" (S3).
 *  Not exported: MY_PACKAGE_REPLACED comes from the system only. */
class UpdatedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val at = GateHistory.takeInstallAt(context)
        if (!GateHistory.relaunchNoticeDue(System.currentTimeMillis(), at)) return
        AppUpdater.init(context)
        val posted = runCatching { post(context) }.getOrDefault(false)
        AppUpdater.gateEvent("update.gate.relaunch", "update in, relaunch notice ${if (posted) "posted" else "not allowed"}",
            JSONObject().put("posted", posted).put("version", AppVersion.name(context)))
    }

    private fun post(context: Context): Boolean {
        val nm = NotificationManagerCompat.from(context)
        if (!nm.areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT >= 26) {
            val sys = context.getSystemService(NotificationManager::class.java)
            if (sys.getNotificationChannel(CHANNEL) == null) {
                sys.createNotificationChannel(NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT))
            }
        }
        val open = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return false
        val tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("Ember updated")
            .setContentText("Tap to open Ember.")
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build()
        @Suppress("MissingPermission")
        nm.notify(NOTIFICATION_ID, n)
        return true
    }

    companion object {
        const val CHANNEL = "ember.updates"
        const val NOTIFICATION_ID = 4711
    }
}
