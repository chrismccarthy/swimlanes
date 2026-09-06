// Artifact-build replacement for lib/supabase/sprintConfig.ts (same exports).
import { getBackend } from './backend';
import type { SprintConfig } from '../types';

export async function fetchSprintConfig(): Promise<SprintConfig> {
  return (await getBackend()).fetchSprintConfig();
}

export async function updateSprintConfigFields(
  anchorDate: string,
  lengthDays: number,
) {
  await (await getBackend()).setSprintConfig({ anchorDate, lengthDays });
}
