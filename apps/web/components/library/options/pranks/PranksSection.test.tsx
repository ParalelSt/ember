import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PranksSection } from './PranksSection';
import { PRANK_OPTIONS } from '.';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx); ShellPreview's nav bits all use it.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe('PranksSection', () => {
  it('renders each candidate at both a desktop and a phone width', () => {
    for (const o of PRANK_OPTIONS) {
      const { unmount } = render(<PranksSection option={o.id} state="idle" />);
      const shells = screen.getAllByTestId('shell-preview');
      expect(shells).toHaveLength(2);
      expect(shells.map((s) => s.dataset.phone)).toEqual(['false', 'true']);
      for (const shell of shells) {
        expect(within(shell).getByTestId(`prank-candidate-${o.id}`)).toBeInTheDocument();
      }
      unmount();
    }
  });

  it('shows the People, Compose, Library and Log regions and the global switch', () => {
    render(<PranksSection option="control-room" state="listening" />);
    const shell = screen.getAllByTestId('shell-preview')[0];
    expect(within(shell).getAllByTestId('prank-person-row').length).toBeGreaterThan(0);
    expect(within(shell).getAllByTestId('prank-composer').length).toBeGreaterThan(0);
    expect(within(shell).getAllByTestId('prank-sound-library').length).toBeGreaterThan(0);
    expect(within(shell).getAllByTestId('prank-log').length).toBeGreaterThan(0);
    expect(within(shell).getAllByTestId('prank-global-switch').length).toBeGreaterThan(0);
    expect(within(shell).getAllByTestId('prank-stop-everything').length).toBeGreaterThan(0);
  });

  it('shows the plain-words person lines, never an id', () => {
    render(<PranksSection option="control-room" state="listening" />);
    expect(screen.getAllByText(/Luka is listening to Beggin.* by Måneskin, for 2 min/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Nina, idle/).length).toBeGreaterThan(0);
  });

  it('shows the limit where it bites', () => {
    render(<PranksSection option="control-room" state="listening" />);
    expect(screen.getAllByText(/18 of 20 this hour/).length).toBeGreaterThan(0);
  });

  it('the "repeat" state shows the schedule banner with Stop', () => {
    render(<PranksSection option="control-room" state="repeat" />);
    const shell = screen.getAllByTestId('shell-preview')[0];
    expect(within(shell).getAllByTestId('prank-schedule-banner').length).toBeGreaterThan(0);
    expect(within(shell).getAllByRole('button', { name: 'Stop' }).length).toBeGreaterThan(0);
  });

  it('the "off" state turns the global switch off and disables composing', () => {
    render(<PranksSection option="control-room" state="off" />);
    const shell = screen.getAllByTestId('shell-preview')[0];
    const switchEl = within(shell).getAllByRole('switch', { name: 'Pranks global switch' })[0];
    expect(switchEl).toHaveAttribute('aria-checked', 'false');
    const send = within(shell).getAllByRole('button', { name: 'Send' })[0];
    expect(send).toBeDisabled();
  });

  it('never mentions opting out or telling the target', () => {
    render(<PranksSection option="control-room" state="listening" />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/opt.?out/i);
    expect(text).not.toMatch(/reveal/i);
  });
});
