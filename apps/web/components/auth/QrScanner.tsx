'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CloseIcon } from '@/components/icons';
import { createFrameDecoder, type FrameDecoder } from '@/lib/qrScan/decoder';
import { NOT_A_SIGN_IN_CODE, parseScanned, type ScannedCredential } from '@/lib/qrScan/parseScanned';

/** How often a frame is read. */
export const SCAN_EVERY_MS = 200;
/** How long "That's not an Ember sign-in code" stays up after the last bad read. */
export const INVALID_SHOWN_MS = 2500;

export type ScannerState = 'starting' | 'scanning' | 'denied' | 'no-camera' | 'error';

interface Props {
  /** A valid sign-in code was read; the camera is already off. */
  onResult: (credential: ScannedCredential) => void;
  onClose: () => void;
  /** "No camera? Type the code": the host takes the person to Settings > Devices. */
  onTypeCode?: () => void;
  /** The server this app talks to; links to any other origin are refused. */
  origin?: string;
  /** Seams for tests. */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createDecoder?: () => Promise<FrameDecoder>;
}

function defaultGetUserMedia(): ((c: MediaStreamConstraints) => Promise<MediaStream>) | null {
  const md = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  return typeof md?.getUserMedia === 'function' ? (c) => md.getUserMedia(c) : null;
}

function stateForError(e: unknown): ScannerState {
  const name = (e as { name?: unknown } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'no-camera';
  return 'error';
}

const MESSAGES: Record<Exclude<ScannerState, 'starting' | 'scanning'>, { title: string; body: string }> = {
  denied: {
    title: 'Camera access is off',
    body: 'Allow the camera for Ember in your phone settings, then try again.',
  },
  'no-camera': {
    title: 'No camera found',
    body: "This device has no camera Ember can use.",
  },
  error: {
    title: "Can't start the camera",
    body: 'Another app may be using it. Close it and try again.',
  },
};

/** The page's own QR scanner, full screen: the iOS app, phone browsers, and
 *  the Android app when Google's scanner is missing. Camera preview through
 *  getUserMedia, read every 200 ms (BarcodeDetector or jsQR). Only an Ember
 *  sign-in code for this server ends the scan; anything else says so and
 *  keeps looking. */
export function QrScanner({ onResult, onClose, onTypeCode, origin, getUserMedia, createDecoder = createFrameDecoder }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ScannerState>('starting');
  const [invalid, setInvalid] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let invalidTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(invalidTimer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };

    void (async () => {
      setState('starting');
      const gum = getUserMedia ?? defaultGetUserMedia();
      if (!gum) {
        setState('no-camera');
        return;
      }
      try {
        const s = await gum({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
      } catch (e) {
        if (!stopped) setState(stateForError(e));
        return;
      }
      const video = videoRef.current;
      if (video) {
        try {
          video.srcObject = stream;
        } catch {
          if (!stopped) setState('error');
          stop();
          return;
        }
        try {
          await video.play();
        } catch {
          // autoPlay + muted + playsInline start it anyway on phones.
        }
      }
      let decode: FrameDecoder;
      try {
        decode = await createDecoder();
      } catch {
        if (!stopped) setState('error');
        stop();
        return;
      }
      if (stopped) return;
      setState('scanning');

      const origin_ = origin ?? window.location.origin;
      const tick = async () => {
        if (stopped || !videoRef.current) return;
        let raw: string | null = null;
        try {
          raw = await decode(videoRef.current);
        } catch {
          raw = null;
        }
        if (stopped) return;
        if (raw) {
          const credential = parseScanned(raw, origin_);
          if (credential) {
            stop();
            onResultRef.current(credential);
            return;
          }
          setInvalid(true);
          clearTimeout(invalidTimer);
          invalidTimer = setTimeout(() => setInvalid(false), INVALID_SHOWN_MS);
        }
        timer = setTimeout(() => void tick(), SCAN_EVERY_MS);
      };
      void tick();
    })();

    return stop;
  }, [attempt, getUserMedia, createDecoder, origin]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const failed = state === 'denied' || state === 'no-camera' || state === 'error';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan QR code"
      data-testid="qr-scanner"
      data-state={state}
      className="safe-area-top safe-area-bottom fixed inset-0 z-[60] flex flex-col bg-black text-white"
    >
      <div className="flex items-center justify-between gap-cluster p-block">
        <div className="font-semibold">Scan QR code</div>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          onClick={onClose}
          aria-label="Close scanner"
          className="text-white hover:bg-white/10 hover:text-white"
        >
          <CloseIcon />
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          aria-hidden
          className={failed ? 'hidden' : 'absolute inset-0 size-full object-cover'}
        />
        {!failed && (
          <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="aspect-square w-2/3 max-w-xs rounded-2xl border-2 border-white/80 shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]" />
          </div>
        )}
        {failed && (
          <div className="absolute inset-0 grid place-items-center p-page text-center">
            <div className="max-w-sm">
              <div className="text-lg font-semibold">{MESSAGES[state].title}</div>
              <p className="mt-cluster text-sm text-white/75">{MESSAGES[state].body}</p>
              {state !== 'no-camera' && (
                <Button type="button" variant="outline" className="mt-block" onClick={() => setAttempt((a) => a + 1)}>
                  Try again
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="p-page text-center" aria-live="polite">
        {invalid ? (
          <div className="font-semibold" data-testid="qr-invalid">
            <span className="rounded-md bg-destructive px-cluster py-inset text-white">{NOT_A_SIGN_IN_CODE}</span>
          </div>
        ) : state === 'starting' ? (
          <div className="text-sm text-white/75">Starting the camera...</div>
        ) : state === 'scanning' ? (
          <div className="text-sm text-white/75">Point at the QR code on the other device.</div>
        ) : null}
        {onTypeCode && (
          <button
            type="button"
            onClick={onTypeCode}
            className="mt-block inline-block text-sm text-white/75 underline hover:text-white"
          >
            No camera? Type the code in Settings &gt; Devices
          </button>
        )}
      </div>
    </div>
  );
}
