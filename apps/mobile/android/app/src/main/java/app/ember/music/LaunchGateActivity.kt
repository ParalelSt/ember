package app.ember.music

import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import app.ember.music.GateRules.Effect
import app.ember.music.GateRules.Input
import app.ember.music.GateRules.Phase

/** The launch gate: what the home screen icon opens (the `.MainActivity`
 *  alias in the manifest). Asks the server whether a newer Ember is out
 *  before the WebView, the plugins or the player exist, and either opens
 *  the app (EmberActivity) at once or shows the update dialog. The
 *  decisions are GateRules'; this only does the I/O and draws the dialog.
 *
 *  Skipped entirely (straight into the app) in a car, with music already
 *  playing, and for anything but a launcher tap. */
class LaunchGateActivity : ComponentActivity() {
    private val main = Handler(Looper.getMainLooper())
    private var machine: GateRules.Machine? = null
    @Volatile private var checking = true
    private var entered = false
    private var pendingEnter = false
    private var resumed = false
    private var gated = false
    /** Android will install without asking (AppUpdater's view). */
    private var silent = false
    private val updaterListener: (JSONObject) -> Unit = { s -> main.post { onUpdaterState(s) } }
    private val ticker = object : Runnable {
        override fun run() {
            feed(Input.Tick)
        }
    }

    private lateinit var scrim: View
    private lateinit var title: TextView
    private lateinit var reason: TextView
    private lateinit var detail: TextView
    private lateinit var bar: ProgressBar
    private lateinit var buttons: LinearLayout
    private lateinit var cancel: Button
    private lateinit var primary: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        splash.setKeepOnScreenCondition { checking }
        // The splash theme sets a background on every view; the dialog
        // needs a plain one.
        setTheme(R.style.AppTheme_NoActionBar)

        val facts = GateRules.LaunchFacts(
            action = intent?.action,
            categories = intent?.categories.orEmpty(),
            automotive = Surfaces.isAutomotive(this),
            car = Surfaces.isCarMode(this) || UpdatePresence.carConnected,
            playing = UpdatePresence.playing,
        )
        val skip = GateRules.skip(facts)
        if (skip != null || savedInstanceState != null) {
            enter()
            return
        }

        AppUpdater.init(this)
        val launch = GateHistory.start(this)
        gated = true
        launch.updatedFrom?.let {
            AppUpdater.gateEvent("update.gate.done", "updated from $it", JSONObject().put("from", it).put("to", AppVersion.name(this)))
        }
        if (launch.mode == GateRules.Mode.SKIP_GATE) {
            AppUpdater.gateEvent("update.gate.skipped", "the last launches died in the launch gate: opening without it")
            enter()
            return
        }
        val recovery = launch.mode == GateRules.Mode.RECOVERY
        if (!online()) {
            AppUpdater.gateEvent("update.gate.check", "offline: no update check", JSONObject().put("result", "offline").put("ms", 0))
            enter()
            return
        }

