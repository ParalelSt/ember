package app.ember.music

import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.RejectedExecutionException

/** After the service's onDestroy shuts the cache executor down, a late tick
 *  that decided to start a prefetch threw RejectedExecutionException with
 *  `inFlight` already set. The service saw a download "in flight" forever
 *  and kept re-ticking every 5 s on the dead service. A refused start must
 *  leave nothing in flight. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AutoCacherRejectTest {
    @Test fun aRefusedStartLeavesNothingInFlight() {
        val queue = listOf("a", "b", "c").map { AutoCachePolicy.Track("youtube:$it", "https://ember.test/api/youtube/stream/$it") }
        val snap = AutoCacher.Snapshot(
            queue = queue, index = 0, loopMode = AutoCachePolicy.LoopMode.OFF, contextType = null, baseCount = 0,
            playedSec = 20.0, bufferedToEnd = true, playing = true,
            net = NetworkWatch.State(online = true, metered = false, saveData = false),
            batterySaver = false,
        )
        val store = object : AutoCacher.Store {
            override val cap = MediaCache.CAP_BYTES
            override fun fullyCached() = emptySet<String>()
            override fun sizes() = emptyMap<String, Long>()
        }
        val cacher = AutoCacher(
            store = store,
            downloads = { _, _ -> object : AutoCacher.Download { override fun run() = 1L; override fun cancel() {} } },
            executor = { throw RejectedExecutionException("shut down") },
            main = { it.run() },
            snapshot = { snap },
        )

        runCatching { cacher.tick() }

        assertNull(cacher.inFlight)
    }
}
