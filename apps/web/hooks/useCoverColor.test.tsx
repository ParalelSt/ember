import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCoverColor } from './useCoverColor';

const images: { crossOrigin: string; src: string; onload: () => void; onerror: () => void }[] = [];
let getImageData: ReturnType<typeof vi.fn>;

beforeEach(() => {
  images.length = 0;
  vi.stubGlobal('Image', class {
    crossOrigin = '';
    src = '';
    onload = () => {};
    onerror = () => {};
    constructor() { images.push(this); }
  });
  getImageData = vi.fn(() => ({ data: new Uint8ClampedArray([200, 50, 100, 255]) }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData } as unknown as CanvasRenderingContext2D);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('useCoverColor loading', () => {
  it('uses neutral without a URL argument', () => {
    const { result } = renderHook(() => useCoverColor());
    expect(result.current).toBe('rgb(35, 36, 38)');
    expect(images).toHaveLength(0);
  });
  it('loads with CORS and shares one cached sample across consumers', async () => {
    const first = renderHook(() => useCoverColor('/cached-cover.jpg'));
    const second = renderHook(() => useCoverColor('/cached-cover.jpg'));
    expect(images).toHaveLength(1);
    expect(images[0].crossOrigin).toBe('anonymous');
    await act(async () => images[0].onload());
    expect(first.result.current).toBe('rgb(100, 25, 50)');
    expect(second.result.current).toBe('rgb(100, 25, 50)');
  });
  it('falls back when canvas access is denied', async () => {
    getImageData.mockImplementation(() => { throw new Error('Tainted canvas'); });
    const { result } = renderHook(() => useCoverColor('/tainted.jpg', '#6544dc'));
    await act(async () => images[0].onload());
    expect(result.current).toBe('rgb(46, 31, 100)');
  });
  it('falls back on image errors and when there is no image', async () => {
    const { result, rerender } = renderHook(({ url }) => useCoverColor(url), { initialProps: { url: '/missing.jpg' as string | null } });
    await act(async () => images[0].onerror());
    expect(result.current).toBe('rgb(35, 36, 38)');
    rerender({ url: null });
    expect(images).toHaveLength(1);
    expect(result.current).toBe('rgb(35, 36, 38)');
  });
  it('ignores a previous image that finishes after the URL changes', async () => {
    const { result, rerender } = renderHook(({ url }) => useCoverColor(url), { initialProps: { url: '/old.jpg' } });
    rerender({ url: '/new.jpg' });
    await act(async () => images[0].onload());
    expect(result.current).toBe('rgb(35, 36, 38)');
    await act(async () => images[1].onload());
    expect(result.current).toBe('rgb(100, 25, 50)');
  });
});
