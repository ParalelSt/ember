package app.ember.music

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import java.io.File

/** Hands a verified APK to Android's PackageInstaller in one session.
 *
 *  On Android 12+ the session asks for no user action
 *  (USER_ACTION_NOT_REQUIRED): once Ember is the installer of record (after
 *  the first update made from inside it) Android installs silently. Before
 *  Android 12, the first time, or whenever Android decides otherwise, the
 *  answer is STATUS_PENDING_USER_ACTION with the system's confirm screen,
 *  which AppUpdater opens while the app is on screen. */
object UpdateInstaller {
    const val ACTION_STATUS = "app.ember.music.UPDATE_STATUS"

    /** Stages [apk] and commits it, unless [stillOk] says no at the last
     *  moment (the session is then abandoned and false returned). Sessions
     *  an earlier attempt left open (a confirm never answered) are dropped
     *  first, so no staged copies pile up. */
    fun commit(context: Context, apk: File, silent: Boolean, stillOk: () -> Boolean = { true }): Boolean {
        val installer = context.packageManager.packageInstaller
        runCatching { installer.mySessions.forEach { old -> runCatching { installer.abandonSession(old.sessionId) } } }
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
            if (Build.VERSION.SDK_INT >= 26) setInstallReason(android.content.pm.PackageManager.INSTALL_REASON_USER)
            if (silent && Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = installer.createSession(params)
        try {
            installer.openSession(id).use { session ->
                session.openWrite("ember.apk", 0, apk.length()).use { out ->
                    apk.inputStream().use { it.copyTo(out, 64 * 1024) }
                    session.fsync(out)
                }
                val intent = Intent(context, UpdateInstallReceiver::class.java).setAction(ACTION_STATUS)
                // Mutable: the system writes the status and the confirm
                // intent into it. Explicit, so nothing else can receive it.
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                val pending = PendingIntent.getBroadcast(context, id, intent, flags)
                if (!stillOk()) {
                    session.abandon()
                    return false
                }
                session.commit(pending.intentSender)
            }
            return true
        } catch (e: Exception) {
            runCatching { installer.abandonSession(id) }
            throw e
        }
    }
}

/** The session's answer. Not exported: only the system, through the
 *  PendingIntent above, sends it. */
class UpdateInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != UpdateInstaller.ACTION_STATUS) return
        AppUpdater.init(context)
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty()
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                    else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
                AppUpdater.onNeedsConfirm(confirm)
            }
            PackageInstaller.STATUS_SUCCESS -> AppUpdater.onInstalled()
            PackageInstaller.STATUS_FAILURE_ABORTED -> AppUpdater.onInstallFailed("install aborted: $message", keep = true, aborted = true)
            // A different key or a broken file: the same APK can never go in.
            PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE, PackageInstaller.STATUS_FAILURE_INVALID ->
                AppUpdater.onInstallFailed("install refused ($status): $message", keep = false)
            else -> AppUpdater.onInstallFailed("install failed ($status): $message", keep = true)
        }
    }
}
