package app.ember.music

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowActivityManager
import java.util.concurrent.Executor

/** The player's own log (PlaybackLog.kt): what reaches the server from a car
 *  with no page open, in batches, with nothing secret in it, a capped buffer,
 *  and a watchdog for "play did not start" that fires even while the main
 *  thread is stuck asking for audio focus (2026-10-07). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PlaybackLogTest {
    private val app = RuntimeEnvironment.getApplication()

    /** A Delay whose tasks run only when the test says so. */
    private class FakeDelay : Delay {
        class Task(val ms: Long, val run: Runnable) { var cancelled = false }
        val tasks = mutableListOf<Task>()
        override fun after(ms: Long, task: Runnable): () -> Unit {
            val t = Task(ms, task)
            tasks += t
            return { t.cancelled = true }
        }
        fun fire() {
            val due = tasks.filter { !it.cancelled }
            tasks.clear()
            due.forEach { it.run.run() }
        }
        fun live() = tasks.count { !it.cancelled }
    }

    private val sent = mutableListOf<JSONObject>()
    private var online = true
    private var accept = true
    private var now = 1_000_000L
    private val delay = FakeDelay()
    private val direct = Executor { it.run() }

    private fun logger(surface: String = Surfaces.PHONE) = PlaybackLog(
        send = { body -> if (!accept) throw java.io.IOException("POST /api/native-log -> 401"); sent += body },
        online = { online },
        io = direct,
        delay = delay,
        surface = { surface },
        device = JSONObject().put("model", "Google Pixel 8").put("sdk", 34).put("app", "0.4.17"),
        clock = { now },
        session = "s-1",
    )

    private fun events(body: JSONObject) = (0 until body.getJSONArray("events").length()).map { body.getJSONArray("events").getJSONObject(it) }

    // ── Batching ────────────────────────────────────────────────────────

    @Test fun `events wait for a batch, then go together with the session and device`() {
        val log = logger()
        repeat(PlaybackLog.BATCH - 1) { log.info("state", "buffering $it") }
        assertTrue(sent.isEmpty())
        assertEquals(1, delay.live())
        log.info("state", "ready")
        assertEquals(1, sent.size)
        val body = sent[0]
        assertEquals("s-1", body.getString("session"))
        assertEquals("Google Pixel 8", body.getJSONObject("device").getString("model"))
        assertEquals(PlaybackLog.BATCH, events(body).size)
        assertEquals("buffering 0", events(body)[0].getString("message"))
        assertEquals("phone", events(body)[0].getString("surface"))
        assertEquals(0, log.pendingCount())
    }

    @Test fun `a few events go out when the flush timer runs`() {
        val log = logger(Surfaces.ANDROID_AUTO)
        log.info("play.request", "play requested")
        log.info("state", "buffering")
        assertEquals(PlaybackLog.FLUSH_MS, delay.tasks.single().ms)
        delay.fire()
        assertEquals(1, sent.size)
        assertEquals(2, events(sent[0]).size)
        assertEquals("android-auto", events(sent[0])[1].getString("surface"))
    }

    @Test fun `an error goes out at once`() {
        val log = logger()
        log.info("state", "buffering")
        log.error("player.error", "ERROR_CODE_IO_BAD_HTTP_STATUS: 403")
        assertEquals(1, sent.size)
        assertEquals(listOf("info", "error"), events(sent[0]).map { it.getString("level") })
    }

    @Test fun `offline nothing is sent and the events wait`() {
        val log = logger()
        online = false
        log.error("player.error", "no network")
        assertTrue(sent.isEmpty())
        assertEquals(1, log.pendingCount())
        online = true
        delay.fire()
        assertEquals(1, sent.size)
    }

    @Test fun `a batch the server refuses is dropped without a word`() {
        val log = logger()
        accept = false
        log.error("player.error", "boom")
        assertEquals(0, log.pendingCount())
        accept = true
        log.error("player.error", "again")
        assertEquals(1, events(sent.single()).size)
    }

    @Test fun `the buffer is capped, the oldest go, and the server hears how many`() {
        val log = logger()
        online = false
        repeat(PlaybackLog.MAX_BUFFERED + 30) { log.info("state", "e$it") }
        assertEquals(PlaybackLog.MAX_BUFFERED, log.pendingCount())
        assertEquals("e30", log.pending().first().getString("message"))
        online = true
        log.flush()
        assertEquals(30, sent[0].getInt("dropped"))
        // The rest follow in batches.
        assertEquals(PlaybackLog.MAX_BUFFERED / PlaybackLog.BATCH, sent.size)
        assertFalse(sent[1].has("dropped"))
    }

    @Test fun `a bad event name is coerced, never sent as given`() {
        val log = logger()
        log.error("Bad Name!", "x")
        assertEquals("event", events(sent[0])[0].getString("event"))
    }

    // ── Redaction ───────────────────────────────────────────────────────

    @Test fun `stream URLs become their host, and no cookie or token leaves`() {
        val log = logger()
        log.error(
            "player.error",
            "GET http://10.0.2.2:3069/api/youtube/stream/abc?sig=SECRET failed with pb_auth=eyJhbGciOi.secret; bearer abc.def.ghi",
            JSONObject()
                .put("url", "https://ember.example.com/api/youtube/stream/x?token=T0P")
                .put("cookie", "pb_auth=eyJ")
                .put("authToken", "T")
                .put("email", "owner@example.com")
                .put("nested", JSONObject().put("password", "p").put("note", "x".repeat(1000))),
        )
        val e = events(sent[0])[0]
        val text = e.toString()
        assertFalse(text, text.contains("SECRET"))
        assertFalse(text, text.contains("eyJ"))
        assertFalse(text, text.contains("T0P"))
        assertFalse(text, text.contains("abc.def"))
        assertFalse(text, text.contains("owner@example.com"))
        assertFalse(text, text.contains("/api/youtube/stream"))
        assertTrue(e.getString("message").contains("10.0.2.2"))
        val data = e.getJSONObject("data")
        assertEquals("ember.example.com", data.getString("url"))
        assertFalse(data.has("cookie"))
        assertFalse(data.has("authToken"))
        assertFalse(data.getJSONObject("nested").has("password"))
        assertTrue(data.getJSONObject("nested").getString("note").length <= LogRedact.MAX_STRING + 1)
    }

    @Test fun `a source is a host or file, never a path`() {
        assertEquals("10.0.2.2", LogRedact.source("http://10.0.2.2:3069/api/youtube/stream/abc?x=1"))
        assertEquals("file", LogRedact.source("file:///data/user/0/app.ember.music/files/a.m4a"))
        assertNull(LogRedact.source(null))
    }

    // ── Surface ─────────────────────────────────────────────────────────

    @Test fun `the surface is the car's own Android, a projected car, or a phone`() {
        assertEquals("aaos", Surfaces.of(automotive = true, carMode = true, carConnected = true))
        assertEquals("android-auto", Surfaces.of(automotive = false, carMode = false, carConnected = true))
        assertEquals("android-auto", Surfaces.of(automotive = false, carMode = true, carConnected = false))
        assertEquals("phone", Surfaces.of(automotive = false, carMode = false, carConnected = false))
        assertFalse(Surfaces.isAutomotive(app))
    }

    // ── Watchdog ────────────────────────────────────────────────────────

    private val exos = mutableListOf<ExoPlayer>()

    @org.junit.After fun release() = exos.forEach { it.release() }

    private fun stubPlayer(playing: Boolean = false, items: Int = 1): Player {
        val exo = ExoPlayer.Builder(app).build().also { exos += it }
        if (items > 0) exo.setMediaItem(MediaItem.fromUri("http://10.0.2.2:3069/api/youtube/stream/abc?sig=SECRET"))
        return object : androidx.media3.common.ForwardingPlayer(exo) {
            override fun isPlaying() = playing
        }
    }

    @Test fun `play that never starts is reported from the timer, with what the player last said`() {
        val log = logger(Surfaces.AAOS)
        val watch = PlayWatch(log, delay, clock = { now }, caller = { "com.android.car.media" })
        val p = stubPlayer()
        watch.beforePlay(p)
        watch.onPlaybackStateChanged(Player.STATE_BUFFERING)
        watch.onPlayWhenReadyChanged(true, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
        watch.afterPlay(p)
        assertEquals(PlayWatch.TIMEOUT_MS, delay.tasks.first { !it.cancelled && it.ms == PlayWatch.TIMEOUT_MS }.ms)
        now += PlayWatch.TIMEOUT_MS
        delay.fire()
        // The warning is flushed straight away, not left for the timer.
        val all = sent.flatMap { events(it) }
        val stalled = all.single { it.getString("event") == "play.stalled" }
        assertEquals("warn", stalled.getString("level"))
        assertTrue(stalled.getString("message").startsWith("play did not start within 8 s"))
        assertEquals("buffering", stalled.getJSONObject("data").getString("state"))
        assertEquals("com.android.car.media", stalled.getJSONObject("data").getString("caller"))
        val request = all.first { it.getString("event") == "play.request" }
        assertEquals("10.0.2.2", request.getJSONObject("data").getString("source"))
        assertFalse(all.toString().contains("SECRET"))
    }

    @Test fun `stuck inside play() (waiting on audio focus) says so`() {
        val log = logger()
        val watch = PlayWatch(log, delay, clock = { now })
        watch.beforePlay(stubPlayer())
        // play() never returns: the car's focus policy does not answer.
        now += 9_000
        delay.tasks.first { it.ms == PlayWatch.TIMEOUT_MS }.run.run()
        val stalled = sent.flatMap { events(it) }.single { it.getString("event") == "play.stalled" }
        assertTrue(stalled.getString("message").contains("still inside play() after 9000 ms"))
        assertEquals(9_000, stalled.getJSONObject("data").getLong("blockedMs"))
    }

    @Test fun `play that starts in time disarms the watchdog`() {
        val log = logger()
        val watch = PlayWatch(log, delay, clock = { now })
        val p = stubPlayer()
        watch.beforePlay(p)
        watch.afterPlay(p)
        now += 1_200
        watch.onIsPlayingChanged(true)
        delay.tasks.filter { it.ms == PlayWatch.TIMEOUT_MS }.forEach { assertTrue(it.cancelled) }
        log.flush()
        val all = sent.flatMap { events(it) }
        assertFalse(all.any { it.getString("event") == "play.stalled" })
        assertEquals("playing after 1200 ms", all.single { it.getString("event") == "play.start" }.getString("message"))
    }

    @Test fun `already playing, or nothing queued, arms nothing`() {
        val watch = PlayWatch(logger(), delay, clock = { now })
        watch.beforePlay(stubPlayer(playing = true))
        watch.beforePlay(stubPlayer(items = 0))
        assertEquals(0, delay.tasks.count { it.ms == PlayWatch.TIMEOUT_MS })
    }

    @Test fun `audio focus time and result are logged, slow or refused as a warning`() {
        assertEquals("granted", PlayWatch.focusResult(true, Player.PLAYBACK_SUPPRESSION_REASON_NONE, Player.STATE_READY))
        assertEquals("waiting", PlayWatch.focusResult(true, Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS, Player.STATE_READY))
        assertEquals("denied", PlayWatch.focusResult(false, Player.PLAYBACK_SUPPRESSION_REASON_NONE, Player.STATE_BUFFERING))
        val log = logger()
        val watch = PlayWatch(log, delay, clock = { now })
        val p = stubPlayer()
        watch.beforePlay(p)
        now += 2_500
        watch.afterPlay(p)
        log.flush()
        val focus = sent.flatMap { events(it) }.single { it.getString("event") == "focus" }
        assertEquals("warn", focus.getString("level"))
        assertEquals(2_500, focus.getJSONObject("data").getLong("ms"))
    }

    @Test fun `a player error carries its errorCodeName and HTTP status, never the URL`() {
        val log = logger()
        val watch = PlayWatch(log, delay, clock = { now })
        val spec = androidx.media3.datasource.DataSpec(android.net.Uri.parse("http://10.0.2.2:3069/api/youtube/stream/abc?sig=SECRET"))
        val http = androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException(
            403, "Forbidden", null, emptyMap(), spec, ByteArray(0))
        watch.onPlayerError(androidx.media3.exoplayer.ExoPlaybackException.createForSource(http, PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS))
        val e = events(sent.single()).single()
        assertEquals("error", e.getString("level"))
        val data = e.getJSONObject("data")
        assertEquals("ERROR_CODE_IO_BAD_HTTP_STATUS", data.getString("errorCodeName"))
        assertEquals(403, data.getInt("httpStatus"))
        assertEquals("10.0.2.2", data.getString("host"))
        assertFalse(e.toString().contains("SECRET"))
    }

    // ── Exit reasons ────────────────────────────────────────────────────

    @Test fun `the last run's ANR is reported once, on the next start`() {
        val am = app.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val prefs = app.getSharedPreferences(ExitReasons.PREFS, Context.MODE_PRIVATE)
        prefs.edit().clear().commit()
        val wall = System.currentTimeMillis()
        shadowOf(am).addApplicationExitInfo(
            ShadowActivityManager.ApplicationExitInfoBuilder.newBuilder()
                .setProcessName(app.packageName)
                .setReason(ApplicationExitInfo.REASON_ANR)
                .setDescription("user request after error: Input dispatching timed out")
                .setTimestamp(wall - 60_000)
                .build(),
        )
        shadowOf(am).addApplicationExitInfo(
            ShadowActivityManager.ApplicationExitInfoBuilder.newBuilder()
                .setProcessName(app.packageName)
                .setReason(ApplicationExitInfo.REASON_CRASH)
                // A week old on a first run: history, not news.
                .setTimestamp(wall - 7 * 24 * 60 * 60_000L)
                .build(),
        )
        val log = logger()
        ExitReasons.report(app, log, prefs, now = wall)
        val exit = events(sent.single()).single()
        assertEquals("exit", exit.getString("event"))
        assertEquals("error", exit.getString("level"))
        assertEquals("anr", exit.getJSONObject("data").getString("reason"))
        assertTrue(exit.getJSONObject("data").getString("description").contains("Input dispatching timed out"))
        // Not again on the start after.
        sent.clear()
        ExitReasons.report(app, log, prefs, now = wall)
        log.flush()
        assertTrue(sent.isEmpty())
    }

    @Test fun `exit levels`() {
        assertEquals("error", ExitReasons.level(ApplicationExitInfo.REASON_CRASH_NATIVE))
        assertEquals("warn", ExitReasons.level(ApplicationExitInfo.REASON_LOW_MEMORY))
        assertEquals("info", ExitReasons.level(ApplicationExitInfo.REASON_USER_REQUESTED))
        assertEquals("anr", ExitReasons.name(ApplicationExitInfo.REASON_ANR))
    }
}
