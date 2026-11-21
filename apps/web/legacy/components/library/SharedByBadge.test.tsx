import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SharedByBadge } from './SharedByBadge';

describe('SharedByBadge', () => {
  it('the owner\'s face and "Shared by <name>"', () => {
    render(<SharedByBadge owner={{ name: 'Olga', avatarUrl: '/pb/api/files/u/o/olga.png' }} />);
    const pill = screen.getByTestId('shared-by');
    expect(pill).toHaveTextContent('Shared by Olga');
    expect(pill.querySelector('img')).toHaveAttribute('src', '/pb/api/files/u/o/olga.png');
  });

  it('no picture: the initial instead', () => {
    render(<SharedByBadge owner={{ name: 'Olga', avatarUrl: null }} />);
    expect(screen.getByTestId('shared-by')).toHaveTextContent('OShared by Olga');
  });
});
