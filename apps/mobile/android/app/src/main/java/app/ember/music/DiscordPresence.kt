package app.ember.music

import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.Player

/** The SDK, as DiscordPresence sees it. NativeDiscordEngine is the real one. */
interface DiscordEngine {
    fun status(): DiscordStatus
    /** [done] runs on the main thread, at most once, unless a later update
     *  overtook this one. [permanent]: there is no use trying again. */
    fun update(token: Long, activity: PresenceActivity, done: (ok: Boolean, error: String?, permanent: Boolean) -> Unit)
    fun clear()
    /** Whether Client::RunCallbacks should run. Off is when nothing is on its
     *  way to or from Discord, so an idle phone wakes for nothing. */
    fun setPumping(on: Boolean)
}

/** Discord's card for this phone, driven by the player service.
 *
 *  Not by the page: Chromium freezes a hidden page after about five minutes
 *  (PageStateGate), Android can throw it away while the music plays
 *  (RendererGone), and in the car there may never have been one. A song change
 *  or a pause from the lock screen, a headset or a car only ever reaches here.
 *
 *  Call [refresh] on any change; it reads what is true now through [current]
 *  and works out the rest. Main thread only.
 *
 *  A phone without Discord, or signed out of it, is the normal case and costs
 *  a look every few minutes while music plays, one log line, and nothing the
 *  person can see. Someone with the switch off never even loads the SDK. */
class DiscordPresence(
    private val engine: DiscordEngine,
    private val sharing: () -> Boolean,
    /** What is playing now, or null for nothing to show (paused, empty). */
    private val current: () -> PresenceCard?,
    private val now: () -> Long = System::currentTimeMillis,
    private val later: (Long, () -> Unit) -> (() -> Unit),
    /** One line, about a change of state, never per update. */
    private val log: (level: String, message: String) -> Unit,
    private val trace: (String) -> Unit = {},
) {
    companion object {
        /** An update Discord never answered counts as failed after this. */
        const val ANSWER_TIMEOUT_MS = 30_000L
    }

    private val throttle = PresenceThrottle()
    private val backoff = PresenceBackoff()
    private var flushTimer: (() -> Unit)? = null
    private var retryTimer: (() -> Unit)? = null
    private var answerTimer: (() -> Unit)? = null
    private var token = 0L
    /** The update whose answer is awaited; 0 for none. */
    private var awaited = 0L
    private var off = false
    private var released = false
    /** What was last logged about reaching Discord; null when all is well. */
    private var said: String? = null

    /** Something changed: the song, playing or not, the playhead, the switch. */
    fun refresh() {
        if (released || off) return
        val card = if (sharing()) current() else null
        if (card != null) {
            when (val status = engine.status()) {
                is DiscordStatus.Off -> {
                    off = true
                    say("off", "info", "discord: presence off: ${status.why}")
                    return
                }
                is DiscordStatus.Waiting -> {
                    say("waiting", "info", "discord: ${status.why}")
                    return
                }
                DiscordStatus.Ready -> {}
            }
        } else {
            cancelRetry()
        }
        act(throttle.offer(card, now()))
    }

    /** Something outside may have changed what Discord can do (the app opened:
     *  Discord may have been installed meanwhile): do not sit out the backoff. */
    fun retryNow() {
        backoff.reset()
        cancelRetry()
        refresh()
    }

    /** The service is going away: the card must not outlive the music. */
    fun release() {
        if (released) return
        if (!off) act(throttle.offer(null, now()))
        released = true
        cancelRetry()
        flushTimer?.invoke(); flushTimer = null
        answerTimer?.invoke(); answerTimer = null
    }

    private fun act(decision: PresenceThrottle.Decision) {
        when (decision) {
            is PresenceThrottle.Decision.Send -> send(decision.card)
            PresenceThrottle.Decision.Clear -> {
                trace("cleared")
                awaited = 0
                answerTimer?.invoke(); answerTimer = null
                engine.clear()
                engine.setPumping(false)
            }
            is PresenceThrottle.Decision.Wait -> {
                trace("queued ${decision.ms} ms: ${throttle.pending?.key}")
                armFlush(decision.ms)
            }
            PresenceThrottle.Decision.Nothing -> {}
        }
    }

    private fun armFlush(ms: Long) {
        if (flushTimer != null) return
        flushTimer = later(ms) {
            flushTimer = null
            if (!released) act(throttle.flush(now()))
        }
    }

    private fun send(card: PresenceCard) {
        cancelRetry()
        answerTimer?.invoke()
        val id = ++token
        awaited = id
        trace("send ${card.key} at ${card.positionSec}/${card.durationSec}")
        engine.setPumping(true)
        answerTimer = later(ANSWER_TIMEOUT_MS) {
            answerTimer = null
            answered(id, false, "no answer", false)
        }
        engine.update(id, DiscordRules.activity(card)) { ok, error, permanent -> answered(id, ok, error, permanent) }
    }

    private fun answered(id: Long, ok: Boolean, error: String?, permanent: Boolean) {
        if (released || id != awaited) return
        awaited = 0
        answerTimer?.invoke(); answerTimer = null
        if (ok) {
            trace("sent")
            backoff.reset()
            if (said != null) {
                said = null
                log("info", "discord: reachable")
            }
            return
        }
        throttle.failed()
        engine.setPumping(false)
        if (permanent) {
            off = true
            say("off", "warn", "discord: presence off: ${error.orEmpty()}")
            return
        }
        say("down", "info", "discord: cannot reach Discord, trying again quietly: ${error.orEmpty()}")
        val wait = backoff.failed()
        trace("failed, next look in $wait ms: $error")
        cancelRetry()
        retryTimer = later(wait) {
            retryTimer = null
            refresh()
        }
    }

    private fun cancelRetry() {
        retryTimer?.invoke()
        retryTimer = null
    }

    /** Once per way of being down, however the error's text changes. */
    private fun say(kind: String, level: String, message: String) {
        if (said == kind) return
        said = kind
        log(level, message)
    }
}

/** What a player's state means for the card. The cover comes from the track's
 *  own JSON: the item's artwork URI may be the content:// one made for the car,
 *  which Discord cannot fetch. */
internal fun discordCardOf(player: Player, baseUrl: String, nowMs: Long): PresenceCard? {
    val item = player.currentMediaItem
    if (!DiscordRules.shows(true, UpdateRules.meansPlaying(player.playWhenReady, player.playbackState), item != null)) return null
    val meta = item!!.mediaMetadata
    val track = TrackItems.trackOf(item)
    val rawArt = track?.takeIf { !it.isNull("artworkUrl") }?.optString("artworkUrl") ?: meta.artworkUri?.toString()
    val live = TrackItems.isLive(track)
    val playerMs = player.duration.takeIf { it != C.TIME_UNSET } ?: 0
    return DiscordRules.card(
        title = meta.title?.toString(),
        artist = meta.artist?.toString(),
        album = meta.albumTitle?.toString(),
        artworkUrl = DiscordRules.artwork(rawArt, baseUrl),
        positionMs = player.currentPosition,
        // A live station has no length, whatever a stream claims.
        durationMs = if (live) 0 else DiscordRules.duration(playerMs, meta.durationMs),
        nowMs = nowMs,
    )
}

/** Writes both to logcat and, through NativeLog, to the web logger and so a
 *  bug report. */
internal fun discordLog(level: String, message: String) {
    if (level == "warn") Log.w(NativeDiscordEngine.TAG, message) else Log.i(NativeDiscordEngine.TAG, message)
    NativeLog.emit(level, "service", message)
}
