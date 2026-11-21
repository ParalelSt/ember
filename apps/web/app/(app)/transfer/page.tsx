import { TransferFlow } from '@/components/import/TransferFlow';
import { serverUiMode } from '@/components/providers/serverUiMode';

/** Transfer songs into Ember: one page, opened from the Transfer button on
 *  Liked songs and from Settings > Library. `?to=playlist` starts on the
 *  new-playlist card; `?from=` is where Back and Start return to. */
async function NewTransferPage({ searchParams }: PageProps<'/transfer'>) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return <TransferFlow initialDestination={one(q.to) === 'playlist' ? 'playlist' : 'liked'} from={one(q.from)} />;
}

/** The new look's page, or on a device on the Classic look the frozen one
 *  (RULES.md "Classic look"), imported only then. */
export default async function TransferPage(props: Parameters<typeof NewTransferPage>[0]) {
  if ((await serverUiMode()) === 'legacy') {
    const { default: Legacy } = await import('@legacy/app/transfer/page');
    return <Legacy {...props} />;
  }
  return await NewTransferPage(props);
}
