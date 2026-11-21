import { TransferReview } from '@/components/import/TransferReview';
import { serverUiMode } from '@/components/providers/serverUiMode';

/** The songs a transfer was not sure about, on one page. `?job=` names the
 *  transfer; without it, the one the progress chip follows. */
async function NewTransferReviewPage({ searchParams }: PageProps<'/transfer/review'>) {
  const q = await searchParams;
  const job = Array.isArray(q.job) ? q.job[0] : q.job;
  return <TransferReview jobId={job} />;
}

/** The new look's page, or on a device on the Classic look the frozen one
 *  (docs/classic-look.md), imported only then. */
export default async function TransferReviewPage(props: Parameters<typeof NewTransferReviewPage>[0]) {
  if ((await serverUiMode()) === 'legacy') {
    const { default: Legacy } = await import('@legacy/app/transfer/review/page');
    return <Legacy {...props} />;
  }
  return await NewTransferReviewPage(props);
}
