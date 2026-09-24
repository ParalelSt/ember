package app.ember.music

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import java.io.File

/** The shared case table, read straight from the web folder
 *  (`apps/web/lib/autoCache/policy.cases.json`; Gradle hands the path over as
 *  `ember.autoCacheCases` and reruns the tests when the file changes), so the
 *  Kotlin port and policy.ts are checked against the same file and cannot
 *  drift. Every case is its own test. Plain JVM: the policy is pure. */
@Suppress("UNCHECKED_CAST")
object PolicyCases {
    val root: Map<String, Any?> by lazy {
        val path = System.getProperty("ember.autoCacheCases")
            ?: error("ember.autoCacheCases is not set; run through Gradle (app/build.gradle sets it)")
        MiniJson.parse(File(path).readText()) as Map<String, Any?>
    }

    fun obj(v: Any?): Map<String, Any?> = v as Map<String, Any?>
    fun list(v: Any?): List<Any?> = v as List<Any?>
    fun strings(v: Any?): List<String> = list(v).map { it as String }
    private fun num(v: Any?): Number = v as Number

    /** defaults.input shallow-merged with the case's input. */
    fun input(caseInput: Any?): AutoCachePolicy.Input {
        val m = LinkedHashMap(obj(obj(root["defaults"])["input"]))
        m.putAll(obj(caseInput ?: emptyMap<String, Any?>()))
        return toInput(m)
    }

    fun longMap(v: Any?): Map<String, Long> = (v as Map<String, Any?>?)?.mapValues { num(it.value).toLong() } ?: emptyMap()
    fun intMap(v: Any?): Map<String, Int> = (v as Map<String, Any?>?)?.mapValues { num(it.value).toInt() } ?: emptyMap()

    fun toInput(m: Map<String, Any?>): AutoCachePolicy.Input = AutoCachePolicy.Input(
        queue = list(m["queue"]).map { t ->
            val o = obj(t)
            AutoCachePolicy.Track((o["id"] as String?).orEmpty(), o["streamUrl"] as String?, o["unavailableAt"] as String?)
        },
        index = num(m["index"]).toInt(),
        loopMode = AutoCachePolicy.LoopMode.valueOf((m["loopMode"] as String).uppercase()),
        contextType = (m["context"] as Map<String, Any?>?)?.get("type") as String?,
        baseCount = num(m["baseCount"]).toInt(),
        playedSec = num(m["playedSec"]).toDouble(),
        bufferedToEnd = m["bufferedToEnd"] as Boolean?,
        playing = m["playing"] as Boolean,
        online = m["online"] as Boolean,
        metered = m["metered"] as Boolean?,
        saveData = m["saveData"] as Boolean,
        batterySaver = m["batterySaver"] as Boolean,
        enabled = m["enabled"] as Boolean,
        allowMetered = m["allowMetered"] as Boolean,
        requestCurrent = m["requestCurrent"] as Boolean,
        cached = strings(m["cached"]).toCollection(LinkedHashSet()),
        inFlight = m["inFlight"] as String?,
        bytes = num(m["bytes"]).toLong(),
        cap = num(m["cap"]).toLong(),
        sizes = m["sizes"]?.let { longMap(it) },
        expectedBytes = m["expectedBytes"]?.let { longMap(it) },
        backoffUntil = longMap(m["backoffUntil"]),
        attempts = intMap(m["attempts"]),
        nowMs = num(m["nowMs"]).toLong(),
    )

    fun action(a: AutoCachePolicy.Action): Map<String, Any?> = when (a) {
        is AutoCachePolicy.Action.Start -> mapOf("kind" to "start", "id" to a.id)
        is AutoCachePolicy.Action.Abort -> mapOf("kind" to "abort", "id" to a.id)
        is AutoCachePolicy.Action.Idle ->
            if (a.wakeAtMs != null) mapOf("kind" to "idle", "reason" to a.reason, "wakeAtMs" to a.wakeAtMs)
            else mapOf("kind" to "idle", "reason" to a.reason)
    }

    fun expectedAction(v: Any?): Map<String, Any?> = obj(v).mapValues { (k, x) -> if (k == "wakeAtMs") num(x).toLong() else x }

    fun result(v: Any?): AutoCachePolicy.Result {
        val o = obj(v)
        return when (o["kind"]) {
            "done" -> AutoCachePolicy.Result.Done(num(o["bytes"]).toLong())
            "retry-after" -> AutoCachePolicy.Result.RetryAfter(num(o["status"]).toInt(), (o["seconds"] as Number?)?.toDouble())
            "gone" -> AutoCachePolicy.Result.Gone
            "failed" -> AutoCachePolicy.Result.Failed
            else -> error("unknown result ${o["kind"]}")
        }
    }

    fun section(name: String): List<Array<Any>> =
        list(root[name]).map { c -> arrayOf(obj(c)["name"] as String, obj(c)) }
}

