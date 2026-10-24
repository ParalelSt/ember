package app.ember.music

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The page's MediaController is let go with the page, even when the page
 *  goes before the connection to the player service has landed. It used to
 *  release only a controller already in hand: one that connected after the
 *  page was gone stayed bound to the service for the life of the process, and
 *  its listener started the dead page's position ticks again. */
class PluginControllerReleaseTest {
    private val src = File("src/main/java/app/ember/music/EmberPlayerPlugin.kt").readText()

    private fun body(of: String): String {
        val start = src.indexOf(of)
        assertTrue("no $of in EmberPlayerPlugin", start >= 0)
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

    @Test fun `the plugin releases the connection future, landed or not`() {
        val destroy = body("override fun handleOnDestroy()")
        assertTrue(destroy.contains("MediaController.releaseFuture("))
        assertFalse("only a landed controller was released", destroy.contains("controller?.release()"))
    }

    @Test fun `a connection that lands after the plugin went is not taken up`() {
        val load = body("override fun load()")
        val listener = load.substring(load.indexOf("future.addListener"))
        assertTrue(listener.indexOf("if (destroyed) return@addListener") in 0 until listener.indexOf("controller = c"))
    }
}
