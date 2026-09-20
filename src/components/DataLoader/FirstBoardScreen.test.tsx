import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirstBoardScreen } from './FirstBoardScreen';
import { useAppStore } from '../../store/useAppStore';

// The screen only talks to the store, but importing the store pulls in the
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
  supportsMemberManagement: true,
  memberManagementNote: '',
  fetchBoards: vi.fn(),
  createBoard: vi.fn(() => new Promise(() => {})),
  renameBoard: vi.fn(),
  deleteBoard: vi.fn(),
  listBoardMembers: vi.fn(),
  addBoardMemberByEmail: vi.fn(),
  removeBoardMember: vi.fn(),
}));

const initialState = useAppStore.getState();

beforeEach(() => {
  useAppStore.setState(initialState, true);
});

afterEach(cleanup);

describe('FirstBoardScreen', () => {
  it('will not submit an empty name', async () => {
    render(<FirstBoardScreen />);

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Board name'), '  ');
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('creates the named board and makes it current', async () => {
    render(<FirstBoardScreen />);

    await userEvent.type(screen.getByLabelText('Board name'), 'Core Team');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    const { boards, currentBoardId } = useAppStore.getState();
    expect(boards.map(b => b.name)).toEqual(['Core Team']);
    expect(currentBoardId).toBe(boards[0].id);
  });
});
