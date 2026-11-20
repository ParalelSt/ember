package app.ember.music

import android.app.Activity

/** A build without Discord's Social SDK (CI, any machine without it, see
 *  docs/APPS.md): the same calls, doing nothing. The SDK's licence does not
 *  allow it in this public repository. The other half is in src/discordSdk;
 *  app/build.gradle compiles exactly one. */
@Suppress("UNUSED_PARAMETER")
object DiscordSdkBridge {
    const val PRESENT = false
    val loadError: String? = null

    fun load(): Boolean = false
    fun attach(activity: Activity) {}
    fun create(appId: Long, verbose: Boolean): Boolean = false
    fun update(token: Long, details: ByteArray, state: ByteArray?, largeText: ByteArray, largeImage: ByteArray?, startMs: Long, endMs: Long) {}
    fun clear() {}
    fun pump(): Array<String>? = null
}
