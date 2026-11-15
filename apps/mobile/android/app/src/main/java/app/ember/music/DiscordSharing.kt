package app.ember.music

import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import java.lang.ref.WeakReference
import java.util.concurrent.CopyOnWriteArrayList

/** The Discord switch, kept on the phone: the player service publishes the
 *  card with no page open (a car, a cold start from a media key, a page Android
 *  froze), and it must know whether sharing is allowed without asking one. The
 *  page sets it through EmberDiscord (apps/web/lib/androidDiscord.ts). Off
 *  until the page has said otherwise, the same way the page's own store errs
 *  toward silence.
 *
 *  Also where the service hears that the app's activity has appeared, which
 *  the SDK needs (DiscordRules.status). */
object DiscordSharing {
    const val NAME = "ember.discord"
    const val SHARE_KEY = "share"

    private val listeners = CopyOnWriteArrayList<() -> Unit>()
    @Volatile private var activity: WeakReference<Activity>? = null

    fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun load(prefs: SharedPreferences): Boolean = prefs.getBoolean(SHARE_KEY, false)

    fun save(context: Context, enabled: Boolean) {
        val p = prefs(context)
        // The page repeats itself on every load: no change, nothing to do.
        if (p.contains(SHARE_KEY) && load(p) == enabled) {
            DiscordDiagnostics.add("setSharing($enabled): unchanged, already stored")
            return
        }
        DiscordDiagnostics.add("setSharing($enabled): saved (was ${if (p.contains(SHARE_KEY)) load(p).toString() else "never set"})")
        p.edit().putBoolean(SHARE_KEY, enabled).commit()
        notifyListeners()
    }

    /** The current activity, while it lasts. */
    fun activity(): Activity? = activity?.get()

    /** Called from EmberActivity.onCreate. Never throws: a Discord card is not
     *  worth an app that does not open. */
    @JvmStatic
    fun activityCreated(created: Activity) {
        activity = WeakReference(created)
        DiscordDiagnostics.init(created)
        DiscordDiagnostics.add("activity created: ${created.javaClass.simpleName}")
        runCatching { DiscordEngines.activityCreated(created) }
        notifyListeners()
    }

    /** Called on whichever thread changed something. */
    fun addListener(listener: () -> Unit) { listeners.add(listener) }

    fun removeListener(listener: () -> Unit) { listeners.remove(listener) }

    private fun notifyListeners() = listeners.forEach { it() }

    /** Tests only: this is process-wide state. */
    internal fun reset() {
        listeners.clear()
        activity = null
    }
}