@RunWith(Parameterized::class)
class AutoCachePolicyCaseTest(@Suppress("unused") private val name: String, private val case: Map<String, Any?>) {
    companion object {
        @JvmStatic @Parameterized.Parameters(name = "policy: {0}")
        fun cases(): List<Array<Any>> = PolicyCases.section("policy")
    }

    @Test fun matchesTheTable() {
        val input = PolicyCases.input(case["input"])
        assertEquals("desiredIds", PolicyCases.strings(case["expectedDesired"]), AutoCachePolicy.desiredIds(input))
        assertEquals("nextAction", PolicyCases.expectedAction(case["expectedAction"]), PolicyCases.action(AutoCachePolicy.nextAction(input)))
    }
}

@RunWith(Parameterized::class)
class AutoCacheOnResultCaseTest(@Suppress("unused") private val name: String, private val case: Map<String, Any?>) {
    companion object {
        @JvmStatic @Parameterized.Parameters(name = "onResult: {0}")
        fun cases(): List<Array<Any>> = PolicyCases.section("onResult")
    }

    /** Steps run in order, each feeding its ledger into the next. */
    @Test fun matchesTheTable() {
        var input = PolicyCases.input(case["input"])
        PolicyCases.list(case["steps"]).forEachIndexed { i, s ->
            val step = PolicyCases.obj(s)
            (step["nowMs"] as Number?)?.let { input = input.copy(nowMs = it.toLong()) }
            val ledger = AutoCachePolicy.onResult(input, step["id"] as String, PolicyCases.result(step["result"]))
            val want = PolicyCases.obj(step["expected"])
            assertEquals("step $i backoffUntil", PolicyCases.longMap(want["backoffUntil"]), ledger.backoffUntil)
            assertEquals("step $i attempts", PolicyCases.intMap(want["attempts"]), ledger.attempts)
            assertEquals("step $i drop", want["drop"], ledger.drop)
            input = input.copy(backoffUntil = ledger.backoffUntil, attempts = ledger.attempts)
        }
    }
}

@RunWith(Parameterized::class)
class AutoCacheEvictionOrderCaseTest(@Suppress("unused") private val name: String, private val case: Map<String, Any?>) {
    companion object {
        @JvmStatic @Parameterized.Parameters(name = "evictionOrder: {0}")
        fun cases(): List<Array<Any>> = PolicyCases.section("evictionOrder")
    }

    @Test fun matchesTheTable() {
        val input = PolicyCases.input(case["input"])
        assertEquals(PolicyCases.strings(case["expected"]), AutoCachePolicy.evictionOrder(input, PolicyCases.longMap(case["lastUsed"])))
    }
}

@RunWith(Parameterized::class)
class AutoCacheEvictToFitCaseTest(@Suppress("unused") private val name: String, private val case: Map<String, Any?>) {
    companion object {
        @JvmStatic @Parameterized.Parameters(name = "evictToFit: {0}")
        fun cases(): List<Array<Any>> = PolicyCases.section("evictToFit")
    }

    @Test fun matchesTheTable() {
        val input = PolicyCases.input(case["input"])
        val want = PolicyCases.obj(case["expected"])
        val got = AutoCachePolicy.evictToFit(input, PolicyCases.longMap(case["lastUsed"]), (case["incomingBytes"] as Number).toLong())
        assertEquals(PolicyCases.strings(want["evict"]), got.evict)
        assertEquals(want["fits"], got.fits)
    }
}

class AutoCachePolicyTest {
    /** A missing or emptied table must fail, not pass with zero cases. */
    @Test fun theSharedTableIsLoadedWithEverySection() {
        for (s in listOf("policy", "onResult", "evictionOrder", "evictToFit")) {
            assertTrue("$s has cases", PolicyCases.list(PolicyCases.root[s]).isNotEmpty())
        }
    }

    @Test fun androidNeverRequestsTheCurrentTrack() {
        val input = PolicyCases.input(null).copy(requestCurrent = false)
        val current = input.queue[input.index].id
        assertTrue(current in AutoCachePolicy.desiredIds(input))
        assertEquals(AutoCachePolicy.Action.Start(input.queue[input.index + 1].id), AutoCachePolicy.nextAction(input))
    }

    @Test fun theNumbersMatchTheReadme() {
        assertEquals(2, AutoCachePolicy.N)
        assertEquals(6L * 1024 * 1024, AutoCachePolicy.EXPECTED_BYTES_DEFAULT)
        assertEquals(listOf(15L, 30L, 60L, 120L), AutoCachePolicy.BACKOFF_SEC.toList())
    }

    @Test fun theJsonReaderHandlesEscapesAndNumbers() {
        val v = PolicyCases.obj(MiniJson.parse("""{"a":"x\"yé","b":[1,2.5,-3e2,true,null],"c":{}}"""))
        assertEquals("x\"yé", v["a"])
        assertEquals(listOf(1L, 2.5, -300.0, true, null), v["b"])
        assertEquals(emptyMap<String, Any?>(), v["c"])
    }
}
