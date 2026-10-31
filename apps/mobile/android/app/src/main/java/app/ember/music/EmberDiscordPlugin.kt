package app.ember.music

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** `setSharing({ enabled })`: the page's Discord switch
 *  (apps/web/lib/androidDiscord.ts), kept on the phone for the player service,
 *  which publishes the card itself (DiscordPresence). Resolves `{ enabled }`
 *  as stored. */
@CapacitorPlugin(name = "EmberDiscord")
class EmberDiscordPlugin : Plugin() {
    @PluginMethod
    fun setSharing(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: return call.reject("enabled is required", "bad-args")
        runCatching { DiscordSharing.save(context, enabled) }
            .onSuccess { call.resolve(JSObject().put("enabled", enabled)) }
            .onFailure { call.reject("could not save the setting: ${it.message}", "save-failed") }
    }
}
