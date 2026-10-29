package app.ember.music

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** "Open Ember when this device starts" (BootStart): the device booted, so
 *  Ember picks up the last queue and opens.
 *
 *  Android 10+ does not let a receiver open an activity from the
 *  background, so the music does not depend on the screen: the player
 *  service is started in the foreground (a boot broadcast is one of the
 *  moments Android allows that, up to Android 14) and resumes the saved
 *  queue itself, paused or playing ("and keep playing"). Opening the app is
 *  still tried: older Android, and head units that relax the rule, show it.
 *  Where neither the player nor the app may start (Android 15+, or nothing
 *  saved yet), a notification offers to open Ember. A head unit's own
 *  "auto-start apps" setting, where it has one, opens the app for sure.
 *
 *  Enabled only while the setting is on (BootStart.save), and it checks the
 *  setting again, so a stale component state never starts anything. */
class BootReceiver : BroadcastReceiver() {
    companion object {
        const val CHANNEL = "ember.bootStart"
        const val NOTIFICATION_ID = 7301
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (!BootStart.isStartAction(intent.action)) return
        val prefs = BootStart.prefs(context)
        val settings = BootStart.load(prefs)
        if (!settings.enabled) return
        val elapsed = SystemClock.elapsedRealtime()
        if (!BootStart.claimStart(prefs, System.currentTimeMillis() - elapsed, elapsed)) return

        val saved = SavedQueue(EmberMediaButtonReceiver.savedQueueFile(context)).load() != null
        val player = saved && BootStart.canStartPlayerAtBoot(Build.VERSION.SDK_INT) && startPlayer(context, settings.keepPlaying)
        val opened = openApp(context)
        // From Android 10 a background start is dropped without a word, so
        // "opened" means asked. With the player up, its own notification
        // opens the app; without it, offer that.
        val notice = !player && Build.VERSION.SDK_INT >= 29 && runCatching { postNotice(context) }.getOrDefault(false)
        Log.i(EmberPlaybackService.TAG, "boot start (${intent.action}): saved queue=$saved, player=$player, keepPlaying=${settings.keepPlaying}, app asked=$opened, notice=$notice")
    }

    private fun startPlayer(context: Context, play: Boolean): Boolean = runCatching {
        val start = Intent(context, EmberPlaybackService::class.java)
            .setAction(EmberPlaybackService.ACTION_BOOT_RESUME)
            .putExtra(EmberPlaybackService.EXTRA_PLAY, play)
        ContextCompat.startForegroundService(context, start)
        true
    }.onFailure { Log.w(EmberPlaybackService.TAG, "boot start: player refused: ${it.message}") }.getOrDefault(false)

    private fun openApp(context: Context): Boolean = runCatching {
        val open = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return false
        context.startActivity(open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    }.onFailure { Log.w(EmberPlaybackService.TAG, "boot start: could not open the app: ${it.message}") }.getOrDefault(false)

    private fun postNotice(context: Context): Boolean {
        val nm = NotificationManagerCompat.from(context)
        if (!nm.areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT >= 26) {
            val sys = context.getSystemService(NotificationManager::class.java)
            if (sys.getNotificationChannel(CHANNEL) == null) {
                sys.createNotificationChannel(NotificationChannel(CHANNEL, "Open at start", NotificationManager.IMPORTANCE_DEFAULT))
            }
        }
        val open = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return false
        val tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Ember")
            .setContentText("Tap to open Ember.")
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build()
        @Suppress("MissingPermission")
        nm.notify(NOTIFICATION_ID, n)
        return true
    }
}
