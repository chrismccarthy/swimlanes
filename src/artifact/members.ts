// Artifact-build replacement for lib/supabase/members.ts (same exports).
import { getBackend } from './backend';
import type { Member } from '../types';

export async function fetchMembers(boardId: string): Promise<Member[]> {
  return (await getBackend()).fetchMembers(boardId);
}

export async function fetchMember(id: string): Promise<Member | null> {
  return (await getBackend()).fetchMember(id);
}

export async function insertMember(
  member: { id: string; boardId: string; name: string; sortOrder: number },
  userId: string,
): Promise<string> {
  void userId; // access is per-artifact, not per-user, in this build
  return (await getBackend()).insertMember(member);
}

/** @throws ConflictError when the row no longer carries `expectedUpdatedAt`. */
export async function updateMemberName(
  id: string,
  name: string,
  expectedUpdatedAt: string,
): Promise<string> {
  return (await getBackend()).updateMember(id, { name }, expectedUpdatedAt);
}

/** @throws ConflictError when the row no longer carries `expectedUpdatedAt`. */
export async function updateMemberSortOrder(
  id: string,
  sortOrder: number,
  expectedUpdatedAt: string,
): Promise<string> {
  return (await getBackend()).updateMember(id, { sortOrder }, expectedUpdatedAt);
}

export async function deleteMember(id: string) {
  await (await getBackend()).deleteMember(id);
}
