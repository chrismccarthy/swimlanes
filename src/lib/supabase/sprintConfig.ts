import { supabase } from './client';
import { sprintConfigFromDb } from './mappers';
import type { DbSprintConfig } from './mappers';
import { ConflictError } from './errors';
import type { SprintConfig } from '../../types';

interface UpdatedAtRow {
  updated_at: string;
}

/** One row per board since migration 007; a trigger creates it with the board. */
export async function fetchSprintConfig(boardId: string): Promise<SprintConfig> {
  const { data, error } = await supabase
    .from('sprint_config')
    .select('*')
    .eq('board_id', boardId)
    .single();
  if (error) throw error;
  return sprintConfigFromDb(data as DbSprintConfig);
}

/**
 * Conditional update guarded by the config's last known `updated_at`.
 *
 * @throws ConflictError when no row matched (someone else wrote first).
 * @returns the new `updated_at` to store as the client's version token.
 */
export async function updateSprintConfigFields(
  boardId: string,
  anchorDate: string,
  lengthDays: number,
  expectedUpdatedAt: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('sprint_config')
    .update({ anchor_date: anchorDate, length_days: lengthDays })
    .eq('board_id', boardId)
    .eq('updated_at', expectedUpdatedAt)
    .select('updated_at');
  if (error) throw error;
  const rows = (data ?? []) as UpdatedAtRow[];
  if (rows.length === 0) throw new ConflictError('sprint settings');
  return rows[0].updated_at;
}
