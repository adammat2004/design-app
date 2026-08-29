import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Home from './page';

describe('Home', () => {
  it('introduces the tool', () => {
    render(<Home />);

    expect(screen.getByRole('heading', { name: 'Garden Studio' })).toBeInTheDocument();
  });

  /* `/plan` mints a project id server-side and redirects into it, so the link cannot name a step. */
  it('starts a new plan', () => {
    render(<Home />);

    expect(screen.getByTestId('start-planning')).toHaveAttribute('href', '/plan');
  });
});
