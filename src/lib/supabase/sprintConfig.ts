import { supabase } from './client';
import { sprintConfigFromDb } from './mappers';
import type { DbSprintConfig } from './mappers';
import type { SprintConfig } from '../../types';

export async function fetchSprintConfig(): Promise<SprintConfig> {
  const { data, error } = await supabase
    .from('sprint_config')
    .select('*')
    .eq('id', 1)
    .single();
  if (error) throw error;
  return sprintConfigFromDb(data as DbSprintConfig);
}

export async function updateSprintConfigFields(
  anchorDate: string,
  lengthDays: number,
) {
  const { error } = await supabase
    .from('sprint_config')
    .update({ anchor_date: anchorDate, length_days: lengthDays })
    .eq('id', 1);
  if (error) throw error;
}
