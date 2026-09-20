import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastContainer } from './ToastContainer';
import { useAppStore } from '../../store/useAppStore';

// The container only reads the store, but importing the store pulls in the
// data layer, which must not reach for Supabase in a unit test.
vi.mock('../../lib/supabase/members', () => ({
  fetchMember: vi.fn(), insertMember: vi.fn(), updateMemberName: vi.fn(),
  updateMemberSortOrder: vi.fn(), deleteMember: vi.fn(),
}));
vi.mock('../../lib/supabase/blocks', () => ({
  fetchBlock: vi.fn(), insertBlock: vi.fn(), updateBlockFields: vi.fn(), deleteBlockById: vi.fn(),
}));
vi.mock('../../lib/supabase/sprintConfig', () => ({
  fetchSprintConfig: vi.fn(), updateSprintConfigFields: vi.fn(),
}));
vi.mock('../../lib/supabase/boards', () => ({
  supportsMemberManagement: true, memberManagementNote: '',
  fetchBoards: vi.fn(), createBoard: vi.fn(), renameBoard: vi.fn(), deleteBoard: vi.fn(),
  listBoardMembers: vi.fn(), addBoardMemberByEmail: vi.fn(), removeBoardMember: vi.fn(),
}));

const initialState = useAppStore.getState();

beforeEach(() => {
  useAppStore.setState(initialState, true);
});

afterEach(cleanup);

describe('ToastContainer', () => {
  it('shows a plain toast without any button', () => {
    useAppStore.getState().addToast('Failed to save block changes', 'error');
    render(<ToastContainer />);

    expect(screen.getByText('Failed to save block changes')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('runs the action when its button is clicked', async () => {
    const onClick = vi.fn();
    useAppStore.getState().addToast('Block deleted', 'info', { label: 'Undo', onClick });
    render(<ToastContainer />);

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('dismisses the toast the action belonged to', async () => {
    useAppStore.getState().addToast('Block deleted', 'info', { label: 'Undo', onClick: vi.fn() });
    render(<ToastContainer />);

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(useAppStore.getState().toasts).toHaveLength(0);
    expect(screen.queryByText('Block deleted')).not.toBeInTheDocument();
  });
});
