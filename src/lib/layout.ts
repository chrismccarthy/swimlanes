import { daysBetween, addDaysToISO } from './dates';
import type { Block, TrackAssignment } from '../types';

export const DAY_WIDTH = 40;
export const DRAG_THRESHOLD = 3; // px of movement before a drag is recognised
export const MIN_ROW_HEIGHT = 56;
export const BLOCK_HEIGHT = 40;
export const BLOCK_GAP = 8;
export const HEADER_HEIGHT = 56;
export const SIDEBAR_WIDTH = 200;

/** Convert an ISO date to its pixel x-offset relative to a reference date */
export function dateToX(date: string, referenceDate: string): number {
  return daysBetween(referenceDate, date) * DAY_WIDTH;
}

/** Convert a pixel x-offset back to an ISO date string */
export function xToDate(x: number, referenceDate: string): string {
  const days = Math.round(x / DAY_WIDTH);
  return addDaysToISO(referenceDate, days);
}

/** Check if two date ranges overlap (both inclusive) */
function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Assign blocks to vertical tracks within a swim lane.
 * Returns track assignments and the total number of tracks used.
 */
export function assignTracks(blocks: Block[]): { assignments: TrackAssignment[]; trackCount: number } {
  if (blocks.length === 0) {
    return { assignments: [], trackCount: 0 };
  }

  // Sort by startDate, then by endDate for stability
  const sorted = [...blocks].sort((a, b) => {
    const cmp = a.startDate.localeCompare(b.startDate);
    if (cmp !== 0) return cmp;
    return a.endDate.localeCompare(b.endDate);
  });

  // Each track stores the blocks assigned to it
  const tracks: Block[][] = [];
  const assignments: TrackAssignment[] = [];

  for (const block of sorted) {
    let placed = false;
    for (let t = 0; t < tracks.length; t++) {
      // Check if this track has space (no overlap with any block in it)
      const hasConflict = tracks[t].some(existing =>
        rangesOverlap(existing.startDate, existing.endDate, block.startDate, block.endDate)
      );
      if (!hasConflict) {
        tracks[t].push(block);
        assignments.push({ block, trackIndex: t });
        placed = true;
        break;
      }
    }
    if (!placed) {
      tracks.push([block]);
      assignments.push({ block, trackIndex: tracks.length - 1 });
    }
  }

  return { assignments, trackCount: tracks.length };
}

/** Compute the dynamic row height for a swim lane based on how many tracks it needs */
export function computeRowHeight(trackCount: number): number {
  if (trackCount === 0) return MIN_ROW_HEIGHT;
  return Math.max(MIN_ROW_HEIGHT, trackCount * (BLOCK_HEIGHT + BLOCK_GAP) + BLOCK_GAP);
}

/** Compute the top offset of a block within its swim lane row */
export function blockTopOffset(trackIndex: number): number {
  return BLOCK_GAP + trackIndex * (BLOCK_HEIGHT + BLOCK_GAP);
}
