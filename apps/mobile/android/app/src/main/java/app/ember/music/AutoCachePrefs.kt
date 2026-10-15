package app.ember.music

import android.content.SharedPreferences

/** The auto cache's two settings on the phone (`enabled`, `onMetered`),
 *  kept so the car and a closed app follow them too. The web app's Settings
 *  hands them down (EmberPlaybackService.COMMAND_AUTO_CACHE).
 *
 *  Both are on by default, mobile data included (the owner, 2026-10:
 *  caching is what keeps the music going on a weak signal). Mobile data used
 *  to be off by default, and the page wrote that default here on its first
 *  start, so a stored "off" cannot be told apart from one somebody chose:
 *  once, on the first start after the change, it is turned on for everyone
 *  ([MIGRATED_KEY] marks it done). A later "off" sticks. */
object AutoCachePrefs {
    const val NAME = "ember.autoCache"
    const val ENABLED_KEY = "enabled"
    const val METERED_KEY = "onMetered"
    /** Set once mobile data has been switched on by the default change. */
    const val MIGRATED_KEY = "onMeteredDefaultOn"

    data class Settings(val enabled: Boolean, val onMetered: Boolean)

    /** The settings, after the one-time switch of mobile data to on. */
    fun load(prefs: SharedPreferences): Settings {
        if (!prefs.getBoolean(MIGRATED_KEY, false)) {
            prefs.edit().putBoolean(METERED_KEY, true).putBoolean(MIGRATED_KEY, true).apply()
        }
        return Settings(prefs.getBoolean(ENABLED_KEY, true), prefs.getBoolean(METERED_KEY, true))
    }

    fun save(prefs: SharedPreferences, settings: Settings) {
        prefs.edit()
            .putBoolean(ENABLED_KEY, settings.enabled)
            .putBoolean(METERED_KEY, settings.onMetered)
            .putBoolean(MIGRATED_KEY, true)
            .apply()
    }
}
