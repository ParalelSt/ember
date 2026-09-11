package app.ember.music

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
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

    /** Unpin while that track is mid-download: the finished file must not land
     *  in the store, because prune() has already run and nothing would ever
     *  collect it. */
    @Test fun commitAfterUnpinDropsTheFile() {
        val s = store()
        s.upsertPin("p1", "One", listOf(track("youtube:a")))
        s.removePin("p1")
        val tmp = fakeAudio(9)
        s.commitAudio("youtube:a", tmp)
        assertFalse(s.audioFileFor("youtube:a").exists())
        assertFalse("the temp file must be cleaned up, not left in the cache", tmp.exists())
        val art = fakeAudio(4)
        s.commitArt("youtube:a", art)
        assertFalse(s.artFileFor("youtube:a").exists())
        assertFalse(art.exists())
        assertEquals(0L, s.totalBytes())
    }

    /** Killed mid-download (the common case: the user swipes the app away).
     *  A fresh store over the same directory must reload the index, notice the
     *  files that did land, and offer only the rest to the downloader. */
    @Test fun aReloadedStoreResumesOnlyTheIncompleteTracks() {
        val root = Files.createTempDirectory("offline").toFile()
        val s = OfflineStore(root)
        s.upsertPin("p1", "Road", listOf(track("youtube:a"), track("youtube:b"), track("youtube:c")))
        s.commitAudio("youtube:b", fakeAudio(12))

        val reloaded = OfflineStore(root)
        assertEquals(listOf("youtube:a", "youtube:c"), reloaded.pending().map { it.second.getString("id") })
        assertEquals(setOf("youtube:b"), reloaded.trackFiles().keys)
        assertEquals(1 to 3, reloaded.progress(reloaded.pins()[0]))
    }

    @Test fun idsBecomeSafeFileNamesAndTheIndexSurvivesAReload() {
        val root = Files.createTempDirectory("offline").toFile()
        val s = OfflineStore(root)
        assertEquals("upload_ab-c_1", s.safeId("upload:ab-c/1"))
        s.upsertPin("p1", "One", listOf(track("upload:ab-c/1")))
        assertEquals("One", OfflineStore(root).pins()[0].name)
    }

    /** A full disk or revoked permission used to be swallowed inside save():
     *  pin() would report success while the index on disk stayed stale. Force
     *  the write to fail by occupying "index.json.tmp" with a directory (a
     *  File can never writeText into a path that is already a directory),
     *  then assert the failure reaches the caller AND still gets logged. */
    @Test fun saveThrowsAndLogsWhenTheIndexCannotBeWritten() {
        val root = Files.createTempDirectory("offline").toFile()
        File(root, "index.json.tmp").mkdirs()
        val s = OfflineStore(root)

        val logged = mutableListOf<JSONObject>()
        NativeLog.reset()
        NativeLog.attach { e -> logged.add(e); true }
        try {
            assertThrows(Exception::class.java) {
                s.upsertPin("p1", "One", listOf(track("youtube:a")))
            }
        } finally {
            NativeLog.reset()
        }

        assertEquals(1, logged.size)
        assertEquals("error", logged[0].getString("level"))
        assertTrue(logged[0].getString("message").startsWith("index write failed"))
    }
}
