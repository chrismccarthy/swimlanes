import { supabase } from './client';
import { memberFromDb } from './mappers';
import type { DbMember } from './mappers';
import type { Member } from '../../types';

export async function fetchMembers(): Promise<Member[]> {
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .order('sort_order');
  if (error) throw error;
  return (data as DbMember[]).map(memberFromDb);
}

export async function insertMember(
  member: { id: string; name: string; sortOrder: number },
  userId: string,
) {
  const { error } = await supabase.from('members').insert({
    id: member.id,
    name: member.name,
    sort_order: member.sortOrder,
    created_by: userId,
    updated_by: userId,
  });
  if (error) throw error;
}

export async function updateMemberName(id: string, name: string) {
  const { error } = await supabase
    .from('members')
    .update({ name })
    .eq('id', id);
  if (error) throw error;
}

export async function updateMemberSortOrder(id: string, sortOrder: number) {
  const { error } = await supabase
    .from('members')
    .update({ sort_order: sortOrder })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteMember(id: string) {
  const { error } = await supabase.from('members').delete().eq('id', id);
  if (error) throw error;
}
