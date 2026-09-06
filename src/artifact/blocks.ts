// Artifact-build replacement for lib/supabase/blocks.ts (same exports).
import { getBackend } from './backend';
import type { Block } from '../types';

export async function fetchBlocks(): Promise<Block[]> {
  return (await getBackend()).fetchBlocks();
}

export async function insertBlock(block: Block, userId: string) {
  void userId; // access is per-artifact, not per-user, in this build
  await (await getBackend()).insertBlock(block);
}

export async function updateBlockFields(
  id: string,
  patch: Partial<Omit<Block, 'id'>>,
) {
  await (await getBackend()).updateBlock(id, patch);
}

export async function deleteBlockById(id: string) {
  await (await getBackend()).deleteBlock(id);
}
