import { describe, it, expect } from 'vitest';
import {
  ZOOM_DAY_WIDTH,
  BLOCK_HEIGHT,
  BLOCK_GAP,
  MIN_ROW_HEIGHT,
  CAPACITY_STRIP_HEIGHT,
  rangeGeometry,
  dateToX,
  xToDate,
  assignTracks,
  blockTopOffset,
  computeRowHeight,
  computeHeaderSegments,
  computeTickOffsets,
  showsWeekendShading,
  expansionDaysForWidth,
  visibleTagCount,
  MIN_ONE_TAG_WIDTH,
  MIN_TWO_TAG_WIDTH,
} from './layout';
import type { Block, ZoomLevel } from '../types';

const REF = '2026-09-01'; // Tuesday

function block(id: string, startDate: string, endDate: string): Block {
  return {
    id,
    boardId: 'board-1',
    memberId: 'm1',
    title: id,
    startDate,
    endDate,
    color: 'blue',
    tags: [],
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

const ZOOMS: ZoomLevel[] = ['day', 'week', 'quarter'];

describe('dateToX / xToDate', () => {
  it('places the reference date at x = 0 at every zoom', () => {
    for (const zoom of ZOOMS) {
      expect(dateToX(REF, REF, ZOOM_DAY_WIDTH[zoom])).toBe(0);
    }
  });

  it('scales linearly with the day width and signs dates before the reference', () => {
    expect(dateToX('2026-09-11', REF, 40)).toBe(400);
    expect(dateToX('2026-09-11', REF, 16)).toBe(160);
    expect(dateToX('2026-09-11', REF, 8)).toBe(80);
    expect(dateToX('2026-08-30', REF, 40)).toBe(-80);
  });

  it('defaults to the day-zoom width', () => {
    expect(dateToX('2026-09-02', REF)).toBe(ZOOM_DAY_WIDTH.day);
    expect(xToDate(ZOOM_DAY_WIDTH.day, REF)).toBe('2026-09-02');
  });

  it('round-trips whole days at every zoom width', () => {
    for (const zoom of ZOOMS) {
      const width = ZOOM_DAY_WIDTH[zoom];
      for (const offset of [-45, -7, -1, 0, 1, 13, 90]) {
        const date = xToDate(offset * width, REF, width);
        expect(dateToX(date, REF, width)).toBe(offset * width);
      }
    }
  });

  it('snaps a fractional offset to the nearest whole day', () => {
    // 40px/day: 58px is 1.45 days -> day 1; 62px is 1.55 days -> day 2.
    expect(xToDate(58, REF, 40)).toBe('2026-09-02');
    expect(xToDate(62, REF, 40)).toBe('2026-09-03');
    // The same rounding at the narrowest zoom.
    expect(xToDate(11, REF, 8)).toBe('2026-09-02');
    expect(xToDate(13, REF, 8)).toBe('2026-09-03');
  });

  it('rounds negative offsets to whole days too', () => {
    expect(xToDate(-40, REF, 40)).toBe('2026-08-31');
    expect(xToDate(-50, REF, 40)).toBe('2026-08-31');
    expect(xToDate(-70, REF, 40)).toBe('2026-08-30');
  });

  it('survives a DST boundary (dates are calendar days, not 24h multiples)', () => {
    // Northern-hemisphere clocks change in late March / late October.
    expect(dateToX('2026-11-02', '2026-10-30', 40)).toBe(120);
    expect(xToDate(120, '2026-10-30', 40)).toBe('2026-11-02');
  });
});

describe('assignTracks', () => {
  it('returns nothing for an empty lane', () => {
    expect(assignTracks([])).toEqual({ assignments: [], trackCount: 0 });
  });

  it('keeps non-overlapping blocks on one track', () => {
    const result = assignTracks([
      block('a', '2026-09-01', '2026-09-03'),
      block('b', '2026-09-05', '2026-09-07'),
      block('c', '2026-09-09', '2026-09-10'),
    ]);
    expect(result.trackCount).toBe(1);
    expect(result.assignments.map(a => a.trackIndex)).toEqual([0, 0, 0]);
  });

  it('pushes an overlapping block onto a second track', () => {
    const result = assignTracks([
      block('a', '2026-09-01', '2026-09-05'),
      block('b', '2026-09-03', '2026-09-08'),
    ]);
    expect(result.trackCount).toBe(2);
    expect(result.assignments.map(a => [a.block.id, a.trackIndex])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });

  it('treats touching ranges as overlapping (end dates are inclusive)', () => {
    const result = assignTracks([
      block('a', '2026-09-01', '2026-09-03'),
      block('b', '2026-09-03', '2026-09-05'),
    ]);
    expect(result.trackCount).toBe(2);
  });

  it('puts a block starting the day after the previous one back on track 0', () => {
    const result = assignTracks([
      block('a', '2026-09-01', '2026-09-03'),
      block('b', '2026-09-04', '2026-09-06'),
    ]);
    expect(result.trackCount).toBe(1);
  });

  it('needs three tracks for a chain of three mutually overlapping blocks', () => {
    const result = assignTracks([
      block('a', '2026-09-01', '2026-09-10'),
      block('b', '2026-09-02', '2026-09-11'),
      block('c', '2026-09-03', '2026-09-12'),
    ]);
    expect(result.trackCount).toBe(3);
    expect(result.assignments.map(a => a.trackIndex)).toEqual([0, 1, 2]);
  });

  it('reuses the first free track rather than always opening a new one', () => {
    // a and b overlap; c starts after a ends, so it fits back on track 0.
    const result = assignTracks([
      block('a', '2026-09-01', '2026-09-03'),
      block('b', '2026-09-02', '2026-09-20'),
      block('c', '2026-09-05', '2026-09-07'),
    ]);
    expect(result.trackCount).toBe(2);
    expect(result.assignments.map(a => [a.block.id, a.trackIndex])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 0],
    ]);
  });

  it('orders assignments by start date then end date, whatever the input order', () => {
    const shuffled = [
      block('late', '2026-09-20', '2026-09-21'),
      block('earlyLong', '2026-09-01', '2026-09-09'),
      block('earlyShort', '2026-09-01', '2026-09-02'),
    ];
    const result = assignTracks(shuffled);
    expect(result.assignments.map(a => a.block.id)).toEqual([
      'earlyShort',
      'earlyLong',
      'late',
    ]);
  });

  it('does not mutate the array it is given', () => {
    const input = [
      block('b', '2026-09-10', '2026-09-11'),
      block('a', '2026-09-01', '2026-09-02'),
    ];
    assignTracks(input);
    expect(input.map(b => b.id)).toEqual(['b', 'a']);
  });

  it('is deterministic for identical ranges', () => {
    const blocks = [
      block('x', '2026-09-01', '2026-09-02'),
      block('y', '2026-09-01', '2026-09-02'),
    ];
    const first = assignTracks(blocks);
    const second = assignTracks(blocks);
    expect(first.trackCount).toBe(2);
    expect(second.assignments.map(a => [a.block.id, a.trackIndex])).toEqual(
      first.assignments.map(a => [a.block.id, a.trackIndex])
    );
  });
});

describe('computeRowHeight / blockTopOffset', () => {
  it('never goes below the minimum row height', () => {
    expect(computeRowHeight(0)).toBe(MIN_ROW_HEIGHT);
    expect(computeRowHeight(1)).toBe(MIN_ROW_HEIGHT);
  });

  it('grows by one block plus a gap per extra track', () => {
    expect(computeRowHeight(2)).toBe(2 * (BLOCK_HEIGHT + BLOCK_GAP) + BLOCK_GAP);
    expect(computeRowHeight(3) - computeRowHeight(2)).toBe(BLOCK_HEIGHT + BLOCK_GAP);
  });

  it('leaves a gap below the last track', () => {
    const tracks = 3;
    const lastBottom = blockTopOffset(tracks - 1) + BLOCK_HEIGHT;
    expect(computeRowHeight(tracks) - lastBottom).toBe(BLOCK_GAP);
  });

  it('adds reserved height on top of the row, leaving the minimum alone', () => {
    // The capacity strip reserves a band above the tracks. The tracks keep the
    // height they would have had, so nothing overlaps.
    for (const tracks of [0, 1, 2, 5]) {
      expect(computeRowHeight(tracks, CAPACITY_STRIP_HEIGHT))
        .toBe(computeRowHeight(tracks) + CAPACITY_STRIP_HEIGHT);
    }
    expect(computeRowHeight(0, CAPACITY_STRIP_HEIGHT)).toBe(MIN_ROW_HEIGHT + CAPACITY_STRIP_HEIGHT);
  });

  it('reserves nothing by default', () => {
    expect(computeRowHeight(2, 0)).toBe(computeRowHeight(2));
  });
});

describe('rangeGeometry', () => {
  const START = '2026-09-01';
  const TOTAL_DAYS = 30;

  it('places a range fully inside the rendered window', () => {
    expect(rangeGeometry('2026-09-03', '2026-09-05', START, TOTAL_DAYS, 40)).toEqual({
      left: 2 * 40,
      width: 3 * 40,
    });
  });

  it('clips a range that starts before the window', () => {
    expect(rangeGeometry('2026-08-25', '2026-09-02', START, TOTAL_DAYS, 40)).toEqual({
      left: 0,
      width: 2 * 40,
    });
  });

  it('clips a range that runs past the end of the window', () => {
    // The window covers Sep 1..Sep 30 (30 days).
    expect(rangeGeometry('2026-09-29', '2026-10-15', START, TOTAL_DAYS, 40)).toEqual({
      left: 28 * 40,
      width: 2 * 40,
    });
  });

  it('is null for a range entirely outside the window', () => {
    expect(rangeGeometry('2026-07-01', '2026-07-10', START, TOTAL_DAYS, 40)).toBeNull();
    expect(rangeGeometry('2026-11-01', '2026-11-10', START, TOTAL_DAYS, 40)).toBeNull();
  });

  it('scales with the day width', () => {
    for (const zoom of ZOOMS) {
      const width = ZOOM_DAY_WIDTH[zoom];
      expect(rangeGeometry('2026-09-08', '2026-09-21', START, TOTAL_DAYS, width)).toEqual({
        left: 7 * width,
        width: 14 * width,
      });
    }
  });
});

describe('computeHeaderSegments', () => {
  it('returns nothing for an empty range', () => {
    expect(computeHeaderSegments('2026-09-01', 0, 'day')).toEqual([]);
    expect(computeHeaderSegments('2026-09-01', -3, 'week')).toEqual([]);
  });

  it('emits one segment per day at day zoom, repeating the month only on change', () => {
    // 2026-09-29 .. 2026-10-02
    const segments = computeHeaderSegments('2026-09-29', 4, 'day');
    expect(segments).toHaveLength(4);
    expect(segments.map(s => s.label)).toEqual(['Sep 29', '30', 'Oct 1', '2']);
    expect(segments.map(s => s.subLabel)).toEqual(['Tue', 'Wed', 'Thu', 'Fri']);
    expect(segments.map(s => s.offsetDays)).toEqual([0, 1, 2, 3]);
    expect(segments.every(s => s.spanDays === 1)).toBe(true);
    expect(segments[2].date).toBe('2026-10-01');
  });

  it('groups by Monday-started weeks and clips the first and last week', () => {
    // 2026-09-24 is a Thursday; its week started Mon 2026-09-21.
    const segments = computeHeaderSegments('2026-09-24', 12, 'week');
    expect(segments.map(s => [s.date, s.offsetDays, s.spanDays, s.label])).toEqual([
      ['2026-09-21', 0, 4, 'Sep 21'],
      ['2026-09-28', 4, 7, 'Sep 28'],
      ['2026-10-05', 11, 1, 'Oct 5'],
    ]);
    expect(segments.every(s => s.subLabel === undefined)).toBe(true);
  });

  it('never reports a negative offset for a week starting before the range', () => {
    const segments = computeHeaderSegments('2026-09-24', 3, 'week');
    expect(segments).toEqual([
      { date: '2026-09-21', offsetDays: 0, spanDays: 3, label: 'Sep 21' },
    ]);
  });

  it('groups by month at quarter zoom across a month boundary', () => {
    // 2026-09-24 .. 2026-11-02 (40 days)
    const segments = computeHeaderSegments('2026-09-24', 40, 'quarter');
    expect(segments.map(s => [s.date, s.offsetDays, s.spanDays, s.label])).toEqual([
      ['2026-09-01', 0, 7, 'Sep 2026'],
      ['2026-10-01', 7, 31, 'Oct 2026'],
      ['2026-11-01', 38, 2, 'Nov 2026'],
    ]);
  });

  it('spans exactly the rendered range at every zoom', () => {
    const totalDays = 40;
    for (const zoom of ZOOMS) {
      const segments = computeHeaderSegments('2026-09-24', totalDays, zoom);
      expect(segments[0].offsetDays).toBe(0);
      const total = segments.reduce((sum, s) => sum + s.spanDays, 0);
      expect(total).toBe(totalDays);
      // Segments are contiguous.
      segments.forEach((s, i) => {
        if (i > 0) {
          expect(s.offsetDays).toBe(segments[i - 1].offsetDays + segments[i - 1].spanDays);
        }
      });
    }
  });
});

describe('computeTickOffsets', () => {
  it('returns nothing for an empty range', () => {
    expect(computeTickOffsets('2026-09-24', 0, 'day')).toEqual([]);
  });

  it('ticks every day at day and week zoom', () => {
    expect(computeTickOffsets('2026-09-24', 5, 'day')).toEqual([0, 1, 2, 3, 4]);
    expect(computeTickOffsets('2026-09-24', 5, 'week')).toEqual([0, 1, 2, 3, 4]);
  });

  it('ticks only Mondays at quarter zoom, never before the range', () => {
    // 2026-09-24 is a Thursday; the first Monday inside the range is +4 days.
    expect(computeTickOffsets('2026-09-24', 20, 'quarter')).toEqual([4, 11, 18]);
    // A range that starts on a Monday ticks at 0.
    expect(computeTickOffsets('2026-09-28', 15, 'quarter')).toEqual([0, 7, 14]);
  });
});

describe('showsWeekendShading', () => {
  it('is on for day and week zoom and off for quarter', () => {
    expect(showsWeekendShading('day')).toBe(true);
    expect(showsWeekendShading('week')).toBe(true);
    expect(showsWeekendShading('quarter')).toBe(false);
  });
});

describe('expansionDaysForWidth', () => {
  it('expands by a roughly constant pixel amount, floored at 30 days', () => {
    expect(expansionDaysForWidth(ZOOM_DAY_WIDTH.day)).toBe(30); // 1200/40 = 30
    expect(expansionDaysForWidth(ZOOM_DAY_WIDTH.week)).toBe(75); // 1200/16
    expect(expansionDaysForWidth(ZOOM_DAY_WIDTH.quarter)).toBe(150); // 1200/8
    expect(expansionDaysForWidth(100)).toBe(30); // floor wins
  });

  it('is monotonically non-increasing as days get wider', () => {
    let prev = Infinity;
    for (let width = 4; width <= 80; width += 4) {
      const days = expansionDaysForWidth(width);
      expect(days).toBeLessThanOrEqual(prev);
      prev = days;
    }
  });
});

describe('visibleTagCount', () => {
  it('shows more chips as the block gets wider', () => {
    expect(visibleTagCount(MIN_ONE_TAG_WIDTH - 1, 'day')).toBe(0);
    expect(visibleTagCount(MIN_ONE_TAG_WIDTH, 'day')).toBe(1);
    expect(visibleTagCount(MIN_TWO_TAG_WIDTH - 1, 'day')).toBe(1);
    expect(visibleTagCount(MIN_TWO_TAG_WIDTH, 'day')).toBe(2);
    expect(visibleTagCount(4000, 'day')).toBe(2);
  });

  it('applies the same thresholds at week zoom', () => {
    expect(visibleTagCount(MIN_TWO_TAG_WIDTH, 'week')).toBe(2);
    expect(visibleTagCount(MIN_ONE_TAG_WIDTH, 'week')).toBe(1);
    expect(visibleTagCount(20, 'week')).toBe(0);
  });

  it('shows none at quarter zoom, however long the block is', () => {
    expect(visibleTagCount(4000, 'quarter')).toBe(0);
  });
});
