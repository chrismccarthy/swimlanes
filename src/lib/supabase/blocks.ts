import { supabase } from './client';
import { blockFromDb } from './mappers';
import type { DbBlock } from './mappers';
import { ConflictError } from './errors';
import type { Block } from '../../types';

/** Fields of a block a client may write; `updatedAt` is owned by the server. */
export type BlockPatch = Partial<Omit<Block, 'id' | 'updatedAt'>>;

interface UpdatedAtRow {
  updated_at: string;
}

export async function fetchBlocks(): Promise<Block[]> {
  const { data, error } = await supabase.from('blocks').select('*');
  if (error) throw error;
  return (data as DbBlock[]).map(blockFromDb);
}

/** Re-read one block — used to show the winning version after a conflict. */
export async function fetchBlock(id: string): Promise<Block | null> {
  const { data, error } = await supabase
    .from('blocks')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? blockFromDb(data as DbBlock) : null;
}

/** Returns the server-assigned `updated_at` so the client stores the real value. */
export async function insertBlock(block: Block, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('blocks')
    .insert({
      id: block.id,
      member_id: block.memberId,
      title: block.title,
      start_date: block.startDate,
      end_date: block.endDate,
      color: block.color,
      created_by: userId,
      updated_by: userId,
    })
    .select('updated_at')
    .single();
  if (error) throw error;
  return (data as UpdatedAtRow).updated_at;
}

/**
 * Conditional update: only writes when the row still carries `expectedUpdatedAt`.
 * The `set_updated_fields()` trigger (migration 003) rewrites `updated_at` on
 * every update, so that column is a reliable version token.
 *
 * @throws ConflictError when no row matched (someone else wrote first).
 * @returns the new `updated_at` to store as the client's version token.
 */
export async function updateBlockFields(
  id: string,
  patch: BlockPatch,
  expectedUpdatedAt: string,
): Promise<string> {
  const dbPatch: Record<string, unknown> = {};
  if (patch.memberId !== undefined) dbPatch.member_id = patch.memberId;
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.startDate !== undefined) dbPatch.start_date = patch.startDate;
  if (patch.endDate !== undefined) dbPatch.end_date = patch.endDate;
  if (patch.color !== undefined) dbPatch.color = patch.color;

  const { data, error } = await supabase
    .from('blocks')
    .update(dbPatch)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select('updated_at');
  if (error) throw error;
  const rows = (data ?? []) as UpdatedAtRow[];
  if (rows.length === 0) throw new ConflictError('block', id);
  return rows[0].updated_at;
}

/**
 * Deletes are unconditional on purpose — removing a block somebody else just
 * edited is acceptable, and deleting an already-deleted row is a no-op (a
 * zero-row delete is not an error).
 */
export async function deleteBlockById(id: string) {
  const { error } = await supabase.from('blocks').delete().eq('id', id);
  if (error) throw error;
}
