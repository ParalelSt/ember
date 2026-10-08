package app.ember.music

import android.content.res.Configuration
import android.webkit.WebView
import androidx.activity.ComponentActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** A car screen marks its WebView user agent so the page skips the phone rotation lock. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CarScreenTest {
    private val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()

    @Test fun phoneIsNotACar() {
        assertFalse(CarScreen.isCar(activity))
        val web = WebView(activity)
        val before = web.settings.userAgentString
        CarScreen.apply(activity, web)
        assertEquals(before, web.settings.userAgentString)
    }

    @Test fun automotiveFeatureMarksTheUserAgent() {
        shadowOf(activity.packageManager).setSystemFeature("android.hardware.type.automotive", true)
        assertTrue(CarScreen.isCar(activity))
        val web = WebView(activity)
        CarScreen.apply(activity, web)
        assertTrue(web.settings.userAgentString.endsWith(" EmberCar"))
    }

    @Test fun carUiModeMarksTheUserAgent() {
        val config = Configuration(activity.resources.configuration)
        config.uiMode = Configuration.UI_MODE_TYPE_CAR
        @Suppress("DEPRECATION")
        activity.resources.updateConfiguration(config, activity.resources.displayMetrics)
        assertTrue(CarScreen.isCar(activity))
    }

    @Test fun taggingTwiceAddsTheMarkerOnce() {
        assertEquals("UA EmberCar", CarScreen.tag(CarScreen.tag("UA")))
    }
}
