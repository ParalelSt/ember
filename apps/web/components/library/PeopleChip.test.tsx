import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PeopleChip } from './PeopleChip';

const olga = { id: 'olga', name: 'Olga', avatarUrl: null };
const mia = { id: 'mia', name: 'Mia', avatarUrl: '/pb/api/files/u/mia/a.png' };
const p = (n: number) => ({ id: `p${n}`, name: `P${n}`, avatarUrl: null });

describe('PeopleChip', () => {
  it('only the owner: their face and "+ Invite"; a tap opens the share sheet', () => {
    const onOpen = vi.fn();
    render(<PeopleChip people={[olga]} onOpen={onOpen} />);
    const chip = screen.getByRole('button', { name: 'Invite' });
    expect(chip.querySelectorAll('[data-testid="face-stack"] > *')).toHaveLength(1);
    expect(chip.querySelector('svg')).not.toBeNull();
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalled();
  });

  it('shared: everyone\'s faces, "N people · Invite"', () => {
    render(<PeopleChip people={[olga, mia, p(1)]} onOpen={vi.fn()} />);
    const chip = screen.getByRole('button', { name: '3 people · Invite' });
    expect(chip.querySelectorAll('[data-testid="face-stack"] > *')).toHaveLength(3);
    expect(chip.querySelector('img')).toHaveAttribute('src', mia.avatarUrl);
  });

  it('more than four: four faces and a +N', () => {
    render(<PeopleChip people={[olga, mia, p(1), p(2), p(3), p(4)]} onOpen={vi.fn()} />);
    const chip = screen.getByRole('button', { name: '6 people · Invite' });
    expect(chip.querySelector('[data-testid="face-stack"]')).toHaveTextContent('+2');
  });
});
