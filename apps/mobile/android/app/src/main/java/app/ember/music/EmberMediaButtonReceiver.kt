package app.ember.music

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.media3.session.MediaButtonReceiver
import java.io.File

/** A media button with the app closed: Android keeps the last music app's
 *  receiver and sends it the key (the car's play button over Bluetooth, a
 *  headset, a phone-mirroring app's steering-wheel buttons). Media3's
 *  receiver starts the player service in the foreground for it; the
 *  service's MediaKeys handling then resumes the saved queue.
 *
 *  The one rule Android enforces: a service started in the foreground must
 *  show its notification within seconds. So the service is only started when
 *  there is a queue to play (MediaKeys.shouldStartService), and Media3 only
 *  passes play keys on Android 8+. The service keeps a second guard
 *  (EmberPlaybackService.guardForeground) for a queue that fails to load. */
class EmberMediaButtonReceiver : MediaButtonReceiver() {
    companion object {
        /** Set by ArtworkProvider.onCreate, which Android runs when the
         *  process starts, before any receiver: shouldStartForegroundService
         *  is handed no Context. */
        @Volatile var appContext: Context? = null

        fun savedQueueFile(context: Context) = File(context.filesDir, SavedQueue.FILE_NAME)
    }

    override fun shouldStartForegroundService(intent: Intent): Boolean {
        val key = MediaKeys.pressOf(intent) ?: return false
        val ctx = appContext
        val saved = ctx != null && SavedQueue(savedQueueFile(ctx)).load() != null
        val start = MediaKeys.shouldStartService(key.keyCode, saved)
        Log.i(EmberPlaybackService.TAG, "media button ${key.keyCode} with the app closed: saved queue=$saved -> ${if (start) "resume" else "ignored"}")
        return start
    }
}
