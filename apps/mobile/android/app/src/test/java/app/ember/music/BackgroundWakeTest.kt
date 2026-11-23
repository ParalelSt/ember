package app.ember.music

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** What keeps waking while nothing needs it: the plugin's position tick
 *  while paused, and the service's cache look while the app is off screen. */
class BackgroundWakeTest {
    @Test fun `the position tick runs only on screen and playing`() {
        val gate = PageStateGate()
        assertTrue(gate.ticks(playing = true))
        assertFalse(gate.ticks(playing = false))
        gate.hidden()
        assertFalse(gate.ticks(playing = true))
    }

    @Test fun `a stopped tick starts again when the music plays on screen, never twice`() {
        val gate = PageStateGate()
        assertTrue(gate.tickResumes(ticking = false, playing = true))
        assertFalse(gate.tickResumes(ticking = true, playing = true))
        assertFalse(gate.tickResumes(ticking = false, playing = false))
        gate.hidden()
        assertFalse(gate.tickResumes(ticking = false, playing = true))
    }

    @Test fun `the cache look runs on screen, or off screen only for a new queue`() {
        assertTrue(CacheStatePolicy.lookUp(onScreen = true, queueChanged = false))
        assertTrue(CacheStatePolicy.lookUp(onScreen = false, queueChanged = true))
        assertFalse(CacheStatePolicy.lookUp(onScreen = false, queueChanged = false))
    }

    private val plugin = File("src/main/java/app/ember/music/EmberPlayerPlugin.kt").readText()
    private val service = File("src/main/java/app/ember/music/EmberPlaybackService.kt").readText()

    private fun body(src: String, of: String): String {
        val start = src.indexOf(of)
        assertTrue("no $of", start >= 0)
        val open = src.indexOf('{', start)
        var depth = 0
        for (i in open until src.length) {
            when (src[i]) {
                '{' -> depth++
                '}' -> if (--depth == 0) return src.substring(open, i + 1)
            }
        }
        error("unbalanced $of")
    }

    @Test fun `the plugin tick does not repost itself while paused, and a play restarts it`() {
        val tick = body(plugin, "private fun tick()")
        assertTrue(tick.contains("if (!gate.ticks(c.isPlaying)) return"))
        assertTrue(tick.indexOf("return") < tick.indexOf("main.postDelayed(tickTask"))
        val events = body(plugin, "override fun onEvents(")
        assertTrue(events.contains("gate.tickResumes(ticking, player.isPlaying)"))
    }

    @Test fun `the service's cache tick looks at the disk off the main thread`() {
        val tick = body(service, "private fun cacheTick()")
        assertTrue(tick.contains("tickCacheState()"))
        assertFalse(tick.contains("publishCacheState()"))
        val look = body(service, "private fun tickCacheState()")
        assertTrue(look.contains("cacheIo.execute"))
        assertTrue(look.indexOf("onPhone(ids)") > look.indexOf("cacheIo.execute"))
    }
}
