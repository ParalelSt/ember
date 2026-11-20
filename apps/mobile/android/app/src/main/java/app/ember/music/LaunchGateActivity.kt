package app.ember.music

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import org.json.JSONObject

/** What the home screen icon opens (the `.MainActivity` alias in the
 *  manifest): it hands the start straight to the app (EmberActivity), with
 *  no update check and no dialog of any kind.
 *
 *  This used to be the launch gate: it asked the server for a newer Ember
 *  before the app opened and showed an update dialog (and a required update
 *  held the launch). Owner, 2026-11-14: there are no required updates, and
 *  every update is optional and starts from a tap on the page's reminder or
 *  Settings (apps/web/lib/update/apply.ts). The class and the alias stay so
 *  icons pinned to `.MainActivity` keep working.
 *
 *  It still notes the version that runs (GateHistory), so the first start
 *  after an update logs "update.gate.done". */
class LaunchGateActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        runCatching {
            GateHistory.updatedFrom(this)?.let { from ->
                AppUpdater.init(this)
                AppUpdater.gateEvent("update.gate.done", "updated from $from", JSONObject().put("from", from).put("to", AppVersion.name(this)))
            }
        }
        startActivity(next(intent, this))
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
        finish()
    }

    companion object {
        /** The app, started with this start's own intent (action, data,
         *  extras), so a launcher tap and any deep link land the same. */
        fun next(from: Intent?, ctx: android.content.Context): Intent =
            Intent(from ?: Intent()).setClass(ctx, EmberActivity::class.java).also { it.flags = 0 }
    }
}
