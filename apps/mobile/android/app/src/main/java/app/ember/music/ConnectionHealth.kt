package app.ember.music

/** Whether the connection is getting anything through, as the music sees it.
 *
 *  Android's "online" (NetworkWatch) is a validated network, and Android
 *  checks that when the network changes. A weak mobile signal (a tunnel, a
 *  dead zone, a mast that stopped answering) leaves the network validated
 *  while nothing gets through, so the player treated a dead connection as a
 *  slow one: it waited on a song that could not load while the songs on the
 *  phone sat unplayed (the 2026-10 report: "playback stopped when mobile
 *  data wasn't picking up instead of playing the cached songs").
 *
 *  So a hint that the connection may be gone (a load that failed on the
 *  connection, a song stuck loading with no data) asks the Ember server
 *  once ([probe]: any HTTP answer counts). No answer: [down], and it asks
 *  again every [RETRY_MS] until one comes. Data arriving by itself (the
 *  player's own retries getting through) ends it at once.
 *
 *  Decisions run on the main thread; [onData] is called by the HTTP stack
 *  from its own threads, for every chunk it reads, so it is cheap. */
class ConnectionHealth(
    /** Blocking: whether the server answered. Runs on [io]. */
    private val probe: () -> Boolean,
    private val io: (Runnable) -> Unit,
    private val main: (Runnable) -> Unit,
    /** Runs the task after the delay on the main thread; returns its cancel. */
    private val later: (Long, Runnable) -> () -> Unit,
    /** Time that only moves forward (not the wall clock). */
    private val clock: () -> Long = android.os.SystemClock::elapsedRealtime,
    /** [down] changed. Main thread. */
    private val onChange: (Boolean) -> Unit,
) {
    companion object {
        /** How often a connection found down is asked again. */
        const val RETRY_MS = 10_000L
        /** A connection that answered (or carried data) this recently is not
         *  asked again for a mere hint. */
        const val FRESH_MS = 15_000L
    }

    /** The server could not be reached, and nothing has come through since. */
    @Volatile var down = false
        private set

    private var probing = false
    private var probeStartedAt = 0L
    private var stopped = false
    private var cancelRetry: (() -> Unit)? = null
    @Volatile private var lastOkAt = Long.MIN_VALUE / 2
    /** An "up" already on its way to the main thread (see [onData]). */
    @Volatile private var upPosted = false

    /** Something suggests the connection is gone: find out, unless it was
     *  known good a moment ago or a look is already under way. */
    fun suspect() {
        if (stopped || probing) return
        if (!down && clock() - lastOkAt < FRESH_MS) return
        look()
    }

    /** The network changed (another one, or the same one again): while down,
     *  look now instead of at the next retry. */
    fun onNetworkChanged() {
        if (down && !probing && !stopped) look()
    }

    /** Bytes came in over the network. Any thread. */
    fun onData() {
        lastOkAt = clock()
        if (!down || upPosted) return
        upPosted = true
        main(Runnable {
            upPosted = false
            if (!stopped) up()
        })
    }

    fun stop() {
        stopped = true
        cancelRetry?.invoke()
        cancelRetry = null
    }

    private fun look() {
        cancelRetry?.invoke()
        cancelRetry = null
        probing = true
        probeStartedAt = clock()
        try {
            io(Runnable {
                val ok = runCatching(probe).getOrDefault(false)
                main(Runnable { answered(ok) })
            })
        } catch (e: java.util.concurrent.RejectedExecutionException) {
            // The service is going away.
            probing = false
        }
    }

    private fun answered(ok: Boolean) {
        probing = false
        if (stopped) return
        // Data that came in while the server was being asked answers too.
        if (ok || lastOkAt >= probeStartedAt) {
            lastOkAt = clock()
            up()
            return
        }
        set(true)
        cancelRetry = later(RETRY_MS, Runnable {
            cancelRetry = null
            if (!stopped && !probing) look()
        })
    }

    private fun up() {
        cancelRetry?.invoke()
        cancelRetry = null
        set(false)
    }

    private fun set(v: Boolean) {
        if (down == v) return
        down = v
        onChange(v)
    }
}

/** Calls [onBytes] for every chunk read over the network: the HTTP data
 *  source's transfer events, for ConnectionHealth.onData. */
class DataSeen(private val onBytes: () -> Unit) : androidx.media3.datasource.TransferListener {
    override fun onTransferInitializing(source: androidx.media3.datasource.DataSource, dataSpec: androidx.media3.datasource.DataSpec, isNetwork: Boolean) = Unit
    override fun onTransferStart(source: androidx.media3.datasource.DataSource, dataSpec: androidx.media3.datasource.DataSpec, isNetwork: Boolean) = Unit
    override fun onBytesTransferred(source: androidx.media3.datasource.DataSource, dataSpec: androidx.media3.datasource.DataSpec, isNetwork: Boolean, bytesTransferred: Int) {
        if (isNetwork && bytesTransferred > 0) onBytes()
    }
    override fun onTransferEnd(source: androidx.media3.datasource.DataSource, dataSpec: androidx.media3.datasource.DataSpec, isNetwork: Boolean) = Unit
}
