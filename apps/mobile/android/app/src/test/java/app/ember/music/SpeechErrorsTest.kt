package app.ember.music

import android.speech.SpeechRecognizer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Every SpeechRecognizer error code lands on the kind the web toasts for. */
class SpeechErrorsTest {
    @Test
    fun `maps every recognizer error to the web's kind`() {
        val rows = mapOf(
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS to "permission-denied",
            SpeechRecognizer.ERROR_NETWORK to "network",
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT to "network",
            SpeechRecognizer.ERROR_SERVER to "network",
            SpeechRecognizer.ERROR_SERVER_DISCONNECTED to "network",
            SpeechRecognizer.ERROR_NO_MATCH to "no-speech",
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT to "no-speech",
            SpeechRecognizer.ERROR_AUDIO to "unavailable",
            SpeechRecognizer.ERROR_CLIENT to "unavailable",
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY to "unavailable",
            SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED to "unavailable",
            SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE to "unavailable",
            SpeechRecognizer.ERROR_TOO_MANY_REQUESTS to "unavailable",
            SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT to "unavailable",
        )
        rows.forEach { (code, kind) -> assertEquals("code $code", kind, SpeechErrors.kind(code)) }
    }

    @Test
    fun `an unknown code is unavailable`() {
        assertEquals("unavailable", SpeechErrors.kind(999))
        assertEquals("unavailable", SpeechErrors.kind(-1))
    }

    @Test
    fun `only silence counts as no speech`() {
        assertTrue(SpeechErrors.isNoSpeech(SpeechRecognizer.ERROR_NO_MATCH))
        assertTrue(SpeechErrors.isNoSpeech(SpeechRecognizer.ERROR_SPEECH_TIMEOUT))
        assertFalse(SpeechErrors.isNoSpeech(SpeechRecognizer.ERROR_NETWORK))
    }
}
