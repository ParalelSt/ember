package app.ember.music

import android.Manifest
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject

/**
 * The page's handle on the in-app updater (AppUpdater), for the update pill
 * and Settings (apps/web/lib/appUpdate.ts):
 *
 *  - `getState()` and the `updateState` event:
 *    `{ status, current, currentCode, latest?, progress?, waiting?, error?,
 *       checkedAt, needsPermission, silent }`, where status is idle |
 *    checking | up-to-date | downloading | ready | installing | failed and
 *    waiting (when ready) is car | playback | idle | tap | permission.
 *  - `check()`: check now (the Settings button).
 *  - `install()`: the person tapped Install. On Android 13+ it first asks
 *    for notifications when they are off: after the update Android does not
 *    reopen Ember, and the "Ember updated, tap to open" notice is the way
 *    back (UpdatedReceiver).
 *  - `openInstallSettings()`: Android's "Install unknown apps" for Ember.
 *
 * Also tells the updater when the app is on screen: an update never
 * installs by itself under the person's eyes.
 */
@CapacitorPlugin(
    name = "EmberUpdate",
    permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = EmberUpdatePlugin.NOTIFICATIONS)],
)
class EmberUpdatePlugin : Plugin() {
    companion object {
        const val NOTIFICATIONS = "notifications"
    }

    private val listener: (JSONObject) -> Unit = { state ->
        bridge?.executeOnMainThread { notifyListeners("updateState", JSObject(state.toString())) }
    }

    override fun load() {
        AppUpdater.init(context)
        AppUpdater.attachActivity(activity)
        AppUpdater.addListener(listener)
        UpdatePresence.setForeground(true)
        AppUpdater.checkOnStart()
    }

    override fun handleOnStart() {
        super.handleOnStart()
        AppUpdater.attachActivity(activity)
        UpdatePresence.setForeground(true)
        AppUpdater.refresh()
    }

    /** Also after Android's confirm screen (a dialog over the app: no
     *  onStart when it closes). */
    override fun handleOnResume() {
        super.handleOnResume()
        AppUpdater.refresh()
    }

    override fun handleOnStop() {
        super.handleOnStop()
        UpdatePresence.setForeground(false)
    }

    override fun handleOnDestroy() {
        AppUpdater.removeListener(listener)
        AppUpdater.attachActivity(null)
        super.handleOnDestroy()
    }

    private fun state() = JSObject(AppUpdater.stateJson().toString())

    @PluginMethod
    fun getState(call: PluginCall) = call.resolve(state())

    @PluginMethod
    fun check(call: PluginCall) {
        AppUpdater.check(manual = true, reason = "manual")
        call.resolve(state())
    }

    @PluginMethod
    fun install(call: PluginCall) {
        if (UpdateRules.askNotificationsFirst(Build.VERSION.SDK_INT, getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED)) {
            requestPermissionForAlias(NOTIFICATIONS, call, "onNotifications")
            return
        }
        AppUpdater.installNow()
        call.resolve(state())
    }

    @PermissionCallback
    private fun onNotifications(call: PluginCall) {
        // Refused or not, the update goes ahead: the notice only brings Ember back.
        AppUpdater.installNow()
        call.resolve(state())
    }

    @PluginMethod
    fun openInstallSettings(call: PluginCall) {
        call.resolve(JSObject().put("opened", AppUpdater.openInstallSettings(activity)))
    }
}
