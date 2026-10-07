package app.ember.music

import android.util.Log
import android.webkit.CookieManager
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/**
 * Writes the WebView's cookies to disk now instead of whenever Chromium gets
 * round to it (about 30 s after a change). The session is the `pb_auth`
 * cookie, and the player service reads it too (ServerApi): a process killed
 * soon after signing in (an ANR in the car, a swipe from recents, Android
 * reclaiming memory) used to come back signed out, phone and car alike.
 *
 * Flushed when the page reports a session change (EmberAppPlugin
 * .flushCookies), on every page load, and when the activity pauses or stops.
 */
object CookieFlush {
    /** Swapped by tests; CookieManager needs a WebView provider. */
    internal var flusher: () -> Unit = { CookieManager.getInstance().flush() }

    /** False when the cookie store could not be reached; never throws. */
    fun now(): Boolean = try {
        flusher()
        true
    } catch (e: Exception) {
        Log.w("EmberCookies", "cookie flush failed: ${e.message}")
        false
    }

    fun install(owner: LifecycleOwner) {
        owner.lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onPause(owner: LifecycleOwner) { now() }
            override fun onStop(owner: LifecycleOwner) { now() }
        })
    }

    internal fun resetForTests() {
        flusher = { CookieManager.getInstance().flush() }
    }
}
