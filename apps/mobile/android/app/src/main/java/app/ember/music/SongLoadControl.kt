package app.ember.music

import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.LoadControl
import androidx.media3.exoplayer.upstream.DefaultAllocator

/** How far ahead the player loads: the song playing, to its end; anything
 *  after it, as far as Media3 always did (50 s).
 *
 *  Media3 keeps 50 s loaded ahead of the playhead. When the connection gave
 *  out a minute into a four-minute song, the rest of that song was simply
 *  not there, and the music stopped mid-song. Loading the playing song whole
 *  costs no extra data (it is being played), lands it in the auto cache as
 *  it goes (MediaCache's read-through), and lets it finish from memory
 *  through a dead zone. The song after it starts loading as before, so
 *  nothing more is fetched ahead than Media3 fetched already.
 *
 *  Memory stays within Media3's own limit for audio (about 13 MB): a song
 *  longer than that holds loads past it. */
class SongLoadControl : DefaultLoadControl(
    DefaultAllocator(true, C.DEFAULT_BUFFER_SEGMENT_SIZE),
    DEFAULT_MIN_BUFFER_MS,
    WHOLE_SONG_MS,
    DEFAULT_BUFFER_FOR_PLAYBACK_MS,
    DEFAULT_BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS,
    DEFAULT_TARGET_BUFFER_BYTES,
    DEFAULT_PRIORITIZE_TIME_OVER_SIZE_THRESHOLDS,
    DEFAULT_BACK_BUFFER_DURATION_MS,
    DEFAULT_RETAIN_BACK_BUFFER_FROM_KEYFRAME,
) {
    companion object {
        /** Ahead of the playhead, at most, while loading the playing song. */
        const val WHOLE_SONG_MS = 20 * 60_000
        /** Ahead of the playhead, at most, once loading the songs after it. */
        const val AHEAD_MS = DEFAULT_MAX_BUFFER_MS
    }

    /** The playing song's period (its uid in the player's timeline), kept by
     *  [follow] from the main thread; read on the player's own thread. */
    @Volatile var playingPeriod: Any? = null

    override fun shouldContinueLoading(parameters: LoadControl.Parameters): Boolean {
        val loadingPlaying = playingPeriod != null && parameters.mediaPeriodId.periodUid == playingPeriod
        if (!loadingPlaying && parameters.bufferedDurationUs >= AHEAD_MS * 1_000L) return false
        return super.shouldContinueLoading(parameters)
    }

    /** Keeps [playingPeriod] up with [player]. */
    fun follow(player: Player): Player.Listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            val timeline = player.currentTimeline
            val index = player.currentPeriodIndex
            playingPeriod = if (timeline.isEmpty || index == C.INDEX_UNSET || index >= timeline.periodCount) null
            else timeline.getUidOfPeriod(index)
        }
    }.also { player.addListener(it) }
}
