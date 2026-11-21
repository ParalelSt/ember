import { lazy, Suspense, type ComponentType } from 'react';

/** next/dynamic for tests. The real one resolves React from the repo
 *  root's older copy (see vitest.config.ts) and throws on render, so tests
 *  get the same thing built from React.lazy: the module loads on first
 *  render, then the component shows (findBy* waits for it). */
type Loader<P> = () => Promise<ComponentType<P> | { default: ComponentType<P> }>;

export default function dynamic<P extends object>(load: Loader<P>) {
  const Lazy = lazy(async () => {
    const mod = await load();
    return { default: 'default' in mod ? mod.default : mod };
  });
  function Dynamic(props: P) {
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  }
  return Dynamic;
}
