package app.ember.music

import kotlin.math.abs
import kotlin.math.roundToLong

/** One "now playing" snapshot, ready to become a card. [receivedMs]: when it
 *  was read from the player. The playhead is true AT that moment, and it can
 *  wait out the rate limit before it goes out. */
data class PresenceCard(
    val title: String,
    val artist: String,
    val album: String?,
    val artworkUrl: String?,
    val positionSec: Double,
    val durationSec: Double,
    val receivedMs: Long,
) {
    val key: String get() = "$title|$artist"
}

/** What the Discord SDK is handed for a card. */
data class PresenceActivity(
    val details: String,
    val state: String?,
    val largeText: String,
    val largeImage: String?,
    val startMs: Long,
    val endMs: Long?,
)

/** Whether presence can work now. */
sealed class DiscordStatus {
    object Ready : DiscordStatus()
    /** Not now, maybe later: asked again on the next change. */
    data class Waiting(val why: String) : DiscordStatus()
    /** Never in this run: nothing is tried again. */
    data class Off(val why: String) : DiscordStatus()
}

/** The Discord card's decisions, kept apart from the SDK and the player so
 *  they can be tested. The card itself matches the desktop app's
 *  (apps/desktop/src-tauri/src/discord.rs); differences are noted where they
 *  are. */
object DiscordRules {
    /** Discord rejects presence updates faster than ~1 per 15 s. */
    const val RATE_LIMIT_MS = 15_000L
    /** Discord refuses the WHOLE activity when a text is under 2 characters
     *  (a song called "7", an empty album) or the image is over 256. */
    const val MIN_TEXT = 2
    const val MAX_TEXT = 128
    const val MAX_IMAGE = 256
    /** The Social SDK's platform table says Android 7.0+; the app runs from 6. */
    const val MIN_ANDROID_SDK = 24
    /** A card this close to the one Discord has is the same card: buffering
     *  and resuming would otherwise each send one. */
    const val SAME_CARD_MS = 2_000L
    private const val BLANK = '⠀'

    fun appId(raw: String?): Long? =
        raw?.trim()?.toULongOrNull()?.takeIf { it != 0uL }?.toLong()

    fun status(sdkPresent: Boolean, androidSdk: Int, appId: Long?, canAttach: Boolean): DiscordStatus = when {
        !sdkPresent -> DiscordStatus.Off("this build has no Discord SDK")
        androidSdk < MIN_ANDROID_SDK -> DiscordStatus.Off("needs Android 7, this is API $androidSdk")
        appId == null -> DiscordStatus.Off("this build has no Discord app id")
        // The SDK's docs have the app's activity handed over before anything
        // else. A service started by the car or a media key has none yet.
        !canAttach -> DiscordStatus.Waiting("waiting for Ember to open once")
        else -> DiscordStatus.Ready
    }

    /** Cut to [max] characters (not UTF-16 units: an emoji is one), then
     *  padded to Discord's minimum with a braille blank, which Discord does
     *  not trim away as it does whitespace. */
    fun text(s: String, max: Int = MAX_TEXT): String {
        val count = s.codePointCount(0, s.length)
        val cut = if (count <= max) s else s.substring(0, s.offsetByCodePoints(0, max - 1)) + "…"
        val have = cut.codePointCount(0, cut.length)
        return if (have >= MIN_TEXT) cut else cut + BLANK.toString().repeat(MIN_TEXT - have)
    }

    /** The artwork URL when Discord takes it; none (no image) otherwise. */
    fun image(url: String?): String? =
        url?.takeIf { it.isNotEmpty() && it.codePointCount(0, it.length) <= MAX_IMAGE }

    /** The cover Discord may be given. Discord fetches it itself, so it must
     *  be a public address, and everyone who sees the card sees the address: a
     *  cover on the Ember server (an upload's, relative or not) needs a
     *  cookie Discord does not have and would publish where the server is. */
    fun artwork(raw: String?, baseUrl: String): String? {
        val url = raw?.trim().orEmpty()
        if (!url.startsWith("https://") && !url.startsWith("http://")) return null
        if (baseUrl.isNotEmpty() && url.startsWith(baseUrl.trimEnd('/') + "/")) return null
        return image(url)
    }

    /** The card for what the player says, in its own numbers. Unknown or
     *  negative numbers (C.TIME_UNSET) read as 0. */
    fun card(
        title: String?,
        artist: String?,
        album: String?,
        artworkUrl: String?,
        positionMs: Long,
        durationMs: Long,
        nowMs: Long,
    ): PresenceCard = PresenceCard(
        title = title.orEmpty(),
        artist = artist.orEmpty(),
        album = album,
        artworkUrl = artworkUrl,
        positionSec = positionMs.coerceAtLeast(0) / 1000.0,
        durationSec = durationMs.coerceAtLeast(0) / 1000.0,
        receivedMs = nowMs,
    )

    /** The player's length when it knows it, else the catalog's. */
    fun duration(playerMs: Long, catalogMs: Long?): Long = when {
        playerMs > 0 -> playerMs
        catalogMs != null && catalogMs > 0 -> catalogMs
        else -> 0
    }

    /** A card shows only while music is meant to play, with something to
     *  show, for someone who allows it. */
    fun shows(sharing: Boolean, meansPlaying: Boolean, hasTrack: Boolean): Boolean =
        sharing && meansPlaying && hasTrack

