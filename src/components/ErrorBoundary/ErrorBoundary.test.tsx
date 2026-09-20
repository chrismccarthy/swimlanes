import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

// Vitest runs with `globals: false`, so Testing Library's automatic cleanup
// hook is not installed — unmount explicitly between tests.
afterEach(cleanup);

/** Throws on render until `shouldThrow.current` is flipped off. */
function Bomb({ shouldThrow }: { shouldThrow: { current: boolean } }): ReactElement {
  if (shouldThrow.current) {
    throw new Error('kaboom');
  }
  return <div>All good</div>;
}

// React logs caught errors to the console by default; keep test output clean.
function silenceConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    silenceConsoleError();
    render(<ErrorBoundary><div>Hello</div></ErrorBoundary>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('shows the fallback with the error message when a child throws', () => {
    silenceConsoleError();
    const shouldThrow = { current: true };
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('kaboom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy diagnostics' })).toBeInTheDocument();
  });

  it('the inline variant shows only Try again', () => {
    silenceConsoleError();
    const shouldThrow = { current: true };
    render(
      <ErrorBoundary variant="inline">
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy diagnostics' })).not.toBeInTheDocument();
  });

  it('Try again re-renders the children once the underlying problem is fixed', async () => {
    silenceConsoleError();
    const user = userEvent.setup();
    const shouldThrow = { current: true };

    render(
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Fix the condition that caused the throw, mirroring what a real
    // `onReset` handler (e.g. clearing a crash flag) would do.
    shouldThrow.current = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('All good')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('calls onReset before clearing its own error state', async () => {
    silenceConsoleError();
    const user = userEvent.setup();
    const shouldThrow = { current: true };
    const onReset = vi.fn(() => {
      shouldThrow.current = false;
    });

    render(
      <ErrorBoundary onReset={onReset}>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('Copy diagnostics writes a diagnostics JSON blob to the clipboard', async () => {
    silenceConsoleError();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const shouldThrow = { current: true };
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const written = JSON.parse(writeText.mock.calls[0][0] as string);
    expect(written.message).toBe('kaboom');
    expect(typeof written.stack).toBe('string');
    expect(typeof written.componentStack).toBe('string');
    expect(written.appVersion).toBe('dev');
    expect(typeof written.userAgent).toBe('string');
    expect(typeof written.url).toBe('string');
    expect(typeof written.timestamp).toBe('string');
    expect(Array.isArray(written.breadcrumbs)).toBe(true);
  });
});
