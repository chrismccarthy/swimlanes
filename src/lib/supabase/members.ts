import { supabase } from './client';
import { memberFromDb } from './mappers';
import type { DbMember } from './mappers';
import { ConflictError } from './errors';
import type { Member } from '../../types';

interface UpdatedAtRow {
  updated_at: string;
}

export async function fetchMembers(): Promise<Member[]> {
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .order('sort_order');
  if (error) throw error;
  return (data as DbMember[]).map(memberFromDb);
}

/** Re-read one member — used to show the winning version after a conflict. */
export async function fetchMember(id: string): Promise<Member | null> {
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? memberFromDb(data as DbMember) : null;
}

/** Returns the server-assigned `updated_at` so the client stores the real value. */
export async function insertMember(
  member: { id: string; name: string; sortOrder: number },
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('members')
    .insert({
      id: member.id,
      name: member.name,
      sort_order: member.sortOrder,
      created_by: userId,
      updated_by: userId,
    })
    .select('updated_at')
    .single();
  if (error) throw error;
  return (data as UpdatedAtRow).updated_at;
}

/**
 * Conditional update guarded by the member's last known `updated_at`.
 *
 * @throws ConflictError when no row matched (someone else wrote first).
 * @returns the new `updated_at` to store as the client's version token.
 */
async function updateMemberFields(
  id: string,
  dbPatch: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('members')
    .update(dbPatch)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select('updated_at');
  if (error) throw error;
  const rows = (data ?? []) as UpdatedAtRow[];
  if (rows.length === 0) throw new ConflictError('member', id);
  return rows[0].updated_at;
}

export function updateMemberName(
  id: string,
  name: string,
  expectedUpdatedAt: string,
): Promise<string> {
  return updateMemberFields(id, { name }, expectedUpdatedAt);
}

export function updateMemberSortOrder(
  id: string,
  sortOrder: number,
  expectedUpdatedAt: string,
): Promise<string> {
  return updateMemberFields(id, { sort_order: sortOrder }, expectedUpdatedAt);
}

/**
 * Deletes are unconditional on purpose, and a zero-row delete (already gone)
 * resolves rather than erroring.
 */
export async function deleteMember(id: string) {
  const { error } = await supabase.from('members').delete().eq('id', id);
  if (error) throw error;
}
