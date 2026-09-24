package app.ember.music

/** Auto cache prefetch policy, a line-for-line port of the web app's
 *  `apps/web/lib/autoCache/policy.ts` (its README.md next to it is the
 *  contract). WHAT should be on disk (the current track and the next N
 *  playable) and WHEN one more prefetch may start.
 *
 *  Pure: no Android, no clock of its own. AutoCachePolicyTest runs every case
 *  of the shared table `policy.cases.json` against it, straight from the web
 *  folder, so the two ports cannot drift. Change the TS, the table and this
 *  file together. On Android the driver passes `requestCurrent = false`: the
 *  player's SimpleCache writes the current track through by itself. */
object AutoCachePolicy {
    const val N = 2
    const val MIN_PLAYED_SEC = 15.0
    const val BUFFER_FALLBACK_SEC = 45.0
    const val MAX_ATTEMPTS = 3
    val BACKOFF_SEC = longArrayOf(15, 30, 60, 120)
    const val RETRY_AFTER_CAP_SEC = 120.0
    const val BUSY_DEFAULT_SEC = 30.0
    const val EXPECTED_BYTES_DEFAULT = 6L * 1024 * 1024

    data class Track(val id: String, val streamUrl: String? = null, val unavailableAt: String? = null)

    enum class LoopMode { OFF, ALL, ONE }

    data class Input(
        val queue: List<Track>,
        val index: Int,
        val loopMode: LoopMode,
        /** Only the context's `type` is read (by wrapPoint). */
        val contextType: String?,
        val baseCount: Int,
        val playedSec: Double,
        /** null = the platform cannot tell. */
        val bufferedToEnd: Boolean?,
        /** Informational, never gates. */
        val playing: Boolean,
        val online: Boolean,
        /** null = unknown = not metered. */
        val metered: Boolean?,
        val saveData: Boolean,
        val batterySaver: Boolean,
        val enabled: Boolean,
        val allowMetered: Boolean,
        val requestCurrent: Boolean,
        val cached: Set<String>,
        val inFlight: String?,
        val bytes: Long,
        val cap: Long,
        val sizes: Map<String, Long>? = null,
        val expectedBytes: Map<String, Long>? = null,
        val backoffUntil: Map<String, Long>,
        val attempts: Map<String, Int>,
        val nowMs: Long,
    )

    sealed class Action {
        data class Start(val id: String) : Action()
        /** The in-flight id left the window: cancel it. */
        data class Abort(val id: String) : Action()
        /** `wakeAtMs` only with reason "backoff". */
        data class Idle(val reason: String, val wakeAtMs: Long? = null) : Action()
    }

    sealed class Result {
        data class Done(val bytes: Long) : Result()
        data class RetryAfter(val status: Int, val seconds: Double?) : Result()
        /** 410: the server has flagged the track unavailable. */
        object Gone : Result()
        object Failed : Result()
    }

    data class Ledger(val backoffUntil: Map<String, Long>, val attempts: Map<String, Int>, val drop: Boolean)

    // ── queueNav.ts, the parts the policy uses ──────────────────────────

    private fun isUnavailable(t: Track?): Boolean = !t?.unavailableAt.isNullOrEmpty()

    private fun wrapPoint(input: Input): Int {
        val curated = if (input.contextType == "playlist") input.baseCount else 0
        return if (curated > 0) minOf(curated, input.queue.size) else input.queue.size
    }

    /** queueNav.nextIndex: the index Next lands on, or null. */
    private fun nextIndex(input: Input, index: Int): Int? {
        val size = input.queue.size
        val wrapAt = wrapPoint(input)
        if (input.loopMode == LoopMode.ALL && index >= wrapAt - 1 && wrapAt > 0) return 0
        if (index < size - 1) return index + 1
        if (input.loopMode == LoopMode.ALL && size > 0) return 0
        return null
    }

    /** queueNav.nextPlayable with step +1: the first available index from
     *  `start`, -1 when none (one lap at most when wrapping). */
    private fun nextPlayable(queue: List<Track>, start: Int, wrap: Boolean): Int {
        val len = queue.size
        if (len == 0) return -1
        if (!wrap && (start < 0 || start >= len)) return -1
        var i = ((start % len) + len) % len
        for (steps in 0 until len) {
            if (!isUnavailable(queue[i])) return i
            val n = i + 1
            if (!wrap && n >= len) break
            i = n % len
        }
        return -1
    }

    // ── policy.ts ────────────────────────────────────────────────────────

    private fun streamable(t: Track?): Boolean =
        t != null && t.id.isNotEmpty() && !t.streamUrl.isNullOrEmpty() && !isUnavailable(t)

