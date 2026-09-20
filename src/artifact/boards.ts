// Artifact-build replacement for lib/supabase/boards.ts (same exports).
//
// Boards exist here exactly as they do against Supabase, but membership does
// not: whoever can open the artifact can open every board in it, because
// access is controlled by the artifact's share menu. The roster functions are
// therefore stubs, and `supportsMemberManagement` tells the Board settings
// modal to show a note instead of an add-by-email form.
import { getBackend } from './backend';
import type { Board, BoardMember, BoardRole } from '../types';

export const supportsMemberManagement = false;

export const memberManagementNote =
  'Everyone this artifact is shared with can open every board in it. ' +
  'Use the share menu above to change who has access.';

/** Matches VIEWER_KEY in src/artifact/AuthContext.tsx. */
const VIEWER_KEY = 'swimlanes.artifact.viewerId';

function viewerId(): string {
  try {
    return localStorage.getItem(VIEWER_KEY) ?? 'viewer';
  } catch {
    return 'viewer';
  }
}

export async function fetchBoards(): Promise<Board[]> {
  return (await getBackend()).fetchBoards();
}

export async function createBoard(name: string, id?: string): Promise<Board> {
  return (await getBackend()).createBoard(name, id);
}

/** @throws ConflictError when the board no longer carries `expectedUpdatedAt`. */
export async function renameBoard(
  id: string,
  name: string,
  expectedUpdatedAt: string,
): Promise<string> {
  return (await getBackend()).renameBoard(id, name, expectedUpdatedAt);
}

export async function deleteBoard(id: string): Promise<void> {
  await (await getBackend()).deleteBoard(id);
}

/** There is no roster to read — the only member this build knows of is you. */
export function listBoardMembers(boardId: string): Promise<BoardMember[]> {
  void boardId;
  return Promise.resolve([
    { userId: viewerId(), email: 'You (this browser)', role: 'owner' as BoardRole },
  ]);
}

export function addBoardMemberByEmail(
  boardId: string,
  email: string,
  role: BoardRole = 'editor',
): Promise<void> {
  void boardId;
  void email;
  void role;
  return Promise.reject(new Error(memberManagementNote));
}

export function removeBoardMember(boardId: string, userId: string): Promise<void> {
  void boardId;
  void userId;
  return Promise.reject(new Error(memberManagementNote));
}
