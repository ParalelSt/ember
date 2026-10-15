package app.ember.music

import android.content.SharedPreferences

/** The auto cache's one setting on the phone (`enabled`, on by default),
 *  kept so the car and a closed app follow it too. The web app's Settings
 *  hands it down (EmberPlaybackService.COMMAND_AUTO_CACHE).
 *
 *  There is no mobile data setting (the owner, 2026-10: caching is what
 *  keeps the music going on a weak signal): the cache works on mobile data
 *  always. Earlier builds kept one, "onMetered", off by default; it is
 *  ignored, and cleared from the phone on the first load. */
object AutoCachePrefs {
    const val NAME = "ember.autoCache"
    const val ENABLED_KEY = "enabled"
    /** Keys earlier builds kept, cleared on load. */
    val OLD_KEYS = listOf("onMetered", "onMeteredDefaultOn")

    fun load(prefs: SharedPreferences): Boolean {
        if (OLD_KEYS.any(prefs::contains)) {
            prefs.edit().apply { OLD_KEYS.forEach { remove(it) } }.apply()
        }
        return prefs.getBoolean(ENABLED_KEY, true)
    }

    fun save(prefs: SharedPreferences, enabled: Boolean) {
        prefs.edit().putBoolean(ENABLED_KEY, enabled).apply()
    }
}
