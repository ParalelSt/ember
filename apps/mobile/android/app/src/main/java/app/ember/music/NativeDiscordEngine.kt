package app.ember.music

import android.app.Activity
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** One per process, like the SDK's client: the player service can be created
 *  again in the same process and takes the one already running. */
object DiscordEngines {
    /** Tests put a fake here. */
    internal var override: DiscordEngine? = null
    private val native by lazy { NativeDiscordEngine(DiscordRules.appId(BuildConfig.DISCORD_APP_ID), Build.VERSION.SDK_INT) }

    fun shared(): DiscordEngine = override ?: native

    fun activityCreated(activity: Activity) {
        if (override == null) native.activityCreated(activity)
    }
}

/** Discord's Social SDK behind DiscordEngine (DiscordSdkBridge, which is a
 *  no-op in a build without the SDK).
 *
 *  Every native call happens on one thread of its own, so a slow SDK holds up
 *  neither the player nor the app, and callbacks arrive where they are pumped.
 *  Nothing native is touched until the first card goes out: someone with the
 *  switch off never loads the library. */
class NativeDiscordEngine(private val appId: Long?, private val androidSdk: Int) : DiscordEngine {
    companion object {
        const val TAG = "EmberDiscord"
        private const val PUMP_MS = 1_000L
        /** After a clear, long enough for it to leave and any answer to land. */
        private const val SETTLE_MS = 5_000L
        private const val ATTACH_WAIT_MS = 3_000L
    }

    private val worker: Handler by lazy { Handler(HandlerThread("ember-discord").apply { start() }.looper) }
    private val main = Handler(Looper.getMainLooper())

    private enum class Native { NOT_STARTED, READY, FAILED }

    // All of these belong to the worker thread.
    private var native = Native.NOT_STARTED
    private var failure = ""
    private var latestToken = 0L
    private var latestDone: ((Boolean, String?, Boolean) -> Unit)? = null
    private var pumpWanted = false
    private var settleUntil = 0L
    private var pumpScheduled = false

    /** The SDK has been given an activity at some point in this process. */
    @Volatile private var attached = false

    override fun status(): DiscordStatus = DiscordRules.status(
        DiscordSdkBridge.PRESENT,
        androidSdk,
        appId,
        canAttach = attached || DiscordSharing.activity() != null,
    )

    /** A new activity once the library is in: the SDK's docs want it told in
     *  every onCreate. Before that, the first card hands it over. */
    fun activityCreated(activity: Activity) {
        if (attached) attach(activity)
    }

    override fun update(token: Long, activity: PresenceActivity, done: (Boolean, String?, Boolean) -> Unit) {
        worker.post {
            if (!ensureNative()) {
                val permanent = native == Native.FAILED
                val why = failure
                main.post { done(false, why, permanent) }
                return@post
            }
            latestToken = token
            latestDone = done
            val sent = runCatching {
                DiscordSdkBridge.update(
                    token,
                    activity.details.toByteArray(),
                    activity.state?.toByteArray(),
                    activity.largeText.toByteArray(),
                    activity.largeImage?.toByteArray(),
                    activity.startMs,
                    activity.endMs ?: 0,
                )
            }
            sent.exceptionOrNull()?.let { e ->
                latestDone = null
                main.post { done(false, "update failed: ${e.message}", false) }
            }
            schedulePump()
        }
    }

    override fun clear() {
        worker.post {
            if (native != Native.READY) return@post
            runCatching { DiscordSdkBridge.clear() }.onFailure { Log.w(TAG, "clear failed: ${it.message}") }
            settleUntil = SystemClock.uptimeMillis() + SETTLE_MS
            schedulePump()
        }
    }

    override fun setPumping(on: Boolean) {
        worker.post {
            pumpWanted = on
            if (on) schedulePump()
        }
    }

    /** The library, the activity, the client: once per process. */
    private fun ensureNative(): Boolean {
        if (native != Native.NOT_STARTED) return native == Native.READY
        val id = appId
        val reason = when {
            id == null -> "this build has no Discord app id"
            !DiscordSdkBridge.load() -> "the Discord library would not load: ${DiscordSdkBridge.loadError}"
            else -> {
                attachOnMain()
                // Never a client without the activity the SDK's docs ask for:
                // this may be a passing thing (it just closed, the main thread
                // was busy), so the next look starts over.
                if (!attached) {
                    failure = "no activity to hand to the SDK"
                    return false
                }
                val created = runCatching { DiscordSdkBridge.create(id) }
                if (created.getOrDefault(false)) null else "the Discord client would not start: ${created.exceptionOrNull()?.message}"
            }
        }
        native = if (reason == null) Native.READY else Native.FAILED
        failure = reason.orEmpty()
        return reason == null
    }

    /** The docs call it from an activity's onCreate, which is the main
     *  thread. The main thread never waits on this one, so this cannot lock
     *  up; a main thread too busy to answer is not worth waiting for. */
    private fun attachOnMain() {
        val done = CountDownLatch(1)
        main.post {
            DiscordSharing.activity()?.let { attach(it) }
            done.countDown()
        }
        done.await(ATTACH_WAIT_MS, TimeUnit.MILLISECONDS)
    }

    private fun attach(activity: Activity) {
        runCatching { DiscordSdkBridge.attach(activity) }
            .onSuccess { attached = true }
            .onFailure { Log.w(TAG, "attach failed: ${it.message}") }
    }

    private fun schedulePump() {
        if (pumpScheduled) return
        pumpScheduled = true
        worker.postDelayed(::pump, PUMP_MS)
    }

    private fun pump() {
        pumpScheduled = false
        if (native != Native.READY) return
        val lines = runCatching { DiscordSdkBridge.pump() }
            .onFailure { Log.w(TAG, "callbacks failed: ${it.message}") }
            .getOrNull()
        lines?.forEach { line ->
            val result = DiscordRules.parseResult(line) ?: return@forEach
            val done = latestDone
            if (result.token == latestToken && done != null) {
                latestDone = null
                main.post { done(result.ok, result.error, false) }
            }
        }
        // Stops when idle: nothing wanted and nothing settling.
        if (pumpWanted || SystemClock.uptimeMillis() < settleUntil) schedulePump()
    }
}
