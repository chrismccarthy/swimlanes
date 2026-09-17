import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoomControl } from './ZoomControl';
import { useAppStore } from '../../store/useAppStore';
import { ZOOM_DAY_WIDTH } from '../../lib/layout';

// Vitest runs with `globals: false`, so Testing Library's automatic cleanup
// hook is not installed — unmount explicitly between tests.
afterEach(cleanup);

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  useAppStore.setState({ zoom: 'day', dayWidth: ZOOM_DAY_WIDTH.day });
});

describe('ZoomControl', () => {
  it('renders one button per zoom level, pressing the store’s current one', () => {
    render(<ZoomControl />);

    const buttons = screen.getAllByRole('button');
    expect(buttons.map(b => b.textContent)).toEqual(['Day', 'Week', 'Quarter']);
    expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Quarter' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects a zoom level set on the store before rendering', () => {
    useAppStore.setState({ zoom: 'quarter', dayWidth: ZOOM_DAY_WIDTH.quarter });
    render(<ZoomControl />);

    expect(screen.getByRole('button', { name: 'Quarter' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('changes the store zoom and moves aria-pressed when a button is clicked', async () => {
    const user = userEvent.setup();
    render(<ZoomControl />);

    await user.click(screen.getByRole('button', { name: 'Week' }));

    expect(useAppStore.getState().zoom).toBe('week');
    expect(useAppStore.getState().dayWidth).toBe(ZOOM_DAY_WIDTH.week);
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: 'Quarter' }));
    expect(useAppStore.getState().zoom).toBe('quarter');
    expect(screen.getByRole('button', { name: 'Quarter' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('is a labelled group so screen readers announce what the buttons do', () => {
    render(<ZoomControl />);
    expect(screen.getByRole('group', { name: 'Timeline zoom' })).toBeInTheDocument();
  });
});
