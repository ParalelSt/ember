package app.ember.music

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject
import java.util.Locale

/** Native voice search for the web's mic button (apps/web/lib/speech/capacitorSpeech.ts).
 *  The WebView exposes webkitSpeechRecognition but every session fails, so the
 *  page talks to the system SpeechRecognizer through this instead.
 *
 *  Methods: available() -> { available, onDevice }, start({ lang }), stop(), abort().
 *  start rejects with `code` = a SpeechErrorKind when it cannot begin.
 *  Events: partial {text}, final {text}, error {kind, detail}, end {}. */
@CapacitorPlugin(
    name = "EmberSpeech",
    permissions = [Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = EmberSpeechPlugin.MIC)],
)
class EmberSpeechPlugin : Plugin() {
    companion object {
        const val MIC = "microphone"
    }

    // Main thread only: SpeechRecognizer must be created and driven there.
    private var recognizer: SpeechRecognizer? = null
    private var session: SpeechSession? = null

    @PluginMethod
    fun available(call: PluginCall) {
        val available = SpeechRecognizer.isRecognitionAvailable(context)
        // Diagnostics only: createSpeechRecognizer already goes on-device where
        // Google has the model, forcing it would reject most locales.
        val onDevice = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
        call.resolve(JSObject().put("available", available).put("onDevice", onDevice))
    }

    @PluginMethod
    fun start(call: PluginCall) {
        if (getPermissionState(MIC) != PermissionState.GRANTED) {
            requestPermissionForAlias(MIC, call, "onMicPermission")
            return
        }
        bridge.executeOnMainThread { begin(call) }
    }

    @PermissionCallback
    private fun onMicPermission(call: PluginCall) {
        // Capacitor surfaces the second argument to the page as err.code.
        if (getPermissionState(MIC) != PermissionState.GRANTED) return call.reject(MIC, "permission-denied")
        bridge.executeOnMainThread { begin(call) }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        // The recognizer still delivers its final result, then the session ends.
        bridge.executeOnMainThread { recognizer?.stopListening() }
        call.resolve()
    }

    @PluginMethod
    fun abort(call: PluginCall) {
        bridge.executeOnMainThread {
            recognizer?.cancel()
            session?.abort()
            teardown()
        }
        call.resolve()
    }

    override fun handleOnDestroy() {
        bridge.executeOnMainThread { teardown() }
        super.handleOnDestroy()
    }

    private fun begin(call: PluginCall) {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) return call.reject("no speech recognizer on this device", "unavailable")
        // A start while one is running means the page lost track of it. Drop the
        // old one silently: its end would reach the listeners the page just
        // registered for the new session and end that one instead.
        teardown()

        val lang = SpeechLocale.pick(call.getString("lang"), Locale.getDefault().toLanguageTag())
        val s = SpeechSession { event, payload -> emit(event, payload) }
        session = s
        try {
            val r = SpeechRecognizer.createSpeechRecognizer(context)
            recognizer = r
            r.setRecognitionListener(Listener(s))
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
            s.start()
            r.startListening(intent)
            call.resolve()
        } catch (e: Exception) {
            // Lands in bug reports through the web logger; the page gets the
            // same error+end as any other failure, and the start rejects so the
            // mic never shows as listening.
            NativeLog.warn("speech", "startListening failed: ${e.message}", JSONObject().put("lang", lang))
            s.start()
            emit("error", mapOf("kind" to "unavailable", "detail" to (e.message ?: e.javaClass.simpleName)))
            s.abort()
            call.reject(e.message ?: "speech recognizer failed to start", "unavailable")
        }
    }

    /** Always called on the main thread (recognizer callbacks, begin, abort).
     *  Destroys the recognizer right at `end`, synchronously: posting it would
     *  let it run after a newer start and destroy that recognizer instead. */
    private fun emit(event: String, payload: Map<String, Any?>) {
        val obj = JSObject()
        payload.forEach { (k, v) -> obj.put(k, v ?: JSONObject.NULL) }
        bridge.executeOnMainThread { notifyListeners(event, obj) }
        if (event == "end") teardown()
    }

    private fun teardown() {
        session = null
        val r = recognizer ?: return
        recognizer = null
        runCatching { r.destroy() }
    }

    private inner class Listener(private val s: SpeechSession) : RecognitionListener {
        override fun onPartialResults(bundle: Bundle?) = s.partial(texts(bundle))
        override fun onResults(bundle: Bundle?) = s.results(texts(bundle))
        override fun onError(error: Int) = s.error(error)
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}

        private fun texts(bundle: Bundle?): List<String> =
            bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
    }
}
