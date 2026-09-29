package app.ember.music

import android.os.Bundle
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The EmberPlayer plugin's output and cast-device answers, key for key as
 *  the web app reads them (older builds lack these methods; the web checks
 *  for them before calling). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class OutputsJsTest {
    private fun keys(o: JSONObject) = o.keys().asSequence().toSet()

    @Test fun `getOutputs has exactly the contract's keys, ids as strings`() {
        val js = outputsJs(OutputSnapshot(
            outputs = listOf(Output(11, "Buds", "bluetooth"), Output(2, "This phone", "speaker")),
            currentId = 11, preferredId = 11, systemSwitcher = true,
        ))
        assertEquals(setOf("outputs", "currentId", "preferredId", "systemSwitcher"), keys(js))
        val outs = js.getJSONArray("outputs")
        assertEquals(2, outs.length())
        val first = outs.getJSONObject(0)
        assertEquals(setOf("id", "name", "kind"), keys(first))
        assertEquals("11", first.get("id"))
        assertEquals("Buds", first.getString("name"))
        assertEquals("bluetooth", first.getString("kind"))
        assertEquals("2", outs.getJSONObject(1).get("id"))
        assertEquals("11", js.get("currentId"))
        assertEquals("11", js.get("preferredId"))
        assertEquals(true, js.get("systemSwitcher"))
    }

    @Test fun `no current or pinned output is null, not a missing key`() {
        val js = outputsJs(OutputSnapshot(emptyList(), null, null, false))
        assertEquals(setOf("outputs", "currentId", "preferredId", "systemSwitcher"), keys(js))
        assertTrue(js.isNull("currentId"))
        assertTrue(js.isNull("preferredId"))
        assertEquals(0, js.getJSONArray("outputs").length())
        assertEquals(false, js.get("systemSwitcher"))
        // And so it reaches the page (the event and the resolve are JSON text).
        val text = JSONObject(js.toString())
        assertEquals(JSONObject.NULL, text.get("currentId"))
        assertEquals(JSONArray().toString(), text.getJSONArray("outputs").toString())
    }

    @Test fun `the pinned output from the service's session extras`() {
        assertNull(pinnedOutput(Bundle.EMPTY))
        assertNull(pinnedOutput(Bundle().apply { putInt(EmberPlaybackService.EXTRA_OUTPUT_PREFERRED, -1) }))
        assertEquals(7, pinnedOutput(Bundle().apply { putInt(EmberPlaybackService.EXTRA_OUTPUT_PREFERRED, 7) }))
        assertEquals(0, pinnedOutput(Bundle().apply { putInt(EmberPlaybackService.EXTRA_OUTPUT_PREFERRED, 0) }))
        assertEquals("outputPreferredId", EmberPlaybackService.EXTRA_OUTPUT_PREFERRED)
        assertEquals("ember.output", EmberPlaybackService.COMMAND_OUTPUT)
    }

    @Test fun `setOutput's id argument`() {
        assertEquals(Result.success<Int?>(null), outputIdArg(JSONObject()))
        assertEquals(Result.success<Int?>(null), outputIdArg(JSONObject().put("id", JSONObject.NULL)))
        assertEquals(Result.success<Int?>(12), outputIdArg(JSONObject().put("id", "12")))
        assertEquals(Result.success<Int?>(12), outputIdArg(JSONObject().put("id", 12)))
        assertTrue(outputIdArg(JSONObject().put("id", "speaker")).isFailure)
        assertTrue(outputIdArg(JSONObject().put("id", "-3")).isFailure)
    }

    @Test fun `showOutputSwitcher's answer`() {
        val shown = switcherJs(shown = true, fallbackOpened = false)
        assertEquals(setOf("shown"), keys(shown))
        assertTrue(shown.getBoolean("shown"))
        val fallback = switcherJs(shown = false, fallbackOpened = true)
        assertEquals(setOf("shown", "fallback"), keys(fallback))
        assertTrue(fallback.getBoolean("shown"))
        assertEquals("bluetooth-settings", fallback.getString("fallback"))
        val nothing = switcherJs(shown = false, fallbackOpened = false)
        assertEquals(setOf("shown"), keys(nothing))
        assertFalse(nothing.getBoolean("shown"))
    }

    @Test fun `getCastDevices has exactly the contract's keys`() {
        val js = castDevicesJs(listOf(
            CastDevice("route-1", "Living Room TV", "Chromecast", selected = true, connecting = false),
            CastDevice("route-2", "Kitchen", null, selected = false, connecting = true),
        ))
        assertEquals(setOf("devices"), keys(js))
        val devices = js.getJSONArray("devices")
        val tv = devices.getJSONObject(0)
        assertEquals(setOf("id", "name", "description", "selected", "connecting"), keys(tv))
        assertEquals("route-1", tv.getString("id"))
        assertEquals("Living Room TV", tv.getString("name"))
        assertEquals("Chromecast", tv.getString("description"))
        assertTrue(tv.getBoolean("selected"))
        assertFalse(tv.getBoolean("connecting"))
        val kitchen = devices.getJSONObject(1)
        assertEquals(setOf("id", "name", "description", "selected", "connecting"), keys(kitchen))
        assertTrue(kitchen.isNull("description"))
        assertTrue(kitchen.getBoolean("connecting"))
        assertEquals(0, castDevicesJs(emptyList()).getJSONArray("devices").length())
    }
}
