package app.ember.music

import android.content.Context
import android.net.Uri
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.ResolvingDataSource
import java.util.concurrent.ConcurrentHashMap

/** Downloaded songs play from the phone. Every song keeps its stream address
 *  and carries its track id as the load key (TrackItems); when the song
 *  starts loading, a downloaded copy is used instead. Deciding then, rather
 *  than when the queue is built, means a song downloaded after it was queued
 *  still plays from the phone, and one whose download was removed streams. */
object OfflineAudio {
    fun dataSourceFactory(context: Context, streams: DataSource.Factory, offline: OfflineStore): DataSource.Factory =
        ResolvingDataSource.Factory(DefaultDataSource.Factory(context, streams), LocalFirst(offline))

    class LocalFirst(private val offline: OfflineStore) : ResolvingDataSource.Resolver {
        /** The choice made when each song started loading. A seek reopens the
         *  song further in, and has to read the same bytes it started with. */
        private val local = ConcurrentHashMap<String, Boolean>()

        override fun resolveDataSpec(spec: DataSpec): DataSpec {
            val id = spec.key ?: return spec
            val file = offline.audioFileFor(id)
            val useLocal = if (spec.position == 0L) file.exists().also { local[id] = it } else local[id] ?: file.exists()
            return if (useLocal) spec.withUri(Uri.fromFile(file)) else spec
        }
    }
}
