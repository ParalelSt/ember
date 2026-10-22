import { describe, expect, it } from 'vitest';
import { pickCoverColor, darkenCoverColor, coverColorFallback } from './coverColor';

describe('cover color', () => {
  it('prefers colored pixels to grey borders and ignores transparent pixels', () => {
    expect(pickCoverColor(new Uint8ClampedArray([240, 240, 240, 255, 200, 50, 100, 255, 0, 255, 0, 0]))).toEqual([200, 50, 100]);
  });
  it('averages the colored pixels', () => {
    expect(pickCoverColor(new Uint8ClampedArray([200, 50, 100, 255, 100, 50, 200, 255]))).toEqual([150, 50, 150]);
  });
  it('uses no sampled color for empty, transparent or grey artwork', () => {
    expect(pickCoverColor(new Uint8ClampedArray())).toBeNull();
    expect(pickCoverColor(new Uint8ClampedArray([240, 240, 240, 255]))).toBeNull();
    expect(pickCoverColor(new Uint8ClampedArray([255, 0, 0, 0]))).toBeNull();
  });
  it('caps brightness while retaining hue and leaves dark colors alone', () => {
    expect(darkenCoverColor([200, 50, 100])).toBe('rgb(100, 25, 50)');
    expect(darkenCoverColor([20, 30, 40])).toBe('rgb(20, 30, 40)');
  });
  it('uses the system cover color or neutral for a missing or failed image', () => {
    expect(coverColorFallback('#6544dc')).toBe('rgb(46, 31, 100)');
    expect(coverColorFallback('#246373')).toBe('rgb(31, 86, 100)');
    expect(coverColorFallback('#a16a2c')).toBe('rgb(100, 66, 27)');
    expect(coverColorFallback()).toBe('rgb(35, 36, 38)');
  });
});
