// Artifact-build replacement for lib/supabase/blocks.ts (same exports).
import { getBackend } from './backend';
import type { BlockPatch } from './backend';
import type { Block } from '../types';

export type { BlockPatch };

export async function fetchBlocks(boardId: string): Promise<Block[]> {
  return (await getBackend()).fetchBlocks(boardId);
}

export async function fetchBlock(id: string): Promise<Block | null> {
  return (await getBackend()).fetchBlock(id);
}

export async function insertBlock(block: Block, userId: string): Promise<string> {
  void userId; // access is per-artifact, not per-user, in this build
  return (await getBackend()).insertBlock(block);
}

/** @throws ConflictError when the row no longer carries `expectedUpdatedAt`. */
export async function updateBlockFields(
  id: string,
  patch: BlockPatch,
  expectedUpdatedAt: string,
): Promise<string> {
  return (await getBackend()).updateBlock(id, patch, expectedUpdatedAt);
}

export async function deleteBlockById(id: string) {
  await (await getBackend()).deleteBlock(id);
}
