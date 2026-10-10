package app.ember.music

import org.json.JSONObject

/** Every decision of the launch gate (LaunchGateActivity), as plain
 *  functions and a plain state machine, so each one is tested without a
 *  phone. The desktop shell's gate (apps/desktop/src-tauri/src/gate.rs) makes
 *  the same decisions with the same copy.
 *
 *  An icon tap asks the server once (GET /api/app/update, 2 s budget) before
 *  the WebView, the plugins or the player exist. No answer, no update, or any
 *  error: the app opens as it always did. An update: a dialog with "Not now"
 *  and "Update now", the download (AppUpdater, the same engine as ever), a
 *  "Restarting in 7s" countdown, and the install. A required update has
 *  "Quit Ember" in place of "Not now". Never in a car, never when music is
 *  already playing, never for anything but a launcher tap. */
object GateRules {
    /** "Restarting in 7s" (owner decision D1). */
    const val COUNTDOWN_S = 7
    /** The check's budget on a phone (mobile data). */
    const val CHECK_BUDGET_MS = 2_000L
    /** After launches that never got going: a fix is worth waiting for. */
    const val RECOVERY_BUDGET_MS = 8_000L
    /** "Couldn't update" stays this long, then the app opens. */
    const val FAILED_LINGER_MS = 2_000L

    // ── When not to gate ────────────────────────────────────────────────

    data class LaunchFacts(
        val action: String?,
        val categories: Set<String>,
        /** An Android car (AAOS). */
        val automotive: Boolean,
        /** Android Auto projecting (car UI mode) or a car on the player. */
        val car: Boolean,
        /** The player is already playing in this process. */
        val playing: Boolean,
    )

    enum class Skip { AUTOMOTIVE, CAR, NOT_LAUNCHER, PLAYING }

    /** Why this start must go straight into the app, or null to gate. */
    fun skip(f: LaunchFacts): Skip? = when {
        f.automotive -> Skip.AUTOMOTIVE
        f.car -> Skip.CAR
        f.action != "android.intent.action.MAIN" || "android.intent.category.LAUNCHER" !in f.categories -> Skip.NOT_LAUNCHER
        f.playing -> Skip.PLAYING
        else -> null
    }

    // ── Launch history ──────────────────────────────────────────────────

    enum class Stage { STARTING, GATED, READY, CLEAN }

    data class History(
        val stage: Stage = Stage.CLEAN,
        /** Launches in a row that died inside the gate. */
        val failedInGate: Int = 0,
        /** Launches in a row that died after the gate, before the page loaded. */
        val failedAfterGate: Int = 0,
        val lastVersion: String? = null,
    )

    enum class Mode { NORMAL, RECOVERY, SKIP_GATE }

    data class Launch(val history: History, val mode: Mode, val updatedFrom: String?)

    /** The history to keep at the start of a gated launch, how to run the
     *  gate, and the version an update replaced since the last launch. Two
     *  launches that died after the gate make a recovery launch; two that
     *  died in the gate skip it once, so a broken gate never keeps the app
     *  shut. */
    fun onLaunch(prev: History, version: String?): Launch {
        val (inGate, afterGate) = when (prev.stage) {
            Stage.STARTING -> prev.failedInGate + 1 to prev.failedAfterGate
            Stage.GATED -> prev.failedInGate to prev.failedAfterGate + 1
            Stage.READY -> 0 to 0
            Stage.CLEAN -> prev.failedInGate to prev.failedAfterGate
        }
        val mode = when {
            inGate >= 2 -> Mode.SKIP_GATE
            afterGate >= 2 -> Mode.RECOVERY
            else -> Mode.NORMAL
        }
        val from = prev.lastVersion?.takeIf { version != null && UpdateRules.isNewer(version, it) }
        return Launch(History(Stage.STARTING, inGate, afterGate, version ?: prev.lastVersion), mode, from)
    }

    fun reached(h: History, stage: Stage): History = when (stage) {
        Stage.GATED -> h.copy(stage = stage, failedInGate = 0)
        Stage.READY -> h.copy(stage = stage, failedInGate = 0, failedAfterGate = 0)
        else -> h.copy(stage = stage)
    }

    // ── The server's answer ─────────────────────────────────────────────

    data class Offer(val version: String, val mandatory: Boolean, val reason: String?, val size: Long?)

    /** GET /api/app/update's body as an offer, or null for anything that is
     *  not a newer version this app can install. */
    fun parseAnswer(json: JSONObject?, current: String?): Offer? {
        val u = json?.optJSONObject("update") ?: return null
        val version = u.optString("version").trim()
        if (!UpdateRules.isNewer(version, current)) return null
        if (u.optString("action") != "install") return null
        val reason = if (u.isNull("reason")) null else u.optString("reason").takeIf { it.isNotBlank() }
        val size = if (u.isNull("size")) null else u.optLong("size", -1).takeIf { it > 0 }
        return Offer(version, u.optBoolean("mandatory", false), reason, size)
    }

