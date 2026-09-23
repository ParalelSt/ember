import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PrivacyPage from './page';
import TermsPage from '../terms/page';
import { PUBLIC_PATHS } from '@/proxy';
import { LEGAL_CONTACT_EMAIL } from '@/components/legal/LegalPage';

describe('privacy and terms pages', () => {
  it('both load without an Ember login, since Google links to them', () => {
    expect(PUBLIC_PATHS).toContain('/privacy');
    expect(PUBLIC_PATHS).toContain('/terms');
  });

  it('the privacy policy says what the Google sign-in reads, and that it is given back', () => {
    render(<PrivacyPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeInTheDocument();
    expect(screen.getByText(/youtube\.readonly/)).toBeInTheDocument();
    expect(screen.getByText(/it revokes it/)).toBeInTheDocument();
    expect(screen.getByText(/never written to disk, never logged, and never shared/)).toBeInTheDocument();
    // Google asks for this sentence and link on apps that use its APIs.
    expect(screen.getByRole('link', { name: 'Google API Services User Data Policy' })).toHaveAttribute(
      'href',
      'https://developers.google.com/terms/api-services-user-data-policy',
    );
    expect(screen.getAllByRole('link', { name: LEGAL_CONTACT_EMAIL })[0]).toHaveAttribute(
      'href',
      `mailto:${LEGAL_CONTACT_EMAIL}`,
    );
  });

  it('the terms page renders with a contact', () => {
    render(<TermsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of service' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: LEGAL_CONTACT_EMAIL })).toHaveAttribute('href', `mailto:${LEGAL_CONTACT_EMAIL}`);
  });
});
