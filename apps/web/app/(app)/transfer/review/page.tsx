import { TransferReview } from '@/components/import/TransferReview';

/** The songs a transfer was not sure about, on one page. `?job=` names the
 *  transfer; without it, the one the progress chip follows. */
export default async function TransferReviewPage({ searchParams }: PageProps<'/transfer/review'>) {
  const q = await searchParams;
  const job = Array.isArray(q.job) ? q.job[0] : q.job;
  return <TransferReview jobId={job} />;
}
