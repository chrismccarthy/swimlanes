import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromptDialog } from './PromptDialog';
import { useDialogStore } from '../../store/useDialogStore';
import { DialogHost } from './DialogHost';

// Vitest runs with `globals: false`, so Testing Library's automatic cleanup
// hook is not installed — unmount explicitly between tests.
afterEach(cleanup);

describe('PromptDialog (component)', () => {
  it('renders title, label and pre-fills the initial value, focused and selected', () => {
    render(
      <PromptDialog
        title="New board"
        label="Board name"
        initialValue="Team"
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    );

    const dialog = screen.getByRole('dialog', { name: 'New board' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const input = screen.getByLabelText('Board name') as HTMLInputElement;
    expect(input).toHaveValue('Team');
    expect(input).toHaveFocus();
  });

  it('calls onSubmit with the trimmed value when the primary button is clicked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PromptDialog
        title="New board"
        label="Board name"
        confirmLabel="Create"
        onSubmit={onSubmit}
        onCancel={() => {}}
      />
    );

    await user.type(screen.getByLabelText('Board name'), '  Platform  ');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).toHaveBeenCalledWith('Platform');
  });

  it('submits on Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PromptDialog
        title="New board"
        label="Board name"
        onSubmit={onSubmit}
        onCancel={() => {}}
      />
    );

    await user.type(screen.getByLabelText('Board name'), 'Platform{Enter}');

    expect(onSubmit).toHaveBeenCalledWith('Platform');
  });

  it('validation blocks submit and shows a message, until the input changes', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const validate = (value: string) => (value ? undefined : 'Board name is required');
    render(
      <PromptDialog
        title="New board"
        label="Board name"
        confirmLabel="Create"
        validate={validate}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Board name is required')).toBeInTheDocument();
    expect(screen.getByLabelText('Board name')).toHaveAttribute('aria-invalid', 'true');

    await user.type(screen.getByLabelText('Board name'), 'Platform');
    expect(screen.queryByText('Board name is required')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).toHaveBeenCalledWith('Platform');
  });

  it('calls onCancel when Cancel is clicked, when the overlay is clicked, or on Escape', () => {
    const onCancel = vi.fn();
    render(
      <PromptDialog
        title="New board"
        label="Board name"
        onSubmit={() => {}}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    const overlay = screen.getByRole('dialog').parentElement as Element;
    fireEvent.click(overlay);
    expect(onCancel).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(overlay, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  it('traps Tab focus: Tab from the last button wraps to the input', () => {
    render(
      <PromptDialog
        title="New board"
        label="Board name"
        confirmLabel="Create"
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    );

    const input = screen.getByLabelText('Board name');
    const createBtn = screen.getByRole('button', { name: 'Create' });

    createBtn.focus();
    expect(createBtn).toHaveFocus();
    fireEvent.keyDown(createBtn, { key: 'Tab' });
    expect(input).toHaveFocus();

    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(createBtn).toHaveFocus();
  });
});

describe('prompt() via the dialog store', () => {
  afterEach(() => {
    useDialogStore.setState({ confirmRequest: null, promptRequest: null });
  });

  it('resolves the trimmed string when submitted', async () => {
    const user = userEvent.setup();
    render(<DialogHost />);

    const resultPromise = useDialogStore.getState().prompt({
      title: 'New board',
      label: 'Board name',
      confirmLabel: 'Create',
    });

    await screen.findByRole('dialog', { name: 'New board' });
    await user.type(screen.getByLabelText('Board name'), 'Platform');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await resultPromise).toBe('Platform');
  });

  it('resolves null when cancelled', async () => {
    render(<DialogHost />);

    const resultPromise = useDialogStore.getState().prompt({
      title: 'New board',
      label: 'Board name',
    });

    await screen.findByRole('dialog', { name: 'New board' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await resultPromise).toBeNull();
  });
});
