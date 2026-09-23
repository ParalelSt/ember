import type { Metadata } from 'next';
import { LEGAL_CONTACT_EMAIL, LegalPage, LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = { title: 'Privacy policy · Ember' };

/** Public: Google links here from the permission screen it shows before the
 *  YouTube Music transfer, so it must load without an Ember login. Written in
 *  plain words for the friends who use Ember, and true to what the code does:
 *  change it when the code changes. */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="23 September 2026">
      <p>
        Ember is a private music app that one person runs on their own computer for a small group of
        friends. It is not a company, it shows no ads, and it sells nothing to anyone.
      </p>

      <LegalSection heading="What Ember keeps">
        <ul className="list-disc pl-block">
          <li>Your email address, the name you pick, and your profile picture if you add one.</li>
          <li>Your likes, playlists, what you played and when, and your recent searches.</li>
          <li>Files you upload yourself, such as songs or cover art.</li>
        </ul>
        <p>
          All of it lives on the computer of the person who runs your Ember server. It is not sent
          anywhere else, and it is used only to run the app for you.
        </p>
      </LegalSection>

      <LegalSection heading="Signing in with Google to bring your likes over">
        <p>
          If you choose to bring your YouTube Music likes into Ember, you sign in with Google for that
          one step. Ember asks Google only for permission to view your YouTube account (the
          &ldquo;youtube.readonly&rdquo; permission), and uses it once:
        </p>
        <ul className="list-disc pl-block">
          <li>It reads the list of videos you have liked and keeps only the songs among them, as likes in Ember.</li>
          <li>
            As soon as that list is read, Ember gives the permission back to Google (it revokes it), so
            it can no longer see anything on your account.
          </li>
          <li>
            The sign-in itself is kept only in the server&rsquo;s memory for those few minutes. It is
            never written to disk, never logged, and never shared.
          </li>
          <li>Ember never changes anything on your Google or YouTube account.</li>
        </ul>
        <p>
          Ember&rsquo;s use of information received from Google APIs adheres to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="text-foreground underline"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. You can also remove Ember&rsquo;s access at any
          time from your Google account&rsquo;s{' '}
          <a href="https://myaccount.google.com/permissions" className="text-foreground underline">
            third-party access page
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="Music and other services">
        <p>
          Songs are found and played through YouTube Music. When you search or play, the Ember server
          asks YouTube for that song, the same way a browser would.
        </p>
      </LegalSection>

      <LegalSection heading="Bug reports">
        <p>
          If Ember crashes, or you send a bug report or a request, a short report goes to the person
          who runs Ember in a private chat channel. It carries what the app was doing, never your
          password, and it is scrubbed of anything that looks like a secret.
        </p>
      </LegalSection>

      <LegalSection heading="Deleting your data">
        <p>
          Ask the person who runs your Ember server, or write to{' '}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-foreground underline">
            {LEGAL_CONTACT_EMAIL}
          </a>
          , and your account and everything above will be removed.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions about this policy:{' '}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-foreground underline">
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
