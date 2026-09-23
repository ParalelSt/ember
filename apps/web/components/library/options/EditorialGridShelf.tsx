import type { ReactNode } from 'react';
import Link from 'next/link';
import { CheckIcon, PlayIcon } from '@/components/icons';
import { CollectionCover } from '@/components/primitives/CollectionCover';
import type { CollectionCardProps } from '@/components/library/CollectionCard';
import { cn } from '@/lib/utils';

export interface EditorialGridShelfProps {
  title: string;
  items: CollectionCardProps[];
  size: 'md' | 'lg';
  empty?: ReactNode;
}

/** Option A, "Editorial": the biggest art on the page and nothing else
 *  competing with it. Same shape as CollectionShelf/CollectionCard (props
 *  in, no hooks) so swapping it in later is a straight rename. */
export function EditorialGridShelf({ title, items, empty }: EditorialGridShelfProps) {
  if (items.length === 0) return <>{empty ?? null}</>;
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold tracking-tight mb-4">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-7">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="group block">
            <div className="relative">
              <CollectionCover
                {...item.cover}
                className="aspect-square rounded-2xl shadow-soft transition-transform duration-150 group-hover:scale-[1.02]"
              />
              {/* Reveals on hover/focus, not always-on: the art carries the
                  tile until someone means to act on it. */}
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="absolute bottom-2.5 right-2.5 flex h-11 w-11 items-center justify-center rounded-full bg-ember text-ember-foreground opacity-0 shadow-glow transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                <PlayIcon className="ml-0.5 h-4 w-4 fill-current" />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              {item.badge === 'downloaded' && (
                <CheckIcon className="h-3.5 w-3.5 text-ember shrink-0" />
              )}
              <div className={cn('truncate font-semibold text-base')}>{item.title}</div>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground truncate">{item.subtitle}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
