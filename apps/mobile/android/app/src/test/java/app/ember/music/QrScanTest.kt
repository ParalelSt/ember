package app.ember.music

import com.google.mlkit.common.MlKitException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The answer EmberAppPlugin.scanQr gives the page (apps/web/lib/qrScan/
 * nativeScan.ts reads it): scanned, cancelled, or unavailable, which makes
 * the page open its own scanner. Cancelling must never open that one on top.
 */
class QrScanTest {
    @Test fun `a read code is scanned with its text`() {
        assertEquals(
            mapOf("status" to "scanned", "value" to "https://ember.example.com/link/abc"),
            QrScan.answer(QrScan.fromBarcode("https://ember.example.com/link/abc")),
        )
    }

    @Test fun `a QR with no text is scanned as empty, for the page to refuse`() {
        assertEquals(mapOf("status" to "scanned", "value" to ""), QrScan.answer(QrScan.fromBarcode(null)))
    }

    @Test fun `closing the scanner is a cancel, not a fallback`() {
        assertEquals(QrScanOutcome.Cancelled, QrScan.fromError(MlKitException.CODE_SCANNER_CANCELLED))
        assertEquals(mapOf("status" to "cancelled"), QrScan.answer(QrScanOutcome.Cancelled))
    }

    @Test fun `a scan already running is ignored, not a second scanner`() {
        assertEquals(QrScanOutcome.Cancelled, QrScan.fromError(MlKitException.CODE_SCANNER_TASK_IN_PROGRESS))
    }

    @Test fun `every other failure lets the page scan`() {
        for (code in listOf(
            MlKitException.CODE_SCANNER_UNAVAILABLE,
            MlKitException.UNAVAILABLE,
            MlKitException.CODE_SCANNER_CAMERA_PERMISSION_NOT_GRANTED,
            MlKitException.CODE_SCANNER_APP_NAME_UNAVAILABLE,
            MlKitException.CODE_SCANNER_PIPELINE_INITIALIZATION_ERROR,
            MlKitException.CODE_SCANNER_PIPELINE_INFERENCE_ERROR,
            MlKitException.CODE_SCANNER_GOOGLE_PLAY_SERVICES_VERSION_TOO_OLD,
            MlKitException.INTERNAL,
            null,
        )) {
            assertEquals("code $code", QrScanOutcome.Unavailable, QrScan.fromError(code))
        }
        assertEquals(mapOf("status" to "unavailable"), QrScan.answer(QrScanOutcome.Unavailable))
    }

    @Test fun `only a missing module asks Play services to fetch it`() {
        assertTrue(QrScan.needsModule(MlKitException.CODE_SCANNER_UNAVAILABLE))
        assertTrue(QrScan.needsModule(MlKitException.UNAVAILABLE))
        assertFalse(QrScan.needsModule(MlKitException.CODE_SCANNER_CANCELLED))
        assertFalse(QrScan.needsModule(null))
    }
}
