package app.ember.music

import android.content.ComponentName
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager

/** "Open Ember when this device starts" (Settings > Devices, Android only,
 *  off by default), for a car head unit that runs Ember itself: after the
 *  device boots, Ember opens and picks up the last queue, paused, or playing
 *  with "and keep playing" (also off by default).
 *
 *  Kept here so BootReceiver can read it with the app closed; the page sets
 *  it through EmberApp.setBootStart. The receiver is only enabled while the
 *  setting is on, so a phone that never turned it on never even wakes Ember
 *  at boot. */
object BootStart {
    const val NAME = "ember.bootStart"
    const val ENABLED_KEY = "enabled"
    const val KEEP_PLAYING_KEY = "keepPlaying"
    /** When the last boot start was handled: the boot it was in (wall clock
     *  of the boot) and how long after that boot. */
    const val HANDLED_BOOT_KEY = "handledBootAt"
    const val HANDLED_ELAPSED_KEY = "handledElapsed"

    /** What the receiver listens for. The receiver is not direct boot
     *  aware (it reads this app's storage), so LOCKED_BOOT_COMPLETED only
     *  reaches it where storage is open by then (no file encryption, common
     *  on head units), just before BOOT_COMPLETED; QUICKBOOT_POWERON is what
     *  some head units (and older HTC builds) send instead of a full boot. */
    val ACTIONS = setOf(
        "android.intent.action.BOOT_COMPLETED",
        "android.intent.action.LOCKED_BOOT_COMPLETED",
        "android.intent.action.QUICKBOOT_POWERON",
        "com.htc.intent.action.QUICKBOOT_POWERON",
    )

    /** Two of the actions above for one start (a locked boot, then the boot)
     *  count once when they arrive within this long of each other. */
    const val SAME_START_MS = 2 * 60_000L
    /** Two boot times this close are the same boot (the wall clock moves a
     *  little when the network sets it). */
    private const val SAME_BOOT_SLACK_MS = 10_000L

    data class Settings(val enabled: Boolean, val keepPlaying: Boolean)

    fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun load(prefs: SharedPreferences) = Settings(
        enabled = prefs.getBoolean(ENABLED_KEY, false),
        keepPlaying = prefs.getBoolean(KEEP_PLAYING_KEY, false),
    )

    /** Saves the setting and turns the boot receiver on or off with it. */
    fun save(context: Context, settings: Settings) {
        prefs(context).edit()
            .putBoolean(ENABLED_KEY, settings.enabled)
            .putBoolean(KEEP_PLAYING_KEY, settings.keepPlaying)
            .commit()
        context.packageManager.setComponentEnabledSetting(
            ComponentName(context, BootReceiver::class.java),
            if (settings.enabled) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP,
        )
    }

    fun isStartAction(action: String?): Boolean = action != null && action in ACTIONS

    /** Whether a boot action at [elapsedMs] since a boot at [bootAtMs] is a
     *  new start, given the last one handled (null: never). */
    fun isNewStart(bootAtMs: Long, elapsedMs: Long, handledBootAt: Long?, handledElapsed: Long?): Boolean {
        if (handledBootAt == null || handledElapsed == null) return true
        val sameBoot = kotlin.math.abs(bootAtMs - handledBootAt) <= SAME_BOOT_SLACK_MS
        return !(sameBoot && elapsedMs >= handledElapsed && elapsedMs - handledElapsed < SAME_START_MS)
    }

    /** Takes the start at [bootAtMs]/[elapsedMs] when it is a new one
     *  (isNewStart) and remembers it; false when it was already handled. */
    fun claimStart(prefs: SharedPreferences, bootAtMs: Long, elapsedMs: Long): Boolean {
        val bootAt = if (prefs.contains(HANDLED_BOOT_KEY)) prefs.getLong(HANDLED_BOOT_KEY, 0) else null
        val elapsed = if (prefs.contains(HANDLED_ELAPSED_KEY)) prefs.getLong(HANDLED_ELAPSED_KEY, 0) else null
        if (!isNewStart(bootAtMs, elapsedMs, bootAt, elapsed)) return false
        prefs.edit().putLong(HANDLED_BOOT_KEY, bootAtMs).putLong(HANDLED_ELAPSED_KEY, elapsedMs).commit()
        return true
    }

    /** Android 15 refuses a media playback foreground service started from
     *  a boot broadcast (apps targeting 35). There the receiver only opens
     *  the app, and offers a notification to do it if that is not allowed. */
    fun canStartPlayerAtBoot(sdk: Int): Boolean = sdk < 35
}