        window.setBackgroundDrawable(ColorDrawable(themeBackground()))
        buildViews()
        val m = GateRules.Machine(recovery, resumed = true)
        machine = m
        if (recovery) AppUpdater.gateEvent("update.gate.recovery", "recovery launch", JSONObject().put("budgetMs", GateRules.RECOVERY_BUDGET_MS))
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                feed(if (m.mandatory) Input.Quit else Input.NotNow)
            }
        })

        val budget = if (recovery) GateRules.RECOVERY_BUDGET_MS else GateRules.CHECK_BUDGET_MS
        val base = ServerConfig.baseUrl(this)
        val current = AppVersion.name(this)
        Thread {
            val started = System.currentTimeMillis()
            val (offer, result) = check("$base${GateRules.checkPath(current)}", current, budget)
            main.post {
                AppUpdater.gateEvent("update.gate.check", "launch check: $result",
                    JSONObject().put("result", result).put("ms", System.currentTimeMillis() - started))
                if (isFinishing || isDestroyed) return@post
                if (offer != null) AppUpdater.addListener(updaterListener)
                checking = false
                feed(Input.Checked(offer, ready = offer != null && AppUpdater.readyVersion() == offer.version))
            }
        }.apply { name = "ember-launch-gate"; isDaemon = true }.start()
    }

    /** One GET, no retry, within [budgetMs]: (offer, result for the log). */
    private fun check(url: String, current: String?, budgetMs: Long): Pair<GateRules.Offer?, String> = try {
        val client = OkHttpClient.Builder().callTimeout(budgetMs, TimeUnit.MILLISECONDS).build()
        client.newCall(Request.Builder().url(url).build()).execute().use { res ->
            if (!res.isSuccessful) null to "none"
            else {
                val offer = GateRules.parseAnswer(runCatching { JSONObject(res.body?.string().orEmpty()) }.getOrNull(), current)
                offer to (if (offer != null) "update" else "none")
            }
        }
    } catch (e: java.io.InterruptedIOException) {
        null to "timeout"
    } catch (e: Exception) {
        null to "error"
    }

    private fun online(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val caps = runCatching { cm.getNetworkCapabilities(cm.activeNetwork) }.getOrNull() ?: return false
        return UpdateRules.canDownload(UpdateRules.NetFacts(
            internet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),
            validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),
            wifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI),
            cellular = caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR),
            ethernet = caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET),
        ))
    }

    // ── The machine ─────────────────────────────────────────────────────

    private fun feed(input: Input) {
        val m = machine ?: return
        for (effect in m.handle(input)) apply(effect)
        main.removeCallbacks(ticker)
        if (m.phase is Phase.Countdown) main.postDelayed(ticker, 1000)
        render()
    }

    private fun apply(effect: Effect) {
        when (effect) {
            is Effect.EnterApp -> enter()
            is Effect.StartDownload -> AppUpdater.check(manual = true, reason = "launch")
            is Effect.Install -> {
                // Handing over to Android is not a crash, whatever happens to
                // this process next.
                GateHistory.mark(this, GateRules.Stage.CLEAN)
                GateHistory.installStarted(this)
                if (!AppUpdater.installFromGate(this)) main.post { feed(Input.InstallFailed) }
            }
            is Effect.Quit -> {
                GateHistory.mark(this, GateRules.Stage.CLEAN)
                finishAndRemoveTask()
            }
            is Effect.OpenPermissionSettings -> AppUpdater.openInstallSettings(this)
            is Effect.Linger -> main.postDelayed({ feed(Input.FailedTimeout) }, GateRules.FAILED_LINGER_MS)
            is Effect.Event -> AppUpdater.gateEvent(effect.name, effect.name.removePrefix("update.gate."), JSONObject(effect.data))
        }
    }

    private fun onUpdaterState(s: JSONObject) {
        val m = machine ?: return
        silent = s.optBoolean("silent", silent)
        val progress = if (s.has("progress") && !s.isNull("progress")) s.optDouble("progress") else null
        val waiting = if (s.isNull("waiting")) null else s.optString("waiting").takeIf { it.isNotEmpty() }
        val latest = if (s.isNull("latest")) null else s.optString("latest").takeIf { it.isNotEmpty() }
        GateRules.fromUpdater(m.phase, s.optString("status"), waiting, progress, latest, m.offer?.version)?.let { feed(it) }
        if (m.phase is Phase.Installing) render()
    }

    /** Into the app. Deferred until the gate is on screen again when the
     *  person left meanwhile: Android does not let an app open a window from
     *  the background. */
    private fun enter() {
        if (entered) return
        if (machine != null && !resumed) {
            pendingEnter = true
            return
        }
        entered = true
        checking = false
        main.removeCallbacks(ticker)
        if (gated) GateHistory.mark(this, GateRules.Stage.GATED)
        val next = Intent(intent).setClass(this, EmberActivity::class.java)
        next.flags = 0
        startActivity(next)
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
        finish()
    }

    // ── Lifecycle ───────────────────────────────────────────────────────

    override fun onStart() {
        super.onStart()
        if (machine != null) UpdatePresence.setForeground(true)
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        if (pendingEnter) {
            pendingEnter = false
            enter()
            return
        }
        if (machine != null) {
            AppUpdater.attachActivity(this)
            AppUpdater.refresh()
            feed(Input.Resumed(true))
        }
    }

    override fun onPause() {
        resumed = false
        if (machine != null && !entered) feed(Input.Resumed(false))
        super.onPause()
    }

    override fun onStop() {
        if (machine != null && !entered) UpdatePresence.setForeground(false)
        super.onStop()
    }

    override fun onDestroy() {
        main.removeCallbacks(ticker)
        AppUpdater.removeListener(updaterListener)
        super.onDestroy()
    }

    // ── The dialog ──────────────────────────────────────────────────────

    private fun themeBackground(): Int {
        val prefs = getSharedPreferences(ThemeColors.PREFS, Context.MODE_PRIVATE)
        return ThemeColors.parseHex(prefs.getString(ThemeColors.KEY_BACKGROUND, null))
            ?: ThemeColors.parseHex(ThemeColors.DEFAULT_BACKGROUND)
            ?: Color.rgb(0x16, 0x16, 0x1a)
    }

    private fun dp(v: Int): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun text(sizeSp: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
        background = null
    }

    private fun pill(fill: Int, stroke: Int, textColor: Int) = Button(this).apply {
        isAllCaps = false
        setTextColor(textColor)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        stateListAnimator = null
        minHeight = dp(44)
        background = GradientDrawable().apply {
            cornerRadius = dp(999).toFloat()
            setColor(fill)
            setStroke(dp(1), stroke)
        }
    }

    private fun buildViews() {
        val white = Color.rgb(0xf5, 0xf5, 0xf7)
        val muted = Color.rgb(0xb4, 0xb4, 0xbd)
        title = text(19f, white, bold = true)
        reason = text(14f, white)
        detail = text(14f, muted)
        bar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progressTintList = ColorStateList.valueOf(white)
        }
        cancel = pill(Color.TRANSPARENT, Color.rgb(0x3a, 0x3a, 0x42), white).apply {
            setOnClickListener { feed(if (machine?.mandatory == true) Input.Quit else Input.NotNow) }
        }
        primary = pill(white, white, Color.rgb(0x18, 0x18, 0x1c)).apply {
            setOnClickListener { feed(Input.UpdateNow) }
        }
        buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(cancel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(5) })
            addView(primary, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(5) })
        }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
            background = GradientDrawable().apply {
                cornerRadius = dp(16).toFloat()
                setColor(Color.rgb(0x1f, 0x1f, 0x24))
                setStroke(dp(1), Color.rgb(0x2e, 0x2e, 0x35))
            }
            addView(title)
            addView(reason, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
            addView(detail, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
            addView(bar, LinearLayout.LayoutParams(-1, dp(6)).apply { topMargin = dp(14) })
            addView(buttons, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(20) })
        }
        scrim = FrameLayout(this).apply {
            setBackgroundColor(Color.argb(0x8c, 0, 0, 0))
            setPadding(dp(24), dp(24), dp(24), dp(24))
            addView(card, FrameLayout.LayoutParams(minOf(dp(380), resources.displayMetrics.widthPixels - dp(48)), -2, Gravity.CENTER))
            visibility = View.GONE
        }
        setContentView(FrameLayout(this).apply {
            background = null
            addView(scrim, FrameLayout.LayoutParams(-1, -1))
        })
    }

    private fun render() {
        val m = machine ?: return
        if (!::scrim.isInitialized) return
        val c = GateRules.copy(m, silent)
        if (c == null) {
            scrim.visibility = View.GONE
            return
        }
        val wasHidden = scrim.visibility != View.VISIBLE
        scrim.visibility = View.VISIBLE
        title.text = c.title
        reason.text = c.reason.orEmpty()
        reason.visibility = if (c.reason == null) View.GONE else View.VISIBLE
        detail.text = c.detail
        bar.visibility = if (c.progress == null) View.GONE else View.VISIBLE
        bar.isIndeterminate = c.progress == -1
        if (c.progress != null && c.progress >= 0) bar.progress = c.progress
        buttons.visibility = if (c.buttons) View.VISIBLE else View.GONE
        cancel.text = c.cancel
        primary.text = c.primary
        primary.isEnabled = c.primaryEnabled
        primary.alpha = if (c.primaryEnabled) 1f else 0.55f
        // Focus starts on the safe choice.
        if (wasHidden && c.buttons) cancel.requestFocus()
    }
}
