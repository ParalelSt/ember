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
import kotlin.math.pow

/** Volume normalization on the phone, the native twin of the web player's
 *  (apps/web/lib/playback/normalization.ts).
 *
 *  The server measures each song once and hands out a gain in dB that brings
 *  it to about -14 LUFS (GET /api/tracks/<id>/loudness). On Android the
 *  native player moves between songs by itself (the web app may not even be
 *  running, in the car), so the level has to change here, at the moment the
 *  song does. It is applied as the player's volume, which Android applies to
 *  what is heard right away: the new song starts at its own level. */
object Loudness {
    /** The bounds loudness.py clamps to, applied again here. */
    const val MIN_GAIN_DB = -12.0
    const val MAX_GAIN_DB = 6.0

    /** dB to a linear multiplier; anything not a number is 1. */
    fun dbToLinear(db: Double?): Float {
        if (db == null || db.isNaN() || db.isInfinite()) return 1f
        return 10.0.pow(db.coerceIn(MIN_GAIN_DB, MAX_GAIN_DB) / 20.0).toFloat()
    }

    /** What the player plays at: the person's level times the song's gain,
     *  never past full volume (the web player's rule outside party mode). */
    fun level(user: Float, gain: Float): Float = (user * gain).coerceIn(0f, 1f)

    private val MEASURABLE = Regex("^youtube:[A-Za-z0-9_-]{11}$")

    /** Only YouTube songs are measured (they are the ones on the server's disk). */
    fun measurable(id: String): Boolean = MEASURABLE.matches(id)
}

/** Measured gains by track id. A gain never changes, so a found one is kept
 *  for good, on disk too, so a downloaded song played offline is still
 *  normalized. "Not measured yet" is never kept: the server may have
 *  measured it by the next time. Thread-safe: filled off the main thread. */
class GainStore(private val prefs: SharedPreferences?) {
    companion object {
        const val KEY = "gains"
        const val MAX_ENTRIES = 2000
    }

    private val gains = ConcurrentHashMap<String, Double>()

    init {
        runCatching {
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

/** Keeps the player's volume at the person's level times the playing song's
 *  gain. [fetch] asks the server (null: not measured, or unreachable); it
 *  runs on [io], and its answer is applied on [main]. Main thread only
 *  otherwise, like the player.
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
) : Player.Listener {
    var userLevel: Float = player.volume
        private set
    var enabled: Boolean = true
        private set
    private val asking = ConcurrentHashMap.newKeySet<String>()

    init {
        player.addListener(this)
    }

    fun setUserLevel(v: Float) {
        userLevel = v.coerceIn(0f, 1f)
        apply()
    }

    fun setEnabled(on: Boolean) {
        enabled = on
        apply()
        if (on) prefetch()
    }

    /** The gain for the playing song, 1 when off or not known. */
    fun currentGain(): Float {
        if (!enabled) return 1f
        val id = player.currentMediaItem?.mediaId ?: return 1f
        return Loudness.dbToLinear(store.get(id))
    }

    private fun apply() {
        val v = Loudness.level(userLevel, currentGain())
        if (player.volume != v) player.volume = v
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        apply()
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
                if (db != null) main.execute { if (player.currentMediaItem?.mediaId == id) apply() }
            }
        }
    }
}

/** The player the session (and so the app, the notification and the car)
 *  sees. Its volume is the person's level; the player underneath plays at
 *  that times the song's gain (Normalizer). */
class LevelPlayer(player: Player, private val normalizer: Normalizer) : ForwardingPlayer(player) {
    override fun setVolume(volume: Float) = normalizer.setUserLevel(volume)
    override fun getVolume(): Float = normalizer.userLevel
}
