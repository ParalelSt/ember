package app.ember.music

import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback

/** The phone's Back button, inside Ember. Without this Android closed the
 *  app on the first press, whatever was open.
 *
 *  The page already speaks Back: the player and search sheets add a history
 *  entry when they open and close on popstate (the web's useBackDismiss), and
 *  every page change is a history entry. So Back steps back through the
 *  page's history; only on the first page does it leave, and then the app
 *  goes to the background (like Home) instead of being closed, so the music
 *  keeps its screen and coming back is instant. */
object BackButton {
    fun install(activity: ComponentActivity, webView: () -> WebView?, leave: () -> Unit) {
        activity.onBackPressedDispatcher.addCallback(activity, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val web = webView()
                if (web != null && web.canGoBack()) web.goBack() else leave()
            }
        })
    }
}
