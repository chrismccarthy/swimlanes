// Artifact-build replacement for lib/supabase/members.ts (same exports).
import { getBackend } from './backend';
import type { Member } from '../types';

export async function fetchMembers(): Promise<Member[]> {
  return (await getBackend()).fetchMembers();
}

export async function insertMember(
  member: { id: string; name: string; sortOrder: number },
  userId: string,
) {
  void userId; // access is per-artifact, not per-user, in this build
  await (await getBackend()).insertMember(member);
}

export async function updateMemberName(id: string, name: string) {
  await (await getBackend()).updateMember(id, { name });
}

export async function updateMemberSortOrder(id: string, sortOrder: number) {
  await (await getBackend()).updateMember(id, { sortOrder });
}

export async function deleteMember(id: string) {
  await (await getBackend()).deleteMember(id);
}
