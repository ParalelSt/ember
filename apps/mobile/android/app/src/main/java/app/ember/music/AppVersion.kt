package app.ember.music

import android.content.Context

/** The app's own version (build.gradle's versionName), for the page's
 *  settings footer: the web build and this app are released separately. */
object AppVersion {
    @Suppress("DEPRECATION")
    fun name(context: Context): String? = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName
    }.getOrNull()?.trim()?.takeIf { it.isNotEmpty() }
}