    fun checkPath(version: String?): String =
        "/api/app/update?platform=android&version=${version.orEmpty()}&install=apk&launch=1"

    // ── The state machine ───────────────────────────────────────────────

    sealed class Phase {
        object Checking : Phase()
        data class Downloading(val percent: Int?) : Phase()
        /** [held]: a required update waiting for the person to come back. */
        data class Countdown(val seconds: Int, val held: Boolean) : Phase()
        object Installing : Phase()
        /** "Install unknown apps" is off for Ember. */
        object Permission : Phase()
        object Failed : Phase()
        object Done : Phase()
    }

    sealed class Input {
        data class Checked(val offer: Offer?, val ready: Boolean) : Input()
        data class Progress(val percent: Int?) : Input()
        object Downloaded : Input()
        object DownloadFailed : Input()
        object Tick : Input()
        /** The gate is on screen (onResume) or not (onPause). */
        data class Resumed(val on: Boolean) : Input()
        object NotNow : Input()
        object UpdateNow : Input()
        object Quit : Input()
        object NeedsPermission : Input()
        object InstallFailed : Input()
        object FailedTimeout : Input()
    }

    sealed class Effect {
        object EnterApp : Effect()
        object StartDownload : Effect()
        object Install : Effect()
        object Quit : Effect()
        object OpenPermissionSettings : Effect()
        /** Send FailedTimeout after [FAILED_LINGER_MS]. */
        object Linger : Effect()
        data class Event(val name: String, val data: Map<String, Any?>) : Effect()
    }

    class Machine(val recovery: Boolean, var resumed: Boolean) {
        var phase: Phase = Phase.Checking
            private set
        var offer: Offer? = null
            private set
        /** "Update now" during the download: install once it is in. */
        var updateNow = false
            private set

        val mandatory get() = offer?.mandatory == true
        private val version get() = offer?.version

        private fun cancellable() = !mandatory &&
            (phase is Phase.Downloading || phase is Phase.Countdown || phase is Phase.Permission || phase is Phase.Failed)

        private fun stageName() = when (phase) {
            is Phase.Downloading -> "download"
            is Phase.Countdown -> "countdown"
            is Phase.Permission -> "permission"
            is Phase.Failed -> "failed"
            else -> "other"
        }

        private fun enter(why: String, left: Boolean): List<Effect> {
            val stage = stageName()
            phase = Phase.Done
            return listOf(
                Effect.Event("update.gate.cancel", mapOf("stage" to stage, "why" to why, "focusLost" to left, "version" to version)),
                Effect.EnterApp,
            )
        }

        private fun install(): List<Effect> {
            phase = Phase.Installing
            return listOf(Effect.Event("update.gate.install", mapOf("version" to version)), Effect.Install)
        }

        private fun countdown() = Phase.Countdown(COUNTDOWN_S, held = !resumed && mandatory)

        private fun failed(stage: String): List<Effect> {
            phase = Phase.Failed
            return listOf(Effect.Event("update.gate.failed", mapOf("stage" to stage, "version" to version)), Effect.Linger)
        }

        fun handle(input: Input): List<Effect> {
            val p = phase
            return when {
                input is Input.Checked && p is Phase.Checking -> {
                    val o = input.offer
                    if (o == null) {
                        phase = Phase.Done
                        listOf(Effect.EnterApp)
                    } else {
                        offer = o
                        val shown = Effect.Event("update.gate.shown",
                            mapOf("version" to o.version, "mandatory" to o.mandatory, "staged" to input.ready, "recovery" to recovery))
                        if (input.ready) {
                            phase = countdown()
                            listOf(shown)
                        } else {
                            phase = Phase.Downloading(null)
                            listOf(shown, Effect.StartDownload)
                        }
                    }
                }
                input is Input.Progress && p is Phase.Downloading -> {
                    phase = Phase.Downloading(input.percent?.coerceIn(0, 100))
                    emptyList()
                }
                input is Input.Downloaded && p is Phase.Downloading ->
                    if (updateNow) install() else { phase = countdown(); emptyList() }
                input is Input.DownloadFailed && p is Phase.Downloading -> failed("download")
                input is Input.Tick && p is Phase.Countdown -> when {
                    !resumed && mandatory -> { phase = Phase.Countdown(COUNTDOWN_S, held = true); emptyList() }
                    !resumed -> enter("left", true)
                    p.seconds <= 1 -> install()
                    else -> { phase = Phase.Countdown(p.seconds - 1, held = false); emptyList() }
                }
                input is Input.Resumed -> {
                    resumed = input.on
                    when {
                        // Back from Settings: try again, the switch may be on.
                        input.on && p is Phase.Permission -> install()
                        input.on && p is Phase.Countdown && p.held -> { phase = Phase.Countdown(COUNTDOWN_S, held = false); emptyList() }
                        input.on -> emptyList()
                        // Settings and Android's confirm screen cover the gate
                        // on purpose; only a person leaving counts.
                        p is Phase.Permission || p is Phase.Installing -> emptyList()
                        cancellable() && p !is Phase.Failed -> enter("left", true)
                        p is Phase.Countdown -> { phase = Phase.Countdown(COUNTDOWN_S, held = true); emptyList() }
                        else -> emptyList()
                    }
                }
                input is Input.NotNow && cancellable() -> enter("not-now", false)
                input is Input.UpdateNow && p is Phase.Downloading -> { updateNow = true; emptyList() }
                input is Input.UpdateNow && p is Phase.Countdown -> install()
                input is Input.UpdateNow && p is Phase.Permission -> listOf(Effect.OpenPermissionSettings)
                input is Input.Quit && mandatory && p !is Phase.Installing && p !is Phase.Done -> {
                    phase = Phase.Done
                    listOf(Effect.Event("update.gate.quit", mapOf("version" to version)), Effect.Quit)
                }
                input is Input.NeedsPermission && p is Phase.Installing -> { phase = Phase.Permission; emptyList() }
                input is Input.InstallFailed && (p is Phase.Installing || p is Phase.Permission) -> failed("install")
                input is Input.FailedTimeout && p is Phase.Failed -> { phase = Phase.Done; listOf(Effect.EnterApp) }
                else -> emptyList()
            }
        }
    }

