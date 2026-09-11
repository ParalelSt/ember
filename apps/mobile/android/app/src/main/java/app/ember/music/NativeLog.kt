package app.ember.music

import org.json.JSONObject

/** Native failures on their way into the web logger (and so into a bug report).
 *
 *  Nothing that goes wrong in Kotlin is visible to the user's report unless the
 *  WebView hears about it: `Log.w` lands in logcat, which nobody has. So every
 *  download failure, index write failure, plugin rejection and service crash is
 *  emitted here, and `EmberOfflinePlugin` forwards it as a `nativeLog`
 *  Capacitor event.
 *
 *  Delivery is not always possible: the service can run with no plugin loaded,
 *  and Capacitor drops an event when the WebView has no listener yet - which is
 *  exactly the window the earliest (most interesting) failures land in. Events
 *  therefore sit in a small ring until a sink accepts them, oldest first so the
 *  web side sees them in the order they happened. */
object NativeLog {
    /** Nothing drains the ring while the WebView is away, so it has to be
     *  bounded; the newest 100 events are the ones with diagnostic value. */
    const val MAX_BUFFERED = 100

    private val pending = java.util.ArrayDeque<JSONObject>()

    /** Returns false when the event could NOT be delivered (no WebView
     *  listener), in which case it stays buffered for the next attempt. */
    private var sink: ((JSONObject) -> Boolean)? = null

    fun error(category: String, message: String, data: JSONObject? = null) = emit("error", category, message, data)

    fun warn(category: String, message: String, data: JSONObject? = null) = emit("warn", category, message, data)

    fun info(category: String, message: String, data: JSONObject? = null) = emit("info", category, message, data)

    /** `category` is one of 'offline', 'player', 'service'; the web side maps it
     *  to a `native:<category>` log category. */
    @Synchronized
    fun emit(level: String, category: String, message: String, data: JSONObject? = null) {
        val event = JSONObject()
            .put("level", level)
            .put("category", category)
            .put("message", message)
            .put("ts", System.currentTimeMillis())
        if (data != null) event.put("data", data)
        // Buffer first, then drain, so a live sink and a cold start deliver in
        // the same order rather than jumping the queue.
        pending.addLast(event)
        while (pending.size > MAX_BUFFERED) pending.removeFirst()
        drain()
    }

    /** Point delivery at the plugin and hand over everything buffered so far.
     *  Called again whenever the WebView subscribes, since only then can
     *  Capacitor actually deliver. */
    @Synchronized
    fun attach(sink: (JSONObject) -> Boolean) {
        this.sink = sink
        drain()
    }

    /** Only if it is still OUR sink: a newer plugin instance may have taken
     *  over before this one was destroyed. */
    @Synchronized
    fun detach(sink: (JSONObject) -> Boolean) {
        if (this.sink === sink) this.sink = null
    }

    /** Oldest first, stopping at the first event the sink refuses, so a
     *  half-open WebView never reorders or loses the rest. */
    private fun drain() {
        val s = sink ?: return
        while (true) {
            val next = pending.peekFirst() ?: return
            if (!s(next)) return
            pending.removeFirst()
        }
    }

    /** Tests only: this is process-wide state, so each case starts clean. */
    internal fun reset() {
        synchronized(this) {
            pending.clear()
            sink = null
        }
    }
}
