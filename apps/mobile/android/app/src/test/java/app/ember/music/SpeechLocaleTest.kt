package app.ember.music

import org.junit.Assert.assertEquals
import org.junit.Test

class SpeechLocaleTest {
    @Test
    fun `device locale wins over the page's hint`() {
        assertEquals("de-DE", SpeechLocale.pick("en-US", "de-DE"))
    }

    @Test
    fun `underscores are normalised to hyphens`() {
        assertEquals("en-GB", SpeechLocale.pick(null, "en_GB"))
        assertEquals("pt-BR", SpeechLocale.pick("pt_BR", null))
    }

    @Test
    fun `a malformed device locale falls through to the hint`() {
        assertEquals("fr-FR", SpeechLocale.pick("fr-FR", "not a locale"))
        assertEquals("fr-FR", SpeechLocale.pick("fr-FR", ""))
        // Locale.getDefault().toLanguageTag() of an empty locale.
        assertEquals("fr-FR", SpeechLocale.pick("fr-FR", "und"))
    }

    @Test
    fun `nothing usable gives en-US`() {
        assertEquals("en-US", SpeechLocale.pick(null, null))
        assertEquals("en-US", SpeechLocale.pick("x", "!!"))
    }

    @Test
    fun `accepts script and region subtags`() {
        assertEquals("zh-Hant-TW", SpeechLocale.pick(null, "zh-Hant-TW"))
    }
}
