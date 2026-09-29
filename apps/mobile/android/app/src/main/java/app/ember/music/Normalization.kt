package app.ember.music

import android.content.SharedPreferences
import android.util.Log
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor
import kotlin.math.log10
import kotlin.math.pow

/** Volume normalization on the phone, the native twin of the web player's
 *  (apps/web/lib/playback/normalization.ts).
 *
 *  The server measures each song once and hands out a gain in dB
 *  (GET /api/tracks/<id>/loudness): 0 for a typical song, a few dB down for
 *  a loud master, up for a quiet one as far as its true peak allows. On
 *  Android the native player moves between songs by itself (the web app may
 *  not even be running, in the car), so the level has to change here, at
 *  the moment the song does. A cut is the player's volume, which Android
 *  applies to what is heard right away: the new song starts at its own
 *  level. The player's volume cannot go past 1, so a boost past that goes
 *  to a [Booster] (Android's LoudnessEnhancer on the player's audio session)
 *  instead: a quiet song really comes up, even with the slider at the top. */
object Loudness {
    /** The bounds the server's policy clamps to, applied again here. */
    const val MIN_GAIN_DB = -5.0
    const val MAX_GAIN_DB = 6.0
    /** A gain that changes in the middle of a song (it arrived after the song
     *  started, or the setting was switched) fades over this long. */
    const val RAMP_MS = 400L
    const val RAMP_STEP_MS = 25L

    /** dB to a linear multiplier; anything not a number is 1. */
    fun dbToLinear(db: Double?): Float {
        if (db == null || db.isNaN() || db.isInfinite()) return 1f
        return 10.0.pow(db.coerceIn(MIN_GAIN_DB, MAX_GAIN_DB) / 20.0).toFloat()
    }

    /** What the player plays at, and what the booster adds on top of it. */
    data class Level(val volume: Float, val boost: Float)

    /** The person's level times the song's gain. Up to full volume it is all
     *  the player's volume; past it (a quiet song, the slider high) the
     *  player stays at 1 and the booster adds the rest, when there is one.
     *  With none, it stops at full volume. The server holds every boost under
     *  the song's true peak, so the boost never clips. */
    fun level(user: Float, gain: Float, canBoost: Boolean = false): Level {
        val total = (user * gain).coerceAtLeast(0f)
        if (total <= 1f || !canBoost) return Level(total.coerceIn(0f, 1f), 1f)
        return Level(1f, total.coerceAtMost(10.0.pow(MAX_GAIN_DB / 20.0).toFloat()))
    }

    /** Where a fade from [from] to [to] is after [elapsed] of [duration] ms:
     *  even in dB, what the ear hears as even. */
    fun rampAt(from: Float, to: Float, elapsed: Long, duration: Long): Float {
        if (duration <= 0 || elapsed >= duration) return to
        if (elapsed <= 0) return from
        val t = elapsed.toDouble() / duration
        if (from <= 0f || to <= 0f) return (from + (to - from) * t).toFloat()
        val db = 20 * log10(from.toDouble()) + (20 * log10(to.toDouble()) - 20 * log10(from.toDouble())) * t
        return 10.0.pow(db / 20).toFloat()
    }

    private val MEASURABLE = Regex("^youtube:[A-Za-z0-9_-]{11}$")

    /** Only YouTube songs are measured (they are the ones on the server's disk). */
    fun measurable(id: String): Boolean = MEASURABLE.matches(id)
}

/** Lifts the music past full volume: [setBoost] takes a linear multiplier,
 *  1 (or less) meaning off. */
interface Booster {
    fun setBoost(linear: Float)
    fun release()
}

/** Measured gains by track id. A gain never changes, so a found one is kept
 *  for good, on disk too, so a downloaded song played offline is still
 *  normalized. "Not measured yet" is never kept: the server may have
 *  measured it by the next time. Thread-safe: filled off the main thread.
 *
 *  Kept under [KEY] ("gains.v2"): the gains kept under "gains" by 0.7.12 and
 *  0.7.13 were for the old -14 LUFS target, 4 to 8 dB too quiet, and are
 *  dropped so every song is asked again. */
class GainStore(private val prefs: SharedPreferences?) {
    companion object {
        const val KEY = "gains.v2"
        val OLD_KEYS = listOf("gains")
        const val MAX_ENTRIES = 2000
    }

    private val gains = ConcurrentHashMap<String, Double>()

    init {
        runCatching {
            if (prefs != null && OLD_KEYS.any { prefs.contains(it) }) {
                prefs.edit().apply { OLD_KEYS.forEach { remove(it) } }.apply()
            }
            val json = JSONObject(prefs?.getString(KEY, null) ?: "{}")
            json.keys().forEach { k -> json.optDouble(k).takeIf { !it.isNaN() }?.let { gains[k] = it } }
        }
    }

    fun get(id: String): Double? = gains[id]

    @Synchronized fun put(id: String, db: Double) {
        if (db.isNaN() || db.isInfinite()) return
        gains[id] = db
        // No order kept: when full, drop any one. A dropped gain is asked again.
        while (gains.size > MAX_ENTRIES) gains.keys.firstOrNull { it != id }?.let { gains.remove(it) } ?: break
        prefs?.edit()?.putString(KEY, JSONObject(gains as Map<*, *>).toString())?.apply()
    }
}

