import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Toast } from './Toast';

describe('Toast Component', () => {
  it('should render the message', () => {
    render(<Toast message="Test notification" />);
    expect(screen.getByText('Test notification')).toBeInTheDocument();
  });

  it('should have toast class', () => {
    const { container } = render(<Toast message="Test" />);
    expect(container.querySelector('.toast')).toBeInTheDocument();
  });
});
