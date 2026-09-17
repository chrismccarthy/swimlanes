import { describe, it, expect } from 'vitest';
import { computeSprintBoundaries, getSprintLabel } from './sprints';
import { daysBetween } from './dates';

// The app's default anchor: Thursday 2026-02-12, 14-day sprints.
const ANCHOR = '2026-02-12';
const LENGTH = 14;

describe('computeSprintBoundaries', () => {
  it('starts the first sprint on or before fromDate', () => {
    const boundaries = computeSprintBoundaries('2026-02-20', '2026-03-10', ANCHOR, LENGTH);
    expect(boundaries[0].startDate).toBe(ANCHOR);
    expect(boundaries[0].startDate <= '2026-02-20').toBe(true);
  });

  it('starts exactly on the anchor when fromDate is the anchor', () => {
    const boundaries = computeSprintBoundaries(ANCHOR, '2026-02-25', ANCHOR, LENGTH);
    expect(boundaries).toEqual([
      { sprintNumber: 1, startDate: '2026-02-12', endDate: '2026-02-25' },
    ]);
  });

  it('makes each sprint `lengthDays` long with an inclusive end date', () => {
    const boundaries = computeSprintBoundaries('2026-02-12', '2026-04-01', ANCHOR, LENGTH);
    for (const sprint of boundaries) {
      expect(daysBetween(sprint.startDate, sprint.endDate)).toBe(LENGTH - 1);
    }
  });

  it('leaves no gap or overlap between consecutive sprints', () => {
    const boundaries = computeSprintBoundaries('2026-01-01', '2026-06-01', ANCHOR, LENGTH);
    expect(boundaries.length).toBeGreaterThan(5);
    for (let i = 1; i < boundaries.length; i++) {
      expect(daysBetween(boundaries[i - 1].endDate, boundaries[i].startDate)).toBe(1);
    }
  });

  it('walks backwards past the anchor for a range entirely before it', () => {
    const boundaries = computeSprintBoundaries('2026-01-05', '2026-01-20', ANCHOR, LENGTH);
    expect(boundaries.map(b => b.startDate)).toEqual(['2026-01-01', '2026-01-15']);
    expect(boundaries.map(b => b.endDate)).toEqual(['2026-01-14', '2026-01-28']);
    // Every start is the anchor shifted by a whole number of sprints.
    for (const sprint of boundaries) {
      expect(Math.abs(daysBetween(ANCHOR, sprint.startDate) % LENGTH)).toBe(0);
    }
  });

  it('is on-grid for a range well after the anchor', () => {
    const boundaries = computeSprintBoundaries('2026-09-01', '2026-09-30', ANCHOR, LENGTH);
    expect(boundaries.map(b => b.startDate)).toEqual([
      '2026-08-27',
      '2026-09-10',
      '2026-09-24',
    ]);
    for (const sprint of boundaries) {
      expect(Math.abs(daysBetween(ANCHOR, sprint.startDate) % LENGTH)).toBe(0);
    }
  });

  it('covers a range that straddles the anchor', () => {
    const boundaries = computeSprintBoundaries('2026-02-01', '2026-02-20', ANCHOR, LENGTH);
    expect(boundaries.map(b => b.startDate)).toEqual(['2026-01-29', '2026-02-12']);
    expect(boundaries[0].startDate <= '2026-02-01').toBe(true);
    expect(boundaries[boundaries.length - 1].startDate <= '2026-02-20').toBe(true);
  });

  it('covers the whole requested range at both edges', () => {
    const from = '2026-04-03';
    const to = '2026-07-19';
    const boundaries = computeSprintBoundaries(from, to, ANCHOR, LENGTH);
    expect(boundaries[0].startDate <= from).toBe(true);
    expect(boundaries[boundaries.length - 1].endDate >= to).toBe(true);
  });

  it('numbers sprints from 1 within the requested range, not from the anchor', () => {
    // Numbering is range-relative: the first boundary emitted is always 1,
    // even when the range sits months after (or before) the anchor.
    const after = computeSprintBoundaries('2026-09-01', '2026-09-30', ANCHOR, LENGTH);
    expect(after.map(b => b.sprintNumber)).toEqual([1, 2, 3]);

    const before = computeSprintBoundaries('2026-01-05', '2026-01-20', ANCHOR, LENGTH);
    expect(before.map(b => b.sprintNumber)).toEqual([1, 2]);
  });

  it('handles sprint lengths that do not divide the range evenly', () => {
    // 10-day sprints over a 25-day range: 3 sprints, the last one overhanging.
    const boundaries = computeSprintBoundaries('2026-02-12', '2026-03-08', ANCHOR, 10);
    expect(boundaries.map(b => [b.startDate, b.endDate])).toEqual([
      ['2026-02-12', '2026-02-21'],
      ['2026-02-22', '2026-03-03'],
      ['2026-03-04', '2026-03-13'],
    ]);
  });

  it('handles a 7-day sprint and an off-grid fromDate', () => {
    const boundaries = computeSprintBoundaries('2026-02-17', '2026-03-01', ANCHOR, 7);
    expect(boundaries.map(b => b.startDate)).toEqual([
      '2026-02-12',
      '2026-02-19',
      '2026-02-26',
    ]);
  });

  it('emits a single sprint when the range sits inside one', () => {
    const boundaries = computeSprintBoundaries('2026-02-14', '2026-02-18', ANCHOR, LENGTH);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toEqual({
      sprintNumber: 1,
      startDate: '2026-02-12',
      endDate: '2026-02-25',
    });
  });

  it('emits one sprint when fromDate equals toDate', () => {
    const boundaries = computeSprintBoundaries('2026-03-03', '2026-03-03', ANCHOR, LENGTH);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].startDate).toBe('2026-02-26');
  });
});

describe('getSprintLabel', () => {
  const today = '2026-09-15'; // inside the sprint starting 2026-09-10

  it('names the sprint containing today the current one', () => {
    expect(getSprintLabel('2026-09-10', today, ANCHOR, LENGTH)).toBe('Current Sprint');
  });

  it('labels future sprints with a + offset', () => {
    expect(getSprintLabel('2026-09-24', today, ANCHOR, LENGTH)).toBe('Sprint +1');
    expect(getSprintLabel('2026-10-08', today, ANCHOR, LENGTH)).toBe('Sprint +2');
  });

  it('labels past sprints with a negative number', () => {
    expect(getSprintLabel('2026-08-27', today, ANCHOR, LENGTH)).toBe('Sprint 0');
    expect(getSprintLabel('2026-08-13', today, ANCHOR, LENGTH)).toBe('Sprint -1');
  });

  it('is stable for any day inside the same sprint', () => {
    for (const day of ['2026-09-10', '2026-09-15', '2026-09-23']) {
      expect(getSprintLabel('2026-09-10', day, ANCHOR, LENGTH)).toBe('Current Sprint');
    }
  });

  it('works for sprints before the anchor', () => {
    expect(getSprintLabel('2026-01-29', '2026-02-14', ANCHOR, LENGTH)).toBe('Sprint 0');
    expect(getSprintLabel('2026-01-15', '2026-02-14', ANCHOR, LENGTH)).toBe('Sprint -1');
  });
});
