import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('shows the initial letter of the name when there is no src', () => {
    const { container } = render(<Avatar name="Robin" email="robin@example.com" />);
    expect(screen.getByText('R')).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('falls back to the initial of the email when there is no name', () => {
    render(<Avatar name="" email="robin@example.com" />);
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  it('shows "?" when there is neither name nor email', () => {
    render(<Avatar />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('shows the image on top when src is set', () => {
    const { container } = render(<Avatar src="/pb/api/files/users/u1/avatar.png" name="Robin" />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', '/pb/api/files/users/u1/avatar.png');
    expect(screen.queryByText('R')).not.toBeInTheDocument();
  });

  it('falls back to the initial when the image fires error', () => {
    const { container } = render(<Avatar src="/pb/api/files/users/u1/broken.png" name="Robin" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();

    fireEvent.error(img as HTMLImageElement);

    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  it('merges the className onto the wrapper', () => {
    render(<Avatar name="Robin" className="h-8 w-8 bg-ember" />);
    expect(screen.getByText('R').className).toContain('h-8 w-8 bg-ember');
  });
});
