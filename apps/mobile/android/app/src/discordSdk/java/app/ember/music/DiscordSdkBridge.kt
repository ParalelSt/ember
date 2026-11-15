package app.ember.music

import android.app.Activity
import com.discord.socialsdk.DiscordSocialSdkInit

/** A build with Discord's Social SDK: the JNI shim (cpp/ember_discord.cpp),
 *  which uses the SDK's public C++ API only. The other half, for a build
 *  without it, is in src/discordStub; app/build.gradle compiles exactly one.
 *
 *  Texts go as UTF-8 bytes: JNI's own string conversion is "modified" UTF-8,
 *  which breaks an emoji in a song title. Worker thread only, except [attach]
 *  (see NativeDiscordEngine). */
object DiscordSdkBridge {
    const val PRESENT = true
    @Volatile var loadError: String? = null
        private set

    /** The SDK's library by name, not only as the shim's dependency: Android
     *  runs JNI_OnLoad only for a library it was asked to load. A failure
     *  (no library for this CPU, a phone that refuses it) is an answer, never
     *  a crash. */
    fun load(): Boolean = runCatching {
        System.loadLibrary("discord_partner_sdk")
        System.loadLibrary("ember_discord")
    }.onFailure { loadError = it.message }.isSuccess

    fun attach(activity: Activity) = DiscordSocialSdkInit.setEngineActivity(activity)

    /** [verbose]: the SDK's own log comes back through [pump] as "L\t" lines. */
    fun create(appId: Long, verbose: Boolean): Boolean = nativeCreate(appId, verbose)

    fun update(token: Long, details: ByteArray, state: ByteArray?, largeText: ByteArray, largeImage: ByteArray?, startMs: Long, endMs: Long) =
        nativeUpdate(token, details, state, largeText, largeImage, startMs, endMs)

    fun clear() = nativeClear()

    /** Client::RunCallbacks; what came back, one line per answered update
     *  (DiscordRules.parseResult). */
    fun pump(): Array<String>? = nativePump()

    private external fun nativeCreate(appId: Long, verbose: Boolean): Boolean
    private external fun nativeUpdate(token: Long, details: ByteArray, state: ByteArray?, largeText: ByteArray, largeImage: ByteArray?, startMs: Long, endMs: Long)
    private external fun nativeClear()
    private external fun nativePump(): Array<String>?
}
