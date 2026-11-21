import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { UiModeProvider, uiModeReload } from '@/components/providers/UiModeProvider';
import { TryNewLookCard } from './TryNewLookCard';

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const fetchMock = vi.fn();
const reload = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  reload.mockReset();
  toast.error.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(uiModeReload, 'reload').mockImplementation(reload);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderCard = () =>
  render(
    <UiModeProvider mode="legacy">
      <TryNewLookCard />
    </UiModeProvider>,
  );

describe('TryNewLookCard (the Classic look\'s way back)', () => {
  it('says what it does and where the way back is', () => {
    renderCard();
    expect(screen.getByText('Try the new look')).toBeInTheDocument();
    expect(screen.getByText(/Settings > Appearance > Classic look/)).toBeInTheDocument();
  });

  it('Try it switches this device to the new look, then reloads', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    renderCard();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try it' })));
    expect(fetchMock).toHaveBeenCalledWith('/api/ui-mode', expect.objectContaining({ method: 'POST', body: JSON.stringify({ mode: 'new' }) }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a failure is said, and the button works again', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
    renderCard();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try it' })));
    expect(toast.error).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Try it' })).toBeEnabled();
  });
});

describe('the Classic look\'s Settings frame', () => {
  it('puts the card at the top, under the title and above the tabs', async () => {
    vi.doMock('@legacy/components/settings/SettingsTabs', () => ({ SettingsTabs: () => <nav data-testid="tabs" /> }));
    vi.doMock('@legacy/components/settings/AppUpdateCard', () => ({ AppUpdateCard: () => null }));
    vi.doMock('@legacy/components/settings/BuildStamp', () => ({ BuildStamp: () => null }));
    const { default: SettingsLayout } = await import('@legacy/app/settings/layout');
    render(
      <UiModeProvider mode="legacy">
        <SettingsLayout>
          <p>page</p>
        </SettingsLayout>
      </UiModeProvider>,
    );
    const card = screen.getByTestId('try-new-look');
    expect(card.compareDocumentPosition(screen.getByTestId('tabs')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Settings' }).compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
