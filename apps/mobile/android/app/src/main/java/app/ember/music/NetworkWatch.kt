package app.ember.music

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Handler
import android.os.Looper

/** Whether the phone can reach the internet right now, and on what kind of
 *  network. "Online" means a VALIDATED default network: a Wi-Fi with no
 *  internet behind it (captive portal, dead router) counts as offline, which
 *  is what the auto cache and the offline skip care about.
 *
 *  `current()` asks the system each time, so a caller never acts on a stale
 *  answer; the callback only says "look again", posted to the main thread. */
class NetworkWatch(context: Context, private val onChange: (State) -> Unit) {
    data class State(
        val online: Boolean,
        /** null = no network to judge (treated as not metered by the policy). */
        val metered: Boolean?,
        /** Android's Data Saver is on for this app, on a metered network. */
        val saveData: Boolean,
    )

    private val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager?
    private val main = Handler(Looper.getMainLooper())
    private var registered = false

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = changed()
        override fun onLost(network: Network) = changed()
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = changed()
    }

    private fun changed() {
        main.post { onChange(current()) }
    }

    fun current(): State {
        val cm = cm ?: return State(online = true, metered = null, saveData = false)
        val caps = runCatching { cm.getNetworkCapabilities(cm.activeNetwork) }.getOrNull()
        val restrict = if (Build.VERSION.SDK_INT >= 24) runCatching { cm.restrictBackgroundStatus }.getOrNull() else null
        return stateOf(caps, restrict)
    }

    fun start() {
        val cm = cm ?: return
        if (registered) return
        runCatching {
            if (Build.VERSION.SDK_INT >= 24) cm.registerDefaultNetworkCallback(callback)
            else cm.registerNetworkCallback(NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), callback)
            registered = true
        }
    }

    fun stop() {
        if (!registered) return
        runCatching { cm?.unregisterNetworkCallback(callback) }
        registered = false
    }

    companion object {
        fun stateOf(caps: NetworkCapabilities?, restrictBackground: Int?): State {
            if (caps == null) return State(online = false, metered = null, saveData = false)
            val online = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            val metered = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
            val saveData = metered && Build.VERSION.SDK_INT >= 24 &&
                restrictBackground == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED
            return State(online, metered, saveData)
        }
    }
}
