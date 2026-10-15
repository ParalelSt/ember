package app.ember.music

import android.content.Context
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** The auto cache's one setting on the phone: on by default. There is no
 *  mobile data setting any more; what older builds stored for it is
 *  ignored and cleared. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AutoCachePrefsTest {
    private val prefs = RuntimeEnvironment.getApplication().getSharedPreferences(AutoCachePrefs.NAME, Context.MODE_PRIVATE)

    @Before fun clear() {
        prefs.edit().clear().commit()
    }

    @Test fun `on by default`() {
        assertTrue(AutoCachePrefs.load(prefs))
    }

    @Test fun `switched off stays off`() {
        AutoCachePrefs.save(prefs, false)
        assertFalse(AutoCachePrefs.load(prefs))
        AutoCachePrefs.save(prefs, true)
        assertTrue(AutoCachePrefs.load(prefs))
    }

    @Test fun `an older build's mobile data setting is ignored and cleared`() {
        prefs.edit().putBoolean("enabled", true).putBoolean("onMetered", false).putBoolean("onMeteredDefaultOn", true).commit()
        assertTrue(AutoCachePrefs.load(prefs))
        assertFalse(prefs.contains("onMetered"))
        assertFalse(prefs.contains("onMeteredDefaultOn"))
    }
}
