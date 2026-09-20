import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';
import { useDialogStore } from '../../store/useDialogStore';
import { DialogHost } from './DialogHost';

// Vitest runs with `globals: false`, so Testing Library's automatic cleanup
// hook is not installed — unmount explicitly between tests.
afterEach(cleanup);

describe('ConfirmDialog (component)', () => {
  it('renders title, message and a danger-styled primary button', () => {
    render(
      <ConfirmDialog
        title="Delete block?"
        message="Delete this block?"
        confirmLabel="Delete"
        danger
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    const dialog = screen.getByRole('dialog', { name: 'Delete block?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Delete this block?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('focuses the primary button on mount', () => {
    render(
      <ConfirmDialog
        title="Delete block?"
        message="Delete this block?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
  });

  it('calls onConfirm when the primary button is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Delete block?"
        message="Delete this block?"
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel is clicked, when the overlay is clicked, or on Escape', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Delete block?"
        message="Delete this block?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Clicking the overlay itself (outside the modal card) also cancels.
    const overlay = screen.getByRole('dialog').parentElement as Element;
    fireEvent.click(overlay);
    expect(onCancel).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(overlay, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  it('clicking inside the modal card does not cancel', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Delete block?"
        message="Delete this block?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByText('Delete this block?'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('traps Tab focus: Tab from the last button wraps to the first', () => {
    render(
      <ConfirmDialog
        title="Delete block?"
        message="Delete this block?"
        confirmLabel="Delete"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    const confirmBtn = screen.getByRole('button', { name: 'Delete' });

    confirmBtn.focus();
    expect(confirmBtn).toHaveFocus();
    fireEvent.keyDown(confirmBtn, { key: 'Tab' });
    expect(cancelBtn).toHaveFocus();

    fireEvent.keyDown(cancelBtn, { key: 'Tab', shiftKey: true });
    expect(confirmBtn).toHaveFocus();
  });
});

describe('confirm() via the dialog store', () => {
  afterEach(() => {
    useDialogStore.setState({ confirmRequest: null, promptRequest: null });
  });

  it('resolves true when the dialog is confirmed', async () => {
    render(<DialogHost />);

    const resultPromise = useDialogStore.getState().confirm({
      title: 'Delete board?',
      message: 'Sure?',
      confirmLabel: 'Delete',
      danger: true,
    });

    await screen.findByRole('dialog', { name: 'Delete board?' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await resultPromise).toBe(true);
  });

  it('resolves false when the dialog is cancelled', async () => {
    render(<DialogHost />);

    const resultPromise = useDialogStore.getState().confirm({
      title: 'Delete board?',
      message: 'Sure?',
    });

    await screen.findByRole('dialog', { name: 'Delete board?' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await resultPromise).toBe(false);
  });
});
