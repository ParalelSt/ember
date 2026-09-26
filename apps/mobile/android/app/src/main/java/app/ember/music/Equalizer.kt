package app.ember.music

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** The equalizer on the phone, the native twin of the web one
 *  (apps/web/lib/playback/eq.ts) and the desktop one (src-tauri/src/eq.rs).
 *
 *  Five bands, the same everywhere: a low shelf at 60 Hz, peaking bands at
 *  230 Hz, 910 Hz and 3.6 kHz, a high shelf at 14 kHz, each -12..+12 dB, as
 *  Audio EQ Cookbook biquads (what Web Audio's BiquadFilterNode runs). A
 *  custom AudioProcessor in the player's audio sink rather than
 *  android.media.audiofx.Equalizer: the bands are then exactly these on every
 *  phone (the system one's bands differ per device), and it works the same
 *  in the car and with the screen off, where the web app is not running.
 *
 *  An automatic pre-amp in front of the filters takes the loudest point of
 *  the curve back to 0 dB, so a boost never clips. */
object Eq {
    val BANDS_HZ = doubleArrayOf(60.0, 230.0, 910.0, 3600.0, 14000.0)
    const val MAX_DB = 12f
    const val PEAK_Q = 1.0

    /** Transposed direct form II coefficients, normalized so a0 = 1. */
    data class Biquad(val b0: Double, val b1: Double, val b2: Double, val a1: Double, val a2: Double) {
        /** This section's gain at [f] Hz, in dB. */
        fun magnitudeDb(fs: Double, f: Double): Double {
            val w = 2 * PI * f / fs
            val nr = b0 + b1 * cos(w) + b2 * cos(2 * w)
            val ni = -(b1 * sin(w) + b2 * sin(2 * w))
            val dr = 1 + a1 * cos(w) + a2 * cos(2 * w)
            val di = -(a1 * sin(w) + a2 * sin(2 * w))
            return 10 * log10((nr * nr + ni * ni) / (dr * dr + di * di))
        }
    }

    val IDENTITY = Biquad(1.0, 0.0, 0.0, 0.0, 0.0)

    private fun norm(b0: Double, b1: Double, b2: Double, a0: Double, a1: Double, a2: Double) =
        Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)

    /** Kept under Nyquist: a 14 kHz shelf on a 22.05 kHz stream folds over. */
    private fun omega(fs: Double, f0: Double) = 2 * PI * min(f0, fs * 0.45) / fs

    fun peaking(fs: Double, f0: Double, q: Double, db: Double): Biquad {
        if (db == 0.0) return IDENTITY
        val a = 10.0.pow(db / 40)
        val w = omega(fs, f0)
        val alpha = sin(w) / (2 * q)
        val c = cos(w)
        return norm(1 + alpha * a, -2 * c, 1 - alpha * a, 1 + alpha / a, -2 * c, 1 - alpha / a)
    }

    /** Shelf slope S = 1, as Web Audio's lowshelf. */
    fun lowShelf(fs: Double, f0: Double, db: Double): Biquad {
        if (db == 0.0) return IDENTITY
        val a = 10.0.pow(db / 40)
        val w = omega(fs, f0)
        val c = cos(w)
        val k = 2 * sqrt(a) * (sin(w) / sqrt(2.0))
        return norm(
            a * ((a + 1) - (a - 1) * c + k),
            2 * a * ((a - 1) - (a + 1) * c),
            a * ((a + 1) - (a - 1) * c - k),
            (a + 1) + (a - 1) * c + k,
            -2 * ((a - 1) + (a + 1) * c),
            (a + 1) + (a - 1) * c - k,
        )
    }

    /** Shelf slope S = 1, as Web Audio's highshelf. */
    fun highShelf(fs: Double, f0: Double, db: Double): Biquad {
        if (db == 0.0) return IDENTITY
        val a = 10.0.pow(db / 40)
        val w = omega(fs, f0)
        val c = cos(w)
        val k = 2 * sqrt(a) * (sin(w) / sqrt(2.0))
        return norm(
            a * ((a + 1) + (a - 1) * c + k),
            -2 * a * ((a - 1) + (a + 1) * c),
            a * ((a + 1) + (a - 1) * c - k),
            (a + 1) - (a - 1) * c + k,
            2 * ((a - 1) - (a + 1) * c),
            (a + 1) - (a - 1) * c - k,
        )
    }

    fun design(fs: Double, bands: FloatArray): List<Biquad> = listOf(
        lowShelf(fs, BANDS_HZ[0], bands[0].toDouble()),
        peaking(fs, BANDS_HZ[1], PEAK_Q, bands[1].toDouble()),
        peaking(fs, BANDS_HZ[2], PEAK_Q, bands[2].toDouble()),
        peaking(fs, BANDS_HZ[3], PEAK_Q, bands[3].toDouble()),
        highShelf(fs, BANDS_HZ[4], bands[4].toDouble()),
    )

    fun responseDb(sections: List<Biquad>, fs: Double, f: Double) = sections.sumOf { it.magnitudeDb(fs, f) }

    /** The pre-amp that brings the curve's loudest point (20 Hz to 20 kHz,
     *  or to just under Nyquist) back to 0 dB: 0 or less, never a boost. */
    fun autoPreampDb(sections: List<Biquad>, fs: Double): Double {
        val lo = 20.0
        val hi = min(20_000.0, fs * 0.49)
        val points = 240
        var peak = Double.NEGATIVE_INFINITY
        for (i in 0 until points) peak = max(peak, responseDb(sections, fs, lo * (hi / lo).pow(i.toDouble() / (points - 1))))
        for (f in BANDS_HZ) if (f < hi) peak = max(peak, responseDb(sections, fs, f))
        return -max(0.0, peak) + 0.0
    }
}

/** What the listener chose: on or off and five gains in dB. */
data class EqSettings(val enabled: Boolean, val bands: FloatArray) {
    val active: Boolean get() = enabled && bands.any { it != 0f }

    override fun equals(other: Any?) = other is EqSettings && other.enabled == enabled && other.bands.contentEquals(bands)
    override fun hashCode() = 31 * enabled.hashCode() + bands.contentHashCode()

    companion object {
        val OFF = EqSettings(false, FloatArray(5))
        private const val PREFS = "ember.equalizer"

        /** From the web app, made safe: missing bands are 0, extra ones
         *  dropped, anything not a number is 0, each held to -12..+12 dB. */
        fun of(enabled: Boolean, bands: List<Double>?): EqSettings {
            val out = FloatArray(5)
            bands?.take(5)?.forEachIndexed { i, b ->
                out[i] = if (b.isNaN() || b.isInfinite()) 0f else b.toFloat().coerceIn(-Eq.MAX_DB, Eq.MAX_DB)
            }
            return EqSettings(enabled, out)
        }

        fun toBundle(s: EqSettings) = Bundle().apply {
            putBoolean("enabled", s.enabled)
            putFloatArray("bands", s.bands)
        }

        fun fromBundle(b: Bundle) = of(b.getBoolean("enabled", false), b.getFloatArray("bands")?.map { it.toDouble() })

        fun load(prefs: SharedPreferences): EqSettings {
            val bands = prefs.getString("bands", null)?.split(',')?.mapNotNull { it.toDoubleOrNull() }
            return of(prefs.getBoolean("enabled", false), bands)
        }

        fun save(prefs: SharedPreferences, s: EqSettings) {
            prefs.edit().putBoolean("enabled", s.enabled).putString("bands", s.bands.joinToString(",")).apply()
        }

        fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }
}

/** The five filters over interleaved samples, one set of memories per
 *  channel. Plain Kotlin, so the JVM tests run it on generated signals. */
class EqFilterBank(private val sampleRate: Int, private val channels: Int) {
    private var sections: List<Eq.Biquad> = List(5) { Eq.IDENTITY }
    private var preamp = 1.0
    private val z1 = Array(channels) { DoubleArray(5) }
    private val z2 = Array(channels) { DoubleArray(5) }

    fun set(bands: FloatArray) {
        val fs = sampleRate.toDouble()
        sections = Eq.design(fs, bands)
        preamp = 10.0.pow(Eq.autoPreampDb(sections, fs) / 20)
    }

    fun reset() {
        for (c in 0 until channels) {
            z1[c].fill(0.0)
            z2[c].fill(0.0)
        }
    }

    /** One sample of channel [ch]. */
    fun process(ch: Int, x: Double): Double {
        var y = x * preamp
        val m1 = z1[ch]
        val m2 = z2[ch]
        for (i in sections.indices) {
            val s = sections[i]
            val out = s.b0 * y + m1[i]
            m1[i] = s.b1 * y - s.a1 * out + m2[i]
            m2[i] = s.b2 * y - s.a2 * out
            y = out
        }
        return y
    }

    /** Interleaved frames, in place. */
    fun process(samples: FloatArray) {
        for (i in samples.indices) samples[i] = process(i % channels, samples[i].toDouble()).toFloat()
    }
}

/** The equalizer in the player's audio sink. Settings arrive from the main
 *  thread (the web app, or the saved ones at start) and are picked up by the
 *  playback thread on its next buffer. 16-bit and float PCM are filtered;
 *  anything else passes by untouched. Off or flat, the bytes are copied
 *  through as they are. */
class EqualizerProcessor : BaseAudioProcessor() {
    @Volatile var settings: EqSettings = EqSettings.OFF

    private var bank: EqFilterBank? = null
    private var applied: EqSettings? = null

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
            return AudioProcessor.AudioFormat.NOT_SET
        }
        return inputAudioFormat
    }

    override fun onFlush() {
        // A new format, or a seek: the memories are of audio no longer next.
        val fmt = inputAudioFormat
        bank = if (fmt.sampleRate > 0 && fmt.channelCount > 0) EqFilterBank(fmt.sampleRate, fmt.channelCount) else null
        applied = null
    }

    override fun onReset() {
        bank = null
        applied = null
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val size = inputBuffer.remaining()
        if (size == 0) return
        val out = replaceOutputBuffer(size)
        val s = settings
        val b = bank
        if (!s.active || b == null) {
            // Switched back on later, it starts from clean memories.
            applied = null
            out.put(inputBuffer)
            out.flip()
            return
        }
        if (s != applied) {
            // Stale memories from before it was switched on would click.
            if (applied == null) b.reset()
            b.set(s.bands)
            applied = s
        }
        val channels = inputAudioFormat.channelCount
        val order = inputBuffer.order()
        inputBuffer.order(ByteOrder.nativeOrder())
        if (inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT) {
            var i = 0
            while (inputBuffer.remaining() >= 4) {
                out.putFloat(b.process(i % channels, inputBuffer.float.toDouble()).toFloat())
                i++
            }
        } else {
            var i = 0
            while (inputBuffer.remaining() >= 2) {
                val y = b.process(i % channels, inputBuffer.short.toDouble())
                out.putShort(y.roundToInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort())
                i++
            }
        }
        inputBuffer.order(order)
        out.flip()
    }

    companion object {
        /** A renderers factory whose audio sink runs [eq]. The rest is
         *  Media3's default sink. */
        fun renderers(context: Context, eq: AudioProcessor): DefaultRenderersFactory = object : DefaultRenderersFactory(context) {
            override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioTrackPlaybackParams: Boolean): AudioSink =
                DefaultAudioSink.Builder(context)
                    .setEnableFloatOutput(enableFloatOutput)
                    .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                    .setAudioProcessors(arrayOf(eq))
                    .build()
        }
    }
}
