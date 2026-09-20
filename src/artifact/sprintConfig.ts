// Artifact-build replacement for lib/supabase/sprintConfig.ts (same exports).
import { getBackend } from './backend';
import type { SprintConfig } from '../types';

export async function fetchSprintConfig(boardId: string): Promise<SprintConfig> {
  return (await getBackend()).fetchSprintConfig(boardId);
}

/** @throws ConflictError when the config no longer carries `expectedUpdatedAt`. */
export async function updateSprintConfigFields(
  boardId: string,
  anchorDate: string,
  lengthDays: number,
  expectedUpdatedAt: string,
): Promise<string> {
  return (await getBackend()).setSprintConfig(boardId, { anchorDate, lengthDays }, expectedUpdatedAt);
}
