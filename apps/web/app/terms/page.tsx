import type { Metadata } from 'next';
import { LEGAL_CONTACT_EMAIL, LegalPage, LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = { title: 'Terms of service · Ember' };

/** Public for the same reason as /privacy: Google links here from its
 *  permission screen. Short and plain, like the app it describes. */
export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="23 September 2026">
      <p>
        Ember is a private music app one person runs for a small group of friends. By using it you
        agree to these few rules.
      </p>

      <LegalSection heading="Use it for yourself">
        <p>
          Ember is for listening to music for your own enjoyment. Do not use it to copy, sell or
          redistribute music, and do not try to break into it or overload it.
        </p>
      </LegalSection>

      <LegalSection heading="Your account">
        <p>
          Keep your password to yourself. The person who runs Ember can remove an account that is used
          against these rules.
        </p>
      </LegalSection>

      <LegalSection heading="No guarantees">
        <p>
          Ember is run for free, as a hobby. It is offered as it is: it may be down, lose data, or
          change without notice, and nobody is liable for that.
        </p>
      </LegalSection>

      <LegalSection heading="Other services">
        <p>
          Music comes from YouTube Music, and bringing your likes over can use your Google account.
          Those services have their own terms, which still apply to you.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-foreground underline">
            {LEGAL_CONTACT_EMAIL}
          </a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
