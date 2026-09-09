package app.ember.music

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.nio.file.Files

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class OfflineStoreTest {
    private fun track(id: String) = JSONObject("""{"id":"$id","title":"T $id","artist":"A","streamUrl":"/api/youtube/stream/x"}""")
    private fun store() = OfflineStore(Files.createTempDirectory("offline").toFile())
    // "aud", not "a": File.createTempFile rejects a prefix under 3 characters.
    private fun fakeAudio(bytes: Int): File = File.createTempFile("aud", ".m4a").apply { writeBytes(ByteArray(bytes)) }

    @Test fun pinsListTracksAndPendingUntilAudioIsCommitted() {
        val s = store()
        s.upsertPin("p1", "Road", listOf(track("youtube:a"), track("youtube:b")))
        assertEquals(listOf("youtube:a", "youtube:b"), s.pending().map { it.second.getString("id") })
        s.commitAudio("youtube:a", fakeAudio(10))
        assertEquals(listOf("youtube:b"), s.pending().map { it.second.getString("id") })
        assertEquals(setOf("youtube:a"), s.trackFiles().keys)
        assertEquals(10L, s.totalBytes())
    }

    @Test fun aTrackSharedByTwoPinsSurvivesRemovingOne() {
        val s = store()
        s.upsertPin("p1", "One", listOf(track("youtube:a")))
        s.upsertPin("liked", "Liked", listOf(track("youtube:a"), track("youtube:b")))
        s.commitAudio("youtube:a", fakeAudio(5))
        s.removePin("p1")
        assertTrue(s.audioFileFor("youtube:a").exists())
        s.removePin("liked")
        assertFalse(s.audioFileFor("youtube:a").exists())
        assertEquals(0L, s.totalBytes())
    }

    @Test fun resyncDropsTracksNoLongerListed() {
        val s = store()
        s.upsertPin("p1", "One", listOf(track("youtube:a"), track("youtube:b")))
        s.commitAudio("youtube:b", fakeAudio(3))
        s.upsertPin("p1", "One", listOf(track("youtube:a")))
        assertFalse(s.audioFileFor("youtube:b").exists())
        assertEquals(listOf("youtube:a"), s.pins()[0].trackIds)
    }

    @Test fun clearAllDeletesTheFilesNotJustTheIndex() {
        val root = Files.createTempDirectory("offline").toFile()
        val s = OfflineStore(root)
        s.upsertPin("p1", "One", listOf(track("youtube:a")))
        s.commitAudio("youtube:a", fakeAudio(7))
        s.clearAll()
        assertFalse(s.audioFileFor("youtube:a").exists())
        assertEquals(0L, s.totalBytes())
        assertEquals(emptyList<String>(), OfflineStore(root).pins().map { it.id })
    }

    @Test fun idsBecomeSafeFileNamesAndTheIndexSurvivesAReload() {
        val root = Files.createTempDirectory("offline").toFile()
        val s = OfflineStore(root)
        assertEquals("upload_ab-c_1", s.safeId("upload:ab-c/1"))
        s.upsertPin("p1", "One", listOf(track("upload:ab-c/1")))
        assertEquals("One", OfflineStore(root).pins()[0].name)
    }
}
