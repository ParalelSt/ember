import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { PlayingBars } from './PlayingBars';
import { usePlayerStore } from '@/stores/usePlayerStore';

beforeEach(() => usePlayerStore.setState({ isPlaying: true }));

describe('PlayingBars', () => {
  it('follows playing and paused, and is hidden from screen readers', () => {
    render(<PlayingBars />);
    const bars = screen.getByTestId('playing-bars');
    expect(bars).toHaveAttribute('data-playing', 'true');
    expect(bars).toHaveAttribute('aria-hidden');
    expect(bars.querySelectorAll('.ember-playing-bar')).toHaveLength(3);
    act(() => usePlayerStore.setState({ isPlaying: false }));
    expect(bars).toHaveAttribute('data-playing', 'false');
  });

  it('the stylesheet pauses them when paused and stills them under reduced motion', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    expect(css).toMatch(/\[data-playing="false"\] > \.ember-playing-bar \{ animation-play-state: paused; \}/);
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    expect(reduced).toMatch(/\.ember-playing-bar \{ animation: none !important; \}/);
  });
});
