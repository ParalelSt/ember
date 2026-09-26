package app.ember.music

import android.content.Context
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.datasource.okhttp.OkHttpDataSource
import okhttp3.OkHttpClient
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The equalizer in the native player: the Audio EQ Cookbook filters (the
 * same as the web's BiquadFilterNodes and the desktop engine's), the
 * automatic pre-amp that keeps a boost from clipping, and the AudioProcessor
 * in the player's audio sink, run on generated signals.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class EqualizerTest {
    private val fs = 48_000

    private fun sine(freq: Double, secs: Double, amp: Double = 0.25) =
        DoubleArray((fs * secs).toInt()) { amp * sin(2 * PI * freq * it / fs) }

    private fun rms(x: DoubleArray) = sqrt(x.sumOf { it * it } / x.size)
    private fun db(ratio: Double) = 20 * log10(ratio)
    /** Past the first quarter second, where the filters are still settling. */
    private fun settled(x: DoubleArray) = x.copyOfRange(fs / 4, x.size)

    private fun bands(vararg b: Float) = floatArrayOf(*b)

    // ── Filter math ──────────────────────────────────────────────────

    @Test fun a_peaking_band_has_its_gain_at_its_centre_and_none_far_away() {
        for (g in listOf(-12.0, -6.0, 3.0, 12.0)) {
            val c = Eq.peaking(48_000.0, 910.0, 1.0, g)
            assertEquals(g, c.magnitudeDb(48_000.0, 910.0), 1e-6)
            assertTrue(abs(c.magnitudeDb(48_000.0, 20.0)) < 0.2)
            assertTrue(abs(c.magnitudeDb(48_000.0, 18_000.0)) < 0.2)
        }
    }

    @Test fun shelves_reach_their_gain_on_their_side_and_half_of_it_at_the_corner() {
        val low = Eq.lowShelf(48_000.0, 60.0, 12.0)
        assertEquals(12.0, low.magnitudeDb(48_000.0, 5.0), 0.2)
        assertEquals(6.0, low.magnitudeDb(48_000.0, 60.0), 0.05)
        val high = Eq.highShelf(48_000.0, 14_000.0, -9.0)
        assertEquals(-4.5, high.magnitudeDb(48_000.0, 14_000.0), 0.05)
        assertEquals(0.0, high.magnitudeDb(48_000.0, 100.0), 0.05)
    }

    @Test fun auto_preamp_cancels_the_loudest_boost_and_never_boosts() {
        val f = 48_000.0
        assertEquals(0.0, Eq.autoPreampDb(Eq.design(f, bands(0f, 0f, 0f, 0f, 0f)), f), 0.0)
        assertEquals(0.0, Eq.autoPreampDb(Eq.design(f, bands(-6f, -6f, -6f, -6f, -6f)), f), 0.0)
        assertEquals(-9.0, Eq.autoPreampDb(Eq.design(f, bands(0f, 0f, 9f, 0f, 0f)), f), 0.05)
        assertTrue(Eq.autoPreampDb(Eq.design(f, bands(12f, 12f, 0f, 0f, 0f)), f) < -12.0)
    }

    @Test fun a_bass_boost_lifts_a_low_tone_and_leaves_a_high_one_at_the_preamp() {
        val b = bands(12f, 0f, 0f, 0f, 0f)
        val sections = Eq.design(fs.toDouble(), b)
        val pre = Eq.autoPreampDb(sections, fs.toDouble())
        for ((freq, want) in listOf(40.0 to Eq.responseDb(sections, fs.toDouble(), 40.0) + pre, 5_000.0 to pre)) {
            val bank = EqFilterBank(fs, 1).apply { set(b) }
            val x = sine(freq, 1.0)
            val y = DoubleArray(x.size) { bank.process(0, x[it]) }
            assertEquals("$freq Hz", want, db(rms(settled(y)) / rms(settled(x))), 0.3)
        }
    }

    @Test fun every_preset_at_full_scale_stays_under_clipping() {
        val presets = listOf(
            bands(7f, 4f, 0f, 0f, 0f), bands(0f, 0f, 0f, 4f, 7f), bands(-2f, -1f, 3f, 4f, 1f),
            bands(4f, 1f, 1f, 3f, 2f), bands(5f, 1f, -2f, 2f, 5f), bands(6f, 0f, -1f, 0f, 5f),
        )
        for (p in presets) for (f in Eq.BANDS_HZ) {
            val bank = EqFilterBank(fs, 1).apply { set(p) }
            val x = sine(f, 0.6, 1.0)
            val peak = settled(DoubleArray(x.size) { bank.process(0, x[it]) }).maxOf { abs(it) }
            assertTrue("${p.toList()} at $f Hz: $peak", peak <= 1.01)
        }
    }

    // ── Settings ─────────────────────────────────────────────────────

    @Test fun settings_from_the_web_app_are_made_safe() {
        assertArrayEquals(floatArrayOf(12f, -12f, 0f, 3f, 0f), EqSettings.of(true, listOf(40.0, -40.0, Double.NaN, 3.0)).bands, 0f)
        assertArrayEquals(floatArrayOf(1f, 2f, 3f, 4f, 5f), EqSettings.of(true, listOf(1.0, 2.0, 3.0, 4.0, 5.0, 6.0)).bands, 0f)
        assertEquals(EqSettings.OFF, EqSettings.of(false, null))
        assertFalse(EqSettings.of(true, listOf(0.0, 0.0, 0.0, 0.0, 0.0)).active)
        assertFalse(EqSettings.of(false, listOf(6.0)).active)
        assertTrue(EqSettings.of(true, listOf(6.0)).active)
    }

    @Test fun settings_survive_the_session_command_and_a_restart() {
        val s = EqSettings.of(true, listOf(-2.0, -1.0, 3.0, 4.0, 1.0))
        assertEquals(s, EqSettings.fromBundle(EqSettings.toBundle(s)))
        val prefs = RuntimeEnvironment.getApplication().getSharedPreferences("eq-test", Context.MODE_PRIVATE)
        prefs.edit().clear().commit()
        assertEquals(EqSettings.OFF, EqSettings.load(prefs))
        EqSettings.save(prefs, s)
        assertEquals(s, EqSettings.load(prefs))
    }

    // ── The AudioProcessor ───────────────────────────────────────────

    private fun processor(encoding: Int, channels: Int, s: EqSettings): EqualizerProcessor {
        val p = EqualizerProcessor()
        p.settings = s
        p.configure(AudioProcessor.AudioFormat(fs, channels, encoding))
        p.flush()
        return p
    }

    private fun pcm16(samples: DoubleArray): ByteBuffer {
        val b = ByteBuffer.allocateDirect(samples.size * 2).order(ByteOrder.nativeOrder())
        for (v in samples) b.putShort((v * Short.MAX_VALUE).roundToInt().toShort())
        b.flip()
        return b
    }

    private fun pcmFloat(samples: DoubleArray): ByteBuffer {
        val b = ByteBuffer.allocateDirect(samples.size * 4).order(ByteOrder.nativeOrder())
        for (v in samples) b.putFloat(v.toFloat())
        b.flip()
        return b
    }

    /** Feeds [input] in 4 KB buffers, the way the sink does, and reads
     *  everything back as samples in -1..1. */
    private fun run(p: EqualizerProcessor, input: ByteBuffer, encoding: Int): DoubleArray {
        val out = ArrayList<Double>()
        while (input.hasRemaining()) {
            val n = minOf(4096, input.remaining())
            val chunk = input.slice().order(ByteOrder.nativeOrder())
            chunk.limit(n)
            input.position(input.position() + n)
            p.queueInput(chunk)
            val o = p.output.order(ByteOrder.nativeOrder())
            while (o.hasRemaining()) {
                out.add(if (encoding == C.ENCODING_PCM_FLOAT) o.float.toDouble() else o.short.toDouble() / Short.MAX_VALUE)
            }
        }
        return out.toDoubleArray()
    }

    @Test fun only_16_bit_and_float_pcm_are_taken() {
        assertTrue(processor(C.ENCODING_PCM_16BIT, 2, EqSettings.OFF).isActive)
        assertTrue(processor(C.ENCODING_PCM_FLOAT, 2, EqSettings.OFF).isActive)
        assertFalse(processor(C.ENCODING_PCM_24BIT, 2, EqSettings.OFF).isActive)
    }

    @Test fun off_or_flat_passes_the_bytes_through_untouched() {
        val x = sine(440.0, 0.3, 0.8)
        for (s in listOf(EqSettings.of(false, listOf(12.0, 0.0, -6.0, 3.0, 9.0)), EqSettings.of(true, listOf(0.0, 0.0, 0.0, 0.0, 0.0)))) {
            val input = pcm16(x)
            val copy = ByteArray(input.remaining()).also { input.duplicate().get(it) }
            val p = processor(C.ENCODING_PCM_16BIT, 1, s)
            val out = ByteArray(copy.size)
            var at = 0
            while (input.hasRemaining()) {
                val chunk = input.slice().order(ByteOrder.nativeOrder()).also { it.limit(minOf(4096, input.remaining())) }
                input.position(input.position() + chunk.limit())
                p.queueInput(chunk)
                val o = p.output
                val n = o.remaining()
                o.get(out, at, n)
                at += n
            }
            assertArrayEquals(copy, out)
        }
    }

    @Test fun each_channel_of_16_bit_stereo_is_filtered_on_its_own() {
        // Bass on the left, treble on the right: a bass cut quietens only the left.
        val l = sine(50.0, 1.0, 0.5)
        val r = sine(8_000.0, 1.0, 0.5)
        val interleaved = DoubleArray(l.size * 2) { if (it % 2 == 0) l[it / 2] else r[it / 2] }
        val cut = bands(-12f, 0f, 0f, 0f, 0f)
        val y = run(processor(C.ENCODING_PCM_16BIT, 2, EqSettings(true, cut)), pcm16(interleaved), C.ENCODING_PCM_16BIT)
        val left = DoubleArray(y.size / 2) { y[it * 2] }
        val right = DoubleArray(y.size / 2) { y[it * 2 + 1] }
        val want = Eq.responseDb(Eq.design(fs.toDouble(), cut), fs.toDouble(), 50.0)
        assertEquals(want, db(rms(settled(left)) / rms(settled(l))), 0.3)
        assertEquals(0.0, db(rms(settled(right)) / rms(settled(r))), 0.2)
    }

    @Test fun float_pcm_is_filtered_too_and_a_boost_does_not_clip() {
        val x = sine(910.0, 1.0, 1.0)
        val y = run(processor(C.ENCODING_PCM_FLOAT, 1, EqSettings(true, bands(0f, 0f, 12f, 0f, 0f))), pcmFloat(x), C.ENCODING_PCM_FLOAT)
        val peak = settled(y).maxOf { abs(it) }
        assertTrue("peak $peak", peak <= 1.01 && peak > 0.95)
    }

    @Test fun a_change_is_heard_on_the_next_buffer_mid_song() {
        val p = processor(C.ENCODING_PCM_16BIT, 1, EqSettings.OFF)
        val x = sine(60.0, 2.0)
        val first = run(p, pcm16(x.copyOfRange(0, fs)), C.ENCODING_PCM_16BIT)
        assertEquals(0.0, db(rms(first) / rms(x.copyOfRange(0, fs))), 0.01)
        p.settings = EqSettings(true, bands(-12f, 0f, 0f, 0f, 0f))
        val rest = run(p, pcm16(x.copyOfRange(fs, x.size)), C.ENCODING_PCM_16BIT)
        assertTrue(db(rms(settled(rest)) / rms(settled(x.copyOfRange(fs, x.size)))) < -5.0)
    }

    @Test fun the_service_player_builds_with_the_equalizer_in_its_sink() {
        val app = RuntimeEnvironment.getApplication()
        val player = EmberPlaybackService.buildPlayer(
            app, OkHttpDataSource.Factory(OkHttpClient()), OfflineStore(Files.createTempDirectory("eq").toFile()),
            eq = EqualizerProcessor(),
        )
        try {
            assertEquals(0, player.mediaItemCount)
        } finally {
            player.release()
        }
    }
}
