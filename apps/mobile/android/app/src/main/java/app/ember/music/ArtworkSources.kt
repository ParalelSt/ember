package app.ember.music

import android.content.Context
import android.net.Uri
import androidx.media3.common.util.BitmapLoader
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.TransferListener
import androidx.media3.session.CacheBitmapLoader
import com.google.common.util.concurrent.MoreExecutors
import java.util.concurrent.Executors

/** Where the notification, the lock screen and the car's now-playing screen
 *  get a song's cover.
 *
 *  Media3's default loader fetches without the Ember cookie, so a cover on
 *  the Ember server itself (an upload's /api/uploads/<id>/art, which needs a
 *  signed-in member) never showed. The cookie must not go anywhere else
 *  though: YouTube's covers sit on Google's hosts, and ServerApi.http puts
 *  the session cookie on every request it makes. So each cover picks its
 *  client by where it lives. */
object ArtworkSources {
    fun isServer(uri: Uri, baseUrl: String): Boolean = uri.toString().startsWith("$baseUrl/")

    /** HTTP(S) through [authed] for the Ember server, [plain] for any other
     *  host; files and content URIs as usual. */
    fun dataSourceFactory(context: Context, baseUrl: String, authed: DataSource.Factory, plain: DataSource.Factory): DataSource.Factory =
        DefaultDataSource.Factory(context, ByHost(baseUrl, authed, plain))

    /** One per process, like the service's cache: a service created again
     *  must not leave another thread behind. */
    private val decodeThread by lazy { MoreExecutors.listeningDecorator(Executors.newSingleThreadExecutor()) }

    fun bitmapLoader(context: Context, baseUrl: String, authed: DataSource.Factory, plain: DataSource.Factory): BitmapLoader =
        CacheBitmapLoader(DataSourceBitmapLoader(decodeThread, dataSourceFactory(context, baseUrl, authed, plain)))

    class ByHost(private val baseUrl: String, private val authed: DataSource.Factory, private val plain: DataSource.Factory) : DataSource.Factory {
        override fun createDataSource(): DataSource = object : DataSource {
            private val listeners = ArrayList<TransferListener>()
            private var inner: DataSource? = null

            override fun addTransferListener(transferListener: TransferListener) { listeners.add(transferListener) }

            override fun open(dataSpec: DataSpec): Long {
                val source = (if (isServer(dataSpec.uri, baseUrl)) authed else plain).createDataSource()
                listeners.forEach(source::addTransferListener)
                inner = source
                return source.open(dataSpec)
            }

            override fun read(buffer: ByteArray, offset: Int, length: Int): Int = inner!!.read(buffer, offset, length)
            override fun getUri(): Uri? = inner?.uri
            override fun getResponseHeaders(): Map<String, List<String>> = inner?.responseHeaders ?: emptyMap()
            override fun close() {
                try { inner?.close() } finally { inner = null }
            }
        }
    }
}
