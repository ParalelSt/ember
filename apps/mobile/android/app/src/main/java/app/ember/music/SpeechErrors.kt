package app.ember.music

import android.speech.SpeechRecognizer

/** SpeechRecognizer.ERROR_* codes to the web's SpeechErrorKind strings
 *  (apps/web/lib/speech/types.ts). The constants are compile-time ints, so
 *  the newer ones are safe to name on old devices: they simply never arrive. */
object SpeechErrors {
    fun kind(code: Int): String = when (code) {
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission-denied"
        SpeechRecognizer.ERROR_NETWORK,
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
        SpeechRecognizer.ERROR_SERVER,
        SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "network"
        SpeechRecognizer.ERROR_NO_MATCH,
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
        // AUDIO, CLIENT, RECOGNIZER_BUSY, LANGUAGE_*, TOO_MANY_REQUESTS,
        // CANNOT_CHECK_SUPPORT and anything a future Android adds.
        else -> "unavailable"
    }

    /** Silence or nothing recognised: quiet on the web side, and the case where
     *  a partial we already have is worth promoting to the final text. */
    fun isNoSpeech(code: Int): Boolean =
        code == SpeechRecognizer.ERROR_NO_MATCH || code == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
}
