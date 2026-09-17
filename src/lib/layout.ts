import {
  daysBetween,
  addDaysToISO,
  addMonthsToISO,
  startOfWeekISO,
  startOfMonthISO,
  formatDayLabel,
  formatWeekLabel,
  formatMonthLabel,
  getDayOfWeek,
} from './dates';
import type { Block, TrackAssignment, ZoomLevel } from '../types';

/** Pixels per day at each zoom level. Quarter is tuned so ~90 days fit in ~720px. */
export const ZOOM_DAY_WIDTH: Record<ZoomLevel, number> = {
  day: 40,
  week: 16,
  quarter: 8,
};

/** Default (day-level) day width. Runtime callers must use the store's current width. */
export const DAY_WIDTH = ZOOM_DAY_WIDTH.day;
export const DRAG_THRESHOLD = 3; // px of movement before a drag is recognised
export const MIN_ROW_HEIGHT = 56;
export const BLOCK_HEIGHT = 40;
export const BLOCK_GAP = 8;
export const HEADER_HEIGHT = 56;
export const SIDEBAR_WIDTH = 200;
/** Below this rendered width a block shows its title only as a tooltip */
export const MIN_TITLE_WIDTH = 24;

/** Convert an ISO date to its pixel x-offset relative to a reference date */
export function dateToX(date: string, referenceDate: string, dayWidth: number = DAY_WIDTH): number {
  return daysBetween(referenceDate, date) * dayWidth;
}

/** Convert a pixel x-offset back to an ISO date string (snaps to whole days) */
export function xToDate(x: number, referenceDate: string, dayWidth: number = DAY_WIDTH): string {
  const days = Math.round(x / dayWidth);
  return addDaysToISO(referenceDate, days);
}

/** A labelled column in the timeline header: one day, one week or one month. */
export interface HeaderSegment {
  /** ISO date the segment starts on (may fall before the rendered range) */
  date: string;
  /** Offset in days from the rendered range start, clamped to >= 0 */
  offsetDays: number;
  /** Width of the segment in days, clipped to the rendered range */
  spanDays: number;
  /** Primary label text */
  label: string;
  /** Secondary label (day-of-week), only used at day zoom */
  subLabel?: string;
}

/**
 * Group the rendered day range into the header's label columns for a zoom level:
 * one per day at `day`, one per week (starting Monday) at `week`, one per month
 * at `quarter`. Segments at the edges are clipped to the rendered range.
 */
export function computeHeaderSegments(
  startDate: string,
  totalDays: number,
  zoom: ZoomLevel
): HeaderSegment[] {
  if (totalDays <= 0) return [];

  if (zoom === 'day') {
    const segments: HeaderSegment[] = [];
    let prev: string | null = null;
    for (let i = 0; i < totalDays; i++) {
      const date = addDaysToISO(startDate, i);
      segments.push({
        date,
        offsetDays: i,
        spanDays: 1,
        label: formatDayLabel(date, prev),
        subLabel: getDayOfWeek(date),
      });
      prev = date;
    }
    return segments;
  }

  const endDate = addDaysToISO(startDate, totalDays - 1);
  const segments: HeaderSegment[] = [];
  let cursor = zoom === 'week' ? startOfWeekISO(startDate) : startOfMonthISO(startDate);

  while (cursor <= endDate) {
    const next = zoom === 'week' ? addDaysToISO(cursor, 7) : addMonthsToISO(cursor, 1);
    const offsetDays = Math.max(0, daysBetween(startDate, cursor));
    const endExclusive = Math.min(totalDays, daysBetween(startDate, next));
    const spanDays = endExclusive - offsetDays;
    if (spanDays > 0) {
      segments.push({
        date: cursor,
        offsetDays,
        spanDays,
        label: zoom === 'week' ? formatWeekLabel(cursor) : formatMonthLabel(cursor),
      });
    }
    cursor = next;
  }

  return segments;
}

/**
 * Day offsets at which a grid tick should be drawn: every day at `day` and
 * `week` zoom, every Monday at `quarter` zoom (a line every 8px would be mud).
 */
export function computeTickOffsets(
  startDate: string,
  totalDays: number,
  zoom: ZoomLevel
): number[] {
  if (totalDays <= 0) return [];

  if (zoom !== 'quarter') {
    return Array.from({ length: totalDays }, (_, i) => i);
  }

  const offsets: number[] = [];
  let offset = daysBetween(startDate, startOfWeekISO(startDate));
  if (offset < 0) offset += 7;
  for (; offset < totalDays; offset += 7) {
    offsets.push(offset);
  }
  return offsets;
}

/** Weekend shading is too dense to be useful once days are only a few pixels wide */
export function showsWeekendShading(zoom: ZoomLevel): boolean {
  return zoom !== 'quarter';
}

/**
 * How many days the timeline should grow by when the user scrolls to an edge.
 * Scales with zoom so a zoomed-out view does not expand in tiny slivers.
 */
export function expansionDaysForWidth(dayWidth: number): number {
  return Math.max(30, Math.round(1200 / dayWidth));
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
