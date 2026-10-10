package app.ember.music

import android.app.Activity
import android.view.ViewGroup
import android.webkit.WebView
import org.json.JSONObject

/** The page's renderer process died (WebViewClient.onRenderProcessGone).
 *
 *  Capacitor hands the question to its listeners and, with none answering,
 *  tells Android it was not handled, and Android then kills the whole app:
 *  the music with it, since the player service lives in the same process. A
 *  phone short on memory kills a background renderer on its own (the screen
 *  off for a while is exactly that), so this was a crash waiting for the
 *  listener to come back.
 *
 *  Handled instead: the dead WebView leaves the screen (a dead one draws
 *  nothing, which is a black screen) and the activity is created again, with
 *  a new WebView that loads the app and catches up with native (the music
 *  never stopped). A renderer that dies again straight after that is not
 *  reloaded in a loop: the activity closes, the music plays on, and the
 *  next open starts clean. */
object RendererGone {
    /** A second death this soon after a reload is a loop, not bad luck. */
    const val LOOP_WINDOW_MS = 30_000L

    enum class Action { RELOAD, CLOSE }

    private var lastReloadAt = Long.MIN_VALUE / 2

    /** What to do about a death at [now]; remembers a reload. */
    @Synchronized
    fun decide(now: Long): Action =
        if (now - lastReloadAt < LOOP_WINDOW_MS) Action.CLOSE
        else {
            lastReloadAt = now
            Action.RELOAD
        }

    internal fun reset() {
        lastReloadAt = Long.MIN_VALUE / 2
    }

    /** Always true: the death is handled, the app process lives on. */
    fun handle(activity: Activity, view: WebView?, crashed: Boolean, now: Long = System.currentTimeMillis()): Boolean {
        val action = decide(now)
        NativeLog.warn(
            "webview",
            if (crashed) "page renderer crashed" else "page renderer killed",
            JSONObject().put("action", action.name.lowercase()),
        )
        // Off the screen first: nothing may touch a WebView whose renderer is
        // gone. Capacitor destroys it with the activity (onDetachedFromWindow).
        runCatching { (view?.parent as? ViewGroup)?.removeView(view) }
        if (!activity.isFinishing) {
            when (action) {
                Action.RELOAD -> activity.recreate()
                Action.CLOSE -> activity.finish()
            }
        }
        return true
    }
}
