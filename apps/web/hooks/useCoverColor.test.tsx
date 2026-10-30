import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCoverColor } from './useCoverColor';

const images: { crossOrigin: string; referrerPolicy: string; src: string; onload: () => void; onerror: () => void }[] = [];
let getImageData: ReturnType<typeof vi.fn>;

beforeEach(() => {
  images.length = 0;
  vi.stubGlobal('Image', class {
    crossOrigin = '';
    referrerPolicy = '';
    src = '';
    onload = () => {};
    onerror = () => {};
    constructor() { images.push(this); }
  });
  getImageData = vi.fn(() => ({ data: new Uint8ClampedArray([200, 50, 100, 255]) }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData } as unknown as CanvasRenderingContext2D);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('useCoverColor', () => {
  it('has no colour and loads nothing without a cover', () => {
    const { result } = renderHook(() => useCoverColor());
    expect(result.current).toBeNull();
    expect(images).toHaveLength(0);
  });

  it('loads with CORS and shares one cached sample, darkened for white text', async () => {
    const first = renderHook(() => useCoverColor('/cached-cover.jpg'));
    const second = renderHook(() => useCoverColor('/cached-cover.jpg'));
    expect(images).toHaveLength(1);
    expect(images[0].crossOrigin).toBe('anonymous');
    await act(async () => images[0].onload());
    expect(first.result.current).toBe('rgb(100, 25, 50)');
    expect(second.result.current).toBe('rgb(100, 25, 50)');
  });

  it('reads a YouTube cover through /api/art, and asks another site directly with no referrer', () => {
    renderHook(() => useCoverColor('https://i.ytimg.com/vi/abc/hqdefault.jpg'));
    expect(images[0].src).toBe('/api/art?url=https%3A%2F%2Fi.ytimg.com%2Fvi%2Fabc%2Fhqdefault.jpg');
    renderHook(() => useCoverColor('https://elsewhere.example/cover.png'));
    expect(images[1].src).toBe('https://elsewhere.example/cover.png');
    expect(images[1].referrerPolicy).toBe('no-referrer');
  });

  it('has no colour when the canvas refuses the pixels', async () => {
    getImageData.mockImplementation(() => { throw new Error('Tainted canvas'); });
    const { result } = renderHook(() => useCoverColor('/tainted.jpg'));
    await act(async () => images[0].onload());
    expect(result.current).toBeNull();
  });

  it('has no colour for a grey cover', async () => {
    getImageData.mockReturnValue({ data: new Uint8ClampedArray([120, 120, 120, 255]) });
    const { result } = renderHook(() => useCoverColor('/grey.jpg'));
    await act(async () => images[0].onload());
    expect(result.current).toBeNull();
  });

  it('has no colour when the image fails or the cover goes, and a failed cover is tried again', async () => {
    const { result, rerender, unmount } = renderHook(({ url }) => useCoverColor(url), { initialProps: { url: '/missing.jpg' as string | null } });
    await act(async () => images[0].onerror());
    expect(result.current).toBeNull();
    rerender({ url: null });
    expect(images).toHaveLength(1);
    expect(result.current).toBeNull();
    unmount();
    const again = renderHook(() => useCoverColor('/missing.jpg'));
    expect(images).toHaveLength(2);
    await act(async () => images[1].onload());
    expect(again.result.current).toBe('rgb(100, 25, 50)');
  });

  it('keeps the last colour until the new cover answers, and ignores a late old one', async () => {
    const { result, rerender } = renderHook(({ url }) => useCoverColor(url), { initialProps: { url: '/one.jpg' } });
    await act(async () => images[0].onload());
    expect(result.current).toBe('rgb(100, 25, 50)');

    rerender({ url: '/two.jpg' });
    expect(result.current).toBe('rgb(100, 25, 50)');
    rerender({ url: '/three.jpg' });
    getImageData.mockReturnValue({ data: new Uint8ClampedArray([10, 80, 40, 255]) });
    await act(async () => images[2].onload());
    expect(result.current).toBe('rgb(10, 80, 40)');
    getImageData.mockReturnValue({ data: new Uint8ClampedArray([200, 50, 100, 255]) });
    await act(async () => images[1].onload());
    expect(result.current).toBe('rgb(10, 80, 40)');
  });
});
