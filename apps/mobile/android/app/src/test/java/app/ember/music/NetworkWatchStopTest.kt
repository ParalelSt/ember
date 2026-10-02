package app.ember.music

import android.content.Context
import android.net.ConnectivityManager
import android.os.Looper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowNetwork

/** The playback service stops its NetworkWatch in onDestroy. A network
 *  change Android reported just before that is already posted to the main
 *  thread; delivering it afterwards ran the auto cache against a released
 *  player and a shut-down executor, which left a 5 s tick loop running on
 *  the dead service for the rest of the process. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NetworkWatchStopTest {
    @Test fun aChangePostedBeforeStopIsNotDeliveredAfterIt() {
        val app = RuntimeEnvironment.getApplication()
        val heard = ArrayList<NetworkWatch.State>()
        val watch = NetworkWatch(app) { heard.add(it) }
        watch.start()
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val callbacks = shadowOf(cm).networkCallbacks
        assertTrue("callback registered", callbacks.isNotEmpty())

        // Android reports a change (posted, not yet run), then the service stops.
        callbacks.first().onLost(ShadowNetwork.newInstance(1))
        watch.stop()
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals(emptyList<NetworkWatch.State>(), heard)
    }
}
