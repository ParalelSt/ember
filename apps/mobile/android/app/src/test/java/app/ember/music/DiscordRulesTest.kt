package app.ember.music

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the card says, matching the desktop app's (discord.rs). */
class DiscordRulesTest {
    private fun card(position: Double = 0.0, duration: Double = 240.0, received: Long = 1_000_000_000L, album: String? = null, artist: String = "The Nulls") =
        PresenceCard("Second", artist, album, null, position, duration, received)

    @Test fun `short texts are padded to Discord's minimum`() {
        assertEquals(2, DiscordRules.text("7").length)
        assertTrue(DiscordRules.text("7").startsWith("7"))
        assertEquals("⠀⠀", DiscordRules.text(""))
        assertEquals("Song", DiscordRules.text("Song"))
    }

    @Test fun `an emoji counts as one character, and is not cut in half`() {
        val note = "🎵"
        assertEquals(note + "⠀", DiscordRules.text(note))
        val long = DiscordRules.text(note.repeat(200))
        assertEquals(128, long.codePointCount(0, long.length))
        assertTrue(long.endsWith(note + "…"))
    }

    @Test fun `an image over Discord's limit is dropped`() {
        assertNull(DiscordRules.image("https://lh3.googleusercontent.com/" + "a".repeat(300)))
        assertNull(DiscordRules.image(""))
        assertNull(DiscordRules.image(null))
        assertEquals("https://i.ytimg.com/vi/x/hq.jpg", DiscordRules.image("https://i.ytimg.com/vi/x/hq.jpg"))
    }

    @Test fun `only a public cover goes on the card, never the Ember server's address`() {
        val base = "https://ember.example.ts.net"
        assertEquals("https://i.ytimg.com/vi/x/hq.jpg", DiscordRules.artwork("https://i.ytimg.com/vi/x/hq.jpg", base))
        assertNull(DiscordRules.artwork("/api/uploads/1/art", base))
        assertNull(DiscordRules.artwork("$base/api/uploads/1/art", base))
        assertNull(DiscordRules.artwork("$base/api/uploads/1/art", "$base/"))
        assertNull(DiscordRules.artwork("content://app.ember.music.artwork/x", base))
        assertNull(DiscordRules.artwork("", base))
        assertNull(DiscordRules.artwork(null, base))
        assertEquals("https://ember.example.ts.net.evil/a.jpg", DiscordRules.artwork("https://ember.example.ts.net.evil/a.jpg", base))
    }

    @Test fun `a new song at zero starts now`() {
        val (start, end) = DiscordRules.timestamps(card())
        assertEquals(1_000_000_000L, start)
        assertEquals(start + 240_000, end)
    }

    @Test fun `a seek starts the bar that far back, in whole seconds`() {
        val (start, _) = DiscordRules.timestamps(card(position = 60.4))
        assertEquals((1_000_000L - 60) * 1000, start)
    }

    @Test fun `a queued update keeps the moment it was read, however late it goes out`() {
        assertEquals((5_000L - 30) * 1000, DiscordRules.timestamps(card(position = 30.0, received = 5_000_000L)).first)
    }

    @Test fun `no length means no end`() {
        assertNull(DiscordRules.timestamps(card(duration = 0.0)).second)
    }

    @Test fun `the card reads like the desktop's`() {
        val a = DiscordRules.activity(card(album = "The Album"))
        assertEquals("Second", a.details)
        assertEquals("by The Nulls", a.state)
        assertEquals("The Album", a.largeText)
        assertEquals("Second", DiscordRules.activity(card(album = "")).largeText)
        assertNull(DiscordRules.activity(card(artist = "")).state)
    }

    @Test fun `the player's unknown numbers read as nothing`() {
        val c = DiscordRules.card("T", null, null, null, -5, Long.MIN_VALUE + 1, 1L)
        assertEquals(0.0, c.positionSec, 0.0)
        assertEquals(0.0, c.durationSec, 0.0)
        assertEquals("", c.artist)
    }

    @Test fun `the player's length wins, then the catalog's`() {
        assertEquals(200_000L, DiscordRules.duration(200_000, 190_000))
        assertEquals(190_000L, DiscordRules.duration(0, 190_000))
        assertEquals(0L, DiscordRules.duration(0, null))
        assertEquals(0L, DiscordRules.duration(-1, 0))
    }

    @Test fun `a card shows only playing, with a song, for someone who allows it`() {
        assertTrue(DiscordRules.shows(true, true, true))
        assertFalse(DiscordRules.shows(false, true, true))
        assertFalse(DiscordRules.shows(true, false, true))
        assertFalse(DiscordRules.shows(true, true, false))
    }

    @Test fun `the app id fits a Discord snowflake, and anything else is none`() {
        assertEquals(1546926084111474848L, DiscordRules.appId("1546926084111474848"))
        assertEquals(1546926084111474848L, DiscordRules.appId(" 1546926084111474848\n"))
        assertNull(DiscordRules.appId(""))
        assertNull(DiscordRules.appId(null))
        assertNull(DiscordRules.appId("0"))
        assertNull(DiscordRules.appId("abc"))
    }

    @Test fun `what stands in the way, most final first`() {
        assertTrue(DiscordRules.status(false, 34, 1, true) is DiscordStatus.Off)
        assertTrue(DiscordRules.status(true, 23, 1, true) is DiscordStatus.Off)
        assertTrue(DiscordRules.status(true, 34, null, true) is DiscordStatus.Off)
        assertTrue(DiscordRules.status(true, 34, 1, false) is DiscordStatus.Waiting)
        assertEquals(DiscordStatus.Ready, DiscordRules.status(true, 24, 1, true))
    }

    @Test fun `the shim's answers are read`() {
        assertEquals(DiscordRules.Result(7, true, null), DiscordRules.parseResult("7\t1\t"))
        assertEquals(DiscordRules.Result(8, false, "4 not\tthere"), DiscordRules.parseResult("8\t0\t4 not\tthere"))
        assertNull(DiscordRules.parseResult("junk"))
        assertNull(DiscordRules.parseResult(""))
    }
}
