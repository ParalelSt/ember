package app.ember.music

import android.webkit.WebView
import androidx.activity.ComponentActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The phone's Back button goes back inside Ember: it closes the open player
 * or search sheet (they add a history entry for exactly this, see the web's
 * useBackDismiss) or returns to the previous page. Only with nowhere left to
 * go does it leave, and then the app is sent to the background rather than
 * closed, so opening it again is instant.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BackButtonTest {
    private val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    private val web = WebView(activity)
    private var left = 0

    init {
        BackButton.install(activity, { web }, { left++ })
    }

    @Test fun `back with somewhere to go goes back in the page`() {
        shadowOf(web).setCanGoBack(true)
        activity.onBackPressedDispatcher.onBackPressed()
        assertFalse("the app was closed", activity.isFinishing)
        assertEquals(1, shadowOf(web).goBackInvocations)
        assertEquals(0, left)
    }

    @Test fun `back on the first page leaves without closing the app`() {
        shadowOf(web).setCanGoBack(false)
        activity.onBackPressedDispatcher.onBackPressed()
        assertFalse("the app was closed", activity.isFinishing)
        assertEquals(0, shadowOf(web).goBackInvocations)
        assertEquals(1, left)
    }

    /** Before the page exists (a cold start), Back just leaves. */
    @Test fun `back with no page yet leaves`() {
        val bare = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        BackButton.install(bare, { null }, { left++ })
        bare.onBackPressedDispatcher.onBackPressed()
        assertFalse("the app was closed", bare.isFinishing)
        assertEquals(1, left)
    }
}
