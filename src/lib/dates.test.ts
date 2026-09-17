import { describe, it, expect } from 'vitest';
import {
  addDaysToISO,
  addMonthsToISO,
  daysBetween,
  formatDayLabel,
  formatFullDate,
  formatMonthLabel,
  formatWeekLabel,
  generateDateRange,
  getDayOfWeek,
  isWeekend,
  startOfMonthISO,
  startOfWeekISO,
} from './dates';

// Every assertion below uses fixed dates: nothing here may depend on "today".

describe('addDaysToISO', () => {
  it('adds and subtracts days', () => {
    expect(addDaysToISO('2026-09-01', 0)).toBe('2026-09-01');
    expect(addDaysToISO('2026-09-01', 5)).toBe('2026-09-06');
    expect(addDaysToISO('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('crosses month and year boundaries', () => {
    expect(addDaysToISO('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysToISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToISO('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('handles leap and non-leap Februaries', () => {
    expect(addDaysToISO('2028-02-28', 1)).toBe('2028-02-29'); // 2028 is a leap year
    expect(addDaysToISO('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('adds whole calendar days across a DST change', () => {
    // If this were 24h arithmetic in a DST zone, one of these would slip a day.
    expect(addDaysToISO('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDaysToISO('2026-10-24', 2)).toBe('2026-10-26');
  });
});

describe('daysBetween', () => {
  it('counts forward from a to b', () => {
    expect(daysBetween('2026-09-01', '2026-09-05')).toBe(4);
  });

  it('is zero for the same day and negative when b precedes a', () => {
    expect(daysBetween('2026-09-05', '2026-09-05')).toBe(0);
    expect(daysBetween('2026-09-05', '2026-09-01')).toBe(-4);
  });

  it('is antisymmetric and inverts addDaysToISO', () => {
    const a = '2026-09-01';
    for (const offset of [-400, -31, -1, 0, 1, 31, 400]) {
      const b = addDaysToISO(a, offset);
      expect(daysBetween(a, b)).toBe(offset);
      expect(daysBetween(b, a)).toBe(offset === 0 ? 0 : -offset);
    }
  });

  it('counts calendar days across DST and leap days', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2); // leap year: 29th in between
  });
});

describe('isWeekend', () => {
  it('is true only for Saturday and Sunday', () => {
    // 2026-09-21 is a Monday.
    const week = generateDateRange('2026-09-21', 7);
    expect(week.map(isWeekend)).toEqual([
      false, // Mon
      false, // Tue
      false, // Wed
      false, // Thu
      false, // Fri
      true, // Sat
      true, // Sun
    ]);
  });
});

describe('formatDayLabel', () => {
  it('shows the month when there is no previous day', () => {
    expect(formatDayLabel('2026-09-15', null)).toBe('Sep 15');
  });

  it('shows the day number alone within the same month', () => {
    expect(formatDayLabel('2026-09-16', '2026-09-15')).toBe('16');
  });

  it('repeats the month on the first day of a new month', () => {
    expect(formatDayLabel('2026-10-01', '2026-09-30')).toBe('Oct 1');
    expect(formatDayLabel('2026-10-02', '2026-10-01')).toBe('2');
  });

  it('repeats the month across a year boundary', () => {
    expect(formatDayLabel('2027-01-01', '2026-12-31')).toBe('Jan 1');
  });

  it('does not pad the day number', () => {
    expect(formatDayLabel('2026-09-05', '2026-09-04')).toBe('5');
  });
});

describe('getDayOfWeek / formatFullDate', () => {
  it('abbreviates the weekday', () => {
    expect(getDayOfWeek('2026-09-21')).toBe('Mon');
    expect(getDayOfWeek('2026-09-27')).toBe('Sun');
  });

  it('formats a full, human-readable date', () => {
    expect(formatFullDate('2026-09-21')).toBe('Mon, Sep 21 2026');
  });
});

describe('startOfWeekISO', () => {
  it('snaps back to the Monday on or before the date', () => {
    expect(startOfWeekISO('2026-09-21')).toBe('2026-09-21'); // already Monday
    expect(startOfWeekISO('2026-09-24')).toBe('2026-09-21'); // Thursday
    expect(startOfWeekISO('2026-09-27')).toBe('2026-09-21'); // Sunday belongs to the prior Monday
  });

  it('crosses a month boundary backwards when it has to', () => {
    expect(startOfWeekISO('2026-10-01')).toBe('2026-09-28');
  });

  it('is idempotent', () => {
    const monday = startOfWeekISO('2026-09-24');
    expect(startOfWeekISO(monday)).toBe(monday);
  });
});

describe('startOfMonthISO / addMonthsToISO', () => {
  it('snaps to the first of the month', () => {
    expect(startOfMonthISO('2026-09-24')).toBe('2026-09-01');
    expect(startOfMonthISO('2026-09-01')).toBe('2026-09-01');
  });

  it('steps whole months in both directions', () => {
    expect(addMonthsToISO('2026-09-01', 1)).toBe('2026-10-01');
    expect(addMonthsToISO('2026-12-01', 1)).toBe('2027-01-01');
    expect(addMonthsToISO('2026-01-01', -1)).toBe('2025-12-01');
  });

  it('clamps to the last day when the target month is shorter', () => {
    expect(addMonthsToISO('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('walks month starts contiguously, which is what the quarter header relies on', () => {
    let cursor = startOfMonthISO('2026-09-24');
    for (const expected of ['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01']) {
      cursor = addMonthsToISO(cursor, 1);
      expect(cursor).toBe(expected);
    }
  });
});

describe('formatWeekLabel / formatMonthLabel', () => {
  it('labels a week by its start day and a month by month and year', () => {
    expect(formatWeekLabel('2026-09-21')).toBe('Sep 21');
    expect(formatMonthLabel('2026-09-01')).toBe('Sep 2026');
    expect(formatMonthLabel('2027-01-01')).toBe('Jan 2027');
  });
});

describe('generateDateRange', () => {
  it('starts at startDate and returns `count` consecutive days', () => {
    expect(generateDateRange('2026-09-29', 4)).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
  });

  it('returns an empty array for a non-positive count', () => {
    expect(generateDateRange('2026-09-29', 0)).toEqual([]);
    expect(generateDateRange('2026-09-29', -5)).toEqual([]);
  });

  it('agrees with daysBetween on its own length', () => {
    const range = generateDateRange('2026-09-01', 90);
    expect(range).toHaveLength(90);
    expect(daysBetween(range[0], range[range.length - 1])).toBe(89);
  });
});
