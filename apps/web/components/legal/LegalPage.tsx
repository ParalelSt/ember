import type { ReactNode } from 'react';
import { FlameIcon } from '@/components/icons';

/** Where people can reach whoever runs Ember. The same address is the
 *  support email on Ember's Google sign-in screen, so the two agree. */
export const LEGAL_CONTACT_EMAIL = 'aronddtt@gmail.com';

/** The shell for the public privacy and terms pages: no app chrome and no
 *  login, since Google links here from its permission screen and whoever
 *  follows that link is not signed in to Ember. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-stack px-page py-section">
      <div className="flex items-center gap-cluster text-muted-foreground">
        <FlameIcon className="size-5 text-ember" />
        <span className="font-semibold text-foreground">Ember</span>
      </div>
      <div className="flex flex-col gap-cluster">
        <h1 className="text-page-title">{title}</h1>
        <p className="text-meta">Last updated {updated}</p>
      </div>
      <div className="flex flex-col gap-block text-sm leading-relaxed text-foreground/90">{children}</div>
    </main>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-cluster">
      <h2 className="text-base font-semibold text-foreground">{heading}</h2>
      {children}
    </section>
  );
}
