package app.ember.music;

import android.net.Uri;
import android.os.Bundle;
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
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EmberPlayerPlugin.class);
        registerPlugin(EmberOfflinePlugin.class);
        super.onCreate(savedInstanceState);
        injectBridgeIntoErrorPage();
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
