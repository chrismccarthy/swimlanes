import { supabase } from './client';
import { boardFromDb, boardMemberFromDb } from './mappers';
import type { DbBoard, DbBoardMember } from './mappers';
import { ConflictError } from './errors';
import type { Board, BoardMember, BoardRole } from '../../types';

/**
 * Board membership is real here: RLS decides who may read a board and only
 * owners may change its roster. The artifact build sets this to `false`,
 * because there access is controlled by artifact sharing instead.
 */
export const supportsMemberManagement = true;

/** Shown instead of the add-by-email form when membership is not manageable. */
export const memberManagementNote = '';

interface UpdatedAtRow {
  updated_at: string;
}

/** The signed-in user's id, read from the local session (no network hop). */
async function currentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user.id ?? null;
}

/**
 * Every board the caller belongs to, carrying their own role.
 *
 * The `!inner` join on `board_members` filtered to the caller is what turns
 * "boards I can see" into "boards I am on, with my role"; RLS already hides
 * everything else.
 */
export async function fetchBoards(): Promise<Board[]> {
  const userId = await currentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from('boards')
    .select('id, name, updated_at, board_members!inner(role)')
    .eq('board_members.user_id', userId)
    .order('name');
  if (error) throw error;
  return (data as unknown as DbBoard[]).map(boardFromDb);
}

/**
 * Creates a board and returns it with the caller's role.
 *
 * `id` may be supplied so an optimistic row in the store keeps its identity
 * once the insert lands. A trigger makes the creator the board's owner and
 * gives it default sprint settings (migration 007).
 */
export async function createBoard(name: string, id?: string): Promise<Board> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from('boards')
    .insert({
      ...(id ? { id } : {}),
      name,
      created_by: userId,
      updated_by: userId,
    })
    .select('id, name, updated_at')
    .single();
  if (error) throw error;
  const row = data as { id: string; name: string; updated_at: string };
  return { id: row.id, name: row.name, role: 'owner', updatedAt: row.updated_at };
}

/**
 * Conditional rename guarded by the board's last known `updated_at`.
 *
 * @throws ConflictError when no row matched (someone else wrote first, or the
 *   caller is not an owner).
 */
export async function renameBoard(
  id: string,
  name: string,
  expectedUpdatedAt: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('boards')
    .update({ name })
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select('updated_at');
  if (error) throw error;
  const rows = (data ?? []) as UpdatedAtRow[];
  if (rows.length === 0) throw new ConflictError('board', id);
  return rows[0].updated_at;
}

/** Owners only (RLS). Members, blocks and sprint settings cascade away with it. */
export async function deleteBoard(id: string): Promise<void> {
  const { error } = await supabase.from('boards').delete().eq('id', id);
  if (error) throw error;
}

/** The board's roster with emails, via the view that may join `auth.users`. */
export async function listBoardMembers(boardId: string): Promise<BoardMember[]> {
  const { data, error } = await supabase
    .from('board_members_view')
    .select('user_id, email, role')
    .eq('board_id', boardId)
    .order('email');
  if (error) throw error;
  return (data as DbBoardMember[]).map(boardMemberFromDb);
}

/**
 * Invites by email address. Clients cannot read `auth.users`, so the lookup
 * happens inside a security-definer function which also re-checks ownership
 * and reports an unknown address as a plain error message.
 */
export async function addBoardMemberByEmail(
  boardId: string,
  email: string,
  role: BoardRole = 'editor',
): Promise<void> {
  const { error } = await supabase.rpc('add_board_member_by_email', {
    p_board_id: boardId,
    p_email: email,
    p_role: role,
  });
  if (error) throw new Error(error.message);
}

/** Owners only (RLS); a trigger refuses to remove a board's last owner. */
export async function removeBoardMember(boardId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('board_members')
    .delete()
    .eq('board_id', boardId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}