    fun desiredIds(input: Input): List<String> {
        val queue = input.queue
        val index = input.index
        if (index < 0 || index >= queue.size) return emptyList()
        val out = ArrayList<String>()
        val seen = HashSet<String>()
        val cur = queue[index]
        if (streamable(cur)) { out.add(cur.id); seen.add(cur.id) }
        val wrap = input.loopMode == LoopMode.ALL
        // Landing twice means loop-all came round: stop, so a queue of dead
        // or duplicate tracks cannot cycle forever.
        val landed = hashSetOf(index)
        var at = index
        var found = 0
        while (found < N) {
            val move = nextIndex(input, at) ?: break
            val r = nextPlayable(queue, move, wrap)
            if (r < 0 || !landed.add(r)) break
            at = r
            val t = queue[at]
            if (!streamable(t) || t.id in seen) continue
            seen.add(t.id)
            out.add(t.id)
            found++
        }
        return out
    }

    private fun protectedIds(input: Input, window: List<String>): Set<String> {
        val keep = HashSet(window)
        input.queue.getOrNull(input.index)?.id?.takeIf { it.isNotEmpty() }?.let { keep.add(it) }
        return keep
    }

    private fun reclaimableBytes(input: Input, keep: Set<String>): Long {
        val sizes = input.sizes ?: return 0
        var free = 0L
        for (id in input.cached) if (id !in keep) free += maxOf(0L, sizes[id] ?: 0L)
        return free
    }

    private fun expectedFor(input: Input, id: String): Long {
        val e = input.expectedBytes?.get(id)
        return if (e != null && e >= 0) e else EXPECTED_BYTES_DEFAULT
    }

    fun nextAction(input: Input): Action {
        if (!input.enabled) return Action.Idle("disabled")
        if (!input.online) return Action.Idle("offline")
        if (input.batterySaver) return Action.Idle("battery")
        if (input.saveData) return Action.Idle("metered")
        if (input.metered == true && !input.allowMetered) return Action.Idle("metered")

        val window = desiredIds(input)
        input.inFlight?.let { return if (it in window) Action.Idle("busy") else Action.Abort(it) }

        // `!(x >= y)` so a NaN from a confused player reads as not settled.
        val played = input.playedSec
        if (!(played >= MIN_PLAYED_SEC) || input.bufferedToEnd == false ||
            (input.bufferedToEnd == null && !(played >= BUFFER_FALLBACK_SEC))
        ) return Action.Idle("not-settled")

        val cur = input.queue.getOrNull(input.index)
        val skipCurrent = if (!input.requestCurrent && cur != null) cur.id else null
        val room = input.cap - input.bytes + reclaimableBytes(input, protectedIds(input, window))
        var wakeAtMs: Long? = null
        var sizeSkipped = false
        for (id in window) {
            if (id == skipCurrent || id in input.cached) continue
            if ((input.attempts[id] ?: 0) >= MAX_ATTEMPTS) continue
            val until = input.backoffUntil[id]
            if (until != null && until > input.nowMs) {
                wakeAtMs = if (wakeAtMs == null) until else minOf(wakeAtMs, until)
                continue
            }
            if (expectedFor(input, id) > room) { sizeSkipped = true; continue }
            return Action.Start(id)
        }
        if (wakeAtMs != null) return Action.Idle("backoff", wakeAtMs)
        if (sizeSkipped) return Action.Idle("cap")
        return Action.Idle("nothing")
    }

    fun onResult(input: Input, id: String, result: Result): Ledger {
        val backoffUntil = HashMap(input.backoffUntil)
        val attempts = HashMap(input.attempts)
        when (result) {
            is Result.Done -> {
                backoffUntil.remove(id); attempts.remove(id)
                return Ledger(backoffUntil, attempts, false)
            }
            Result.Gone -> {
                backoffUntil.remove(id); attempts[id] = MAX_ATTEMPTS
                return Ledger(backoffUntil, attempts, true)
            }
            else -> Unit
        }
        val n = (attempts[id] ?: 0) + 1
        attempts[id] = n
        var waitSec = BACKOFF_SEC[minOf(n, BACKOFF_SEC.size) - 1].toDouble()
        if (result is Result.RetryAfter) {
            val s = result.seconds
            if (s != null && s.isFinite() && s >= 0) waitSec = minOf(s, RETRY_AFTER_CAP_SEC)
            else if (result.status == 503) waitSec = BUSY_DEFAULT_SEC
        }
        backoffUntil[id] = input.nowMs + Math.round(waitSec * 1000)
        return Ledger(backoffUntil, attempts, n >= MAX_ATTEMPTS)
    }

    fun evictionOrder(input: Input, lastUsed: Map<String, Long>): List<String> {
        val keep = protectedIds(input, desiredIds(input))
        return input.cached.filter { it !in keep }.sortedWith(
            compareBy<String> { lastUsed[it] ?: Long.MIN_VALUE }.thenBy { it },
        )
    }

    data class Fit(val evict: List<String>, val fits: Boolean)

    fun evictToFit(input: Input, lastUsed: Map<String, Long>, incomingBytes: Long): Fit {
        var bytes = input.bytes
        if (bytes + incomingBytes <= input.cap) return Fit(emptyList(), true)
        val evict = ArrayList<String>()
        for (id in evictionOrder(input, lastUsed)) {
            evict.add(id)
            bytes -= maxOf(0L, input.sizes?.get(id) ?: 0L)
            if (bytes + incomingBytes <= input.cap) return Fit(evict, true)
        }
        return Fit(emptyList(), false)
    }
}
