package app.ember.music

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** The auto cache's settings on the phone: on by default, mobile data too,
 *  and a phone that stored the old "mobile data off" default gets it on
 *  once. A choice made after that sticks. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AutoCachePrefsTest {
    private val prefs = RuntimeEnvironment.getApplication().getSharedPreferences(AutoCachePrefs.NAME, Context.MODE_PRIVATE)

    @Before fun clear() = prefs.edit().clear().commit().let { }

    @Test fun `a new phone caches on mobile data too`() {
        assertEquals(AutoCachePrefs.Settings(enabled = true, onMetered = true), AutoCachePrefs.load(prefs))
    }

    @Test fun `the old stored default is switched on once`() {
        // What every phone held before: the page handed its default down.
        prefs.edit().putBoolean("enabled", true).putBoolean("onMetered", false).commit()
        assertEquals(AutoCachePrefs.Settings(enabled = true, onMetered = true), AutoCachePrefs.load(prefs))
        assertTrue(prefs.getBoolean(AutoCachePrefs.MIGRATED_KEY, false))
    }

    @Test fun `the cache switched off stays off`() {
        prefs.edit().putBoolean("enabled", false).putBoolean("onMetered", false).commit()
        assertEquals(AutoCachePrefs.Settings(enabled = false, onMetered = true), AutoCachePrefs.load(prefs))
    }

    @Test fun `mobile data turned off after the change stays off`() {
        AutoCachePrefs.load(prefs)
        AutoCachePrefs.save(prefs, AutoCachePrefs.Settings(enabled = true, onMetered = false))
        assertEquals(AutoCachePrefs.Settings(enabled = true, onMetered = false), AutoCachePrefs.load(prefs))
        assertEquals(AutoCachePrefs.Settings(enabled = true, onMetered = false), AutoCachePrefs.load(prefs))
    }

    @Test fun `a choice saved before the first load is a choice, not the old default`() {
        AutoCachePrefs.save(prefs, AutoCachePrefs.Settings(enabled = true, onMetered = false))
        assertEquals(false, AutoCachePrefs.load(prefs).onMetered)
    }
}
