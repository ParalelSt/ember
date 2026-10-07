import { TransferFlow } from '@/components/import/TransferFlow';

/** Transfer songs into Ember: one page, opened from the Transfer button on
 *  Liked songs and from Settings > Library. `?to=playlist` starts on the
 *  new-playlist card; `?from=` is where Back and Start return to. */
export default async function TransferPage({ searchParams }: PageProps<'/transfer'>) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return <TransferFlow initialDestination={one(q.to) === 'playlist' ? 'playlist' : 'liked'} from={one(q.from)} />;
}