/** Keeps the player's volume (and the [booster], for a boost past full
 *  volume) at the person's level times the playing song's gain. [fetch] asks
 *  the server (null: not measured, or unreachable); it runs on [io], and its
 *  answer is applied on [main]. Main thread only otherwise, like the player.
 *
 *  A new song gets its gain at once, at the transition. A gain that changes
 *  while a song plays (it arrived after the song started, or the setting was
 *  switched) fades over [Loudness.RAMP_MS], stepped with [delay]; not
 *  playing, or without a [delay] (tests that do not care), it changes at
 *  once.
 *
 *  The player's own volume is only ever written here (and by the prank
 *  overlay, which treats a write from here as the new level to duck). The
 *  person's level arrives through [LevelPlayer], so the slider never wipes
 *  the song's gain, and a song change never wipes the slider. */
class Normalizer(
    private val player: Player,
    private val store: GainStore,
    private val fetch: (String) -> Double?,
    private val io: Executor,
    private val main: Executor,
    private val booster: Booster? = null,
    private val delay: ((Long, Runnable) -> Unit)? = null,
    private val now: () -> Long = { System.nanoTime() / 1_000_000 },
) : Player.Listener {
    var userLevel: Float = player.volume
        private set
    var enabled: Boolean = true
        private set
    private val asking = ConcurrentHashMap.newKeySet<String>()

    /** The gain being played right now (mid-fade: where the fade has got to). */
    var shownGain: Float = 1f
        private set
    private var rampFrom = 1f
    private var rampTo = 1f
    private var rampStart = 0L
    private var rampRun = 0
    private var lastBoost = 1f

    init {
        player.addListener(this)
    }

    fun setUserLevel(v: Float) {
        userLevel = v.coerceIn(0f, 1f)
        write()
    }

    fun setEnabled(on: Boolean) {
        enabled = on
        apply(if (player.isPlaying) Loudness.RAMP_MS else 0)
        if (on) prefetch()
    }

    /** The gain for the playing song, 1 when off or not known. */
    fun currentGain(): Float {
        if (!enabled) return 1f
        val id = player.currentMediaItem?.mediaId ?: return 1f
        return Loudness.dbToLinear(store.get(id))
    }

    /** Head for the playing song's gain: at once, or fading over [rampMs]. */
    private fun apply(rampMs: Long) {
        val target = currentGain()
        val d = delay
        if (rampMs <= 0 || d == null || target == shownGain) {
            rampRun++
            rampTo = target
            shownGain = target
            write()
            return
        }
        if (target == rampTo && shownGain != rampTo) return // already fading there
        val run = ++rampRun
        rampFrom = shownGain
        rampTo = target
        rampStart = now()
        fun step() {
            if (run != rampRun) return
            shownGain = Loudness.rampAt(rampFrom, rampTo, now() - rampStart, rampMs)
            write()
            if (shownGain != rampTo) d(Loudness.RAMP_STEP_MS, Runnable { step() })
        }
        d(Loudness.RAMP_STEP_MS, Runnable { step() })
    }

    private fun write() {
        val l = Loudness.level(userLevel, shownGain, booster != null)
        if (player.volume != l.volume) player.volume = l.volume
        if (l.boost != lastBoost) {
            lastBoost = l.boost
            booster?.setBoost(l.boost)
        }
    }

    /** Stops any fade and stops following the player (the service is going). */
    fun release() {
        rampRun++
        player.removeListener(this)
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        apply(0)
        prefetch()
    }

    override fun onTimelineChanged(timeline: Timeline, reason: Int) {
        if (reason == Player.TIMELINE_CHANGE_REASON_PLAYLIST_CHANGED) prefetch()
    }

    /** The playing song and the next one, so the next song's level is known
     *  before it starts. */
    private fun prefetch() {
        if (!enabled) return
        val i = player.currentMediaItemIndex
        if (i < 0 || i >= player.mediaItemCount) return
        val ids = listOfNotNull(
            player.getMediaItemAt(i).mediaId,
            player.nextMediaItemIndex.takeIf { it >= 0 && it < player.mediaItemCount }?.let { player.getMediaItemAt(it).mediaId },
        )
        for (id in ids) {
            if (!Loudness.measurable(id) || store.get(id) != null || !asking.add(id)) continue
            io.execute {
                val db = runCatching { fetch(id) }.onFailure { Log.w(EmberPlaybackService.TAG, "gain $id: ${it.message}") }.getOrNull()
                if (db != null) store.put(id, db)
                asking.remove(id)
                // Arrived while this song plays: fade to it, never a jump.
                // (Not playing yet, nothing is heard: at once.)
                if (db != null) main.execute { if (player.currentMediaItem?.mediaId == id) apply(if (player.isPlaying) Loudness.RAMP_MS else 0) }
            }
        }
    }
}

/** The player the session (and so the app, the notification and the car)
 *  sees. Its volume is the person's level; the player underneath plays at
 *  that times the song's gain (Normalizer). */
class LevelPlayer(
    player: Player,
    private val normalizer: Normalizer,
    /** Shuffle from a controller (the car, a head unit over Bluetooth): the
     *  service reorders the queue instead (QueueShuffle). Null: as is. */
    private val onShuffle: ((Boolean) -> Unit)? = null,
) : ForwardingPlayer(player) {
    override fun setVolume(volume: Float) = normalizer.setUserLevel(volume)
    override fun getVolume(): Float = normalizer.userLevel
    override fun setShuffleModeEnabled(shuffleModeEnabled: Boolean) {
        val fn = onShuffle
        if (fn != null) fn(shuffleModeEnabled) else super.setShuffleModeEnabled(shuffleModeEnabled)
    }
}
