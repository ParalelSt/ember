package app.ember.music

/** One recognition attempt as the web sees it: partial* then final or error,
 *  then exactly one end. Pure, so the ordering rules are unit tested without a
 *  recognizer; EmberSpeechPlugin feeds it the RecognitionListener callbacks.
 *
 *  Payloads match the EmberSpeech events: partial {text}, final {text},
 *  error {kind, detail}, end {}. */
class SpeechSession(private val emit: (event: String, payload: Map<String, Any?>) -> Unit) {
    private var started = false
    private var ended = false
    private var lastPartial: String? = null

    val active: Boolean get() = started && !ended

    fun start() {
        started = true
        ended = false
        lastPartial = null
    }

    fun partial(texts: List<String>) {
        if (!active) return
        val text = texts.firstOrNull()?.takeIf { it.isNotBlank() } ?: return
        lastPartial = text
        emit("partial", mapOf("text" to text))
    }

    fun results(texts: List<String>) {
        if (!active) return
        val text = texts.firstOrNull()?.takeIf { it.isNotBlank() } ?: lastPartial
        if (text == null) {
            // A "result" with no words is silence; say so rather than send an
            // empty final the web would have to special-case.
            emit("error", mapOf("kind" to "no-speech", "detail" to "empty result"))
        } else {
            emit("final", mapOf("text" to text))
        }
        end()
    }

    fun error(code: Int) {
        if (!active) return
        val heard = lastPartial
        if (heard != null && SpeechErrors.isNoSpeech(code)) {
            // Android often reports NO_MATCH after perfectly good partials;
            // the user saw those words in the box, so search for them.
            emit("final", mapOf("text" to heard))
        } else {
            emit("error", mapOf("kind" to SpeechErrors.kind(code), "detail" to "code $code"))
        }
        end()
    }

    /** The recognizer finished without a result callback (or we tore it down). */
    fun ended() {
        if (!active) return
        end()
    }

    /** Dropped on purpose: no final, no error, just the end the web waits for. */
    fun abort() {
        if (!active) return
        end()
    }

    private fun end() {
        ended = true
        emit("end", emptyMap())
    }
}