    /** AppUpdater's published state (stateJson) as the gate's input, for the
     *  phase the gate is in; null when it changes nothing. [latest] is the
     *  version the updater is on and [offered] the gate's: an APK of another
     *  version that was already waiting is not this download finishing. */
    fun fromUpdater(phase: Phase, status: String, waiting: String?, progress: Double?, latest: String? = null, offered: String? = null): Input? = when (phase) {
        is Phase.Downloading -> when (status) {
            "downloading", "checking" -> Input.Progress(progress?.let { (it * 100).toInt() })
            "ready" -> if (latest == null || offered == null || latest == offered) Input.Downloaded else null
            "failed", "up-to-date", "idle" -> Input.DownloadFailed
            else -> null
        }
        is Phase.Installing -> when {
            status == "ready" && waiting == "permission" -> Input.NeedsPermission
            status == "ready" || status == "failed" -> Input.InstallFailed
            else -> null
        }
        else -> null
    }

    // ── Copy ────────────────────────────────────────────────────────────

    data class Copy(
        val title: String,
        val reason: String?,
        val detail: String,
        val cancel: String,
        val primary: String,
        val buttons: Boolean,
        val primaryEnabled: Boolean,
        /** 0..100, -1 for "not known yet", null for no bar. */
        val progress: Int?,
    )

    private fun reasonLine(mandatory: Boolean, reason: String?, recovery: Boolean): String? = when {
        mandatory && reason == "min-version" -> "This version no longer works with the server."
        mandatory -> "This update fixes a serious problem."
        recovery -> "Ember didn't start properly last time."
        else -> null
    }

    fun megabytes(bytes: Long?): String? = bytes?.takeIf { it > 0 }?.let { "${(it + 524_288) / 1_048_576} MB" }

    /** What the dialog says, or null for no dialog (the splash). */
    fun copy(m: Machine, silent: Boolean): Copy? {
        val o = m.offer ?: return null
        val cancel = if (m.mandatory) "Quit Ember" else "Not now"
        val reason = reasonLine(m.mandatory, o.reason, m.recovery)
        return when (val p = m.phase) {
            is Phase.Downloading -> {
                val title = when { m.mandatory -> "Ember needs an update"; m.recovery -> "Getting a fix"; else -> "Updating Ember" }
                val size = megabytes(o.size)
                val amount = when {
                    p.percent != null && size != null -> "${p.percent}% of $size"
                    p.percent != null -> "${p.percent}%"
                    else -> size
                }
                val detail = listOfNotNull("Version ${o.version}", amount).joinToString(" · ")
                Copy(title, reason, detail, cancel, if (m.updateNow) "Updating..." else "Update now", true, !m.updateNow, p.percent ?: -1)
            }
            is Phase.Countdown -> Copy(
                "Restarting in ${p.seconds}s", reason,
                if (p.held) "Waiting until Ember is on screen again" else "Version ${o.version} is ready",
                cancel, "Update now", true, true, null,
            )
            is Phase.Installing -> Copy(
                "Installing update", null,
                if (silent) "Ember closes for a moment. Tap the notification to open it again."
                else "Android will ask you to confirm",
                cancel, "Update now", false, false, null,
            )
            is Phase.Permission -> Copy(
                "Allow Ember to install updates", reason, "Needed once so updates can install",
                cancel, "Allow", true, true, null,
            )
            is Phase.Failed -> Copy("Couldn't update", null, "Opening Ember. We'll try again next time.", cancel, "Update now", false, false, null)
            else -> null
        }
    }
}
