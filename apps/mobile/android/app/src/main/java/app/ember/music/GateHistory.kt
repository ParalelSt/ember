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

/** Between launches, in SharedPreferences: the version that ran last (so
 *  the first start after an update can say so, "update.gate.done"), and when
 *  an install the person asked for began, for the "Ember updated"
 *  notification. The launch gate that once kept launch stages here is gone
 *  (LaunchGateActivity). */
object GateHistory {
    private const val PREFS = "ember.launch"
    private const val KEY_LAST_VERSION = "lastVersion"
    private const val KEY_INSTALL_AT = "gateInstallAt"

    private fun prefs(c: Context) = c.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** The version an update replaced since the last start, or null; this
     *  start's version is kept for the next one. */
    fun updatedFrom(c: Context): String? {
        val now = AppVersion.name(c) ?: return null
        val p = prefs(c)
        val last = p.getString(KEY_LAST_VERSION, null)
        if (last != now) p.edit().putString(KEY_LAST_VERSION, now).commit()
        return wasUpdated(last, now)
    }

    /** [last] when [now] is newer than it. */
    fun wasUpdated(last: String?, now: String?): String? =
        last?.takeIf { now != null && UpdateRules.isNewer(now, it) }

    fun installStarted(c: Context, now: Long = System.currentTimeMillis()) {
        prefs(c).edit().putLong(KEY_INSTALL_AT, now).commit()
    }

    /** When an install the person asked for last began, and forget it. */
    fun takeInstallAt(c: Context): Long {
        val p = prefs(c)
        val at = p.getLong(KEY_INSTALL_AT, 0L)
        p.edit().remove(KEY_INSTALL_AT).apply()
        return at
    }

    /** Whether an update that just went in was asked for recently enough
     *  that the person is waiting for Ember to come back. */
    fun relaunchNoticeDue(now: Long, installAt: Long): Boolean =
        installAt > 0 && now >= installAt && now - installAt <= 10 * 60 * 1000L
}

/** Android does not reopen an app that updated itself. After an update the
 *  person started (a tap on Update in the page), the new version
 *  opens itself again where Android allows it (before Android 10); from 10
 *  on an app may not open a window from the background, so it posts "Ember
 *  updated, tap to open" (S3), for which the install asked for the
 *  notification permission first. Not exported: MY_PACKAGE_REPLACED comes
 *  from the system only. */
class UpdatedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val at = GateHistory.takeInstallAt(context)
        if (!GateHistory.relaunchNoticeDue(System.currentTimeMillis(), at)) return
        AppUpdater.init(context)
        val reopened = UpdateRules.relaunchDirectly(Build.VERSION.SDK_INT) && runCatching { reopen(context) }.getOrDefault(false)
        val posted = !reopened && runCatching { post(context) }.getOrDefault(false)
        val said = when {
            reopened -> "reopened"
            posted -> "relaunch notice posted"
            else -> "relaunch notice not allowed"
        }
        AppUpdater.gateEvent("update.gate.relaunch", "update in, $said",
            JSONObject().put("reopened", reopened).put("posted", posted).put("version", AppVersion.name(context)))
    }

    private fun reopen(context: Context): Boolean {
        val open = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return false
        context.startActivity(open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
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
