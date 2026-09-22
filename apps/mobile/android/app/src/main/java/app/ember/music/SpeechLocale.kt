package app.ember.music

/** The recognizer's language as a BCP-47 tag (en-US, never en_US). */
object SpeechLocale {
    val TAG = Regex("^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")

    /** Device first: the OS knows better than the page's navigator.language,
     *  which inside the WebView is the same value anyway. */
    fun pick(requested: String?, device: String?): String =
        listOf(device, requested).firstNotNullOfOrNull(::normalise) ?: "en-US"

    private fun normalise(tag: String?): String? {
        val t = tag?.trim()?.replace('_', '-') ?: return null
        // Locale.toLanguageTag() gives "und" for an empty locale: well formed,
        // but no recognizer knows what to do with it.
        if (t.equals("und", ignoreCase = true) || t.startsWith("und-", ignoreCase = true)) return null
        return t.takeIf { TAG.matches(it) }
    }
}
