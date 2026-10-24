package app.ember.music

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager

/** Where the phone is, for the car's Radio > Nearby: the last location
 *  Android already knows, only when the app may read it (the web app's
 *  "Use my location" asks; this never does), and never more exact than
 *  ~0.1 degree (about 10 km). Null otherwise: Nearby then lists Croatia. */
object RadioPlaces {
    /** The country Nearby stands in with (the web app's RADIO_HOME_COUNTRY). */
    const val HOME_COUNTRY = "HR"

    fun rounded(lat: Double, lng: Double): Pair<Double, Double> =
        Math.round(lat * 10) / 10.0 to Math.round(lng * 10) / 10.0

    fun lastKnown(context: Context): Pair<Double, Double>? = runCatching {
        val allowed = listOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
            .any { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
        if (!allowed) return null
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager? ?: return null
        lm.getProviders(true).mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
            .maxByOrNull { it.time }
            ?.let { rounded(it.latitude, it.longitude) }
    }.getOrNull()
}
