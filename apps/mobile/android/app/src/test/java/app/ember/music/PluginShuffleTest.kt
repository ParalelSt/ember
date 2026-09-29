package app.ember.music

import android.os.Bundle
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What the web app hears of native's shuffle, and what its shuffle button
 *  sends (EmberPlayerPlugin). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PluginShuffleTest {
    @Test fun `the service's shuffle extra wins over the player's own flag`() {
        assertTrue(shuffleOf(Bundle().apply { putBoolean(EmberPlaybackService.EXTRA_SHUFFLE, true) }, playerFlag = false))
        assertFalse(shuffleOf(Bundle().apply { putBoolean(EmberPlaybackService.EXTRA_SHUFFLE, false) }, playerFlag = true))
        // An older service without the extra.
        assertTrue(shuffleOf(Bundle(), playerFlag = true))
    }

    @Test fun `the queue event says whether it is shuffled`() {
        val item = TrackItems.toMediaItem(JSONObject("""{"id":"a","title":"A","artist":"X","streamUrl":"/s/a"}"""), "http://h")
        val js = queueJs(listOf(item), 0, shuffle = true)
        assertTrue(js.getBoolean("shuffle"))
        assertEquals(0, js.getInt("index"))
        assertFalse(queueJs(emptyList(), 0).getBoolean("shuffle"))
    }

    @Test fun `setShuffle carries the flag and the order to go back to`() {
        val on = shuffleArgs(JSONObject("""{"on":true,"order":["a","b",""]}"""))
        assertTrue(on.getBoolean("on"))
        assertEquals(listOf("a", "b"), on.getStringArrayList("order"))
        val off = shuffleArgs(JSONObject("""{"on":false}"""))
        assertFalse(off.getBoolean("on"))
        assertFalse(off.getBoolean("restore"))
        assertNull(off.getStringArrayList("order"))
        assertTrue(shuffleArgs(JSONObject("""{"on":false,"restore":true}""")).getBoolean("restore"))
    }
}
