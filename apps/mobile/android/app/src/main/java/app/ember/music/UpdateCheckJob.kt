package app.ember.music

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context

/** The updater's check every 6 hours, with the app closed too. Android's own
 *  JobScheduler (no WorkManager dependency): it runs only with a network,
 *  survives a reboot (setPersisted, hence RECEIVE_BOOT_COMPLETED), and
 *  batches with other apps' work. AppUpdater still checks the network
 *  itself before downloading. */
class UpdateCheckJob : JobService() {
    companion object {
        const val JOB_ID = 72_011

        /** Idempotent: an already scheduled job is left alone, so its clock
         *  does not restart on every app start. */
        fun schedule(context: Context) {
            val js = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as? JobScheduler ?: return
            if (js.allPendingJobs.any { it.id == JOB_ID }) return
            val job = JobInfo.Builder(JOB_ID, ComponentName(context, UpdateCheckJob::class.java))
                .setPeriodic(UpdateRules.PERIOD_MS)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build()
            js.schedule(job)
        }
    }

    override fun onStartJob(params: JobParameters): Boolean {
        AppUpdater.init(applicationContext)
        AppUpdater.check(manual = false, reason = "periodic") { jobFinished(params, false) }
        return true
    }

    /** Stopped early (the network went): the next period tries again. */
    override fun onStopJob(params: JobParameters): Boolean = false
}