    /** The time bar is drawn from wall-clock timestamps, so "start" is when
     *  the song would have begun for the playhead to be where it is. Taken
     *  from when the card was RECEIVED, not when it is sent, or a queued one
     *  lags by however long it waited. Whole seconds like the desktop's, in
     *  the milliseconds the SDK's header asks for. */
    fun timestamps(card: PresenceCard): Pair<Long, Long?> {
        val started = card.receivedMs / 1000 - card.positionSec.roundToLong()
        val end = if (card.durationSec > 0) started + card.durationSec.roundToLong() else null
        return Pair(started * 1000, end?.let { it * 1000 })
    }

    fun activity(card: PresenceCard): PresenceActivity {
        val (start, end) = timestamps(card)
        return PresenceActivity(
            details = text(card.title),
            state = if (card.artist.isEmpty()) null else text("by ${card.artist}"),
            largeText = text(card.album?.takeIf { it.isNotEmpty() } ?: card.title),
            largeImage = image(card.artworkUrl),
            startMs = start,
            endMs = end,
        )
    }

    /** Whether Discord already shows this, near enough. */
    fun sameCard(a: PresenceActivity, b: PresenceActivity): Boolean {
        val ends = when {
            a.endMs == null || b.endMs == null -> a.endMs == b.endMs
            else -> abs(a.endMs - b.endMs) <= SAME_CARD_MS
        }
        return a.details == b.details && a.state == b.state && a.largeText == b.largeText &&
            a.largeImage == b.largeImage && ends && abs(a.startMs - b.startMs) <= SAME_CARD_MS
    }

    data class Result(val token: Long, val ok: Boolean, val error: String?)

    /** One line from the JNI shim: token, 1 or 0, the error. */
    fun parseResult(line: String): Result? {
        val parts = line.split('\t', limit = 3)
        val token = parts.getOrNull(0)?.toLongOrNull() ?: return null
        val ok = parts.getOrNull(1) == "1"
        return Result(token, ok, if (ok) null else parts.getOrNull(2).orEmpty())
    }
}

/** Newest update wins, seeks are not dropped. Repeats of the SAME song (seeks,
 *  resumes) wait out the rate limit and only the newest is kept; a song change
 *  always goes through and makes a waiting seek obsolete, and nothing playing
 *  clears the card at once. As discord.rs does it. Main thread only. */
class PresenceThrottle {
    sealed class Decision {
        data class Send(val card: PresenceCard) : Decision()
        object Clear : Decision()
        /** Kept for later: look again (flush) after this long. */
        data class Wait(val ms: Long) : Decision()
        object Nothing : Decision()
    }

    private var lastSendMs = Long.MIN_VALUE / 2
    private var lastKey: String? = null
    private var shown: PresenceActivity? = null
    var pending: PresenceCard? = null
        private set

    fun offer(card: PresenceCard?, nowMs: Long): Decision {
        if (card == null) {
            pending = null
            shown = null
            // A resume is news: it goes out at once, like a new song.
            return if (lastKey != null) Decision.Clear.also { lastKey = null } else Decision.Nothing
        }
        val sameSong = card.key == lastKey
        // Back where Discord already is (a seek away and back, a resume after
        // buffering): whatever waited is moot.
        if (sameSong && shown?.let { DiscordRules.sameCard(it, DiscordRules.activity(card)) } == true) {
            pending = null
            return Decision.Nothing
        }
        val since = nowMs - lastSendMs
        if (sameSong && since < DiscordRules.RATE_LIMIT_MS) {
            pending = card
            return Decision.Wait(DiscordRules.RATE_LIMIT_MS - since)
        }
        pending = null
        return Decision.Send(sent(card, nowMs))
    }

    /** The flush timer woke up. The window counts from the LAST send, not from
     *  when the timer was set: a song change goes out in between, and a seek
     *  in the new song queued behind that timer must not follow it inside the
     *  window Discord drops updates in. */
    fun flush(nowMs: Long): Decision {
        val card = pending ?: return Decision.Nothing
        val since = nowMs - lastSendMs
        if (since < DiscordRules.RATE_LIMIT_MS) return Decision.Wait(DiscordRules.RATE_LIMIT_MS - since)
        pending = null
        return Decision.Send(sent(card, nowMs))
    }

    /** Discord did not take the last card: it is not showing. The window
     *  stands, whether or not Discord took it, so the throttle stays honest. */
    fun failed() {
        shown = null
    }

    private fun sent(card: PresenceCard, nowMs: Long): PresenceCard {
        lastKey = card.key
        lastSendMs = nowMs
        shown = DiscordRules.activity(card)
        return card
    }
}

/** How long to leave Discord alone after it could not be reached: long enough
 *  never to be a busy loop for a phone without Discord, short enough that a
 *  Discord that was only starting shows up soon. */
class PresenceBackoff(private val firstMs: Long = FIRST_MS, private val maxMs: Long = MAX_MS) {
    companion object {
        const val FIRST_MS = 30_000L
        const val MAX_MS = 5 * 60_000L
    }

    private var nextMs = firstMs

    fun failed(): Long {
        val wait = nextMs
        nextMs = (nextMs * 2).coerceAtMost(maxMs)
        return wait
    }

    fun reset() {
        nextMs = firstMs
    }
}
