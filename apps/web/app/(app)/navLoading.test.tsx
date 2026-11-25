import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mode = vi.hoisted(() => ({ value: 'new' as 'new' | 'legacy' }));
vi.mock('@/components/providers/serverUiMode', () => ({ serverUiMode: async () => mode.value }));

import AppLoading from './loading';
import RadioLoading from './radio/loading';
import WhatsNewLoading from './whats-new/loading';
import SettingsLoading from './settings/loading';
import TransferLoading from './transfer/loading';

const CASES: [string, () => Promise<React.ReactNode>, string][] = [
  ['Home and the rest', AppLoading, 'app-loading'],
  ['Radio', RadioLoading, 'radio-loading'],
  ["What's new", WhatsNewLoading, 'whats-new-loading'],
  ['Settings', SettingsLoading, 'settings-loading'],
  ['Transfer', TransferLoading, 'transfer-loading'],
];

describe.each(CASES)('%s loading.tsx', (_name, Loading, testId) => {
  it('renders placeholders in the new look', async () => {
    mode.value = 'new';
    render(<>{await Loading()}</>);
    const root = screen.getByTestId(testId);
    expect(root.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(2);
  });

  it('renders nothing on the Classic look', async () => {
    mode.value = 'legacy';
    const { container } = render(<>{await Loading()}</>);
    expect(container).toBeEmptyDOMElement();
  });
});
