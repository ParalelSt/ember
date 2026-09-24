package app.ember.music

import android.util.Log
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheWriter
import java.util.concurrent.Executor

/** Drives AutoCachePolicy inside the playback service: one prefetch at a
 *  time, in window order, into the player's own SimpleCache. Lives in the
 *  service, not the WebView, so it keeps working with the screen off and in
 *  Android Auto.
 *
 *  Every decision runs on the main thread (`tick`); only the download itself
 *  runs on `executor`, and its answer is posted back with `main`. */
class AutoCacher(
    private val store: Store,
    private val downloads: Downloads,
    private val executor: Executor,
    private val main: (Runnable) -> Unit,
    private val clock: () -> Long = System::currentTimeMillis,
    /** The player and the device right now; null when nothing is queued. */
    private val snapshot: () -> Snapshot?,
    /** A download finished: the cached set changed. */
    private val onCached: (String) -> Unit = {},
) {
    /** What the cache holds. */
    interface Store {
        val cap: Long
        fun fullyCached(): Set<String>
        fun sizes(): Map<String, Long>
    }

    /** One prefetch. `run` blocks until the song is on disk (returns its
     *  bytes) or throws; `cancel` makes a running `run` throw. */
    interface Download {
        fun run(): Long
        fun cancel()
    }

    fun interface Downloads {
        fun create(id: String, url: String): Download
    }

    data class Snapshot(
        /** Play order (shuffle applied). streamUrl is the absolute remote URL. */
        val queue: List<AutoCachePolicy.Track>,
        val index: Int,
        val loopMode: AutoCachePolicy.LoopMode,
        val contextType: String?,
        val baseCount: Int,
        val playedSec: Double,
        val bufferedToEnd: Boolean?,
        val playing: Boolean,
        val net: NetworkWatch.State,
        val batterySaver: Boolean,
        /** A pinned download exists: already offline, never prefetched.
         *  Asked only for the window, so a long queue costs nothing. */
        val isLocal: (String) -> Boolean = { false },
    )

    @Volatile var enabled = true
        private set
    @Volatile var allowMetered = false
        private set

    var inFlight: String? = null
        private set
    private var running: Running? = null
    private var backoffUntil: Map<String, Long> = emptyMap()
    private var attempts: Map<String, Int> = emptyMap()
    /** The last decision, for logs and tests. */
    var lastAction: AutoCachePolicy.Action? = null
        private set

    private class Running(val id: String, val download: Download) {
        @Volatile var canceled = false
    }

    fun setSettings(enabled: Boolean, allowMetered: Boolean) {
        this.enabled = enabled
        this.allowMetered = allowMetered
    }

    private fun input(s: Snapshot): AutoCachePolicy.Input {
        val sizes = store.sizes()
        val base = AutoCachePolicy.Input(
            queue = s.queue,
            index = s.index,
            loopMode = s.loopMode,
            contextType = s.contextType,
            baseCount = s.baseCount,
            playedSec = s.playedSec,
            bufferedToEnd = s.bufferedToEnd,
            playing = s.playing,
            online = s.net.online,
            metered = s.net.metered,
            saveData = s.net.saveData,
            batterySaver = s.batterySaver,
            enabled = enabled,
            allowMetered = allowMetered,
            // SimpleCache writes the current song through as the player reads it.
            requestCurrent = false,
            cached = store.fullyCached(),
            inFlight = inFlight,
            bytes = sizes.values.sum(),
            cap = store.cap,
            sizes = sizes,
            backoffUntil = backoffUntil,
            attempts = attempts,
            nowMs = clock(),
        )
        val local = AutoCachePolicy.desiredIds(base).filter(s.isLocal)
        return if (local.isEmpty()) base else base.copy(cached = base.cached + local)
    }

    /** Decide and act once. Call on the main thread whenever anything the
     *  policy reads may have changed; it is cheap and idempotent. */
    fun tick(): AutoCachePolicy.Action {
        val s = snapshot()
        if (s == null) {
            cancel()
            return AutoCachePolicy.Action.Idle("nothing").also { lastAction = it }
        }
        val action = AutoCachePolicy.nextAction(input(s))
        lastAction = action
        when (action) {
            is AutoCachePolicy.Action.Start -> start(action.id, s)
            is AutoCachePolicy.Action.Abort -> cancel()
            // The policy's first gates never abort by themselves; here the
            // listener said no (setting off, mobile data) or the device did
            // (offline, battery saver), so stop the download too. Cancelling
            // is not an answer from the server and costs no attempt.
            is AutoCachePolicy.Action.Idle -> if (action.reason in STOP_REASONS) cancel()
        }
        return action
    }

    /** Stop the running prefetch, if any. */
    fun cancel() {
        val r = running ?: return
        r.canceled = true
        running = null
        inFlight = null
        runCatching { r.download.cancel() }
    }

    private fun start(id: String, s: Snapshot) {
        val track = s.queue.firstOrNull { it.id == id } ?: return
        val url = prefetchUrl(track.streamUrl ?: return)
        val d = runCatching { downloads.create(id, url) }.getOrElse {
            Log.w(TAG, "prefetch $id: ${it.message}")
            return
        }
        val r = Running(id, d)
        running = r
        inFlight = id
        executor.execute {
            val out = runCatching { d.run() }
            main(Runnable { finish(r, out) })
        }
    }

    private fun finish(r: Running, out: kotlin.Result<Long>) {
        if (r.canceled || running !== r) return
        running = null
        inFlight = null
        val result = out.fold({ AutoCachePolicy.Result.Done(it) }, { classify(it) })
        // onResult reads only the ledger and the clock from its input.
        val ledger = AutoCachePolicy.onResult(LEDGER_ONLY.copy(backoffUntil = backoffUntil, attempts = attempts, nowMs = clock()), r.id, result)
        backoffUntil = ledger.backoffUntil
        attempts = ledger.attempts
        Log.i(TAG, "prefetch ${r.id}: $result${if (ledger.drop) " (dropped for this session)" else ""}")
        if (result is AutoCachePolicy.Result.Done) onCached(r.id)
        tick()
    }

    companion object {
        const val TAG = "EmberAutoCache"
        private val STOP_REASONS = setOf("disabled", "offline", "battery", "metered")

        private val LEDGER_ONLY = AutoCachePolicy.Input(
            queue = emptyList(), index = -1, loopMode = AutoCachePolicy.LoopMode.OFF, contextType = null, baseCount = 0,
            playedSec = 0.0, bufferedToEnd = null, playing = false, online = true, metered = null, saveData = false,
            batterySaver = false, enabled = true, allowMetered = false, requestCurrent = false, cached = emptySet(),
            inFlight = null, bytes = 0, cap = 0, backoffUntil = emptyMap(), attempts = emptyMap(), nowMs = 0,
        )

        /** The server treats `prefetch=1` as low priority (see the plan's
         *  server contract): busy hosts answer 503, eager clients 429. */
        fun prefetchUrl(url: String): String = url + (if ('?' in url) "&" else "?") + "prefetch=1"

        /** A failed download as the policy's result: 410 drops the id, 429 and
         *  503 back off as long as the server asked, anything else is a plain
         *  failure on the 15/30/60 s schedule. */
        fun classify(e: Throwable): AutoCachePolicy.Result {
            var t: Throwable? = e
            while (t != null) {
                if (t is HttpDataSource.InvalidResponseCodeException) {
                    return when (t.responseCode) {
                        410 -> AutoCachePolicy.Result.Gone
                        429, 503 -> AutoCachePolicy.Result.RetryAfter(t.responseCode, retryAfterSec(t.headerFields))
                        else -> AutoCachePolicy.Result.Failed
                    }
                }
                t = t.cause
            }
            return AutoCachePolicy.Result.Failed
        }

        /** Seconds from a Retry-After header, or null (absent, or the
         *  HTTP-date form, which the server never sends). OkHttp lowercases
         *  header names, so match without case. */
        fun retryAfterSec(headers: Map<*, *>?): Double? =
            headers?.entries?.firstOrNull { (it.key as? String).equals("Retry-After", ignoreCase = true) }
                ?.let { (it.value as? List<*>)?.firstOrNull() as? String }?.trim()?.toDoubleOrNull()

        /** The real download: CacheWriter through the player's own cache and
         *  HTTP stack, so the song lands exactly where the player looks. */
        fun cacheWriterDownloads(factory: CacheDataSource.Factory): Downloads = Downloads { id, url ->
            val spec = DataSpec.Builder().setUri(url).setKey(id).build()
            val writer = CacheWriter(factory.createDataSourceForDownloading(), spec, null, null)
            object : Download {
                override fun run(): Long {
                    writer.cache()
                    val cache = factory.cache ?: return 0
                    return runCatching { cache.getCachedBytes(id, 0, androidx.media3.common.C.LENGTH_UNSET.toLong()) }.getOrDefault(0)
                }
                override fun cancel() = writer.cancel()
            }
        }
    }
}
