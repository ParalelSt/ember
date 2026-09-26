package app.ember.music;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSExport;
import com.getcapacitor.Logger;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.WebViewListener;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class MainActivity extends BridgeActivity {

    /** The document-start script currently publishing the insets, so a new
     *  set of insets can replace it rather than pile up. */
    private ScriptHandler insetScript;
    /** The script last published, so identical insets are a no-op. */
    private String publishedInsets = "";
    /** The document-start script giving the offline page the theme's
     *  variables, so a new theme replaces it rather than piling up. */
    private ScriptHandler themeScript;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EmberPlayerPlugin.class);
        registerPlugin(EmberOfflinePlugin.class);
        registerPlugin(EmberSpeechPlugin.class);
        registerPlugin(EmberThemePlugin.class);
        super.onCreate(savedInstanceState);
        WebSecurity.INSTANCE.lockDown(getBridge() == null ? null : getBridge().getWebView());
        injectBridgeIntoErrorPage();
        publishSafeAreaInsets();
        applyStoredTheme();
        BackButton.INSTANCE.install(this, () -> getBridge() == null ? null : getBridge().getWebView(), () -> {
            moveTaskToBack(true);
            return kotlin.Unit.INSTANCE;
        });
    }

    /**
     * The last theme the page reported (EmberThemePlugin), applied before the
     * page loads: the blank between the splash and the first byte is the
     * theme's background, not white or black, and the bars match it. A phone
     * that never reported one opens on Ember's background. The splash itself
     * stays the brand red on black.
     */
    private void applyStoredTheme() {
        SharedPreferences prefs = getSharedPreferences(ThemeColors.PREFS, Context.MODE_PRIVATE);
        Integer color = ThemeColors.parseHex(prefs.getString(ThemeColors.KEY_BACKGROUND, null));
        if (color == null) color = ThemeColors.parseHex(ThemeColors.DEFAULT_BACKGROUND);
        applyTheme(color, prefs.getString(ThemeColors.KEY_VARS, null));
    }

    /**
     * Paint the chrome in one theme and hand its variables to the offline
     * page (a different origin, so it never sees the account or the cookie).
     * Main thread only; EmberThemePlugin calls it on every theme change.
     */
    public void applyTheme(int background, String varsJson) {
        try {
            WebView webView = getBridge() == null ? null : getBridge().getWebView();
            ThemeColors.applyToWindow(this, webView, background);
            publishThemeToErrorPage(webView, ThemeColors.script(ThemeColors.parseVars(varsJson)));
        } catch (Exception e) {
            // An unthemed window is still a working app.
            Logger.error("theme apply failed", e);
        }
    }

    private void publishThemeToErrorPage(WebView webView, String js) {
        String errorUrl = getBridge() == null ? null : getBridge().getErrorUrl();
        if (webView == null || errorUrl == null || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        if (themeScript != null) {
            themeScript.remove();
            themeScript = null;
        }
        themeScript = WebViewCompat.addDocumentStartJavaScript(webView, js, Collections.singleton(errorOrigin(errorUrl)));
    }

    /** The origin the bundled offline page is served from (https://localhost). */
    private static String errorOrigin(String errorUrl) {
        return Uri.parse(errorUrl).buildUpon().path(null).fragment(null).clearQuery().build().toString();
    }

    /**
     * Feed the window's real insets to the page as --ember-inset-* (see
     * SafeAreaInsets).
     *
     * The app targets SDK 35, so Android 15 draws the status bar and the
     * navigation bar (three buttons or the gesture pill) OVER the WebView;
     * the WebView does not report either through env(safe-area-inset-*), so
     * without this the page's bottom controls sit under the system buttons.
     * Below SDK 35 the decor still fits the system windows, the WebView is
     * laid out inside them and these insets arrive as 0, which is correct
     * there.
     *
     * Deliberately NOT Capacitor's own android.adjustMarginsForEdgeToEdge:
     * that sets margins on the WebView, which letterboxes the page (the
     * strips under the bars show the window, not the page's own bars), and
     * its listener returns the insets consumed, so the page learns nothing
     * and a sheet or the offline page cannot stand off the bars itself.
     */
    private void publishSafeAreaInsets() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        final WebView webView = getBridge().getWebView();
        SafeAreaInsets.install(webView, () -> getResources().getDisplayMetrics().density, js -> {
            applySafeAreaInsets(js);
            return kotlin.Unit.INSTANCE;
        });
        // Every finished load gets the last insets again, on top of the
        // document-start script: a WebView without DOCUMENT_START_SCRIPT, or
        // a load that committed before the script was registered, still ends
        // up with them, and they are only ever sent again when they change.
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView view) {
                if (!publishedInsets.isEmpty()) evaluateInsets(view, publishedInsets);
            }
        });
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
        evaluateInsets(webView, js);
        try {
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

    private static void evaluateInsets(WebView webView, String js) {
        try {
            webView.evaluateJavascript(js, null);
        } catch (Exception e) {
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
        String origin = errorOrigin(errorUrl);
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
