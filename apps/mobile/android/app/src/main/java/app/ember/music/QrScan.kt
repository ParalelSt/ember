package app.ember.music

import android.app.Activity
import android.content.Context
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/**
 * "Scan QR code" in the page (apps/web/lib/qrScan/nativeScan.ts), through
 * EmberAppPlugin.scanQr: Google's code scanner, which shows its own camera
 * screen from Play services, so Ember needs no camera permission for it.
 * QR codes only. The page checks what was read (an Ember sign-in link for
 * its own server, or a short code); this only reports it.
 *
 * The answer is always resolved, never rejected:
 *   { status: "scanned", value }  something was read
 *   { status: "cancelled" }       Back or close in the scanner
 *   { status: "unavailable" }     no Play services, no scanner module yet,
 *                                 any other failure: the page scans itself
 */
sealed class QrScanOutcome {
    data class Scanned(val value: String) : QrScanOutcome()
    object Cancelled : QrScanOutcome()
    object Unavailable : QrScanOutcome()
}

object QrScan {
    /** The page's answer, as the plugin resolves it. */
    fun answer(outcome: QrScanOutcome): Map<String, String> = when (outcome) {
        is QrScanOutcome.Scanned -> mapOf("status" to "scanned", "value" to outcome.value)
        QrScanOutcome.Cancelled -> mapOf("status" to "cancelled")
        QrScanOutcome.Unavailable -> mapOf("status" to "unavailable")
    }

    /** A read code. A QR with no text (binary content) reads as "", which the
     *  page then calls "not an Ember sign-in code". */
    fun fromBarcode(rawValue: String?): QrScanOutcome = QrScanOutcome.Scanned(rawValue ?: "")

    /** A failed scan. Closing the scanner is a cancel; a second scan while one
     *  is up (which the page already avoids) is ignored the same way. Every
     *  other failure lets the page's own scanner take over. */
    fun fromError(errorCode: Int?): QrScanOutcome = when (errorCode) {
        MlKitException.CODE_SCANNER_CANCELLED,
        MlKitException.CODE_SCANNER_TASK_IN_PROGRESS -> QrScanOutcome.Cancelled
        else -> QrScanOutcome.Unavailable
    }

    /** The scanner module is not on the phone yet: worth asking Play services
     *  for it, so the next scan has it (the manifest asks at install too). */
    fun needsModule(errorCode: Int?): Boolean =
        errorCode == MlKitException.CODE_SCANNER_UNAVAILABLE || errorCode == MlKitException.UNAVAILABLE

    /** The real scan. Call on the main thread; [done] is called once. */
    fun start(activity: Activity, done: (QrScanOutcome) -> Unit) {
        if (!hasPlayServices(activity)) return done(QrScanOutcome.Unavailable)
        val scanner = try {
            GmsBarcodeScanning.getClient(
                activity,
                GmsBarcodeScannerOptions.Builder()
                    .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                    .enableAutoZoom()
                    .build(),
            )
        } catch (e: Exception) {
            return done(QrScanOutcome.Unavailable)
        }
        try {
            scanner.startScan()
                .addOnSuccessListener { done(fromBarcode(it.rawValue)) }
                .addOnCanceledListener { done(QrScanOutcome.Cancelled) }
                .addOnFailureListener { e ->
                    val code = (e as? MlKitException)?.errorCode
                    if (needsModule(code)) requestModule(activity, scanner)
                    done(fromError(code))
                }
        } catch (e: Exception) {
            done(QrScanOutcome.Unavailable)
        }
    }

    private fun hasPlayServices(context: Context): Boolean = try {
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    } catch (e: Exception) {
        false
    }

    private fun requestModule(context: Context, scanner: GmsBarcodeScanner) {
        try {
            ModuleInstall.getClient(context)
                .installModules(ModuleInstallRequest.newBuilder().addApi(scanner).build())
        } catch (e: Exception) {
            // Nothing to do: the page scanner covers this scan, and the next
            // one tries again.
        }
    }
}
