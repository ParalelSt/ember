import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QrScanner } from './QrScanner';
import type { FrameDecoder } from '@/lib/qrScan/decoder';

const ORIGIN = 'https://ember.example.com';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';

function fakeStream() {
  const track = { stop: vi.fn() };
  // A real (empty) MediaStream so the video accepts it, with a track to stop.
  const stream = Object.assign(new MediaStream(), { getTracks: () => [track] }) as unknown as MediaStream;
  return { stream, track };
}

/** A decoder that answers each frame from the list, then null forever. */
function scripted(...frames: Array<string | null>) {
  const decode = vi.fn<FrameDecoder>(async () => (frames.length ? (frames.shift() ?? null) : null));
  return { decode, createDecoder: async () => decode };
}

const domError = (name: string) => Object.assign(new Error(name), { name });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('QrScanner', () => {
  it('decoded: a sign-in link for this server ends the scan and turns the camera off', async () => {
    const { stream, track } = fakeStream();
    const getUserMedia = vi.fn(async () => stream);
    const { createDecoder } = scripted(`${ORIGIN}/link/${TOKEN}`);
    const onResult = vi.fn();
    render(<QrScanner origin={ORIGIN} onResult={onResult} onClose={vi.fn()} getUserMedia={getUserMedia} createDecoder={createDecoder} />);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ kind: 'token', token: TOKEN }));
    expect(track.stop).toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  });

  it('decoded short code: answers the code', async () => {
    const { stream } = fakeStream();
    const { createDecoder } = scripted('ABCD-EFGH');
    const onResult = vi.fn();
    render(<QrScanner origin={ORIGIN} onResult={onResult} onClose={vi.fn()} getUserMedia={async () => stream} createDecoder={createDecoder} />);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ kind: 'code', code: 'ABCDEFGH' }));
  });

  it('another QR says so, does not end the scan, and the next good one still works', async () => {
    const { stream, track } = fakeStream();
    const { createDecoder, decode } = scripted('https://evil.example.com/link/' + TOKEN, null, `${ORIGIN}/link/${TOKEN}`);
    const onResult = vi.fn();
    render(<QrScanner origin={ORIGIN} onResult={onResult} onClose={vi.fn()} getUserMedia={async () => stream} createDecoder={createDecoder} />);
    expect(await screen.findByTestId('qr-invalid')).toHaveTextContent("That's not an Ember sign-in code");
    expect(onResult).not.toHaveBeenCalled();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ kind: 'token', token: TOKEN }));
    expect(decode.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(track.stop).toHaveBeenCalled();
  });

  it('scanning: says what to do while it looks', async () => {
    const { stream } = fakeStream();
    const { createDecoder } = scripted();
    render(<QrScanner origin={ORIGIN} onResult={vi.fn()} onClose={vi.fn()} getUserMedia={async () => stream} createDecoder={createDecoder} />);
    await waitFor(() => expect(screen.getByTestId('qr-scanner')).toHaveAttribute('data-state', 'scanning'));
    expect(screen.getByText('Point at the QR code on the other device.')).toBeInTheDocument();
  });

  it('permission denied: says how to turn it on, and Try again asks again', async () => {
    const getUserMedia = vi.fn(async () => Promise.reject(domError('NotAllowedError')));
    render(<QrScanner origin={ORIGIN} onResult={vi.fn()} onClose={vi.fn()} getUserMedia={getUserMedia} createDecoder={scripted().createDecoder} />);
    expect(await screen.findByText('Camera access is off')).toBeInTheDocument();
    expect(screen.getByTestId('qr-scanner')).toHaveAttribute('data-state', 'denied');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
  });

  it('no camera (NotFoundError): says so, no Try again', async () => {
    render(
      <QrScanner
        origin={ORIGIN}
        onResult={vi.fn()}
        onClose={vi.fn()}
        getUserMedia={async () => Promise.reject(domError('NotFoundError'))}
        createDecoder={scripted().createDecoder}
      />,
    );
    expect(await screen.findByText('No camera found')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('no camera API at all (old browser, plain http): no camera', async () => {
    const md = Object.getOwnPropertyDescriptor(window.navigator, 'mediaDevices');
    Object.defineProperty(window.navigator, 'mediaDevices', { value: undefined, configurable: true });
    try {
      render(<QrScanner origin={ORIGIN} onResult={vi.fn()} onClose={vi.fn()} createDecoder={scripted().createDecoder} />);
      expect(await screen.findByText('No camera found')).toBeInTheDocument();
    } finally {
      if (md) Object.defineProperty(window.navigator, 'mediaDevices', md);
      else delete (window.navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
    }
  });

  it('camera busy: cannot start, Try again', async () => {
    render(
      <QrScanner
        origin={ORIGIN}
        onResult={vi.fn()}
        onClose={vi.fn()}
        getUserMedia={async () => Promise.reject(domError('NotReadableError'))}
        createDecoder={scripted().createDecoder}
      />,
    );
    expect(await screen.findByText("Can't start the camera")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('closing turns the camera off: the X, Escape, and unmount', async () => {
    const { stream, track } = fakeStream();
    const onClose = vi.fn();
    const { unmount } = render(
      <QrScanner origin={ORIGIN} onResult={vi.fn()} onClose={onClose} getUserMedia={async () => stream} createDecoder={scripted().createDecoder} />,
    );
    await waitFor(() => expect(screen.getByTestId('qr-scanner')).toHaveAttribute('data-state', 'scanning'));
    fireEvent.click(screen.getByRole('button', { name: 'Close scanner' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it('a camera that arrives after close is turned straight off', async () => {
    const { stream, track } = fakeStream();
    let give!: (s: MediaStream) => void;
    const { unmount } = render(
      <QrScanner
        origin={ORIGIN}
        onResult={vi.fn()}
        onClose={vi.fn()}
        getUserMedia={() => new Promise((r) => (give = r))}
        createDecoder={scripted().createDecoder}
      />,
    );
    unmount();
    await act(async () => give(stream));
    expect(track.stop).toHaveBeenCalled();
  });

  it('No camera? Type the code hands off to the host', async () => {
    const onTypeCode = vi.fn();
    render(
      <QrScanner
        origin={ORIGIN}
        onResult={vi.fn()}
        onClose={vi.fn()}
        onTypeCode={onTypeCode}
        getUserMedia={async () => Promise.reject(domError('NotFoundError'))}
        createDecoder={scripted().createDecoder}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /No camera\? Type the code in Settings > Devices/ }));
    expect(onTypeCode).toHaveBeenCalled();
  });
});
