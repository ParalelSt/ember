import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PeopleChip } from './PeopleChip';

const olga = { id: 'olga', name: 'Olga', avatarUrl: null };
const mia = { id: 'mia', name: 'Mia', avatarUrl: '/pb/api/files/u/mia/a.png' };
const p = (n: number) => ({ id: `p${n}`, name: `P${n}`, avatarUrl: null });

describe('PeopleChip', () => {
  it('only the owner: the plus alone, no faces or words; a tap opens the share sheet', () => {
    const onOpen = vi.fn();
    render(<PeopleChip people={[olga]} onOpen={onOpen} />);
    const chip = screen.getByRole('button', { name: 'Invite' });
    expect(chip.querySelector('[data-testid="face-stack"]')).toBeNull();
    expect(chip.querySelector('svg')).not.toBeNull();
    expect(chip.textContent).toBe('');
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalled();
  });

  it('shared: everyone\'s faces, faces and a plus, named "N people, invite"', () => {
    render(<PeopleChip people={[olga, mia, p(1)]} onOpen={vi.fn()} />);
    const chip = screen.getByRole('button', { name: '3 people, invite' });
    expect(chip.querySelectorAll('[data-testid="face-stack"] > *')).toHaveLength(3);
    expect(chip.querySelector('img')).toHaveAttribute('src', mia.avatarUrl);
  });

  it('more than four: four faces and a +N', () => {
    render(<PeopleChip people={[olga, mia, p(1), p(2), p(3), p(4)]} onOpen={vi.fn()} />);
    const chip = screen.getByRole('button', { name: '6 people, invite' });
    expect(chip.querySelector('[data-testid="face-stack"]')).toHaveTextContent('+2');
  });

  it('no outline, pill or words; 44px hit area', () => {
    render(<PeopleChip people={[olga, mia]} onOpen={vi.fn()} />);
    const chip = screen.getByTestId('people-chip');
    expect(chip.className).not.toMatch(/\bborder\b|bg-card/);
    expect(chip.className).toMatch(/min-h-11/);
    expect(chip.className).toMatch(/min-w-11/);
    expect(chip.textContent).not.toMatch(/invite|people/i);
    expect(screen.getByTestId('people-chip-plus')).toBeInTheDocument();
  });
});
