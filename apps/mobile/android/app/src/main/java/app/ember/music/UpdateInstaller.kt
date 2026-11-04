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
     *  moment (the session is then abandoned and false returned).
     *  [committing] hears the session id right before the commit, so an
     *  answer can be matched to it. Sessions an earlier attempt left behind
     *  are dropped first, so no staged copies pile up, except those [keep]
     *  names (one still in progress: abandoning it ends that install). */
    fun commit(
        context: Context,
        apk: File,
        silent: Boolean,
        stillOk: () -> Boolean = { true },
        committing: (Int) -> Unit = {},
        keep: (Int) -> Boolean = { false },
    ): Boolean {
        val installer = context.packageManager.packageInstaller
        abandonLeftovers(context, keep)
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
                committing(id)
                session.commit(pending.intentSender)
            }
            return true
        } catch (e: Exception) {
            runCatching { installer.abandonSession(id) }
            throw e
        }
    }
}

/** Abandons each of the app's own sessions [keep] does not name; their ids. */
internal fun abandonLeftovers(context: Context, keep: (Int) -> Boolean): List<Int> {
    val installer = context.packageManager.packageInstaller
    val mine = runCatching { installer.mySessions.map { it.sessionId } }.getOrDefault(emptyList())
    return mine.filter { id -> !keep(id) && runCatching { installer.abandonSession(id) }.isSuccess }
}

/** The session's answer. Not exported: only the system, through the
 *  PendingIntent above, sends it. */
class UpdateInstallReceiver : BroadcastReceiver() {
    companion object {
        /** The internal INSTALL_FAILED_* code Android puts next to the
         *  public status (PackageInstaller.EXTRA_LEGACY_STATUS, hidden). */
        const val EXTRA_LEGACY_STATUS = "android.content.pm.extra.LEGACY_STATUS"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != UpdateInstaller.ACTION_STATUS) return
        AppUpdater.init(context)
        // Android always says how it went; a broadcast without a status is
        // not an answer (Robolectric's session sends one on commit).
        if (!intent.hasExtra(PackageInstaller.EXTRA_STATUS)) {
            AppUpdater.onEmptyAnswer(intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1))
            return
        }
        val answer = UpdateRules.Answer(
            status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE),
            message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty(),
            sessionId = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1),
            legacy = intent.getIntExtra(EXTRA_LEGACY_STATUS, 0).takeIf { it != 0 },
        )
        val confirm = if (answer.status != PackageInstaller.STATUS_PENDING_USER_ACTION) null
            else if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
            else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
        AppUpdater.onAnswer(answer, confirm)
    }
}
