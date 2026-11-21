import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { UiModeProvider, uiModeReload } from '@/components/providers/UiModeProvider';
import { ClassicLookRow, CLASSIC_LOOK_FAILED } from './ClassicLookRow';

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

const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

describe.each([
  ['phone card', false],
  ['desktop row', true],
])('ClassicLookRow (%s)', (_name, rows) => {
  it('switching it on asks the server for the Classic look, then reloads', async () => {
    fetchMock.mockResolvedValue(ok());
    render(
      <UiModeProvider mode="new">
        <ClassicLookRow rows={rows} />
      </UiModeProvider>,
    );
    const sw = screen.getByRole('switch', { name: 'Turn on Classic look' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await act(async () => fireEvent.click(sw));
    expect(fetchMock).toHaveBeenCalledWith('/api/ui-mode', expect.objectContaining({ method: 'POST', body: JSON.stringify({ mode: 'legacy' }) }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a failed switch says so, stays put and can be tried again', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(
      <UiModeProvider mode="new">
        <ClassicLookRow rows={rows} />
      </UiModeProvider>,
    );
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: 'Turn on Classic look' })));
    expect(toast.error).toHaveBeenCalledWith(CLASSIC_LOOK_FAILED);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: 'Turn on Classic look' })).toBeEnabled();
  });

  it('on the Classic look it shows on, and switching it off goes back to the new look', async () => {
    fetchMock.mockResolvedValue(ok());
    render(
      <UiModeProvider mode="legacy">
        <ClassicLookRow rows={rows} />
      </UiModeProvider>,
    );
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: 'Turn off Classic look' })));
    expect(fetchMock).toHaveBeenCalledWith('/api/ui-mode', expect.objectContaining({ body: JSON.stringify({ mode: 'new' }) }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
