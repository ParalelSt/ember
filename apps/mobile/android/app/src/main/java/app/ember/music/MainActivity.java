package app.ember.music;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSExport;
import com.getcapacitor.Logger;
import com.getcapacitor.PluginHandle;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class MainActivity extends BridgeActivity {

    /** The document-start script currently publishing the insets, so a new
     *  set of insets can replace it rather than pile up. */
    private ScriptHandler insetScript;
    /** The script last published, so identical insets are a no-op. */
    private String publishedInsets = "";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EmberPlayerPlugin.class);
        registerPlugin(EmberOfflinePlugin.class);
        registerPlugin(EmberSpeechPlugin.class);
        super.onCreate(savedInstanceState);
        injectBridgeIntoErrorPage();
        publishSafeAreaInsets();
    }

    /**
     * Feed the window's real insets to the page as --ember-inset-* (see
     * SafeAreaInsets).
     *
     * The app targets SDK 35, so Android 15 draws the status bar and the
     * three-button navigation bar OVER the WebView; the WebView does not
     * report either through env(safe-area-inset-*), so without this the
     * bottom nav sits under the system buttons. Below SDK 35 the decor
     * still fits the system windows, the WebView is laid out inside them
     * and these insets arrive as 0 — which is correct there, and means
     * nothing about those devices changes.
     *
     * Deliberately NOT Capacitor's own android.adjustMarginsForEdgeToEdge:
     * that sets margins on the WebView, which letterboxes the page instead
     * of telling it where the edges are, and still leaves env() at 0.
     */
    private void publishSafeAreaInsets() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        final WebView webView = getBridge().getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets i = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            float density = getResources().getDisplayMetrics().density;
            applySafeAreaInsets(
                SafeAreaInsets.script(
                    SafeAreaInsets.cssPx(i.top, density),
                    SafeAreaInsets.cssPx(i.right, density),
                    SafeAreaInsets.cssPx(i.bottom, density),
                    SafeAreaInsets.cssPx(i.left, density)
                )
            );
            // Returned unconsumed on purpose: consuming them would hide the
            // insets from anything Capacitor or a plugin adds to the view.
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(webView);
    }

    /**
     * Run one insets script against the page that is open, and leave it
     * registered as a document-start script so a navigation (Ember is a
     * server app: every route change can be a real load) does not lose it.
     */
    private void applySafeAreaInsets(String js) {
        if (js.equals(publishedInsets)) return;
        publishedInsets = js;
        WebView webView = getBridge().getWebView();
        try {
            webView.evaluateJavascript(js, null);
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
            if (insetScript != null) {
                insetScript.remove();
                insetScript = null;
            }
            insetScript = WebViewCompat.addDocumentStartJavaScript(webView, js, Collections.singleton("*"));
        } catch (Exception e) {
            // A page with no insets published still renders; it just sits
            // under the system bars, which is where it sat before. Never
            // take the app down for it.
            Logger.error("safe-area inset publish failed", e);
        }
    }

    /**
     * Give the bundled offline page (server.errorPath) the Capacitor runtime.
     *
     * Capacitor injects its JS as a document-start script scoped to the SERVER
     * origin, and WebViewLocalServer explicitly skips injection for the error
     * URL, so https://localhost/offline.html loads with no window.Capacitor at
     * all: no plugin, no convertFileSrc, nothing to play downloads with. The
     * native message channel ("androidBridge") is already allowed on that
     * origin, so registering the same runtime for it is the only missing half.
     * Only the two plugins the page calls are exported: EmberOffline for the
     * downloads, MediaSession for real lock-screen controls (the WebView does
     * not publish a system session for navigator.mediaSession on its own).
     */
    private void injectBridgeIntoErrorPage() {
        String errorUrl = getBridge() == null ? null : getBridge().getErrorUrl();
        if (errorUrl == null || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        List<PluginHandle> exported = new ArrayList<>();
        for (String name : new String[] { "EmberOffline", "MediaSession" }) {
            PluginHandle p = getBridge().getPlugin(name);
            if (p != null) exported.add(p);
        }
        if (exported.isEmpty()) return;
        String origin = Uri.parse(errorUrl).buildUpon().path(null).fragment(null).clearQuery().build().toString();
        try {
            // Same pieces, in the same order, as Capacitor's own JSInjector.
            String js =
                JSExport.getGlobalJS(this, false, false) +
                "\n\nwindow.WEBVIEW_SERVER_URL = '" + origin + "';\n\n" +
                JSExport.getBridgeJS(this) +
                "\n\n" +
                JSExport.getPluginJS(exported);
            WebViewCompat.addDocumentStartJavaScript(getBridge().getWebView(), js, Collections.singleton(origin));
        } catch (Exception e) {
            // A page without the bridge still renders its "Connecting to
            // server…" fallback, so this must never take the app down.
            Logger.error("offline page bridge injection failed", e);
        }
    }
}
