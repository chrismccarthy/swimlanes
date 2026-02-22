import { supabase } from './client';
import { blockFromDb } from './mappers';
import type { DbBlock } from './mappers';
import type { Block } from '../../types';

export async function fetchBlocks(): Promise<Block[]> {
  const { data, error } = await supabase.from('blocks').select('*');
  if (error) throw error;
  return (data as DbBlock[]).map(blockFromDb);
}

export async function insertBlock(block: Block, userId: string) {
  const { error } = await supabase.from('blocks').insert({
    id: block.id,
    member_id: block.memberId,
    title: block.title,
    start_date: block.startDate,
    end_date: block.endDate,
    color: block.color,
    created_by: userId,
    updated_by: userId,
  });
  if (error) throw error;
}

export async function updateBlockFields(
  id: string,
  patch: Partial<Omit<Block, 'id'>>,
) {
  const dbPatch: Record<string, unknown> = {};
  if (patch.memberId !== undefined) dbPatch.member_id = patch.memberId;
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.startDate !== undefined) dbPatch.start_date = patch.startDate;
  if (patch.endDate !== undefined) dbPatch.end_date = patch.endDate;
  if (patch.color !== undefined) dbPatch.color = patch.color;

  const { error } = await supabase.from('blocks').update(dbPatch).eq('id', id);
  if (error) throw error;
}

export async function deleteBlockById(id: string) {
  const { error } = await supabase.from('blocks').delete().eq('id', id);
  if (error) throw error;
}
