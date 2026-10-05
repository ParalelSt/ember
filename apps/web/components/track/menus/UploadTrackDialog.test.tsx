import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ComponentProps, type PropsWithChildren } from 'react';

// The real dialog's content unmounts when closed, as this stand-in does.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, variant: _v, ...rest }: ComponentProps<'button'> & { variant?: string }) => <button {...rest}>{children}</button>,
}));
vi.mock('@/components/ui/input', () => ({ Input: (props: ComponentProps<'input'>) => <input {...props} /> }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const uploadTrack = vi.fn();
vi.mock('@/lib/api', () => ({ api: { uploadTrack: (...a: unknown[]) => uploadTrack(...a) } }));

const { UploadTrackDialog } = await import('./UploadTrackDialog');

/** new Audio() whose metadata arrives when the test says so. */
const pendingMeta = new Map<string, (duration: number) => void>();
class FakeAudio {
  private listeners: Record<string, () => void> = {};
  duration = NaN;
  addEventListener(type: string, cb: () => void) {
    this.listeners[type] = cb;
  }
  set src(url: string) {
    pendingMeta.set(url, (d) => {
      this.duration = d;
      this.listeners.loadedmetadata?.();
    });
  }
}

let urlCount = 0;
beforeEach(() => {
  pendingMeta.clear();
  urlCount = 0;
  vi.stubGlobal('Audio', FakeAudio);
  URL.createObjectURL = vi.fn(() => `blob:${++urlCount}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <button type="button" onClick={() => setOpen(true)}>reopen</button>
      <UploadTrackDialog open={open} onOpenChange={setOpen} />
    </QueryClientProvider>
  );
}

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const pick = (name: string) =>
  act(async () => {
    fireEvent.change(fileInput(), { target: { files: [new File([new Uint8Array(1024)], name, { type: 'audio/mpeg' })] } });
  });

describe('UploadTrackDialog', () => {
  it('Cancel forgets the picked file, so reopening does not upload it unseen', async () => {
    render(<Harness />);
    await pick('Band - Song.mp3');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'reopen' }));
    expect(screen.getByPlaceholderText('Title')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
  });
});
